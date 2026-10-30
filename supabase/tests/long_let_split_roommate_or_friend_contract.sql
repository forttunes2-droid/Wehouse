\set ON_ERROR_STOP on
begin;
create function pg_temp.expect(value boolean, description text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAIL: %',description; end if;end$$;
grant execute on function pg_temp.expect(boolean,text) to authenticated,anon,service_role;
create function pg_temp.rejects(statement text) returns boolean language plpgsql as $$
begin execute statement; return false; exception when others then return true; end $$;
grant execute on function pg_temp.rejects(text) to authenticated,anon,service_role;

set local session_replication_role=replica;
insert into auth.users(id,email) values('97000000-0000-4000-8000-000000000001','ll-a@example.invalid');
insert into auth.users(id,email) values('97000000-0000-4000-8000-000000000003','ll-c@example.invalid');
insert into auth.sessions(id,user_id,created_at,updated_at) values('97000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000001',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at) values('97000000-0000-4000-8000-000000000003','97000000-0000-4000-8000-000000000003',now(),now());
insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status)
values('ll-a','97000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000001','long-let-shared-fixture','Synthetic trusted browser',true,'trusted');
insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status)
values('ll-c','97000000-0000-4000-8000-000000000003','97000000-0000-4000-8000-000000000003','long-let-shared-peer','Synthetic trusted browser',true,'trusted');
insert into public.profiles(auth_id,email,user_id,role,profile_complete,account_kind,full_name,state,city,local_government) values
('97000000-0000-4000-8000-000000000001','ll-a@example.invalid','ll-a','user',true,'consumer','A','Lagos','Ikeja','Ikeja'),
('97000000-0000-4000-8000-000000000002','ll-b@example.invalid','ll-b','user',true,'consumer','B','Lagos','Ikeja','Ikeja'),
('97000000-0000-4000-8000-000000000003','ll-c@example.invalid','ll-c','user',true,'consumer','C','Lagos','Ikeja','Ikeja'),
('97000000-0000-4000-8000-000000000004','ll-d@example.invalid','ll-d','user',true,'consumer','D','Lagos','Ikeja','Ikeja');
insert into public.listings(id,listing_id,title,price,property_type,sub_type,status,availability_status,max_guests,max_occupants,security_deposit_amount,state,city,address) values
('97000000-0000-4000-8000-000000000020','ll-listing-3','Long Let three','1000','apartment','long_stay','available','available',3,3,0,'Lagos','Ikeja','Test address'),
('97000000-0000-4000-8000-000000000021','ll-listing-2','Long Let two','1000','apartment','long_stay','available','available',2,2,0,'Lagos','Ikeja','Test address');
insert into public.conversations(id,participant_a,participant_b,status,conversation_type) values
('97000000-0000-4000-8000-000000000031','ll-a','ll-b','active','roommate');
insert into public.friends(user_low,user_high,requested_by,status) values
('ll-a','ll-c','ll-a','accepted'),('ll-a','ll-d','ll-a','accepted');
set local session_replication_role=origin;

select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;

-- Group/participant state is available only through the existing commands.
-- Even a legitimate payer cannot use old table grants as another interface.
do $$ declare relation text; begin
 foreach relation in array array['shared_housing_groups','shared_housing_members','shared_payment_groups','shared_payment_members','payments'] loop
  begin
   execute format('select 1 from public.%I limit 1',relation);
   raise exception 'Direct shared-payment read remains available: %',relation;
  exception when insufficient_privilege then null;
  end;
  begin
   execute format('delete from public.%I where false',relation);
   raise exception 'Direct shared-payment mutation remains available: %',relation;
  exception when insufficient_privilege then null;
  end;
 end loop;
end $$;

select pg_temp.expect(pg_temp.rejects($$select public.create_my_shared_long_let('97000000-0000-4000-8000-000000000020'::uuid,'{}'::uuid[],'{}'::text[])$$),'must choose someone');
select pg_temp.expect(pg_temp.rejects($$select public.create_my_shared_long_let('97000000-0000-4000-8000-000000000020'::uuid,'{}'::uuid[],array['ll-b'])$$),'a Roommate who is not a friend cannot be passed as a friend');
select pg_temp.expect(pg_temp.rejects($$select public.create_my_shared_long_let('97000000-0000-4000-8000-000000000020'::uuid,'{}'::uuid[],array['ll-c','ll-c'])$$),'same person twice rejected');
select pg_temp.expect(pg_temp.rejects($$select public.create_my_shared_long_let('97000000-0000-4000-8000-000000000021'::uuid,'{}'::uuid[],array['ll-c','ll-d'])$$),'payers cannot exceed property occupancy');

