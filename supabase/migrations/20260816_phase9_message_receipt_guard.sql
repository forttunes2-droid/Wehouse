create or replace function public.enforce_chat_message_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user_id text;
  v_window interval:=make_interval(mins=>public.message_edit_window_minutes());
begin
  if current_setting('request.jwt.claim.role',true)='service_role' then return new; end if;
  select user_id into v_user_id from public.profiles where auth_id=auth.uid()::text limit 1;
  if v_user_id is null then raise exception 'Authenticated profile required'; end if;

  if tg_table_name='messages' then
    if new.id is distinct from old.id or new.conversation_id is distinct from old.conversation_id or new.sender_id is distinct from old.sender_id or new.created_at is distinct from old.created_at or new.attachments is distinct from old.attachments or new.attachment_types is distinct from old.attachment_types or new.file_url is distinct from old.file_url or new.file_name is distinct from old.file_name or new.file_type is distinct from old.file_type then
      raise exception 'Message metadata cannot be changed';
    end if;
    if new.seen is distinct from old.seen then
      if old.sender_id=v_user_id then raise exception 'You cannot change the read receipt on your own sent message'; end if;
      if old.seen=true or new.seen<>true then raise exception 'Read receipts can only move from unread to read'; end if;
    end if;
    if new.content is distinct from old.content then
      if old.sender_id<>v_user_id then raise exception 'You can only edit your own messages'; end if;
      if now()>old.created_at+v_window then raise exception 'This message can no longer be edited'; end if;
      if nullif(btrim(coalesce(new.content,'')),'') is null and coalesce(array_length(old.attachments,1),0)=0 and nullif(btrim(coalesce(old.file_url,'')),'') is null then raise exception 'Message cannot be empty'; end if;
      new.content:=btrim(coalesce(new.content,''));
      new.edited_at:=now();
    else
      new.edited_at:=old.edited_at;
    end if;
    return new;
  end if;

  if tg_table_name='booking_messages' then
    if new.id is distinct from old.id or new.conversation_id is distinct from old.conversation_id or new.sender_id is distinct from old.sender_id or new.created_at is distinct from old.created_at or new.attachments is distinct from old.attachments then
      raise exception 'Message metadata cannot be changed';
    end if;
    if new.is_read is distinct from old.is_read then
      if old.sender_id=v_user_id then raise exception 'You cannot change the read receipt on your own sent message'; end if;
      if old.is_read=true or new.is_read<>true then raise exception 'Read receipts can only move from unread to read'; end if;
    end if;
    if new.content is distinct from old.content then
      if old.sender_id<>v_user_id then raise exception 'You can only edit your own messages'; end if;
      if now()>old.created_at+v_window then raise exception 'This message can no longer be edited'; end if;
      if nullif(btrim(coalesce(new.content,'')),'') is null and coalesce(array_length(old.attachments,1),0)=0 then raise exception 'Message cannot be empty'; end if;
      new.content:=btrim(coalesce(new.content,''));
      new.edited_at:=now();
    else
      new.edited_at:=old.edited_at;
    end if;
    return new;
  end if;

  return new;
end;
$$;
