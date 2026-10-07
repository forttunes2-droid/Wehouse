\set ON_ERROR_STOP on
begin;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete) values
('79666666-0000-4000-8000-000000000001','refund-owner@example.invalid','refund-owner','property_partner',true),
('79666666-0000-4000-8000-000000000002','refund-guest@example.invalid','refund-guest','user',true),
('79666666-0000-4000-8000-000000000003','refund-other@example.invalid','refund-other','user',true);
insert into public.hotels(hotel_id,name,state,city,owner_id,status) values(-7966,'Refund Hotel','Nasarawa','Lafia','refund-owner','active');
insert into public.hotel_rooms(room_id,hotel_id,room_type,price_per_night,total_rooms) values(-7966,-7966,'Standard',20000,1);
insert into public.payment_protection_transactions(id,booking_type,payer_user_id,payee_user_id,amount_total,amount_commission,amount_payee,commission_rate,status,protection_state,subject_type,subject_id,paystack_reference)
values('79666666-1000-4000-8000-000000000001','hotel_stay','refund-guest','refund-owner',40000,4800,35200,12,'protected','protected','hotel_stay','-7966','TEST-HOTEL-REFUND');
insert into public.hotel_bookings(booking_id,hotel_id,room_id,user_id,check_in,check_out,total_nights,total_price,status,canonical_state,payment_status,payment_reference,payment_protection_id,cancellation_snapshot)
values(-7966,-7966,-7966,'refund-guest',current_date+3,current_date+5,2,40000,'confirmed','confirmed','paid','TEST-HOTEL-REFUND','79666666-1000-4000-8000-000000000001',
 jsonb_build_object('version',1,'refundable',true,'deadline',now()+interval '1 day','timezone','Africa/Lagos','refund_amount_ngn',40000,'fee_ngn',0));
insert into public.hotel_room_units(unit_id,hotel_id,room_id,unit_label,status)
overriding system value values(-7966,-7966,-7966,'101','ready');
insert into public.hotel_rate_plans(rate_plan_id,hotel_id,room_id,name,price_per_night,refundable,cancellation_template,cancellation_hours)
overriding system value values(-7966,-7966,-7966,'Refund contract rate',20000,true,'standard',24);
insert into public.hotel_bookings(booking_id,hotel_id,room_id,user_id,check_in,check_out,total_nights,total_price,status,payment_status,cancellation_snapshot)
values(-7967,-7966,-7966,'refund-guest',current_date+6,current_date+7,1,20000,'confirmed','paid',jsonb_build_object('refundable',false)),
(-7968,-7966,-7966,'refund-guest',current_date+8,current_date+9,1,20000,'confirmed','paid',jsonb_build_object('refundable',true,'deadline',now()-interval '1 second')),
(-7969,-7966,-7966,'refund-guest',current_date+10,current_date+11,1,20000,'confirmed','paid',null),
(-7970,-7966,-7966,'refund-guest',current_date+10,current_date+11,1,20000,'confirmed','paid',jsonb_build_object('refundable',true));
insert into public.booking_payments(payment_reference,paystack_reference,user_id,payer_user_id,hotel_booking_id,amount,amount_total,verified_amount,currency,status,purpose,verified_at,paid_at,paystack_transaction_id)
values('TEST-HOTEL-REFUND','TEST-HOTEL-REFUND','refund-guest','refund-guest',-7966,40000,40000,40000,'NGN','paid','hotel_booking',now(),now(),'TEST-TRANSACTION');
insert into public.creator_policy_versions(policy_key,version,value,status,effective_from,legal_review_state,reason,checksum)
values('accommodation_arrival_issue_window',99003,'{"default_hours":2,"minimum_hours":1,"maximum_hours":6}',
 'active',now()-interval '1 minute','reviewed','Rollback-only cancellation fixture','hotel-refund-contract');
update public.hotels set approved_at=now(),published_at=now(),timezone='Africa/Lagos',check_in_time='14:00' where hotel_id=-7966;
set local session_replication_role=origin;
-- This fixture constructs the paid Payment Protection row directly rather than through the charge gateway.
-- Start with no unrelated finance command attached to it; cancellation must create the sole refund obligation.
delete from public.financial_action_outbox where payment_protection_id='79666666-1000-4000-8000-000000000001';
if (select count(*) from public.financial_action_outbox where payment_protection_id='79666666-1000-4000-8000-000000000001')<>0 then
  raise exception 'Hotel cancellation fixture contains a pre-existing finance action';
