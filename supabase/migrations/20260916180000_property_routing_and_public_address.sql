begin;

-- Property submission/inspection questions are Property Operations work, not
-- generic Support. The stable reason code is server-owned product vocabulary;
-- the owning domain remains data-driven in case_reason_registry.
insert into public.case_reason_registry(
  reason_code,label,owning_domain,allowed_subject_types,requires_evidence,
  customer_description,active,version
) values(
  'property_submission_help','Property submission help','property_operations',
  array['inspection']::text[],false,
  'Help with a property submission, inspection or publication journey.',true,1
)
on conflict(reason_code) do update set
  label=excluded.label,
  owning_domain=excluded.owning_domain,
  allowed_subject_types=excluded.allowed_subject_types,
  requires_evidence=excluded.requires_evidence,
  customer_description=excluded.customer_description,
  active=true,
  version=greatest(public.case_reason_registry.version,excluded.version);

-- Public housing discovery uses an explicit allowlist. The written address is
-- public product information after WeHouse publication approval. Raw location
-- coordinates, accuracy, ownership and operations fields are never sent to a
-- public/customer browser.
create or replace function public.get_discoverable_listings()
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',l.id,
      'listing_id',l.listing_id,
      'title',l.title,
      'description',l.description,
      'price',l.price,
      'currency',l.currency,
      'state',l.state,
      'city',l.city,
      'address',l.address,
      'images',coalesce(l.images,array[]::text[]),
      'videos',coalesce(l.videos,array[]::text[]),
      'bedrooms',l.bedrooms,
      'bathrooms',l.bathrooms,
      'availability_status',l.availability_status,
      'status',l.status,
      'property_type',l.property_type,
      'sub_type',l.sub_type,
      'security_deposit_amount',l.security_deposit_amount,
      'max_guests',l.max_guests,
      'max_occupants',l.max_occupants,
      'future_installments_allowed',l.future_installments_allowed,
      'amenities',coalesce(l.amenities,array[]::text[]),
      'created_at',l.created_at,
      'updated_at',l.updated_at,
      'gps_latitude',null,
      'gps_longitude',null,
      'location_accuracy_m',null,
      'location_exact',false,
      'partner_display_name',coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.username),''))
    ) order by l.created_at desc
  ),'[]'::jsonb)
  from public.listings l
  left join public.profiles p on p.user_id=coalesce(l.partner_id,l.owner_id)
  where l.deleted_at is null
    and l.inspection_request_id is not null
    and l.approved_at is not null
    and l.status='available'
    and l.availability_status='available'
$$;

create or replace function public.get_public_listing_detail(p_listing_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_listing public.listings;
  v_actor public.profiles;
  v_partner_name text;
  v_internal boolean:=false;
begin
  select * into v_listing
  from public.listings l
  where (l.id::text=p_listing_id or l.listing_id=p_listing_id)
    and l.deleted_at is null
  limit 1;
  if v_listing.id is null then return null; end if;

  select coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.username),''))
  into v_partner_name
  from public.profiles p
  where p.user_id=coalesce(v_listing.partner_id,v_listing.owner_id);

  select * into v_actor
  from public.profiles p
  where p.auth_id=(select auth.uid())::text
    and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
  limit 1;

  if v_actor.user_id is not null then
    v_internal:=v_actor.user_id in(v_listing.owner_id,v_listing.partner_id)
      or public.current_actor_has_workspace('creator',null)
      or (
        public.current_actor_has_workspace('admin',v_listing.state)
        and public.current_actor_in_scope(v_listing.state,v_listing.city)
      )
      or (
        public.current_staff_has_permission('operations')
        and public.current_actor_in_scope(v_listing.state,v_listing.city)
      );
  end if;

  if not v_internal
     and not (
       v_listing.status='available'
       and v_listing.availability_status='available'
       and v_listing.inspection_request_id is not null
       and v_listing.approved_at is not null
     ) then
    return null;
  end if;

  if v_internal then
    return to_jsonb(v_listing)||jsonb_build_object(
      'location_exact',true,
      'partner_display_name',v_partner_name
    );
  end if;

  return jsonb_build_object(
    'id',v_listing.id,
    'listing_id',v_listing.listing_id,
    'title',v_listing.title,
    'description',v_listing.description,
    'price',v_listing.price,
    'currency',v_listing.currency,
    'state',v_listing.state,
    'city',v_listing.city,
    'address',v_listing.address,
    'images',coalesce(v_listing.images,array[]::text[]),
    'videos',coalesce(v_listing.videos,array[]::text[]),
    'bedrooms',v_listing.bedrooms,
    'bathrooms',v_listing.bathrooms,
    'availability_status',v_listing.availability_status,
    'status',v_listing.status,
    'property_type',v_listing.property_type,
    'sub_type',v_listing.sub_type,
    'security_deposit_amount',v_listing.security_deposit_amount,
    'max_guests',v_listing.max_guests,
    'max_occupants',v_listing.max_occupants,
    'future_installments_allowed',v_listing.future_installments_allowed,
    'amenities',coalesce(v_listing.amenities,array[]::text[]),
    'created_at',v_listing.created_at,
    'updated_at',v_listing.updated_at,
    'gps_latitude',null,
    'gps_longitude',null,
    'location_accuracy_m',null,
    'location_exact',false,
    'partner_display_name',v_partner_name
  );
