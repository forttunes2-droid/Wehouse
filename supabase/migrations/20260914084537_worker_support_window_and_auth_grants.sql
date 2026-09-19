-- Job-specific support stays open while money is unsettled. Once the final
-- Payment Protection release is authoritative, it remains open for exactly
-- 72 hours from released_at. Job completion and mutable booking timestamps do
-- not start or extend this window.

create or replace function public.normalize_worker_help_window()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_released_at timestamptz;
begin
  select protection.released_at into v_released_at
  from public.payment_protection_transactions protection
  where protection.id=new.payment_protection_id
    and protection.subject_type='worker_booking'
    and protection.protection_state='released'
  limit 1;

  new.help_until:=case
    when v_released_at is null then null
    else v_released_at+interval '72 hours'
  end;
  return new;
end
$$;

revoke all on function public.normalize_worker_help_window() from public,anon,authenticated;
grant execute on function public.normalize_worker_help_window() to service_role;

drop trigger if exists normalize_worker_help_window on public.worker_bookings;
create trigger normalize_worker_help_window
before insert or update of help_until,payment_protection_id,status,canonical_job_state
on public.worker_bookings
for each row execute function public.normalize_worker_help_window();

-- Remove completion-anchored legacy values, then rebuild released jobs from
-- the immutable payment release event.
update public.worker_bookings booking
set help_until=null
where booking.help_until is not null
  and not exists(
    select 1
    from public.payment_protection_transactions protection
    where protection.id=booking.payment_protection_id
      and protection.subject_type='worker_booking'
      and protection.protection_state='released'
      and protection.released_at is not null
  );

update public.worker_bookings booking
set help_until=protection.released_at+interval '72 hours'
from public.payment_protection_transactions protection
where protection.id=booking.payment_protection_id
  and protection.subject_type='worker_booking'
  and protection.protection_state='released'
  and protection.released_at is not null
  and booking.help_until is distinct from protection.released_at+interval '72 hours';

