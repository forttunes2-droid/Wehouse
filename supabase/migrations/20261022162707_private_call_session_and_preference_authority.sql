-- Bind private media calls to live trusted devices; preserve call history.
alter table public.private_calls
 add column caller_session_id uuid,
 add column callee_session_id uuid,
 add column caller_last_seen_at timestamptz,
 add column callee_last_seen_at timestamptz;

create or replace function private.private_call_actor()
returns text language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor public.profiles;
begin
 if not public._property_document_session_active() then raise exception 'Active trusted session required'; end if;
 actor:=public._current_comm_actor();
 if actor.user_id is null or not (actor.account_kind='consumer' or public.user_has_active_workspace(actor.user_id,'worker')) then
  raise exception 'Personal or Services workspace required';
 end if;
 return actor.user_id;
end; $$;
revoke all on function private.private_call_actor() from public,anon,authenticated,service_role;

create or replace function private.private_call_session_live(p_user text,p_session uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select p_session is not null and exists(
 select 1 from public.profiles p join public.user_sessions d on d.user_id=p.user_id
 where p.user_id=p_user and not coalesce(p.deleted,false) and not coalesce(p.suspended,false)
 and not coalesce(p.banned,false) and d.auth_id=p.auth_id::text
 and d.auth_session_id=p_session::text and d.is_active and d.trust_status='trusted'
 and public.auth_session_is_active(p.auth_id::uuid,p_session));
$$;
revoke all on function private.private_call_session_live(text,uuid) from public,anon,authenticated,service_role;

create or replace function private.expire_private_calls(p_user text)
returns void language sql security definer set search_path=pg_catalog,public as $$
 update public.private_calls c set status=case when status='ringing' then 'missed' else 'ended' end,ended_at=now()
 where p_user in(c.caller_id,c.callee_id) and status in('ringing','accepted') and
 ((status='ringing' and created_at<now()-interval '45 seconds')
 or not private.private_call_session_live(caller_id,caller_session_id)
 or (status='accepted' and (not private.private_call_session_live(callee_id,callee_session_id)
 or least(caller_last_seen_at,callee_last_seen_at)<now()-interval '120 seconds')));
$$;
revoke all on function private.expire_private_calls(text) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.get_my_private_call_preferences()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_me text := private.private_call_actor(); v_pref public.private_call_preferences;
begin
  if v_me is null then raise exception 'Authenticated profile required'; end if;
  select * into v_pref from public.private_call_preferences where user_id = v_me;
  return jsonb_build_object(
    'allow_audio_calls', coalesce(v_pref.allow_audio_calls, true),
    'allow_video_calls', coalesce(v_pref.allow_video_calls, true)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_my_private_call_preferences(p_allow_audio boolean, p_allow_video boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_me text:=private.private_call_actor(); 
begin
 if p_allow_audio is null or p_allow_video is null then raise exception 'Both call preferences are required'; end if;
 insert into public.private_call_preferences(user_id,allow_audio_calls,allow_video_calls,updated_at) values(v_me,coalesce(p_allow_audio,true),coalesce(p_allow_video,false),now()) on conflict(user_id) do update set allow_audio_calls=excluded.allow_audio_calls,allow_video_calls=excluded.allow_video_calls,updated_at=now();
 return public.get_my_private_call_preferences();
end; $function$;

CREATE OR REPLACE FUNCTION public.get_private_call_capabilities(p_context_type text, p_context_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_me text:=private.private_call_actor();
  v_peer text;
  v_profile public.profiles;
  v_pref public.private_call_preferences;
begin
  if v_me is null then raise exception 'Authenticated profile required'; end if;
  if p_context_type='roommate' then
    select case when conversation.participant_a=v_me then conversation.participant_b else conversation.participant_a end
    into v_peer
    from public.conversations conversation
    where conversation.id=p_context_id
      and conversation.conversation_type='roommate'
      and coalesce(conversation.status,'active')='active'
      and v_me in (conversation.participant_a,conversation.participant_b)
    limit 1;
    if exists(
      select 1 from public.roommate_user_blocks block_row
      where (block_row.blocker_user_id=v_me and block_row.blocked_user_id=v_peer)
         or (block_row.blocker_user_id=v_peer and block_row.blocked_user_id=v_me)
    ) then raise exception 'This roommate connection is blocked'; end if;
  elsif p_context_type='worker_booking' then
    select case when conversation.user_id=v_me then conversation.worker_id else conversation.user_id end
    into v_peer
    from public.booking_conversations conversation
    join public.worker_bookings booking on booking.id=conversation.booking_id
    where conversation.id=p_context_id
      and v_me in (conversation.user_id,conversation.worker_id)
      and booking.user_id=conversation.user_id and booking.worker_id=conversation.worker_id
      and public.user_has_active_workspace(conversation.worker_id,'worker')
      and booking.status not in ('approved_released','completed','cancelled','refunded')
    limit 1;
    if exists(
      select 1 from public.worker_user_blocks block_row
      where (block_row.blocker_user_id=v_me and block_row.blocked_user_id=v_peer)
         or (block_row.blocker_user_id=v_peer and block_row.blocked_user_id=v_me)
    ) then raise exception 'This service conversation is blocked'; end if;
  else
    raise exception 'Unsupported call context';
  end if;
  if v_peer is null then raise exception 'This job conversation is closed'; end if;
  select * into v_profile from public.profiles
  where user_id=v_peer and not coalesce(deleted,false)
    and not coalesce(suspended,false) and not coalesce(banned,false)
  limit 1;
  if v_profile is null or not(v_profile.account_kind='consumer' or public.user_has_active_workspace(v_peer,'worker')) then
    raise exception 'This person cannot receive private calls';
  end if;
  select * into v_pref from public.private_call_preferences where user_id=v_peer;
  return jsonb_build_object(
    'peer_id',v_peer,
    'peer_name',coalesce(v_profile.full_name,v_profile.username,'WeHouse member'),
    'peer_avatar',v_profile.avatar_url,
    'allow_audio_calls',coalesce(v_pref.allow_audio_calls,true),
    'allow_video_calls',coalesce(v_pref.allow_video_calls,true)
  );
end;
$function$;

create or replace function public.can_access_private_call(p_call_id uuid,p_signals boolean default false)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare me text; c public.private_calls; sid uuid;
begin
 me:=private.private_call_actor(); sid:=(auth.jwt()->>'session_id')::uuid;
 select * into c from public.private_calls where id=p_call_id;
 if c.id is null or me not in(c.caller_id,c.callee_id) then return false; end if;
 if c.status not in('ringing','accepted') then return not p_signals; end if;
 if (me=c.caller_id and c.caller_session_id is distinct from sid)
 or (me=c.callee_id and c.status='accepted' and c.callee_session_id is distinct from sid)
 or (p_signals and me=c.callee_id and c.status='ringing') then return false; end if;
 if not private.private_call_session_live(c.caller_id,c.caller_session_id)
 or (c.status='ringing' and c.created_at<now()-interval '45 seconds')
 or (c.status='accepted' and (not private.private_call_session_live(c.callee_id,c.callee_session_id)
 or least(c.caller_last_seen_at,c.callee_last_seen_at)<now()-interval '120 seconds')) then return false; end if;
 perform public.get_private_call_capabilities(c.context_type,c.context_id);
 return true;
exception when others then return false;
end; $$;

CREATE OR REPLACE FUNCTION public.get_private_call_details(p_call_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_me text:=private.private_call_actor(); v_call public.private_calls; v_peer text; v_profile public.profiles;
begin
 if not public.can_access_private_call(p_call_id,false) then raise exception 'Call not available on this device'; end if;
 select * into v_call from public.private_calls where id=p_call_id and v_me in (caller_id,callee_id) limit 1;
 if v_call is null then raise exception 'Call not found'; end if;
 v_peer:=case when v_call.caller_id=v_me then v_call.callee_id else v_call.caller_id end;
 select * into v_profile from public.profiles where user_id=v_peer limit 1;
 return to_jsonb(v_call)||jsonb_build_object('peer_id',v_peer,'peer_name',coalesce(v_profile.full_name,v_profile.username,'WeHouse member'),'peer_avatar',v_profile.avatar_url,'incoming',v_call.callee_id=v_me);
end; $function$;
CREATE OR REPLACE FUNCTION public.start_private_call(p_context_type text, p_context_id uuid, p_call_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me text := private.private_call_actor();
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
  -- A shared participant serializes all simultaneous starts, including opposite directions.
  perform p.user_id from public.profiles p where p.user_id in(v_me,v_peer) order by p.user_id for update;
  v_cap:=public.get_private_call_capabilities(p_context_type,p_context_id);
  if not coalesce((v_cap->>case when p_call_type='audio' then 'allow_audio_calls' else 'allow_video_calls' end)::boolean,false) then raise exception 'This person is not accepting this call'; end if;
  perform private.expire_private_calls(v_me); perform private.expire_private_calls(v_peer);
  if exists (
    select 1 from public.private_calls c
    where c.status in ('ringing', 'accepted')
      and (v_me in (c.caller_id, c.callee_id) or v_peer in (c.caller_id, c.callee_id))
  ) then raise exception 'One of you is already in a call'; end if;
  insert into public.private_calls(context_type, context_id, caller_id, callee_id, call_type, status,caller_session_id,caller_last_seen_at)
  values (p_context_type, p_context_id, v_me, v_peer, p_call_type, 'ringing',(auth.jwt()->>'session_id')::uuid,now())
  returning * into v_call;
  return to_jsonb(v_call) || jsonb_build_object(
    'peer_name', v_cap ->> 'peer_name',
    'peer_avatar', v_cap ->> 'peer_avatar'
  );
end;
$function$;

create or replace function public.respond_private_call(p_call_id uuid,p_accept boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare me text:=private.private_call_actor(); c public.private_calls; pref jsonb; cap jsonb;
begin
 perform private.expire_private_calls(me);
 select * into c from public.private_calls where id=p_call_id for update;
 if c.id is null or c.callee_id<>me then raise exception 'Incoming call not found'; end if;
 if c.status<>'ringing' then return public.get_private_call_details(p_call_id); end if;
 if p_accept is null then raise exception 'Call response required'; end if;
 if p_accept then
  cap:=public.get_private_call_capabilities(c.context_type,c.context_id);
  pref:=public.get_my_private_call_preferences();
  if not coalesce((pref->>case when c.call_type='audio' then 'allow_audio_calls' else 'allow_video_calls' end)::boolean,false)
  then raise exception 'Incoming calls are disabled'; end if;
 end if;
 update public.private_calls set status=case when p_accept then 'accepted' else 'declined' end,
 answered_at=case when p_accept then now() end,ended_at=case when not p_accept then now() end,
 callee_session_id=case when p_accept then (auth.jwt()->>'session_id')::uuid end,
 callee_last_seen_at=case when p_accept then now() end,caller_last_seen_at=case when p_accept then now() else caller_last_seen_at end
 where id=p_call_id;
 return public.get_private_call_details(p_call_id);
end; $$;

create or replace function public.get_my_active_private_calls()
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare me text:=private.private_call_actor(); sid uuid:=(auth.jwt()->>'session_id')::uuid; result jsonb;
begin
 perform private.expire_private_calls(me);
 update public.private_calls c set
 caller_last_seen_at=case when c.caller_id=me then now() else c.caller_last_seen_at end,
 callee_last_seen_at=case when c.callee_id=me then now() else c.callee_last_seen_at end
 where c.status in('ringing','accepted') and public.can_access_private_call(c.id,false)
 and ((c.caller_id=me and c.caller_session_id=sid and c.caller_last_seen_at<now()-interval '30 seconds')
 or (c.callee_id=me and c.callee_session_id=sid and c.callee_last_seen_at<now()-interval '30 seconds'));
 select coalesce(jsonb_agg(public.get_private_call_details(c.id) order by c.created_at desc),'[]'::jsonb) into result
 from public.private_calls c where me in(c.caller_id,c.callee_id) and c.status in('ringing','accepted')
 and public.can_access_private_call(c.id,false);
 return result;
end; $$;

create or replace function public.end_private_call(p_call_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare me text:=private.private_call_actor(); c public.private_calls; sid uuid:=(auth.jwt()->>'session_id')::uuid;
begin
 select * into c from public.private_calls where id=p_call_id for update;
 if c.id is null or me not in(c.caller_id,c.callee_id) then raise exception 'Call not found'; end if;
 if c.status in('ringing','accepted') then
  if (me=c.caller_id and c.caller_session_id is distinct from sid)
  or (me=c.callee_id and c.status='accepted' and c.callee_session_id is distinct from sid)
  then raise exception 'Call belongs to another device'; end if;
  update public.private_calls set status=case when status='ringing' then 'missed' else 'ended' end,ended_at=now() where id=p_call_id;
 end if;
 return public.get_private_call_details(p_call_id);
end; $$;

create or replace function private.expire_private_call_signals()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.status not in('ringing','accepted') then delete from public.private_call_signals where call_id=new.id; end if;
 return new;
end; $$;
revoke all on function private.expire_private_call_signals() from public,anon,authenticated,service_role;
create trigger private_call_signal_cleanup after update of status on public.private_calls
for each row when(old.status is distinct from new.status) execute function private.expire_private_call_signals();

drop policy private_calls_select_participant on public.private_calls;
create policy private_calls_select_participant on public.private_calls for select to authenticated using(public.can_access_private_call(id,false));
drop policy private_call_signals_select_participant on public.private_call_signals;
create policy private_call_signals_select_participant on public.private_call_signals for select to authenticated using(public.can_access_private_call(call_id,true));
drop policy private_call_signals_insert_participant on public.private_call_signals;
create policy private_call_signals_insert_participant on public.private_call_signals for insert to authenticated
with check(sender_id=public.current_profile_user_id() and public.can_access_private_call(call_id,true)
 and jsonb_typeof(payload)='object' and octet_length(payload::text)<=65536);
drop policy private_call_preferences_select_own on public.private_call_preferences;
create policy private_call_preferences_select_own on public.private_call_preferences for select to authenticated
using(user_id=public.current_profile_user_id() and (public.get_my_private_call_preferences() is not null));
revoke all on public.private_calls,public.private_call_preferences,public.private_call_signals from anon,authenticated;
grant select on public.private_calls,public.private_call_preferences,public.private_call_signals to authenticated;
grant insert on public.private_call_signals to authenticated;
revoke all on function public.can_access_private_call(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.can_access_private_call(uuid,boolean) to authenticated;
revoke all on function public.get_my_private_call_preferences() from public,anon,authenticated,service_role;
grant execute on function public.get_my_private_call_preferences() to authenticated;
revoke all on function public.set_my_private_call_preferences(boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function public.set_my_private_call_preferences(boolean,boolean) to authenticated;
revoke all on function public.get_private_call_capabilities(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_private_call_capabilities(text,uuid) to authenticated;
revoke all on function public.get_private_call_details(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_private_call_details(uuid) to authenticated;
revoke all on function public.start_private_call(text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.start_private_call(text,uuid,text) to authenticated;
revoke all on function public.respond_private_call(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.respond_private_call(uuid,boolean) to authenticated;
revoke all on function public.get_my_active_private_calls() from public,anon,authenticated,service_role;
grant execute on function public.get_my_active_private_calls() to authenticated;
revoke all on function public.end_private_call(uuid) from public,anon,authenticated,service_role;
grant execute on function public.end_private_call(uuid) to authenticated;
