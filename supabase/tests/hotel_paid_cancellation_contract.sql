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
set local session_replication_role=origin;
select set_config('request.jwt.claim.sub','79666666-0000-4000-8000-000000000003',true);
set local role authenticated;
do $$ begin
 begin perform public.cancel_my_hotel_booking(-7966);raise exception 'Other guest cancelled booking';
 exception when others then if sqlerrm='Other guest cancelled booking' then raise; end if; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','79666666-0000-4000-8000-000000000002',true);
set local role authenticated;
select public.cancel_my_hotel_booking(-7966);
select public.cancel_my_hotel_booking(-7966);
do $$ declare v jsonb; begin
 v:=public.get_my_hotel_bookings()->0;
 if v->>'status'<>'cancelled' or v->>'payment_status'<>'paid' or v->>'refund_status'<>'pending' then raise exception 'Cancellation falsely claimed a refund: %',v; end if;
end $$;
reset role;
do $$ begin
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
rollback;
