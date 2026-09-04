-- The active-session reader only needs the caller's existing owner-read RLS.
-- Keep it security-invoker so the API cannot bypass those table policies.
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
security invoker
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
