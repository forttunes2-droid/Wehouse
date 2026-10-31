begin;
create function pg_temp.expect(value boolean,description text) returns void language plpgsql as $$begin
 if value is distinct from true then raise exception 'FAIL: %',description;end if;end$$;
grant execute on function pg_temp.expect(boolean,text) to authenticated;
-- Rollback-only prerequisite for the real assignment UPDATE below. A fresh
-- database intentionally has no activated commercial rate; never rely on Test's
-- configured policy or disable the reservation's commission snapshot trigger.
insert into public.creator_policy_versions(
 policy_key,scope_type,scope_key,version,value,value_schema,status,effective_from,
 public_disclosure,disclosure_text,legal_review_state,reason,checksum,published_at)
values('commission_long_let_wehouse_managed','global','*',999999,'{"percent":10}'::jsonb,'{"type":"percent"}'::jsonb,
 'active',now()-interval '1 minute',true,'Rollback fixture only','pending','Booking notification contract fixture','booking-notice-commission-fixture',now())
on conflict do nothing;
-- Metadata fixtures only. Financial truth and successful arrival are exercised
-- by the actual provider-gateway shared Short Let/Hotel contracts.
set local session_replication_role=replica;
insert into auth.users(id,aud,role,email,created_at,updated_at)
select ('79800000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'authenticated','authenticated','booking-role-'||i||'@example.invalid',now(),now()
from generate_series(1,5)i;
insert into public.profiles(auth_id,email,user_id,role,full_name)
select id::text,email,'booking-role-'||right(id::text,1),case right(id::text,1) when '1' then 'property_partner' when '3' then 'creator' when '4' then 'staff' when '5' then 'staff' else 'user' end,'Booking role '||right(id::text,1)
from auth.users where id::text like '79800000-0000-4000-8000-%';
insert into auth.sessions(id,user_id,created_at,updated_at)
select replace(auth_id::text,'-0000-','-2000-')::uuid,auth_id::uuid,now(),now() from public.profiles where user_id like 'booking-role-%';
insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status)
select user_id,auth_id,replace(auth_id::text,'-0000-','-2000-'),'booking-role-'||user_id,'Browser',true,'trusted'
from public.profiles where user_id like 'booking-role-%';
insert into auth.mfa_factors(id,user_id,factor_type,status,secret,created_at,updated_at)
values('79800000-3000-4000-8000-000000000003','79800000-0000-4000-8000-000000000003','totp','verified','ROLLBACK-ONLY-SYNTHETIC-FACTOR',now(),now());
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,scope_state)
values('booking-role-1','property_partner','global',null),('booking-role-3','creator','global',null),
 ('booking-role-4','staff','global',null),('booking-role-4','field_operations','state','Nasarawa'),
 ('booking-role-5','staff','global',null),('booking-role-5','field_operations','state','Kano');
insert into public.listings(id,listing_id,title,owner_id,partner_id,sub_type,property_type,state,city,status,availability_status,management_mode)
values('79800000-4000-4000-8000-000000000001','booking-role-host','Host apartment','booking-role-1','booking-role-1','long_stay','apartment','Nasarawa','Lafia','pending_approval','pending_approval','host'),
 ('79800000-4000-4000-8000-000000000002','booking-role-managed','Managed apartment','booking-role-1','booking-role-1','long_stay','apartment','Nasarawa','Lafia','pending_approval','pending_approval','wehouse');
insert into public.property_host_assignments(listing_id,user_id,assignment_role,status,invited_by,accepted_at,access_level)
values('79800000-4000-4000-8000-000000000001','booking-role-1','owner','active','booking-role-1',now(),'full_hosting'),
 ('79800000-4000-4000-8000-000000000001','booking-role-2','manager','active','booking-role-1',now(),'operations'),
 ('79800000-4000-4000-8000-000000000002','booking-role-1','owner','active','booking-role-1',now(),'full_hosting');
