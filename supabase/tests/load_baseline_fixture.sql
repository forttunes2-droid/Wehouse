\set ON_ERROR_STOP on
-- Disposable local CI only. These identifiers are intentionally synthetic.
begin;
set local session_replication_role = replica;

insert into public.listings (
  listing_id, title, description, price, property_type, sub_type,
  state, city, address, status, availability_status, approved_at,
  inspection_request_id, created_at
)
select
  'load-home-' || lpad(g::text, 6, '0'),
  'Synthetic load home ' || g,
  'Disposable capacity fixture',
  80000 + g,
  'apartment',
  case when g % 3 = 0 then 'short_let' else 'long_stay' end,
  'Nasarawa',
  case when g % 2 = 0 then 'Lafia' else 'Keffi' end,
  'Synthetic address ' || g,
  'available',
  'available',
  now(),
  gen_random_uuid(),
  now() - g * interval '1 second'
from generate_series(1, 500) g;

insert into public.hotels (
  hotel_id, name, description, state, city, address, owner_id,
  status, approved_at, published_at, created_at
)
select
  -1000000 - g,
  'Synthetic load hotel ' || g,
  'Disposable capacity fixture',
  'Nasarawa',
  case when g % 2 = 0 then 'Lafia' else 'Keffi' end,
  'Synthetic hotel address ' || g,
  'load-fixture-owner',
  'active',
  now(),
  now(),
  now() - g * interval '1 second'
from generate_series(1, 50) g;

insert into public.hotel_rooms (
  room_id, hotel_id, room_type, price_per_night, total_rooms
)
select
  -2000000 - h * 10 - r,
  -1000000 - h,
  'Synthetic room ' || r,
  15000 + r * 5000,
  10
from generate_series(1, 50) h
cross join generate_series(1, 2) r;
commit;

analyze public.listings;
analyze public.hotels;
analyze public.hotel_rooms;
