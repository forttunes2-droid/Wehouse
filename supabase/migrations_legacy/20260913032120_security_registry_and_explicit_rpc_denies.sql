-- Security closure and payout-account change state machine.
-- The change request is created before any Paystack mutation, is idempotent, and
-- cannot become the default account until identity checks and cooling are met.

-- RLS-with-no-policy is deliberate RPC-only access, made explicit for auditors.
drop policy if exists worker_showcase_comments_rpc_only
  on public.worker_showcase_comments;
create policy worker_showcase_comments_rpc_only
on public.worker_showcase_comments
as restrictive for all to anon,authenticated
using(false) with check(false);

-- Internal journals, transition histories, provider inboxes and command
-- outboxes are service/RPC-only. Give each an explicit deny policy so a fresh
-- schema is both closed and unambiguous to the database advisor.
do $policies$
declare
  v_table text;
begin
  foreach v_table in array array[
    'caution_claims','caution_evidence','creator_elevation_grants',
    'financial_action_outbox','hotel_stay_transitions','ledger_accounts',
    'ledger_entries','ledger_transactions','long_let_reservation_transitions',
    'obligation_policy_snapshots','payment_protection_transitions',
    'payout_account_change_requests','shared_payment_groups',
    'shared_payment_members','short_let_booking_transitions',
    'verified_provider_events','worker_booking_reviews',
    'worker_completion_reminder_requests','worker_job_transitions',
    'worker_user_blocks'
  ] loop
    if to_regclass('public.'||v_table) is not null then
      execute format(
        'drop policy if exists canonical_rpc_only on public.%I',v_table
      );
      execute format(
        'create policy canonical_rpc_only on public.%I for all to anon, authenticated using (false) with check (false)',
        v_table
      );
    end if;
  end loop;
end
$policies$;

-- Customers and anonymous users never mutate or inspect internal hotel inventory
-- rows directly. Public hotel discovery uses the masked RPC projections.
drop policy if exists hotel_bookings_customer_update_v2 on public.hotel_bookings;
drop policy if exists hotel_inventory_daily_read on public.hotel_inventory_daily;
drop policy if exists hotel_rooms_canonical_select on public.hotel_rooms;
revoke update on table public.hotel_bookings from authenticated;
revoke all on table public.hotel_inventory_daily from anon;
revoke all on table public.hotel_room_units from anon;
revoke all on table public.hotel_rooms from anon;
revoke select on table public.hotel_inventory_daily from authenticated;
revoke select on table public.hotel_room_units from authenticated;
revoke select on table public.hotel_rooms from authenticated;
grant all on table public.hotel_inventory_daily to service_role;
grant all on table public.hotel_room_units to service_role;
grant all on table public.hotel_rooms to service_role;

-- PostgreSQL grants EXECUTE to PUBLIC by default. Remove that ambient capability.
-- Do not blanket-revoke `anon` or `authenticated`: existing application RPCs
-- already use explicit role grants and removing them here would break otherwise
-- valid APIs. Sensitive functions are revoked from every client role below.
revoke all on all functions in schema public from public;
alter default privileges for role postgres in schema public
  revoke execute on functions from public;
grant execute on function public.get_discoverable_hotels() to anon,authenticated,service_role;
grant execute on function public.get_public_hotel_detail(integer)
  to anon,authenticated,service_role;

-- Snapshot every exposed function and its effective role grants. This registry
-- is the review manifest; it does not grant access and is never a substitute
-- for checks inside a privileged function.
create table if not exists public.function_execution_registry(
  function_signature text primary key,
  function_name text not null,
  security_mode text not null check(security_mode in('invoker','definer')),
  public_allowed boolean not null,
  anon_allowed boolean not null,
  authenticated_allowed boolean not null,
  service_role_allowed boolean not null,
  review_state text not null default 'requires_review' check(review_state in(
    'requires_review','approved_public_projection','approved_client_rpc',
    'approved_service_only','retired'
  )),
  rationale text,
  captured_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text references public.profiles(user_id)
);

alter table public.function_execution_registry enable row level security;
drop policy if exists function_execution_registry_creator_read
on public.function_execution_registry;
create policy function_execution_registry_creator_read
on public.function_execution_registry for select to authenticated
using(public.current_actor_has_workspace('creator',null));
revoke all on table public.function_execution_registry
from public,anon,authenticated;
grant select on table public.function_execution_registry to authenticated;
grant all on table public.function_execution_registry to service_role;