create or replace function public.get_my_worker_booking_details(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_booking public.worker_bookings;
  v_customer public.profiles;
  v_worker public.profiles;
  v_payment_status text;
  v_protection_status text;
  v_payment_released_at timestamptz;
  v_job_support_until timestamptz;
  v_job_support_open boolean;
begin
  select profile.* into v_actor
  from public.profiles profile
  where profile.auth_id=(select auth.uid())::text
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
  limit 1;
  if v_actor.user_id is null then raise exception 'Authentication required'; end if;

  select * into v_booking from public.worker_bookings where id=p_booking_id;
  if v_booking.id is null then return null; end if;
  if v_actor.user_id is distinct from v_booking.user_id
     and v_actor.user_id is distinct from v_booking.worker_id then
    raise exception 'Booking participant access required';
  end if;

  select * into v_customer from public.profiles where user_id=v_booking.user_id limit 1;
  select * into v_worker from public.profiles where user_id=v_booking.worker_id limit 1;

  select payment.status into v_payment_status
  from public.booking_payments payment
  where payment.worker_booking_id=v_booking.id
    and payment.purpose='worker_booking'
  order by case payment.status
    when 'review_required' then 0
    when 'refunded' then 1
    when 'reversed' then 1
    when 'paid' then 2
    when 'completed' then 2
    when 'pending' then 3
    when 'processing' then 3
    else 4
  end,
  payment.updated_at desc nulls last,
  payment.created_at desc nulls last,
  payment.id desc
  limit 1;

  select protection.protection_state,protection.released_at
  into v_protection_status,v_payment_released_at
  from public.payment_protection_transactions protection
  where protection.booking_id=v_booking.id
    and protection.booking_type='worker_booking'
  order by protection.updated_at desc,protection.created_at desc,protection.id desc
  limit 1;

  v_job_support_until:=case
    when lower(coalesce(v_protection_status,''))='released'
      and v_payment_released_at is not null
    then v_payment_released_at+interval '72 hours'
    else null
  end;
  v_job_support_open:=case
    when lower(coalesce(v_payment_status,''))='review_required'
      or lower(coalesce(v_protection_status,'')) in ('review','under_review','disputed','risk_held','frozen')
      then true
    when lower(coalesce(v_protection_status,''))='released'
      then v_job_support_until is not null and now()<v_job_support_until
    when lower(coalesce(v_booking.status,'')) in ('cancelled','refunded')
      then false
    else true
  end;

  return jsonb_build_object(
    'id',v_booking.id,'booking_code',v_booking.booking_code,'status',v_booking.status,
    'service_type',v_booking.service_type,'description',v_booking.description,
    'customer_message',v_booking.customer_message,'request_attachments',v_booking.request_attachments,
    'address',v_booking.address,'service_latitude',v_booking.service_latitude,
    'service_longitude',v_booking.service_longitude,
    'service_location_accuracy_m',v_booking.service_location_accuracy_m,
    'service_location_source',v_booking.service_location_source,
    'scheduled_date',v_booking.scheduled_date,'negotiated_amount',v_booking.negotiated_amount,
    'agreed_amount',v_booking.agreed_amount,'wehouse_fee',v_booking.wehouse_fee,
    'worker_receives',v_booking.worker_receives,
    'payment_status',coalesce(v_payment_status,'not_started'),
    'protection_status',v_protection_status,
    'money_state',public.worker_booking_money_state(v_payment_status,v_protection_status),
    'payment_review_required',coalesce(v_payment_status='review_required',false),
    'payment_protected',lower(coalesce(v_protection_status,'')) in
      ('protected','payment_protected','secured','held','holding'),
    'payment_released_at',v_payment_released_at,
    'job_support_until',v_job_support_until,
    'job_support_open',v_job_support_open,
    'help_until',v_job_support_until,
    'help_open',v_job_support_open,
    'blocked_by_me',exists(
      select 1 from public.worker_user_blocks block_row
      where block_row.blocker_user_id=v_actor.user_id
        and block_row.blocked_user_id=case
          when v_actor.user_id=v_booking.user_id then v_booking.worker_id else v_booking.user_id end
    ),
    'blocked_me',exists(
      select 1 from public.worker_user_blocks block_row
      where block_row.blocker_user_id=case
          when v_actor.user_id=v_booking.user_id then v_booking.worker_id else v_booking.user_id end
        and block_row.blocked_user_id=v_actor.user_id
    ),
    'created_at',v_booking.created_at,'updated_at',v_booking.updated_at,
    'user_id',v_booking.user_id,'worker_id',v_booking.worker_id,
    'user_name',coalesce(v_customer.full_name,v_customer.username,'Customer'),
    'customer_username',v_customer.username,'user_avatar',v_customer.avatar_url,
    'worker_name',coalesce(v_worker.full_name,v_worker.username,'Worker'),
    'worker_avatar',v_worker.avatar_url
  );
end
$$;

revoke all on function public.get_my_worker_booking_details(uuid) from public,anon;
grant execute on function public.get_my_worker_booking_details(uuid) to authenticated,service_role;

-- Trigger helpers must never be public RPCs. Date of birth is an authenticated
-- self-service action only; an explicit legacy anon grant remained in production.
revoke execute on function public.require_adult_before_profile_completion() from public,anon,authenticated;
grant execute on function public.require_adult_before_profile_completion() to service_role;
revoke execute on function public.set_my_date_of_birth(date) from public,anon;
grant execute on function public.set_my_date_of_birth(date) to authenticated,service_role;

-- Keep the existing account-closure authorization logic but prevent object
-- shadowing inside its SECURITY DEFINER execution context.
alter function public.delete_user_account(text) set search_path to 'pg_catalog','public';

-- Provider-confirmed password recovery. The public step always returns an
-- opaque attempt id, so it does not reveal whether an email/username exists.
-- The attempt is short-lived and can be verified only by an OAuth session for
-- a provider already linked to the same Auth identity. Password mutation is
-- performed by the authenticated Edge Function after it atomically claims the
-- verified attempt.
create table if not exists public.identity_provider_password_recovery_attempts(
  attempt_id uuid primary key default gen_random_uuid(),
  target_auth_id text not null,
  provider text not null,
  status text not null default 'requested',
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '10 minutes'),
  verified_at timestamptz,
  verified_session_id text,
  processing_at timestamptz,
  consumed_at timestamptz,
  constraint identity_provider_password_recovery_provider_check
    check(provider in('google','apple')),
  constraint identity_provider_password_recovery_status_check
    check(status in('requested','verified','processing','consumed')),
  constraint identity_provider_password_recovery_expiry_check
    check(expires_at>requested_at and expires_at<=requested_at+interval '15 minutes')
);

