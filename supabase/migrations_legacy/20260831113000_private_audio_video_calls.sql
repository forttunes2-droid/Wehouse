alter table public.private_call_preferences
  alter column allow_video_calls set default true;

create or replace function public.get_private_call_capabilities(
  p_context_type text,
  p_context_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me text := public.current_profile_user_id();
  v_peer text;
  v_profile public.profiles;
  v_pref public.private_call_preferences;
begin
  if v_me is null then raise exception 'Authenticated profile required'; end if;
  if p_context_type = 'roommate' then
    select case when c.participant_a = v_me then c.participant_b else c.participant_a end
      into v_peer
    from public.conversations c
    where c.id = p_context_id
      and c.conversation_type = 'roommate'
      and v_me in (c.participant_a, c.participant_b)
    limit 1;
  elsif p_context_type = 'worker_booking' then
    select case when c.user_id = v_me then c.worker_id else c.user_id end
      into v_peer
    from public.booking_conversations c
    where c.id = p_context_id and v_me in (c.user_id, c.worker_id)
    limit 1;
  else
    raise exception 'Unsupported call context';
  end if;
  if v_peer is null then raise exception 'Private conversation not found'; end if;
  select * into v_profile from public.profiles
    where user_id = v_peer and not coalesce(deleted, false)
      and not coalesce(suspended, false) and not coalesce(banned, false)
    limit 1;
  if v_profile is null or v_profile.role not in ('user', 'worker') then
    raise exception 'This person cannot receive private calls';
  end if;
  select * into v_pref from public.private_call_preferences where user_id = v_peer;
  return jsonb_build_object(
    'peer_id', v_peer,
    'peer_name', coalesce(v_profile.full_name, v_profile.username, 'WeHouse member'),
    'peer_avatar', v_profile.avatar_url,
    'allow_audio_calls', coalesce(v_pref.allow_audio_calls, true),
    'allow_video_calls', coalesce(v_pref.allow_video_calls, true)
  );
end;
$function$;

create or replace function public.get_my_private_call_preferences()
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_me text := public.current_profile_user_id(); v_pref public.private_call_preferences;
begin
  if v_me is null then raise exception 'Authenticated profile required'; end if;
  select * into v_pref from public.private_call_preferences where user_id = v_me;
  return jsonb_build_object(
    'allow_audio_calls', coalesce(v_pref.allow_audio_calls, true),
    'allow_video_calls', coalesce(v_pref.allow_video_calls, true)
  );
end;
$function$;

create or replace function public.start_private_call(
  p_context_type text,
  p_context_id uuid,
  p_call_type text
) returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_me text := public.current_profile_user_id();
  v_cap jsonb;
  v_peer text;
  v_call public.private_calls;
begin
  if v_me is null then raise exception 'Authenticated profile required'; end if;
  if p_call_type not in ('audio', 'video') then raise exception 'Invalid call type'; end if;
  v_cap := public.get_private_call_capabilities(p_context_type, p_context_id);
  v_peer := v_cap ->> 'peer_id';
  if p_call_type = 'audio' and not coalesce((v_cap ->> 'allow_audio_calls')::boolean, false) then
    raise exception 'This person is not accepting audio calls';
  end if;
  if p_call_type = 'video' and not coalesce((v_cap ->> 'allow_video_calls')::boolean, false) then
    raise exception 'This person is not accepting video calls';
  end if;
  if exists (
    select 1 from public.private_calls c
    where c.status in ('ringing', 'accepted')
      and (v_me in (c.caller_id, c.callee_id) or v_peer in (c.caller_id, c.callee_id))
  ) then raise exception 'One of you is already in a call'; end if;
  insert into public.private_calls(context_type, context_id, caller_id, callee_id, call_type, status)
  values (p_context_type, p_context_id, v_me, v_peer, p_call_type, 'ringing')
  returning * into v_call;
  return to_jsonb(v_call) || jsonb_build_object(
    'peer_name', v_cap ->> 'peer_name',
    'peer_avatar', v_cap ->> 'peer_avatar'
  );
end;
$function$;

create or replace function public.notify_missed_private_call()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.status = 'missed' and old.status is distinct from 'missed' then
    insert into public.notifications(
      recipient_id, type, title, message, related_id, read,
      source_type, source_id, destination_route, destination_params, event_key
    )
    select new.callee_id, 'missed_call',
      'Missed ' || new.call_type || ' call',
      'You missed a ' || new.call_type || ' call. Open the conversation to call back.',
      new.id::text, false, new.context_type, new.context_id,
      'messages', jsonb_build_object('contextType', new.context_type, 'contextId', new.context_id),
      'missed_call:' || new.id::text
    where not exists (
      select 1 from public.notifications n
      where n.recipient_id = new.callee_id and n.event_key = 'missed_call:' || new.id::text
    );
  end if;
  return new;
end;
$function$;

revoke all on function public.start_private_call(text, uuid, text) from public, anon;
grant execute on function public.start_private_call(text, uuid, text) to authenticated, service_role;
revoke all on function public.get_private_call_capabilities(text, uuid) from public, anon;
grant execute on function public.get_private_call_capabilities(text, uuid) to authenticated, service_role;
revoke all on function public.get_my_private_call_preferences() from public, anon;
grant execute on function public.get_my_private_call_preferences() to authenticated, service_role;