insert into public.function_execution_registry(
  function_signature,function_name,security_mode,public_allowed,anon_allowed,
  authenticated_allowed,service_role_allowed,review_state,rationale,captured_at
)
select
  procedure.oid::regprocedure::text,
  procedure.proname,
  case when procedure.prosecdef then 'definer' else 'invoker' end,
  has_function_privilege('public',procedure.oid,'execute'),
  has_function_privilege('anon',procedure.oid,'execute'),
  has_function_privilege('authenticated',procedure.oid,'execute'),
  has_function_privilege('service_role',procedure.oid,'execute'),
  case
    when procedure.oid in(
      to_regprocedure('public.get_discoverable_hotels()'),
      to_regprocedure('public.get_public_hotel_detail(integer)')
    ) then 'approved_public_projection'
    when not has_function_privilege('anon',procedure.oid,'execute')
      and not has_function_privilege('authenticated',procedure.oid,'execute')
      and has_function_privilege('service_role',procedure.oid,'execute')
      then 'approved_service_only'
    else 'requires_review'
  end,
  case
    when procedure.oid in(
      to_regprocedure('public.get_discoverable_hotels()'),
      to_regprocedure('public.get_public_hotel_detail(integer)')
    ) then 'Reviewed redacted Hotel discovery projection'
    else null
  end,
  now()
from pg_proc procedure
join pg_namespace namespace on namespace.oid=procedure.pronamespace
where namespace.nspname='public'
on conflict(function_signature) do update set
  function_name=excluded.function_name,
  security_mode=excluded.security_mode,
  public_allowed=excluded.public_allowed,
  anon_allowed=excluded.anon_allowed,
  authenticated_allowed=excluded.authenticated_allowed,
  service_role_allowed=excluded.service_role_allowed,
  captured_at=excluded.captured_at;

-- Apply a safe, explicit search path to legacy SECURITY DEFINER routines that
-- lack one. Existing explicitly configured routines are not rewritten.
do $security$
declare f record;
begin
  for f in
    select p.oid::regprocedure signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef and p.proconfig is null
  loop
    execute format(
      'alter function %s set search_path to pg_catalog,public,extensions,private,storage,auth',
      f.signature
    );
  end loop;
end
$security$;

alter table public.bank_accounts
  add column if not exists is_active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists activated_at timestamptz,
  add column if not exists deactivated_at timestamptz;

create unique index if not exists bank_accounts_one_active_default
  on public.bank_accounts(user_id)
  where is_active and is_default;
create unique index if not exists bank_accounts_active_destination
  on public.bank_accounts(user_id,bank_code,account_number)
  where is_active;

create table if not exists public.payout_account_change_requests(
  request_id uuid primary key,
  idempotency_key text not null unique,
  user_id text not null references public.profiles(user_id) on delete restrict,
  auth_session_id text not null,
  bank_code text not null,
  bank_name text not null,
  account_number text not null,
  account_name text not null,
  recipient_code text,
  replacement boolean not null,
  fresh_sign_in_verified_at timestamptz,
  otp_verified_at timestamptz,
  account_name_confirmed_at timestamptz not null,
  cooling_ends_at timestamptz not null,
  status text not null default 'processing' check(status in (
    'processing','uncertain','cooling','activation_pending','active','failed','cancelled'
  )),
  bank_account_id uuid references public.bank_accounts(id) on delete restrict,
  error_code text,
  error_message text,
  initiated_ip_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz,
  check(not replacement or (
    fresh_sign_in_verified_at is not null and otp_verified_at is not null
  )),
  check(otp_verified_at is null or fresh_sign_in_verified_at is null
    or otp_verified_at>=fresh_sign_in_verified_at),
  check(fresh_sign_in_verified_at is null
    or account_name_confirmed_at>=fresh_sign_in_verified_at),
  check(cooling_ends_at>=account_name_confirmed_at)
);

create index if not exists payout_account_change_requests_user_status_idx
  on public.payout_account_change_requests(user_id,status,updated_at desc);
create unique index if not exists payout_account_one_open_change
  on public.payout_account_change_requests(user_id)
  where status in ('processing','uncertain','cooling','activation_pending');

alter table public.payout_account_change_requests enable row level security;
revoke all on table public.payout_account_change_requests from public,anon,authenticated;
grant all on table public.payout_account_change_requests to service_role;

create or replace function public.begin_payout_account_change_from_service(
  p_request_id uuid,
  p_idempotency_key text,
  p_user_id text,
  p_auth_session_id text,
  p_bank_code text,
  p_bank_name text,
  p_account_number text,
  p_account_name text,
  p_recipient_code text,
  p_fresh_sign_in_verified_at timestamptz,
  p_otp_verified_at timestamptz,
  p_account_name_confirmed_at timestamptz,
  p_ip_hash text default null
)
returns public.payout_account_change_requests
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_existing public.payout_account_change_requests;
  v_replacement boolean;
  v_account_id uuid;
