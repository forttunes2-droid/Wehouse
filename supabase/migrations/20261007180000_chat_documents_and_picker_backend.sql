begin;

-- Chat files remain private. Documents are allowed alongside existing media.
do $$
declare
  v_documents text[] := array[
    'application/pdf','application/msword','application/rtf','application/vnd.ms-word',
    'application/vnd.ms-excel','application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip','application/json','application/xml','text/plain','text/csv','text/markdown'
  ];
begin
  update storage.buckets
  set allowed_mime_types = array(
    select distinct value from unnest(
      coalesce(allowed_mime_types,array[]::text[]) || v_documents
    ) as value
    order by value
  )
  where id in ('support-files','hotel-chat-files','property-host-chat-files');
end $$;

create or replace function private.guard_chat_media_message()
returns trigger language plpgsql security definer
set search_path='pg_catalog','public'
as $$
declare
 v_bucket text; v_allow_voice boolean; v_count integer; v_i integer;
 v_path text; v_type text; v_stored jsonb; v_size numeric; v_parts text[]; v_ext text;
begin
 if tg_op='UPDATE' and new.attachments is not distinct from old.attachments
    and new.attachment_types is not distinct from old.attachment_types then return new; end if;
 v_bucket:=case tg_table_name when 'hotel_booking_messages' then 'hotel-chat-files'
   when 'partner_support_messages' then 'support-files'
   when 'property_host_messages' then 'property-host-chat-files' else null end;
 if v_bucket is null then raise exception 'Invalid chat attachment guard target'; end if;
 v_allow_voice:=v_bucket='hotel-chat-files';
 v_count:=coalesce(cardinality(new.attachments),0);
 if v_count<>coalesce(cardinality(new.attachment_types),0) or v_count>6 then
   raise exception 'Chat attachment metadata mismatch' using errcode='22023';
 end if;
 if v_count=0 then return new; end if;
 if coalesce(array_ndims(new.attachments),0)<>1 or array_lower(new.attachments,1)<>1
    or coalesce(array_ndims(new.attachment_types),0)<>1 or array_lower(new.attachment_types,1)<>1 then
   raise exception 'Chat attachment metadata mismatch' using errcode='22023';
 end if;
 for v_i in 1..v_count loop
   v_path:=new.attachments[v_i];
   v_type:=lower(btrim(split_part(coalesce(new.attachment_types[v_i],''),';',1)));
   if not (
     v_type=any(array[
       'image/jpeg','image/png','image/webp','image/gif',
       'video/mp4','video/webm','video/quicktime',
       'application/pdf','application/msword','application/rtf','application/vnd.ms-word',
       'application/vnd.ms-excel','application/vnd.ms-powerpoint',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       'application/vnd.openxmlformats-officedocument.presentationml.presentation',
       'application/zip','application/json','application/xml','text/plain','text/csv','text/markdown'
     ])
     or (v_type like 'text/%' and v_type <> 'text/html')
     or (v_allow_voice and v_type=any(array['audio/webm','audio/mp4','audio/ogg','audio/wav','audio/x-wav']))
   ) then
     raise exception 'Unsupported chat attachment type' using errcode='22023';
   end if;
   if v_path is null or v_path='' or length(v_path)>1024 or v_path ~ '[[:cntrl:]]' or position(chr(92) in v_path)>0
      or v_path ~ '(^|/)\.\.(/|$)' then raise exception 'Invalid chat attachment path' using errcode='22023'; end if;
   v_parts:=string_to_array(v_path,'/');
   if v_bucket in ('hotel-chat-files','property-host-chat-files') then
     if cardinality(v_parts)<>3 or v_parts[1]<>new.conversation_id::text or v_parts[2]<>new.sender_id then
       raise exception 'Chat attachment belongs to another conversation' using errcode='42501'; end if;
   elsif v_parts[1]='drafts' then
     if cardinality(v_parts)<>4 or v_parts[2]<>new.sender_id or not exists(
       select 1 from public.support_message_drafts d where d.draft_id::text=v_parts[3]
       and d.requester_id=new.sender_id and d.consumed_at is null and d.expires_at>now()
     ) then raise exception 'Chat attachment belongs to another draft' using errcode='42501'; end if;
   elsif cardinality(v_parts)<>2 or v_parts[1]<>new.conversation_id::text then
     raise exception 'Chat attachment belongs to another conversation' using errcode='42501';
   end if;
   v_ext:=lower(substring(v_parts[cardinality(v_parts)] from '\.([a-zA-Z0-9]+)$'));
   if v_ext is null or not (
     case v_type
       when 'image/jpeg' then v_ext=any(array['jpg','jpeg'])
       when 'image/png' then v_ext='png'
       when 'image/webp' then v_ext='webp'
       when 'image/gif' then v_ext='gif'
       when 'video/mp4' then v_ext=any(array['mp4','m4v'])
       when 'video/webm' then v_ext='webm'
       when 'video/quicktime' then v_ext='mov'
       when 'audio/webm' then v_ext='webm'
       when 'audio/mp4' then v_ext=any(array['mp4','m4a'])
       when 'audio/ogg' then v_ext=any(array['ogg','oga'])
       when 'audio/wav' then v_ext='wav'
       when 'audio/x-wav' then v_ext='wav'
       when 'application/pdf' then v_ext='pdf'
       when 'application/msword' then v_ext='doc'
       when 'application/rtf' then v_ext='rtf'
       when 'application/vnd.ms-word' then v_ext=any(array['doc','dot'])
       when 'application/vnd.ms-excel' then v_ext=any(array['xls','xlt'])
       when 'application/vnd.ms-powerpoint' then v_ext=any(array['ppt','pot'])
       when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then v_ext='docx'
       when 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' then v_ext='xlsx'
       when 'application/vnd.openxmlformats-officedocument.presentationml.presentation' then v_ext='pptx'
       when 'application/zip' then v_ext='zip'
       when 'application/json' then v_ext='json'
       when 'application/xml' then v_ext='xml'
       when 'text/plain' then v_ext=any(array['txt','log'])
       when 'text/csv' then v_ext='csv'
       when 'text/markdown' then v_ext=any(array['md','markdown'])
       else v_type like 'text/%'
     end
   ) then raise exception 'Chat attachment filename and type do not agree' using errcode='22023'; end if;
   select o.metadata into v_stored from storage.objects o where o.bucket_id=v_bucket and o.name=v_path;
   if not found then raise exception 'Chat attachment upload is incomplete' using errcode='22023'; end if;
   if lower(btrim(split_part(coalesce(v_stored->>'mimetype',''),';',1)))<>v_type then
     raise exception 'Chat attachment storage type does not agree' using errcode='22023'; end if;
   begin v_size:=(v_stored->>'size')::numeric;
   exception when others then raise exception 'Chat attachment size is invalid' using errcode='22023'; end;
   if v_size is null or v_size<=0 or v_size>26214400 or v_size::text in('NaN','Infinity','-Infinity') then
     raise exception 'Chat attachment size is invalid' using errcode='22023'; end if;
 end loop;
 return new;
