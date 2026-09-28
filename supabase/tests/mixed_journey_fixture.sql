\set ON_ERROR_STOP on
-- Disposable local Supabase only; loaded after load_baseline_fixture.sql.
begin;
set local session_replication_role = replica;
insert into public.hotel_rate_plans (
  rate_plan_id, hotel_id, room_id, name, meal_plan, payment_timing,
  refundable, price_per_night, active
)
select -3000000 - h * 10 - r, -1000000 - h, -2000000 - h * 10 - r,
  'Synthetic room only', 'room_only', 'pay_now', false, 20000, true
from generate_series(1, 50) h cross join generate_series(1, 2) r;
insert into public.hotel_room_units (hotel_id, room_id, unit_label, status)
select -1000000 - h, -2000000 - h * 10 - r,
  'Synthetic ' || h || '-' || r || '-' || unit, 'ready'
from generate_series(1, 50) h cross join generate_series(1, 2) r
cross join generate_series(1, 10) unit;
commit;
