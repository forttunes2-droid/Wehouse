-- Discovery now uses get_discoverable_listings(), which redacts the street
-- address, operational IDs and precise GPS values. Retire access to the old
-- discovery RPC so it cannot remain a parallel exact-location path.
revoke execute on function public.get_discoverable_homes() from public, anon, authenticated;
