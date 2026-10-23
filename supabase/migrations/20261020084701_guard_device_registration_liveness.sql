begin;
CREATE OR REPLACE FUNCTION public.register_current_device(p_device_id text, p_device text, p_os text, p_browser text, p_existing_session_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_auth_id text := (select auth.uid())::text;
  v_user_id text;
  v_auth_session_id text := nullif((select auth.jwt() ->> 'session_id'), '');
  v_row public.user_sessions%rowtype;
  v_has_trusted_device boolean := false;
  v_has_any_trusted_device boolean := false;
  v_status text;
  v_new_device boolean;
begin
  if v_auth_id is null or v_auth_session_id is null then
    raise exception 'Authentication session is required';
  end if;
  if p_device_id is null or length(trim(p_device_id)) < 16 or length(p_device_id) > 128 then
    raise exception 'A valid device identifier is required';
  end if;

  if not public.auth_session_is_active(v_auth_id::uuid, v_auth_session_id::uuid) then
    raise exception 'Sign in again to confirm this device';
  end if;

  v_user_id := public.current_profile_user_id();
  if v_user_id is null then raise exception 'WeHouse profile not found'; end if;

  select * into v_row
  from public.user_sessions
  where auth_session_id = v_auth_session_id
    and user_id = v_user_id
    and auth_id = v_auth_id
  limit 1;

  if found then
    update public.user_sessions
    set last_seen = now(),
        device_id = p_device_id,
        device = left(coalesce(nullif(trim(p_device), ''), 'Device'), 120),
        os = left(coalesce(nullif(trim(p_os), ''), 'Unknown'), 120),
        browser = left(coalesce(nullif(trim(p_browser), ''), 'Unknown'), 120)
    where id = v_row.id
    returning * into v_row;
    return jsonb_build_object(
      'session_id', v_row.id,
      'trust_status', v_row.trust_status,
      'new_device', false
    );
  end if;

  if p_existing_session_id is not null then
    select * into v_row
    from public.user_sessions
    where id = p_existing_session_id
      and user_id = v_user_id
      and auth_id = v_auth_id
      and is_active = true
      and auth_session_id is null
    limit 1;

    if found then
      update public.user_sessions
      set auth_session_id = v_auth_session_id,
          device_id = p_device_id,
          trust_status = 'trusted',
          last_seen = now(),
          device = left(coalesce(nullif(trim(p_device), ''), 'Device'), 120),
          os = left(coalesce(nullif(trim(p_os), ''), 'Unknown'), 120),
          browser = left(coalesce(nullif(trim(p_browser), ''), 'Unknown'), 120)
      where id = v_row.id
      returning * into v_row;
      return jsonb_build_object(
        'session_id', v_row.id,
        'trust_status', 'trusted',
        'new_device', false
      );
    end if;
  end if;

  select exists(
    select 1 from public.user_sessions
    where user_id = v_user_id
      and device_id = p_device_id
      and trust_status = 'trusted'
  ) into v_has_trusted_device;

  select exists(
    select 1 from public.user_sessions
    where user_id = v_user_id
      and trust_status = 'trusted'
  ) into v_has_any_trusted_device;

  v_new_device := v_has_any_trusted_device and not v_has_trusted_device;
  v_status := case when v_new_device then 'pending' else 'trusted' end;

  insert into public.user_sessions(
    user_id, auth_id, device_id, auth_session_id, device, os, browser,
    is_active, is_current, last_seen, trust_status
  ) values (
    v_user_id, v_auth_id, p_device_id, v_auth_session_id,
    left(coalesce(nullif(trim(p_device), ''), 'Device'), 120),
    left(coalesce(nullif(trim(p_os), ''), 'Unknown'), 120),
    left(coalesce(nullif(trim(p_browser), ''), 'Unknown'), 120),
    true, true, now(), v_status
  ) returning * into v_row;

  if v_status = 'pending' then
    insert into public.notifications(
      recipient_id, type, title, message, related_id, source_type, source_id,
      destination_route, destination_params, event_key
    )
    select
      v_user_id,
      'new_device_login',
      'New device signed in',
      concat_ws(' · ', v_row.device, v_row.os, v_row.browser),
      v_row.id::text,
      'security',
      v_row.id::text,
      'security',
      jsonb_build_object(
        'session_id', v_row.id,
        'device', v_row.device,
        'os', v_row.os,
        'browser', v_row.browser,
        'login_time', v_row.login_time
      ),
      'new_device_login:' || v_row.id::text
    where not exists (
      select 1 from public.notifications
      where event_key = 'new_device_login:' || v_row.id::text
    );
  end if;

  return jsonb_build_object(
    'session_id', v_row.id,
    'trust_status', v_status,
    'new_device', v_new_device
  );
end;
$function$;
commit;
