-- Private conversation records use profiles.user_id, not auth.users.id.
-- Keep cryptographic ownership and participant checks on the same canonical ID.

drop policy if exists encryption_identity_owner_read on public.user_encryption_identities;
create policy encryption_identity_owner_read on public.user_encryption_identities
  for select to authenticated using (user_id = public.current_profile_user_id());
drop policy if exists encryption_identity_owner_insert on public.user_encryption_identities;
create policy encryption_identity_owner_insert on public.user_encryption_identities
  for insert to authenticated with check (user_id = public.current_profile_user_id());
drop policy if exists encryption_identity_owner_update on public.user_encryption_identities;
create policy encryption_identity_owner_update on public.user_encryption_identities
  for update to authenticated
  using (user_id = public.current_profile_user_id())
  with check (user_id = public.current_profile_user_id());

drop policy if exists conversation_key_envelope_recipient_read on public.conversation_key_envelopes;
create policy conversation_key_envelope_recipient_read on public.conversation_key_envelopes
  for select to authenticated using (recipient_user_id = public.current_profile_user_id());
drop policy if exists conversation_key_envelope_participant_insert on public.conversation_key_envelopes;
create policy conversation_key_envelope_participant_insert on public.conversation_key_envelopes
  for insert to authenticated with check (
    (conversation_kind = 'roommate' and exists (
      select 1 from public.conversations c where c.id = conversation_id
      and public.current_profile_user_id() in (c.participant_a,c.participant_b)
      and recipient_user_id in (c.participant_a,c.participant_b)
    )) or
    (conversation_kind = 'worker' and exists (
      select 1 from public.booking_conversations c where c.id = conversation_id
      and public.current_profile_user_id() in (c.user_id,c.worker_id)
      and recipient_user_id in (c.user_id,c.worker_id)
    ))
  );

create or replace function public.get_private_chat_peer_public_key(
  p_conversation_kind text,p_conversation_id uuid,p_peer_user_id text
) returns table(user_id text,key_version integer,public_key_jwk jsonb)
language plpgsql security definer set search_path = '' as $$
declare actor text := public.current_profile_user_id();
begin
  if actor is null then raise exception 'Active WeHouse profile required'; end if;
  if p_conversation_kind='roommate' then
    if not exists(select 1 from public.conversations c where c.id=p_conversation_id and actor in(c.participant_a,c.participant_b) and p_peer_user_id in(c.participant_a,c.participant_b)) then raise exception 'Conversation access denied'; end if;
  elsif p_conversation_kind='worker' then
    if not exists(select 1 from public.booking_conversations c where c.id=p_conversation_id and actor in(c.user_id,c.worker_id) and p_peer_user_id in(c.user_id,c.worker_id)) then raise exception 'Conversation access denied'; end if;
  else raise exception 'Unsupported private conversation kind'; end if;
  return query select i.user_id,i.key_version,i.public_key_jwk from public.user_encryption_identities i where i.user_id=p_peer_user_id;
end $$;

create or replace function public.send_private_encrypted_message(
  p_conversation_kind text,p_conversation_id uuid,p_ciphertext text,p_encryption_iv text,p_encrypted_attachments jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare actor text := public.current_profile_user_id(); message_id uuid;
begin
  if actor is null then raise exception 'Active WeHouse profile required'; end if;
  if nullif(p_ciphertext,'') is null or nullif(p_encryption_iv,'') is null then raise exception 'Encrypted payload is required'; end if;
  if p_conversation_kind='roommate' then
    if not exists(select 1 from public.conversations c where c.id=p_conversation_id and actor in(c.participant_a,c.participant_b)) then raise exception 'Conversation access denied'; end if;
    insert into public.messages(conversation_id,sender_id,content,ciphertext,encryption_iv,encryption_version,encrypted_attachments)
    values(p_conversation_id,actor,'[Encrypted message]',p_ciphertext,p_encryption_iv,1,coalesce(p_encrypted_attachments,'[]'::jsonb)) returning id into message_id;
    update public.conversations set last_message='Encrypted message',last_message_at=now(),
      unread_a=case when participant_a=actor then unread_a else coalesce(unread_a,0)+1 end,
      unread_b=case when participant_b=actor then unread_b else coalesce(unread_b,0)+1 end where id=p_conversation_id;
  elsif p_conversation_kind='worker' then
    if not exists(select 1 from public.booking_conversations c where c.id=p_conversation_id and actor in(c.user_id,c.worker_id)) then raise exception 'Conversation access denied'; end if;
    insert into public.booking_messages(conversation_id,sender_id,content,ciphertext,encryption_iv,encryption_version,encrypted_attachments)
    values(p_conversation_id,actor,'[Encrypted message]',p_ciphertext,p_encryption_iv,1,coalesce(p_encrypted_attachments,'[]'::jsonb)) returning id into message_id;
    update public.booking_conversations set updated_at=now() where id=p_conversation_id;
  else raise exception 'Unsupported private conversation kind'; end if;
  return message_id;
end $$;

create or replace function public.get_private_encrypted_messages(
  p_conversation_kind text,p_conversation_id uuid
) returns table(id uuid,sender_id text,ciphertext text,encryption_iv text,encryption_version integer,encrypted_attachments jsonb,created_at timestamptz,legacy_content text)
language plpgsql security definer set search_path='' as $$
declare actor text := public.current_profile_user_id();
begin
  if actor is null then raise exception 'Active WeHouse profile required'; end if;
  if p_conversation_kind='roommate' then
    if not exists(select 1 from public.conversations c where c.id=p_conversation_id and actor in(c.participant_a,c.participant_b)) then raise exception 'Conversation access denied'; end if;
    return query select m.id,m.sender_id,m.ciphertext,m.encryption_iv,m.encryption_version,coalesce(m.encrypted_attachments,'[]'::jsonb),m.created_at,case when m.ciphertext is null then m.content else null end from public.messages m where m.conversation_id=p_conversation_id and not(actor=any(coalesce(m.hidden_for,'{}'::text[]))) order by m.created_at;
  elsif p_conversation_kind='worker' then
    if not exists(select 1 from public.booking_conversations c where c.id=p_conversation_id and actor in(c.user_id,c.worker_id)) then raise exception 'Conversation access denied'; end if;
    return query select m.id,m.sender_id,m.ciphertext,m.encryption_iv,m.encryption_version,coalesce(m.encrypted_attachments,'[]'::jsonb),m.created_at,case when m.ciphertext is null then m.content else null end from public.booking_messages m where m.conversation_id=p_conversation_id and not(actor=any(coalesce(m.hidden_for,'{}'::text[]))) order by m.created_at;
  else raise exception 'Unsupported private conversation kind'; end if;
end $$;

revoke all on function public.get_private_chat_peer_public_key(text,uuid,text),public.send_private_encrypted_message(text,uuid,text,text,jsonb),public.get_private_encrypted_messages(text,uuid) from public,anon;
grant execute on function public.get_private_chat_peer_public_key(text,uuid,text),public.send_private_encrypted_message(text,uuid,text,text,jsonb),public.get_private_encrypted_messages(text,uuid) to authenticated;
