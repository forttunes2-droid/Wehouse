begin;
set local search_path='';
set local lock_timeout='5s';
-- SQL CHECK accepts UNKNOWN. The previous range expression therefore accepted
-- a latitude without a longitude (or the reverse). Preserve address-only work,
-- but require a complete, valid pair whenever a map position is stored.
do $$begin
 if exists(select 1 from public.worker_bookings where (service_latitude is null)<>(service_longitude is null)
  or service_latitude is not null and service_latitude not between -90 and 90
  or service_longitude is not null and service_longitude not between -180 and 180) then
  raise exception 'Review existing Service booking coordinates before applying this change';
 end if;
end $$;
alter table public.worker_bookings drop constraint worker_bookings_location_pair_check;
alter table public.worker_bookings add constraint worker_bookings_location_pair_check check(
 (service_latitude is null)=(service_longitude is null)
 and (service_latitude is null or (service_latitude between -90 and 90 and service_longitude between -180 and 180))
) not valid;
alter table public.worker_bookings validate constraint worker_bookings_location_pair_check;
commit;
