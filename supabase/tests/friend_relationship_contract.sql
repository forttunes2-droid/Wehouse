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
('95000000-0000-4000-8000-000000000001','friend-a@example.invalid','friend-a','user',true,'consumer','Ada','Lagos','Ikeja','Ikeja'),
('95000000-0000-4000-8000-000000000002','friend-b@example.invalid','friend-b','user',true,'consumer','Bola','Lagos','Ikeja','Ikeja'),
('95000000-0000-4000-8000-000000000003','friend-c@example.invalid','friend-c','user',true,'consumer','Chika','Lagos','Ikeja','Ikeja'),
('95000000-0000-4000-8000-000000000004','friend-d@example.invalid','friend-d','user',true,'consumer','Dayo','Lagos','Ikeja','Ikeja');
set local session_replication_role=origin;

-- Direct table access is closed to signed-in users.
select set_config('request.jwt.claims','{"sub":"95000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect(pg_temp.rejects('select 1 from public.friends'),'authenticated users must not read friends directly');

-- A sends a request; nobody else can answer for B.
select pg_temp.expect((public.send_friend_request('friend-b')->>'status')='pending','request starts pending');
select pg_temp.expect(pg_temp.rejects($$select public.send_friend_request('friend-a')$$),'cannot add yourself');
reset role;
select set_config('test.friend_id',(select id::text from public.friends where user_low='friend-a' and user_high='friend-b'),true);
select pg_temp.expect(not public.are_friends('friend-a','friend-b'),'pending is not friends');

select set_config('request.jwt.claims','{"sub":"95000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect(pg_temp.rejects(format('select public.respond_to_friend_request(%L::uuid,true)',current_setting('test.friend_id'))),'requester cannot accept own request');

select set_config('request.jwt.claims','{"sub":"95000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select pg_temp.expect(pg_temp.rejects(format('select public.respond_to_friend_request(%L::uuid,true)',current_setting('test.friend_id'))),'outsider cannot accept');

select set_config('request.jwt.claims','{"sub":"95000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select pg_temp.expect((public.respond_to_friend_request(current_setting('test.friend_id')::uuid,true)->>'status')='accepted','recipient accepts');
reset role;
select pg_temp.expect(public.are_friends('friend-a','friend-b') and public.are_friends('friend-b','friend-a'),'accepted pair is symmetric');
select pg_temp.expect(not public.are_friends('friend-a','friend-c'),'unrelated pair is not friends');

-- friend data is separate from Roommate.
select pg_temp.expect(not exists(select 1 from public.conversations where conversation_type='roommate'
  and participant_a in ('friend-a','friend-b') and participant_b in ('friend-a','friend-b')),
  'friend acceptance creates no roommate conversation');

select set_config('request.jwt.claims','{"sub":"95000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect(pg_temp.rejects($$select public.send_friend_request_by_username('no-such-user')$$),'unknown username gets the same generic rejection');
select pg_temp.expect(pg_temp.rejects($$select public.send_friend_request_by_username('  ')$$),'blank username is rejected');
reset role;
update public.profiles set username='friend_c_user' where user_id='friend-c';
select set_config('request.jwt.claims','{"sub":"95000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect((public.send_friend_request_by_username(' friend_C_User ')->>'status')='pending','username request is exact and case-insensitive');

-- Removing ends the relationship.
select pg_temp.expect((public.remove_friend('friend-b')->>'removed')::boolean,'remove succeeds');
reset role;
select pg_temp.expect(not public.are_friends('friend-a','friend-b'),'removed pair is not friends');
select set_config('request.jwt.claims','{"sub":"95000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect(pg_temp.rejects($$select public.send_friend_request('friend-b')$$),'a cancelled pair waits 30 days before a new request');
reset role;

-- Payer cap: 3 payers maximum, and never more than the guest count.
set local session_replication_role=replica;
insert into public.shared_payment_groups(shared_payment_group_id,product_type,listing_id,created_by,total_amount,capacity,status,guest_count) values
('95000000-0000-4000-8000-000000000101','short_let','cap-listing','friend-a',300,4,'inviting',2),
('95000000-0000-4000-8000-000000000102','long_let','cap-listing-2','friend-a',400,4,'inviting',5);
set local session_replication_role=origin;

insert into public.shared_payment_members(shared_payment_group_id,user_id,share_amount) values
('95000000-0000-4000-8000-000000000101','friend-a',150),
('95000000-0000-4000-8000-000000000101','friend-b',150);
select pg_temp.expect(pg_temp.rejects($$insert into public.shared_payment_members(shared_payment_group_id,user_id,share_amount)
  values('95000000-0000-4000-8000-000000000101','friend-c',100)$$),'payers must not exceed the guest count');

insert into public.shared_payment_members(shared_payment_group_id,user_id,share_amount) values
('95000000-0000-4000-8000-000000000102','friend-a',100),
('95000000-0000-4000-8000-000000000102','friend-b',100),
('95000000-0000-4000-8000-000000000102','friend-c',100);
select pg_temp.expect(pg_temp.rejects($$insert into public.shared_payment_members(shared_payment_group_id,user_id,share_amount)
  values('95000000-0000-4000-8000-000000000102','friend-d',100)$$),'no more than 3 payers on one stay');

-- A declined payer frees a place.
update public.shared_payment_members set invitation_state='declined'
where shared_payment_group_id='95000000-0000-4000-8000-000000000102' and user_id='friend-c';
insert into public.shared_payment_members(shared_payment_group_id,user_id,share_amount)
values('95000000-0000-4000-8000-000000000102','friend-d',100);

select 'friend_relationship_and_payer_cap_contract_ok' as result;
rollback;
