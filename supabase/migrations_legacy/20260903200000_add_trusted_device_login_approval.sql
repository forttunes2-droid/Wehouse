-- Add a Telegram-style new-device acknowledgement to the existing WeHouse
-- session model. Existing sessions remain trusted; only sessions registered
-- through the new function can begin as pending.

alter table public.user_sessions
  add column if not exists device_id text,
  add column if not exists auth_session_id text,
  add column if not exists trust_status text not null default 'trusted',
  add column if not exists trust_reviewed_at timestamptz,
  add column if not exists trust_reviewed_by_session_id uuid references public.user_sessions(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_sessions_trust_status_check'
      and conrelid = 'public.user_sessions'::regclass
  ) then
    alter table public.user_sessions
      add constraint user_sessions_trust_status_check
      check (trust_status in ('pending', 'trusted', 'rejected'));
  end if;
end;
$$;

create unique index if not exists user_sessions_auth_session_unique
  on public.user_sessions(auth_session_id)
  where auth_session_id is not null;

create index if not exists user_sessions_device_trust_idx
  on public.user_sessions(user_id, device_id, trust_status);

create or replace function public.register_current_device(
  p_device_id text,
  p_device text,
  p_os text,
  p_browser text,
  p_existing_session_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.respond_to_device_login(
  p_session_id uuid,
  p_approved boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth_id text := (select auth.uid())::text;
  v_user_id text;
  v_current_auth_session_id text := nullif((select auth.jwt() ->> 'session_id'), '');
  v_current public.user_sessions%rowtype;
  v_target public.user_sessions%rowtype;
  v_status text := case when p_approved then 'trusted' else 'rejected' end;
begin
  if v_auth_id is null or v_current_auth_session_id is null then
    raise exception 'Authentication session is required';
  end if;
  v_user_id := public.current_profile_user_id();

  select * into v_current
  from public.user_sessions
  where user_id = v_user_id
    and auth_id = v_auth_id
    and auth_session_id = v_current_auth_session_id
    and is_active = true
    and trust_status = 'trusted'
  limit 1;
  if not found then
    raise exception 'Use another trusted device to review this login';
  end if;

  select * into v_target
  from public.user_sessions
  where id = p_session_id
    and user_id = v_user_id
    and auth_id = v_auth_id
  for update;
  if not found then raise exception 'Device login not found'; end if;
  if v_target.id = v_current.id or v_target.auth_session_id = v_current_auth_session_id then
    raise exception 'A new device cannot approve itself';
  end if;
  if v_target.trust_status <> 'pending' then
    return jsonb_build_object('session_id', v_target.id, 'trust_status', v_target.trust_status);
  end if;

  update public.user_sessions
  set trust_status = v_status,
      trust_reviewed_at = now(),
      trust_reviewed_by_session_id = v_current.id,
      is_active = case when p_approved then is_active else false end,
      is_current = case when p_approved then is_current else false end,
      logout_time = case when p_approved then logout_time else now() end
  where id = v_target.id;

  update public.notifications
  set read = true, read_at = coalesce(read_at, now())
  where recipient_id = v_user_id
    and type = 'new_device_login'
    and source_id = v_target.id::text;

  return jsonb_build_object('session_id', v_target.id, 'trust_status', v_status);
end;
$$;

revoke all on function public.register_current_device(text, text, text, text, uuid) from public, anon;
grant execute on function public.register_current_device(text, text, text, text, uuid) to authenticated;
revoke all on function public.respond_to_device_login(uuid, boolean) from public, anon;
grant execute on function public.respond_to_device_login(uuid, boolean) to authenticated;