begin
  if (select auth.role())<>'service_role' then raise exception 'service role required'; end if;
  select * into v_existing from public.payout_account_change_requests
  where request_id=p_request_id or idempotency_key=p_idempotency_key;
  if v_existing.request_id is not null then
    if v_existing.user_id<>p_user_id
      or v_existing.bank_code<>p_bank_code
      or v_existing.account_number<>p_account_number then
      raise exception 'Idempotency key belongs to a different payout change';
    end if;
    if v_existing.bank_account_id is not null then return v_existing; end if;
    v_replacement:=v_existing.replacement;
  else
    select exists(
      select 1 from public.bank_accounts
      where user_id=p_user_id and is_active and is_default
    ) into v_replacement;
  end if;
  if v_replacement and (
    p_fresh_sign_in_verified_at is null
    or p_otp_verified_at is null
    or p_fresh_sign_in_verified_at<now()-interval '5 minutes'
    or p_otp_verified_at<now()-interval '5 minutes'
  ) then raise exception 'Fresh sign-in and OTP are required'; end if;
  if p_otp_verified_at is not null
    and p_account_name_confirmed_at<p_otp_verified_at then
    raise exception 'Account name must be confirmed after OTP';
  end if;

  insert into public.bank_accounts(
    user_id,account_number,bank_code,bank_name,account_name,
    paystack_recipient_code,is_default,verified_at,is_active,created_at,updated_at
  ) values(
    p_user_id,p_account_number,p_bank_code,p_bank_name,p_account_name,
    p_recipient_code,false,now(),true,now(),now()
  ) on conflict(user_id,bank_code,account_number) where is_active
  do update set
    bank_name=excluded.bank_name,
    account_name=excluded.account_name,
    paystack_recipient_code=coalesce(
      excluded.paystack_recipient_code,public.bank_accounts.paystack_recipient_code
    ),
    verified_at=now(),updated_at=now()
  returning id into v_account_id;

  if v_existing.request_id is null then
    insert into public.payout_account_change_requests(
      request_id,idempotency_key,user_id,auth_session_id,bank_code,bank_name,
      account_number,account_name,recipient_code,replacement,
      fresh_sign_in_verified_at,otp_verified_at,account_name_confirmed_at,
      cooling_ends_at,status,bank_account_id,initiated_ip_hash
    ) values(
      p_request_id,p_idempotency_key,p_user_id,p_auth_session_id,p_bank_code,p_bank_name,
      p_account_number,p_account_name,p_recipient_code,v_replacement,
      p_fresh_sign_in_verified_at,p_otp_verified_at,p_account_name_confirmed_at,
      case when v_replacement then now()+interval '24 hours' else now() end,
      case when v_replacement then 'cooling' else 'activation_pending' end,
      v_account_id,p_ip_hash
    ) returning * into v_existing;
  else
    update public.payout_account_change_requests
    set recipient_code=p_recipient_code,bank_account_id=v_account_id,
        status=case when replacement then 'cooling' else 'activation_pending' end,
        error_code=null,error_message=null,updated_at=now()
    where request_id=p_request_id
    returning * into v_existing;
  end if;
  return v_existing;
end
$$;

