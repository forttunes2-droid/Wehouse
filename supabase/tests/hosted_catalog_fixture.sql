-- Run ONLY against the empty WeHouse Test project qoobnkedfyosnizrlttt.
-- Synthetic discovery data. No auth users, messages, bookings, payment or media.
-- Publication triggers are bypassed for fixture setup; this is not a test of
-- inspection or listing publication. The IDs and email domain are reserved.
begin;
do $$ begin
  if exists (select 1 from auth.users) or exists (select 1 from public.listings) or exists (select 1 from public.hotels)
     or exists (select 1 from public.profiles) then
    raise exception 'Hosted discovery fixture requires an empty dedicated Test project';
  end if;
end $$;
set local session_replication_role = replica;
insert into public.profiles (auth_id,email,user_id,role,profile_complete)
values ('capacity-stage-owner','capacity-stage-owner@example.invalid','capacity-stage-owner','user',false),
       ('capacity-stage-reviewer','capacity-stage-reviewer@example.invalid','capacity-stage-reviewer','user',false);
insert into public.inspection_requests
  (id,request_code,owner_id,owner_email,property_address,property_city,property_state,status)
select md5('wehouse-hosted-home-'||g)::uuid,'CAPACITY-HOME-'||g,'capacity-stage-owner',
  'capacity-stage-owner@example.invalid','Synthetic address '||g,
  case when g%2=0 then 'Lafia' else 'Keffi' end,'Nasarawa','completed'
from generate_series(1,1000) g;
insert into public.listings
  (listing_id,title,description,price,property_type,sub_type,state,city,address,
   owner_id,status,availability_status,approved_by,approved_at,inspection_request_id,created_at)
select 'capacity-stage-home-'||g,'Synthetic test home '||g,'Test project discovery fixture',80000+(g%1000),
  'apartment',case when g%2=0 then 'short_let' else 'long_stay' end,'Nasarawa',
  case when g%2=0 then 'Lafia' else 'Keffi' end,'Synthetic address '||g,
  'capacity-stage-owner','available','available','capacity-stage-reviewer',now(),
  md5('wehouse-hosted-home-'||g)::uuid,now()-g*interval '1 second'
from generate_series(1,1000) g;
insert into public.hotels
  (hotel_id,name,description,state,city,address,owner_id,status,approved_by,approved_at,published_at,created_at)
select -2000000-g,'Synthetic test hotel '||g,'Test project discovery fixture','Nasarawa',
  case when g%2=0 then 'Lafia' else 'Keffi' end,'Synthetic address '||g,
  'capacity-stage-owner','active','capacity-stage-reviewer',now(),now(),now()-g*interval '1 second'
from generate_series(1,1000) g;
insert into public.hotel_rooms (room_id,hotel_id,room_type,price_per_night,total_rooms)
select -12000000-g,-2000000-g,'Synthetic room',20000+(g%10)*1000,10
from generate_series(1,1000) g;
commit;
analyze public.listings;
analyze public.hotels;
analyze public.hotel_rooms;
