\set ON_ERROR_STOP on
begin;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,assigned_state,assigned_lga) values
('88888888-1111-4111-8111-000000000001','journey-creator@example.invalid','journey-creator','creator',true,null,null),
('88888888-1111-4111-8111-000000000002','journey-admin@example.invalid','journey-admin','admin',true,'Nasarawa','Lafia'),
('88888888-1111-4111-8111-000000000003','journey-user@example.invalid','journey-user','user',true,null,null);
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,scope_state,scope_lga,status) values
('journey-creator','creator','global',null,null,'active'),
('journey-admin','admin','branch','Nasarawa','Lafia','active');
insert into public.inspection_requests(id,request_code,owner_id,owner_email,property_address,property_city,property_state,status) values
('88888888-2222-4222-8222-000000000001','JOURNEY-ONE','journey-user','journey-user@example.invalid','Contract property one','Lafia','Nasarawa','pending'),
('88888888-2222-4222-8222-000000000002','JOURNEY-TWO','journey-user','journey-user@example.invalid','Contract property two','Keffi','Nasarawa','pending');
insert into public.hotels(hotel_id,name,state,city,address,owner_id) values(-8888,'Contract Hotel','Nasarawa','Lafia','Contract address','journey-creator');
insert into public.hotel_rooms(room_id,hotel_id,room_type,price_per_night,total_rooms) values(-8888,-8888,'Deluxe',30000,1);
insert into public.hotel_bookings(booking_id,hotel_id,room_id,user_id,check_in,check_out,total_nights,total_price,status,guest_name,rate_plan_name) values(-8888,-8888,-8888,'journey-user','2026-09-24','2026-09-30',6,180000,'confirmed','Contract Guest','Room only');
insert into public.booking_payments(payment_reference,paystack_reference,user_id,payer_user_id,purpose,status,amount,amount_total,currency,verified_amount,verified_at,paid_at,paystack_transaction_id,hotel_booking_id) values
('JOURNEY-PAID','JOURNEY-PAID','journey-user','journey-user','hotel_booking','paid',180000,180000,'NGN',180000,now(),now(),'123456',-8888),
('JOURNEY-PENDING','JOURNEY-PENDING','journey-user','journey-user','hotel_booking','pending',180000,180000,'NGN',null,null,null,null,-8888);
set local session_replication_role=origin;
set local role service_role;
select public.record_verified_payment_mode('JOURNEY-PAID','123456','test');
reset role;
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
do $$
declare rows jsonb; receipt jsonb;
begin
  if has_function_privilege('authenticated','public.record_verified_payment_mode(text,text,text)','execute') then raise exception 'Customer can modify provider receipt mode'; end if;
  perform set_config('request.jwt.claim.sub','88888888-1111-4111-8111-000000000001',true);
  rows:=public.get_my_property_pipeline_v2('all');
  if not rows @> '[{"id":"88888888-2222-4222-8222-000000000001"},{"id":"88888888-2222-4222-8222-000000000002"}]'::jsonb then raise exception 'Creator property pipeline lost records'; end if;
  if rows->0 ? 'gps_latitude' then raise exception 'Pipeline exposed private coordinates'; end if;
  if public.get_my_payment_receipts('JOURNEY-PAID')<>'[]'::jsonb then raise exception 'Creator read another payer receipt'; end if;
  perform set_config('request.jwt.claim.sub','88888888-1111-4111-8111-000000000002',true);
  rows:=public.get_my_property_pipeline_v2('all');
  if not rows @> '[{"id":"88888888-2222-4222-8222-000000000001"}]'::jsonb or rows @> '[{"id":"88888888-2222-4222-8222-000000000002"}]'::jsonb then raise exception 'Branch pipeline scope is incorrect'; end if;
  perform set_config('request.jwt.claim.sub','88888888-1111-4111-8111-000000000003',true);
  receipt:=public.get_my_payment_receipts(null,'hotel','-8888');
  if jsonb_array_length(receipt)<>1 or receipt->0->>'merchant_name'<>'Contract Hotel' or (receipt->0->>'amount')::numeric<>180000 or receipt->0->>'booking_id'<>'-8888' or receipt->0->>'package_name'<>'Room only' or receipt->0->>'environment'<>'test' then raise exception 'Receipt has incorrect owner, merchant, amount or booking'; end if;
  if public.get_my_payment_receipts('JOURNEY-PENDING')<>'[]'::jsonb then raise exception 'Pending payment received a receipt'; end if;
  begin
    perform public.get_my_property_pipeline_v2('all');
    raise exception 'Ordinary user reached operations pipeline';
  exception when raise_exception then
    if sqlerrm<>'WeHouse operations access required' then raise; end if;
  end;
end;
$$;
reset role;
update public.workspace_role_assignments set status='revoked' where user_id='journey-creator';
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub','88888888-1111-4111-8111-000000000001',true);
  begin
    perform public.get_my_property_pipeline_v2('all');
    raise exception 'Revoked Creator retained pipeline access';
  exception when raise_exception then
    if sqlerrm<>'WeHouse operations access required' then raise; end if;
  end;
end; $$;
reset role;
rollback;
