-- Phase 10: make Worker liveness renewal identity-safe and add private user/Worker calling.

create table public.private_call_preferences (
  user_id text primary key references public.profiles(user_id) on delete cascade,
  allow_audio_calls boolean not null default true,
  allow_video_calls boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.private_calls (
  id uuid primary key default gen_random_uuid(),
  context_type text not null check (context_type in ('roommate','worker_booking')),
  context_id uuid not null,
  caller_id text not null references public.profiles(user_id) on delete cascade,
  callee_id text not null references public.profiles(user_id) on delete cascade,
  call_type text not null check (call_type in ('audio','video')),
  status text not null default 'ringing' check (status in ('ringing','accepted','declined','missed','ended','failed')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  constraint private_calls_not_self check (caller_id <> callee_id)
);
create index private_calls_caller_status_idx on public.private_calls(caller_id,status,created_at desc);
create index private_calls_callee_status_idx on public.private_calls(callee_id,status,created_at desc);

create table public.private_call_signals (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.private_calls(id) on delete cascade,
  sender_id text not null references public.profiles(user_id) on delete cascade,
  signal_type text not null check (signal_type in ('offer','answer','ice')),
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index private_call_signals_call_created_idx on public.private_call_signals(call_id,created_at);

alter table public.private_call_preferences enable row level security;
alter table public.private_calls enable row level security;
alter table public.private_call_signals enable row level security;

create policy private_call_preferences_select_own on public.private_call_preferences for select to authenticated using (user_id=public.current_profile_user_id());
create policy private_calls_select_participant on public.private_calls for select to authenticated using (public.current_profile_user_id() in (caller_id,callee_id));
create policy private_call_signals_select_participant on public.private_call_signals for select to authenticated using (exists(select 1 from public.private_calls c where c.id=call_id and public.current_profile_user_id() in (c.caller_id,c.callee_id)));
create policy private_call_signals_insert_participant on public.private_call_signals for insert to authenticated with check (sender_id=public.current_profile_user_id() and exists(select 1 from public.private_calls c where c.id=call_id and public.current_profile_user_id() in (c.caller_id,c.callee_id) and c.status in ('ringing','accepted')));

grant select on public.private_call_preferences,public.private_calls,public.private_call_signals to authenticated;
grant insert on public.private_call_signals to authenticated;

create or replace function public.get_my_private_call_preferences() returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_me text:=public.current_profile_user_id(); v_pref public.private_call_preferences;
begin
  if v_me is null then raise exception 'Authenticated profile required'; end if;
  select * into v_pref from public.private_call_preferences where user_id=v_me;
  return jsonb_build_object('allow_audio_calls',coalesce(v_pref.allow_audio_calls,true),'allow_video_calls',coalesce(v_pref.allow_video_calls,false));
end; $$;

create or replace function public.set_my_private_call_preferences(p_allow_audio boolean,p_allow_video boolean) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_me text:=public.current_profile_user_id(); v_role text:=public.current_profile_role();
begin
  if v_me is null or v_role not in ('user','worker') then raise exception 'Calls are available to Users and Workers'; end if;
  insert into public.private_call_preferences(user_id,allow_audio_calls,allow_video_calls,updated_at)
  values(v_me,coalesce(p_allow_audio,true),coalesce(p_allow_video,false),now())
  on conflict(user_id) do update set allow_audio_calls=excluded.allow_audio_calls,allow_video_calls=excluded.allow_video_calls,updated_at=now();
  return public.get_my_private_call_preferences();
end; $$;

create or replace function public.get_private_call_capabilities(p_context_type text,p_context_id uuid) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_me text:=public.current_profile_user_id(); v_peer text; v_profile public.profiles; v_pref public.private_call_preferences;
begin
  if v_me is null then raise exception 'Authenticated profile required'; end if;
  if p_context_type='roommate' then
    select case when c.participant_a=v_me then c.participant_b else c.participant_a end into v_peer
    from public.conversations c where c.id=p_context_id and c.conversation_type='roommate' and v_me in (c.participant_a,c.participant_b) limit 1;
  elsif p_context_type='worker_booking' then
    select case when c.user_id=v_me then c.worker_id else c.user_id end into v_peer
    from public.booking_conversations c where c.id=p_context_id and v_me in (c.user_id,c.worker_id) limit 1;
  else raise exception 'Unsupported call context'; end if;
  if v_peer is null then raise exception 'Private conversation not found'; end if;
  select * into v_profile from public.profiles where user_id=v_peer and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_profile is null or v_profile.role not in ('user','worker') then raise exception 'This person cannot receive private calls'; end if;
  select * into v_pref from public.private_call_preferences where user_id=v_peer;
  return jsonb_build_object('peer_id',v_peer,'peer_name',coalesce(v_profile.full_name,v_profile.username,'WeHouse member'),'peer_avatar',v_profile.avatar_url,'allow_audio_calls',coalesce(v_pref.allow_audio_calls,true),'allow_video_calls',coalesce(v_pref.allow_video_calls,false));
end; $$;

create or replace function public.start_private_call(p_context_type text,p_context_id uuid,p_call_type text) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_me text:=public.current_profile_user_id(); v_cap jsonb; v_peer text; v_call public.private_calls;
begin
  if v_me is null then raise exception 'Authenticated profile required'; end if;
  if p_call_type not in ('audio','video') then raise exception 'Invalid call type'; end if;
  v_cap:=public.get_private_call_capabilities(p_context_type,p_context_id); v_peer:=v_cap->>'peer_id';
  if p_call_type='audio' and coalesce((v_cap->>'allow_audio_calls')::boolean,false)=false then raise exception 'This person is not accepting audio calls'; end if;
  if p_call_type='video' and coalesce((v_cap->>'allow_video_calls')::boolean,false)=false then raise exception 'This person is not accepting video calls'; end if;
  if exists(select 1 from public.private_calls c where c.status in ('ringing','accepted') and (v_me in (c.caller_id,c.callee_id) or v_peer in (c.caller_id,c.callee_id))) then raise exception 'One of you is already in a call'; end if;
  insert into public.private_calls(context_type,context_id,caller_id,callee_id,call_type,status) values(p_context_type,p_context_id,v_me,v_peer,p_call_type,'ringing') returning * into v_call;
  return to_jsonb(v_call)||jsonb_build_object('peer_name',v_cap->>'peer_name','peer_avatar',v_cap->>'peer_avatar');
end; $$;

create or replace function public.get_private_call_details(p_call_id uuid) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_me text:=public.current_profile_user_id(); v_call public.private_calls; v_peer text; v_profile public.profiles;
begin
  select * into v_call from public.private_calls where id=p_call_id and v_me in (caller_id,callee_id) limit 1;
  if v_call is null then raise exception 'Call not found'; end if;
  v_peer:=case when v_call.caller_id=v_me then v_call.callee_id else v_call.caller_id end;
  select * into v_profile from public.profiles where user_id=v_peer limit 1;
  return to_jsonb(v_call)||jsonb_build_object('peer_id',v_peer,'peer_name',coalesce(v_profile.full_name,v_profile.username,'WeHouse member'),'peer_avatar',v_profile.avatar_url,'incoming',v_call.callee_id=v_me);
end; $$;

create or replace function public.respond_private_call(p_call_id uuid,p_accept boolean) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_me text:=public.current_profile_user_id(); v_call public.private_calls;
begin
  select * into v_call from public.private_calls where id=p_call_id for update;
  if v_call is null or v_call.callee_id<>v_me then raise exception 'Incoming call not found'; end if;
  if v_call.status<>'ringing' then return public.get_private_call_details(p_call_id); end if;
  update public.private_calls set status=case when p_accept then 'accepted' else 'declined' end,answered_at=case when p_accept then now() else null end,ended_at=case when p_accept then null else now() end where id=p_call_id;
  return public.get_private_call_details(p_call_id);
end; $$;

create or replace function public.end_private_call(p_call_id uuid) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_me text:=public.current_profile_user_id(); v_call public.private_calls;
begin
  select * into v_call from public.private_calls where id=p_call_id for update;
  if v_call is null or v_me not in (v_call.caller_id,v_call.callee_id) then raise exception 'Call not found'; end if;
  if v_call.status in ('ringing','accepted') then update public.private_calls set status=case when v_call.status='ringing' then 'missed' else 'ended' end,ended_at=now() where id=p_call_id; end if;
  return public.get_private_call_details(p_call_id);
end; $$;

create or replace function public.get_my_active_private_calls() returns jsonb language sql security definer set search_path='public' as $$
  select coalesce(jsonb_agg(public.get_private_call_details(c.id) order by c.created_at desc),'[]'::jsonb) from public.private_calls c where public.current_profile_user_id() in (c.caller_id,c.callee_id) and c.status in ('ringing','accepted');
$$;

revoke all on function public.get_my_private_call_preferences() from public,anon;
revoke all on function public.set_my_private_call_preferences(boolean,boolean) from public,anon;
revoke all on function public.get_private_call_capabilities(text,uuid) from public,anon;
revoke all on function public.start_private_call(text,uuid,text) from public,anon;
revoke all on function public.get_private_call_details(uuid) from public,anon;
revoke all on function public.respond_private_call(uuid,boolean) from public,anon;
revoke all on function public.end_private_call(uuid) from public,anon;
revoke all on function public.get_my_active_private_calls() from public,anon;
grant execute on function public.get_my_private_call_preferences() to authenticated;
grant execute on function public.set_my_private_call_preferences(boolean,boolean) to authenticated;
grant execute on function public.get_private_call_capabilities(text,uuid) to authenticated;
grant execute on function public.start_private_call(text,uuid,text) to authenticated;
grant execute on function public.get_private_call_details(uuid) to authenticated;
grant execute on function public.respond_private_call(uuid,boolean) to authenticated;
grant execute on function public.end_private_call(uuid) to authenticated;
grant execute on function public.get_my_active_private_calls() to authenticated;

create or replace function public.get_my_worker_identity_reference() returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_actor public.profiles; v_identity public.worker_identity_checks;
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text and role='worker' and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor is null then raise exception 'Active Worker account required'; end if;
  select * into v_identity from public.worker_identity_checks where worker_id=v_actor.user_id;
  return jsonb_build_object('has_reference',coalesce(nullif(btrim(coalesce(v_identity.enrollment_photo_path,'')),'') is not null,false),'photo_path',v_identity.enrollment_photo_path,'captured_at',v_identity.captured_at,'status',coalesce(v_identity.status,'not_started'));
end; $$;
revoke all on function public.get_my_worker_identity_reference() from public,anon;
grant execute on function public.get_my_worker_identity_reference() to authenticated;

create or replace function public.complete_my_worker_identity_check(p_photo_path text,p_face_match_score numeric,p_liveness_score numeric,p_anti_spoof_score numeric,p_challenge_result jsonb,p_consent boolean)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_actor public.profiles; v_existing public.worker_identity_checks; v_attempts integer; v_is_renewal boolean:=false;
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text and role='worker' and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor is null then raise exception 'Active Worker account required'; end if;
  if coalesce(p_consent,false)=false then raise exception 'Private face-check consent is required'; end if;
  select * into v_existing from public.worker_identity_checks where worker_id=v_actor.user_id;
  v_is_renewal:=v_existing.worker_id is not null and nullif(btrim(coalesce(v_existing.enrollment_photo_path,'')),'') is not null;
  if nullif(btrim(coalesce(p_photo_path,'')),'') is null or p_photo_path not like v_actor.user_id||'/%' then raise exception 'Invalid private selfie path'; end if;
  if v_is_renewal and p_photo_path<>v_existing.enrollment_photo_path then raise exception 'Worker identity renewals must use the original enrolled face'; end if;
  if not exists(select 1 from storage.objects where bucket_id='worker-identity-private' and name=p_photo_path) then raise exception 'Private identity selfie was not found'; end if;
  if p_face_match_score is null or p_face_match_score<0 or p_face_match_score>1 or p_liveness_score is null or p_liveness_score<0 or p_liveness_score>1 or p_anti_spoof_score is null or p_anti_spoof_score<0 or p_anti_spoof_score>1 then raise exception 'Invalid automatic face-check score'; end if;
  if p_face_match_score<0.55 then raise exception 'Live face did not match the enrolled Worker closely enough'; end if;
  if p_liveness_score<0.50 then raise exception 'Automatic liveness check did not pass'; end if;
  if p_anti_spoof_score<0.50 then raise exception 'Automatic anti-spoof check did not pass'; end if;
  if coalesce((p_challenge_result->>'automatic')::boolean,false)=false or coalesce((p_challenge_result->>'center_start')::boolean,false)=false or coalesce((p_challenge_result->>'side_one')::boolean,false)=false or coalesce((p_challenge_result->>'side_two')::boolean,false)=false or coalesce((p_challenge_result->>'center_end')::boolean,false)=false or coalesce((p_challenge_result->>'recorded_video')::boolean,true)=true then raise exception 'Automatic head-movement challenge is incomplete'; end if;
  v_attempts:=coalesce(v_existing.attempt_count,0)+1;
  insert into public.worker_identity_checks(worker_id,status,enrollment_photo_path,challenge_version,face_match_score,liveness_score,anti_spoof_score,challenge_result,consent_at,captured_at,attempt_count,updated_at)
  values(v_actor.user_id,'passed',p_photo_path,'human-3.3.6-head-turn-v2',p_face_match_score,p_liveness_score,p_anti_spoof_score,p_challenge_result,now(),now(),v_attempts,now())
  on conflict(worker_id) do update set status='passed',enrollment_photo_path=coalesce(worker_identity_checks.enrollment_photo_path,excluded.enrollment_photo_path),challenge_version=excluded.challenge_version,face_match_score=excluded.face_match_score,liveness_score=excluded.liveness_score,anti_spoof_score=excluded.anti_spoof_score,challenge_result=excluded.challenge_result,consent_at=excluded.consent_at,captured_at=excluded.captured_at,attempt_count=v_attempts,updated_at=now();
  insert into public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
  values(case when v_is_renewal then 'WORKER_IDENTITY_RECHECK_PASSED' else 'WORKER_AUTOMATIC_FACE_CHECK_PASSED' end,'profiles',v_actor.user_id,jsonb_build_object('challenge_version','human-3.3.6-head-turn-v2','face_match_score',p_face_match_score,'liveness_score',p_liveness_score,'anti_spoof_score',p_anti_spoof_score,'renewal',v_is_renewal,'original_face_preserved',v_is_renewal,'liveness_video_recorded',false,'private_selfie',true)::text,v_actor.user_id,v_actor.email);
  return jsonb_build_object('status','passed','captured_at',now(),'attempt_count',v_attempts,'renewal',v_is_renewal,'original_face_preserved',v_is_renewal);
end; $$;

DO $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='private_calls') then execute 'alter publication supabase_realtime add table public.private_calls'; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='private_call_signals') then execute 'alter publication supabase_realtime add table public.private_call_signals'; end if;
end $$;
