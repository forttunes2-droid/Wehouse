-- One person/identity and one message store remain canonical. Device keys stay
-- client-side; the server may retain only an optional encrypted recovery copy.
alter table public.user_encryption_identities
 add column backup_scheme text not null default 'pin_v1',
 add column backup_credential_id text,
 add column backup_rp_id text,
 add column backup_auth_passkey_id uuid,
 add column backup_request_id uuid,
 add column backup_request_hash text;
alter table public.user_encryption_identities
 alter column encrypted_private_key drop not null,
 alter column backup_iv drop not null,
 alter column backup_salt drop not null,
 drop constraint user_encryption_identities_kdf_name_check,
 drop constraint user_encryption_identities_kdf_iterations_check;
alter table public.user_encryption_identities add constraint private_identity_backup_shape check (
 (backup_scheme='device_only' and encrypted_private_key is null and backup_iv is null and backup_salt is null
  and backup_credential_id is null and backup_rp_id is null and backup_auth_passkey_id is null and kdf_name='none' and kdf_iterations=0)
 or (backup_scheme='pin_v1' and encrypted_private_key is not null and backup_iv is not null and backup_salt is not null
  and kdf_name='PBKDF2-SHA-256' and kdf_iterations>=600000)
 or (backup_scheme='passkey_prf_v1' and encrypted_private_key is not null and backup_iv is not null and backup_salt is not null
  and backup_credential_id is not null and backup_rp_id is not null and kdf_name='HKDF-SHA-256' and kdf_iterations=0)
);
-- Browser writes now go through bounded, revision-checked commands. Historical
-- PIN backups are readable by their owner for a one-time, non-destructive upgrade.
revoke insert,update on public.user_encryption_identities from authenticated;
revoke insert(user_id,key_version,public_key_jwk,encrypted_private_key,backup_iv,backup_salt,kdf_iterations),
 update(encrypted_private_key,backup_iv,backup_salt,kdf_iterations,updated_at)
 on public.user_encryption_identities from authenticated;

create function private.validate_private_chat_public_key(p_key jsonb) returns void
language plpgsql set search_path='' as $$
begin
 if p_key is null or octet_length(p_key::text)>2048 or p_key ? 'd'
  or coalesce(p_key->>'kty','')<>'EC' or coalesce(p_key->>'crv','')<>'P-256'
  or coalesce(p_key->>'x','')!~'^[A-Za-z0-9_-]{43}$' or coalesce(p_key->>'y','')!~'^[A-Za-z0-9_-]{43}$' then
  raise exception 'Invalid private-chat public key' using errcode='22023';
 end if;
end $$;
revoke all on function private.validate_private_chat_public_key(jsonb) from public,anon,authenticated,service_role;

