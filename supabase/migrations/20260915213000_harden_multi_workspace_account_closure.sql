begin;

-- Historical paid-verification records remain auditable, but no signed-in user
-- or server path may create a new verification payment. Service Provider
-- onboarding/review is free and paid tools are a separate product.
create or replace function public.record_worker_verification_payment(
  p_user_id text,
  p_reference text,
  p_amount numeric
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  return false;
end;
$$;

revoke all on function public.record_worker_verification_payment(text,text,numeric)
from public,anon,authenticated;
grant execute on function public.record_worker_verification_payment(text,text,numeric)
to service_role;

comment on function public.record_worker_verification_payment(text,text,numeric) is
  'Retired compatibility RPC. Historical verification payments remain in the ledger; no new Service Provider verification payment can be recorded.';

-- Account closure must reason about the actual Personal identity plus every
-- active workspace, not whichever legacy profiles.role value happens to be
-- projected for compatibility.
create or replace function public.delete_user_account(p_user_id text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_caller public.profiles;
  v_target public.profiles;
  v_self boolean:=false;
  v_count integer:=0;
  v_wallet_total numeric:=0;
begin
  select * into v_caller
  from public.profiles profile
  where profile.auth_id=(select auth.uid())::text
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
  limit 1;
  if v_caller.user_id is null then raise exception 'Active account required'; end if;

  select * into v_target
  from public.profiles profile
  where profile.user_id=p_user_id
  for update;
  if v_target.user_id is null then raise exception 'Account not found'; end if;
  if coalesce(v_target.deleted,false) then return; end if;

  v_self:=v_caller.user_id=v_target.user_id;

  if not v_self then
    if not (
      public.current_actor_has_workspace('creator',null)
      or public.current_actor_has_workspace('admin',v_target.state)
    ) then
      raise exception 'Admin or Creator account-closure authority required';
    end if;
    if public.user_has_active_workspace(v_target.user_id,'creator') then
      raise exception 'Creator authority must be transferred through the controlled Creator process';
    end if;
  else
    if exists(
      select 1 from public.workspace_role_assignments assignment
      where assignment.user_id=v_target.user_id
        and assignment.status='active'
        and assignment.workspace_role in(
          'creator','admin','staff','property_operations','field_operations',
          'worker_operations','finance_operations','security_operations','support'
        )
    ) then
      raise exception 'Assigned WeHouse Team access must be revoked before closing this Personal account';
    end if;
  end if;

  -- Customer-side contractual obligations are independent of provider roles.
  select count(*)::integer into v_count
  from public.reservations reservation
  where reservation.user_id=v_target.user_id
    and coalesce(reservation.status,'') not in(
      'cancelled','refunded','expired','completed','closed'
    );
  if v_count>0 then
    raise exception 'Cannot close account: % active housing reservation(s) still require resolution',v_count;
  end if;

  select count(*)::integer into v_count
  from public.hotel_bookings booking
  where booking.user_id=v_target.user_id
    and coalesce(booking.status,'') not in(
      'cancelled','refunded','expired','completed','checked_out','no_show'
    );
  if v_count>0 then
    raise exception 'Cannot close account: % active hotel stay(s) still require resolution',v_count;
  end if;

  select count(*)::integer into v_count
  from public.worker_bookings booking
  where (booking.user_id=v_target.user_id or booking.worker_id=v_target.user_id)
    and coalesce(booking.status,'') not in(
      'approved_released','cancelled','refunded','expired'
    );
  if v_count>0 then
    raise exception 'Cannot close account: % active WeHouse Services job(s) still require resolution',v_count;
  end if;

  -- Service Provider obligations are checked by workspace grant, not legacy role.
  if public.user_has_active_workspace(v_target.user_id,'worker') then
    if exists(
      select 1
      from public.payment_protection_transactions protection
      join public.worker_bookings booking on booking.id=protection.booking_id
      where booking.worker_id=v_target.user_id
        and coalesce(protection.protection_state,protection.status,'')
          not in('released','refunded','cancelled','reversed','closed')
    ) then
      raise exception 'Cannot close account while a Service Provider Payment Protection obligation is unresolved';
    end if;
  end if;

  -- Property Partner history carries ownership, inspection, booking and payout
  -- evidence. Once real supply has been submitted, closure is a managed process
  -- rather than an instant self-delete.
  if public.user_has_active_workspace(v_target.user_id,'property_partner') then
    select count(*)::integer into v_count
    from public.inspection_requests request
    where request.owner_id=v_target.user_id;
    if v_count>0 then
      raise exception 'Property Partner accounts with submitted property history require managed closure by WeHouse';
    end if;

    select count(*)::integer into v_count
    from public.listings listing
    where listing.owner_id=v_target.user_id or listing.partner_id=v_target.user_id;
    if v_count>0 then
      raise exception 'Property Partner accounts with listing history require managed closure by WeHouse';
    end if;

    select count(*)::integer into v_count
    from public.hotels hotel
    where hotel.owner_id=v_target.user_id;
    if v_count>0 then
      raise exception 'Property Partner accounts with hotel history require managed closure by WeHouse';
    end if;
  end if;

  select coalesce(sum(
    coalesce(wallet.available_balance,0)
    +coalesce(wallet.pending_balance,0)
    +coalesce(wallet.frozen_balance,0)
  ),0)
  into v_wallet_total
  from public.wallets wallet
  where wallet.owner_id=v_target.user_id;
  if v_wallet_total<>0 then
    raise exception 'Cannot close account while wallet obligations remain';
  end if;

  if exists(
    select 1
    from public.withdrawals withdrawal
    join public.wallets wallet on wallet.id=withdrawal.wallet_id
    where wallet.owner_id=v_target.user_id
      and withdrawal.status not in('paid','failed','reversed','rejected','cancelled')
  ) then
    raise exception 'Cannot close account while a withdrawal is still being processed';
  end if;

  -- Hotel-team authority is a grant on the same identity. It can be safely
  -- revoked during closure because the hotel records remain with the hotel.
  update public.hotel_team_members
  set status='revoked',revoked_at=coalesce(revoked_at,now()),updated_at=now()
  where member_user_id=v_target.user_id and status='active';

  update public.workspace_role_assignments
  set status='revoked',revoked_by=v_caller.user_id,revoked_at=now(),updated_at=now()
  where user_id=v_target.user_id and status='active';

  update public.staff_permissions
  set is_active=false,revoked_at=coalesce(revoked_at,now())
  where staff_id=v_target.user_id and is_active;

  update public.profiles
  set deleted=true,deleted_at=now(),updated_by=v_caller.user_id,updated_at=now()
  where user_id=v_target.user_id;

  insert into public.audit_logs(
    action,target_type,target_id,details,admin_id,admin_email
  ) values(
    'DELETE_ACCOUNT','profiles',v_target.user_id,
    jsonb_build_object(
      'self_requested',v_self,
      'authority_model','personal_identity_plus_workspace_grants',
      'soft_delete',true
    )::text,
    v_caller.user_id,v_caller.email
  );
end;
$$;

revoke all on function public.delete_user_account(text) from public,anon;
grant execute on function public.delete_user_account(text) to authenticated,service_role;

comment on function public.delete_user_account(text) is
  'Soft account closure guarded by Personal identity plus all active workspace, booking, payment, wallet, supply and team obligations; never relies on one legacy role value.';

commit;