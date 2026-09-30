\set ON_ERROR_STOP on
begin;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,worker_status,worker_verified,full_name) values
('78666666-0000-4000-8000-000000000001','business-one@example.invalid','business-one','worker',true,'verified',true,'Worker One'),
('78666666-0000-4000-8000-000000000002','business-two@example.invalid','business-two','worker',true,'verified',true,'Worker Two'),
('78666666-0000-4000-8000-000000000003','business-guest@example.invalid','business-guest','user',true,null,false,'Customer');
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status) values
('business-one','worker','global','active'),('business-two','worker','global','active');
insert into public.worker_bookings(id,user_id,worker_id,booking_code,service_type,scheduled_date,status,agreed_amount,worker_receives) values
('78666666-0000-4000-8000-000000000011','business-guest','business-one','W-11','Cleaning',current_date+2,'confirmed',12000,11000),
('78666666-0000-4000-8000-000000000012','business-guest','business-one','W-12','Cleaning',current_date-2,'approved_released',12000,11000),
('78666666-0000-4000-8000-000000000013','business-guest','business-two','W-13','Repair',current_date+2,'confirmed',9000,8000);
select set_config('request.jwt.claim.sub','78666666-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$ begin
  begin
    perform public.get_my_worker_pro_business();
    raise exception 'Unpaid Worker accessed business tools';
  exception when others then if sqlerrm='Unpaid Worker accessed business tools' then raise; end if; end;
  begin
    perform public.save_my_worker_pro_package(null,'Cleaning','Room cleaning service',12000,true);
    raise exception 'Unpaid Worker saved package';
  exception when others then if sqlerrm='Unpaid Worker saved package' then raise; end if; end;
end $$;
reset role;
insert into public.worker_pro_subscriptions(worker_id,provider,product_id,status,current_period_start,
  current_period_end,price_amount,last_verified_at,last_provider_event_at) values
('business-one','paystack','test-business','active',now(),now()+interval '1 month',5000,now(),now());
select set_config('request.jwt.claim.sub','78666666-0000-4000-8000-000000000003',true);
set local role authenticated;
do $$ begin
  if public.get_my_worker_customer_record_consent('business-one') then raise exception 'Unexpected consent'; end if;
  perform public.set_my_worker_customer_record_consent('business-one',true);
  if not public.get_my_worker_customer_record_consent('business-one') then raise exception 'Consent missing'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','78666666-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$
declare pkg uuid; v jsonb;
begin
  v:=public.get_my_worker_pro_business();
  if jsonb_array_length(v->'schedule')<>1 or jsonb_array_length(v->'customers')<>1 then
    raise exception 'Business records wrong: %',v; end if;
  pkg:=public.save_my_worker_pro_package(null,'Cleaning','Room cleaning service',12000,true);
  if pkg is null then raise exception 'Package missing'; end if;
  if jsonb_array_length(public.get_worker_pro_service_packages('business-one'))<>1 then
    raise exception 'Active public package missing'; end if;
  if cardinality(public.get_worker_pro_featured_posts('business-one'))<>0 then
    raise exception 'Featured profile should start empty'; end if;
  perform public.save_my_worker_pro_reminder('78666666-0000-4000-8000-000000000011',now()+interval '1 day','Bring supplies');
  perform public.save_my_worker_pro_customer_note('business-guest','Prefers morning service');
  perform public.save_my_worker_pro_receipt_note('78666666-0000-4000-8000-000000000012','Deep clean completed');
  v:=public.get_my_worker_pro_business();
  if jsonb_array_length(v->'reminders')<>1 or (v->'receipts'->0->>'note')<>'Deep clean completed' then
    raise exception 'Saved Worker records missing: %',v; end if;
  begin
    perform public.save_my_worker_pro_reminder('78666666-0000-4000-8000-000000000013',now()+interval '1 day','Wrong job');
    raise exception 'Cross-Worker reminder accepted';
  exception when others then if sqlerrm='Cross-Worker reminder accepted' then raise; end if; end;
end $$;
rollback;
