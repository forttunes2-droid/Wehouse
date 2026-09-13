-- Applied migration version: 20260907184739.
-- A Worker can become verified/live only after a server-confirmed onboarding
-- payment. This trigger covers every approval RPC and any future write path.
create or replace function public._guard_worker_profile_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_becoming_verified boolean := false;
begin
  if new.role <> 'worker' then return new; end if;

  if new.worker_status = 'approved_for_verification' then
    new.worker_status := 'verification_paid';
  elsif new.worker_status = 'approved' then
    new.worker_status := 'pending';
  elsif new.worker_status = 'declined' then
    new.worker_status := 'rejected';
  end if;

  v_becoming_verified := new.worker_status = 'verified'
    and (tg_op = 'INSERT'
      or old.worker_status is distinct from 'verified'
      or old.worker_verified is distinct from true);

  if v_becoming_verified and not exists (
    select 1
    from public.booking_payments payment
    where payment.user_id = new.user_id
      and payment.purpose = 'worker_verification'
      and payment.status in ('paid', 'completed')
  ) then
    raise exception 'Confirmed Worker onboarding payment is required before verification';
  end if;

  new.worker_verified := new.worker_status = 'verified';
  if new.worker_status <> 'verified'
     or coalesce(new.deleted, false)
     or coalesce(new.suspended, false)
     or coalesce(new.banned, false) then
    new.available := false;
  end if;
  return new;
end;
$$;

-- Correct legacy/test accounts that reached marketplace visibility without the
-- mandatory payment. Evidence and review history remain for later resubmission.
with unpaid_live as (
  select profile.user_id
  from public.profiles profile
  where profile.role = 'worker'
    and (profile.worker_status = 'verified' or profile.worker_verified or profile.available)
    and not exists (
      select 1
      from public.booking_payments payment
      where payment.user_id = profile.user_id
        and payment.purpose = 'worker_verification'
        and payment.status in ('paid', 'completed')
    )
), reset_profiles as (
  update public.profiles profile
  set worker_status = 'pending',
      worker_verified = false,
      available = false,
      updated_at = now()
  from unpaid_live
  where profile.user_id = unpaid_live.user_id
  returning profile.user_id
)
update public.worker_verifications verification
set status = 'pending',
    reviewed_by = null,
    reviewed_at = null,
    updated_at = now()
from reset_profiles
where verification.worker_id = reset_profiles.user_id;

revoke all on function public._guard_worker_profile_state() from public, anon, authenticated;
