-- Payout review authority follows additive workspaces and explicit geographic coverage.

begin;

create or replace function public.can_current_actor_read_profile_for(
  p_actor_id text,
  p_target_id text
)
returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_target public.profiles;
  v_target_lga text;
begin
  select * into v_actor
  from public.profiles
  where user_id=p_actor_id
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  select * into v_target
  from public.profiles
  where user_id=p_target_id
  limit 1;
  if v_actor.user_id is null or v_target.user_id is null then return false; end if;
  if v_actor.user_id=v_target.user_id then return true; end if;
  if public.user_has_active_workspace(v_actor.user_id,'creator') then return true; end if;

  v_target_lga:=coalesce(nullif(v_target.local_government,''),nullif(v_target.city,''));
  if public.user_has_active_workspace(v_actor.user_id,'admin') then
    return public.user_workspace_covers(
      v_actor.user_id,'admin',v_target.state,v_target_lga
    );
  end if;
  if public.user_has_active_workspace(v_actor.user_id,'staff') then
    return public.user_workspace_covers(
      v_actor.user_id,'staff',v_target.state,v_target_lga
    );
  end if;
  return false;
end
$$;

create or replace function public.can_current_actor_read_profile(
  p_target_user_id text
)
returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_target public.profiles;
begin
  if (select auth.uid()) is null or p_target_user_id is null then return false; end if;
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null then return false; end if;
  if v_actor.user_id=p_target_user_id then return true; end if;
  if public.user_has_active_workspace(v_actor.user_id,'creator') then return true; end if;
  if not (
    public.user_has_active_workspace(v_actor.user_id,'admin')
    or public.user_has_active_workspace(v_actor.user_id,'staff')
  ) then return false; end if;

  select * into v_target
  from public.profiles
  where user_id=p_target_user_id
  limit 1;
  if v_target.user_id is null then return false; end if;

  return public.current_actor_in_scope(
    coalesce(nullif(v_target.assigned_state,''),nullif(v_target.state,'')),
    coalesce(
      nullif(v_target.assigned_lga,''),
      nullif(v_target.local_government,''),
      nullif(v_target.city,'')
    )
  );
end
$$;

create or replace function public.finance_reviewer_is_authorized(
  p_reviewer_id text
)
returns boolean
language sql
stable security definer
set search_path to 'pg_catalog','public'
as $$
  select exists(
    select 1
    from public.profiles p
    where p.user_id=p_reviewer_id
      and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false)
      and not coalesce(p.banned,false)
      and (
        public.user_has_active_workspace(p.user_id,'creator')
        or public.user_has_active_workspace(p.user_id,'admin')
        or (
          public.user_has_active_workspace(p.user_id,'staff')
          and public.user_has_active_workspace(p.user_id,'finance_operations')
        )
      )
  )
$$;

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
  v_reference:='WHP-'||replace(v_withdrawal.id::text,'-','');
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

CREATE OR REPLACE FUNCTION public.get_withdrawal_payout_snapshot(p_withdrawal_id uuid, p_reviewer_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_reviewer public.profiles;v_withdrawal public.withdrawals;v_wallet public.wallets;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'Service role required'; end if;
  if not public.finance_reviewer_is_authorized(p_reviewer_id) then raise exception 'Finance permission required'; end if;
  select * into v_reviewer from public.profiles where user_id=p_reviewer_id;
  select * into v_withdrawal from public.withdrawals where id=p_withdrawal_id;
  select * into v_wallet from public.wallets where id=v_withdrawal.wallet_id;
  if v_reviewer.user_id is null or v_withdrawal.id is null or v_wallet.id is null then raise exception 'Payout record not found'; end if;
  if v_wallet.owner_id=p_reviewer_id then raise exception 'You cannot review your own withdrawal'; end if;
  if not public.user_has_active_workspace(v_reviewer.user_id,'creator')
     and not public.can_current_actor_read_profile_for(v_reviewer.user_id,v_wallet.owner_id) then
    raise exception 'Withdrawal is outside your assigned coverage';
  end if;
  return jsonb_build_object(
    'success',true,'withdrawal_id',v_withdrawal.id,'status',v_withdrawal.status,
    'amount',v_withdrawal.amount,'reference',v_withdrawal.paystack_transfer_reference,
    'transfer_code',v_withdrawal.paystack_transfer_code,'paystack_status',v_withdrawal.paystack_status
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.reject_withdrawal_for_payout(p_withdrawal_id uuid, p_reviewer_id text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_reviewer public.profiles;v_withdrawal public.withdrawals;v_wallet public.wallets;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'Service role required'; end if;
  if not public.finance_reviewer_is_authorized(p_reviewer_id) then raise exception 'Finance permission required'; end if;
  select * into v_reviewer from public.profiles where user_id=p_reviewer_id;
  select * into v_withdrawal from public.withdrawals where id=p_withdrawal_id for update;
  select * into v_wallet from public.wallets where id=v_withdrawal.wallet_id;
  if v_reviewer.user_id is null or v_withdrawal.id is null or v_wallet.id is null then raise exception 'Payout record not found'; end if;
  if v_wallet.owner_id=p_reviewer_id then raise exception 'You cannot review your own withdrawal'; end if;
  if not public.user_has_active_workspace(v_reviewer.user_id,'creator')
     and not public.can_current_actor_read_profile_for(v_reviewer.user_id,v_wallet.owner_id) then
    raise exception 'Withdrawal is outside your assigned coverage';
  end if;
  if v_withdrawal.status<>'awaiting_review' then raise exception 'Only a withdrawal awaiting review can be rejected'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'A rejection reason is required'; end if;
  update public.withdrawals set reviewed_by=p_reviewer_id,reviewed_at=now() where id=p_withdrawal_id;
  return public.return_reserved_withdrawal(p_withdrawal_id,'rejected',p_reason,'review-rejected:'||p_withdrawal_id::text);
end;
$function$
;

revoke all on function public.can_current_actor_read_profile_for(text,text)
  from public,anon;
grant execute on function public.can_current_actor_read_profile_for(text,text)
  to authenticated,service_role;
revoke all on function public.can_current_actor_read_profile(text)
  from public,anon;
grant execute on function public.can_current_actor_read_profile(text)
  to authenticated,service_role;
revoke all on function public.finance_reviewer_is_authorized(text)
  from public,anon,authenticated;
grant execute on function public.finance_reviewer_is_authorized(text)
  to service_role;

commit;