alter table public.identity_provider_password_recovery_attempts enable row level security;
revoke all on table public.identity_provider_password_recovery_attempts from public,anon,authenticated;
grant all on table public.identity_provider_password_recovery_attempts to service_role;

create index if not exists identity_provider_password_recovery_target_recent_idx
on public.identity_provider_password_recovery_attempts(target_auth_id,requested_at desc);

create or replace function public.begin_identity_provider_password_recovery(
  p_identifier text,
  p_provider text default 'google'
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public','auth'
as $$
declare
  v_attempt_id uuid:=gen_random_uuid();
  v_identifier text:=lower(nullif(btrim(p_identifier),''));
  v_provider text:=lower(nullif(btrim(p_provider),''));
  v_target_auth_id text;
begin
  if v_identifier is null or v_provider not in('google','apple') then
    return v_attempt_id;
  end if;

  select profile.auth_id into v_target_auth_id
  from public.profiles profile
  where (
      lower(coalesce(profile.email,''))=v_identifier
      or lower(coalesce(profile.username,''))=v_identifier
    )
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
    and exists(
      select 1
      from auth.identities identity_row
      where identity_row.user_id::text=profile.auth_id
        and identity_row.provider=v_provider
    )
  limit 1;

  -- Return the same shape for unknown, unlinked and rate-limited accounts.
  if v_target_auth_id is null then return v_attempt_id; end if;
  if (
    select count(*)
    from public.identity_provider_password_recovery_attempts attempt
    where attempt.target_auth_id=v_target_auth_id
      and attempt.requested_at>now()-interval '15 minutes'
  )>=5 then return v_attempt_id; end if;

  insert into public.identity_provider_password_recovery_attempts(
    attempt_id,target_auth_id,provider
  ) values(v_attempt_id,v_target_auth_id,v_provider);
  return v_attempt_id;
end
$$;

revoke all on function public.begin_identity_provider_password_recovery(text,text) from public;
grant execute on function public.begin_identity_provider_password_recovery(text,text) to anon,authenticated,service_role;

create or replace function public.verify_identity_provider_password_recovery(
  p_attempt_id uuid,
  p_provider text default 'google'
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','auth'
as $$
declare
  v_auth_id text:=(select auth.uid())::text;
  v_session_id text:=nullif((select auth.jwt()->>'session_id'),'');
  v_provider text:=lower(nullif(btrim(p_provider),''));
  v_oauth_verified boolean:=false;
begin
  select exists(
    select 1
    from jsonb_array_elements(coalesce((select auth.jwt()->'amr'),'[]'::jsonb)) method
    where method->>'method'='oauth'
  ) into v_oauth_verified;

  if v_auth_id is null or v_session_id is null or not v_oauth_verified
     or v_provider not in('google','apple') then
    raise exception 'A linked identity provider confirmation is required';
  end if;
  if not exists(
    select 1 from auth.identities identity_row
    where identity_row.user_id::text=v_auth_id
      and identity_row.provider=v_provider
  ) then raise exception 'The selected provider is not linked to this account'; end if;

  update public.identity_provider_password_recovery_attempts attempt
  set status='verified',verified_at=now(),verified_session_id=v_session_id
  where attempt.attempt_id=p_attempt_id
    and attempt.target_auth_id=v_auth_id
    and attempt.provider=v_provider
    and attempt.status='requested'
    and attempt.expires_at>now();
  if not found then raise exception 'Recovery confirmation expired or does not match'; end if;

  return jsonb_build_object('success',true,'provider',v_provider);
end
$$;

revoke all on function public.verify_identity_provider_password_recovery(uuid,text) from public,anon;
grant execute on function public.verify_identity_provider_password_recovery(uuid,text) to authenticated,service_role;

create or replace function public.claim_identity_provider_password_recovery(p_attempt_id uuid)
returns text
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_auth_id text:=(select auth.uid())::text;
  v_session_id text:=nullif((select auth.jwt()->>'session_id'),'');
  v_claimed_auth_id text;
begin
  update public.identity_provider_password_recovery_attempts attempt
  set status='processing',processing_at=now()
  where attempt.attempt_id=p_attempt_id
    and attempt.target_auth_id=v_auth_id
    and attempt.status='verified'
    and attempt.verified_session_id=v_session_id
    and attempt.expires_at>now()
  returning attempt.target_auth_id into v_claimed_auth_id;
  if v_claimed_auth_id is null then
    raise exception 'Verified recovery confirmation required';
  end if;
  return v_claimed_auth_id;
end
$$;

revoke all on function public.claim_identity_provider_password_recovery(uuid) from public,anon;
grant execute on function public.claim_identity_provider_password_recovery(uuid) to authenticated,service_role;

create or replace function public.finish_identity_provider_password_recovery(
  p_attempt_id uuid,
  p_auth_id text,
  p_succeeded boolean
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  if (select auth.role())<>'service_role' then raise exception 'Service role required'; end if;
  update public.identity_provider_password_recovery_attempts attempt
  set status=case when p_succeeded then 'consumed' else 'verified' end,
      consumed_at=case when p_succeeded then now() else null end,
      processing_at=case when p_succeeded then processing_at else null end
  where attempt.attempt_id=p_attempt_id
    and attempt.target_auth_id=p_auth_id
    and attempt.status='processing';
  return found;
end
$$;

revoke all on function public.finish_identity_provider_password_recovery(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.finish_identity_provider_password_recovery(uuid,text,boolean) to service_role;

-- Retire the previous proof-only RPC: it could distinguish an OAuth login but
-- had no server-issued recovery attempt to distinguish recovery from login.
revoke execute on function public.verify_google_password_recovery() from authenticated;

update public.function_execution_registry
set authenticated_allowed=false,
    review_state='retired',
    rationale='Replaced by a short-lived provider recovery attempt bound to one OAuth session',
    captured_at=now()
where function_signature='verify_google_password_recovery()';

insert into public.function_execution_registry(
  function_signature,function_name,security_mode,public_allowed,anon_allowed,
  authenticated_allowed,service_role_allowed,review_state,rationale,captured_at
)
select procedure.oid::regprocedure::text,procedure.proname,
  case when procedure.prosecdef then 'definer' else 'invoker' end,
  has_function_privilege('public',procedure.oid,'execute'),
  has_function_privilege('anon',procedure.oid,'execute'),
  has_function_privilege('authenticated',procedure.oid,'execute'),
  has_function_privilege('service_role',procedure.oid,'execute'),
  case
    when procedure.proname in(
      'normalize_worker_help_window','finish_identity_provider_password_recovery'
    ) then 'approved_service_only'
    else 'approved_client_rpc'
  end,
  case procedure.proname
    when 'normalize_worker_help_window'
      then 'Trigger-enforced Worker support cutoff derived only from final Payment Protection release'
    when 'get_my_worker_booking_details'
      then 'Participant-scoped Worker booking projection with server-computed support availability'
    when 'begin_identity_provider_password_recovery'
      then 'Opaque non-enumerating recovery attempt for a linked identity provider'
    when 'verify_identity_provider_password_recovery'
      then 'Actor, provider, OAuth method and Auth session must match the recovery target'
    when 'claim_identity_provider_password_recovery'
      then 'Atomic one-use claim bound to the verified Auth session before Edge password mutation'
    else 'Service-only completion record for a provider-confirmed password recovery'
  end,
  now()
from pg_proc procedure
join pg_namespace namespace on namespace.oid=procedure.pronamespace
where namespace.nspname='public'
  and procedure.proname in(
    'normalize_worker_help_window','get_my_worker_booking_details',
    'begin_identity_provider_password_recovery',
    'verify_identity_provider_password_recovery',
    'claim_identity_provider_password_recovery',
    'finish_identity_provider_password_recovery'
  )
on conflict(function_signature) do update set
  function_name=excluded.function_name,
  security_mode=excluded.security_mode,
  public_allowed=excluded.public_allowed,
  anon_allowed=excluded.anon_allowed,
  authenticated_allowed=excluded.authenticated_allowed,
  service_role_allowed=excluded.service_role_allowed,
  review_state=excluded.review_state,
  rationale=excluded.rationale,
  captured_at=excluded.captured_at;