end;
$$;
revoke all on function private.guard_chat_media_message() from public,anon,authenticated;

drop trigger if exists guard_chat_media_message on public.hotel_booking_messages;
create trigger guard_chat_media_message before insert or update of attachments,attachment_types on public.hotel_booking_messages for each row execute function private.guard_chat_media_message();
drop trigger if exists guard_chat_media_message on public.partner_support_messages;
create trigger guard_chat_media_message before insert or update of attachments,attachment_types on public.partner_support_messages for each row execute function private.guard_chat_media_message();
drop trigger if exists guard_chat_media_message on public.property_host_messages;
create trigger guard_chat_media_message before insert or update of attachments,attachment_types on public.property_host_messages for each row execute function private.guard_chat_media_message();

create or replace function public.send_property_host_message(
  p_conversation_id uuid,
  p_content text,
  p_attachments text[] default array[]::text[],
  p_attachment_types text[] default array[]::text[],
  p_reply_to_id uuid default null
) returns uuid language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_conversation public.property_host_conversations;
  v_res public.reservations;
  v_id uuid;
  v_type text;
begin
  if v_actor is null or not public.property_host_conversation_access(p_conversation_id) then
    raise exception 'Conversation access denied';
  end if;
  select * into v_conversation from public.property_host_conversations
  where conversation_id=p_conversation_id for update;
  select * into v_res from public.reservations where id=v_conversation.reservation_id;
  if v_conversation.status<>'open'
     or v_res.status in ('cancelled','refunded','expired')
     or (v_res.status='completed' and v_res.updated_at<now()-interval '24 hours') then
    raise exception 'This booking conversation is closed';
  end if;
  if char_length(coalesce(p_content,''))>4000 then raise exception 'Message is too long'; end if;
  if cardinality(coalesce(p_attachments,array[]::text[]))<>cardinality(coalesce(p_attachment_types,array[]::text[]))
     or cardinality(coalesce(p_attachments,array[]::text[]))>8 then
    raise exception 'Message media is invalid';
  end if;
  foreach v_type in array coalesce(p_attachment_types,array[]::text[]) loop
    if v_type not in ('image','video','document') then
      raise exception 'Only supported photos, videos and documents can be attached';
    end if;
  end loop;
  if nullif(btrim(coalesce(p_content,'')),'') is null and cardinality(coalesce(p_attachments,array[]::text[]))=0 then
    raise exception 'Add a message or attachment';
  end if;
  if p_reply_to_id is not null and not exists(
    select 1 from public.property_host_messages
    where message_id=p_reply_to_id and conversation_id=p_conversation_id
  ) then raise exception 'Reply target is not in this conversation'; end if;

  insert into public.property_host_messages(
    conversation_id,sender_id,content,attachments,attachment_types,reply_to_id,is_read,created_at
  ) values(
    p_conversation_id,v_actor,nullif(btrim(coalesce(p_content,'')),''),
    coalesce(p_attachments,array[]::text[]),coalesce(p_attachment_types,array[]::text[]),
    p_reply_to_id,false,now()
  ) returning message_id into v_id;
  update public.property_host_conversations
  set last_message_at=now(),updated_at=now()
  where conversation_id=p_conversation_id;
  return v_id;
end
$$;
revoke all on function public.send_property_host_message(uuid,text,text[],text[],uuid) from public,anon;
grant execute on function public.send_property_host_message(uuid,text,text[],text[],uuid) to authenticated;

commit;