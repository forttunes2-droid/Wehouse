-- One booking conversation, regardless of entry route. No extra request thread.
-- Keep existing paid-stay chat eligibility; never grant hotel access from a profile role.
begin;
create or replace function public.get_my_hotel_conversation_bundle(p_conversation_id uuid, p_booking_id integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_conv public.hotel_booking_conversations;
  v_booking public.hotel_bookings;
  v_context jsonb;
  v_messages jsonb;
  v_request_visible boolean;
begin
  if v_actor is null or not public.can_access_hotel_booking_conversation(p_conversation_id) then
    raise exception 'Hotel conversation access denied' using errcode='42501';
  end if;
  select * into v_conv from public.hotel_booking_conversations where id=p_conversation_id;
  select * into v_booking from public.hotel_bookings where booking_id=p_booking_id;
  if v_conv.id is null or v_booking.booking_id is null or v_conv.booking_id<>v_booking.booking_id
    or v_conv.hotel_id<>v_booking.hotel_id or v_conv.guest_user_id<>v_booking.user_id then
    raise exception 'Hotel conversation access denied' using errcode='42501';
  end if;
  v_request_visible:=v_actor=v_booking.user_id or public.hotel_actor_has_capability(v_booking.hotel_id,'stay.read');
  select jsonb_build_object(
    'conversation_id',v_conv.id,'booking_id',v_booking.booking_id,'hotel_id',v_booking.hotel_id,
    'hotel_name',h.name,'room_name',r.room_type,'rate_plan_name',v_booking.rate_plan_name,
    'check_in',v_booking.check_in,'check_out',v_booking.check_out,
    'booking_status',v_booking.status,'payment_status',v_booking.payment_status,
    'viewer_party',case when v_actor=v_booking.user_id then 'guest' else 'hotel' end,
    'other_party_label',case when v_actor=v_booking.user_id then h.name
      else coalesce(nullif(btrim(v_booking.guest_name),''),nullif(btrim(g.full_name),''),g.username,'Guest') end,
    'request_visible',v_request_visible,
    'special_requests',case when v_request_visible then v_booking.special_requests else null end,
    'can_reply',v_booking.payment_status='paid' and v_booking.status in ('confirmed','checked_in')
  ) into v_context from public.hotels h
    join public.hotel_rooms r on r.hotel_id=h.hotel_id and r.room_id=v_booking.room_id
    join public.profiles g on g.user_id=v_booking.user_id
    where h.hotel_id=v_booking.hotel_id;
  if v_context is null then raise exception 'Hotel conversation access denied' using errcode='42501'; end if;
  select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at,m.id),'[]'::jsonb)
    into v_messages from public.get_hotel_booking_messages(p_conversation_id) m;
  return jsonb_build_object('context',v_context,'messages',v_messages);
end $$;
revoke all on function public.get_my_hotel_conversation_bundle(uuid,integer) from public,anon;
grant execute on function public.get_my_hotel_conversation_bundle(uuid,integer) to authenticated,service_role;

-- is_read means read by the opposite party, not merely another colleague.
-- Do not rewrite historical receipts: their original reader cannot be reconstructed.
create or replace function public.mark_hotel_booking_messages_read(p_conversation_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor text:=public.current_profile_user_id(); v_guest text;
begin
  if v_actor is null or not public.can_access_hotel_booking_conversation(p_conversation_id) then
    raise exception 'Hotel conversation access denied' using errcode='42501';
  end if;
  select guest_user_id into v_guest from public.hotel_booking_conversations where id=p_conversation_id;
  update public.hotel_booking_messages set is_read=true
    where conversation_id=p_conversation_id and not is_read
      and not v_actor=any(coalesce(hidden_for,'{}'::text[]))
      and case when v_actor=v_guest then sender_id<>v_guest else sender_id=v_guest end;
end $$;

CREATE OR REPLACE FUNCTION public.get_my_hotel_booking_conversations() RETURNS TABLE(conversation_id uuid, booking_id integer, hotel_id integer, hotel_name text, hotel_image text, booking_code text, booking_status text, payment_status text, check_in date, check_out date, room_name text, guest_user_id text, guest_name text, other_party_label text, last_message text, last_message_time timestamp with time zone, unread_count bigint, updated_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
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
        and case when actor_id=conversation.guest_user_id
          then message.sender_id<>conversation.guest_user_id
          else message.sender_id=conversation.guest_user_id end
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

commit;
