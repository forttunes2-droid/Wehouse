-- Demonstrated failures in 500k-profile / one-million-property catalog run 36816343718.
-- Preserve public visibility, geography/price semantics, response and cursor bounds.
CREATE OR REPLACE FUNCTION public.search_discoverable_hotels(p_query text DEFAULT NULL::text, p_state text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_amenities text[] DEFAULT NULL::text[], p_min_price numeric DEFAULT NULL::numeric, p_max_price numeric DEFAULT NULL::numeric, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_radius_km numeric DEFAULT NULL::numeric, p_cursor_featured boolean DEFAULT NULL::boolean, p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id integer DEFAULT NULL::integer, p_limit integer DEFAULT 24)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_result jsonb;
begin
  -- Replan optional filters for actual values instead of scanning under a generic plan.
  execute $query$
with picked as materialized (
    select h.* from public.hotels h
    where h.status = 'active' and h.approved_at is not null and h.published_at is not null
      and (nullif(btrim($2),'') is null or lower(h.state) = lower(btrim($2)))
      and (nullif(btrim($3),'') is null or lower(h.city) = lower(btrim($3)))
      and (nullif(btrim($1),'') is null or
        strpos(lower(h.name),lower(left(btrim($1),80))) > 0)
      and (coalesce(cardinality($4),0) = 0 or h.amenities @> $4)
      and ($9 is null or ($9 between 0 and 20
        and $7 between -90 and 90 and $8 between -180 and 180
        and h.gps_latitude between $7 - $9/111.2 and $7 + $9/111.2
        and h.gps_longitude between $8 - $9/111.2/greatest(0.01,abs(cos(radians($7))))
          and $8 + $9/111.2/greatest(0.01,abs(cos(radians($7))))
        and 6371.0*2*asin(least(1.0,sqrt(
          power(sin(radians(h.gps_latitude::double precision-$7)/2),2)
          +cos(radians($7))*cos(radians(h.gps_latitude::double precision))
           *power(sin(radians(h.gps_longitude::double precision-$8)/2),2)
        ))) <= $9))
      and (($5 is null and $6 is null) or exists (
        select 1 from public.hotel_rooms r where r.hotel_id = h.hotel_id
          and ($5 is null or coalesce((
            select min(plan.price_per_night) from public.hotel_rate_plans plan
            where plan.room_id = r.room_id and plan.active
          ),r.price_per_night) >= $5)
          and ($6 is null or coalesce((
            select min(plan.price_per_night) from public.hotel_rate_plans plan
            where plan.room_id = r.room_id and plan.active
          ),r.price_per_night) <= $6)
      ))
      and ($10 is null or $11 is null or $12 is null
        or (h.featured,h.created_at,h.hotel_id) < ($10,$11,$12))
    order by h.featured desc,h.created_at desc,h.hotel_id desc
    limit least(greatest(coalesce($13,24),1),48)+1
  ), page as materialized (
    select * from picked order by featured desc,created_at desc,hotel_id desc
    limit least(greatest(coalesce($13,24),1),48)
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'hotel_id',h.hotel_id,'name',h.name,'description',h.description,
      'state',h.state,'city',h.city,'area',h.area,'address',h.address,
      'images',coalesce(h.images,array[]::text[]),
      'amenities',coalesce(h.amenities,array[]::text[]),
      'status',h.status,'rating',h.rating,'review_count',h.review_count,
      'featured',h.featured,'created_at',h.created_at,
      'gps_latitude',null,'gps_longitude',null,'location_exact',false,
      'check_in_time',h.check_in_time,'check_out_time',h.check_out_time,'timezone',h.timezone,
      'hotel_rooms',coalesce((select jsonb_agg(jsonb_build_object(
        'room_id',room.room_id,'room_type',room.room_type,
        'price_per_night',coalesce((select min(plan.price_per_night)
          from public.hotel_rate_plans plan where plan.room_id=room.room_id and plan.active),room.price_per_night)
      ) order by room.price_per_night,room.room_id)
        from public.hotel_rooms room where room.hotel_id=h.hotel_id),'[]'::jsonb)
    ) order by h.featured desc,h.created_at desc,h.hotel_id desc) from page h),'[]'::jsonb),
    'has_more',(select count(*) from picked) > (select count(*) from page),
    'next_cursor_featured',(select featured from page order by featured,created_at,hotel_id limit 1),
    'next_cursor_created_at',(select created_at from page order by featured,created_at,hotel_id limit 1),
    'next_cursor_id',(select hotel_id from page order by featured,created_at,hotel_id limit 1)
  )
  $query$ into v_result using p_query, p_state, p_city, p_amenities, p_min_price, p_max_price, p_lat, p_lng, p_radius_km, p_cursor_featured, p_cursor_created_at, p_cursor_id, p_limit;
  return v_result;
end
$function$
;
CREATE OR REPLACE FUNCTION public.get_public_listing_detail(p_listing_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_listing public.listings;
  v_actor public.profiles;
  v_partner_name text;
  v_internal boolean:=false;
begin
  -- Use the existing text-key index first. Only canonical UUID inputs need the UUID lookup.
  select * into v_listing
  from public.listings l
  where l.listing_id=p_listing_id and l.deleted_at is null
  limit 1;
  if v_listing.id is null and p_listing_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select * into v_listing
    from public.listings l
    where l.id=p_listing_id::uuid and l.deleted_at is null
    limit 1;
  end if;
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
    v_internal:=public.current_actor_can_manage_property(v_listing.id)
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
$function$
;