create or replace function public.activate_due_payout_account_change(
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_request public.payout_account_change_requests;
  v_account public.bank_accounts;
begin
  if (select auth.role())<>'service_role' then raise exception 'service role required'; end if;
  select * into v_request from public.payout_account_change_requests
  where request_id=p_request_id for update;
  if v_request.request_id is null then raise exception 'Payout change not found'; end if;
  if v_request.status='active' then
    select * into v_account from public.bank_accounts
    where id=v_request.bank_account_id;
    return jsonb_build_object('status','active','account',to_jsonb(v_account));
  end if;
  if v_request.status not in ('cooling','activation_pending') then
    raise exception 'Payout change cannot be activated from %',v_request.status;
  end if;
  if now()<v_request.cooling_ends_at then
    return jsonb_build_object(
      'status','cooling','cooling_ends_at',v_request.cooling_ends_at
    );
  end if;
  if v_request.fresh_sign_in_verified_at is null
    or v_request.otp_verified_at is null
    or v_request.account_name_confirmed_at is null then
    raise exception 'Payout verification is incomplete';
  end if;

  perform 1 from public.bank_accounts
  where user_id=v_request.user_id and is_active for update;
  update public.bank_accounts
  set is_default=false,
      deactivated_at=case when id<>v_request.bank_account_id then now() else null end,
      updated_at=now()
  where user_id=v_request.user_id and is_active and is_default;
  update public.bank_accounts
  set is_default=true,is_active=true,activated_at=now(),
      deactivated_at=null,updated_at=now()
  where id=v_request.bank_account_id and user_id=v_request.user_id
  returning * into v_account;
  if v_account.id is null then raise exception 'Verified payout account not found'; end if;

  update public.wallets
  set bank_name=v_account.bank_name,
      bank_account_number=v_account.account_number,
      bank_account_name=v_account.account_name,
      paystack_recipient_code=v_account.paystack_recipient_code,
      updated_at=now()
  where owner_id=v_request.user_id;

  update public.payout_account_change_requests
  set status='active',activated_at=now(),updated_at=now()
  where request_id=p_request_id;

  insert into public.financial_audit_logs(
    event_type,user_id,target_user_id,reference_id,reference_type,
    description,metadata
  ) values(
    'bank_account_change',v_request.user_id,v_request.user_id,
    p_request_id::text,'payout_account_change',
    'Verified payout account activated after required controls',
    jsonb_build_object(
      'bank_account_id',v_account.id,
      'replacement',v_request.replacement,
      'cooling_ends_at',v_request.cooling_ends_at
    )
  );
  return jsonb_build_object('status','active','account',to_jsonb(v_account));
end
$$;

create or replace function public.get_payout_account_change_from_service(
  p_request_id uuid,p_user_id text
)
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select jsonb_build_object(
    'request_id',r.request_id,
    'status',r.status,
    'replacement',r.replacement,
    'cooling_ends_at',r.cooling_ends_at,
    'account_name',r.account_name,
    'bank_name',r.bank_name,
    'account_last4',right(r.account_number,4),
    'error_code',r.error_code,
    'error_message',r.error_message,
    'bank_account_id',r.bank_account_id
  )
  from public.payout_account_change_requests r
  where r.request_id=p_request_id and r.user_id=p_user_id
    and (select auth.role())='service_role'
$$;

revoke all on function public.begin_payout_account_change_from_service(
  uuid,text,text,text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text
) from public,anon,authenticated;
revoke all on function public.activate_due_payout_account_change(uuid)
from public,anon,authenticated;
revoke all on function public.get_payout_account_change_from_service(uuid,text)
from public,anon,authenticated;
grant execute on function public.begin_payout_account_change_from_service(
  uuid,text,text,text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text
) to service_role;
grant execute on function public.activate_due_payout_account_change(uuid)
to service_role;
grant execute on function public.get_payout_account_change_from_service(uuid,text)
to service_role;

comment on table public.payout_account_change_requests
is 'Idempotent fresh-sign-in + OTP + account-name-confirmation flow; replacements cool for 24 hours.';

-- Capture functions created later in this migration as well.
insert into public.function_execution_registry(
  function_signature,function_name,security_mode,public_allowed,anon_allowed,
  authenticated_allowed,service_role_allowed,review_state,rationale,captured_at
)
select
  procedure.oid::regprocedure::text,
  procedure.proname,
  case when procedure.prosecdef then 'definer' else 'invoker' end,
  has_function_privilege('public',procedure.oid,'execute'),
  has_function_privilege('anon',procedure.oid,'execute'),
  has_function_privilege('authenticated',procedure.oid,'execute'),
  has_function_privilege('service_role',procedure.oid,'execute'),
  case
    when procedure.oid in(
      to_regprocedure('public.get_discoverable_hotels()'),
      to_regprocedure('public.get_public_hotel_detail(integer)')
    ) then 'approved_public_projection'
    when not has_function_privilege('anon',procedure.oid,'execute')
      and not has_function_privilege('authenticated',procedure.oid,'execute')
      and has_function_privilege('service_role',procedure.oid,'execute')
      then 'approved_service_only'
    else coalesce(existing.review_state,'requires_review')
  end,
  case
    when procedure.oid in(
      to_regprocedure('public.get_discoverable_hotels()'),
      to_regprocedure('public.get_public_hotel_detail(integer)')
    ) then 'Reviewed redacted Hotel discovery projection'
    else existing.rationale
  end,
  now()
from pg_proc procedure
join pg_namespace namespace on namespace.oid=procedure.pronamespace
left join public.function_execution_registry existing
  on existing.function_signature=procedure.oid::regprocedure::text
where namespace.nspname='public'
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
