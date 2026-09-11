-- A hotel conversation remains readable as stay history, but new direct hotel
-- contact is valid only from confirmation through the active stay.

create or replace function public.open_my_hotel_booking_conversation(p_booking_id integer)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text;
  v_booking public.hotel_bookings;
  v_conversation_id uuid;
begin
  select profile.user_id into v_actor from public.profiles profile
  where profile.auth_id=(select auth.uid())::text
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
  limit 1;
  if v_actor is null then raise exception 'Active WeHouse account required'; end if;
  select * into v_booking from public.hotel_bookings
  where booking_id=p_booking_id for share;
  if v_booking.booking_id is null or v_booking.user_id<>v_actor then
    raise exception 'Hotel booking not found';
  end if;
  if v_booking.payment_status<>'paid'
     or v_booking.status not in ('confirmed','checked_in') then
    raise exception 'Hotel chat is available from confirmation until checkout';
  end if;
  insert into public.hotel_booking_conversations(booking_id,hotel_id,guest_user_id)
  values(v_booking.booking_id,v_booking.hotel_id,v_booking.user_id)
  on conflict(booking_id) do update
  set updated_at=public.hotel_booking_conversations.updated_at
  returning id into v_conversation_id;
  return v_conversation_id;
end;
$$;

create or replace function public.send_hotel_booking_message(
  p_conversation_id uuid,
  p_content text default '',
  p_attachments text[] default '{}',
  p_attachment_types text[] default '{}',
  p_reply_to_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text;
  v_message_id uuid;
  v_booking public.hotel_bookings;
begin
  select profile.user_id into v_actor from public.profiles profile
  where profile.auth_id=(select auth.uid())::text
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
  limit 1;
  if v_actor is null
     or not public.can_access_hotel_booking_conversation(p_conversation_id) then
    raise exception 'Hotel conversation access denied';
  end if;
  select booking.* into v_booking
  from public.hotel_booking_conversations conversation
  join public.hotel_bookings booking on booking.booking_id=conversation.booking_id
  where conversation.id=p_conversation_id
  for share of booking;
  if v_booking.payment_status<>'paid'
     or v_booking.status not in ('confirmed','checked_in') then
    raise exception 'This stay conversation closed at checkout';
  end if;
  if nullif(btrim(coalesce(p_content,'')),'') is null
     and cardinality(coalesce(p_attachments,'{}'))=0 then
    raise exception 'Write a message or attach a file';
  end if;
  if cardinality(coalesce(p_attachments,'{}'))
       <>cardinality(coalesce(p_attachment_types,'{}'))
     or cardinality(coalesce(p_attachments,'{}'))>6 then
    raise exception 'Invalid attachments';
  end if;
  if exists(
    select 1 from unnest(coalesce(p_attachments,'{}')) path
    where split_part(path,'/',1)<>p_conversation_id::text
       or split_part(path,'/',2)<>v_actor
  ) then raise exception 'Invalid private hotel attachment path'; end if;
  if p_reply_to_id is not null and not exists(
    select 1 from public.hotel_booking_messages message
    where message.id=p_reply_to_id and message.conversation_id=p_conversation_id
      and not v_actor=any(coalesce(message.hidden_for,'{}'::text[]))
  ) then raise exception 'Reply target is not in this conversation'; end if;
  insert into public.hotel_booking_messages(
    conversation_id,sender_id,content,attachments,attachment_types,reply_to_id
  ) values(
    p_conversation_id,v_actor,btrim(coalesce(p_content,'')),
    coalesce(p_attachments,'{}'),coalesce(p_attachment_types,'{}'),p_reply_to_id
  ) returning id into v_message_id;
  update public.hotel_booking_conversations set updated_at=now()
  where id=p_conversation_id;
  return v_message_id;
end;
$$;

revoke all on function public.open_my_hotel_booking_conversation(integer) from public,anon;
revoke all on function public.send_hotel_booking_message(uuid,text,text[],text[],uuid) from public,anon;
grant execute on function public.open_my_hotel_booking_conversation(integer) to authenticated,service_role;
grant execute on function public.send_hotel_booking_message(uuid,text,text[],text[],uuid) to authenticated,service_role;
