-- Preserve the original key-reset validation, identity, backup and ciphertext.
-- Add the Friend relationship omitted by the original Roommate/Service reset.
alter function public.reset_my_encryption_identity(jsonb,text,text,text,integer) set schema private;
alter function private.reset_my_encryption_identity(jsonb,text,text,text,integer) rename to reset_identity_before_friend_support;
revoke all on function private.reset_identity_before_friend_support(jsonb,text,text,text,integer) from public,anon,authenticated,service_role;

create function public.reset_my_encryption_identity(p_public_key_jwk jsonb,p_encrypted_private_key text,
 p_backup_iv text,p_backup_salt text,p_kdf_iterations integer default 600000) returns integer
language plpgsql security definer set search_path='' as $$
declare person text:=public.current_profile_user_id();key_version integer;conversation record;budget jsonb;
begin
 if person is null or not public._property_document_session_active() then raise exception 'A trusted account session is required' using errcode='42501';end if;
 budget:=private.consume_user_action(person,'private_chat_identity_reset',5,3600);
 if not coalesce((budget->>'allowed')::boolean,false) then
  raise exception 'Too many private-message resets. Wait before trying again.' using errcode='53400';end if;
 perform pg_advisory_xact_lock(hashtextextended('e2ee-reset:'||person,0));
 -- The same locks as establish_private_conversation_key prevent a setup/reset
 -- race from leaving envelopes for only one participant. Keep one lock order.
 for conversation in
  select distinct e.conversation_kind,e.conversation_id from public.conversation_key_envelopes e
  where (e.conversation_kind='roommate' and exists(select 1 from public.conversations c
    where c.id=e.conversation_id and person in(c.participant_a,c.participant_b)))
   or (e.conversation_kind='worker' and exists(select 1 from public.booking_conversations c
    where c.id=e.conversation_id and person in(c.user_id,c.worker_id)))
   or (e.conversation_kind='friend' and exists(select 1 from public.friends f
    where f.id=e.conversation_id and person in(f.user_low,f.user_high)))
  order by e.conversation_kind,e.conversation_id
 loop
  perform pg_advisory_xact_lock(hashtextextended(conversation.conversation_kind||':'||conversation.conversation_id::text,0));
 end loop;
 key_version:=private.reset_identity_before_friend_support(p_public_key_jwk,p_encrypted_private_key,p_backup_iv,p_backup_salt,p_kdf_iterations);
 delete from public.conversation_key_envelopes e where e.conversation_kind='friend'
 and exists(select 1 from public.friends f where f.id=e.conversation_id and person in(f.user_low,f.user_high));
 return key_version;
end $$;
revoke all on function public.reset_my_encryption_identity(jsonb,text,text,text,integer) from public,anon;
grant execute on function public.reset_my_encryption_identity(jsonb,text,text,text,integer) to authenticated;

-- Contacts subscribe only while a private conversation is open. Rotation emits
-- one metadata-only signal, regardless of the number of old conversations.
create function public.can_observe_private_identity_key(p_peer_user_id text) returns boolean
language sql stable security definer set search_path='' as $$
 select public.current_profile_user_id() is not null and public._property_document_session_active()
 and length(p_peer_user_id) between 1 and 80 and (
  public.current_profile_user_id()=p_peer_user_id
  or exists(select 1 from public.friends f where f.status='accepted'
   and public.current_profile_user_id() in(f.user_low,f.user_high) and p_peer_user_id in(f.user_low,f.user_high))
  or exists(select 1 from public.conversations c where public.current_profile_user_id() in(c.participant_a,c.participant_b)
   and p_peer_user_id in(c.participant_a,c.participant_b))
  or exists(select 1 from public.booking_conversations c where public.current_profile_user_id() in(c.user_id,c.worker_id)
   and p_peer_user_id in(c.user_id,c.worker_id))
 );
$$;
revoke all on function public.can_observe_private_identity_key(text) from public,anon;
grant execute on function public.can_observe_private_identity_key(text) to authenticated;

create policy "Private identity changes require an existing conversation"
on realtime.messages for select to authenticated
using(extension='broadcast' and topic like 'wehouse:e2ee-key:%'
 and public.can_observe_private_identity_key(substr(topic,length('wehouse:e2ee-key:')+1)));

create function private.broadcast_private_identity_key_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.key_version is not distinct from old.key_version then return null;end if;
 perform realtime.send(jsonb_build_object('user_id',new.user_id,'key_version',new.key_version),
  'e2ee_identity_changed','wehouse:e2ee-key:'||new.user_id,true);
 return null;
end $$;
revoke all on function private.broadcast_private_identity_key_change() from public,anon,authenticated,service_role;
create trigger private_identity_key_change after insert or update of key_version on public.user_encryption_identities
 for each row execute function private.broadcast_private_identity_key_change();

