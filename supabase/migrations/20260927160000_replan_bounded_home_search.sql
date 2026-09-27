-- Replan the fixed, parameterized bounded search for each filter set.
-- A generic SQL-function plan scanned the medium catalog despite the public indexes.
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
language plpgsql stable security definer
set search_path to 'pg_catalog','public'
as $$
declare v_result jsonb;
begin
  execute $query$
with picked as materialized (
    select l.*
    from public.listings l
    where l.deleted_at is null
      and l.inspection_request_id is not null
      and l.approved_at is not null
      and l.status = 'available'
      and l.availability_status = 'available'
      and (l.property_type is null or l.property_type <> 'hotel')
      and (nullif(btrim($2),'') is null or lower(l.state) = lower(btrim($2)))
      and (nullif(btrim($3),'') is null or lower(l.city) = lower(btrim($3)))
      and (nullif(btrim($4),'') is null or l.sub_type = $4)
      and ($5 is null or l.price >= $5)
      and ($6 is null or l.price <= $6)
      and ($7 is null or l.bedrooms >= $7)
      and ($8 is null or l.bathrooms >= $8)
      and (nullif(btrim($1),'') is null or
        strpos(lower(coalesce(l.title,'')),lower(left(btrim($1),80))) > 0 or
        strpos(lower(coalesce(l.address,'')),lower(left(btrim($1),80))) > 0 or
        strpos(lower(coalesce(l.city,'')),lower(left(btrim($1),80))) > 0 or
        strpos(lower(coalesce(l.state,'')),lower(left(btrim($1),80))) > 0)
      and ($9 is null or $10 is null or
        (l.created_at,l.id) < ($9,$10))
    order by l.created_at desc,l.id desc
    limit least(greatest(coalesce($11,24),1),48)+1
  ),
  page as materialized (
    select * from picked
    order by created_at desc,id desc
    limit least(greatest(coalesce($11,24),1),48)
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
  )
  $query$ into v_result using p_query, p_state, p_city, p_stay_type, p_min_price, p_max_price, p_min_bedrooms, p_min_bathrooms, p_cursor_created_at, p_cursor_id, p_limit;
  return v_result;
end
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
