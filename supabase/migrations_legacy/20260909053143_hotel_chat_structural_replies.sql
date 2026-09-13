alter table public.hotel_booking_messages
  add column if not exists reply_to_id uuid
  references public.hotel_booking_messages(id) on delete set null;

create index if not exists hotel_booking_messages_reply_to_idx
  on public.hotel_booking_messages(reply_to_id)
  where reply_to_id is not null;

drop function if exists public.get_hotel_booking_messages(uuid);
create function public.get_hotel_booking_messages(p_conversation_id uuid)
returns table(
  id uuid, sender_id text, sender_name text, sender_role text, content text,
  attachments text[], attachment_types text[], reactions jsonb,
  is_read boolean, reply_to_id uuid, created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare actor_id text;
begin
  select user_id into actor_id from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)
  limit 1;
  if actor_id is null or not public.can_access_hotel_booking_conversation(p_conversation_id) then
    raise exception 'Hotel conversation access denied';
  end if;
  return query
  select m.id,m.sender_id,coalesce(p.full_name,p.username,'Member'),
    case when m.sender_id=c.guest_user_id then 'guest' else 'hotel' end,
    m.content,m.attachments,m.attachment_types,m.reactions,m.is_read,m.reply_to_id,m.created_at
  from public.hotel_booking_messages m
  join public.hotel_booking_conversations c on c.id=m.conversation_id
  join public.profiles p on p.user_id=m.sender_id
  where m.conversation_id=p_conversation_id
    and not actor_id=any(coalesce(m.hidden_for,'{}'::text[]))
  order by m.created_at;
end;
$$;

drop function if exists public.send_hotel_booking_message(uuid,text,text[],text[]);
create function public.send_hotel_booking_message(
  p_conversation_id uuid,
  p_content text default '',
  p_attachments text[] default '{}',
  p_attachment_types text[] default '{}',
  p_reply_to_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare actor_id text; message_id uuid; booking public.hotel_bookings;
begin
  select user_id into actor_id from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)
  limit 1;
  if actor_id is null or not public.can_access_hotel_booking_conversation(p_conversation_id) then
    raise exception 'Hotel conversation access denied';
  end if;
  select b.* into booking from public.hotel_booking_conversations c
  join public.hotel_bookings b on b.booking_id=c.booking_id
  where c.id=p_conversation_id for share of b;
  if booking.payment_status<>'paid' or booking.status not in ('confirmed','checked_in','checked_out','completed') then
    raise exception 'This hotel conversation is not currently open';
  end if;
  if nullif(btrim(coalesce(p_content,'')),'') is null and cardinality(coalesce(p_attachments,'{}'))=0 then
    raise exception 'Write a message or attach a file';
  end if;
  if cardinality(coalesce(p_attachments,'{}'))<>cardinality(coalesce(p_attachment_types,'{}'))
    or cardinality(coalesce(p_attachments,'{}'))>6 then raise exception 'Invalid attachments'; end if;
  if exists(
    select 1 from unnest(coalesce(p_attachments,'{}')) path
    where split_part(path,'/',1)<>p_conversation_id::text or split_part(path,'/',2)<>actor_id
  ) then raise exception 'Invalid private hotel attachment path'; end if;
  if p_reply_to_id is not null and not exists(
    select 1 from public.hotel_booking_messages
    where id=p_reply_to_id and conversation_id=p_conversation_id
      and not actor_id=any(coalesce(hidden_for,'{}'::text[]))
  ) then raise exception 'Reply target is not in this conversation'; end if;
  insert into public.hotel_booking_messages(
    conversation_id,sender_id,content,attachments,attachment_types,reply_to_id
  ) values(
    p_conversation_id,actor_id,btrim(coalesce(p_content,'')),
    coalesce(p_attachments,'{}'),coalesce(p_attachment_types,'{}'),p_reply_to_id
  ) returning id into message_id;
  update public.hotel_booking_conversations set updated_at=now() where id=p_conversation_id;
  return message_id;
end;
$$;

revoke all on function public.get_hotel_booking_messages(uuid) from public, anon;
revoke all on function public.send_hotel_booking_message(uuid,text,text[],text[],uuid) from public, anon;
grant execute on function public.get_hotel_booking_messages(uuid) to authenticated, service_role;
grant execute on function public.send_hotel_booking_message(uuid,text,text[],text[],uuid) to authenticated, service_role;
