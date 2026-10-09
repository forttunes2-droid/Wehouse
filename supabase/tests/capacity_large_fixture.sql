\set ON_ERROR_STOP on
begin;
set local session_replication_role = replica;

-- Large disposable workload: 1,000,000 active roommate actors backed by
-- deterministic profile/auth identities already seeded by capacity_scale_profiles.sql.
update public.profiles
set account_kind='consumer', profile_complete=true, gender=case when g%2=0 then 'male' else 'female' end,
    privacy_profile_visible=true, privacy_search_visible=true, deleted=false, suspended=false, banned=false,
    state='Nasarawa', city='Lafia', local_government='Lafia'
from generate_series(1,1000000) g
where public.profiles.user_id='load-user-'||g;

insert into public.roommate_preferences(
  user_id,auth_id,gender,gender_preference,budget_min,budget_max,
  preferred_state,preferred_lga,preferred_area,move_in_mode,move_in_from,move_in_to,
  room_arrangement,cleanliness,noise_level,visitors,stay_duration,sleep_routine,
  smoking_habit,smoking_preference,overnight_visitors,pets_preference,
  school_name,school_match,practical_preferences_version,active,search_status,
  search_started_at,search_expires_at
)
select
  'load-user-'||g,
  ('00000000-0000-4000-8000-'||lpad(to_hex(g),12,'0'))::uuid,
  case when g%2=0 then 'male' else 'female' end,
  'no_preference',300000,600000,'Nasarawa','Lafia',null,'flexible',null,null,
  'either','neat','moderate','sometimes','1_year','varies','never','no','agreement','agreement',
  null,false,2,true,'active',now(),null
from generate_series(1,1000000) g
on conflict(user_id) do update set active=true,search_status='active',practical_preferences_version=2,updated_at=now();

-- Small physical hotel inventory is enough to exercise the booking contention
-- path while the 7,000,000-home catalog exercises broad listing scale.
insert into public.hotels (hotel_id,name,description,state,city,address,owner_id,status,approved_at,published_at,created_at)
select -1000000-g,'Large burst hotel '||g,'Disposable capacity fixture','Nasarawa',
       'Lafia','Synthetic burst address '||g,'load-owner-'||g,'active',now(),now(),now()
from generate_series(1,50) g
on conflict(hotel_id) do nothing;

insert into public.hotel_rooms (room_id,hotel_id,room_type,price_per_night,total_rooms)
select -10000000-g,-1000000-g,'Burst room',20000,10
from generate_series(1,50) g
on conflict(room_id) do nothing;

insert into public.hotel_rate_plans (rate_plan_id,hotel_id,room_id,name,meal_plan,payment_timing,refundable,cancellation_template,price_per_night,active)
select -3000000-g,-1000000-g,-10000000-g,'Burst room only','room_only','pay_now',false,'standard',20000,true
from generate_series(1,50) g
on conflict(rate_plan_id) do nothing;

insert into public.hotel_room_units (hotel_id,room_id,unit_label,status)
select -1000000-g,-10000000-g,'Burst '||g||'-'||unit,'ready'
from generate_series(1,50) g cross join generate_series(1,10) unit
on conflict do nothing;

commit;

analyze public.profiles;
analyze public.roommate_preferences;
analyze public.hotels;
analyze public.hotel_rooms;
analyze public.hotel_rate_plans;
analyze public.hotel_room_units;
