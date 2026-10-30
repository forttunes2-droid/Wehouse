-- Preserve one canonical key store. Device revocation applies to its direct
-- Data API access as well as messaging RPCs; only recovery may rotate identities.
revoke all on public.user_encryption_identities,public.conversation_key_envelopes from anon,authenticated;
grant select on public.user_encryption_identities,public.conversation_key_envelopes to authenticated;
grant insert(user_id,key_version,public_key_jwk,encrypted_private_key,backup_iv,backup_salt,kdf_iterations)
 on public.user_encryption_identities to authenticated;
grant update(encrypted_private_key,backup_iv,backup_salt,kdf_iterations,updated_at)
 on public.user_encryption_identities to authenticated;
create policy private_messaging_trusted_session on public.user_encryption_identities
 as restrictive for all to authenticated using((select public._property_document_session_active()))
 with check((select public._property_document_session_active()));
create policy private_messaging_trusted_session on public.conversation_key_envelopes
 as restrictive for all to authenticated using((select public._property_document_session_active()))
 with check((select public._property_document_session_active()));

alter function public.establish_private_conversation_key(text,uuid,jsonb) set schema private;
alter function private.establish_private_conversation_key(text,uuid,jsonb) rename to establish_key_before_recovery_lock;
revoke all on function private.establish_key_before_recovery_lock(text,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.establish_private_conversation_key(p_conversation_kind text,p_conversation_id uuid,p_envelopes jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();first_user text;second_user text;participant text;
begin
 if actor is null or not public._property_document_session_active() then raise exception 'A trusted account session is required' using errcode='42501';end if;
 if jsonb_typeof(p_envelopes) is distinct from 'array' or jsonb_array_length(p_envelopes)<>2
  or octet_length(p_envelopes::text)>32768 then raise exception 'Exactly two bounded participant envelopes are required' using errcode='22023';end if;
 if p_conversation_kind='friend' then
  select f.user_low,f.user_high into first_user,second_user from public.friends f
   where f.id=p_conversation_id and f.status='accepted' and actor in(f.user_low,f.user_high);
 elsif p_conversation_kind='roommate' then
  select c.participant_a,c.participant_b into first_user,second_user from public.conversations c
   where c.id=p_conversation_id and actor in(c.participant_a,c.participant_b);
 elsif p_conversation_kind='worker' then
  select c.user_id,c.worker_id into first_user,second_user from public.booking_conversations c
   where c.id=p_conversation_id and actor in(c.user_id,c.worker_id);
 else raise exception 'Unsupported private conversation' using errcode='22023';end if;
 if first_user is null or second_user is null then raise exception 'Conversation access denied' using errcode='42501';end if;
 -- New conversations are not in a reset's old-envelope inventory. Lock both
 -- identities first, consistently, so setup cannot race past either reset.
 for participant in select v from unnest(array[first_user,second_user]) members(v) order by v loop
  perform pg_advisory_xact_lock(hashtextextended('e2ee-reset:'||participant,0));
 end loop;
 return private.establish_key_before_recovery_lock(p_conversation_kind,p_conversation_id,p_envelopes);
end $$;
revoke all on function public.establish_private_conversation_key(text,uuid,jsonb) from public,anon,service_role;
grant execute on function public.establish_private_conversation_key(text,uuid,jsonb) to authenticated;
