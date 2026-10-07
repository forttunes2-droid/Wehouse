alter table public.worker_bookings drop constraint if exists worker_bookings_location_pair_check;
alter table public.worker_bookings add constraint worker_bookings_location_pair_check check (
  (service_latitude is null and service_longitude is null)
  or (
    service_latitude between -90 and 90
    and service_longitude between -180 and 180
  )
);
