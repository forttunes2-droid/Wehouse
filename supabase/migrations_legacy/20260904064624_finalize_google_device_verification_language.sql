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
    set title = 'New device needs verification',
        message = concat_ws(' · ', p_device, p_os, p_browser, v_location),
        destination_route = 'security',
        destination_params = coalesce(destination_params, '{}'::jsonb) || jsonb_build_object(
          'location', v_location,
          'decision', 'pending'
        )
    where type = 'new_device_login'
      and source_id = v_session_id::text
      and recipient_id = public.current_profile_user_id();
  end if;
  return v_result || jsonb_build_object('location', v_location);
end;
$$;

revoke all on function public.register_current_device_v2(text,text,text,text,text,uuid) from public;
revoke all on function public.register_current_device_v2(text,text,text,text,text,uuid) from anon;
grant execute on function public.register_current_device_v2(text,text,text,text,text,uuid) to authenticated;
grant execute on function public.register_current_device_v2(text,text,text,text,text,uuid) to service_role;

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
  if not v_google_verified then raise exception 'Continue with Google is required'; end if;

  select * into v_target
  from public.user_sessions
  where id = p_session_id
    and user_id = v_user_id
    and auth_id = v_auth_id
    and device_id = p_device_id
    and trust_status = 'pending'
  for update;
  if not found then raise exception 'Pending device verification not found'; end if;

  update public.user_sessions
  set trust_status = 'trusted', trust_reviewed_at = now(), auth_session_id = v_auth_session_id,
      is_active = true, is_current = true, last_seen = now()
  where id = v_target.id;

  update public.notifications
  set title = 'New device verified', read = true, read_at = coalesce(read_at, now()),
      destination_route = 'security',
      destination_params = coalesce(destination_params, '{}'::jsonb) || jsonb_build_object('decision', 'verified_with_google')
  where recipient_id = v_user_id and type = 'new_device_login' and source_id = v_target.id::text;

  return jsonb_build_object('session_id', v_target.id, 'trust_status', 'trusted');
end;
$$;

revoke all on function public.confirm_current_device_with_google(uuid,text) from public;
revoke all on function public.confirm_current_device_with_google(uuid,text) from anon;
grant execute on function public.confirm_current_device_with_google(uuid,text) to authenticated;
grant execute on function public.confirm_current_device_with_google(uuid,text) to service_role;

create or replace function public.verify_google_password_recovery()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_auth_id text := (select auth.uid())::text;
  v_email text := lower(nullif(btrim((select auth.jwt() ->> 'email')), ''));
  v_google_verified boolean := false;
begin
  select exists(
    select 1
    from jsonb_array_elements(coalesce((select auth.jwt() -> 'amr'), '[]'::jsonb)) as method
    where method ->> 'method' = 'oauth'
  ) into v_google_verified;

  if v_auth_id is null or v_email is null or not v_google_verified then
    raise exception 'Continue with Google is required';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.auth_id = v_auth_id
      and lower(p.email) = v_email
      and not coalesce(p.deleted, false)
  ) then
    raise exception 'Matching WeHouse account not found';
  end if;

  return jsonb_build_object('success', true, 'email', v_email);
end;
$$;

revoke all on function public.verify_google_password_recovery() from public;
revoke all on function public.verify_google_password_recovery() from anon;
grant execute on function public.verify_google_password_recovery() to authenticated;
grant execute on function public.verify_google_password_recovery() to service_role;
