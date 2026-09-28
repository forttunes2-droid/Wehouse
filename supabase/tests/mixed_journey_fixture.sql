\set ON_ERROR_STOP on
-- Disposable local Supabase only; loaded after load_baseline_fixture.sql.
begin;
set local session_replication_role = replica;
-- Booking writes require the same active arrival policy snapshot as production.
insert into public.creator_policy_versions(policy_key,version,value,status,effective_from,legal_review_state,reason,checksum)
values('accommodation_arrival_issue_window',99001,'{"default_hours":2,"minimum_hours":1,"maximum_hours":6}',
  'active',now()-interval '1 minute','reviewed','Disposable mixed-journey fixture','mixed-journey-fixture');
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
