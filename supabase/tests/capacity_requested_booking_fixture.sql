\set ON_ERROR_STOP on
begin;
set local session_replication_role = replica;
insert into public.creator_policy_versions(policy_key,version,value,status,effective_from,legal_review_state,reason,checksum)
values('accommodation_arrival_issue_window',99002,'{"default_hours":2,"minimum_hours":1,"maximum_hours":6}',
  'active',now()-interval '1 minute','reviewed','Disposable requested booking load','requested-booking-fixture');
insert into public.hotel_rate_plans(rate_plan_id,hotel_id,room_id,name,meal_plan,payment_timing,refundable,price_per_night,active)
select -3000000-g,-1000000-g,-10000000-g,'Synthetic room only','room_only','pay_now',false,20000,true
from generate_series(1,50) g;
insert into public.hotel_room_units(hotel_id,room_id,unit_label,status)
select -1000000-g,-10000000-g,'Synthetic '||g||'-'||unit,'ready'
from generate_series(1,50) g cross join generate_series(1,10) unit;
commit;
