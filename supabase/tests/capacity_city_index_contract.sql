\set ON_ERROR_STOP on
do $$
begin
  if to_regclass('public.listings_public_feed_city_idx') is null then
    raise exception 'Home city-only discovery index is missing';
  end if;
  if to_regclass('public.hotels_public_city_feed_idx') is null then
    raise exception 'Hotel city-only discovery index is missing';
  end if;
end
$$;
