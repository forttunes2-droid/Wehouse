-- Paid hotel stays already receive one deterministic conversation row. The
-- Inbox read model must return that row even before either side sends the first
-- message; otherwise the booking can have a valid thread that is invisible in
-- Inbox until somebody reaches chat through another route.

create or replace function public.get_my_hotel_booking_conversations()
returns table(
  conversation_id uuid,
  booking_id integer,
  hotel_id integer,
  hotel_name text,
  hotel_image text,
  booking_code text,
  booking_status text,
  payment_status text,
  check_in date,
  check_out date,
  room_name text,
  guest_user_id text,
  guest_name text,
  other_party_label text,
  last_message text,
  last_message_time timestamptz,
  unread_count bigint,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  actor_id text;
begin
  select user_id into actor_id
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;

  if actor_id is null then
    raise exception 'Active WeHouse account required';
  end if;

  return query
  select
    conversation.id,
    booking.booking_id,
    hotel.hotel_id,
    hotel.name,
    hotel.images[1],
    null::text,
    booking.status,
    booking.payment_status,
    booking.check_in,
    booking.check_out,
    room.room_type,
    booking.user_id,
    coalesce(booking.guest_name,guest.full_name,guest.username,'Guest'),
    case
      when booking.user_id=actor_id then hotel.name
      else coalesce(booking.guest_name,guest.full_name,guest.username,'Guest')
    end,
    last_message.content,
    last_message.created_at,
    (
      select count(*)
      from public.hotel_booking_messages message
      where message.conversation_id=conversation.id
        and not message.is_read
        and message.sender_id<>actor_id
        and not actor_id=any(coalesce(message.hidden_for,'{}'::text[]))
    ),
    conversation.updated_at
  from public.hotel_booking_conversations conversation
  join public.hotel_bookings booking on booking.booking_id=conversation.booking_id
  join public.hotels hotel on hotel.hotel_id=conversation.hotel_id
  join public.hotel_rooms room on room.room_id=booking.room_id
  join public.profiles guest on guest.user_id=booking.user_id
  left join lateral (
    select
      case
        when nullif(btrim(message.content),'') is not null then message.content
        else 'Attachment'
      end as content,
      message.created_at
    from public.hotel_booking_messages message
    where message.conversation_id=conversation.id
      and not actor_id=any(coalesce(message.hidden_for,'{}'::text[]))
    order by message.created_at desc
    limit 1
  ) last_message on true
  where public.can_access_hotel_booking_conversation(conversation.id)
  order by greatest(conversation.updated_at,coalesce(last_message.created_at,conversation.updated_at)) desc;
end;
$$;

revoke all on function public.get_my_hotel_booking_conversations() from public,anon;
grant execute on function public.get_my_hotel_booking_conversations() to authenticated,service_role;
