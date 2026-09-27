\set ON_ERROR_STOP on
begin;
set local role anon;
do $$
declare
  first_page jsonb;
  next_page jsonb;
  filtered jsonb;
  item jsonb;
begin
  first_page := public.search_discoverable_homes(p_limit => 24);
  if jsonb_array_length(first_page->'items') <> 24
     or first_page->>'has_more' <> 'true' then
    raise exception 'Public discovery did not return a bounded first page';
  end if;
  next_page := public.search_discoverable_homes(
    p_cursor_created_at => (first_page->>'next_cursor_created_at')::timestamptz,
    p_cursor_id => (first_page->>'next_cursor_id')::uuid,
    p_limit => 24
  );
  if jsonb_array_length(next_page->'items') <> 24
     or exists(
       select 1 from jsonb_array_elements(first_page->'items') a
       join jsonb_array_elements(next_page->'items') b on a->>'id'=b->>'id'
     ) then raise exception 'Public page cursor repeated a listing'; end if;
  filtered := public.search_discoverable_homes(
    p_city => 'Lafia', p_stay_type => 'short_let', p_limit => 1000
  );
  if jsonb_array_length(filtered->'items') <> 48 then
    raise exception 'Public page limit was not capped';
  end if;
  for item in select value from jsonb_array_elements(filtered->'items') loop
    if item->>'city' <> 'Lafia' or item->>'sub_type' <> 'short_let'
       or item ? 'inspection_request_id' or item ? 'owner_id'
       or item->'gps_latitude' <> 'null'::jsonb then
      raise exception 'Public discovery filters or privacy projection failed';
    end if;
  end loop;
end $$;
rollback;
