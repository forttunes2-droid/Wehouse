\set ON_ERROR_STOP on
begin;
create function pg_temp.expect(value boolean, description text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAIL: %',description; end if;end$$;
grant execute on function pg_temp.expect(boolean,text) to authenticated,anon,service_role;
create function pg_temp.rejects(statement text) returns boolean language plpgsql as $$
begin execute statement; return false; exception when others then return true; end $$;
grant execute on function pg_temp.rejects(text) to authenticated,anon,service_role;

set local session_replication_role=replica;
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
insert into public.companions(user_low,user_high,requested_by,status) values
('ll-a','ll-c','ll-a','accepted'),('ll-a','ll-d','ll-a','accepted');
set local session_replication_role=origin;

select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;

select pg_temp.expect(pg_temp.rejects($$select public.create_my_shared_long_let('97000000-0000-4000-8000-000000000020'::uuid,'{}'::uuid[],'{}'::text[])$$),'must choose someone');
select pg_temp.expect(pg_temp.rejects($$select public.create_my_shared_long_let('97000000-0000-4000-8000-000000000020'::uuid,'{}'::uuid[],array['ll-b'])$$),'a Roommate who is not a Companion cannot be passed as a Companion');
select pg_temp.expect(pg_temp.rejects($$select public.create_my_shared_long_let('97000000-0000-4000-8000-000000000020'::uuid,'{}'::uuid[],array['ll-c','ll-c'])$$),'same person twice rejected');
select pg_temp.expect(pg_temp.rejects($$select public.create_my_shared_long_let('97000000-0000-4000-8000-000000000021'::uuid,'{}'::uuid[],array['ll-c','ll-d'])$$),'payers cannot exceed property occupancy');

-- Roommate + Companion together: 3 payers on a 3-person property.
select pg_temp.expect(
  (public.create_my_shared_long_let('97000000-0000-4000-8000-000000000020'::uuid,array['97000000-0000-4000-8000-000000000031'::uuid],array['ll-c'])) is not null,
  'one Roommate and one Companion can split a Long Let');
reset role;
select pg_temp.expect((select count(*) from public.shared_payment_members m join public.shared_payment_groups g using(shared_payment_group_id) where g.listing_id='97000000-0000-4000-8000-000000000020')=3,'three payers recorded');
select pg_temp.expect((select sum(share_amount) from public.shared_payment_members m join public.shared_payment_groups g using(shared_payment_group_id) where g.listing_id='97000000-0000-4000-8000-000000000020')=(select total_amount from public.shared_payment_groups where listing_id='97000000-0000-4000-8000-000000000020'),'shares add up to the total');

-- Four payers are never allowed, even on a bigger property.
update public.listings set max_occupants=6 where id='97000000-0000-4000-8000-000000000021';
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect(pg_temp.rejects($$select public.create_my_shared_long_let('97000000-0000-4000-8000-000000000021'::uuid,array['97000000-0000-4000-8000-000000000031'::uuid],array['ll-c','ll-d'])$$),'no more than 3 payers');
reset role;

select 'long_let_split_roommate_or_companion_contract_ok' as result;
rollback;
