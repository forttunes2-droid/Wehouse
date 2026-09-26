-- Chat uploads are photos/videos, plus recorded voice in existing voice-enabled
-- conversations. Identity documents and legal records retain separate workflows.
-- No existing messages or storage objects are deleted or rewritten.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
('support-files','support-files',false,26214400,array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime']),
('hotel-chat-files','hotel-chat-files',false,26214400,array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime','audio/webm','audio/mp4','audio/ogg','audio/wav','audio/x-wav']),
-- A private encrypted media object is ciphertext, NOT an arbitrary document.
-- 16 bytes are reserved for its AES-GCM authentication tag. RLS remains separate.
('chat-files','chat-files',false,26214416,array['application/octet-stream'])
on conflict(id) do update set public=false,
 file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

create or replace function private.guard_chat_media_message()
returns trigger language plpgsql security definer
set search_path='pg_catalog','public'
as $$
declare
 v_bucket text; v_allow_voice boolean; v_count integer; v_i integer;
 v_path text; v_type text; v_stored jsonb; v_size numeric; v_parts text[]; v_ext text;
begin
 -- A receipt, reaction, or unrelated update must still work on historical rows.
 if tg_op='UPDATE' and new.attachments is not distinct from old.attachments
    and new.attachment_types is not distinct from old.attachment_types then return new; end if;
 v_bucket:=case tg_table_name when 'hotel_booking_messages' then 'hotel-chat-files'
   when 'partner_support_messages' then 'support-files' else null end;
 if v_bucket is null then raise exception 'Invalid chat media guard target'; end if;
 v_allow_voice:=v_bucket='hotel-chat-files';
 v_count:=coalesce(cardinality(new.attachments),0);
 if v_count<>coalesce(cardinality(new.attachment_types),0) or v_count>6 then
   raise exception 'Chat media metadata mismatch' using errcode='22023';
 end if;
 if v_count=0 then return new; end if;
 if coalesce(array_ndims(new.attachments),0)<>1 or array_lower(new.attachments,1)<>1
    or coalesce(array_ndims(new.attachment_types),0)<>1 or array_lower(new.attachment_types,1)<>1 then
   raise exception 'Chat media metadata mismatch' using errcode='22023';
 end if;
 for v_i in 1..v_count loop
   v_path:=new.attachments[v_i]; v_type:=lower(btrim(split_part(coalesce(new.attachment_types[v_i],''),';',1)));
   if not (v_type=any(array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime'])
      or (v_allow_voice and v_type=any(array['audio/webm','audio/mp4','audio/ogg','audio/wav','audio/x-wav']))) then
     raise exception 'Chat permits photos and videos, not document uploads' using errcode='22023';
   end if;
   if v_path is null or v_path='' or length(v_path)>1024 or v_path ~ '[[:cntrl:]]' or position(chr(92) in v_path)>0
      or v_path ~ '(^|/)\.\.(/|$)' then raise exception 'Invalid chat media path' using errcode='22023'; end if;
   v_parts:=string_to_array(v_path,'/');
   if v_bucket='hotel-chat-files' then
     if cardinality(v_parts)<>3 or v_parts[1]<>new.conversation_id::text or v_parts[2]<>new.sender_id then
       raise exception 'Chat media belongs to another conversation' using errcode='42501'; end if;
   elsif v_parts[1]='drafts' then
     if cardinality(v_parts)<>4 or v_parts[2]<>new.sender_id or not exists(
       select 1 from public.support_message_drafts d where d.draft_id::text=v_parts[3]
       and d.requester_id=new.sender_id and d.consumed_at is null and d.expires_at>now()
     ) then raise exception 'Chat media belongs to another draft' using errcode='42501'; end if;
   elsif cardinality(v_parts)<>2 or v_parts[1]<>new.conversation_id::text then
     raise exception 'Chat media belongs to another conversation' using errcode='42501';
   end if;
   v_ext:=lower(substring(v_parts[cardinality(v_parts)] from '\.([a-zA-Z0-9]+)$'));
   if v_ext is null or not (case v_type
     when 'image/jpeg' then v_ext=any(array['jpg','jpeg']) when 'image/png' then v_ext='png'
     when 'image/webp' then v_ext='webp' when 'image/gif' then v_ext='gif'
     when 'video/mp4' then v_ext=any(array['mp4','m4v']) when 'video/webm' then v_ext='webm'
     when 'video/quicktime' then v_ext='mov' when 'audio/webm' then v_ext='webm'
     when 'audio/mp4' then v_ext=any(array['mp4','m4a']) when 'audio/ogg' then v_ext=any(array['ogg','oga'])
     when 'audio/wav' then v_ext='wav' when 'audio/x-wav' then v_ext='wav' else false end) then
     raise exception 'Chat media filename and type do not agree' using errcode='22023'; end if;
   select o.metadata into v_stored from storage.objects o where o.bucket_id=v_bucket and o.name=v_path;
   if not found then raise exception 'Chat media upload is incomplete' using errcode='22023'; end if;
   if lower(btrim(split_part(coalesce(v_stored->>'mimetype',''),';',1)))<>v_type then
     raise exception 'Chat media storage type does not agree' using errcode='22023'; end if;
   begin v_size:=(v_stored->>'size')::numeric;
   exception when others then raise exception 'Chat media size is invalid' using errcode='22023'; end;
   if v_size is null or v_size<=0 or v_size>26214400 or v_size::text in('NaN','Infinity','-Infinity') then
     raise exception 'Chat media size is invalid' using errcode='22023'; end if;
 end loop;
 return new;
end;
$$;
revoke all on function private.guard_chat_media_message() from public,anon,authenticated;
drop trigger if exists guard_chat_media_message on public.hotel_booking_messages;
create trigger guard_chat_media_message before insert or update of attachments,attachment_types
 on public.hotel_booking_messages for each row execute function private.guard_chat_media_message();
drop trigger if exists guard_chat_media_message on public.partner_support_messages;
create trigger guard_chat_media_message before insert or update of attachments,attachment_types
 on public.partner_support_messages for each row execute function private.guard_chat_media_message();
comment on function private.guard_chat_media_message() is
 'Validates new plaintext chat references against existing private storage metadata. Preserves historical rows and existing actor/RLS checks. Not a content-scanner or a plaintext inspector for E2EE.';

-- Reproduce the encrypted-media access rules alongside the bucket. The previous
-- production policies only recognized legacy <conversation>/<file> paths; they
-- did not recognize the uploader's e2ee/<kind>/<conversation>/<file>.bin path.
create or replace function private.can_access_chat_cipher_object(p_name text,p_write boolean)
returns boolean language plpgsql stable security definer set search_path='pg_catalog','public'
as $$
declare p text[]:=string_to_array(p_name,'/'); c uuid; a text:=public.current_profile_user_id(); peer text;
begin
 if a is null or cardinality(p)<>4 or p[1]<>'e2ee' or p[4] !~ '^[a-zA-Z0-9_-]+\.bin$' then return false; end if;
 begin c:=p[3]::uuid; exception when invalid_text_representation then return false; end;
 if p[2]='roommate' then
  select case when participant_a=a then participant_b else participant_a end into peer from public.conversations
   where id=c and a in(participant_a,participant_b) and conversation_type='roommate'
    and coalesce(status,'active') in('active','accepted');
  if peer is null or exists(select 1 from public.roommate_user_blocks b where (b.blocker_user_id=a and b.blocked_user_id=peer) or (b.blocker_user_id=peer and b.blocked_user_id=a)) then return false; end if;
 elsif p[2]='worker' then
  select case when bc.user_id=a then bc.worker_id else bc.user_id end into peer from public.booking_conversations bc
   join public.worker_bookings b on b.id=bc.booking_id where bc.id=c and a in(bc.user_id,bc.worker_id)
    and (not p_write or b.status not in('approved_released','cancelled','refunded'));
  if peer is null or exists(select 1 from public.worker_user_blocks b where (b.blocker_user_id=a and b.blocked_user_id=peer) or (b.blocker_user_id=peer and b.blocked_user_id=a)) then return false; end if;
 else return false; end if;
 return true;
end $$;
revoke all on function private.can_access_chat_cipher_object(text,boolean) from public,anon;
grant execute on function private.can_access_chat_cipher_object(text,boolean) to authenticated;
-- Functions used by policies need EXECUTE, but are not in the public RPC schema.
grant usage on schema private to authenticated;
drop policy if exists chat_cipher_media_insert on storage.objects;
create policy chat_cipher_media_insert on storage.objects for insert to authenticated
 with check(bucket_id='chat-files' and private.can_access_chat_cipher_object(name,true) and owner_id=auth.uid()::text);
drop policy if exists chat_cipher_media_read on storage.objects;
create policy chat_cipher_media_read on storage.objects for select to authenticated
 using(bucket_id='chat-files' and private.can_access_chat_cipher_object(name,false));
drop policy if exists chat_cipher_media_delete_own on storage.objects;
create policy chat_cipher_media_delete_own on storage.objects for delete to authenticated
 using(bucket_id='chat-files' and private.can_access_chat_cipher_object(name,false) and owner_id=auth.uid()::text);
-- No UPDATE policy: do not let another participant replace a sent ciphertext.

create or replace function private.guard_private_chat_media_reference()
returns trigger language plpgsql security definer set search_path='pg_catalog','public'
as $$
declare k text; items jsonb:=coalesce(new.encrypted_attachments,'[]'::jsonb); item jsonb; p text; m jsonb;
begin
 if tg_op='UPDATE' and new.attachments is not distinct from old.attachments
    and new.encrypted_attachments is not distinct from old.encrypted_attachments then return new; end if;
 if coalesce(cardinality(new.attachments),0)>0 then
  raise exception 'New private chat media must use the encrypted-media upload flow' using errcode='22023'; end if;
 if jsonb_typeof(items)<>'array' or jsonb_array_length(items)>6 then raise exception 'Invalid private media list' using errcode='22023'; end if;
 k:=case tg_table_name when 'messages' then 'roommate' when 'booking_messages' then 'worker' else null end;
 if k is null then raise exception 'Invalid encrypted media guard target'; end if;
 for item in select value from jsonb_array_elements(items) loop
  p:=item->>'path';
  if jsonb_typeof(item)<>'object' or p is null or p !~ ('^e2ee/'||k||'/'||new.conversation_id::text||'/[a-zA-Z0-9_-]+\.bin$') then
   raise exception 'Private media belongs to another conversation' using errcode='42501'; end if;
  if not private.can_access_chat_cipher_object(p,true) or new.sender_id is distinct from public.current_profile_user_id() then
   raise exception 'Private media sender is not authorised' using errcode='42501'; end if;
  if coalesce(item->>'file_iv','') !~ '^[A-Za-z0-9+/]{16}$'
    or coalesce(item->>'metadata_iv','') !~ '^[A-Za-z0-9+/]{16}$'
    or length(coalesce(item->>'metadata_ciphertext','')) not between 24 and 8192
    or coalesce(item->>'metadata_ciphertext','') !~ '^[A-Za-z0-9+/]+={0,2}$' then
   raise exception 'Invalid private media encryption metadata' using errcode='22023'; end if;
  select metadata into m from storage.objects where bucket_id='chat-files' and name=p;
  if not found or lower(coalesce(m->>'mimetype',''))<>'application/octet-stream'
    or coalesce(m->>'size','') !~ '^[0-9]+$' then
   raise exception 'Private media upload is incomplete' using errcode='22023'; end if;
  if (m->>'size')::numeric<=16 or (m->>'size')::numeric>26214416 then
   raise exception 'Private media size is invalid' using errcode='22023'; end if;
 end loop;
 return new;
end $$;
revoke all on function private.guard_private_chat_media_reference() from public,anon,authenticated;
drop trigger if exists guard_private_chat_media_reference on public.messages;
create trigger guard_private_chat_media_reference before insert or update of attachments,encrypted_attachments
 on public.messages for each row execute function private.guard_private_chat_media_reference();
drop trigger if exists guard_private_chat_media_reference on public.booking_messages;
create trigger guard_private_chat_media_reference before insert or update of attachments,encrypted_attachments
 on public.booking_messages for each row execute function private.guard_private_chat_media_reference();

commit;
