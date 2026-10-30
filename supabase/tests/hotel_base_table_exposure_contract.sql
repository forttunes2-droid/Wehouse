\set ON_ERROR_STOP on

-- Browser roles must not read or write hotel base tables directly. Public hotel
-- data is served by masked RPCs; operations go through RPCs that check the
-- caller's hotel capability. This test checks effective privileges and policies
-- (not policy names), so it holds however the exposure is closed.
do $$
declare
  bad text;
begin
  -- anon has no direct access to hotel base tables.
  select string_agg(format('anon can %s %s', priv, tbl), '; ' order by tbl, priv)
  into bad
  from unnest(array[
    'hotels','hotel_rooms','hotel_room_units','hotel_rate_plans',
    'hotel_inventory_daily','hotel_bookings','hotel_team_members'
  ]) as tbl
  cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) as priv
  where to_regclass('public.'||tbl) is not null
    and has_table_privilege('anon','public.'||tbl,priv);
  if bad is not null then
    raise exception 'Anonymous hotel base-table access: %',bad;
  end if;

  -- Signed-in users cannot write hotel base tables directly.
  select string_agg(format('authenticated can %s %s', priv, tbl), '; ' order by tbl, priv)
  into bad
  from unnest(array[
    'hotels','hotel_rooms','hotel_room_units','hotel_rate_plans',
    'hotel_inventory_daily','hotel_bookings','hotel_team_members'
  ]) as tbl
  cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) as priv
  where to_regclass('public.'||tbl) is not null
    and has_table_privilege('authenticated','public.'||tbl,priv);
  if bad is not null then
    raise exception 'Direct hotel base-table writes: %',bad;
  end if;

  -- No policy gives anon/public a read, and none gives signed-in users an
  -- unconditional read of hotel base tables.
  select string_agg(format('%s.%s (%s)', tablename, policyname, cmd), '; ' order by tablename, policyname)
  into bad
  from pg_policies
  where schemaname='public'
    and tablename in ('hotels','hotel_rooms','hotel_room_units','hotel_rate_plans',
                      'hotel_inventory_daily','hotel_bookings','hotel_team_members')
    and cmd in ('SELECT','ALL')
    and (roles && array['anon','public']::name[]
         or lower(coalesce(qual,'')) in ('true','(true)'));
  if bad is not null then
    raise exception 'Hotel base-table read policy is open: %',bad;
  end if;

  -- Customers cannot update their own hotel booking row directly: legal
  -- transitions are RPC-only.
  select string_agg(policyname||' ('||cmd||')', '; ' order by policyname)
  into bad
  from pg_policies
  where schemaname='public'
    and tablename='hotel_bookings'
    and cmd in ('INSERT','UPDATE','DELETE','ALL')
    -- Restrictive policies can only narrow existing authority, never grant it.
    and permissive='PERMISSIVE'
    and roles && array['anon','public','authenticated']::name[];
  if bad is not null then
    raise exception 'Direct hotel_bookings write policy exists: %',bad;
  end if;

  -- RLS stays on for every hotel base table.
  select string_agg(c.relname, ', ' order by c.relname)
  into bad
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and c.relkind='r'
    and c.relname in ('hotels','hotel_rooms','hotel_room_units','hotel_rate_plans',
                      'hotel_inventory_daily','hotel_bookings','hotel_team_members')
    and not c.relrowsecurity;
  if bad is not null then
    raise exception 'RLS is off for hotel tables: %',bad;
  end if;
end $$;

select 'hotel base-table exposure contract passed' as result;
