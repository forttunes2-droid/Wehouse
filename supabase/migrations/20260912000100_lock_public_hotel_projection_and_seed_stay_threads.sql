-- Public hotel discovery must expose only the allowlisted projection returned by
-- the public hotel RPCs. RLS filters rows, not columns, so a public SELECT policy
-- on public.hotels leaks exact address/coordinates and internal ownership fields.
--
-- Hotel stay chat must also be deterministic. A paid confirmed stay gets one
-- canonical conversation regardless of whether the guest or hotel opens Inbox
-- first. Ended stays keep that same thread as read-only history.

-- ---------------------------------------------------------------------------
-- 1. Public hotel reads go through column-safe projections only.
-- ---------------------------------------------------------------------------

drop policy if exists hotels_public_active_select on public.hotels;

-- Anonymous clients never need the base hotel row. Authenticated internal actors
-- retain their table grant, but RLS now limits them to hotels_internal_select.
revoke select on table public.hotels from anon;

-- Public detail is deliberately about the stay product: hotel facts, rooms and
-- bookable rate plans. Internal venue/restaurant records are not a separate
-- customer product surface and are therefore omitted from this projection.
create or replace function public.get_public_hotel_detail(p_hotel_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_hotel public.hotels;
  v_actor public.profiles;
  v_internal boolean := false;
  v_current_paid_stay boolean := false;
  v_rooms jsonb;
begin
  select * into v_hotel
  from public.hotels
  where hotel_id = p_hotel_id;

  if v_hotel.hotel_id is null then return null; end if;

  select * into v_actor
  from public.profiles
  where auth_id = (select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;

  if v_actor.user_id is not null then
    v_internal := v_hotel.owner_id = v_actor.user_id
      or exists(
        select 1
        from public.hotel_team_members member
        where member.hotel_id = v_hotel.hotel_id
          and member.member_user_id = v_actor.user_id
          and member.status = 'active'
      )
      or v_actor.role = 'creator'
      or (
        v_actor.role = 'admin'
        and public.current_actor_in_scope(v_hotel.state,v_hotel.city)
      )
      or (
        v_actor.role = 'staff'
        and public.current_staff_has_permission('operations')
        and public.current_actor_in_scope(v_hotel.state,v_hotel.city)
      );

    -- Exact location remains available while the paid stay is live. Completed
    -- guests keep the address in their booking history/receipt, not as perpetual
    -- access to the broader hotel record.
    v_current_paid_stay := exists(
      select 1
      from public.hotel_bookings booking
      where booking.hotel_id = v_hotel.hotel_id
        and booking.user_id = v_actor.user_id
        and booking.payment_status = 'paid'
        and booking.status in ('confirmed','checked_in')
    );
  end if;

  if v_hotel.status <> 'active' and not v_internal and not v_current_paid_stay then
    return null;
  end if;

  select coalesce(jsonb_agg(
    to_jsonb(room) || jsonb_build_object(
      'rate_plans', coalesce((
        select jsonb_agg(to_jsonb(plan) order by plan.price_per_night,plan.rate_plan_id)
        from public.hotel_rate_plans plan
        where plan.room_id = room.room_id
          and (plan.active or v_internal or v_current_paid_stay)
      ), '[]'::jsonb)
    )
    order by room.price_per_night
  ), '[]'::jsonb)
  into v_rooms
  from public.hotel_rooms room
  where room.hotel_id = v_hotel.hotel_id;

  if v_internal then
    return to_jsonb(v_hotel)
      || jsonb_build_object(
        'hotel_rooms',v_rooms,
        'location_exact',true
      );
  end if;

  return (
    to_jsonb(v_hotel)
      - 'address'
      - 'gps_latitude'
      - 'gps_longitude'
      - 'owner_id'
      - 'inspection_request_id'
      - 'approved_by'
  ) || jsonb_build_object(
    'address', case when v_current_paid_stay then v_hotel.address else null end,
    'gps_latitude', case
      when v_hotel.gps_latitude is null then null
      when v_current_paid_stay then v_hotel.gps_latitude
      else round(v_hotel.gps_latitude,2)
    end,
    'gps_longitude', case
      when v_hotel.gps_longitude is null then null
      when v_current_paid_stay then v_hotel.gps_longitude
      else round(v_hotel.gps_longitude,2)
    end,
    'hotel_rooms',v_rooms,
    'location_exact',v_current_paid_stay
  );
end;
$$;

revoke all on function public.get_discoverable_hotels() from public, anon;
revoke all on function public.get_public_hotel_detail(integer) from public, anon;

grant execute on function public.get_discoverable_hotels()
  to anon, authenticated, service_role;
grant execute on function public.get_public_hotel_detail(integer)
  to anon, authenticated, service_role;

comment on function public.get_discoverable_hotels()
  is 'Column-safe public hotel discovery projection. Anonymous and authenticated callers use this instead of selecting public.hotels directly.';
comment on function public.get_public_hotel_detail(integer)
  is 'Column-safe hotel detail projection for hotel facts, rooms and rates. Internal venue records are excluded; exact location is limited to internal actors or a live paid stay.';

-- ---------------------------------------------------------------------------
-- 2. One deterministic conversation per paid hotel stay.
-- ---------------------------------------------------------------------------

create or replace function public.ensure_paid_hotel_stay_conversation()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  if new.payment_status = 'paid'
     and new.status in ('confirmed','checked_in','checked_out','completed') then
    insert into public.hotel_booking_conversations(
      booking_id,
      hotel_id,
      guest_user_id,
      updated_at
    ) values (
      new.booking_id,
      new.hotel_id,
      new.user_id,
      now()
    )
    on conflict (booking_id) do update
      set hotel_id = excluded.hotel_id,
          guest_user_id = excluded.guest_user_id;
  end if;
  return new;
end;
$$;

revoke all on function public.ensure_paid_hotel_stay_conversation()
  from public, anon, authenticated;
grant execute on function public.ensure_paid_hotel_stay_conversation()
  to service_role;

drop trigger if exists hotel_bookings_ensure_stay_conversation
  on public.hotel_bookings;
create trigger hotel_bookings_ensure_stay_conversation
after insert or update of payment_status, status, hotel_id, user_id
on public.hotel_bookings
for each row
execute function public.ensure_paid_hotel_stay_conversation();

-- Repair existing paid stays so hotel staff do not see an action that depends on
-- the guest having opened chat first. Closed stays receive the same historical
-- thread but remain non-writable under send_hotel_booking_message().
insert into public.hotel_booking_conversations(
  booking_id,
  hotel_id,
  guest_user_id,
  updated_at
)
select
  booking.booking_id,
  booking.hotel_id,
  booking.user_id,
  now()
from public.hotel_bookings booking
where booking.payment_status = 'paid'
  and booking.status in ('confirmed','checked_in','checked_out','completed')
on conflict (booking_id) do nothing;

comment on function public.ensure_paid_hotel_stay_conversation()
  is 'Creates the canonical hotel stay thread when a paid booking becomes a live or historical confirmed stay.';