end;
$$;

-- Hotel discovery follows the same privacy boundary: public written address,
-- private raw coordinates. Keep the established explicit allowlist.
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
      'address',h.address,
      'images',coalesce(h.images,array[]::text[]),
      'amenities',coalesce(h.amenities,array[]::text[]),
      'status',h.status,
      'rating',h.rating,
      'review_count',h.review_count,
      'featured',h.featured,
      'gps_latitude',null,
      'gps_longitude',null,
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

-- Preserve useful distance without disclosing supplier coordinates. The device
-- location is an ephemeral input, not stored by this command. The result exposes
-- only the approved record id and calculated distance.
create or replace function public.get_my_discovery_distances(
  p_lat double precision,
  p_lng double precision
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_result jsonb;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if p_lat is null or p_lng is null
     or p_lat not between -90 and 90
     or p_lng not between -180 and 180 then
    raise exception 'Valid viewer location required';
  end if;

  select coalesce(jsonb_agg(row_value order by distance_value),'[]'::jsonb)
  into v_result
  from (
    select
      jsonb_build_object(
        'subject_type','listing',
        'subject_id',l.id::text,
        'distance_km',round((
          6371.0*2*asin(least(1.0,sqrt(
            power(sin(radians(l.gps_latitude::double precision-p_lat)/2),2)
            +cos(radians(p_lat))*cos(radians(l.gps_latitude::double precision))
             *power(sin(radians(l.gps_longitude::double precision-p_lng)/2),2)
          )))
        )::numeric,2)
      ) row_value,
      6371.0*2*asin(least(1.0,sqrt(
        power(sin(radians(l.gps_latitude::double precision-p_lat)/2),2)
        +cos(radians(p_lat))*cos(radians(l.gps_latitude::double precision))
         *power(sin(radians(l.gps_longitude::double precision-p_lng)/2),2)
      ))) distance_value
    from public.listings l
    where l.deleted_at is null
      and l.inspection_request_id is not null
      and l.approved_at is not null
      and l.status='available'
      and l.availability_status='available'
      and l.gps_latitude is not null and l.gps_longitude is not null

    union all

    select
      jsonb_build_object(
        'subject_type','hotel',
        'subject_id',h.hotel_id::text,
        'distance_km',round((
          6371.0*2*asin(least(1.0,sqrt(
            power(sin(radians(h.gps_latitude::double precision-p_lat)/2),2)
            +cos(radians(p_lat))*cos(radians(h.gps_latitude::double precision))
             *power(sin(radians(h.gps_longitude::double precision-p_lng)/2),2)
          )))
        )::numeric,2)
      ) row_value,
      6371.0*2*asin(least(1.0,sqrt(
        power(sin(radians(h.gps_latitude::double precision-p_lat)/2),2)
        +cos(radians(p_lat))*cos(radians(h.gps_latitude::double precision))
         *power(sin(radians(h.gps_longitude::double precision-p_lng)/2),2)
      ))) distance_value
    from public.hotels h
    where h.status='active'
      and h.approved_at is not null
      and h.published_at is not null
      and h.gps_latitude is not null and h.gps_longitude is not null
  ) distances;

  return v_result;
end;
$$;

revoke all on function public.get_discoverable_listings() from public;
grant execute on function public.get_discoverable_listings() to anon,authenticated,service_role;
revoke all on function public.get_public_listing_detail(text) from public;
grant execute on function public.get_public_listing_detail(text) to anon,authenticated,service_role;
revoke all on function public.get_discoverable_hotels() from public;
grant execute on function public.get_discoverable_hotels() to anon,authenticated,service_role;
revoke all on function public.get_public_hotel_detail(integer) from public;
grant execute on function public.get_public_hotel_detail(integer) to anon,authenticated,service_role;
revoke all on function public.get_my_discovery_distances(double precision,double precision) from public,anon;
grant execute on function public.get_my_discovery_distances(double precision,double precision) to authenticated,service_role;

comment on function public.get_discoverable_listings() is
  'Public apartment discovery allowlist: approved written address is visible; raw coordinates and operational fields are private.';
comment on function public.get_public_listing_detail(text) is
  'Public apartment detail allowlist: approved written address is visible; raw coordinates remain internal.';
comment on function public.get_discoverable_hotels() is
  'Public hotel discovery allowlist: approved written address is visible; raw coordinates and operational fields are private.';
comment on function public.get_public_hotel_detail(integer) is
  'Public hotel detail allowlist: approved written address is visible; raw coordinates remain internal.';
comment on function public.get_my_discovery_distances(double precision,double precision) is
  'Authenticated distance calculator: returns only distance values for approved public records and never property coordinates.';

commit;