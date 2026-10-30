begin;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete) values
 ('b7990000-0000-4000-8000-000000000001','rent-owner@example.invalid','rent-owner','user',true),
 ('b7990000-0000-4000-8000-000000000002','rent-operations@example.invalid','rent-operations','user',true),
 ('b7990000-0000-4000-8000-000000000003','rent-outsider@example.invalid','rent-outsider','user',true),
 ('b7990000-0000-4000-8000-000000000004','rent-customer@example.invalid','rent-customer','user',true);
insert into auth.sessions(id,user_id,created_at,updated_at)
 select auth_id::uuid,auth_id::uuid,now(),now() from public.profiles where user_id in('rent-owner','rent-operations','rent-outsider','rent-customer');
insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status)
 select user_id,auth_id,auth_id,'rent-offer-'||user_id,'Synthetic contract browser',true,'trusted'
 from public.profiles where user_id in('rent-owner','rent-operations','rent-outsider','rent-customer');
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status) values
 ('rent-owner','property_partner','global','active'),('rent-outsider','property_partner','global','active');
insert into public.listings(id,listing_id,title,sub_type,state,city,status,availability_status,owner_id,partner_id,approved_at,management_mode,management_updated_at,management_host_user_id,price,currency) values
 ('b7990000-2000-4000-8000-000000000001','rent-host-home','Host rent home','long_stay','Rent Contract Region','Rent Contract Town','available','available','rent-owner','rent-owner',now(),'host',now(),'rent-owner',1200000,'NGN'),
 ('b7990000-2000-4000-8000-000000000002','rent-managed-home','Managed rent home','long_stay','Rent Contract Region','Rent Contract Town','available','available','rent-owner','rent-owner',now(),'wehouse',now(),null,1200000,'NGN');
insert into public.property_host_assignments(listing_id,user_id,assignment_role,status,invited_by,accepted_at,access_level) values
 ('b7990000-2000-4000-8000-000000000001','rent-owner','owner','active','rent-owner',now(),'full_hosting'),
 ('b7990000-2000-4000-8000-000000000002','rent-owner','owner','active','rent-owner',now(),'full_hosting'),
 ('b7990000-2000-4000-8000-000000000001','rent-operations','manager','active','rent-owner',now(),'operations');

update public.creator_policy_versions set status='retired' where policy_key='commission_long_let' and status='active';
insert into public.creator_policy_versions(policy_version_id,policy_key,version,value,status,effective_from,reason,checksum)
 values('b7990000-4000-4000-8000-000000000001','commission_long_let',910011,'{"percent":10}','active',now()-interval '1 minute','Synthetic rent agreement','rent-contract-10');
insert into public.listings(id,listing_id,title,sub_type,state,city,status,availability_status,owner_id,partner_id,approved_at,management_mode,management_updated_at,management_host_user_id,price,currency,future_installments_allowed,accepted_lease_terms_months)
 values('b7990000-2000-4000-8000-000000000003','rent-monthly-home','Monthly rent home','long_stay','Rent Contract Region','Rent Contract Town','reserved','reserved','rent-owner','rent-owner',now(),'host',now(),'rent-owner',1200000,'NGN',true,array[12,24]);
insert into public.property_host_assignments(listing_id,user_id,assignment_role,status,invited_by,accepted_at,access_level)
 values('b7990000-2000-4000-8000-000000000003','rent-owner','owner','active','rent-owner',now(),'full_hosting');
insert into public.worker_identity_checks(worker_id,account_role,status,captured_at,consent_at,attempt_count,challenge_result)
 values('rent-owner','property_partner','passed',now(),now(),1,'{}');
insert into public.bank_accounts(id,user_id,account_number,bank_code,bank_name,account_name,is_default,is_active,verified_at,rent_subaccount_code,rent_subaccount_provider_id,rent_subaccount_environment,rent_subaccount_verified_at)
 values('b7990000-5000-4000-8000-000000000001','rent-owner','0000000000','000','Synthetic Bank','Synthetic Owner',true,true,now(),'ACCT_RentContract','987123','test',now());

-- Synthetic accounts, policy and provider receipts exist only in this rollback.
update public.listings set max_occupants=3,accepted_lease_terms_months=array[3,6,12,24],future_installments_allowed=true,address='Synthetic contract address'
 where id='b7990000-2000-4000-8000-000000000001';
