-- Hotel access must not recurse between hotels and hotel_bookings policies.
-- Keep the authorization decision in SECURITY DEFINER helpers, then expose
-- one canonical read policy per record type.

create or replace function public.current_actor_can_read_hotel_record(
  p_hotel_id integer,
  p_owner_id text,
  p_state text,
  p_city text
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor public.profiles;
begin
  select profile.* into v_actor
  from public.profiles profile
  where profile.auth_id = (select auth.uid())::text
    and not coalesce(profile.deleted, false)
    and not coalesce(profile.suspended, false)
    and not coalesce(profile.banned, false)
  limit 1;

  if v_actor.user_id is null then return false; end if;

  return p_owner_id = v_actor.user_id
    or v_actor.role = 'creator'
    or exists (
      select 1
      from public.hotel_team_members member
      where member.hotel_id = p_hotel_id
        and member.member_user_id = v_actor.user_id
        and member.status = 'active'
    )
    or (
      (v_actor.role = 'admin'
        or (v_actor.role = 'staff' and public.current_staff_has_permission('operations')))
      and public.current_actor_in_scope(p_state, p_city)
    )
    or exists (
      select 1
      from public.hotel_bookings booking
      where booking.hotel_id = p_hotel_id
        and booking.user_id = v_actor.user_id
        and booking.payment_status = 'paid'
        and booking.status in ('confirmed', 'checked_in', 'checked_out', 'completed')
    );
end;
$$;

create or replace function public.current_actor_can_read_hotel_booking_record(
  p_hotel_id integer,
  p_customer_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor public.profiles;
  v_hotel public.hotels;
begin
  select profile.* into v_actor
  from public.profiles profile
  where profile.auth_id = (select auth.uid())::text
    and not coalesce(profile.deleted, false)
    and not coalesce(profile.suspended, false)
    and not coalesce(profile.banned, false)
  limit 1;

  if v_actor.user_id is null then return false; end if;
  if p_customer_id = v_actor.user_id or v_actor.role = 'creator' then return true; end if;

  select hotel.* into v_hotel
  from public.hotels hotel
  where hotel.hotel_id = p_hotel_id;

  if v_hotel.hotel_id is null then return false; end if;

  return v_hotel.owner_id = v_actor.user_id
    or exists (
      select 1
      from public.hotel_team_members member
      where member.hotel_id = p_hotel_id
        and member.member_user_id = v_actor.user_id
        and member.status = 'active'
    )
    or (
      (v_actor.role = 'admin'
        or (v_actor.role = 'staff' and public.current_staff_has_permission('operations')))
      and public.current_actor_in_scope(v_hotel.state, v_hotel.city)
    );
end;
$$;

revoke all on function public.current_actor_can_read_hotel_record(integer, text, text, text)
  from public, anon;
revoke all on function public.current_actor_can_read_hotel_booking_record(integer, text)
  from public, anon;
grant execute on function public.current_actor_can_read_hotel_record(integer, text, text, text)
  to authenticated, service_role;
grant execute on function public.current_actor_can_read_hotel_booking_record(integer, text)
  to authenticated, service_role;

drop policy if exists hotels_canonical_select on public.hotels;
create policy hotels_canonical_select on public.hotels
for select to authenticated
using (
  public.current_actor_can_read_hotel_record(hotel_id, owner_id, state, city)
);

drop policy if exists hotel_bookings_admin_select_v2 on public.hotel_bookings;
drop policy if exists hotel_bookings_creator_select_v2 on public.hotel_bookings;
drop policy if exists hotel_bookings_customer_select_v2 on public.hotel_bookings;
drop policy if exists hotel_bookings_front_desk_select on public.hotel_bookings;
drop policy if exists hotel_bookings_partner_select on public.hotel_bookings;
drop policy if exists hotel_bookings_canonical_select on public.hotel_bookings;
create policy hotel_bookings_canonical_select on public.hotel_bookings
for select to authenticated
using (
  public.current_actor_can_read_hotel_booking_record(hotel_id, user_id)
);

comment on function public.current_actor_can_read_hotel_record(integer, text, text, text)
  is 'Non-recursive authorization boundary for one hotel record.';
comment on function public.current_actor_can_read_hotel_booking_record(integer, text)
  is 'Non-recursive authorization boundary for one hotel booking record.';
