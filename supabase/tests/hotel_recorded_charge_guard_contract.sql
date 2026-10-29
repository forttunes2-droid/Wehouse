-- Recovery of an existing hold whose verified charge preceded fulfillment.
-- No new property publication or provider charge is performed. Trusted fixture
-- rows model the interrupted boundary; the commands run with guest sessions.
begin;
set local session_replication_role=replica;
insert into auth.users(id,aud,role,email,created_at,updated_at) values
 ('99500000-0000-4000-8000-000000000001','authenticated','authenticated','hold-recovery-guest@example.invalid',now(),now()),
 ('99500000-0000-4000-8000-000000000002','authenticated','authenticated','hold-recovery-other@example.invalid',now(),now());
insert into public.profiles(auth_id,email,user_id,role,profile_complete) values
 ('99500000-0000-4000-8000-000000000001','hold-recovery-guest@example.invalid','hold-recovery-guest','user',true),
 ('99500000-0000-4000-8000-000000000002','hold-recovery-other@example.invalid','hold-recovery-other','user',true),
 ('99500000-0000-4000-8000-000000000003','hold-recovery-owner@example.invalid','hold-recovery-owner','user',true);
insert into auth.sessions(id,user_id,created_at,updated_at)
 select auth_id::uuid,auth_id::uuid,now(),now() from public.profiles where user_id in('hold-recovery-guest','hold-recovery-other');
insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status)
 select user_id,auth_id,auth_id,'hold-recovery-'||user_id,'Synthetic browser',true,'trusted' from public.profiles where user_id in('hold-recovery-guest','hold-recovery-other');
insert into public.hotels(hotel_id,name,state,city,owner_id,status) values(-9950,'Existing recovery Hotel','Nasarawa','Lafia','hold-recovery-owner','inactive');
insert into public.hotel_rooms(room_id,hotel_id,room_type,price_per_night,total_rooms) values(-9950,-9950,'Recovery room',20000,1);
insert into public.hotel_rate_plans(rate_plan_id,hotel_id,room_id,name,price_per_night,refundable,cancellation_template,cancellation_hours)
 overriding system value values(-9950,-9950,-9950,'Accepted recovery rate',20000,true,'standard',24);
insert into public.hotel_bookings(booking_id,hotel_id,room_id,rate_plan_id,user_id,request_key,check_in,check_out,guest_count,total_nights,total_price,guest_name,guest_phone,status,payment_status,payment_expires_at,cancellation_snapshot)
 values(-9950,-9950,-9950,-9950,'hold-recovery-guest','99500000-5000-4000-8000-000000000001',current_date+3,current_date+5,1,2,40000,'Synthetic guest','08000000000','pending','unpaid',now()+interval '30 minutes',jsonb_build_object('refundable',true,'deadline',now()+interval '2 days','timezone','Africa/Lagos','refund_amount_ngn',40000));
insert into public.booking_payments(payment_reference,paystack_reference,user_id,payer_user_id,hotel_booking_id,amount,amount_total,verified_amount,currency,status,purpose,verified_at,paid_at,paystack_transaction_id)
 values('TEST-HOTEL-RECORDED-GUARD','TEST-HOTEL-RECORDED-GUARD','hold-recovery-guest','hold-recovery-guest',-9950,40000,40000,40000,'NGN','paid','hotel_booking',now(),now(),'TEST-HOTEL-RECORDED-GUARD');
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"sub":"99500000-0000-4000-8000-000000000001","session_id":"99500000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$declare receipt jsonb;begin
 receipt:=public.get_my_hotel_booking_hold('99500000-5000-4000-8000-000000000001');
 if receipt->>'user_id'<>'hold-recovery-guest' or (receipt->>'payment_recorded')::boolean is distinct from true then raise exception 'The owned checkout lost its recorded payment or private history';end if;
 begin perform public.create_hotel_booking_payment(-9950);raise exception 'FAIL: recorded charge initialized another payment';exception when others then if sqlerrm not like 'Payment is already recorded%' then raise;end if;end;
 begin perform public.release_my_hotel_booking_hold(-9950);raise exception 'FAIL: unpaid edit cancelled a recorded charge';exception when others then if sqlerrm not like 'Payment is already recorded%' then raise;end if;end;
 if has_function_privilege('authenticated','private.hotel_booking_has_recorded_payment(integer)','EXECUTE') then raise exception 'Private financial lookup exposed';end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"99500000-0000-4000-8000-000000000002","session_id":"99500000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $$begin
 if public.get_my_hotel_booking_hold('99500000-5000-4000-8000-000000000001') is not null then raise exception 'Another guest read a private hold';end if;
 begin perform public.release_my_hotel_booking_hold(-9950);raise exception 'FAIL: another guest released a hold';exception when insufficient_privilege then null;end;
end $$;
reset role;
update public.user_sessions set is_active=false where user_id='hold-recovery-guest';
select set_config('request.jwt.claims','{"sub":"99500000-0000-4000-8000-000000000001","session_id":"99500000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$begin begin perform public.get_my_hotel_booking_hold('99500000-5000-4000-8000-000000000001');raise exception 'FAIL: revoked device read hold';exception when insufficient_privilege then null;end;end $$;
reset role;
do $$begin
 begin update public.hotel_bookings set request_key=gen_random_uuid() where booking_id=-9950;raise exception 'FAIL: checkout request reference changed';exception when others then if sqlerrm<>'A checkout request reference cannot be changed' then raise;end if;end;
 if (select status<>'pending' or payment_status<>'unpaid' from public.hotel_bookings where booking_id=-9950) then raise exception 'Recovery guard rewrote fulfillment or financial status';end if;
 if (select count(*) from public.booking_payments where hotel_booking_id=-9950)<>1 then raise exception 'Recovery created another payment obligation';end if;
 if exists(select 1 from public.financial_action_outbox where subject_id='-9950' and subject_type='hotel') then raise exception 'Unpaid edit created a refund or release';end if;
end $$;
rollback;
select 'Recorded Hotel charge cannot reinitialize or use unpaid release; owner/device boundaries and existing history pass; fixtures rolled back' as result;
