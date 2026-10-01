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
      and (($5 is null and $6 is null) or coalesce((
        -- Keep this as a bounded scalar lookup per candidate hotel. Pulling EXISTS
        -- into a semijoin scans/prices the full room catalog before applying LIMIT.
        select true from public.hotel_rooms r where r.hotel_id = h.hotel_id
          and ($5 is null or coalesce((
            select min(plan.price_per_night) from public.hotel_rate_plans plan
            where plan.room_id = r.room_id and plan.active
          ),r.price_per_night) >= $5)
          and ($6 is null or coalesce((
            select min(plan.price_per_night) from public.hotel_rate_plans plan
            where plan.room_id = r.room_id and plan.active
          ),r.price_per_night) <= $6)
        limit 1
      ),false))
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
