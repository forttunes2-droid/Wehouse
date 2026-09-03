alter table public.messages add column if not exists reply_to_id uuid references public.messages(id) on delete set null;
alter table public.messages add column if not exists reactions jsonb not null default '{}'::jsonb;
alter table public.booking_messages add column if not exists reply_to_id uuid references public.booking_messages(id) on delete set null;
alter table public.booking_messages add column if not exists reactions jsonb not null default '{}'::jsonb;

create index if not exists messages_reply_to_idx on public.messages(reply_to_id) where reply_to_id is not null;
create index if not exists booking_messages_reply_to_idx on public.booking_messages(reply_to_id) where reply_to_id is not null;

drop function if exists public.get_private_encrypted_messages(text,uuid);
create function public.get_private_encrypted_messages(p_conversation_kind text,p_conversation_id uuid)
returns table(id uuid,sender_id text,ciphertext text,encryption_iv text,encryption_version integer,encrypted_attachments jsonb,created_at timestamptz,legacy_content text,is_read boolean,reply_to_id uuid,reactions jsonb)
language plpgsql security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();
begin
 if actor is null then raise exception 'Active WeHouse profile required'; end if;
 if p_conversation_kind='roommate' then
  if not exists(select 1 from public.conversations c where c.id=p_conversation_id and actor in(c.participant_a,c.participant_b) and c.conversation_type='roommate' and coalesce(c.status,'active')='active') then raise exception 'Conversation access denied'; end if;
  return query select m.id,m.sender_id,m.ciphertext,m.encryption_iv,m.encryption_version,coalesce(m.encrypted_attachments,'[]'::jsonb),m.created_at,case when m.ciphertext is null then m.content else null end,coalesce(m.seen,false),m.reply_to_id,coalesce(m.reactions,'{}'::jsonb)
   from public.messages m where m.conversation_id=p_conversation_id and not(actor=any(coalesce(m.hidden_for,'{}'::text[]))) order by m.created_at,m.id;
 elsif p_conversation_kind='worker' then
  if not exists(select 1 from public.booking_conversations c where c.id=p_conversation_id and actor in(c.user_id,c.worker_id)) then raise exception 'Conversation access denied'; end if;
  return query select m.id,m.sender_id,m.ciphertext,m.encryption_iv,m.encryption_version,coalesce(m.encrypted_attachments,'[]'::jsonb),m.created_at,case when m.ciphertext is null then m.content else null end,coalesce(m.is_read,false),m.reply_to_id,coalesce(m.reactions,'{}'::jsonb)
   from public.booking_messages m where m.conversation_id=p_conversation_id and not(actor=any(coalesce(m.hidden_for,'{}'::text[]))) order by m.created_at,m.id;
 else raise exception 'Unsupported private conversation kind'; end if;
end $$;

drop function if exists public.send_private_encrypted_message(text,uuid,text,text,jsonb);
create function public.send_private_encrypted_message(p_conversation_kind text,p_conversation_id uuid,p_ciphertext text,p_encryption_iv text,p_encrypted_attachments jsonb default '[]'::jsonb,p_reply_to_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();message_id uuid;
begin
 if actor is null then raise exception 'Active WeHouse profile required'; end if;
 if nullif(p_ciphertext,'') is null or nullif(p_encryption_iv,'') is null then raise exception 'Encrypted payload is required'; end if;
 if p_conversation_kind='roommate' then
  if not exists(select 1 from public.conversations c where c.id=p_conversation_id and actor in(c.participant_a,c.participant_b) and coalesce(c.status,'active')='active') then raise exception 'Conversation access denied'; end if;
  if p_reply_to_id is not null and not exists(select 1 from public.messages where id=p_reply_to_id and conversation_id=p_conversation_id) then raise exception 'Reply target is not in this conversation'; end if;
  insert into public.messages(conversation_id,sender_id,content,ciphertext,encryption_iv,encryption_version,encrypted_attachments,reply_to_id) values(p_conversation_id,actor,'[Encrypted message]',p_ciphertext,p_encryption_iv,1,coalesce(p_encrypted_attachments,'[]'::jsonb),p_reply_to_id) returning id into message_id;
  update public.conversations set last_message='Encrypted message',last_message_at=now(),unread_a=case when participant_a=actor then unread_a else coalesce(unread_a,0)+1 end,unread_b=case when participant_b=actor then unread_b else coalesce(unread_b,0)+1 end where id=p_conversation_id;
 elsif p_conversation_kind='worker' then
  if not exists(select 1 from public.booking_conversations c join public.worker_bookings b on b.id=c.booking_id where c.id=p_conversation_id and actor in(c.user_id,c.worker_id) and b.status not in('approved_released','cancelled','refunded')) then raise exception 'This job conversation is closed'; end if;
  if p_reply_to_id is not null and not exists(select 1 from public.booking_messages where id=p_reply_to_id and conversation_id=p_conversation_id) then raise exception 'Reply target is not in this conversation'; end if;
  insert into public.booking_messages(conversation_id,sender_id,content,ciphertext,encryption_iv,encryption_version,encrypted_attachments,reply_to_id) values(p_conversation_id,actor,'[Encrypted message]',p_ciphertext,p_encryption_iv,1,coalesce(p_encrypted_attachments,'[]'::jsonb),p_reply_to_id) returning id into message_id;
  update public.booking_conversations set updated_at=now() where id=p_conversation_id;
 else raise exception 'Unsupported private conversation kind'; end if;
 return message_id;
end $$;

create or replace function public.set_private_message_reaction(p_conversation_kind text,p_conversation_id uuid,p_message_id uuid,p_emoji text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();result jsonb;
begin
 if actor is null then raise exception 'Active WeHouse profile required'; end if;
 if p_emoji is not null and p_emoji not in ('👍','❤️','😂','😮','😢','🙏') then raise exception 'Unsupported reaction'; end if;
 if p_conversation_kind='roommate' then
  if not exists(select 1 from public.conversations c where c.id=p_conversation_id and actor in(c.participant_a,c.participant_b) and coalesce(c.status,'active')='active') then raise exception 'Conversation access denied'; end if;
  update public.messages set reactions=case when nullif(p_emoji,'') is null then coalesce(reactions,'{}'::jsonb)-actor else jsonb_set(coalesce(reactions,'{}'::jsonb),array[actor],to_jsonb(p_emoji),true) end
   where id=p_message_id and conversation_id=p_conversation_id returning reactions into result;
 elsif p_conversation_kind='worker' then
  if not exists(select 1 from public.booking_conversations c where c.id=p_conversation_id and actor in(c.user_id,c.worker_id)) then raise exception 'Conversation access denied'; end if;
  update public.booking_messages set reactions=case when nullif(p_emoji,'') is null then coalesce(reactions,'{}'::jsonb)-actor else jsonb_set(coalesce(reactions,'{}'::jsonb),array[actor],to_jsonb(p_emoji),true) end
   where id=p_message_id and conversation_id=p_conversation_id returning reactions into result;
 else raise exception 'Unsupported private conversation kind'; end if;
 if result is null then raise exception 'Message was not found'; end if;
 return result;
end $$;

revoke all on function public.get_private_encrypted_messages(text,uuid),public.send_private_encrypted_message(text,uuid,text,text,jsonb,uuid),public.set_private_message_reaction(text,uuid,uuid,text) from public,anon;
grant execute on function public.get_private_encrypted_messages(text,uuid),public.send_private_encrypted_message(text,uuid,text,text,jsonb,uuid),public.set_private_message_reaction(text,uuid,uuid,text) to authenticated,service_role;