insert into public.reservations(id,listing_id,user_id,status,stay_type,management_mode_snapshot,responsible_host_user_id,manual_payment_status,paid_at,rent_payment_status,rent_paid_at,booking_code)
values('booking-role-history','79800000-4000-4000-8000-000000000002','booking-role-2','cancelled','long_stay','wehouse',null,'paid',now(),'refunded',now(),'NASWH79801'),
 ('booking-role-assignment','79800000-4000-4000-8000-000000000002','booking-role-2','reserved','long_stay','wehouse',null,'paid',now(),'not_started',null,'NASWH79802');
insert into public.partner_support_conversations(id,partner_id,subject,context_type,context_id,channel_kind,property_state,property_city)
values('79800000-5000-4000-8000-000000000001','booking-role-2','Synthetic handover assignment','apartment_reservation','booking-role-assignment','property_operations','Nasarawa','Lafia');
set local session_replication_role=origin;
create function pg_temp.sign_in(p_number integer) returns void language sql as $$
select set_config('request.jwt.claims',jsonb_build_object('sub','79800000-0000-4000-8000-'||lpad(p_number::text,12,'0'),
 'session_id','79800000-2000-4000-8000-'||lpad(p_number::text,12,'0'),'role','authenticated','aal',case when p_number=3 then 'aal2' else 'aal1' end)::text,true)::text is not null;
$$;
grant execute on function pg_temp.sign_in(integer) to authenticated;

-- Drive the real notification triggers with typed transition inputs. This temp
-- table cannot create a booking, alter real money or bypass arrival validation.
create temp table home_notice_probe as select * from public.reservations where false;
create trigger partner_notice after insert or update on home_notice_probe for each row execute function public.notify_property_partner_reservation_lifecycle();
create trigger operations_notice after insert or update on home_notice_probe for each row execute function public.notify_reservation_operations_activity();
insert into home_notice_probe(id,listing_id,user_id,status,stay_type,manual_payment_status,paid_at,rent_payment_status,management_mode_snapshot,responsible_host_user_id,booking_code,updated_at)
values('booking-role-host-probe','79800000-4000-4000-8000-000000000001','booking-role-2','reserved','long_stay','paid',now(),'not_started','host','booking-role-2','NASWH79803',now());
select pg_temp.expect((select count(*)=2 and bool_and(title='Reservation fee confirmed' and message like '%remaining accommodation payment%')
 from public.notifications where source_id='booking-role-host-probe'),'owner and assigned Host know the fee is paid without calling the rent paid');
update home_notice_probe set rent_payment_status='paid',rent_paid_at=now() where id='booking-role-host-probe';
select pg_temp.expect((select count(*)=2 and bool_and(message like '%assigned property Host%' and message not like '%WeHouse is waiting%')
 from public.notifications where source_id='booking-role-host-probe' and title='Rent confirmed'),'Host-managed rent notices identify the actual arrival manager');
update home_notice_probe set status='ready_for_move_in',requested_move_in_at=now()+interval '1 hour',move_in_requested_at=clock_timestamp() where id='booking-role-host-probe';
update home_notice_probe set requested_move_in_at=now()+interval '2 hours',move_in_requested_at=clock_timestamp() where id='booking-role-host-probe';
select pg_temp.expect((select count(*)=4 from public.notifications where source_id='booking-role-host-probe' and title='Move-in time selected'),
 'changing the move-in time notifies owner and Host once for each real change');
select pg_temp.expect(not exists(select 1 from public.activity_events where subject_id='booking-role-host-probe' and event_type='reservation.move_in_requested'),
 'ordinary Host-managed handover does not create a competing Property Operations task');
select pg_temp.expect(not exists(select 1 from public.notifications where source_id='booking-role-host-probe' and (message like '%NASWH%' or destination_params::text like '%NASWH%')),
 'private handover code is absent from notification previews and links');
