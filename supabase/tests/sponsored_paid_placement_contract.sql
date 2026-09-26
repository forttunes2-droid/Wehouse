-- Run against an isolated test database after the Sponsored migrations.
-- All fixtures and verified-looking receipts roll back; no Paystack charge is made.
begin;
do $test$
declare
  v_owner text:='sponsored-test-owner';
  v_inspection uuid:=gen_random_uuid();
  v_rule uuid:=gen_random_uuid();
  v_first uuid:=gen_random_uuid();
  v_second uuid:=gen_random_uuid();
  v_reference_one text:='WHS-'||gen_random_uuid()::text;
  v_reference_two text:='WHS-'||gen_random_uuid()::text;
  v_result jsonb;
begin
  if has_function_privilege('authenticated',
    'public.confirm_sponsored_paystack_charge(text,text,bigint,text,text)','EXECUTE') then
    raise exception 'Browser role can activate a campaign'; end if;
  insert into public.profiles(auth_id,email,user_id,role,account_kind)
  values(gen_random_uuid()::text,'sponsored-test@example.invalid',v_owner,'property_partner','property_partner');
  insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status)
  values(v_owner,'property_partner','global','active');
  insert into public.inspection_requests(
    id,request_code,owner_id,owner_email,property_address,property_city,property_state,status
  ) values(v_inspection,'SPONSORED-ROLLBACK',v_owner,'sponsored-test@example.invalid',
    'Test address','Ikeja','Lagos','completed');
  insert into public.hotels(
    hotel_id,name,state,city,owner_id,status,inspection_request_id,approved_by,approved_at,published_at
  ) values(987654321,'Sponsored Test Hotel','Lagos','Ikeja',v_owner,'active',
    v_inspection,v_owner,now(),now());
  insert into public.sponsored_market_rules(
    rule_id,resource_type,scope_type,scope_key,enabled,slot_count,daily_price_ngn,
    allowed_durations,updated_by
  ) values(v_rule,'hotel','global','global',true,1,100,array[10],v_owner);
  insert into public.sponsored_campaigns(
    campaign_id,resource_type,resource_id,owner_user_id,state_name,state_key,
    lga_name,lga_key,duration_days,amount_ngn,status,payment_reference,rule_id,updated_at
  ) values
    (v_first,'hotel','987654321',v_owner,'Lagos',public.wehouse_state_key('Lagos'),
      'Ikeja',public.worker_market_text_key('Ikeja'),10,1000,'pending_payment',v_reference_one,v_rule,now()),
    (v_second,'hotel','987654321',v_owner,'Lagos',public.wehouse_state_key('Lagos'),
      'Ikeja',public.worker_market_text_key('Ikeja'),10,1000,'pending_payment',v_reference_two,v_rule,now());
  insert into public.booking_payments(
    payment_reference,paystack_reference,user_id,payer_user_id,amount,amount_total,
    currency,status,purpose,metadata
  ) values
    (v_reference_one,v_reference_one,v_owner,v_owner,1000,1000,'NGN','pending',
      'sponsored_campaign',jsonb_build_object('campaign_id',v_first,'paystack_environment','test')),
    (v_reference_two,v_reference_two,v_owner,v_owner,1000,1000,'NGN','pending',
      'sponsored_campaign',jsonb_build_object('campaign_id',v_second,'paystack_environment','test'));

  begin
    perform public.confirm_sponsored_paystack_charge(v_reference_one,'wrong-amount',99999,'test','webhook');
    raise exception 'Amount mismatch was accepted';
  exception when others then
    if sqlerrm not like '%amount or currency mismatch%' then raise; end if;
  end;
  begin
    perform public.confirm_sponsored_paystack_charge(v_reference_one,'wrong-mode',100000,'live','webhook');
    raise exception 'Environment mismatch was accepted';
  exception when others then
    if sqlerrm not like '%environment mismatch%' then raise; end if;
  end;

  v_result:=public.confirm_sponsored_paystack_charge(v_reference_one,'sponsored-test-transaction-1',100000,'test','webhook');
  if v_result->>'status'<>'active' then raise exception 'Activation failed: %',v_result; end if;
  if (select count(*) from public.get_sponsored_discovery('hotel','Lagos','Ikeja',null,6))<>1 then
    raise exception 'Paid placement missing'; end if;
  if exists(select 1 from public.get_sponsored_discovery('hotel','Oyo','Ibadan',null,6)) then
    raise exception 'Wrong market received placement'; end if;
  v_result:=public.confirm_sponsored_paystack_charge(v_reference_one,'sponsored-test-transaction-1',100000,'test','webhook');
  if v_result->>'already_processed'<>'true' then raise exception 'Idempotency failed'; end if;
  v_result:=public.confirm_sponsored_paystack_charge(v_reference_two,'sponsored-test-transaction-2',100000,'test','webhook');
  if v_result->>'requires_review'<>'true' then raise exception 'Capacity failure did not enter review'; end if;
  if (select count(*) from public.get_sponsored_discovery('hotel','Lagos','Ikeja',null,6))<>1 then
    raise exception 'Capacity oversold'; end if;
  perform public.pause_sponsored_on_provider_event(v_reference_one,'refund.pending','test',100000);
  if exists(select 1 from public.get_sponsored_discovery('hotel','Lagos','Ikeja',null,6)) then
    raise exception 'Pending refund still delivered placement'; end if;
  perform public.pause_sponsored_on_provider_event(v_reference_one,'refund.processed','test',100000);
  if (select status from public.booking_payments where paystack_reference=v_reference_one)<>'refunded' then
    raise exception 'Refund was not recorded'; end if;
  v_result:=public.confirm_sponsored_paystack_charge(v_reference_one,'sponsored-test-transaction-1',100000,'test','webhook');
  if v_result->>'requires_review'<>'true' then raise exception 'Replayed charge undid refund'; end if;
  update public.sponsored_market_rules set enabled=false where rule_id=v_rule;
  if exists(select 1 from public.get_sponsored_discovery('hotel','Lagos','Ikeja',null,6)) then
    raise exception 'Disabled market still served'; end if;
end $test$;
rollback;
