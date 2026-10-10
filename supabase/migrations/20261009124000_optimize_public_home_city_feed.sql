-- City-only home discovery needs a city-leading index; the state/city
-- composite index cannot efficiently serve requests that filter only by city.
-- Keep the same public visibility boundary and stable chronological ordering.
create index if not exists listings_public_feed_city_idx
  on public.listings (lower(city), created_at desc, id desc)
  where deleted_at is null
    and inspection_request_id is not null
    and approved_at is not null
    and status = 'available'
    and availability_status = 'available'
    and (property_type is null or property_type <> 'hotel');
