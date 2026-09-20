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

-- The recording failures: room permissions, unreadable support, repeated device notices.
begin;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete) values
('99999999-1111-4111-8111-000000000001','repair-owner@example.invalid','repair-owner','property_partner',true),
('99999999-1111-4111-8111-000000000002','repair-staff@example.invalid','repair-staff','user',true),
('99999999-1111-4111-8111-000000000003','repair-guest@example.invalid','repair-guest','user',true);
insert into public.hotels(hotel_id,name,state,city,address,owner_id,status) values(-9991,'Repair Hotel','Nasarawa','Lafia','Test address','repair-owner','active');
insert into public.hotel_rooms(room_id,hotel_id,room_type,price_per_night,total_rooms) values(-9991,-9991,'Deluxe',1000,2);
insert into public.hotel_rate_plans(rate_plan_id,hotel_id,room_id,name,meal_plan,payment_timing,refundable,price_per_night) values(-9991,-9991,-9991,'Room only','room_only','pay_now',false,1000);
insert into public.hotel_bookings(booking_id,hotel_id,room_id,user_id,check_in,check_out,total_nights,total_price,status,payment_status) values(-9991,-9991,-9991,'repair-guest','2026-09-24','2026-09-25',1,1000,'checked_out','paid');
insert into public.hotel_team_members(hotel_id,member_user_id,hotel_role,capabilities,invited_by) values(-9991,'repair-staff','front_desk',array['room.mark_ready'],'repair-owner');
insert into public.partner_support_conversations(id,partner_id,subject,context_type,context_id,channel_kind) values('99999999-2222-4222-8222-000000000001','repair-owner','Property inspection','property_inspection','repair-inspection','field_operations');
insert into public.partner_support_messages(conversation_id,sender_id,content,visibility) values
('99999999-2222-4222-8222-000000000001','repair-owner','Customer-visible message','customer'),
('99999999-2222-4222-8222-000000000001','repair-staff','Private staff note','internal');
insert into public.user_sessions(id,user_id,auth_id,device_id,auth_session_id,device,trust_status,is_active) values
('99999999-3333-4333-8333-000000000001','repair-owner','99999999-1111-4111-8111-000000000001','same-browser-device','current-auth-session','Android Device','trusted',true),
('99999999-3333-4333-8333-000000000002','repair-owner','99999999-1111-4111-8111-000000000001','same-browser-device','earlier-auth-session','Android Device','trusted',false),
('99999999-3333-4333-8333-000000000003','repair-owner','99999999-1111-4111-8111-000000000001','different-device','other-auth-session','Desktop','trusted',true);
insert into public.notifications(recipient_id,type,title,source_id,destination_params,read,workspace_scope) values
('repair-owner','new_device_login','Test same device','99999999-3333-4333-8333-000000000002','{"decision":"unreviewed"}',false,'account'),
('repair-owner','new_device_login','Test new device','99999999-3333-4333-8333-000000000003','{"decision":"unreviewed"}',false,'account');
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"sub":"99999999-1111-4111-8111-000000000001","role":"authenticated","session_id":"current-auth-session"}',true);
select set_config('request.jwt.claim.sub','99999999-1111-4111-8111-000000000001',true);
set local role authenticated;
do $$ declare snapshot jsonb; messages integer; notice jsonb; begin
  snapshot:=public.get_my_hotel_operation_snapshot(-9991);
  if jsonb_array_length(snapshot->'rooms')<>1 or jsonb_array_length(snapshot->'bookings')<>1
    or jsonb_array_length(snapshot->'rooms'->0->'rate_plans')<>1 then raise exception 'Owner hotel operation is disconnected'; end if;
  select count(*) into messages from public.get_support_messages('99999999-2222-4222-8222-000000000001');
  if messages<>1 then raise exception 'Customer chat failed or internal notes leaked'; end if;
  notice:=public.get_my_pending_device_login_alert();
  if notice->>'sessionId'<>'99999999-3333-4333-8333-000000000003' then raise exception 'Same-device notice shown or new-device notice lost'; end if;
end $$;
reset role;
update public.notifications set read=true where source_id='99999999-3333-4333-8333-000000000003';
set local role authenticated;
do $$ begin
  if public.get_my_pending_device_login_alert() is not null then raise exception 'Reviewed or same-device alert repeated'; end if;
  perform set_config('request.jwt.claim.sub','99999999-1111-4111-8111-000000000002',true);
  if jsonb_array_length(public.get_my_hotel_operation_snapshot(-9991)->'bookings')<>0 then raise exception 'Room-only staff received guest bookings'; end if;
  perform set_config('request.jwt.claim.sub','99999999-1111-4111-8111-000000000003',true);
  if public.get_hotel_review_summary(-9991)->>'eligible'<>'true' then raise exception 'Completed guest cannot review'; end if;
  begin
    perform public.get_my_hotel_operation_snapshot(-9991);
    raise exception 'Guest read hotel operations';
  exception when raise_exception then
    if sqlerrm<>'Active hotel ownership or team membership required' then raise; end if;
  end;
  begin
    perform public.get_support_messages('99999999-2222-4222-8222-000000000001');
    raise exception 'Guest read another account support';
  exception when raise_exception then if sqlerrm<>'Not authorised' then raise; end if; end;
end $$;
reset role;
update public.hotel_team_members set status='revoked' where member_user_id='repair-staff';
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub','99999999-1111-4111-8111-000000000002',true);
  begin perform public.get_my_hotel_operation_snapshot(-9991); raise exception 'Revoked staff retained operations';
  exception when raise_exception then if sqlerrm<>'Active hotel ownership or team membership required' then raise; end if; end;
end $$;
reset role;
rollback;
