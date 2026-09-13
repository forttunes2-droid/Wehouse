-- Hotel team duties are deliberately separate:
-- managers maintain rooms/inventory; front desk handles stays and guest chat.

create or replace function public.can_access_hotel_booking_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  with actor as (
    select user_id
    from public.profiles
    where auth_id=(select auth.uid())::text
      and not coalesce(deleted,false)
      and not coalesce(suspended,false)
      and not coalesce(banned,false)
    limit 1
  )
  select exists(
    select 1
    from public.hotel_booking_conversations conversation
    join public.hotels hotel on hotel.hotel_id=conversation.hotel_id
    cross join actor
    where conversation.id=p_conversation_id
      and (
        conversation.guest_user_id=actor.user_id
        or hotel.owner_id=actor.user_id
        or exists(
          select 1
          from public.hotel_team_members member
          where member.hotel_id=conversation.hotel_id
            and member.member_user_id=actor.user_id
            and member.hotel_role='staff'
            and member.status='active'
        )
      )
  );
$$;

revoke all on function public.can_access_hotel_booking_conversation(uuid) from public, anon;
grant execute on function public.can_access_hotel_booking_conversation(uuid) to authenticated, service_role;

create or replace function public.partner_transition_hotel_booking(
  p_booking_id integer,
  p_status text
)
returns public.hotel_bookings
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  booking public.hotel_bookings;
  actor_role text;
begin
  select * into booking
  from public.hotel_bookings
  where booking_id=p_booking_id
  for update;
  if booking is null then raise exception 'Hotel booking not found'; end if;

  actor_role:=public.current_actor_hotel_role(booking.hotel_id);
  if actor_role not in ('owner','staff') then
    raise exception 'Hotel owner or Front Desk access required';
  end if;

  if p_status='checked_in' and not (
    booking.status='confirmed'
    and booking.payment_status='paid'
    and booking.check_in<=current_date
    and booking.check_out>current_date
  ) then
    raise exception 'Only a paid confirmed arrival within its stay dates can be checked in';
  elsif p_status='checked_out' and not (
    booking.status='checked_in'
    and booking.payment_status='paid'
    and booking.check_out<=current_date
  ) then
    raise exception 'Only a paid checked-in stay reaching departure can be checked out';
  elsif p_status not in ('checked_in','checked_out') then
    raise exception 'Unsupported hotel booking transition';
  end if;

  update public.hotel_bookings
  set status=p_status,updated_at=now()
  where booking_id=p_booking_id
  returning * into booking;
  return booking;
end;
$$;

revoke all on function public.partner_transition_hotel_booking(integer,text) from public, anon;
grant execute on function public.partner_transition_hotel_booking(integer,text) to authenticated, service_role;

drop policy if exists hotel_bookings_team_select on public.hotel_bookings;
create policy hotel_bookings_front_desk_select
on public.hotel_bookings
for select
to authenticated
using (public.current_actor_hotel_role(hotel_id)='staff');
