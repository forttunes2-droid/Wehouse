begin;

-- Legacy discovery compatibility must inherit the current public-address/private-
-- coordinate contract instead of keeping the older rounded-coordinate response.
create or replace function public.get_discoverable_homes()
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select coalesce(jsonb_agg(item),'[]'::jsonb)
  from jsonb_array_elements(public.get_discoverable_listings()) item
  where coalesce(item->>'property_type','apartment')<>'hotel'
$$;

-- A customer's own Hotel booking may expose the published written address but
-- never the supplier's latitude/longitude. Entrance coordinates remain an
-- internal operations/partner capability rather than booking payload data.
create or replace function public.get_my_hotel_bookings()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_user text:=public.current_profile_user_id();
begin
  if v_user is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;

  return coalesce((
    select jsonb_agg(
      to_jsonb(booking)||jsonb_build_object(
        'hotels',(
          to_jsonb(hotel)
            -'gps_latitude'-'gps_longitude'-'owner_id'
            -'inspection_request_id'-'approved_by'
        )||jsonb_build_object(
          'address',hotel.address,
          'gps_latitude',null,
          'gps_longitude',null,
          'location_exact',false
        ),
        'hotel_rooms',to_jsonb(room),
        'hotel_rate_plans',to_jsonb(rate_plan)
      )
      order by booking.created_at desc
    )
    from public.hotel_bookings booking
    join public.hotels hotel on hotel.hotel_id=booking.hotel_id
    join public.hotel_rooms room on room.room_id=booking.room_id
    left join public.hotel_rate_plans rate_plan
      on rate_plan.rate_plan_id=booking.rate_plan_id
    where booking.user_id=v_user
  ),'[]'::jsonb);
end
$$;

revoke all on function public.get_discoverable_homes() from public;
grant execute on function public.get_discoverable_homes() to anon,authenticated,service_role;
revoke all on function public.get_my_hotel_bookings() from public,anon;
grant execute on function public.get_my_hotel_bookings() to authenticated,service_role;

comment on function public.get_discoverable_homes() is
  'Compatibility public home discovery. Uses approved written addresses and never returns supplier coordinates.';
comment on function public.get_my_hotel_bookings() is
  'Customer Hotel bookings with published address text; supplier coordinates are never returned.';

commit;