insert into home_notice_probe(id,listing_id,user_id,status,stay_type,manual_payment_status,paid_at,rent_payment_status,rent_paid_at,management_mode_snapshot,updated_at)
values('booking-role-managed-probe','79800000-4000-4000-8000-000000000002','booking-role-2','ready_for_move_in','long_stay','paid',now(),'paid',now(),'wehouse',now());
update home_notice_probe set requested_move_in_at=now()+interval '2 hours' where id='booking-role-managed-probe';
select pg_temp.expect((select message like '%WeHouse Property Operations%' from public.notifications where source_id='booking-role-managed-probe' and title='Move-in time selected'),
 'WeHouse-managed notice keeps Operations responsible');
select pg_temp.expect(exists(select 1 from public.activity_events where subject_id='booking-role-managed-probe' and event_type='reservation.move_in_requested'),
 'WeHouse-managed arrival retains its scoped Operations task');

select pg_temp.sign_in(1);
set local role authenticated;
select pg_temp.expect(jsonb_array_length(public.get_my_property_partner_stays('79800000-4000-4000-8000-000000000002',null,null,51,'booking-role-history'))=1,
 'recorded paid/refunded booking remains in its owner history');
select pg_temp.expect(not ((public.get_my_property_partner_stays('79800000-4000-4000-8000-000000000002',null,null,51,'booking-role-history')->0)?'booking_code'),
 'owner history still excludes the customer handover code');
select pg_temp.expect((public.get_my_property_partner_stays('79800000-4000-4000-8000-000000000002',null,null,51,'booking-role-history')->0->>'booked_by_name')='Booking role 2',
 'authorised owner sees the booker identity beside the reservation');
select pg_temp.expect(not exists(select 1 from public.reservations where id='booking-role-history'),
 'ordinary property owner cannot bypass the safe projection to read the private arrival code');
reset role;
select pg_temp.sign_in(3);
set local role authenticated;
select public.wehouse_api_request_guard();
do $$declare info jsonb;receipt jsonb;begin
 info:=public.get_reservation_handover_assignment('booking-role-assignment');
 perform pg_temp.expect(exists(select 1 from jsonb_array_elements(info->'candidates') c where c->>'user_id'='booking-role-3' and (c->>'is_creator_self')::boolean),
  'solo Creator is available as itself without a second Staff identity');
 perform pg_temp.expect(not exists(select 1 from jsonb_array_elements(info->'candidates') c where c->>'user_id'='booking-role-5'),
  'Field candidates remain limited to the actual property region');
 perform pg_temp.expect(exists(select 1 from jsonb_array_elements(info->'candidates') c where c->>'user_id'='booking-role-4'),
  'current scoped Field staff remain available alongside the solo Creator');
 receipt:=public.assign_reservation_field_officer('booking-role-assignment','booking-role-3');
 perform pg_temp.expect(receipt->>'assigned_field_officer_id'='booking-role-3','Creator can record its own physical handover assignment');
end$$;
reset role;
select pg_temp.expect(not exists(select 1 from public.workspace_role_assignments where user_id='booking-role-3' and workspace_role='staff'),
 'performing the handover never grants a Staff role');
select pg_temp.expect((select workspace_scope='creator' from public.notifications where recipient_id='booking-role-3' and type='reservation_handover_assigned'),
 'Creator assignment alert returns to the Creator workspace');
update public.workspace_role_assignments set status='revoked',revoked_at=now() where user_id='booking-role-4' and workspace_role='field_operations';
set local role authenticated;
do $$declare info jsonb;begin
 info:=public.get_reservation_handover_assignment('booking-role-assignment');
 perform pg_temp.expect(not exists(select 1 from jsonb_array_elements(info->'candidates') c where c->>'user_id'='booking-role-4'),
  'revoked Field access cannot remain an assignable handover officer');
end$$;
reset role;
select 'PASS: arrival responsibility, accurate payment stages, rescheduling, owner history and solo Creator assignment' as result;
rollback;
