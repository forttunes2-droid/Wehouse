\set ON_ERROR_STOP on
begin;
create function pg_temp.expect(value boolean, description text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAIL: %',description; end if;end$$;
grant execute on function pg_temp.expect(boolean,text) to authenticated,anon,service_role;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,account_kind,full_name,state,city,local_government) values
('94000000-0000-4000-8000-000000000001','short-split-a@example.invalid','short-split-a','user',true,'consumer','Ada','Nasarawa','Lafia','Lafia'),
('94000000-0000-4000-8000-000000000002','short-split-b@example.invalid','short-split-b','creator',true,'consumer','Bola','Nasarawa','Lafia','Lafia'),
('94000000-0000-4000-8000-000000000003','short-split-c@example.invalid','short-split-c','user',true,'consumer','Chika','Nasarawa','Lafia','Lafia'),
('94000000-0000-4000-8000-000000000004','short-split-d@example.invalid','short-split-d','user',true,'consumer','Different guest','Nasarawa','Lafia','Lafia');
insert into public.conversations(id,participant_a,participant_b,conversation_type,status) values
('94000000-0000-4000-8000-000000000012','short-split-a','short-split-b','roommate','active'),
('94000000-0000-4000-8000-000000000013','short-split-a','short-split-c','roommate','active');
insert into public.listings(id,listing_id,title,price,property_type,sub_type,status,availability_status,max_guests,max_occupants,security_deposit_amount,state,city,address)
values('94000000-0000-4000-8000-000000000020','short-split-listing','Short Let contract',1000,'apartment','short_let','available','available',3,3,500,'Nasarawa','Lafia','Published test address');
-- A real reservation requires an active policy snapshot, including in an empty test database.
insert into public.creator_policy_versions(policy_key,version,value,status,effective_from,legal_review_state,reason,checksum)
values('accommodation_arrival_issue_window',99001,'{"default_hours":2,"minimum_hours":1,"maximum_hours":6}',
'active',now()-interval '1 minute','reviewed','Rollback-only booking fixture','short-split-contract');
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"sub":"94000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select id as reservation from public.create_short_stay_reservation('94000000-0000-4000-8000-000000000020',current_date+10,current_date+11,3) \gset
reset role;
select payment_expires_at as original_deadline from public.reservations where id=:'reservation' \gset
select pg_temp.expect((select payment_reference is null and shared_payment_group_id is null and stay_rent_total=1000 and security_deposit_snapshot=500 from public.reservations where id=:'reservation'),'Date-first reservation does not initialize payment');
select set_config('test.shared_reservation',:'reservation',true);
set local role authenticated;
select (public.create_my_shared_short_let(:'reservation',array['94000000-0000-4000-8000-000000000012','94000000-0000-4000-8000-000000000013']::uuid[])->>'id') as shared_group \gset
select pg_temp.expect((public.create_my_shared_short_let(:'reservation',array['94000000-0000-4000-8000-000000000012','94000000-0000-4000-8000-000000000013']::uuid[])->>'id')=:'shared_group','Retry reuses the same group and reservation');
select set_config('test.shared_group',:'shared_group',true);
do $$begin
 begin perform public.create_short_stay_payment(current_setting('test.shared_reservation'));raise exception 'FAIL: Shared owner could pay full bill';exception when others then if sqlerrm like 'FAIL:%' then raise;end if;end;
 begin perform public.create_my_shared_housing_payment(current_setting('test.shared_group')::uuid);raise exception 'FAIL: Payment before all accept';exception when others then if sqlerrm like 'FAIL:%' then raise;end if;end;
end$$;
reset role;
select pg_temp.expect((select reservation_id=:'reservation' and expires_at<=:'original_deadline'::timestamptz and total_amount=1500 from public.shared_housing_groups where id=:'shared_group'),'Same snapshot and no extended hold');
select pg_temp.expect((select count(*)=3 and sum(share_amount)=1500 and sum(eligible_partner_share)=1000 and sum(refundable_share)=500 and bool_and(share_amount=eligible_partner_share+refundable_share) from public.shared_housing_members where group_id=:'shared_group'),'All three exact shares reconcile');
select set_config('request.jwt.claims','{"sub":"94000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select public.respond_to_shared_housing_invite(:'shared_group',true);
select set_config('request.jwt.claims','{"sub":"94000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select public.respond_to_shared_housing_invite(:'shared_group',true);
select (public.create_my_shared_housing_payment(:'shared_group')->>'reference') as chika_payment \gset
select pg_temp.expect(public.create_my_shared_housing_payment(:'shared_group')->>'reference'=:'chika_payment','Same participant checkout is idempotent');
reset role;
select pg_temp.expect((select count(*)=2 from public.notifications where recipient_id='short-split-a' and related_id=:'shared_group' and type='shared_home_response'),'Each accepted member produces a distinct response');
select pg_temp.expect((select expires_at<=:'original_deadline'::timestamptz from public.shared_housing_groups where id=:'shared_group'),'Last acceptance does not renew Short Let date hold');
select pg_temp.expect((select payer_user_id='short-split-c' and amount_total=500 from public.booking_payments where paystack_reference=:'chika_payment'),'Only own share can be initialized');
select set_config('request.jwt.claims','{"sub":"94000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
do $$begin
 begin perform public.get_my_shared_housing_group(current_setting('test.shared_group')::uuid);raise exception 'FAIL: Stranger can read group';exception when others then if sqlerrm like 'FAIL:%' then raise;end if;end;
 begin perform public.create_my_shared_housing_payment(current_setting('test.shared_group')::uuid);raise exception 'FAIL: Stranger can initialize share';exception when others then if sqlerrm like 'FAIL:%' then raise;end if;end;
end$$;
reset role;
-- These are server-confirmation fixtures, not real Paystack transactions.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.confirm_shared_housing_payment(:'chika_payment','synthetic-chika',500);
reset role;
select pg_temp.expect((select status='payment_pending' from public.reservations where id=:'reservation'),'One paid share never confirms the whole stay');
select set_config('request.jwt.claims','{"sub":"94000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select (public.create_my_shared_housing_payment(:'shared_group')->>'reference') as ada_payment \gset
select set_config('request.jwt.claims','{"sub":"94000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select (public.create_my_shared_housing_payment(:'shared_group')->>'reference') as bola_payment \gset
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.confirm_shared_housing_payment(:'ada_payment','synthetic-ada',500);
select public.confirm_shared_housing_payment(:'bola_payment','synthetic-bola',500);
reset role;
select pg_temp.expect((select status='reserved' and rent_payment_status='paid' and guest_count=3 and stay_rent_total=1000 and security_deposit_snapshot=500 from public.reservations where id=:'reservation'),'Only all accepted and verified shares confirm the stored stay');
select pg_temp.expect((select count(*)=1 from public.reservations where listing_id='94000000-0000-4000-8000-000000000020'),'No duplicate reservation after group payment');
rollback;
