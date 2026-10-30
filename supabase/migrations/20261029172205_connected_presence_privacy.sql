-- Keep the existing person-level preference and projection; no second identity
-- or presence table. A trusted device is required even with an unexpired JWT.
create function private.presence_actor() returns text
language plpgsql stable security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();
begin
 if actor is null or not public._property_document_session_active() then
  raise exception 'Active trusted account required' using errcode='42501';
 end if;
 return actor;
end $$;
revoke all on function private.presence_actor() from public,anon,authenticated,service_role;

create or replace function public.update_my_privacy(p_updates jsonb) returns public.profiles
language plpgsql security definer set search_path='' as $$
declare actor text:=private.presence_actor(); result public.profiles;
begin
 if p_updates is null or jsonb_typeof(p_updates)<>'object' or p_updates='{}'::jsonb then
  raise exception 'Choose a privacy setting' using errcode='22023';
 end if;
 if exists(select 1 from jsonb_each(p_updates) item where item.key not in
  ('privacy_profile_visible','privacy_search_visible','privacy_activity_visible','privacy_email_visible','privacy_phone_visible')
  or jsonb_typeof(item.value)<>'boolean') then
  raise exception 'Choose supported boolean privacy settings' using errcode='22023';
 end if;
 update public.profiles set
  privacy_profile_visible=case when p_updates?'privacy_profile_visible' then (p_updates->>'privacy_profile_visible')::boolean else privacy_profile_visible end,
  privacy_search_visible=case when p_updates?'privacy_search_visible' then (p_updates->>'privacy_search_visible')::boolean else privacy_search_visible end,
  privacy_activity_visible=case when p_updates?'privacy_activity_visible' then (p_updates->>'privacy_activity_visible')::boolean else privacy_activity_visible end,
  privacy_email_visible=case when p_updates?'privacy_email_visible' then (p_updates->>'privacy_email_visible')::boolean else privacy_email_visible end,
  privacy_phone_visible=case when p_updates?'privacy_phone_visible' then (p_updates->>'privacy_phone_visible')::boolean else privacy_phone_visible end,
  is_online=case when p_updates->>'privacy_activity_visible'='false' then false else is_online end,
  updated_at=now()
 where user_id=actor returning * into result;
 if result.user_id is null then raise exception 'Active profile not found' using errcode='42501';end if;
 return result;
end $$;

create or replace function public.touch_my_presence(p_online boolean default true) returns timestamptz
language plpgsql security definer set search_path='' as $$
declare actor text:=private.presence_actor(); stamp timestamptz;
begin
 -- Hidden activity does not keep writing public-presence timestamps. Device
 -- security/audit timestamps retain their separate purpose and authority.
 update public.profiles set is_online=coalesce(p_online,true),last_seen=now()
 where user_id=actor and privacy_activity_visible is distinct from false
  and (is_online is distinct from coalesce(p_online,true) or last_seen is null or last_seen<now()-interval '30 seconds')
 returning last_seen into stamp;
 return stamp;
end $$;

create or replace function public.get_chat_peer_presence(p_peer_user_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.presence_actor(); peer public.profiles; related boolean;
 hidden constant jsonb:='{"visible":false,"online":false,"last_seen":null}';
begin
 if p_peer_user_id is null or p_peer_user_id=actor or length(p_peer_user_id)>120 then
  raise exception 'Choose another chat participant' using errcode='22023';end if;
 select exists(select 1 from public.conversations c where c.conversation_type='roommate'
  and actor in(c.participant_a,c.participant_b) and p_peer_user_id in(c.participant_a,c.participant_b)
  and public._can_access_conversation(c.id))
 or exists(select 1 from public.booking_conversations c
  where actor in(c.user_id,c.worker_id) and p_peer_user_id in(c.user_id,c.worker_id)
   and public.user_has_active_workspace(c.user_id,'personal')
   and public.user_has_active_workspace(c.worker_id,'worker')
   and not exists(select 1 from public.worker_user_blocks b
    where (b.blocker_user_id=c.user_id and b.blocked_user_id=c.worker_id)
     or (b.blocker_user_id=c.worker_id and b.blocked_user_id=c.user_id)))
 or exists(select 1 from public.friends f
  where f.user_low=least(actor,p_peer_user_id) and f.user_high=greatest(actor,p_peer_user_id) and f.status='accepted'
   and public.user_has_active_workspace(actor,'personal') and public.user_has_active_workspace(p_peer_user_id,'personal'))
 into related;
 if not related then return hidden;end if;
 select * into peer from public.profiles where user_id=p_peer_user_id and not coalesce(deleted,false)
  and not coalesce(suspended,false) and not coalesce(banned,false);
 if peer.user_id is null or peer.privacy_activity_visible=false then return hidden;end if;
 return jsonb_build_object('visible',true,'online',coalesce(peer.is_online,false) and coalesce(peer.last_seen>=now()-interval '90 seconds',false),'last_seen',peer.last_seen);
end $$;

revoke all on function public.update_my_privacy(jsonb),public.touch_my_presence(boolean),public.get_chat_peer_presence(text) from public,anon;
grant execute on function public.update_my_privacy(jsonb),public.touch_my_presence(boolean),public.get_chat_peer_presence(text) to authenticated;
notify pgrst,'reload schema';
