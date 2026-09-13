-- Blocking must be a server-side communication boundary, not only a UI state.
-- History remains readable, but blocked peers cannot send new messages,
-- reactions, or start private calls. Calls already use the same block tables;
-- this migration closes the message/reaction gap for both worker and roommate
-- private conversations.

create or replace function public.send_private_encrypted_message(
  p_conversation_kind text,
  p_conversation_id uuid,
  p_ciphertext text,
  p_encryption_iv text,
  p_encrypted_attachments jsonb default '[]'::jsonb,
  p_reply_to_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  actor text:=public.current_profile_user_id();
  peer text;
  message_id uuid;
begin
  if actor is null then raise exception 'Active WeHouse profile required'; end if;
  if nullif(p_ciphertext,'') is null or nullif(p_encryption_iv,'') is null then
    raise exception 'Encrypted payload is required';
  end if;

  if p_conversation_kind='roommate' then
    select case when c.participant_a=actor then c.participant_b else c.participant_a end
    into peer
    from public.conversations c
    where c.id=p_conversation_id
      and actor in(c.participant_a,c.participant_b)
      and c.conversation_type='roommate'
      and coalesce(c.status,'active')='active'
    limit 1;

    if peer is null then raise exception 'Conversation access denied'; end if;
    if exists(
      select 1 from public.roommate_user_blocks block_row
      where (block_row.blocker_user_id=actor and block_row.blocked_user_id=peer)
         or (block_row.blocker_user_id=peer and block_row.blocked_user_id=actor)
    ) then raise exception 'This roommate connection is blocked'; end if;

    if p_reply_to_id is not null and not exists(
      select 1 from public.messages
      where id=p_reply_to_id and conversation_id=p_conversation_id
    ) then raise exception 'Reply target is not in this conversation'; end if;

    insert into public.messages(
      conversation_id,sender_id,content,ciphertext,encryption_iv,
      encryption_version,encrypted_attachments,reply_to_id
    ) values(
      p_conversation_id,actor,'[Encrypted message]',p_ciphertext,p_encryption_iv,
      1,coalesce(p_encrypted_attachments,'[]'::jsonb),p_reply_to_id
    ) returning id into message_id;

    update public.conversations
    set last_message='Encrypted message',last_message_at=now(),
      unread_a=case when participant_a=actor then unread_a else coalesce(unread_a,0)+1 end,
      unread_b=case when participant_b=actor then unread_b else coalesce(unread_b,0)+1 end
    where id=p_conversation_id;

  elsif p_conversation_kind='worker' then
    select case when c.user_id=actor then c.worker_id else c.user_id end
    into peer
    from public.booking_conversations c
    join public.worker_bookings b on b.id=c.booking_id
    where c.id=p_conversation_id
      and actor in(c.user_id,c.worker_id)
      and b.status not in('approved_released','cancelled','refunded')
    limit 1;

    if peer is null then raise exception 'This job conversation is closed'; end if;
    if exists(
      select 1 from public.worker_user_blocks block_row
      where (block_row.blocker_user_id=actor and block_row.blocked_user_id=peer)
         or (block_row.blocker_user_id=peer and block_row.blocked_user_id=actor)
    ) then raise exception 'This service conversation is blocked'; end if;

    if p_reply_to_id is not null and not exists(
      select 1 from public.booking_messages
      where id=p_reply_to_id and conversation_id=p_conversation_id
    ) then raise exception 'Reply target is not in this conversation'; end if;

    insert into public.booking_messages(
      conversation_id,sender_id,content,ciphertext,encryption_iv,
      encryption_version,encrypted_attachments,reply_to_id
    ) values(
      p_conversation_id,actor,'[Encrypted message]',p_ciphertext,p_encryption_iv,
      1,coalesce(p_encrypted_attachments,'[]'::jsonb),p_reply_to_id
    ) returning id into message_id;

    update public.booking_conversations set updated_at=now()
    where id=p_conversation_id;
  else
    raise exception 'Unsupported private conversation kind';
  end if;

  return message_id;
end;
$$;

create or replace function public.set_private_message_reaction(
  p_conversation_kind text,
  p_conversation_id uuid,
  p_message_id uuid,
  p_emoji text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  actor text:=public.current_profile_user_id();
  peer text;
  result jsonb;
begin
  if actor is null then raise exception 'Active WeHouse profile required'; end if;
  if nullif(btrim(coalesce(p_emoji,'')),'') is not null
     and not public._valid_reaction(p_emoji) then
    raise exception 'Choose a valid emoji reaction';
  end if;

  if p_conversation_kind='roommate' then
    select case when c.participant_a=actor then c.participant_b else c.participant_a end
    into peer
    from public.conversations c
    where c.id=p_conversation_id
      and actor in(c.participant_a,c.participant_b)
      and c.conversation_type='roommate'
      and coalesce(c.status,'active')='active'
    limit 1;

    if peer is null then raise exception 'Conversation access denied'; end if;
    if exists(
      select 1 from public.roommate_user_blocks block_row
      where (block_row.blocker_user_id=actor and block_row.blocked_user_id=peer)
         or (block_row.blocker_user_id=peer and block_row.blocked_user_id=actor)
    ) then raise exception 'This roommate connection is blocked'; end if;

    update public.messages
    set reactions=case
      when nullif(btrim(coalesce(p_emoji,'')),'') is null
        then coalesce(reactions,'{}'::jsonb)-actor
      else jsonb_set(coalesce(reactions,'{}'::jsonb),array[actor],to_jsonb(btrim(p_emoji)),true)
    end
    where id=p_message_id and conversation_id=p_conversation_id
    returning reactions into result;

  elsif p_conversation_kind='worker' then
    select case when c.user_id=actor then c.worker_id else c.user_id end
    into peer
    from public.booking_conversations c
    where c.id=p_conversation_id
      and actor in(c.user_id,c.worker_id)
    limit 1;

    if peer is null then raise exception 'Conversation access denied'; end if;
    if exists(
      select 1 from public.worker_user_blocks block_row
      where (block_row.blocker_user_id=actor and block_row.blocked_user_id=peer)
         or (block_row.blocker_user_id=peer and block_row.blocked_user_id=actor)
    ) then raise exception 'This service conversation is blocked'; end if;

    update public.booking_messages
    set reactions=case
      when nullif(btrim(coalesce(p_emoji,'')),'') is null
        then coalesce(reactions,'{}'::jsonb)-actor
      else jsonb_set(coalesce(reactions,'{}'::jsonb),array[actor],to_jsonb(btrim(p_emoji)),true)
    end
    where id=p_message_id and conversation_id=p_conversation_id
    returning reactions into result;
  else
    raise exception 'Unsupported private conversation kind';
  end if;

  if result is null then raise exception 'Message was not found'; end if;
  return result;
end;
$$;

-- Harden the old plaintext worker-message RPC too. The current client uses the
-- encrypted RPC, but an older or modified client must not bypass block/closure.
create or replace function public.send_booking_message(
  p_conversation_id uuid,
  p_content text
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_sender_id text;
  v_peer_id text;
  v_booking_id uuid;
  v_booking_status text;
  v_msg_id uuid;
begin
  select user_id into v_sender_id
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_sender_id is null then raise exception 'Sender profile not found'; end if;

  select c.booking_id,
         case when c.user_id=v_sender_id then c.worker_id else c.user_id end,
         b.status
  into v_booking_id,v_peer_id,v_booking_status
  from public.booking_conversations c
  join public.worker_bookings b on b.id=c.booking_id
  where c.id=p_conversation_id
    and v_sender_id in(c.user_id,c.worker_id)
  limit 1;

  if v_booking_id is null then raise exception 'Conversation not found'; end if;
  if v_booking_status in('approved_released','cancelled','refunded') then
    raise exception 'This job conversation is closed';
  end if;
  if exists(
    select 1 from public.worker_user_blocks block_row
    where (block_row.blocker_user_id=v_sender_id and block_row.blocked_user_id=v_peer_id)
       or (block_row.blocker_user_id=v_peer_id and block_row.blocked_user_id=v_sender_id)
  ) then raise exception 'This service conversation is blocked'; end if;

  insert into public.booking_messages(conversation_id,sender_id,content,created_at)
  values(p_conversation_id,v_sender_id,p_content,now())
  returning id into v_msg_id;
  update public.booking_conversations set updated_at=now()
  where id=p_conversation_id;
  return v_msg_id;
end;
$$;

revoke all on function public.send_private_encrypted_message(text,uuid,text,text,jsonb,uuid) from public,anon;
revoke all on function public.set_private_message_reaction(text,uuid,uuid,text) from public,anon;
revoke all on function public.send_booking_message(uuid,text) from public,anon;
grant execute on function public.send_private_encrypted_message(text,uuid,text,text,jsonb,uuid) to authenticated,service_role;
grant execute on function public.set_private_message_reaction(text,uuid,uuid,text) to authenticated,service_role;
grant execute on function public.send_booking_message(uuid,text) to authenticated,service_role;
