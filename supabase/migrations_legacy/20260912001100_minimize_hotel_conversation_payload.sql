-- Hotel booking codes are handover/security artifacts, not conversation metadata.
-- Keep the existing RPC return shape for client compatibility but always return
-- NULL for booking_code so chat lists, previews and headers cannot expose it.

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
    c.id,
    b.booking_id,
    h.hotel_id,
    h.name,
    h.images[1],
    null::text,
    b.status,
    b.payment_status,
    b.check_in,
    b.check_out,
    r.room_type,
    b.user_id,
    coalesce(b.guest_name,g.full_name,g.username,'Guest'),
    case
      when b.user_id=actor_id then h.name
      else coalesce(b.guest_name,g.full_name,g.username,'Guest')
    end,
    lm.content,
    lm.created_at,
    (
      select count(*)
      from public.hotel_booking_messages m
      where m.conversation_id=c.id
        and not m.is_read
        and m.sender_id<>actor_id
        and not actor_id=any(coalesce(m.hidden_for,'{}'::text[]))
    ),
    c.updated_at
  from public.hotel_booking_conversations c
  join public.hotel_bookings b on b.booking_id=c.booking_id
  join public.hotels h on h.hotel_id=c.hotel_id
  join public.hotel_rooms r on r.room_id=b.room_id
  join public.profiles g on g.user_id=b.user_id
  left join lateral (
    select
      case
        when nullif(btrim(m.content),'') is not null then m.content
        else 'Attachment'
      end as content,
      m.created_at
    from public.hotel_booking_messages m
    where m.conversation_id=c.id
      and not actor_id=any(coalesce(m.hidden_for,'{}'::text[]))
    order by m.created_at desc
    limit 1
  ) lm on true
  where public.can_access_hotel_booking_conversation(c.id)
    and lm.created_at is not null
  order by greatest(c.updated_at,lm.created_at) desc;
end;
$$;

revoke all on function public.get_my_hotel_booking_conversations() from public,anon;
grant execute on function public.get_my_hotel_booking_conversations() to authenticated,service_role;
