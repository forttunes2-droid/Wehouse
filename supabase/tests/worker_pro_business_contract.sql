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

reset role;
select set_config('request.jwt.claim.sub','78666666-0000-4000-8000-000000000003',true);
set local role authenticated;
select public.set_my_worker_customer_record_consent('business-one',false);
reset role;
select set_config('request.jwt.claim.sub','78666666-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$ begin
  if jsonb_array_length(public.get_my_worker_pro_business()->'customers')<>0 then
    raise exception 'Revoked customer record remains visible'; end if;
  begin
    perform public.save_my_worker_pro_customer_note('business-guest','Consent was revoked');
    raise exception 'Note saved after consent removal';
  exception when others then if sqlerrm='Note saved after consent removal' then raise; end if; end;
end $$;
reset role;
do $$ begin
  if exists(select 1 from public.worker_pro_customer_notes where worker_id='business-one') then
    raise exception 'Revocation retained a private note'; end if;
end $$;

-- Synthetic verified charge, no provider call or actual payment.
insert into public.booking_payments(id,payment_reference,paystack_reference,user_id,payer_user_id,
  type,booking_type,amount,amount_total,net_amount,amount_commission,currency,status,purpose,payment_method,metadata)
values('78666666-0000-4000-8000-000000000021','WHP-pro-review-contract','WHP-pro-review-contract',
  'business-one','business-one','worker_subscription','worker_subscription',5000,5000,5000,0,
  'NGN','paid','worker_pro_subscription','paystack','{"paystack_environment":"test"}');
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
do $$ begin
  perform public.pause_worker_pro_on_provider_event('WHP-pro-review-contract','refund.pending','test','worker-review-test-1');
  perform public.pause_worker_pro_on_provider_event('WHP-pro-review-contract','refund.pending','test','worker-review-test-1');
  if public.worker_pro_is_active('business-one') then raise exception 'Refund did not pause paid access'; end if;
  if (select count(*) from public.worker_pro_provider_review_events where event_key='worker-review-test-1')<>1 then
    raise exception 'Provider event replay duplicated'; end if;
  begin
    perform public.pause_worker_pro_on_provider_event('WHP-pro-review-contract','refund.pending','live','worker-review-test-2');
    raise exception 'Wrong environment accepted';
  exception when others then if sqlerrm='Wrong environment accepted' then raise; end if; end;
end $$;
reset role;
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
do $$ begin
  if not (public.get_my_worker_pro()->>'under_review')::boolean then raise exception 'Review missing from plan'; end if;
  begin
    perform public.get_my_worker_pro_business();
    raise exception 'Business access survived review';
  exception when others then if sqlerrm='Business access survived review' then raise; end if; end;
  begin
    perform public.resolve_worker_pro_provider_review('78666666-0000-4000-8000-000000000021',true,'Customer bypass attempt');
    raise exception 'Customer resolved Finance review';
  exception when others then if sqlerrm='Customer resolved Finance review' then raise; end if; end;
end $$;
reset role;
set local session_replication_role=origin;
-- Simulate a later lifecycle update: it must not clear the separate review.
update public.worker_pro_subscriptions set status='active',current_period_end=now()+interval '2 months'
  where worker_id='business-one';
do $$ begin
  if public.worker_pro_is_active('business-one') then raise exception 'Renewal bypassed review'; end if;
  begin
    insert into public.booking_payments(payment_reference,paystack_reference,user_id,payer_user_id,
      type,booking_type,amount,amount_total,net_amount,amount_commission,currency,status,purpose,payment_method)
    values('WHP-blocked-review','WHP-blocked-review','business-one','business-one',
      'worker_subscription','worker_subscription',5000,5000,5000,0,'NGN','pending','worker_pro_subscription','paystack');
    raise exception 'New checkout bypassed review';
  exception when others then if sqlerrm<>'Worker Pro payment is under Finance review' then raise; end if; end;
end $$;
set local session_replication_role=replica;
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select public.resolve_worker_pro_provider_review('78666666-0000-4000-8000-000000000021',true,
  'Sandbox dispute was reconciled and cleared');
do $$ begin
  if not public.worker_pro_is_active('business-one') then raise exception 'Cleared review did not restore unexpired access'; end if;
  perform public.pause_worker_pro_on_provider_event('WHP-pro-review-contract','refund.pending','test','worker-review-test-1');
  if not public.worker_pro_is_active('business-one') then raise exception 'Old event replay reopened resolved review'; end if;
end $$;
select public.pause_worker_pro_on_provider_event('WHP-pro-review-contract','refund.processed','test','worker-review-test-3');
select public.resolve_worker_pro_provider_review('78666666-0000-4000-8000-000000000021',false,
  'Provider refund completed; subscription reconciled');
do $$ begin
  if public.worker_pro_is_active('business-one') then raise exception 'Revoked access remains active'; end if;
end $$;

rollback;