-- Roommate + friend together: 3 payers on a 3-person property.
select pg_temp.expect(
  (public.create_my_shared_long_let('97000000-0000-4000-8000-000000000020'::uuid,array['97000000-0000-4000-8000-000000000031'::uuid],array['ll-c'])) is not null,
  'one Roommate and one friend can split a Long Let');
reset role;
select pg_temp.expect((select count(*) from public.shared_payment_members m join public.shared_payment_groups g using(shared_payment_group_id) where g.listing_id='97000000-0000-4000-8000-000000000020')=3,'three payers recorded');
select pg_temp.expect((select count(*)=1 and bool_and(h.id=p.shared_payment_group_id and h.canonical_group_id=p.shared_payment_group_id and p.legacy_group_id=h.id)
 from public.shared_housing_groups h join public.shared_payment_groups p on p.shared_payment_group_id=h.canonical_group_id
 where h.listing_id='97000000-0000-4000-8000-000000000020'),'one linked group, not competing checkout identities');
select pg_temp.expect((select count(*)=3 and bool_and(h.id=p.shared_payment_member_id and h.canonical_member_id=p.shared_payment_member_id and p.legacy_member_id=h.id and h.share_amount=p.share_amount)
 from public.shared_housing_members h join public.shared_payment_members p on p.shared_payment_member_id=h.canonical_member_id
 join public.shared_housing_groups g on g.id=h.group_id where g.listing_id='97000000-0000-4000-8000-000000000020'),'same three payers and amounts in compatibility projection');
select pg_temp.expect((select sum(share_amount) from public.shared_payment_members m join public.shared_payment_groups g using(shared_payment_group_id) where g.listing_id='97000000-0000-4000-8000-000000000020')=(select total_amount from public.shared_payment_groups where listing_id='97000000-0000-4000-8000-000000000020'),'shares add up to the total');

-- Four payers are never allowed, even on a bigger property.
update public.listings set max_occupants=6 where id='97000000-0000-4000-8000-000000000021';
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect(pg_temp.rejects($$select public.create_my_shared_long_let('97000000-0000-4000-8000-000000000021'::uuid,array['97000000-0000-4000-8000-000000000031'::uuid],array['ll-c','ll-d'])$$),'no more than 3 payers');
reset role;

-- Two payers in a six-occupant property use the actual constructors, not a
-- hand-written group whose capacity accidentally equals its payer count.
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000001","session_id":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.long_shared_group',public.create_my_shared_long_let('97000000-0000-4000-8000-000000000021','{}'::uuid[],array['ll-c'])->>'id',true);
select pg_temp.expect(pg_temp.rejects($$select public.create_my_shared_housing_payment(current_setting('test.long_shared_group')::uuid)$$),'no checkout before the other payer consents');
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000003","session_id":"97000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select public.respond_to_shared_housing_invite(current_setting('test.long_shared_group')::uuid,true);
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000001","session_id":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('test.long_shared_reference',public.create_my_shared_housing_payment(current_setting('test.long_shared_group')::uuid)->>'reference',true);
select pg_temp.expect(public.create_my_shared_housing_payment(current_setting('test.long_shared_group')::uuid)->>'reference'=current_setting('test.long_shared_reference'),'retry reuses the same real checkout');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select pg_temp.expect((public.validate_shared_housing_checkout((select id from public.booking_payments where paystack_reference=current_setting('test.long_shared_reference')),'ll-a')->>'valid')::boolean,'two actual payers can complete checkout in a larger property');
reset role;
savepoint restricted_payer;
update public.profiles set suspended=true where user_id='ll-c';
select pg_temp.expect(not (public.validate_shared_housing_checkout((select id from public.booking_payments where paystack_reference=current_setting('test.long_shared_reference')),'ll-a')->>'valid')::boolean,'a newly suspended participant prevents a new provider checkout');
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000001","session_id":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect(pg_temp.rejects($$select public.create_my_shared_housing_payment(current_setting('test.long_shared_group')::uuid)$$),'constructor also rejects an ineligible participant');
reset role;
rollback to savepoint restricted_payer;
release savepoint restricted_payer;
update public.user_sessions set is_active=false where user_id='ll-a';
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000001","session_id":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect(pg_temp.rejects($$select public.create_my_shared_housing_payment(current_setting('test.long_shared_group')::uuid)$$),'a revoked device cannot create or reuse a payment reference');
reset role;
select 'long_let_split_roommate_or_friend_contract_ok' as result;
rollback;
