begin;

-- Public discovery/detail endpoints are explicit allowlists. Never serialize a
-- whole hotel, room, rate-plan or venue row and then subtract known-private
-- columns: new operational/PMS columns must remain private by default.
create or replace function public.get_discoverable_hotels()
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'hotel_id',h.hotel_id,
      'name',h.name,
      'description',h.description,
      'state',h.state,
      'city',h.city,
      'area',h.area,
      'address',null,
      'images',coalesce(h.images,array[]::text[]),
      'amenities',coalesce(h.amenities,array[]::text[]),
      'status',h.status,
      'rating',h.rating,
      'review_count',h.review_count,
      'featured',h.featured,
      'gps_latitude',case when h.gps_latitude is null then null else round(h.gps_latitude,2) end,
      'gps_longitude',case when h.gps_longitude is null then null else round(h.gps_longitude,2) end,
      'location_exact',false,
      'check_in_time',h.check_in_time,
      'check_out_time',h.check_out_time,
      'timezone',h.timezone,
      'hotel_rooms',coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'room_id',room.room_id,
            'room_type',room.room_type,
            'price_per_night',coalesce((
              select min(plan.price_per_night)
              from public.hotel_rate_plans plan
              where plan.room_id=room.room_id and plan.active
            ),room.price_per_night)
          )
          order by room.price_per_night,room.room_id
        )
        from public.hotel_rooms room
        where room.hotel_id=h.hotel_id
      ),'[]'::jsonb)
    )
    order by h.featured desc,h.created_at desc
  ),'[]'::jsonb)
  from public.hotels h
  where h.status='active'
    and h.approved_at is not null
    and h.published_at is not null
$$;

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
  v_current_paid_stay boolean:=false;
  v_exact_location boolean:=false;
  v_rooms jsonb;
  v_facilities jsonb;
begin
  select * into v_hotel
  from public.hotels hotel
  where hotel.hotel_id=p_hotel_id;
  if v_hotel.hotel_id is null then return null; end if;

  select * into v_actor
  from public.profiles profile
  where profile.auth_id=(select auth.uid())::text
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
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

    v_current_paid_stay:=exists(
      select 1
      from public.hotel_bookings booking
      join public.payment_protection_transactions protection
        on protection.id=booking.payment_protection_id
      where booking.hotel_id=v_hotel.hotel_id
        and booking.user_id=v_actor.user_id
        and booking.payment_status='paid'
        and booking.status in('confirmed','checked_in')
        and protection.subject_type='hotel_stay'
        and protection.subject_id=booking.booking_id::text
        and protection.payer_user_id=booking.user_id
        and protection.paystack_reference=booking.payment_reference
        and protection.protected_ledger_transaction_id is not null
        and protection.status=protection.protection_state
        and protection.protection_state in(
          'protected','release_eligible','release_pending','released',
          'disputed','risk_held','partially_released'
        )
    );
  end if;

  if v_hotel.status<>'active' and not v_internal and not v_current_paid_stay then
    return null;
  end if;

  v_exact_location:=v_internal or v_current_paid_stay;

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
          and (plan.active or v_internal or v_current_paid_stay)
      ),'[]'::jsonb)
    )
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
    )
    order by venue.kind,venue.name
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
    'address',case when v_exact_location then v_hotel.address else null end,
    'images',coalesce(v_hotel.images,array[]::text[]),
    'amenities',coalesce(v_hotel.amenities,array[]::text[]),
    'status',v_hotel.status,
    'rating',v_hotel.rating,
    'review_count',v_hotel.review_count,
    'featured',v_hotel.featured,
    'gps_latitude',case
      when v_hotel.gps_latitude is null then null
      when v_exact_location then v_hotel.gps_latitude
      else round(v_hotel.gps_latitude,2)
    end,
    'gps_longitude',case
      when v_hotel.gps_longitude is null then null
      when v_exact_location then v_hotel.gps_longitude
      else round(v_hotel.gps_longitude,2)
    end,
    'location_exact',v_exact_location,
    'check_in_time',v_hotel.check_in_time,
    'check_out_time',v_hotel.check_out_time,
    'timezone',v_hotel.timezone,
    'hotel_rooms',v_rooms,
    'venues',v_facilities
  );
end;
$$;

-- These are intentionally public read commands. Their output is now an explicit
-- allowlist and contains no owner ids, inspection ids, approval actors, PMS
-- source/external references, capacity provenance, payout data or internal notes.
revoke all on function public.get_discoverable_hotels() from public;
grant execute on function public.get_discoverable_hotels() to anon,authenticated,service_role;
revoke all on function public.get_public_hotel_detail(integer) from public;
grant execute on function public.get_public_hotel_detail(integer) to anon,authenticated,service_role;

comment on function public.get_discoverable_hotels() is
  'Public hotel discovery allowlist. New hotel/room schema columns stay private until explicitly added here.';
comment on function public.get_public_hotel_detail(integer) is
  'Public hotel detail allowlist. Exact location is conditionally disclosed only to authorized internal hotel actors or the current paid guest.';

commit;