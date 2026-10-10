\set ON_ERROR_STOP on
do $$
begin
  if to_regclass('public.listings_public_feed_city_idx') is null then
    raise exception 'Home city-only discovery index is missing';
  end if;
  if to_regclass('public.hotels_public_city_feed_idx') is null then
    raise exception 'Hotel city-only discovery index is missing';
  end if;
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    join pg_language l on l.oid=p.prolang
    where n.nspname='public'
      and p.proname='search_discoverable_hotels'
      and p.pronargs=13
      and l.lanname='plpgsql'
      and position('execute $query$' in lower(pg_get_functiondef(p.oid)))>0
  ) then
    raise exception 'Hotel discovery must retain parameter-aware bounded query planning';
  end if;
end
$$;