end if;
select set_config('request.jwt.claim.sub','79666666-0000-4000-8000-000000000003',true);
set local role authenticated;
do $$ begin
 begin perform public.cancel_my_hotel_booking(-7966);raise exception 'Other guest cancelled booking';
 exception when others then if sqlerrm='Other guest cancelled booking' then raise; end if; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','79666666-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$ declare id integer; begin
 foreach id in array array[-7967,-7968,-7969,-7970] loop
  begin perform public.cancel_my_hotel_booking(id); raise exception 'Ineligible refund accepted';
  exception when others then if sqlerrm<>'This booking requires WeHouse cancellation review' then raise; end if; end;
 end loop;
end $$;
do $$ declare q jsonb; booked jsonb; expected timestamptz; begin
 q:=public.quote_hotel_room_rate(-7966,-7966,-7966,current_date+12,current_date+14);
 expected:=((current_date+11+time '14:00') at time zone 'Africa/Lagos');
 if (q->>'cancellation_deadline')::timestamptz is distinct from expected then raise exception 'Hotel-local quote deadline wrong'; end if;
 select to_jsonb(x) into booked from public.create_my_hotel_booking_with_rate(-7966,-7966,-7966,current_date+12,current_date+14,1,'Refund Guest','08000000000',null) x;
 if (booked->'cancellation_snapshot'->>'deadline')::timestamptz is distinct from expected then raise exception 'Booking did not snapshot local deadline'; end if;
 perform public.cancel_my_hotel_booking((booked->>'booking_id')::integer);
end $$;
select public.cancel_my_hotel_booking(-7966);
select public.cancel_my_hotel_booking(-7966);
do $$ declare v jsonb; begin
 select x into v from jsonb_array_elements(public.get_my_hotel_bookings()) x where (x->>'booking_id')::integer=-7966;
 if v is null or v->>'status'<>'cancelled' or v->>'payment_status'<>'paid' or v->>'refund_status'<>'pending' then raise exception 'Cancellation falsely claimed a refund: %',v; end if;
end $$;
reset role;
do $$ begin
 if not coalesce((private.hotel_booking_quote_v2(-7966,-7966,current_date+3,current_date+5,null,true)->>'available')::boolean,false) then raise exception 'Cancellation did not release inventory'; end if;
 if (select count(*) from public.financial_action_outbox where idempotency_key='hotel-cancellation:-7966')<>1 then raise exception 'Duplicate refund obligation'; end if;
 if (select protection_state from public.payment_protection_transactions where id='79666666-1000-4000-8000-000000000001')<>'risk_held' then raise exception 'Refund obligation did not hold money'; end if;
 begin update public.hotel_bookings set cancellation_snapshot='{}' where booking_id=-7966;
 raise exception 'Saved terms changed';
 exception when others then if sqlerrm='Saved terms changed' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
reset role;
update public.financial_action_outbox set status='processing' where idempotency_key='hotel-cancellation:-7966';
set local role service_role;
select public.process_verified_paystack_refund_event('test-hotel-failed','refund.failed','TEST-HOTEL-REFUND','refund-1','refund-1',repeat('f',64),now(),4000000,'NGN');
select public.process_verified_paystack_refund_event('test-hotel-processed','refund.processed','TEST-HOTEL-REFUND','refund-1','refund-1',repeat('a',64),now(),4000000,'NGN');
select public.process_verified_paystack_refund_event('test-hotel-processed','refund.processed','TEST-HOTEL-REFUND','refund-1','refund-1',repeat('a',64),now(),4000000,'NGN');
reset role;
do $$ begin
 if (select payment_status from public.hotel_bookings where booking_id=-7966)<>'refunded' then raise exception 'Processed refund not projected'; end if;
 if (select refunded_amount from public.payment_protection_transactions where id='79666666-1000-4000-8000-000000000001')<>40000 then raise exception 'Refund replay changed money'; end if;
 if (select status from public.financial_action_outbox where idempotency_key='hotel-cancellation:-7966')<>'completed' then raise exception 'Refund action not complete'; end if;
end $$;
select set_config('request.jwt.claim.sub','79666666-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
do $$ declare receipt jsonb; begin
 receipt:=public.get_my_payment_receipts('TEST-HOTEL-REFUND',null,null)->0;
 if receipt is null or receipt->>'status'<>'refunded' or receipt->>'refund_processed_at' is null
  or receipt->'cancellation_snapshot'->>'timezone' is distinct from 'Africa/Lagos' then raise exception 'Refund receipt missing booked terms or confirmation date'; end if;
end $$;
reset role;
rollback;
