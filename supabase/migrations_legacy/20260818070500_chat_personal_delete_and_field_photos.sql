alter table public.messages add column if not exists hidden_for text[] not null default '{}'::text[];
alter table public.booking_messages add column if not exists hidden_for text[] not null default '{}'::text[];

create or replace function public.delete_conversation_message_for_me(p_kind text,p_message_id uuid)
returns boolean language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare v_actor public.profiles; v_conversation uuid;
begin
  v_actor:=public._current_comm_actor();
  if v_actor is null then raise exception 'Authentication required'; end if;
  if p_kind='roommate' then
    select conversation_id into v_conversation from public.messages where id=p_message_id;
    if v_conversation is null or not public._can_access_conversation(v_conversation) then raise exception 'Message unavailable'; end if;
    update public.messages set hidden_for=array_append(hidden_for,v_actor.user_id) where id=p_message_id and not(v_actor.user_id=any(hidden_for));
  elsif p_kind='worker' then
    select bm.conversation_id into v_conversation from public.booking_messages bm join public.booking_conversations bc on bc.id=bm.conversation_id where bm.id=p_message_id and v_actor.user_id in(bc.user_id,bc.worker_id);
    if v_conversation is null then raise exception 'Message unavailable'; end if;
    update public.booking_messages set hidden_for=array_append(hidden_for,v_actor.user_id) where id=p_message_id and not(v_actor.user_id=any(hidden_for));
  else raise exception 'Unsupported message type'; end if;
  return true;
end $$;

create or replace function public.get_roommate_messages_v2(p_conversation_id uuid)
returns table(id uuid,conversation_id uuid,sender_id text,content text,seen boolean,created_at timestamptz,edited_at timestamptz,file_url text,file_name text,file_type text,attachments text[],attachment_types text[])
language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare v_actor public.profiles;
begin
  v_actor:=public._current_comm_actor();
  if v_actor is null or not public._can_access_conversation(p_conversation_id) then raise exception 'Not authorized for this conversation'; end if;
  return query select m.id,m.conversation_id,m.sender_id,m.content,m.seen,m.created_at,m.edited_at,m.file_url,m.file_name,m.file_type,m.attachments,m.attachment_types from public.messages m where m.conversation_id=p_conversation_id and not(v_actor.user_id=any(m.hidden_for)) order by m.created_at;
end $$;

create or replace function public.get_booking_messages(p_conversation_id uuid)
returns table(id uuid,sender_id text,sender_name text,sender_role text,content text,attachments text[],is_read boolean,created_at timestamptz)
language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare v_actor public.profiles; v_conv public.booking_conversations;
begin
  v_actor:=public._current_comm_actor();
  if v_actor is null then raise exception 'Authentication required'; end if;
  select * into v_conv from public.booking_conversations where id=p_conversation_id;
  if v_conv is null or v_actor.user_id not in(v_conv.user_id,v_conv.worker_id) then raise exception 'Not authorized for this booking conversation'; end if;
  return query select bm.id,bm.sender_id,p.full_name,p.role,bm.content,bm.attachments,bm.is_read,bm.created_at from public.booking_messages bm join public.profiles p on p.user_id=bm.sender_id where bm.conversation_id=p_conversation_id and not(v_actor.user_id=any(bm.hidden_for)) order by bm.created_at;
end $$;

create or replace function public.field_officer_add_inspection_photos(p_inspection_id uuid,p_photo_urls text[])
returns boolean language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare v_actor public.profiles;
begin
  v_actor:=public._current_comm_actor();
  if v_actor is null or v_actor.role<>'staff' or not public.current_staff_has_permission('field_officer') then raise exception 'Field Officer access required'; end if;
  if coalesce(array_length(p_photo_urls,1),0)=0 then raise exception 'Inspection photos are required'; end if;
  update public.inspection_requests set photo_urls=array(select distinct unnest(coalesce(photo_urls,'{}'::text[])||p_photo_urls)),updated_at=now() where id=p_inspection_id and coalesce(assigned_field_officer_id,field_officer_id,assigned_to)=v_actor.user_id;
  if found then return true; end if;
  update public.user_inspection_requests set photo_urls=array(select distinct unnest(coalesce(photo_urls,'{}'::text[])||p_photo_urls)),updated_at=now() where id=p_inspection_id and field_officer_id=v_actor.user_id;
  if not found then raise exception 'Inspection is not assigned to this Field Officer'; end if;
  return true;
end $$;

revoke all on function public.delete_conversation_message_for_me(text,uuid),public.get_roommate_messages_v2(uuid),public.get_booking_messages(uuid),public.field_officer_add_inspection_photos(uuid,text[]) from public,anon;
grant execute on function public.delete_conversation_message_for_me(text,uuid),public.get_roommate_messages_v2(uuid),public.get_booking_messages(uuid),public.field_officer_add_inspection_photos(uuid,text[]) to authenticated;
