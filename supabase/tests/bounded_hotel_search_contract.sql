\set ON_ERROR_STOP on
begin;
set local role anon;
do $$
declare first_page jsonb; next_page jsonb; filtered jsonb; item jsonb;
begin
  first_page := public.search_discoverable_hotels(p_limit => 24);
  if jsonb_array_length(first_page->'items') <> 24 or first_page->>'has_more' <> 'true' then
    raise exception 'Hotel discovery did not return a bounded first page';
  end if;
  next_page := public.search_discoverable_hotels(
    p_cursor_featured => (first_page->>'next_cursor_featured')::boolean,
    p_cursor_created_at => (first_page->>'next_cursor_created_at')::timestamptz,
    p_cursor_id => (first_page->>'next_cursor_id')::integer, p_limit => 24
  );
  if jsonb_array_length(next_page->'items') <> 24 or exists (
    select 1 from jsonb_array_elements(first_page->'items') a
    join jsonb_array_elements(next_page->'items') b on a->>'hotel_id'=b->>'hotel_id'
  ) then raise exception 'Hotel page cursor repeated a hotel'; end if;
  filtered := public.search_discoverable_hotels(p_city => 'Lafia',p_limit => 1000);
  if jsonb_array_length(filtered->'items') <> 25 then raise exception 'Hotel filter or page cap failed'; end if;
  if jsonb_array_length((public.search_discoverable_hotels(p_query => '%'))->'items') <> 0 then
    raise exception 'Hotel search punctuation was interpreted as a wildcard';
  end if;
  if jsonb_array_length((public.search_discoverable_hotels(p_lat => 9.1,p_lng => 8.5,p_radius_km => 5))->'items') <> 0 then
    raise exception 'Hotels without verified coordinates appeared in a radius search';
  end if;
  if jsonb_array_length((public.search_discoverable_hotels(p_min_price => 20000,p_max_price => 20000))->'items') <> 24 then
    raise exception 'Room price range did not filter before paging';
  end if;
  for item in select value from jsonb_array_elements(filtered->'items') loop
    if item->>'city' <> 'Lafia' or item ? 'owner_id'
       or item ? 'inspection_request_id' or item->'gps_latitude' <> 'null'::jsonb then
      raise exception 'Hotel discovery filters or privacy projection failed';
    end if;
  end loop;
end $$;
rollback;
