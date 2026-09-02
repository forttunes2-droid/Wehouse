-- A completed/cancelled/refunded service job is retained as read-only history.
-- Messaging and calling share the same active-job eligibility rule.
create or replace function public.get_private_call_capabilities(p_context_type text,p_context_id uuid)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare v_me text:=public.current_profile_user_id();v_peer text;v_profile public.profiles;v_pref public.private_call_preferences;
begin
  if v_me is null then raise exception 'Authenticated profile required'; end if;
  if p_context_type='roommate' then
    select case when c.participant_a=v_me then c.participant_b else c.participant_a end into v_peer
    from public.conversations c where c.id=p_context_id and c.conversation_type='roommate'
      and coalesce(c.status,'active')='active' and v_me in(c.participant_a,c.participant_b) limit 1;
  elsif p_context_type='worker_booking' then
    select case when c.user_id=v_me then c.worker_id else c.user_id end into v_peer
    from public.booking_conversations c join public.worker_bookings b on b.id=c.booking_id
    where c.id=p_context_id and v_me in(c.user_id,c.worker_id)
      and b.status not in('approved_released','cancelled','refunded') limit 1;
  else raise exception 'Unsupported call context'; end if;
  if v_peer is null then raise exception 'This job conversation is closed'; end if;
  select * into v_profile from public.profiles where user_id=v_peer and not coalesce(deleted,false)
    and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_profile is null or not(v_profile.account_kind='consumer' or v_profile.role='worker') then raise exception 'This person cannot receive private calls'; end if;
  select * into v_pref from public.private_call_preferences where user_id=v_peer;
  return jsonb_build_object('peer_id',v_peer,'peer_name',coalesce(v_profile.full_name,v_profile.username,'WeHouse member'),'peer_avatar',v_profile.avatar_url,'allow_audio_calls',coalesce(v_pref.allow_audio_calls,true),'allow_video_calls',coalesce(v_pref.allow_video_calls,true));
end $$;

create or replace function public.send_private_encrypted_message(p_conversation_kind text,p_conversation_id uuid,p_ciphertext text,p_encryption_iv text,p_encrypted_attachments jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path to '' as $$
declare actor text:=public.current_profile_user_id();message_id uuid;
begin
  if actor is null then raise exception 'Active WeHouse profile required'; end if;
  if nullif(p_ciphertext,'') is null or nullif(p_encryption_iv,'') is null then raise exception 'Encrypted payload is required'; end if;
  if p_conversation_kind='roommate' then
    if not exists(select 1 from public.conversations c where c.id=p_conversation_id and actor in(c.participant_a,c.participant_b) and coalesce(c.status,'active')='active') then raise exception 'Conversation access denied'; end if;
    insert into public.messages(conversation_id,sender_id,content,ciphertext,encryption_iv,encryption_version,encrypted_attachments) values(p_conversation_id,actor,'[Encrypted message]',p_ciphertext,p_encryption_iv,1,coalesce(p_encrypted_attachments,'[]'::jsonb)) returning id into message_id;
    update public.conversations set last_message='Encrypted message',last_message_at=now(),unread_a=case when participant_a=actor then unread_a else coalesce(unread_a,0)+1 end,unread_b=case when participant_b=actor then unread_b else coalesce(unread_b,0)+1 end where id=p_conversation_id;
  elsif p_conversation_kind='worker' then
    if not exists(select 1 from public.booking_conversations c join public.worker_bookings b on b.id=c.booking_id where c.id=p_conversation_id and actor in(c.user_id,c.worker_id) and b.status not in('approved_released','cancelled','refunded')) then raise exception 'This job conversation is closed'; end if;
    insert into public.booking_messages(conversation_id,sender_id,content,ciphertext,encryption_iv,encryption_version,encrypted_attachments) values(p_conversation_id,actor,'[Encrypted message]',p_ciphertext,p_encryption_iv,1,coalesce(p_encrypted_attachments,'[]'::jsonb)) returning id into message_id;
    update public.booking_conversations set updated_at=now() where id=p_conversation_id;
  else raise exception 'Unsupported private conversation kind'; end if;
  return message_id;
end $$;

update public.private_calls c set status='ended',ended_at=coalesce(c.ended_at,now())
from public.booking_conversations bc join public.worker_bookings b on b.id=bc.booking_id
where c.context_type='worker_booking' and c.context_id=bc.id and c.status in('ringing','accepted')
  and b.status in('approved_released','cancelled','refunded');

revoke all on function public.get_private_call_capabilities(text,uuid) from public,anon;
grant execute on function public.get_private_call_capabilities(text,uuid) to authenticated,service_role;
revoke all on function public.send_private_encrypted_message(text,uuid,text,text,jsonb) from public,anon;
grant execute on function public.send_private_encrypted_message(text,uuid,text,text,jsonb) to authenticated,service_role;
