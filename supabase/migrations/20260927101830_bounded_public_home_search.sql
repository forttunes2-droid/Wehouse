-- Bounded public discovery. A page is projected only after publication and
-- availability checks; raw operational/coordinate fields never leave Postgres.
create index if not exists listings_public_feed_order_idx
  on public.listings (created_at desc, id desc)
  where deleted_at is null and inspection_request_id is not null
    and approved_at is not null and status = 'available'
    and availability_status = 'available'
    and (property_type is null or property_type <> 'hotel');

create index if not exists listings_public_feed_location_idx
  on public.listings (lower(state), lower(city), created_at desc, id desc)
  where deleted_at is null and inspection_request_id is not null
    and approved_at is not null and status = 'available'
    and availability_status = 'available'
    and (property_type is null or property_type <> 'hotel');

create or replace function public.search_discoverable_homes(
  p_query text default null,
  p_state text default null,
  p_city text default null,
  p_stay_type text default null,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_min_bedrooms integer default null,
  p_min_bathrooms integer default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 24
) returns jsonb
language sql stable security definer
set search_path to 'pg_catalog','public'
as $$
  with picked as materialized (
    select l.*
    from public.listings l
    where l.deleted_at is null
      and l.inspection_request_id is not null
      and l.approved_at is not null
      and l.status = 'available'
      and l.availability_status = 'available'
      and (l.property_type is null or l.property_type <> 'hotel')
      and (nullif(btrim(p_state),'') is null or lower(l.state) = lower(btrim(p_state)))
      and (nullif(btrim(p_city),'') is null or lower(l.city) = lower(btrim(p_city)))
      and (nullif(btrim(p_stay_type),'') is null or l.sub_type = p_stay_type)
      and (p_min_price is null or l.price >= p_min_price)
      and (p_max_price is null or l.price <= p_max_price)
      and (p_min_bedrooms is null or l.bedrooms >= p_min_bedrooms)
      and (p_min_bathrooms is null or l.bathrooms >= p_min_bathrooms)
      and (nullif(btrim(p_query),'') is null or
        coalesce(l.title,'') ilike '%' || left(btrim(p_query),80) || '%' or
        coalesce(l.address,'') ilike '%' || left(btrim(p_query),80) || '%' or
        coalesce(l.city,'') ilike '%' || left(btrim(p_query),80) || '%' or
        coalesce(l.state,'') ilike '%' || left(btrim(p_query),80) || '%')
      and (p_cursor_created_at is null or p_cursor_id is null or
        (l.created_at,l.id) < (p_cursor_created_at,p_cursor_id))
    order by l.created_at desc,l.id desc
    limit least(greatest(coalesce(p_limit,24),1),48)+1
  ),
  page as materialized (
    select * from picked
    order by created_at desc,id desc
    limit least(greatest(coalesce(p_limit,24),1),48)
  )
  select jsonb_build_object(
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',l.id,'listing_id',l.listing_id,'title',l.title,
        'description',l.description,'price',l.price,'currency',l.currency,
        'state',l.state,'city',l.city,'address',l.address,
        'images',coalesce(l.images,array[]::text[]),
        'videos',coalesce(l.videos,array[]::text[]),
        'bedrooms',l.bedrooms,'bathrooms',l.bathrooms,
        'availability_status',l.availability_status,'status',l.status,
        'property_type',l.property_type,'sub_type',l.sub_type,
        'security_deposit_amount',l.security_deposit_amount,
        'max_guests',l.max_guests,'max_occupants',l.max_occupants,
        'future_installments_allowed',l.future_installments_allowed,
        'amenities',coalesce(l.amenities,array[]::text[]),
        'created_at',l.created_at,'updated_at',l.updated_at,
        'gps_latitude',null,'gps_longitude',null,
        'location_accuracy_m',null,'location_exact',false,
        'partner_display_name',coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.username),''))
      ) order by l.created_at desc,l.id desc)
      from page l
      left join public.profiles p on p.user_id=coalesce(l.partner_id,l.owner_id)
    ),'[]'::jsonb),
    'has_more',(select count(*) from picked) > (select count(*) from page),
    'next_cursor_created_at',(select created_at from page order by created_at,id limit 1),
    'next_cursor_id',(select id from page order by created_at,id limit 1)
  );
$$;

revoke all on function public.search_discoverable_homes(
  text,text,text,text,numeric,numeric,integer,integer,timestamptz,uuid,integer
) from public;
grant execute on function public.search_discoverable_homes(
  text,text,text,text,numeric,numeric,integer,integer,timestamptz,uuid,integer
) to anon,authenticated,service_role;

comment on function public.search_discoverable_homes(
  text,text,text,text,numeric,numeric,integer,integer,timestamptz,uuid,integer
) is 'Bounded, server-filtered public home search with stable keyset pagination and explicit safe fields.';
