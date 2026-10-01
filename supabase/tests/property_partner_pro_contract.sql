\set ON_ERROR_STOP on
begin;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete) values
('76666666-0000-4000-8000-000000000001','pro-owner@example.invalid','pro-owner','property_partner',true),
('76666666-0000-4000-8000-000000000002','pro-other@example.invalid','pro-other','property_partner',true);
insert into public.profiles(auth_id,email,user_id,role,profile_complete) values
('76666666-0000-4000-8000-000000000003','pro-guest@example.invalid','pro-guest','user',true);
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status) values
('pro-owner','property_partner','global','active'),('pro-other','property_partner','global','active');
insert into public.hotels(hotel_id,name,state,city,owner_id,status) values
(-76661,'Pilot Hotel','Nasarawa','Lafia','pro-owner','active'),
(-76662,'Other Hotel','Nasarawa','Keffi','pro-other','active');
insert into public.hotel_rooms(room_id,hotel_id,room_type,price_per_night,total_rooms) values
(-76661,-76661,'Standard',20000,2);
insert into public.hotel_bookings(booking_id,hotel_id,room_id,user_id,check_in,check_out,total_nights,total_price,status,payment_status) values
(-76661,-76661,-76661,'pro-guest',current_date+2,current_date+3,1,20000,'confirmed','paid');
select set_config('request.jwt.claim.sub','76666666-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$
begin
  if (public.get_my_partner_pro()->>'active')::boolean then raise exception 'Unpaid Partner marked active'; end if;
  begin
    perform public.get_my_partner_pro_overview();
    raise exception 'Unpaid Partner accessed portfolio';
  exception when others then
    if sqlerrm='Unpaid Partner accessed portfolio' then raise; end if;
  end;
  begin
    perform public.save_my_partner_pro_task('hotel','-76661','Unpaid task');
    raise exception 'Unpaid Partner created task';
  exception when others then
    if sqlerrm='Unpaid Partner created task' then raise; end if;
  end;
  begin
    perform public.get_my_partner_pro_arrival_setup();
    raise exception 'Unpaid Partner accessed occupancy';
  exception when others then
    if sqlerrm='Unpaid Partner accessed occupancy' then raise; end if;
  end;
end $$;
reset role;
with paid as (
  insert into public.booking_payments(payment_reference,paystack_reference,user_id,payer_user_id,
    amount,amount_total,currency,status,purpose)
  values ('test-partner-1','test-partner-1','pro-owner','pro-owner',100,100,'NGN','paid','partner_pro_access'),
    ('test-partner-2','test-partner-2','pro-other','pro-other',100,100,'NGN','paid','partner_pro_access')
  returning id,user_id
) insert into public.partner_pro_entitlements(partner_id,current_period_end,last_payment_id)
  select user_id,now()+interval '1 month',id from paid;
select set_config('request.jwt.claim.sub','76666666-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$
declare v jsonb; t uuid;
begin
  if not (public.get_my_partner_pro()->>'active')::boolean then raise exception 'Paid Partner missing access'; end if;
  v:=public.get_my_partner_pro_overview();
  if jsonb_array_length(v->'assets')<>1 or jsonb_array_length(v->'stays')<>1 then raise exception 'Owned portfolio missing or leaked: %',v; end if;
  begin
    perform public.save_my_partner_pro_task('hotel','-76662','Inspect other hotel');
    raise exception 'Cross-owner task accepted';
  exception when others then
    if sqlerrm='Cross-owner task accepted' then raise; end if;
  end;
  t:=public.save_my_partner_pro_task('hotel','-76661','Inspect room',current_date+1);
  if (public.get_my_partner_pro_overview()->'tasks'->0->>'title')<>'Inspect room' then raise exception 'Task missing'; end if;
  perform public.save_my_partner_pro_task('hotel','-76661',null,null,t,true);
  if (public.get_my_partner_pro_overview()->'tasks'->0->>'status')<>'done' then raise exception 'Task completion missing'; end if;
  v:=public.get_my_partner_pro_arrival_setup();
  if jsonb_array_length(v->'occupancy')<>1
    or (v->'occupancy'->0->>'available_unit_nights')::int<>60
    or (v->'occupancy'->0->>'booked_unit_nights')::int<>1 then
    raise exception 'Owned occupancy mismatch: %',v; end if;
  begin
    perform public.save_my_partner_pro_arrival_instructions('hotel','-76662','Wrong owner');
    raise exception 'Cross-owner instructions accepted';
  exception when others then
    if sqlerrm='Cross-owner instructions accepted' then raise; end if;
  end;
  perform public.save_my_partner_pro_arrival_instructions('hotel','-76661','Arrive at main reception.');
  if (public.get_my_partner_pro_arrival_setup()->'instructions'->0->>'instructions')<>'Arrive at main reception.' then
    raise exception 'Owner instructions not saved'; end if;
end $;
reset role;
set local session_replication_role=origin;
set local role authenticated;
do $ declare t uuid; v jsonb; begin
 t:=public.create_my_partner_pro_recurring_task('hotel','-76661','Check smoke alarms',current_date-1,30);
 perform public.save_my_partner_pro_task('hotel','-76661',null,null,t,true);
 perform public.save_my_partner_pro_task('hotel','-76661',null,null,t,true);
 v:=public.get_my_partner_pro_overview();
 if (select count(*) from jsonb_array_elements(v->'tasks') x where x->>'previous_task_id'=t::text)<>1 then raise exception 'Repeated completion duplicated next task'; end if;
 if not exists(select 1 from jsonb_array_elements(v->'tasks') x where x->>'previous_task_id'=t::text and (x->>'due_on')::date=current_date+30) then raise exception 'Next maintenance date wrong'; end if;
 begin
  perform public.save_my_partner_pro_task('hotel','-76661',null,null,t,false);
  raise exception 'Repeating predecessor reopened';
 exception when others then if sqlerrm='Repeating predecessor reopened' then raise; end if; end;
end $;
reset role;
set local session_replication_role=replica;
select set_config('request.jwt.claim.sub','76666666-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$
declare v jsonb;
begin
  v:=public.get_my_partner_pro_overview();
  if jsonb_array_length(v->'stays')<>0 or jsonb_array_length(v->'tasks')<>0 then raise exception 'Cross-owner data leaked'; end if;
  if public.get_my_stay_arrival_instructions('hotel','-76661') is not null then
    raise exception 'Other owner read guest instructions'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','76666666-0000-4000-8000-000000000003',true);
set local role authenticated;
do $$ begin
  if public.get_my_stay_arrival_instructions('hotel','-76661')<>'Arrive at main reception.' then
    raise exception 'Paid guest missing arrival instructions'; end if;
  if public.get_my_stay_arrival_instructions('hotel','-76662') is not null then
    raise exception 'Guest read unrelated booking'; end if;
end $$;
rollback;
