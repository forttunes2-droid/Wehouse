begin;

-- One shared throttle for authenticated actions (payment start, withdrawal,
-- payout-account change, address lookup). It is keyed by user and action, so a
-- loop or abusive client cannot flood the database with writes or the payment
-- provider with calls, while ordinary use is never affected.
create table if not exists public.user_action_rate_limits(
  user_key text not null check(length(user_key) between 1 and 80),
  action text not null check(action ~ '^[a-z0-9_]{2,60}$'),
  window_started_at timestamptz not null default now(),
  attempt_count integer not null default 1 check(attempt_count>0),
  updated_at timestamptz not null default now(),
  primary key(user_key,action)
);

create index if not exists user_action_rate_limits_updated_idx
  on public.user_action_rate_limits(updated_at);

alter table public.user_action_rate_limits enable row level security;
revoke all on table public.user_action_rate_limits from public,anon,authenticated;
grant all on table public.user_action_rate_limits to service_role;

create or replace function public.consume_user_action_from_service(
  p_user_key text,
  p_action text,
  p_max_attempts integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_row public.user_action_rate_limits;
  v_window interval;
begin
  if (select auth.role())<>'service_role' then
    raise exception 'service role required';
  end if;
  if coalesce(p_max_attempts,0) < 1 or coalesce(p_window_seconds,0) < 1
     or p_window_seconds > 86400 then
    raise exception 'Invalid rate limit settings';
  end if;
  v_window:=make_interval(secs=>p_window_seconds);

  insert into public.user_action_rate_limits as l(
    user_key,action,window_started_at,attempt_count,updated_at
  ) values(p_user_key,p_action,now(),1,now())
  on conflict(user_key,action) do update set
    window_started_at=case
      when l.window_started_at<=now()-v_window then now()
      else l.window_started_at end,
    attempt_count=case
      when l.window_started_at<=now()-v_window then 1
      else l.attempt_count+1 end,
    updated_at=now()
  returning * into v_row;

  return jsonb_build_object(
    'allowed',v_row.attempt_count<=p_max_attempts,
    'retry_after_seconds',case when v_row.attempt_count<=p_max_attempts then 0
      else greatest(1,ceil(extract(epoch from
        (v_row.window_started_at+v_window-now())))::integer) end
  );
end;
$$;

revoke all on function public.consume_user_action_from_service(text,text,integer,integer)
from public,anon,authenticated;
grant execute on function public.consume_user_action_from_service(text,text,integer,integer)
to service_role;

comment on function public.consume_user_action_from_service(text,text,integer,integer) is
  'Service-only fixed-window throttle for authenticated actions, keyed by user and action.';

-- Old windows carry no information; this keeps the table small.
create or replace function public.purge_user_action_rate_limits_from_service()
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_count integer;
begin
  if (select auth.role())<>'service_role' then
    raise exception 'service role required';
  end if;
  delete from public.user_action_rate_limits where updated_at<now()-interval '2 days';
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;
revoke all on function public.purge_user_action_rate_limits_from_service() from public,anon,authenticated;
grant execute on function public.purge_user_action_rate_limits_from_service() to service_role;

commit;
