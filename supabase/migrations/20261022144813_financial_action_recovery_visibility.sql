begin;
create or replace function public.recover_stale_financial_actions(p_limit integer default 100)
returns integer language plpgsql security definer set search_path to 'pg_catalog','public' as $function$
declare recovered integer;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'service role required'; end if;
  with stale as (
    select financial_action_id from public.financial_action_outbox
    where status='processing' and claimed_at<now()-interval '15 minutes'
    order by claimed_at,financial_action_id
    for update skip locked limit least(greatest(coalesce(p_limit,100),1),100)
  )
  update public.financial_action_outbox a set status='manual_review',
    last_error='Processing interrupted; reconcile the original provider outcome before any retry',
    metadata=coalesce(a.metadata,'{}'::jsonb)||jsonb_build_object('stale_claim_recovered_at',now(),'previous_claimed_by',a.claimed_by),
    updated_at=now()
  from stale where a.financial_action_id=stale.financial_action_id;
  get diagnostics recovered=row_count;
  return recovered;
end
$function$;
revoke all on function public.recover_stale_financial_actions(integer) from public,anon,authenticated;
grant execute on function public.recover_stale_financial_actions(integer) to service_role;

CREATE OR REPLACE FUNCTION public.claim_financial_actions(p_worker_id text, p_limit integer DEFAULT 20)
 RETURNS TABLE(financial_action_id uuid, action_type text, subject_type text, subject_id text, payment_protection_id uuid, amount numeric, idempotency_key text, paystack_reference text, payee_user_id text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if (select auth.role())<>'service_role' then raise exception 'service role required'; end if;
  if nullif(btrim(p_worker_id),'') is null then raise exception 'worker id required'; end if;
  return query
  with due as(
    select a.financial_action_id
    from public.financial_action_outbox a
    where a.status='pending' and a.available_at<=now()
      and not(
        a.action_type like 'refund_%' and exists(
          select 1 from public.financial_action_outbox active
          where active.payment_protection_id=a.payment_protection_id
            and active.financial_action_id<>a.financial_action_id
            and active.action_type like 'refund_%'
            and active.status in('processing','provider_pending','provider_attention','manual_review')
        )
      )
    order by a.available_at,a.created_at
    for update skip locked
    limit least(greatest(coalesce(p_limit,20),1),50)
  ),claimed as(
    update public.financial_action_outbox a set
      status='processing',claimed_by=btrim(p_worker_id),claimed_at=now(),
      attempt_count=attempt_count+1,updated_at=now()
    from due where a.financial_action_id=due.financial_action_id
    returning a.*
  )
  select c.financial_action_id,c.action_type,c.subject_type,c.subject_id,
    c.payment_protection_id,c.amount,c.idempotency_key,
    p.paystack_reference,p.payee_user_id
  from claimed c join public.payment_protection_transactions p
    on p.id=c.payment_protection_id;
end
$function$;

CREATE OR REPLACE FUNCTION public.get_my_staff_finance_queue()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
  v_payments jsonb;v_withdrawals jsonb;v_commissions jsonb;
  v_payment_protection jsonb;v_refunds jsonb;v_audit jsonb;v_actions jsonb;
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
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_actions from (
    select a.financial_action_id as id,a.action_type,a.subject_type,a.subject_id,
      a.amount,a.status,a.attempt_count,a.claimed_at,a.provider_action_id,
      a.provider_status,a.reconciliation_due_at,a.last_error,a.created_at,a.updated_at,
      p.paystack_reference
    from public.financial_action_outbox a
    join public.payment_protection_transactions p on p.id=a.payment_protection_id
    where a.status in ('pending','processing','manual_review','provider_pending','provider_attention')
      and (v_actor.role='creator' or public.can_current_actor_read_profile(p.payer_user_id)
        or public.can_current_actor_read_profile(p.payee_user_id))
    order by case when a.status in ('manual_review','provider_attention') then 0
      when a.status='processing' and a.claimed_at<now()-interval '15 minutes' then 1 else 2 end,
      a.created_at,a.financial_action_id limit 100
  ) x;
  return jsonb_build_object('actor_role',v_actor.role,'payments',v_payments,'withdrawals',v_withdrawals,
    'commissions',v_commissions,'payment_protection',v_payment_protection,
    'refunds',v_refunds,'audit',v_audit,'financial_actions',v_actions);
end;
$function$
;
commit;
