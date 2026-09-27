-- Project only a bounded hotel page after server-side filters. The legacy
-- get_discoverable_hotels() contract remains for old clients during rollout.
create index if not exists hotels_public_feed_idx on public.hotels
  (featured desc, created_at desc, hotel_id desc)
  where status = 'active' and approved_at is not null and published_at is not null;

create index if not exists hotels_public_location_feed_idx on public.hotels
  (lower(state), lower(city), featured desc, created_at desc, hotel_id desc)
  where status = 'active' and approved_at is not null and published_at is not null;

create index if not exists hotel_rooms_public_price_idx on public.hotel_rooms
  (hotel_id, price_per_night);

create index if not exists hotels_public_coordinates_idx on public.hotels
  (gps_latitude, gps_longitude)
  where status = 'active' and approved_at is not null and published_at is not null;

create or replace function public.search_discoverable_hotels(
  p_query text default null,
  p_state text default null,
  p_city text default null,
  p_amenities text[] default null,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_radius_km numeric default null,
  p_cursor_featured boolean default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id integer default null,
  p_limit integer default 24
) returns jsonb
language sql stable security definer
set search_path to 'pg_catalog','public'
as $$
  with picked as materialized (
    select h.* from public.hotels h
    where h.status = 'active' and h.approved_at is not null and h.published_at is not null
      and (nullif(btrim(p_state),'') is null or lower(h.state) = lower(btrim(p_state)))
      and (nullif(btrim(p_city),'') is null or lower(h.city) = lower(btrim(p_city)))
      and (nullif(btrim(p_query),'') is null or
        strpos(lower(h.name),lower(left(btrim(p_query),80))) > 0)
      and (coalesce(cardinality(p_amenities),0) = 0 or h.amenities @> p_amenities)
      and (p_radius_km is null or (p_radius_km between 0 and 20
        and p_lat between -90 and 90 and p_lng between -180 and 180
        and h.gps_latitude between p_lat - p_radius_km/111.2 and p_lat + p_radius_km/111.2
        and h.gps_longitude between p_lng - p_radius_km/111.2/greatest(0.01,abs(cos(radians(p_lat))))
          and p_lng + p_radius_km/111.2/greatest(0.01,abs(cos(radians(p_lat))))
        and 6371.0*2*asin(least(1.0,sqrt(
          power(sin(radians(h.gps_latitude::double precision-p_lat)/2),2)
          +cos(radians(p_lat))*cos(radians(h.gps_latitude::double precision))
           *power(sin(radians(h.gps_longitude::double precision-p_lng)/2),2)
        ))) <= p_radius_km))
      and ((p_min_price is null and p_max_price is null) or exists (
        select 1 from public.hotel_rooms r where r.hotel_id = h.hotel_id
          and (p_min_price is null or coalesce((
            select min(plan.price_per_night) from public.hotel_rate_plans plan
            where plan.room_id = r.room_id and plan.active
          ),r.price_per_night) >= p_min_price)
          and (p_max_price is null or coalesce((
            select min(plan.price_per_night) from public.hotel_rate_plans plan
            where plan.room_id = r.room_id and plan.active
          ),r.price_per_night) <= p_max_price)
      ))
      and (p_cursor_featured is null or p_cursor_created_at is null or p_cursor_id is null
        or (h.featured,h.created_at,h.hotel_id) < (p_cursor_featured,p_cursor_created_at,p_cursor_id))
    order by h.featured desc,h.created_at desc,h.hotel_id desc
    limit least(greatest(coalesce(p_limit,24),1),48)+1
  ), page as materialized (
    select * from picked order by featured desc,created_at desc,hotel_id desc
    limit least(greatest(coalesce(p_limit,24),1),48)
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
  );
$$;

revoke all on function public.search_discoverable_hotels(
  text,text,text,text[],numeric,numeric,double precision,double precision,numeric,boolean,timestamptz,integer,integer
) from public;
grant execute on function public.search_discoverable_hotels(
  text,text,text,text[],numeric,numeric,double precision,double precision,numeric,boolean,timestamptz,integer,integer
) to anon,authenticated,service_role;