create function public.create_my_automatic_private_identity(p_public_key_jwk jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare person text:=public.current_profile_user_id();identity public.user_encryption_identities;created boolean:=false;
begin
 if person is null or not public._property_document_session_active() then raise exception 'A trusted account session is required' using errcode='42501';end if;
 perform private.validate_private_chat_public_key(p_public_key_jwk);
 perform pg_advisory_xact_lock(hashtextextended('e2ee-reset:'||person,0));
 insert into public.user_encryption_identities(user_id,key_version,public_key_jwk,backup_scheme,kdf_name,kdf_iterations)
 values(person,1,p_public_key_jwk,'device_only','none',0) on conflict(user_id) do nothing;
 created:=found;
 select * into strict identity from public.user_encryption_identities where user_id=person;
 return jsonb_build_object('user_id',person,'key_version',identity.key_version,'public_key_jwk',identity.public_key_jwk,
  'backup_scheme',identity.backup_scheme,'updated_at',identity.updated_at,'created',created);
end $$;
revoke all on function public.create_my_automatic_private_identity(jsonb) from public,anon,service_role;
grant execute on function public.create_my_automatic_private_identity(jsonb) to authenticated;

create function public.set_my_private_chat_backup(p_request_id uuid,p_key_version integer,p_revision timestamptz,p_scheme text,
 p_encrypted_private_key text default null,p_backup_iv text default null,p_backup_salt text default null,
 p_credential_id text default null,p_rp_id text default null,p_auth_passkey_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare person text:=public.current_profile_user_id();identity public.user_encryption_identities;fingerprint text;
begin
 if person is null or not public._property_document_session_active() then raise exception 'A trusted account session is required' using errcode='42501';end if;
 if p_request_id is null or p_scheme is null or p_scheme not in('device_only','passkey_prf_v1') then raise exception 'Choose a supported private-chat backup' using errcode='22023';end if;
 if p_scheme='passkey_prf_v1' and (length(coalesce(p_encrypted_private_key,'')) not between 32 and 20000
  or length(coalesce(p_backup_iv,''))<>16 or length(coalesce(p_backup_salt,''))<>44
  or length(coalesce(p_credential_id,'')) not between 1 and 2048 or p_credential_id!~'^[A-Za-z0-9_-]+$'
  or length(coalesce(p_rp_id,'')) not between 1 and 253 or p_rp_id!~'^[a-z0-9.-]+$') then
  raise exception 'Invalid encrypted passkey backup' using errcode='22023';end if;
 if p_scheme='device_only' and (p_encrypted_private_key is not null or p_backup_iv is not null or p_backup_salt is not null
  or p_credential_id is not null or p_rp_id is not null or p_auth_passkey_id is not null) then
  raise exception 'A device-only identity must not contain a server backup' using errcode='22023';end if;
 fingerprint:=encode(extensions.digest(jsonb_build_array(p_key_version,p_scheme,p_encrypted_private_key,p_backup_iv,
  p_backup_salt,p_credential_id,p_rp_id,p_auth_passkey_id)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('e2ee-reset:'||person,0));
 select * into identity from public.user_encryption_identities where user_id=person for update;
 if identity.user_id is null then raise exception 'Private-chat setup is required' using errcode='22023';end if;
 if identity.backup_request_id=p_request_id then
  if identity.backup_request_hash is distinct from fingerprint then raise exception 'This backup request was already used for different data' using errcode='22023';end if;
 elsif identity.key_version is distinct from p_key_version or identity.updated_at is distinct from p_revision then
  raise exception 'Private-chat backup changed. Refresh before trying again.' using errcode='40001';
 else
  update public.user_encryption_identities set backup_scheme=p_scheme,encrypted_private_key=p_encrypted_private_key,
   backup_iv=p_backup_iv,backup_salt=p_backup_salt,backup_credential_id=p_credential_id,backup_rp_id=p_rp_id,
   backup_auth_passkey_id=p_auth_passkey_id,kdf_name=case when p_scheme='device_only' then 'none' else 'HKDF-SHA-256' end,
   kdf_iterations=0,backup_request_id=p_request_id,backup_request_hash=fingerprint,updated_at=clock_timestamp()
   where user_id=person returning * into identity;
 end if;
 return jsonb_build_object('user_id',person,'key_version',identity.key_version,'backup_scheme',identity.backup_scheme,
  'updated_at',identity.updated_at,'request_id',identity.backup_request_id);
end $$;
revoke all on function public.set_my_private_chat_backup(uuid,integer,timestamptz,text,text,text,text,text,text,uuid) from public,anon,service_role;
grant execute on function public.set_my_private_chat_backup(uuid,integer,timestamptz,text,text,text,text,text,text,uuid) to authenticated;

-- Keep historical envelopes: replacing one person's lost device must not make
-- the other participant's already-received messages unreadable.
alter table public.conversation_key_envelopes add column key_id uuid,add column is_current boolean not null default true,
 add column legacy_generation boolean not null default true;
alter table public.conversation_key_envelopes alter column legacy_generation set default false;
with groups as materialized(select conversation_kind,conversation_id,gen_random_uuid() as key_id
 from public.conversation_key_envelopes group by conversation_kind,conversation_id)
update public.conversation_key_envelopes e set key_id=g.key_id from groups g
 where g.conversation_kind=e.conversation_kind and g.conversation_id=e.conversation_id;
alter table public.conversation_key_envelopes alter column key_id set not null,alter column key_id set default gen_random_uuid(),
 drop constraint conversation_key_envelopes_conversation_kind_conversation_i_key;
create unique index private_envelope_generation_recipient on public.conversation_key_envelopes(conversation_kind,conversation_id,key_id,recipient_user_id);
create unique index private_envelope_current_recipient on public.conversation_key_envelopes(conversation_kind,conversation_id,recipient_user_id) where is_current;
alter table public.messages add column encryption_key_id uuid;
alter table public.booking_messages add column encryption_key_id uuid;
alter table public.friend_messages add column encryption_key_id uuid;
-- No message-history rewrite or broadcast flood. Old rows resolve their legacy
-- generation once per reader statement; new rows record it in their insert.
create function private.legacy_private_message_key_id(p_kind text,p_conversation_id uuid) returns uuid
language sql stable security definer set search_path='' as $$
 select e.key_id from public.conversation_key_envelopes e where e.conversation_kind=p_kind
 and e.conversation_id=p_conversation_id and e.recipient_user_id=public.current_profile_user_id()
 and e.legacy_generation order by e.recipient_key_version desc limit 1;
$$;
revoke all on function private.legacy_private_message_key_id(text,uuid) from public,anon,authenticated,service_role;
create function private.record_private_message_key_id() returns trigger
language plpgsql security definer set search_path='' as $$
declare kind text;conversation uuid;
begin
 if new.ciphertext is null then return new;end if;
 if tg_table_name='friend_messages' then kind:='friend';conversation:=new.friend_id;
 elsif tg_table_name='booking_messages' then kind:='worker';conversation:=new.conversation_id;
 else kind:='roommate';conversation:=new.conversation_id;end if;
 select e.key_id into new.encryption_key_id from public.conversation_key_envelopes e
 where e.conversation_kind=kind and e.conversation_id=conversation and e.recipient_user_id=new.sender_id and e.is_current;
 return new;
end $$;
revoke all on function private.record_private_message_key_id() from public,anon,authenticated,service_role;
create trigger record_private_message_key_id before insert on public.messages for each row execute function private.record_private_message_key_id();
create trigger record_private_message_key_id before insert on public.booking_messages for each row execute function private.record_private_message_key_id();
create trigger record_private_message_key_id before insert on public.friend_messages for each row execute function private.record_private_message_key_id();
revoke insert,update,delete on public.messages,public.booking_messages,public.friend_messages from anon,authenticated;

create function public.start_my_new_private_identity(p_expected_version integer,p_revision timestamptz,p_public_key_jwk jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare person text:=public.current_profile_user_id();identity public.user_encryption_identities;conversation record;budget jsonb;
begin
 if person is null or not public._property_document_session_active() then raise exception 'A trusted account session is required' using errcode='42501';end if;
 perform private.validate_private_chat_public_key(p_public_key_jwk);
 perform pg_advisory_xact_lock(hashtextextended('e2ee-reset:'||person,0));
 select * into identity from public.user_encryption_identities where user_id=person for update;
 if identity.key_version=p_expected_version+1 and identity.public_key_jwk->>'x'=p_public_key_jwk->>'x'
  and identity.public_key_jwk->>'y'=p_public_key_jwk->>'y' then
  return jsonb_build_object('user_id',person,'key_version',identity.key_version,'public_key_jwk',identity.public_key_jwk,'backup_scheme',identity.backup_scheme,'updated_at',identity.updated_at);
 end if;
 if identity.key_version is distinct from p_expected_version or identity.updated_at is distinct from p_revision then
  raise exception 'Private-chat identity changed. Refresh before trying again.' using errcode='40001';end if;
 budget:=private.consume_user_action(person,'private_chat_identity_reset',5,3600);
 if not coalesce((budget->>'allowed')::boolean,false) then raise exception 'Too many private-chat restarts. Wait before trying again.' using errcode='53400';end if;
 for conversation in select distinct e.conversation_kind,e.conversation_id from public.conversation_key_envelopes e
  where e.is_current and e.recipient_user_id=person order by e.conversation_kind,e.conversation_id loop
  perform pg_advisory_xact_lock(hashtextextended(conversation.conversation_kind||':'||conversation.conversation_id::text,0));
  update public.conversation_key_envelopes set is_current=false
   where conversation_kind=conversation.conversation_kind and conversation_id=conversation.conversation_id and is_current;
 end loop;
 update public.user_encryption_identities set key_version=key_version+1,public_key_jwk=p_public_key_jwk,
  backup_scheme='device_only',encrypted_private_key=null,backup_iv=null,backup_salt=null,kdf_name='none',kdf_iterations=0,
  backup_credential_id=null,backup_rp_id=null,backup_auth_passkey_id=null,backup_request_id=null,backup_request_hash=null,
  rotated_at=clock_timestamp(),updated_at=clock_timestamp() where user_id=person returning * into identity;
 return jsonb_build_object('user_id',person,'key_version',identity.key_version,'public_key_jwk',identity.public_key_jwk,'backup_scheme',identity.backup_scheme,'updated_at',identity.updated_at);
end $$;
revoke all on function public.start_my_new_private_identity(integer,timestamptz,jsonb) from public,anon,service_role;
grant execute on function public.start_my_new_private_identity(integer,timestamptz,jsonb) to authenticated;
revoke all on function public.reset_my_encryption_identity(jsonb,text,text,text,integer) from public,anon,authenticated,service_role;

drop function public.establish_private_conversation_key(text,uuid,jsonb);
drop function private.establish_key_before_recovery_lock(text,uuid,jsonb);
create function public.establish_private_conversation_key(p_conversation_kind text,p_conversation_id uuid,p_envelopes jsonb,p_key_id uuid default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();a text;b text;person text;generation uuid:=coalesce(p_key_id,gen_random_uuid());
begin
 if actor is null or not public._property_document_session_active() then raise exception 'A trusted account session is required' using errcode='42501';end if;
 if jsonb_typeof(p_envelopes) is distinct from 'array' or jsonb_array_length(p_envelopes)<>2 or octet_length(p_envelopes::text)>32768 then
  raise exception 'Exactly two bounded participant envelopes are required' using errcode='22023';end if;
 if p_conversation_kind='friend' then select f.user_low,f.user_high into a,b from public.friends f where f.id=p_conversation_id and f.status='accepted' and actor in(f.user_low,f.user_high);
 elsif p_conversation_kind='roommate' then select c.participant_a,c.participant_b into a,b from public.conversations c where c.id=p_conversation_id and actor in(c.participant_a,c.participant_b);
 elsif p_conversation_kind='worker' then select c.user_id,c.worker_id into a,b from public.booking_conversations c where c.id=p_conversation_id and actor in(c.user_id,c.worker_id);
 else raise exception 'Unsupported private conversation' using errcode='22023';end if;
 if a is null or b is null then raise exception 'Conversation access denied' using errcode='42501';end if;
 for person in select v from unnest(array[a,b]) members(v) order by v loop perform pg_advisory_xact_lock(hashtextextended('e2ee-reset:'||person,0));end loop;
 perform pg_advisory_xact_lock(hashtextextended(p_conversation_kind||':'||p_conversation_id::text,0));
 if exists(select 1 from public.conversation_key_envelopes where conversation_kind=p_conversation_kind and conversation_id=p_conversation_id and is_current) then return false;end if;
 if not exists(select 1 from jsonb_array_elements(p_envelopes)e where e->>'recipient_user_id'=a)
  or not exists(select 1 from jsonb_array_elements(p_envelopes)e where e->>'recipient_user_id'=b) then raise exception 'Both conversation participants are required' using errcode='22023';end if;
 insert into public.conversation_key_envelopes(conversation_kind,conversation_id,recipient_user_id,recipient_key_version,sender_ephemeral_public_key_jwk,wrapped_key,wrap_iv,key_id,is_current)
 select p_conversation_kind,p_conversation_id,e->>'recipient_user_id',(e->>'recipient_key_version')::integer,e->'sender_ephemeral_public_key_jwk',e->>'wrapped_key',e->>'wrap_iv',generation,true
 from jsonb_array_elements(p_envelopes)e join public.user_encryption_identities i on i.user_id=e->>'recipient_user_id' and i.key_version=(e->>'recipient_key_version')::integer;
 if (select count(*) from public.conversation_key_envelopes where conversation_kind=p_conversation_kind and conversation_id=p_conversation_id and key_id=generation)<>2 then
  raise exception 'Both current participant keys are required' using errcode='22023';end if;
 return true;
end $$;
revoke all on function public.establish_private_conversation_key(text,uuid,jsonb,uuid) from public,anon,service_role;
grant execute on function public.establish_private_conversation_key(text,uuid,jsonb,uuid) to authenticated;

create or replace function private.assert_current_private_message_envelope(p_kind text,p_conversation_id uuid,p_token text) returns void
language plpgsql security definer set search_path='' as $$
declare person text:=public.current_profile_user_id();expected text;
begin
 if person is null or not public._property_document_session_active() then raise exception 'A trusted account session is required' using errcode='42501';end if;
 if p_kind not in('friend','roommate','worker') or p_conversation_id is null then raise exception 'Unsupported private conversation' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_kind||':'||p_conversation_id::text,0));
 select e.key_id::text||':'||e.recipient_key_version::text||':'||e.wrap_iv||':'||e.wrapped_key into expected
 from public.conversation_key_envelopes e join public.user_encryption_identities i on i.user_id=e.recipient_user_id and i.key_version=e.recipient_key_version
 where e.conversation_kind=p_kind and e.conversation_id=p_conversation_id and e.recipient_user_id=person and e.is_current;
 if p_token is null or length(p_token)>2048 or expected is null or p_token<>expected then
  raise exception 'Private-message keys changed. Refresh this chat and retry; your draft is kept.' using errcode='40001';end if;
end $$;

create or replace function public.send_private_encrypted_message(p_conversation_kind text,p_conversation_id uuid,p_ciphertext text,p_encryption_iv text,
 p_encrypted_attachments jsonb default '[]',p_reply_to_id uuid default null,p_envelope_token text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare message_id uuid;
begin
 perform private.assert_current_private_message_envelope(p_conversation_kind,p_conversation_id,p_envelope_token);
 message_id:=private.send_private_message_before_envelope_check(p_conversation_kind,p_conversation_id,p_ciphertext,p_encryption_iv,p_encrypted_attachments,p_reply_to_id);
 return message_id;
end $$;
create or replace function public.send_friend_encrypted_message(p_friend_id uuid,p_ciphertext text,p_encryption_iv text,
 p_encrypted_attachments jsonb default '[]',p_reply_to_id uuid default null,p_client_message_id uuid default null,p_envelope_token text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare person text:=public.current_profile_user_id();message_id uuid;
begin
 if person is null or not public._property_document_session_active() then raise exception 'A trusted account session is required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('friend:'||p_friend_id::text,0));
 if p_client_message_id is not null and exists(select 1 from public.friend_messages m where m.id=p_client_message_id and m.friend_id=p_friend_id and m.sender_id=person) then
  return private.send_friend_message_before_envelope_check(p_friend_id,p_ciphertext,p_encryption_iv,p_encrypted_attachments,p_reply_to_id,p_client_message_id);end if;
 perform private.assert_current_private_message_envelope('friend',p_friend_id,p_envelope_token);
 message_id:=private.send_friend_message_before_envelope_check(p_friend_id,p_ciphertext,p_encryption_iv,p_encrypted_attachments,p_reply_to_id,p_client_message_id);
 return message_id;
end $$;
-- Extend the existing authorized reader projections with their exact key generation.
drop function public.get_private_encrypted_messages(text,uuid);
CREATE OR REPLACE FUNCTION public.get_private_encrypted_messages(p_conversation_kind text, p_conversation_id uuid)
 RETURNS TABLE(id uuid, sender_id text, ciphertext text, encryption_iv text, encryption_version integer, encrypted_attachments jsonb, created_at timestamp with time zone, legacy_content text, is_read boolean, reply_to_id uuid, reactions jsonb, legacy_attachments text[], legacy_attachment_types text[], item_type text, item_payload jsonb, encryption_key_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor text:=public.current_profile_user_id();
begin
 if not public._property_document_session_active() then raise exception 'A trusted account session is required' using errcode='42501';end if;
  if actor is null then raise exception 'Active WeHouse profile required'; end if;
  if p_conversation_kind='roommate' then
    if not exists(
      select 1 from public.conversations c
      where c.id=p_conversation_id
        and actor in(c.participant_a,c.participant_b)
        and c.conversation_type='roommate'
        and coalesce(c.status,'active') in('active','accepted')
    ) then raise exception 'Conversation access denied'; end if;
    return query
    select m.id,m.sender_id,m.ciphertext,m.encryption_iv,m.encryption_version,
      coalesce(m.encrypted_attachments,'[]'::jsonb),m.created_at,
      case when m.ciphertext is null then m.content else null end,
      coalesce(m.seen,false),m.reply_to_id,coalesce(m.reactions,'{}'::jsonb),
      coalesce(m.attachments,'{}'::text[]),coalesce(m.attachment_types,'{}'::text[]),
      coalesce(m.item_type,'message'),
      case when m.item_type='property_share' then
        coalesce(m.item_payload,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object(
          'title',l.title,'image',l.images[1],'city',l.city,'state',l.state,
          'price',l.price,'currency','NGN',
          'product_type',case when l.sub_type='short_let' then 'short_let'
            when l.sub_type='long_stay' then 'long_let' else null end,
          'is_available',coalesce(l.deleted_at is null and l.status='available'
            and l.availability_status='available',false)
        )) else coalesce(m.item_payload,'{}'::jsonb) end,coalesce(m.encryption_key_id,(select private.legacy_private_message_key_id('roommate',p_conversation_id)))
    from public.messages m
    left join public.listings l on m.item_type='property_share'
      and l.id::text=m.item_payload->>'listing_id'
    where m.conversation_id=p_conversation_id
      and not(actor=any(coalesce(m.hidden_for,'{}'::text[])))
    order by m.created_at,m.id;
  elsif p_conversation_kind='worker' then
    if not exists(
      select 1 from public.booking_conversations c
      where c.id=p_conversation_id and actor in(c.user_id,c.worker_id)
    ) then raise exception 'Conversation access denied'; end if;
    return query
    select m.id,m.sender_id,m.ciphertext,m.encryption_iv,m.encryption_version,
      coalesce(m.encrypted_attachments,'[]'::jsonb),m.created_at,
      case when m.ciphertext is null then m.content else null end,
      coalesce(m.is_read,false),m.reply_to_id,coalesce(m.reactions,'{}'::jsonb),
      coalesce(m.attachments,'{}'::text[]),'{}'::text[],'message'::text,'{}'::jsonb,coalesce(m.encryption_key_id,(select private.legacy_private_message_key_id('worker',p_conversation_id)))
    from public.booking_messages m
    where m.conversation_id=p_conversation_id
      and not(actor=any(coalesce(m.hidden_for,'{}'::text[])))
    order by m.created_at,m.id;
  else
    raise exception 'Unsupported private conversation kind';
  end if;
end
$function$
;
revoke all on function public.get_private_encrypted_messages(text,uuid) from public,anon,service_role;
grant execute on function public.get_private_encrypted_messages(text,uuid) to authenticated;
drop function public.get_friend_encrypted_messages(uuid);
drop function public.get_friend_encrypted_messages_page(uuid,timestamptz,uuid,integer);
CREATE OR REPLACE FUNCTION public.get_friend_encrypted_messages_page(p_friend_id uuid, p_before_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 51)
 RETURNS TABLE(id uuid, sender_id text, ciphertext text, encryption_iv text, encryption_version integer, encrypted_attachments jsonb, reply_to_id uuid, created_at timestamp with time zone, reactions jsonb, encryption_key_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare actor text:=public.current_profile_user_id(); c public.friends;
begin
 c:=private.friend_chat_access(p_friend_id,false);
 if p_limit is null or p_limit<1 or p_limit>51 then raise exception 'Choose a message page size from 1 to 51';end if;
 if (p_before_at is null)<>(p_before_id is null) then raise exception 'Both message cursor fields are required';end if;
 if p_before_at is not null and not isfinite(p_before_at) then raise exception 'Invalid message cursor';end if;
 return query select m.id,m.sender_id,m.ciphertext,m.encryption_iv,m.encryption_version,
  m.encrypted_attachments,m.reply_to_id,m.created_at,m.reactions,coalesce(m.encryption_key_id,(select private.legacy_private_message_key_id('friend',p_friend_id)))
 from public.friend_messages m
 where m.friend_id=c.id and not (actor=any(m.hidden_for))
 and (p_before_at is null or (m.created_at,m.id)<(p_before_at,p_before_id))
 order by m.created_at desc,m.id desc limit p_limit;
end $function$
;
revoke all on function public.get_friend_encrypted_messages_page(uuid,timestamptz,uuid,integer) from public,anon,service_role;
grant execute on function public.get_friend_encrypted_messages_page(uuid,timestamptz,uuid,integer) to authenticated;