insert into public.profiles(auth_id,email,user_id,role,profile_complete,account_kind)
 values('b7990000-0000-4000-8000-000000000008','shared-creator@example.invalid','shared-rent-creator','creator',true,'creator');
insert into public.friends(user_low,user_high,requested_by,status) values('rent-customer','rent-outsider','rent-customer','accepted');
update public.creator_policy_versions set status='retired' where policy_key='future_long_let_installments' and status='active';
insert into public.creator_policy_versions(policy_key,version,value,status,effective_from,reason,checksum)
 values('future_long_let_installments',910012,'{"enabled":true,"payment_protection_hold":false,"settlement_adapter":"verified_subaccount_v1"}','active',now()-interval '1 minute','Rollback-only shared rent collection','shared-rent-contract');
insert into public.inspection_requests(id,request_code,owner_id,owner_email,property_address,property_city,property_state,
 property_type,sub_type,status,document_requirements,document_requirements_revision,document_requirements_set_by,document_requirements_set_at)
values('b7990000-6000-4000-8000-000000000001','SHARED-RENT-REVIEW','rent-owner','rent-owner@example.invalid',
 'Synthetic contract address','Rent Contract Town','Rent Contract Region','apartment','long_stay','completed',
 public._default_property_document_requirements('apartment','long_stay'),1,'shared-rent-creator',now());
update public.listings set inspection_request_id='b7990000-6000-4000-8000-000000000001',approved_by='shared-rent-creator'
 where id='b7990000-2000-4000-8000-000000000001';
insert into public.property_submission_documents(request_id,requirement_code,requirements_revision,version,request_key,
 submitted_by,original_name,mime_type,byte_size,object_path,status,submitted_at,reviewed_at,reviewed_by,review_note)
select 'b7990000-6000-4000-8000-000000000001',rule->>'code',1,1,gen_random_uuid(),'rent-owner',
 'synthetic-reviewed-evidence.pdf','application/pdf',12,'shared-rent-contract/'||(rule->>'code')||'.pdf',
 'approved',now(),now(),'shared-rent-creator','Rollback-only approved evidence fixture'
from jsonb_array_elements(public._default_property_document_requirements('apartment','long_stay')) rule;
insert into public.property_arrival_instructions(asset_kind,asset_id,instructions,owner_id)
values('home','b7990000-2000-4000-8000-000000000001','Synthetic directions for confirmed tenants only','rent-owner');
update public.creator_policy_versions set status='retired' where policy_key='accommodation_arrival_issue_window' and status='active';
insert into public.creator_policy_versions(policy_key,version,value,status,effective_from,reason,checksum)
values('accommodation_arrival_issue_window',910013,'{"default_hours":2,"minimum_hours":1,"maximum_hours":6}','active',now()-interval '1 minute','Rollback-only arrival terms','shared-rent-arrival');
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000001","session_id":"b7990000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.accept_my_property_fees(public.get_provider_fee_disclosure('long_stay','host')->>'digest',null,'b7990000-2000-4000-8000-000000000001');
reset role;
create temp table shared_rent_references(kind text,payer text,reference text,amount numeric);
grant all on shared_rent_references to authenticated;

select set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000004","session_id":"b7990000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.shared_rent_group',public.create_my_shared_long_let('b7990000-2000-4000-8000-000000000001','{}'::uuid[],array['rent-outsider'])->>'id',true);
do $$begin
 if public.get_my_shared_housing_group(current_setting('test.shared_rent_group')::uuid)#>>'{listing,address}' is not null
  or public.get_my_stay_arrival_instructions('home',current_setting('test.shared_rent_reservation',true)) is not null then raise exception 'FAIL: unpaid invitation exposed private arrival information';end if;
 begin perform public.create_my_shared_housing_payment(current_setting('test.shared_rent_group')::uuid);
  raise exception 'FAIL: checkout before all invitations accepted';exception when raise_exception then
  if sqlerrm like 'FAIL:%' then raise;end if;end;
end $$;
select set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000003","session_id":"b7990000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select public.respond_to_shared_housing_invite(current_setting('test.shared_rent_group')::uuid,true);
do $$declare p jsonb;begin
 p:=public.create_my_shared_housing_payment(current_setting('test.shared_rent_group')::uuid);
 insert into shared_rent_references values('fee','rent-outsider',p->>'reference',(p->>'amount')::numeric);
