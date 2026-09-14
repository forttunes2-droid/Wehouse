begin;

-- The username-to-email login bridge is intentionally public.  Throttle it by
-- a one-way network/client fingerprint before the service-role lookup occurs.
-- This complements Supabase Auth rate limits without creating a target-account
-- lockout that an attacker could use for denial of service.
create table if not exists public.public_login_rate_limits(
  fingerprint_hash text primary key
    check(fingerprint_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null default now(),
  attempt_count integer not null default 1 check(attempt_count>0),
  updated_at timestamptz not null default now()
);

alter table public.public_login_rate_limits enable row level security;
revoke all on table public.public_login_rate_limits
from public,anon,authenticated;
grant all on table public.public_login_rate_limits to service_role;

create or replace function public.consume_public_password_login_attempt_from_service(
  p_fingerprint_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_row public.public_login_rate_limits;
  v_window interval:=interval '15 minutes';
  v_max_attempts integer:=12;
begin
  if (select auth.role())<>'service_role' then
    raise exception 'service role required';
  end if;
  if coalesce(p_fingerprint_hash,'') !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid login fingerprint';
  end if;

  insert into public.public_login_rate_limits(
    fingerprint_hash,window_started_at,attempt_count,updated_at
  ) values(p_fingerprint_hash,now(),1,now())
  on conflict(fingerprint_hash) do update set
    window_started_at=case
      when public.public_login_rate_limits.window_started_at<=now()-v_window
      then now() else public.public_login_rate_limits.window_started_at end,
    attempt_count=case
      when public.public_login_rate_limits.window_started_at<=now()-v_window
      then 1 else public.public_login_rate_limits.attempt_count+1 end,
    updated_at=now()
  returning * into v_row;

  return jsonb_build_object(
    'allowed',v_row.attempt_count<=v_max_attempts,
    'retry_after_seconds',case when v_row.attempt_count<=v_max_attempts then 0
      else greatest(1,ceil(extract(epoch from
        (v_row.window_started_at+v_window-now())))::integer) end
  );
end;
$$;

revoke all on function public.consume_public_password_login_attempt_from_service(text)
from public,anon,authenticated;
grant execute on function public.consume_public_password_login_attempt_from_service(text)
to service_role;

comment on function public.consume_public_password_login_attempt_from_service(text) is
  'Service-only, non-enumerating throttle for the public username/password login bridge.';

commit;
