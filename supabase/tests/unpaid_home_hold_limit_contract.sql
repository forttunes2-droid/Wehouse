\set ON_ERROR_STOP on
begin;
\ir private_message_fixture_helpers.sql
create function pg_temp.expect(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %',label;end if;end $$;
create function pg_temp.denied(statement text,fragment text) returns boolean language plpgsql as $$
begin execute statement;return false;exception when others then
 if strpos(sqlerrm,fragment)=0 then raise exception 'Unexpected denial: %',sqlerrm;end if;return true;end $$;
grant execute on function pg_temp.expect(boolean,text),pg_temp.denied(text,text) to authenticated;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,username,role,profile_complete,account_kind) values
('9755b000-0000-4000-8000-000000000001','quota-customer@example.invalid','quota-customer','quota_customer','user',true,'consumer'),
('9755b000-0000-4000-8000-000000000002','quota-owner@example.invalid','quota-owner','quota_owner','user',true,'consumer'),
('9755b000-0000-4000-8000-000000000003','quota-creator@example.invalid','quota-creator','quota_creator','creator',true,'consumer');
select pg_temp.prepare_private_message_fixture(array['9755b000']);
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at)
values('9755b000-1000-4000-8000-000000000003','9755b000-0000-4000-8000-000000000003','totp','verified',now(),now());
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status)
values('quota-creator','creator','global','active');
insert into public.creator_elevation_grants(creator_elevation_id,creator_user_id,auth_user_id,auth_session_id,action_classes,issued_at,expires_at,verification_method)
values('9755b000-2000-4000-8000-000000000003','quota-creator','9755b000-0000-4000-8000-000000000003','9755b000-0000-4000-8000-000000000003',array['policy_publish'],now(),now()+interval '10 minutes','password');
update public.platform_settings set value='3',is_active=true where key='active_unpaid_home_hold_limit';
insert into public.platform_settings(key,value,category,label,data_type,is_active) values('reservation_fee','10000','bookings','Reservation fee','number',true)
on conflict(key) do update set value='10000',is_active=true;
insert into public.listings(id,listing_id,title,property_type,sub_type,state,city,status,availability_status,owner_id,partner_id,price)
select ('9755b000-3000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'quota-home-'||n,'Quota fixture '||n,'apartment','long_stay','Lagos','Ikeja',
 case when n<=3 then 'reserved' else 'available' end,case when n<=3 then 'reserved' else 'available' end,'quota-owner','quota-owner',100000 from generate_series(1,4) n;
insert into public.reservations(id,listing_id,user_id,status,reservation_type,stay_type,manual_payment_status,payment_expires_at,stay_check_in,stay_check_out,stay_nights)
select 'quota-hold-'||n,('9755b000-3000-4000-8000-'||lpad((case when n=4 then 6 else n end)::text,12,'0')),'quota-customer',
 case when n=5 then 'reserved' else 'payment_pending' end,'apartment',case when n=2 then 'short_let' else 'long_stay' end,
 case when n=5 then 'paid' else 'unpaid' end,case when n=4 then now()-interval '1 minute' else now()+interval '30 minutes' end,
 case when n=2 then current_date+1 end,case when n=2 then current_date+2 end,case when n=2 then 1 end from generate_series(1,5) n;
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"sub":"9755b000-0000-4000-8000-000000000001","session_id":"9755b000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect((public.create_apartment_reservation('quota-home-1')).id='quota-hold-1','retry reuses an existing hold at the limit');
select pg_temp.expect(pg_temp.denied($q$select public.create_apartment_reservation('quota-home-4')$q$,'already have 3 unpaid property reservations'),'the actual reservation API rejects the fourth unpaid hold');
select pg_temp.expect(pg_temp.denied($q$select public.creator_set_unpaid_home_hold_limit(20,now(),null)$q$,'Recent Creator'),'customers cannot increase their quota');
reset role;
select pg_temp.expect((select count(*)=5 from public.reservations where user_id='quota-customer'),'denied checkout leaves no extra reservation');
select pg_temp.expect((select status='available' and availability_status='available' from public.listings where listing_id='quota-home-4'),'denied checkout leaves the home available');

-- Exercise the installed quota trigger in a scratch table without bypassing
-- unrelated booking/document/financial gates to create a fake paid booking.
create temporary table quota_probe(like public.reservations including defaults) on commit drop;
create trigger quota_probe_guard before insert on quota_probe for each row execute function private.enforce_unpaid_home_hold_limit();
select pg_temp.expect(pg_temp.denied($q$insert into pg_temp.quota_probe(id,listing_id,user_id,status,reservation_type,payment_expires_at) values('quota-probe','unpublished-fixture','quota-customer','payment_pending','apartment',now()+interval '1 minute')$q$,'already have 3'),'quota combines Short Let and Long Let holds');
insert into pg_temp.quota_probe(id,listing_id,user_id,status,reservation_type,payment_expires_at,manual_payment_status)
values('quota-paid','unpublished-fixture','quota-customer','payment_pending','apartment',now()+interval '1 minute','paid'),
 ('quota-expired','unpublished-fixture','quota-customer','payment_pending','apartment',now()-interval '1 minute','unpaid'),
 ('quota-other','unpublished-fixture','quota-owner','payment_pending','apartment',now()+interval '1 minute','unpaid');
select pg_temp.expect((select count(*)=3 from pg_temp.quota_probe),'paid, expired and other-person rows do not consume this customer quota');
set local session_replication_role=replica;
update public.reservations set payment_expires_at=now()-interval '1 minute' where id='quota-hold-3';
set local session_replication_role=origin;
insert into pg_temp.quota_probe(id,listing_id,user_id,status,reservation_type,payment_expires_at)
values('quota-released-slot','unpublished-fixture','quota-customer','payment_pending','apartment',now()+interval '1 minute');
select pg_temp.expect((select count(*)=4 from pg_temp.quota_probe),'expiry releases a quota slot without a background sweep');

select set_config('request.jwt.claims','{"sub":"9755b000-0000-4000-8000-000000000003","session_id":"9755b000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select set_config('test.quota_limit_revision',public.creator_get_unpaid_home_hold_limit()->>'updated_at',true);
select pg_temp.expect(pg_temp.denied($q$select public.creator_set_unpaid_home_hold_limit(0,now(),'9755b000-2000-4000-8000-000000000003')$q$,'Choose 1 to 20'),'Creator cannot publish an invalid quota');
select pg_temp.expect(pg_temp.denied($q$select public.creator_set_unpaid_home_hold_limit(4,'2000-01-01','9755b000-2000-4000-8000-000000000003')$q$,'changed'),'stale Creator settings cannot overwrite a newer revision');
select pg_temp.expect((public.creator_set_unpaid_home_hold_limit(4,current_setting('test.quota_limit_revision')::timestamptz,'9755b000-2000-4000-8000-000000000003')->>'limit')::integer=4,'Creator can change the configured limit');
select public.creator_set_unpaid_home_hold_limit(4,current_setting('test.quota_limit_revision')::timestamptz,'9755b000-2000-4000-8000-000000000003');
reset role;
select pg_temp.expect((select count(*)=1 from public.admin_audit_log where admin_id='quota-creator' and action='unpaid_home_hold_limit_updated'),'lost-response retry does not duplicate the audit');
rollback;
