-- No new message store or encryption algorithm: bind each new send to the
-- opaque envelope used by its browser, under the existing conversation lock.
create function private.assert_current_private_message_envelope(p_kind text,p_conversation_id uuid,p_token text) returns void
language plpgsql security definer set search_path='' as $$
declare person text:=public.current_profile_user_id();expected text;
begin
 if person is null or not public._property_document_session_active() then raise exception 'A trusted account session is required' using errcode='42501';end if;
 if p_kind not in('friend','roommate','worker') or p_conversation_id is null then raise exception 'Unsupported private conversation' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_kind||':'||p_conversation_id::text,0));
 select e.recipient_key_version::text||':'||e.wrap_iv||':'||e.wrapped_key into expected
 from public.conversation_key_envelopes e join public.user_encryption_identities i
 on i.user_id=e.recipient_user_id and i.key_version=e.recipient_key_version
 where e.conversation_kind=p_kind and e.conversation_id=p_conversation_id and e.recipient_user_id=person
 order by e.recipient_key_version desc limit 1;
 if p_token is null or length(p_token)>2048 or expected is null or p_token<>expected then
  raise exception 'Private-message keys changed. Refresh this chat and retry; your draft is kept.' using errcode='40001';end if;
end $$;
revoke all on function private.assert_current_private_message_envelope(text,uuid,text) from public,anon,authenticated,service_role;

alter function public.send_private_encrypted_message(text,uuid,text,text,jsonb,uuid) set schema private;
alter function private.send_private_encrypted_message(text,uuid,text,text,jsonb,uuid) rename to send_private_message_before_envelope_check;
revoke all on function private.send_private_message_before_envelope_check(text,uuid,text,text,jsonb,uuid) from public,anon,authenticated,service_role;
create function public.send_private_encrypted_message(p_conversation_kind text,p_conversation_id uuid,p_ciphertext text,p_encryption_iv text,
 p_encrypted_attachments jsonb default '[]'::jsonb,p_reply_to_id uuid default null,p_envelope_token text default null) returns uuid
language plpgsql security definer set search_path='' as $$
begin
 perform private.assert_current_private_message_envelope(p_conversation_kind,p_conversation_id,p_envelope_token);
 return private.send_private_message_before_envelope_check(p_conversation_kind,p_conversation_id,p_ciphertext,p_encryption_iv,p_encrypted_attachments,p_reply_to_id);
end $$;
revoke all on function public.send_private_encrypted_message(text,uuid,text,text,jsonb,uuid,text) from public,anon;
grant execute on function public.send_private_encrypted_message(text,uuid,text,text,jsonb,uuid,text) to authenticated;

alter function public.send_friend_encrypted_message(uuid,text,text,jsonb,uuid,uuid) set schema private;
alter function private.send_friend_encrypted_message(uuid,text,text,jsonb,uuid,uuid) rename to send_friend_message_before_envelope_check;
revoke all on function private.send_friend_message_before_envelope_check(uuid,text,text,jsonb,uuid,uuid) from public,anon,authenticated,service_role;
create function public.send_friend_encrypted_message(p_friend_id uuid,p_ciphertext text,p_encryption_iv text,
 p_encrypted_attachments jsonb default '[]'::jsonb,p_reply_to_id uuid default null,p_client_message_id uuid default null,p_envelope_token text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare person text:=public.current_profile_user_id();
begin
 if person is null or not public._property_document_session_active() then raise exception 'A trusted account session is required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('friend:'||p_friend_id::text,0));
 -- A lost response may be retried after rotation. Confirm the already-saved
 -- command through its original ownership/access checks; never send it twice.
 if p_client_message_id is not null and exists(select 1 from public.friend_messages m
  where m.id=p_client_message_id and m.friend_id=p_friend_id and m.sender_id=person) then
  return private.send_friend_message_before_envelope_check(p_friend_id,p_ciphertext,p_encryption_iv,p_encrypted_attachments,p_reply_to_id,p_client_message_id);
 end if;
 perform private.assert_current_private_message_envelope('friend',p_friend_id,p_envelope_token);
 return private.send_friend_message_before_envelope_check(p_friend_id,p_ciphertext,p_encryption_iv,p_encrypted_attachments,p_reply_to_id,p_client_message_id);
end $$;
revoke all on function public.send_friend_encrypted_message(uuid,text,text,jsonb,uuid,uuid,text) from public,anon;
grant execute on function public.send_friend_encrypted_message(uuid,text,text,jsonb,uuid,uuid,text) to authenticated;
