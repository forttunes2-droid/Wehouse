-- Keep audit history, but expose exactly one active login per physical device.
-- A fresh auth session replaces the previous active row for that device instead
-- of making Security look as though signed-out history is still connected.

with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, device_id
      order by coalesce(last_seen, login_time) desc, login_time desc, id desc
    ) as position
  from public.user_sessions
  where is_active = true
    and device_id is not null
)
update public.user_sessions as session
set is_active = false,
    is_current = false,
    logout_time = coalesce(session.logout_time, now())
from ranked
where ranked.id = session.id
  and ranked.position > 1;

create or replace function public.replace_active_device_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_active and new.device_id is not null then
    update public.user_sessions
    set is_active = false,
        is_current = false,
        logout_time = coalesce(logout_time, now())
    where user_id = new.user_id
      and device_id = new.device_id
      and is_active = true
      and id <> new.id;

    update public.notifications
    set read = true,
        read_at = coalesce(read_at, now()),
        destination_params = coalesce(destination_params, '{}'::jsonb)
          || jsonb_build_object('decision', 'replaced_by_new_session')
    where recipient_id = new.user_id
      and type = 'new_device_login'
      and read = false
      and source_id in (
        select id::text
        from public.user_sessions
        where user_id = new.user_id
          and device_id = new.device_id
          and is_active = false
          and id <> new.id
      );
  end if;
  return new;
end;
$$;

revoke all on function public.replace_active_device_session() from public, anon, authenticated;

drop trigger if exists replace_active_device_session_before_insert on public.user_sessions;
create trigger replace_active_device_session_before_insert
before insert on public.user_sessions
for each row execute function public.replace_active_device_session();

create unique index if not exists user_sessions_one_active_device_idx
on public.user_sessions(user_id, device_id)
where is_active = true and device_id is not null;

create or replace function public.get_my_active_device_sessions()
returns table (
  id uuid,
  device text,
  browser text,
  os text,
  ip_address text,
  is_current boolean,
  login_time timestamptz,
  last_seen timestamptz,
  trust_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    session.id,
    session.device,
    session.browser,
    session.os,
    session.ip_address,
    session.auth_session_id = nullif((select auth.jwt() ->> 'session_id'), '') as is_current,
    session.login_time,
    session.last_seen,
    session.trust_status
  from public.user_sessions as session
  where session.user_id = public.current_profile_user_id()
    and session.auth_id = (select auth.uid())::text
    and session.is_active = true
    and session.trust_status = 'trusted'
  order by
    (session.auth_session_id = nullif((select auth.jwt() ->> 'session_id'), '')) desc,
    coalesce(session.last_seen, session.login_time) desc;
$$;

revoke all on function public.get_my_active_device_sessions() from public, anon;
grant execute on function public.get_my_active_device_sessions() to authenticated, service_role;
