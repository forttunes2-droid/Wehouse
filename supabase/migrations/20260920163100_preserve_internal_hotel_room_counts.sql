-- Keep submitted room quantities visible to authorised reviewers and hotel operators.
-- Guest projections continue to omit internal inventory counts.
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
  v_internal boolean:=false;
  v_rooms jsonb;
  v_facilities jsonb;
begin
  select * into v_hotel
  from public.hotels h
  where h.hotel_id=p_hotel_id;
  if v_hotel.hotel_id is null then return null; end if;

  select * into v_actor
  from public.profiles p
  where p.auth_id=(select auth.uid())::text
    and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
  limit 1;

  if v_actor.user_id is not null then
    v_internal:=v_hotel.owner_id=v_actor.user_id
      or exists(
        select 1
        from public.hotel_team_members member
        where member.hotel_id=v_hotel.hotel_id
          and member.member_user_id=v_actor.user_id
          and member.status='active'
      )
      or public.current_actor_has_workspace('creator',null)
      or (
        public.current_actor_has_workspace('admin',v_hotel.state)
        and public.current_actor_in_scope(v_hotel.state,v_hotel.city)
      )
      or (
        public.current_staff_has_permission('operations')
        and public.current_actor_in_scope(v_hotel.state,v_hotel.city)
      );
  end if;

  if v_hotel.status<>'active' and not v_internal then return null; end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'room_id',room.room_id,
      'room_type',room.room_type,
      'description',room.description,
      'price_per_night',room.price_per_night,
      'max_guests',room.max_guests,
      'bed_type',room.bed_type,
      'images',coalesce(room.images,array[]::text[]),
      'amenities',coalesce(room.amenities,array[]::text[]),
      'rate_plans',coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'rate_plan_id',plan.rate_plan_id,
            'room_id',plan.room_id,
            'name',plan.name,
            'description',plan.description,
            'meal_plan',plan.meal_plan,
            'payment_timing',plan.payment_timing,
            'refundable',plan.refundable,
            'cancellation_hours',plan.cancellation_hours,
            'price_per_night',plan.price_per_night,
            'included_features',coalesce(plan.included_features,array[]::text[]),
            'active',plan.active,
            'arrival_issue_window_hours',plan.arrival_issue_window_hours
          )
          order by plan.price_per_night,plan.rate_plan_id
        )
        from public.hotel_rate_plans plan
        where plan.room_id=room.room_id
          and (plan.active or v_internal)
      ),'[]'::jsonb)
    ) || case when v_internal then jsonb_build_object('hotel_id',room.hotel_id,'total_rooms',room.total_rooms) else '{}'::jsonb end
    order by room.price_per_night,room.room_id
  ),'[]'::jsonb)
  into v_rooms
  from public.hotel_rooms room
  where room.hotel_id=v_hotel.hotel_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'venue_id',venue.venue_id,
      'hotel_id',venue.hotel_id,
      'name',venue.name,
      'kind',venue.kind,
      'description',venue.description,
      'opening_hours',venue.opening_hours,
      'package_notes',venue.package_notes,
      'active',venue.active
    ) order by venue.kind,venue.name
  ),'[]'::jsonb)
  into v_facilities
  from public.hotel_venues venue
  where venue.hotel_id=v_hotel.hotel_id
    and (venue.active or v_internal);

  return jsonb_build_object(
    'hotel_id',v_hotel.hotel_id,
    'name',v_hotel.name,
    'description',v_hotel.description,
    'state',v_hotel.state,
    'city',v_hotel.city,
    'area',v_hotel.area,
    'address',v_hotel.address,
    'images',coalesce(v_hotel.images,array[]::text[]),
    'amenities',coalesce(v_hotel.amenities,array[]::text[]),
    'status',v_hotel.status,
    'rating',v_hotel.rating,
    'review_count',v_hotel.review_count,
    'featured',v_hotel.featured,
    'gps_latitude',case when v_internal then v_hotel.gps_latitude else null end,
    'gps_longitude',case when v_internal then v_hotel.gps_longitude else null end,
    'location_exact',v_internal,
    'check_in_time',v_hotel.check_in_time,
    'check_out_time',v_hotel.check_out_time,
    'timezone',v_hotel.timezone,
    'hotel_rooms',v_rooms,
    'venues',v_facilities
  );
end;
$$;
