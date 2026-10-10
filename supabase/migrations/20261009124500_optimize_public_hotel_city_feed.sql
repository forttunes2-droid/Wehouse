-- City-only hotel discovery needs a matching leading index column.
-- The broader state/city index cannot serve city-only filters efficiently.
-- Preserve the published visibility predicate and stable hotel ordering.
create index if not exists hotels_public_city_feed_idx
  on public.hotels (lower(city), featured desc, created_at desc, hotel_id desc)
  where status = 'active' and approved_at is not null and published_at is not null;
