-- A new-device password login must prove ownership of the same email with
-- Google before it enters WeHouse. Other signed-in devices are notified only
-- after that succeeds. The notice is an audit/safety action, not an approval
-- request for the new session.

create or replace function public.register_current_device_v2(
  p_device_id text,
  p_device text,
  p_os text,
  p_browser text,
  p_location text default null,
  p_existing_session_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_session_id uuid;
  v_location text := left(coalesce(nullif(btrim(p_location), ''), 'Location unavailable'), 120);
begin
  v_result := public.register_current_device(p_device_id, p_device, p_os, p_browser, p_existing_session_id);
  v_session_id := nullif(v_result ->> 'session_id', '')::uuid;

  if coalesce((v_result ->> 'new_device')::boolean, false) and v_session_id is not null then
    update public.notifications
    set type = 'device_confirmation_pending',
        title = 'New device confirmation in progress',
        message = null,
        read = true,
        read_at = coalesce(read_at, now()),
        destination_route = 'security',
        destination_params = coalesce(destination_params, '{}'::jsonb) || jsonb_build_object(
          'location', v_location,
          'decision', 'awaiting_google'
        )
    where source_id = v_session_id::text
      and recipient_id = public.current_profile_user_id()
      and type = 'new_device_login';
  end if;

  return v_result || jsonb_build_object('location', v_location);
end;
$$;

revoke all on function public.register_current_device_v2(text,text,text,text,text,uuid) from public, anon;
grant execute on function public.register_current_device_v2(text,text,text,text,text,uuid) to authenticated, service_role;

create or replace function public.confirm_current_device_with_google(
  p_session_id uuid,
  p_device_id text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth_id text := (select auth.uid())::text;
  v_user_id text := public.current_profile_user_id();
  v_auth_session_id text := nullif((select auth.jwt() ->> 'session_id'), '');
  v_google_verified boolean := false;
  v_target public.user_sessions%rowtype;
begin
  select exists(
    select 1
    from jsonb_array_elements(coalesce((select auth.jwt() -> 'amr'), '[]'::jsonb)) as method
    where method ->> 'method' = 'oauth'
  ) into v_google_verified;

  if v_auth_id is null or v_user_id is null or v_auth_session_id is null then
    raise exception 'Authentication session is required';
  end if;
  if not v_google_verified then raise exception 'Continue with Google to confirm this login'; end if;

  select * into v_target
  from public.user_sessions
  where id = p_session_id
    and user_id = v_user_id
    and auth_id = v_auth_id
    and device_id = p_device_id
    and trust_status = 'pending'
  for update;
  if not found then raise exception 'Pending device confirmation not found'; end if;

  update public.user_sessions
  set trust_status = 'trusted',
      trust_reviewed_at = now(),
      auth_session_id = v_auth_session_id,
      is_active = true,
      is_current = true,
      last_seen = now()
  where id = v_target.id;

  update public.notifications
  set type = 'new_device_login',
      title = 'New login to your account',
      message = concat_ws(
        ' · ',
        v_target.device,
        v_target.os,
        v_target.browser,
        destination_params ->> 'location'
      ),
      read = false,
      read_at = null,
      destination_route = 'security',
      destination_params = coalesce(destination_params, '{}'::jsonb) || jsonb_build_object(
        'session_id', v_target.id,
        'device', v_target.device,
        'os', v_target.os,
        'browser', v_target.browser,
        'login_time', v_target.login_time,
        'decision', 'unreviewed'
      )
  where recipient_id = v_user_id
    and source_id = v_target.id::text
    and type in ('device_confirmation_pending', 'new_device_login');

  return jsonb_build_object('session_id', v_target.id, 'trust_status', 'trusted');
end;
$$;

revoke all on function public.confirm_current_device_with_google(uuid,text) from public, anon;
grant execute on function public.confirm_current_device_with_google(uuid,text) to authenticated, service_role;

create or replace function public.review_new_device_login(
  p_session_id uuid,
  p_was_me boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth_id text := (select auth.uid())::text;
  v_user_id text := public.current_profile_user_id();
  v_current_auth_session_id text := nullif((select auth.jwt() ->> 'session_id'), '');
  v_current public.user_sessions%rowtype;
  v_target public.user_sessions%rowtype;
begin
  if v_auth_id is null or v_user_id is null or v_current_auth_session_id is null then
    raise exception 'Authentication session is required';
  end if;

  select * into v_current
  from public.user_sessions
  where user_id = v_user_id
    and auth_id = v_auth_id
    and auth_session_id = v_current_auth_session_id
    and is_active = true
    and trust_status = 'trusted'
  limit 1;
  if not found then raise exception 'An active signed-in device is required'; end if;

  select * into v_target
  from public.user_sessions
  where id = p_session_id
    and user_id = v_user_id
    and auth_id = v_auth_id
  for update;
  if not found then raise exception 'Login session not found'; end if;
  if v_target.id = v_current.id or v_target.auth_session_id = v_current_auth_session_id then
    raise exception 'Review this notice from another signed-in device';
  end if;

  if not p_was_me then
    update public.user_sessions
    set trust_status = 'rejected',
        trust_reviewed_at = now(),
        trust_reviewed_by_session_id = v_current.id,
        is_active = false,
        is_current = false,
        logout_time = coalesce(logout_time, now())
    where id = v_target.id;
  end if;

  update public.notifications
  set title = case when p_was_me then 'Login recognized' else 'Unrecognized login ended' end,
      read = true,
      read_at = coalesce(read_at, now()),
      destination_params = coalesce(destination_params, '{}'::jsonb) || jsonb_build_object(
        'decision', case when p_was_me then 'recognized' else 'terminated' end
      )
  where recipient_id = v_user_id
    and type = 'new_device_login'
    and source_id = v_target.id::text;

  return jsonb_build_object(
    'session_id', v_target.id,
    'decision', case when p_was_me then 'recognized' else 'terminated' end
  );
end;
$$;

revoke all on function public.review_new_device_login(uuid,boolean) from public, anon;
grant execute on function public.review_new_device_login(uuid,boolean) to authenticated, service_role;

-- Device management is session termination, never login approval. The caller
-- must own both sessions and must be using another active, trusted session.
create or replace function public.terminate_my_device_session(
  p_session_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth_id text := (select auth.uid())::text;
  v_user_id text := public.current_profile_user_id();
  v_current_auth_session_id text := nullif((select auth.jwt() ->> 'session_id'), '');
  v_current public.user_sessions%rowtype;
  v_target public.user_sessions%rowtype;
begin
  if v_auth_id is null or v_user_id is null or v_current_auth_session_id is null then
    raise exception 'Authentication session is required';
  end if;

  select * into v_current
  from public.user_sessions
  where user_id = v_user_id
    and auth_id = v_auth_id
    and auth_session_id = v_current_auth_session_id
    and is_active = true
    and trust_status = 'trusted'
  limit 1;
  if not found then raise exception 'An active signed-in device is required'; end if;

  select * into v_target
  from public.user_sessions
  where id = p_session_id
    and user_id = v_user_id
    and auth_id = v_auth_id
  for update;
  if not found then raise exception 'Device session not found'; end if;
  if v_target.id = v_current.id or v_target.auth_session_id = v_current_auth_session_id then
    raise exception 'Use Log out to end this device session';
  end if;

  update public.user_sessions
  set is_active = false,
      is_current = false,
      logout_time = coalesce(logout_time, now()),
      trust_reviewed_at = now(),
      trust_reviewed_by_session_id = v_current.id
  where id = v_target.id;

  update public.notifications
  set read = true,
      read_at = coalesce(read_at, now()),
      destination_params = coalesce(destination_params, '{}'::jsonb) || jsonb_build_object('decision', 'signed_out')
  where recipient_id = v_user_id
    and type = 'new_device_login'
    and source_id = v_target.id::text;

  return jsonb_build_object('session_id', v_target.id, 'decision', 'signed_out');
end;
$$;

revoke all on function public.terminate_my_device_session(uuid) from public, anon;
grant execute on function public.terminate_my_device_session(uuid) to authenticated, service_role;

-- Retire the previous cross-device approval API so future UI cannot recreate
-- the incorrect "another device must approve this login" flow.
revoke execute on function public.respond_to_device_login(uuid,boolean) from public, anon, authenticated;
