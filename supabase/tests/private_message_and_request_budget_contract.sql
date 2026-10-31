\set ON_ERROR_STOP on
begin;
\ir private_message_fixture_helpers.sql
create function pg_temp.expect(value boolean,label text) returns void language plpgsql as $$begin
 if value is distinct from true then raise exception 'FAIL: %',label;end if;end $$;
create function pg_temp.denied(statement text,fragment text) returns boolean language plpgsql as $$
begin execute statement;return false;exception when others then
 if strpos(sqlerrm,fragment)=0 then raise exception 'Unexpected denial: %',sqlerrm;end if;return true;end $$;
grant execute on function pg_temp.expect(boolean,text),pg_temp.denied(text,text) to authenticated;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,account_kind) values
('9755c000-0000-4000-8000-000000000001','budget-a@example.invalid','budget-a','user',true,'consumer'),
('9755c000-0000-4000-8000-000000000002','budget-b@example.invalid','budget-b','user',true,'consumer');
select pg_temp.prepare_private_message_fixture(array['9755c000']);
insert into public.friends(id,user_low,user_high,requested_by,status)
values('9755c000-1000-4000-8000-000000000001','budget-a','budget-b','budget-a','accepted');
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"sub":"9755c000-0000-4000-8000-000000000001","session_id":"9755c000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect(pg_temp.denied($q$select public.send_friend_encrypted_message('9755c000-1000-4000-8000-000000000001',repeat('A',65537),'iv')$q$,'message is too large'),'oversized Friend payload is rejected before key/database work');
select pg_temp.expect(pg_temp.denied($q$select public.send_private_encrypted_message('worker','9755c000-1000-4000-8000-000000000001',repeat('A',65537),'iv')$q$,'message is too large'),'oversized service/roommate payload is also rejected');
select set_config('test.budget_envelope',pg_temp.current_envelope_token('friend','9755c000-1000-4000-8000-000000000001'),true);
select pg_temp.expect(public.send_friend_encrypted_message('9755c000-1000-4000-8000-000000000001','Ym9keQ==','aXY=','[]',null,'9755c000-2000-4000-8000-000000000001',current_setting('test.budget_envelope'))='9755c000-2000-4000-8000-000000000001','a normal new message is saved');
reset role;
update public.user_action_rate_limits set attempt_count=90,window_started_at=now() where user_key='budget-a' and action='private_message_send';
set local role authenticated;
select pg_temp.expect(public.send_friend_encrypted_message('9755c000-1000-4000-8000-000000000001','Ym9keQ==','aXY=','[]',null,'9755c000-2000-4000-8000-000000000001',current_setting('test.budget_envelope'))='9755c000-2000-4000-8000-000000000001','lost-response retry retains its recorded receipt at the limit');
select pg_temp.expect(pg_temp.denied(format($q$select public.send_friend_encrypted_message('9755c000-1000-4000-8000-000000000001','Ym9keQ==','aXY=','[]',null,'9755c000-2000-4000-8000-000000000002',%L)$q$,current_setting('test.budget_envelope')),'sending messages too quickly'),'new sends are throttled');
reset role;
select pg_temp.expect((select count(*)=1 from public.friend_messages where friend_id='9755c000-1000-4000-8000-000000000001'),'denied/retried sends create no extra messages');
update public.user_action_rate_limits set window_started_at=now()-interval '2 minutes' where user_key='budget-a' and action='private_message_send';
insert into public.user_action_rate_limits(user_key,action,attempt_count) values('budget-a','service_request_create',10);
set local role authenticated;
select pg_temp.expect(pg_temp.denied($q$select public.create_booking_request('unavailable-provider','Repairs','A valid request description','Fixture address',null,null)$q$,'Too many service requests'),'service-request budget is checked before expensive Provider queries');
select pg_temp.expect(pg_temp.denied($q$select public.create_booking_request('unavailable-provider','Repairs',repeat('A',4001),'Fixture address',null,null)$q$,'details are too long'),'service-request fields have server size bounds');
select pg_temp.expect(public.send_friend_encrypted_message('9755c000-1000-4000-8000-000000000001','Ym9keQ==','aXY=','[]',null,'9755c000-2000-4000-8000-000000000002',current_setting('test.budget_envelope'))='9755c000-2000-4000-8000-000000000002','a new window recovers normal messaging');
select pg_temp.expect(not has_function_privilege(current_user,'public.take_reverse_geocode_provider_slot()','execute'),'clients cannot reserve/bypass the shared geocoder slot');
reset role;
-- Install the actual table constraint on a scratch pair. A malformed input
-- must fail with CHECK violation, rather than passing through SQL NULL logic.
create temporary table coordinate_probe(service_latitude double precision,service_longitude double precision) on commit drop;
do $$declare definition text;begin
 select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid='public.worker_bookings'::regclass and conname='worker_bookings_location_pair_check' and convalidated;
 if definition is null then raise exception 'Validated coordinate constraint missing';end if;
 execute 'alter table coordinate_probe add constraint actual_coordinate_pair '||definition;
end $$;
create function pg_temp.bad_coordinates(latitude double precision,longitude double precision) returns boolean language plpgsql as $$
begin insert into coordinate_probe values(latitude,longitude);return false;exception when check_violation then return true;end $$;
insert into coordinate_probe values(null,null),(0,0),(90,180),(-90,-180);
select pg_temp.expect(pg_temp.bad_coordinates(null,8.5),'longitude alone is invalid');
select pg_temp.expect(pg_temp.bad_coordinates(8.5,null),'latitude alone is invalid');
select pg_temp.expect(pg_temp.bad_coordinates(91,0) and pg_temp.bad_coordinates(0,-181),'coordinates must stay within the actual geographic ranges');
select pg_temp.expect(pg_temp.bad_coordinates('NaN',0) and pg_temp.bad_coordinates(0,'Infinity'),'non-finite coordinates are invalid');
rollback;
