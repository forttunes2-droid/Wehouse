\set ON_ERROR_STOP on
begin;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete) values
('76666666-0000-4000-8000-000000000001','pro-owner@example.invalid','pro-owner','property_partner',true),
('76666666-0000-4000-8000-000000000002','pro-other@example.invalid','pro-other','property_partner',true);
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
end $$;
reset role;
select set_config('request.jwt.claim.sub','76666666-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$
declare v jsonb;
begin
  v:=public.get_my_partner_pro_overview();
  if jsonb_array_length(v->'stays')<>0 or jsonb_array_length(v->'tasks')<>0 then raise exception 'Cross-owner data leaked'; end if;
end $$;
rollback;
