begin;
-- Queue identity uses the canonical active Team grant, not legacy profile.role.
CREATE OR REPLACE FUNCTION public.get_my_staff_finance_queue()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
  v_payments jsonb;v_withdrawals jsonb;v_commissions jsonb;
  v_payment_protection jsonb;v_refunds jsonb;v_audit jsonb;
begin
  if not public._property_document_session_active() then raise exception 'Active trusted session required'; end if;
  v_actor:=public._current_team_actor();
  if v_actor.user_id is null then raise exception 'Active finance account required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('finance_operations') then
    raise exception 'Finance Operations access required';
  end if;
  if v_actor.role in ('staff','admin') and v_actor.assigned_state is null then
    raise exception 'Coverage assignment required';
  end if;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_payments from (
    select bp.id,bp.payment_reference,bp.type,bp.booking_type,bp.amount,bp.amount_total,
      bp.amount_commission,bp.net_amount,bp.currency,bp.status,bp.purpose,bp.payment_method,
      bp.paystack_reference,bp.verified_at,bp.paid_at,bp.created_at
    from public.booking_payments bp
    where v_actor.role='creator' or public.can_current_actor_read_profile(bp.user_id)
      or public.can_current_actor_read_profile(bp.payer_user_id) or public.can_current_actor_read_profile(bp.payee_user_id)
      or (bp.listing_id is not null and public.current_actor_can_access_listing_ref(bp.listing_id))
    order by bp.created_at desc limit 100
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_withdrawals from (
    select wd.id,wd.amount,wd.status,wd.snapshot_bank_name,wd.snapshot_bank_account_number,
      wd.snapshot_bank_account_name,wd.paystack_transfer_reference,wd.paystack_transfer_code,
      wd.paystack_status,wd.reviewed_by,wd.reviewed_at,wd.processed_at,wd.failed_reason,
      wd.finalized_at,wd.created_at,w.owner_id,w.owner_type,
      coalesce(p.full_name,p.username,p.email) owner_name
    from public.withdrawals wd join public.wallets w on w.id=wd.wallet_id
    left join public.profiles p on p.user_id=w.owner_id
    where v_actor.role='creator' or public.can_current_actor_read_profile(w.owner_id)
    order by wd.created_at desc limit 100
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_commissions from (
    select c.id,c.booking_type,c.commission_amount,c.commission_rate,c.gross_amount,
      c.description,c.paystack_reference,c.status,c.created_at
    from public.commission_ledger c
    where v_actor.role='creator' or public.can_current_actor_read_profile(c.source_user_id)
    order by c.created_at desc limit 100
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_payment_protection from (
    select t.id,t.booking_id,t.booking_type,t.amount_total,t.amount_commission,t.amount_payee,
      t.commission_rate,t.status,t.released_at,t.released_by,t.paystack_reference,t.created_at
    from public.payment_protection_transactions t
    where v_actor.role='creator' or public.can_current_actor_read_profile(t.payer_user_id)
      or public.can_current_actor_read_profile(t.payee_user_id)
    order by t.created_at desc limit 100
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_refunds from (
    select bp.id,bp.payment_reference,bp.booking_type,bp.amount_total,bp.status,
      bp.refund_reason,bp.refund_processed_at,bp.refund_reference,bp.created_at
    from public.booking_payments bp
    where (bp.refund_reason is not null or bp.refund_processed_at is not null
      or bp.refund_reference is not null or lower(coalesce(bp.status,'')) like 'refund%')
      and (v_actor.role='creator' or public.can_current_actor_read_profile(bp.user_id)
        or public.can_current_actor_read_profile(bp.payer_user_id) or public.can_current_actor_read_profile(bp.payee_user_id)
        or (bp.listing_id is not null and public.current_actor_can_access_listing_ref(bp.listing_id)))
    order by bp.created_at desc limit 100
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_audit from (
    select a.id,a.action,a.actor_role,a.target_type,a.target_id,a.amount,a.commission_amount,
      a.description,a.status_before,a.status_after,a.failure_reason,a.created_at
    from public.financial_audit_log a
    where v_actor.role='creator' or (a.target_user_id is not null and public.can_current_actor_read_profile(a.target_user_id))
    order by a.created_at desc limit 100
  ) x;
  return jsonb_build_object('actor_role',v_actor.role,'payments',v_payments,'withdrawals',v_withdrawals,
    'commissions',v_commissions,'payment_protection',v_payment_protection,
    'refunds',v_refunds,'audit',v_audit);
end;
$function$
;
-- New references follow the provider's lowercase constraint; existing references are retained.
CREATE OR REPLACE FUNCTION public.claim_withdrawal_for_payout(p_withdrawal_id uuid, p_reviewer_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_reviewer public.profiles;
  v_withdrawal public.withdrawals;
  v_wallet public.wallets;
  v_reference text;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'Service role required';
  end if;
  if not public.finance_reviewer_is_authorized(p_reviewer_id) then
    raise exception 'Finance permission required';
  end if;
  select * into v_reviewer from public.profiles where user_id=p_reviewer_id;
  select * into v_withdrawal from public.withdrawals where id=p_withdrawal_id for update;
  if v_withdrawal.id is null then raise exception 'Withdrawal not found'; end if;
  select * into v_wallet from public.wallets where id=v_withdrawal.wallet_id for update;
  if v_wallet.id is null then raise exception 'Wallet not found'; end if;
  if v_wallet.owner_id=p_reviewer_id then raise exception 'You cannot review your own withdrawal'; end if;
  if not public.user_has_active_workspace(v_reviewer.user_id,'creator')
     and not public.can_current_actor_read_profile_for(v_reviewer.user_id,v_wallet.owner_id) then
    raise exception 'Withdrawal is outside your assigned coverage';
  end if;
  if v_withdrawal.status='processing' and v_withdrawal.paystack_transfer_reference is not null then
    return jsonb_build_object(
      'success',true,'already_claimed',true,'withdrawal_id',v_withdrawal.id,
      'amount',v_withdrawal.amount,'recipient_code',v_withdrawal.payout_recipient_code,
      'reference',v_withdrawal.paystack_transfer_reference,'owner_type',v_wallet.owner_type
    );
  end if;
  if v_withdrawal.status<>'awaiting_review' then
    raise exception 'Withdrawal is not awaiting review';
  end if;
  if coalesce(v_wallet.frozen_balance,0)<v_withdrawal.amount then
    raise exception 'Reserved wallet balance is incomplete';
  end if;
  if nullif(btrim(coalesce(v_withdrawal.payout_recipient_code,'')),'') is null then
    raise exception 'Paystack recipient is missing';
  end if;
  v_reference:='whp-'||replace(v_withdrawal.id::text,'-','');
  update public.withdrawals
  set status='processing',reviewed_by=p_reviewer_id,reviewed_at=now(),
      paystack_transfer_reference=v_reference,paystack_status='initiating',updated_at=now()
  where id=v_withdrawal.id;
  insert into public.financial_audit_logs(
    event_type,user_id,target_user_id,amount,reference_id,reference_type,description,metadata
  ) values(
    'withdrawal_processing',p_reviewer_id,v_wallet.owner_id,v_withdrawal.amount,
    v_withdrawal.id::text,'withdrawal','Withdrawal approved for Paystack transfer',
    jsonb_build_object('paystack_reference',v_reference,'owner_type',v_wallet.owner_type)
  );
  return jsonb_build_object(
    'success',true,'already_claimed',false,'withdrawal_id',v_withdrawal.id,
    'amount',v_withdrawal.amount,'recipient_code',v_withdrawal.payout_recipient_code,
    'reference',v_reference,'owner_type',v_wallet.owner_type
  );
end;
$function$
;
revoke all on function public.get_my_staff_finance_queue() from public,anon;
grant execute on function public.get_my_staff_finance_queue() to authenticated,service_role;
commit;
