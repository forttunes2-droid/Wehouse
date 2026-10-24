-- Public presentation settings only. Booking commands still calculate authoritative amounts.
create or replace function public.get_public_discovery_settings()
returns table(key text,value text)
language sql stable security definer set search_path=''
as $body$
 select ps.key,ps.value from public.platform_settings ps
 where ps.is_active=true and ps.key in (
  'home_short_stay_min_price','home_short_stay_max_price',
  'home_long_stay_min_price','home_long_stay_max_price',
  'reservation_fee','short_let_reservation_fee',
  'short_stay_min_nights','short_stay_max_nights','short_stay_booking_advance_days',
  'worker_marketplace_launch_enabled'
 )
 order by ps.key;
$body$;
revoke all on function public.get_public_discovery_settings() from public;
grant execute on function public.get_public_discovery_settings() to anon,authenticated,service_role;
comment on function public.get_public_discovery_settings() is
 'Public allowlist for discovery presentation; no administrative settings or booking price authority.';