end $$;
select set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000004","session_id":"b7990000-0000-4000-8000-000000000004","role":"authenticated"}',true);
do $$declare p jsonb;begin
 p:=public.create_my_shared_housing_payment(current_setting('test.shared_rent_group')::uuid);
 insert into shared_rent_references values('fee','rent-customer',p->>'reference',(p->>'amount')::numeric);
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$declare p record;receipt jsonb;begin
 for p in select * from shared_rent_references where kind='fee' order by payer loop
  receipt:=public.process_verified_paystack_charge('charge.success:'||p.reference,'charge.success',p.reference,repeat('f',64),now(),(p.amount*100)::bigint,'NGN',p.reference);
  if receipt->>'success'<>'true' then raise exception 'FAIL: shared reservation fee %, %',receipt,(select processing_error from public.verified_provider_events where provider_reference=p.reference);end if;
 end loop;
 if (select count(*) from public.reservations where shared_payment_group_id=current_setting('test.shared_rent_group')::uuid)<>1 then raise exception 'FAIL: shared fees did not create one reservation';end if;
 perform set_config('test.shared_rent_reservation',(select reservation_id from public.shared_housing_groups where id=current_setting('test.shared_rent_group')::uuid),true);
end $$;
select set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000004","session_id":"b7990000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
do $$declare preview jsonb;accepted jsonb;begin
 begin perform public.preview_my_shared_long_let_agreement(current_setting('test.shared_rent_group')::uuid,12,'monthly');
  raise exception 'FAIL: one-year monthly rent';exception when raise_exception then
  if sqlerrm not like 'One-year rent is paid in full.%' then raise;end if;end;
 preview:=public.preview_my_shared_long_let_agreement(current_setting('test.shared_rent_group')::uuid,24,'monthly');
 if jsonb_array_length(preview->'payer_agreements')<>2 or (preview#>>'{agreement,rent_schedule,due_before_handover}')::numeric<>1200000
  or (preview#>>'{payer_agreements,0,rent_schedule,due_before_handover}')::numeric<>600000
  or (preview#>>'{payer_agreements,1,rent_schedule,payments,1,amount}')::numeric<>75000 then raise exception 'FAIL: agreed annual/share/monthly amounts drifted';end if;
 begin perform public.start_my_shared_contract_split(current_setting('test.shared_rent_group')::uuid,24,'monthly','stale');
  raise exception 'FAIL: stale quote accepted';exception when raise_exception then if sqlerrm not like 'Rental terms changed.%' then raise;end if;end;
 accepted:=public.start_my_shared_contract_split(current_setting('test.shared_rent_group')::uuid,24,'monthly',preview#>>'{agreement,quote_digest}');
 if accepted is distinct from public.start_my_shared_contract_split(current_setting('test.shared_rent_group')::uuid,24,'monthly',preview#>>'{agreement,quote_digest}') then raise exception 'FAIL: start retry changed rent agreement';end if;
 begin perform public.create_apartment_rent_payment(current_setting('test.shared_rent_reservation'));
  raise exception 'FAIL: shared payer charged the whole rent through solo checkout';exception when raise_exception then if sqlerrm like 'FAIL:%' then raise;end if;end;
 begin perform public.create_my_shared_housing_payment(current_setting('test.shared_rent_group')::uuid);
  raise exception 'FAIL: organiser acceptance also accepted peer rent';exception when raise_exception then if sqlerrm like 'FAIL:%' then raise;end if;end;
end $$;
select set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000003","session_id":"b7990000-0000-4000-8000-000000000003","role":"authenticated"}',true);
do $$declare terms jsonb;receipt jsonb;payment jsonb;begin
 terms:=public.get_my_shared_long_let_terms(current_setting('test.shared_rent_group')::uuid);
 begin perform public.respond_to_shared_housing_invite(current_setting('test.shared_rent_group')::uuid,true);
  raise exception 'FAIL: generic invite bypassed rent review';exception when raise_exception then if sqlerrm not like 'Review your rental agreement%' then raise;end if;end;
 begin perform public.respond_to_shared_rent_agreement(current_setting('test.shared_rent_group')::uuid,true,terms#>>'{agreement,quote_digest}',(terms->>'checkout_attempt')::integer-1);
  raise exception 'FAIL: stale attempt accepted';exception when raise_exception then if sqlerrm not like 'The rental agreement or checkout attempt changed.%' then raise;end if;end;
 receipt:=public.respond_to_shared_rent_agreement(current_setting('test.shared_rent_group')::uuid,true,terms#>>'{agreement,quote_digest}',(terms->>'checkout_attempt')::integer);
 if receipt is distinct from public.respond_to_shared_rent_agreement(current_setting('test.shared_rent_group')::uuid,true,terms#>>'{agreement,quote_digest}',(terms->>'checkout_attempt')::integer) then raise exception 'FAIL: peer acceptance not idempotent';end if;
 payment:=public.create_my_shared_housing_payment(current_setting('test.shared_rent_group')::uuid);
 insert into shared_rent_references values('initial','rent-outsider',payment->>'reference',(payment->>'amount')::numeric);
 if payment->>'reference' is distinct from public.create_my_shared_housing_payment(current_setting('test.shared_rent_group')::uuid)->>'reference' then raise exception 'FAIL: shared rent checkout retry charged again';end if;
end $$;
select set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000004","session_id":"b7990000-0000-4000-8000-000000000004","role":"authenticated"}',true);
do $$declare p jsonb;begin
 p:=public.create_my_shared_housing_payment(current_setting('test.shared_rent_group')::uuid);
 insert into shared_rent_references values('initial','rent-customer',p->>'reference',(p->>'amount')::numeric);
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
savepoint late_shared_rent;
update public.shared_housing_groups set expires_at=now()-interval '1 second' where id=current_setting('test.shared_rent_group')::uuid;
update public.shared_payment_groups set checkout_expires_at=now()-interval '1 second' where shared_payment_group_id=current_setting('test.shared_rent_group')::uuid;
do $$declare p record;receipt jsonb;begin
 for p in select * from shared_rent_references where kind='initial' loop
  receipt:=public.process_verified_paystack_charge('charge.success:'||p.reference,'charge.success',p.reference,repeat('a',64),now(),(p.amount*100)::bigint,'NGN',p.reference);
  if receipt->>'success' is distinct from 'true' then raise exception 'FAIL: late real receipt not retained: %',receipt;end if;
 end loop;
 if not exists(select 1 from public.shared_housing_groups where id=current_setting('test.shared_rent_group')::uuid and status='refunding')
  or exists(select 1 from public.reservations where id=current_setting('test.shared_rent_reservation') and status in('ready_for_move_in','occupied')) then raise exception 'FAIL: late shared rent revived arrival';end if;
 if (select count(*) from public.financial_action_outbox where action_type='refund_shared_checkout' and amount=600000
  and metadata->>'shared_payment_group_id'=current_setting('test.shared_rent_group') and metadata->>'refund_destination'='original_payment')<>2 then raise exception 'FAIL: each late rent payment needs its own original-payer refund action';end if;
end $$;
rollback to savepoint late_shared_rent;
release savepoint late_shared_rent;
do $$declare p record;receipt jsonb;begin
 for p in select * from shared_rent_references where kind='initial' order by payer loop
  if p.amount<>600000 then raise exception 'FAIL: wrong individual rent charge';end if;
  receipt:=public.process_verified_paystack_charge('charge.success:'||p.reference,'charge.success',p.reference,repeat('a',64),now(),(p.amount*100)::bigint,'NGN',p.reference);
  if receipt->>'success'<>'true' then raise exception 'FAIL: initial shared rent %, %',receipt,(select processing_error from public.verified_provider_events where provider_reference=p.reference);end if;
  if not exists(select 1 from public.payment_protection_transactions where paystack_reference=p.reference
   and payer_user_id=p.payer and amount_total=600000 and amount_commission=60000 and amount_payee=540000 and subject_type='long_let_payment') then raise exception 'FAIL: initial per-payer protection lost frozen amounts';end if;
  if p.payer='rent-customer' and (private.shared_long_let_initial_rent_confirmed(current_setting('test.shared_rent_reservation'))
   or exists(select 1 from public.reservations where id=current_setting('test.shared_rent_reservation') and status='ready_for_move_in')) then raise exception 'FAIL: one payer confirmed the whole tenancy';end if;
 end loop;
 if not private.shared_long_let_initial_rent_confirmed(current_setting('test.shared_rent_reservation')) then raise exception 'FAIL: all verified real shares did not authorize booking';end if;
 begin update public.shared_housing_groups set total_amount=total_amount+1 where id=current_setting('test.shared_rent_group')::uuid;
  raise exception 'FAIL: paid shared total was mutable';exception when raise_exception then if sqlerrm not like 'Open or paid shared checkout terms are immutable%' then raise;end if;end;
 begin update public.reservations set contract_rent_total=contract_rent_total+1 where id=current_setting('test.shared_rent_reservation');
  raise exception 'FAIL: paid tenancy total was mutable';exception when raise_exception then if sqlerrm not like 'Paid accommodation terms are immutable%' then raise;end if;end;
 if (select count(*) from public.rent_plans where reservation_id=current_setting('test.shared_rent_reservation'))<>2
  or (select count(*) from public.rent_plan_contributions where reservation_id=current_setting('test.shared_rent_reservation'))<>16
  or exists(select 1 from public.rent_plan_contributions where reservation_id=current_setting('test.shared_rent_reservation') and due_date is not null) then raise exception 'FAIL: per-payer schedule/actual handover boundary';end if;
end $$;
select set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000004","session_id":"b7990000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
do $$declare h jsonb;begin
 h:=public.get_my_later_rent_history(current_setting('test.shared_rent_reservation'));
 if jsonb_array_length(h->'items')<>8 or exists(select 1 from jsonb_array_elements(h->'items') item
  where item->>'due_date' is not null or (item->>'is_overdue')::boolean is distinct from false or (item->>'can_pay')::boolean is distinct from false) then raise exception 'FAIL: unanchored rent history invented due dates or overdue status';end if;
end $$;
select set_config('test.shared_rent_booking_code',(public.request_my_apartment_move_in(current_setting('test.shared_rent_reservation'),now())).booking_code,true);
reset role;

savepoint revoked_shared_device;
update public.user_sessions set is_active=false where user_id='rent-outsider';
select set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000003","session_id":"b7990000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
do $$begin
 if public.get_my_shared_housing_group(current_setting('test.shared_rent_group')::uuid)->'arrival' is distinct from 'null'::jsonb
  or public.get_my_stay_arrival_instructions('home',current_setting('test.shared_rent_reservation')) is not null then raise exception 'FAIL: revoked shared device retained private arrival information';end if;
end $$;
reset role;
rollback to savepoint revoked_shared_device;
release savepoint revoked_shared_device;
select set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000001","session_id":"b7990000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$declare r public.reservations;begin
 select * into r from public.host_confirm_long_let_handover(
  current_setting('test.shared_rent_booking_code'),
  (now() at time zone 'Africa/Lagos')::date,current_setting('test.shared_rent_reservation'));
 if r.status<>'occupied' then raise exception 'FAIL: actual host handover did not activate tenancy';end if;
end $$;
reset role;
do $$begin
 if exists(select 1 from public.rent_plan_contributions c join public.rent_plans p on p.id=c.rent_plan_id
  where c.reservation_id=current_setting('test.shared_rent_reservation') and (c.amount<>75000 or c.due_date<>(p.tenancy_start_date+make_interval(months=>c.agreement_sequence+2))::date)) then raise exception 'FAIL: own later-year dues not anchored to actual handover';end if;
end $$;

-- The invited Friend receives the same confirmed arrival facts, without the
-- organiser's booking mutations or another person's payment/card authority.
select set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000003","session_id":"b7990000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
do $$declare g jsonb;begin
 g:=public.get_my_shared_housing_group(current_setting('test.shared_rent_group')::uuid);
 if g#>>'{arrival,booking_code}' is distinct from current_setting('test.shared_rent_booking_code')
  or g#>>'{arrival,status}'<>'occupied' or g#>>'{listing,address}'<>'Synthetic contract address'
  or public.get_my_stay_arrival_instructions('home',current_setting('test.shared_rent_reservation')) is distinct from 'Synthetic directions for confirmed tenants only' then raise exception 'FAIL: confirmed peer cannot see their arrival information';end if;
 begin perform public.request_my_apartment_move_in(current_setting('test.shared_rent_reservation'),now());raise exception 'FAIL: peer gained organiser move-in control';exception when raise_exception then if sqlerrm like 'FAIL:%' then raise;end if;end;
end $$;
reset role;

-- Rollback-only time travel: first contribution is due and the other payer
-- misses it. This is a future-year debt, never an unpaid current-year tenancy.
set local session_replication_role=replica;
update public.reservations set tenancy_start_date=((now() at time zone 'Africa/Lagos')::date-interval '4 months 1 day')::date where id=current_setting('test.shared_rent_reservation');
update public.rent_plans set tenancy_start_date=((now() at time zone 'Africa/Lagos')::date-interval '4 months 1 day')::date where reservation_id=current_setting('test.shared_rent_reservation');
update public.rent_plan_contributions c set due_date=(p.tenancy_start_date+make_interval(months=>c.agreement_sequence+2))::date
 from public.rent_plans p where p.id=c.rent_plan_id and c.reservation_id=current_setting('test.shared_rent_reservation');
set local session_replication_role=origin;
do $$declare before_count integer;begin
 perform private.enqueue_later_rent_payment_notices(100);
 select count(*) into before_count from public.activity_events e where e.event_key like 'rent-notice:%'
  and (e.subject_id=current_setting('test.shared_rent_group') or e.route_params->>'listing_id'='b7990000-2000-4000-8000-000000000001');
 perform private.enqueue_later_rent_payment_notices(100);
 if before_count<>4 or (select count(*) from public.activity_events e where e.event_key like 'rent-notice:%'
  and (e.subject_id=current_setting('test.shared_rent_group') or e.route_params->>'listing_id'='b7990000-2000-4000-8000-000000000001'))<>before_count then raise exception 'FAIL: overdue payer/Partner notices missing or duplicated';end if;
 if exists(select 1 from public.activity_events e join public.activity_event_audiences a using(activity_event_id)
  where e.subject_id=current_setting('test.shared_rent_group') and e.event_type='rent.payment_overdue' and a.recipient_user_id not in('rent-customer','rent-outsider')) then raise exception 'FAIL: private overdue debt sent to another person';end if;
end $$;
select set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000004","session_id":"b7990000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
do $$declare h jsonb;p jsonb;c uuid;begin
 h:=public.get_my_later_rent_history(current_setting('test.shared_rent_reservation'));
 if h->>'is_shared'<>'true' or (h#>>'{years,0,annual_rent}')::numeric<>600000 or (h#>>'{items,0,amount}')::numeric<>75000 then raise exception 'FAIL: own history showed whole tenancy obligation: %',h;end if;
 perform public.accept_my_later_rent_settlement(current_setting('test.shared_rent_reservation'),h->>'agreement_digest');
 c:=(h#>>'{items,0,contribution_id}')::uuid;
 p:=public.create_rent_plan_contribution_payment(c);
 insert into shared_rent_references values('later','rent-customer',p->>'reference',(p->>'amount')::numeric);
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$declare p public.booking_payments;result jsonb;begin
 select * into p from public.booking_payments where paystack_reference=(select reference from shared_rent_references where kind='later');
 if p.amount_commission<>7500 or p.net_amount<>67500 then raise exception 'FAIL: contribution charged annual fee';end if;
 perform public.record_verified_rent_route(p.paystack_reference,'910001',7500000,'NGN','test','ACCT_RentContract','987123',6750000);
 result:=public.process_verified_paystack_charge('charge.success:910001','charge.success',p.paystack_reference,repeat('b',64),now(),7500000,'NGN','910001');
 if result->>'success'<>'true' then raise exception 'FAIL: real shared later collection %, %',result,(select processing_error from public.verified_provider_events where provider_reference=p.paystack_reference);end if;
 if exists(select 1 from public.payment_protection_transactions where paystack_reference=p.paystack_reference) then raise exception 'FAIL: later shared rent created a new hold';end if;
 perform public.record_verified_rent_settlement(p.id,'910002','910001','987123',6750000,'NGN','test',repeat('c',64));
end $$;
select set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000004","session_id":"b7990000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
do $$declare h jsonb;y jsonb;begin
 h:=public.get_my_later_rent_history(current_setting('test.shared_rent_reservation'));y:=h#>'{years,0}';
 if (y->>'gross_rent_paid')::numeric<>75000 or (y->>'completed_months')::integer<>1 or (y->>'partial_month_credit')::numeric<>25000
  or (y->>'next_month_balance')::numeric<>25000 or (y->>'remaining_year_rent')::numeric<>525000 then raise exception 'FAIL: 1/8 annual share did not fund 1.5 months of own rent share';end if;
end $$;
select set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000003","session_id":"b7990000-0000-4000-8000-000000000003","role":"authenticated"}',true);
do $$declare h jsonb;begin
 h:=public.get_my_later_rent_history(current_setting('test.shared_rent_reservation'));
 if (h#>>'{years,0,gross_rent_paid}')::numeric<>0 or h#>>'{items,0,is_overdue}'<>'true' then raise exception 'FAIL: unpaid peer received other payer credit or hid overdue contribution';end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000001","session_id":"b7990000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$declare accounts jsonb;row jsonb;plan_id uuid;begin
 accounts:=public.get_my_property_later_rent_accounts('b7990000-2000-4000-8000-000000000001');
 if jsonb_array_length(accounts->'items')<>2 then raise exception 'FAIL: Partner did not get each agreed payer account';end if;
 for row in select value from jsonb_array_elements(accounts->'items') loop
  if jsonb_typeof(row->'shared_summary') is distinct from 'object' or (row#>>'{shared_summary,total_received}')::numeric is distinct from 75000 or (row#>>'{shared_summary,overdue_amount}')::numeric is distinct from 75000
   or (row#>>'{shared_summary,remaining_scheduled_rent}')::numeric<>1125000 then raise exception 'FAIL: Partner combined verified credit, outstanding shares and future scheduled rent do not reconcile: %',row;end if;
  plan_id:=(row->>'plan_id')::uuid;
  if public.get_my_later_rent_history(current_setting('test.shared_rent_reservation'),0,24,plan_id)->>'viewer'<>'partner' then raise exception 'FAIL: Partner cannot open the selected payer history';end if;
 end loop;
end $$;
reset role;
-- Each optional debit mandate is tied to that payer's own verified source,
-- including a Friend who has not made a later-year payment yet.
select set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000003","session_id":"b7990000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
do $$declare h jsonb;prepared jsonb;begin
 h:=public.get_my_later_rent_history(current_setting('test.shared_rent_reservation'));
 if public.get_my_later_rent_debit(current_setting('test.shared_rent_reservation'))->>'status' is distinct from 'manual' then raise exception 'FAIL: peer debit enabled without consent';end if;
 perform public.accept_my_later_rent_settlement(current_setting('test.shared_rent_reservation'),h->>'agreement_digest');
 prepared:=public.prepare_my_later_rent_debit(current_setting('test.shared_rent_reservation'),h->>'agreement_digest',true);
 if prepared->>'source_reference' is distinct from (select reference from shared_rent_references where kind='initial' and payer='rent-outsider') then raise exception 'FAIL: peer automatic debit used another person payment';end if;
end $$;
reset role;
select set_config('test.peer_rent_plan',(select id::text from public.rent_plans where reservation_id=current_setting('test.shared_rent_reservation') and user_id='rent-outsider'),true);
select set_config('test.peer_rent_contribution',(select id::text from public.rent_plan_contributions where rent_plan_id=current_setting('test.peer_rent_plan')::uuid and agreement_sequence=2),true);
select set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000004","session_id":"b7990000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
do $$begin
 begin perform public.get_my_later_rent_history(current_setting('test.shared_rent_reservation'),0,16,current_setting('test.peer_rent_plan')::uuid);
  raise exception 'FAIL: payer selected another person rent history';exception when raise_exception then if sqlerrm not like 'Choose the accepted tenant rent account%' then raise;end if;end;
 begin perform public.create_rent_plan_contribution_payment(current_setting('test.peer_rent_contribution')::uuid);
  raise exception 'FAIL: payer charged another person contribution';exception when others then if sqlerrm like 'FAIL:%' then raise;end if;end;
end $$;
reset role;
do $$begin
 if not exists(select 1 from public.reservations where id=current_setting('test.shared_rent_reservation') and status='occupied' and rent_payment_status='upfront_paid') then raise exception 'FAIL: missed next-year contribution cancelled current paid tenancy';end if;
 if exists(select 1 from public.booking_payments where purpose='rent_plan_contribution' and user_id='rent-outsider') then raise exception 'FAIL: peer was silently charged';end if;
end $$;
-- Paying all of one's own eight contributions still cannot pay the Friend's
-- next-year balance. Only the named person's receipts and debit authority move.
set local session_replication_role=replica;
update public.reservations set tenancy_start_date=((now() at time zone 'Africa/Lagos')::date-interval '12 months')::date where id=current_setting('test.shared_rent_reservation');
update public.rent_plans set tenancy_start_date=((now() at time zone 'Africa/Lagos')::date-interval '12 months')::date where reservation_id=current_setting('test.shared_rent_reservation');
update public.rent_plan_contributions c set due_date=(p.tenancy_start_date+make_interval(months=>c.agreement_sequence+2))::date
 from public.rent_plans p where p.id=c.rent_plan_id and c.reservation_id=current_setting('test.shared_rent_reservation');
set local session_replication_role=origin;
do $$declare c record;payment jsonb;p public.booking_payments;receipt jsonb;h jsonb;begin
 for c in select contribution.id,contribution.agreement_sequence from public.rent_plan_contributions contribution
  join public.rent_plans plan on plan.id=contribution.rent_plan_id
  where plan.reservation_id=current_setting('test.shared_rent_reservation') and plan.user_id='rent-customer'
   and contribution.agreement_sequence>2 order by contribution.agreement_sequence loop
  perform set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000004","session_id":"b7990000-0000-4000-8000-000000000004","role":"authenticated"}',true);
  payment:=public.create_rent_plan_contribution_payment(c.id);
  select * into p from public.booking_payments where paystack_reference=payment->>'reference';
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform public.record_verified_rent_route(p.paystack_reference,(920000+c.agreement_sequence)::text,7500000,'NGN','test','ACCT_RentContract','987123',6750000);
  receipt:=public.process_verified_paystack_charge('charge.success:'||(920000+c.agreement_sequence),'charge.success',p.paystack_reference,repeat('d',64),now(),7500000,'NGN',(920000+c.agreement_sequence)::text);
  if receipt->>'success' is distinct from 'true' then raise exception 'FAIL: own later payment cycle %, %',receipt,(select processing_error from public.verified_provider_events where provider_reference=p.paystack_reference);end if;
  perform public.record_verified_rent_settlement(p.id,(930000+c.agreement_sequence)::text,(920000+c.agreement_sequence)::text,'987123',6750000,'NGN','test',repeat('e',64));
 end loop;
 perform set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000004","session_id":"b7990000-0000-4000-8000-000000000004","role":"authenticated"}',true);
 h:=public.get_my_later_rent_history(current_setting('test.shared_rent_reservation'));
 if (h#>>'{years,0,gross_rent_paid}')::numeric is distinct from 600000 or (h#>>'{years,0,completed_months}')::integer is distinct from 12
  or (h#>>'{years,0,remaining_year_rent}')::numeric is distinct from 0 then raise exception 'FAIL: eight own contributions did not fund exactly one annual share';end if;
 if not exists(select 1 from public.reservations where id=current_setting('test.shared_rent_reservation') and rent_payment_status='upfront_paid' and status='occupied')
  or exists(select 1 from public.rent_plans where reservation_id=current_setting('test.shared_rent_reservation') and user_id='rent-outsider' and total_contributed<>0) then raise exception 'FAIL: one completed payer plan paid or terminated another person obligation';end if;
end $$;

-- Hosting is an existing resource-scoped workspace. A delegated responsible
-- host can read its arrival Activity; revoking that assignment removes it from
-- both current and compatibility feeds, without granting a Staff identity.
savepoint delegated_arrival_activity;
set local session_replication_role=replica;
update public.reservations set responsible_host_user_id='rent-operations' where id=current_setting('test.shared_rent_reservation');
set local session_replication_role=origin;
insert into public.notifications(recipient_id,type,title,message,source_type,source_id,destination_route,destination_params,workspace_scope)
values('rent-operations','property_move_in_requested','Move-in time requested','Synthetic assigned arrival',
 'apartment_reservation',current_setting('test.shared_rent_reservation'),'hosting',jsonb_build_object('reservation_id',current_setting('test.shared_rent_reservation')),'hosting');
select set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000002","session_id":"b7990000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $$begin
 if not exists(select 1 from public.get_my_canonical_activity_v2('hosting') where source_id=current_setting('test.shared_rent_reservation'))
  or not exists(select 1 from public.get_my_canonical_activity('hosting') where source_id=current_setting('test.shared_rent_reservation')) then raise exception 'FAIL: delegated host arrival feed is disconnected';end if;
end $$;
reset role;
update public.property_host_assignments set status='revoked' where user_id='rent-operations';
set local role authenticated;
do $$begin
 if exists(select 1 from public.get_my_canonical_activity_v2('hosting')) or exists(select 1 from public.get_my_canonical_activity('hosting'))
  or (public.get_my_canonical_activity_summary('hosting')->>'unread')::integer is distinct from 0 then raise exception 'FAIL: revoked host retained private arrival Activity';end if;
end $$;
reset role;
rollback to savepoint delegated_arrival_activity;
release savepoint delegated_arrival_activity;
select 'Shared Long Let real checkout, protected initial shares, host handover, own later-year credit and settlement passed' as result;
rollback;
