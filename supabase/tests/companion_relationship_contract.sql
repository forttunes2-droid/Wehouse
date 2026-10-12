\set ON_ERROR_STOP on
begin;
create function pg_temp.expect(value boolean, description text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAIL: %',description; end if;end$$;
grant execute on function pg_temp.expect(boolean,text) to authenticated,anon,service_role;
-- Runs a statement and returns true only if it was rejected, so a failed expectation is never swallowed.
create function pg_temp.rejects(statement text) returns boolean language plpgsql as $$
begin execute statement; return false; exception when others then return true; end $$;
grant execute on function pg_temp.rejects(text) to authenticated,anon,service_role;

set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,account_kind,full_name,state,city,local_government) values
('95000000-0000-4000-8000-000000000001','companion-a@example.invalid','companion-a','user',true,'consumer','Ada','Lagos','Ikeja','Ikeja'),
('95000000-0000-4000-8000-000000000002','companion-b@example.invalid','companion-b','user',true,'consumer','Bola','Lagos','Ikeja','Ikeja'),
('95000000-0000-4000-8000-000000000003','companion-c@example.invalid','companion-c','user',true,'consumer','Chika','Lagos','Ikeja','Ikeja'),
('95000000-0000-4000-8000-000000000004','companion-d@example.invalid','companion-d','user',true,'consumer','Dayo','Lagos','Ikeja','Ikeja');
set local session_replication_role=origin;

-- Direct table access is closed to signed-in users.
select set_config('request.jwt.claims','{"sub":"95000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect(pg_temp.rejects('select 1 from public.companions'),'authenticated users must not read companions directly');

-- A sends a request; nobody else can answer for B.
select pg_temp.expect((public.send_companion_request('companion-b')->>'status')='pending','request starts pending');
select pg_temp.expect(pg_temp.rejects($$select public.send_companion_request('companion-a')$$),'cannot add yourself');
reset role;
select set_config('test.companion_id',(select id::text from public.companions where user_low='companion-a' and user_high='companion-b'),true);
select pg_temp.expect(not public.are_companions('companion-a','companion-b'),'pending is not companions');

select set_config('request.jwt.claims','{"sub":"95000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect(pg_temp.rejects(format('select public.respond_to_companion_request(%L::uuid,true)',current_setting('test.companion_id'))),'requester cannot accept own request');

select set_config('request.jwt.claims','{"sub":"95000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select pg_temp.expect(pg_temp.rejects(format('select public.respond_to_companion_request(%L::uuid,true)',current_setting('test.companion_id'))),'outsider cannot accept');

select set_config('request.jwt.claims','{"sub":"95000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select pg_temp.expect((public.respond_to_companion_request(current_setting('test.companion_id')::uuid,true)->>'status')='accepted','recipient accepts');
reset role;
select pg_temp.expect(public.are_companions('companion-a','companion-b') and public.are_companions('companion-b','companion-a'),'accepted pair is symmetric');
select pg_temp.expect(not public.are_companions('companion-a','companion-c'),'unrelated pair is not companions');

-- Companion data is separate from Roommate.
select pg_temp.expect(not exists(select 1 from public.conversations where conversation_type='roommate'
  and participant_a in ('companion-a','companion-b') and participant_b in ('companion-a','companion-b')),
  'companion acceptance creates no roommate conversation');

-- Blocked pairs cannot send requests.
insert into public.roommate_user_blocks(blocker_user_id,blocked_user_id) values('companion-d','companion-a');
select set_config('request.jwt.claims','{"sub":"95000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect(pg_temp.rejects($$select public.send_companion_request('companion-d')$$),'blocked pair cannot request');

-- Removing ends the relationship.
select pg_temp.expect((public.remove_companion('companion-b')->>'removed')::boolean,'remove succeeds');
reset role;
select pg_temp.expect(not public.are_companions('companion-a','companion-b'),'removed pair is not companions');

-- Payer cap: 3 payers maximum, and never more than the guest count.
set local session_replication_role=replica;
insert into public.shared_payment_groups(shared_payment_group_id,product_type,listing_id,created_by,total_amount,capacity,status,guest_count) values
('95000000-0000-4000-8000-000000000101','short_let','cap-listing','companion-a',300,4,'inviting',2),
('95000000-0000-4000-8000-000000000102','long_let','cap-listing-2','companion-a',400,4,'inviting',5);
set local session_replication_role=origin;

insert into public.shared_payment_members(shared_payment_group_id,user_id,share_amount) values
('95000000-0000-4000-8000-000000000101','companion-a',150),
('95000000-0000-4000-8000-000000000101','companion-b',150);
select pg_temp.expect(pg_temp.rejects($$insert into public.shared_payment_members(shared_payment_group_id,user_id,share_amount)
  values('95000000-0000-4000-8000-000000000101','companion-c',100)$$),'payers must not exceed the guest count');

insert into public.shared_payment_members(shared_payment_group_id,user_id,share_amount) values
('95000000-0000-4000-8000-000000000102','companion-a',100),
('95000000-0000-4000-8000-000000000102','companion-b',100),
('95000000-0000-4000-8000-000000000102','companion-c',100);
select pg_temp.expect(pg_temp.rejects($$insert into public.shared_payment_members(shared_payment_group_id,user_id,share_amount)
  values('95000000-0000-4000-8000-000000000102','companion-d',100)$$),'no more than 3 payers on one stay');

-- A declined payer frees a place.
update public.shared_payment_members set invitation_state='declined'
where shared_payment_group_id='95000000-0000-4000-8000-000000000102' and user_id='companion-c';
insert into public.shared_payment_members(shared_payment_group_id,user_id,share_amount)
values('95000000-0000-4000-8000-000000000102','companion-d',100);

select 'companion_relationship_and_payer_cap_contract_ok' as result;
rollback;
