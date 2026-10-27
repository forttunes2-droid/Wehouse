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
insert into public.reservations(id,listing_id,user_id,status,manual_payment_status,paid_at,rent_payment_status,stay_type,rental_plan_years,annual_rent_snapshot,upfront_rent_required,contract_rent_total,installment_balance,installment_count,management_mode_snapshot,responsible_host_user_id,commission_policy_version_id,requested_move_in_at)
 values('rent-agreement-full','b7990000-2000-4000-8000-000000000001','rent-customer','reserved','completed',now(),'not_started','long_stay',1,1200000,1200000,1200000,0,0,'host','rent-owner','b7990000-4000-4000-8000-000000000001',null),
 ('rent-agreement-monthly','b7990000-2000-4000-8000-000000000003','rent-customer','reserved','completed',now(),'not_started','long_stay',1,1200000,1200000,1200000,0,0,'host','rent-owner','b7990000-4000-4000-8000-000000000001',null);
update public.listings set status='reserved',availability_status='reserved',reserved_by='rent-customer',current_reservation_id='rent-agreement-full'
 where id='b7990000-2000-4000-8000-000000000001';
update public.listings set current_reservation_id='rent-agreement-monthly',reserved_by='rent-customer'
 where id='b7990000-2000-4000-8000-000000000003';

set local session_replication_role=origin;
select set_config('request.jwt.claim.sub','b7990000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000001","session_id":"b7990000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$
declare receipt jsonb;retry jsonb;denied boolean:=false;
begin
 receipt:=public.set_my_long_let_rent_terms('b7990000-2000-4000-8000-000000000001',1,array[12,3,6,24],true);
 if receipt->>'revision'<>'2' or receipt->'accepted_terms_months'<>'[3,6,12,24]'::jsonb or receipt->>'monthly_accepted'<>'true' then raise exception 'FAIL: owner offer was not saved';end if;
 retry:=public.set_my_long_let_rent_terms('b7990000-2000-4000-8000-000000000001',1,array[3,6,12,24],true);
 if retry is distinct from receipt then raise exception 'FAIL: retry changed saved terms';end if;
 begin perform public.set_my_long_let_rent_terms('b7990000-2000-4000-8000-000000000001',1,array[12],false);
 exception when raise_exception then denied:=true;end;
 if not denied then raise exception 'FAIL: stale change overwrote accepted offer';end if;
 receipt:=public.set_my_long_let_rent_terms('b7990000-2000-4000-8000-000000000002',1,array[12,24],false);
 if receipt->'accepted_terms_months'<>'[12,24]'::jsonb then raise exception 'FAIL: WeHouse-managed owner could not set accepted terms';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','b7990000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000003","session_id":"b7990000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
do $$
declare denied boolean:=false;
begin
 begin perform public.set_my_long_let_rent_terms('b7990000-2000-4000-8000-000000000001',2,array[12],false);
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'FAIL: outsider changed another Partner offer';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','b7990000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000002","session_id":"b7990000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $$
declare denied boolean:=false;
begin
 begin perform public.get_my_long_let_rent_terms('b7990000-2000-4000-8000-000000000001');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'FAIL: Operations co-host gained commercial control';end if;
end $$;
reset role;

set local session_replication_role=replica;
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status) values('rent-operations','creator','global','active');
insert into public.creator_elevation_grants(creator_elevation_id,creator_user_id,auth_user_id,auth_session_id,action_classes,expires_at,verification_method)
 values('b7990000-9000-4000-8000-000000000001','rent-operations','b7990000-0000-4000-8000-000000000002','b7990000-0000-4000-8000-000000000002',array['policy_publish'],now()+interval '5 minutes','password');
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000002","session_id":"b7990000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $availability$
declare policy jsonb;published jsonb;
begin
 policy:=public.creator_get_later_rent_collection();
 begin perform public.creator_set_later_rent_collection(gen_random_uuid(),(policy->>'policy_version_id')::uuid,true,'Synthetic collection enablement');raise exception 'FAIL: collection enabled without fresh confirmation';exception when insufficient_privilege then null;end;
 published:=public.creator_set_later_rent_collection('b7990000-9000-4000-8000-000000000001',(policy->>'policy_version_id')::uuid,true,'Rollback-only verified rent collection contract');
 if published->>'enabled'<>'true' then raise exception 'FAIL: Creator collection policy was not saved';end if;
 begin perform public.creator_set_later_rent_collection('b7990000-9000-4000-8000-000000000001',(policy->>'policy_version_id')::uuid,false,'Stale collection tab must not overwrite current policy');raise exception 'FAIL: stale collection update was accepted';exception when raise_exception then if sqlerrm not like '%policy changed%' then raise;end if;end;
end $availability$;
reset role;

-- The same reservation owns offer acceptance, checkout and protected payment.
create temp table rent_contract_references(kind text,reference text);
grant all on rent_contract_references to authenticated;
select set_config('request.jwt.claim.sub','b7990000-0000-4000-8000-000000000004',true);
select set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000004","session_id":"b7990000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
do $contract$
declare quote jsonb;accepted jsonb;checkout jsonb;retry jsonb;
begin
 quote:=public.preview_my_long_let_agreement('rent-agreement-full',3,'full');
 if (quote->'rent_schedule'->>'contract_total')::numeric<>300000 then raise exception 'FAIL: three-month quote total';end if;
 accepted:=public.accept_my_long_let_agreement('rent-agreement-full',3,'full',quote->>'quote_digest');
 retry:=public.accept_my_long_let_agreement('rent-agreement-full',3,'full',quote->>'quote_digest');
 if accepted is distinct from retry then raise exception 'FAIL: agreement retry changed terms';end if;
 checkout:=public.create_apartment_rent_payment('rent-agreement-full');
 if checkout->>'success'<>'true' or (checkout->>'amount')::numeric<>300000 then raise exception 'FAIL: full term checkout did not collect contract total';end if;
 insert into rent_contract_references values('full',checkout->>'reference');
 begin
  perform public.preview_my_long_let_agreement('rent-agreement-monthly',12,'monthly');
  raise exception 'FAIL: one-year monthly quote was accepted';
 exception when raise_exception then
  if sqlerrm not like 'One-year rent is paid in full.%' then raise;end if;
 end;
 quote:=public.preview_my_long_let_agreement('rent-agreement-monthly',24,'monthly');
 if (quote->'rent_schedule'->>'due_before_handover')::numeric<>1200000 then raise exception 'FAIL: monthly first amount';end if;
 perform public.accept_my_long_let_agreement('rent-agreement-monthly',24,'monthly',quote->>'quote_digest');
 checkout:=public.create_apartment_rent_payment('rent-agreement-monthly');
 if checkout->>'success'<>'true' or (checkout->>'amount')::numeric<>1200000 then raise exception 'FAIL: monthly initial checkout amount';end if;
 insert into rent_contract_references values('monthly',checkout->>'reference');
end $contract$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $contract$
declare ref record;receipt jsonb;expected numeric;
begin
 for ref in select * from rent_contract_references loop
  expected:=case when ref.kind='full' then 300000 else 1200000 end;
  receipt:=public.process_verified_paystack_charge('charge.success:'||ref.reference,'charge.success',ref.reference,repeat('d',64),now(),(expected*100)::bigint,'NGN',ref.reference);
  if receipt->>'success'<>'true' then raise exception 'FAIL: canonical rent confirmation %, %',receipt,(select processing_error from public.verified_provider_events where provider_reference=ref.reference limit 1);end if;
  if not exists(select 1 from public.payment_protection_transactions where paystack_reference=ref.reference and amount_total=expected and amount_commission=expected*0.1 and amount_payee=expected*0.9) then
   raise exception 'FAIL: rent Protection and commission split';end if;
 end loop;
 update public.reservations set requested_move_in_at=now()-interval '1 minute' where id in('rent-agreement-full','rent-agreement-monthly');
 if exists(select 1 from public.rent_plans where reservation_id='rent-agreement-full') then raise exception 'FAIL: full contract created unpaid future obligations';end if;
 if (select count(*) from public.rent_plan_contributions where reservation_id='rent-agreement-monthly')<>8 then raise exception 'FAIL: monthly agreement did not create eight later-year payments';end if;
 if exists(select 1 from public.rent_plan_contributions where reservation_id='rent-agreement-monthly' and due_date is not null) then raise exception 'FAIL: payment alone invented a handover date';end if;
end $contract$;
select set_config('request.jwt.claim.sub','b7990000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000001","session_id":"b7990000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $contract$
declare start_day date:=(now() at time zone 'Africa/Lagos')::date;
begin
 perform private.activate_apartment_tenancy('rent-agreement-full',start_day);
 perform private.activate_apartment_tenancy('rent-agreement-monthly',start_day);
 if not exists(select 1 from public.reservations where id='rent-agreement-full' and tenancy_end_date=(start_day+interval '3 months')::date) then raise exception 'FAIL: three-month tenancy became one year';end if;
 if not exists(select 1 from public.rent_plan_contributions where reservation_id='rent-agreement-monthly' and installment_number=1 and target_year=2 and due_date=(start_day+interval '4 months')::date) then raise exception 'FAIL: first later monthly payment was not anchored to actual handover';end if;
 if (select sum(amount) from public.rent_plan_contributions where reservation_id='rent-agreement-monthly')<>1200000 then raise exception 'FAIL: remaining monthly amounts drifted';end if;
end $contract$;

-- A later-year schedule alone is not direct-settlement consent.
select set_config('request.jwt.claim.sub','b7990000-0000-4000-8000-000000000004',true);
select set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000004","session_id":"b7990000-0000-4000-8000-000000000004","role":"authenticated"}',true);
do $contract$
declare contribution uuid;
begin
 select id into contribution from public.rent_plan_contributions where reservation_id='rent-agreement-monthly' and agreement_sequence=2;
 begin
  perform public.create_rent_plan_contribution_payment(contribution);
  raise exception 'FAIL: later rent bypassed tenant consent';
 exception when raise_exception then
  if sqlerrm not like 'Review and accept later-year direct settlement%' then raise;end if;
 end;
end $contract$;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $contract$
declare receipt jsonb;contribution uuid;ref text:='WH-PROTECTED-LATER-RENT-CONTRACT';
begin
 select id into contribution from public.rent_plan_contributions where reservation_id='rent-agreement-monthly' and agreement_sequence=2;
 insert into public.booking_payments(payment_reference,paystack_reference,user_id,payer_user_id,type,booking_type,listing_id,amount,amount_total,currency,status,purpose,metadata)
 values(ref,ref,'rent-customer','rent-customer','apartment','apartment','b7990000-2000-4000-8000-000000000003',150000,150000,'NGN','pending','rent_plan_contribution',jsonb_build_object('contribution_id',contribution));
 receipt:=public.process_verified_paystack_charge('charge.success:protected-rent-contract','charge.success',ref,repeat('e',64),now(),15000000,'NGN','protected-rent-contract');
 if receipt->>'success'<>'false' or not exists(select 1 from public.verified_provider_events where provider_reference=ref and processing_status='failed') then
  raise exception 'FAIL: unsafe later rent receipt did not enter durable Finance recovery';end if;
 if exists(select 1 from public.booking_payments where paystack_reference=ref and status in('paid','completed'))
  or exists(select 1 from public.ledger_transactions where idempotency_key='paystack-charge:'||ref) then
  raise exception 'FAIL: unprotected later rent became paid or credited';end if;
end $contract$;

-- Rollback-only time/eligibility fixtures. No PSP request is sent. Move the
-- verified handover anchor four months back so the first scheduled payment is due.
set local session_replication_role=replica;
update public.reservations set tenancy_start_date=((now() at time zone 'Africa/Lagos')::date-interval '4 months')::date where id='rent-agreement-monthly';
update public.rent_plans set tenancy_start_date=((now() at time zone 'Africa/Lagos')::date-interval '4 months')::date where reservation_id='rent-agreement-monthly';
update public.rent_plan_contributions c set due_date=(p.tenancy_start_date+make_interval(months=>c.agreement_sequence+2))::date
 from public.rent_plans p where p.id=c.rent_plan_id and c.reservation_id='rent-agreement-monthly';
set local session_replication_role=origin;

-- The accepted payee can rotate their default bank before the next charge.
-- Keep this fixture route unchanged so provider-proof assertions below remain explicit.
update public.bank_accounts set is_default=false where id='b7990000-5000-4000-8000-000000000001';
insert into public.bank_accounts(id,user_id,account_number,bank_code,bank_name,account_name,is_default,is_active,verified_at,rent_subaccount_code,rent_subaccount_provider_id,rent_subaccount_environment,rent_subaccount_verified_at)
 values('b7990000-5000-4000-8000-000000000002','rent-owner','1111111111','000','Synthetic Bank','Synthetic Owner',true,true,now(),'ACCT_RentContract','987123','test',now());

select set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000003","session_id":"b7990000-0000-4000-8000-000000000003","role":"authenticated"}',true);
do $$begin
 begin perform public.get_my_later_rent_history('rent-agreement-monthly');raise exception 'FAIL: outsider read tenant rent history';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000004","session_id":"b7990000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
do $cycle$
declare history jsonb;accepted jsonb;checkout jsonb;retry jsonb;contribution uuid;
begin
 history:=public.get_my_later_rent_history('rent-agreement-monthly',0,1);
 if history->>'viewer'<>'customer' or history->>'has_more'<>'true' or jsonb_array_length(history->'items')<>1
  or history#>>'{years,0,gross_rent_paid}'<>'0' or history#>>'{years,0,completed_months}'<>'0' then raise exception 'FAIL: paged unpaid history invented rent credit';end if;
 accepted:=public.accept_my_later_rent_settlement('rent-agreement-monthly',history->>'agreement_digest');
 if accepted is distinct from public.accept_my_later_rent_settlement('rent-agreement-monthly',history->>'agreement_digest') then raise exception 'FAIL: consent retry changed its agreement';end if;
 contribution:=(history#>>'{items,0,contribution_id}')::uuid;
 checkout:=public.create_rent_plan_contribution_payment(contribution);retry:=public.create_rent_plan_contribution_payment(contribution);
 if checkout->>'reference' is distinct from retry->>'reference' or (checkout->>'amount')::numeric<>150000 then raise exception 'FAIL: retry created another charge or charged the wrong amount';end if;
 perform set_config('test.later_rent_reference',checkout->>'reference',true);
 begin perform public.record_verified_rent_route(checkout->>'reference','987654',15000000,'NGN','test','ACCT_RentContract','987123',13500000);raise exception 'FAIL: browser forged a provider rent proof';exception when insufficient_privilege then null;end;
end $cycle$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $cycle$
declare ref text:=current_setting('test.later_rent_reference');receipt jsonb;p public.booking_payments;before_count integer;
begin
 select * into p from public.booking_payments where paystack_reference=ref;
 if p.metadata#>>'{rent_settlement_route,bank_account_id}'<>'b7990000-5000-4000-8000-000000000002' then raise exception 'FAIL: future collection did not use the same accepted Partner current verified bank';end if;
 if p.amount_commission<>15000 or p.net_amount<>135000 then raise exception 'FAIL: monthly payment charged annual commission or changed its saved split';end if;
 perform public.validate_later_rent_checkout(p.id,'rent-customer');
 receipt:=public.process_verified_paystack_charge('charge.success:987654','charge.success',ref,repeat('a',64),now(),15000000,'NGN','987654');
 if receipt->>'success'<>'false' then raise exception 'FAIL: missing provider split was accepted';end if;
 perform public.record_verified_rent_route(ref,'987654',15000000,'NGN','test','ACCT_WrongBank','987123',13500000);
 receipt:=public.process_verified_paystack_charge('charge.success:987654','charge.success',ref,repeat('a',64),now(),15000000,'NGN','987654');
 if receipt->>'success'<>'false' then raise exception 'FAIL: wrong Partner split was accepted';end if;
 perform public.record_verified_rent_route(ref,'987654',15000000,'NGN','test','ACCT_RentContract','987123',13500000);
 receipt:=public.process_verified_paystack_charge('charge.success:987654','charge.success',ref,repeat('a',64),now(),15000000,'NGN','987654');
 if receipt->>'success'<>'true' then raise exception 'FAIL: rent confirmation %, %',receipt,(select processing_error from public.verified_provider_events where provider_reference=ref);end if;
 if exists(select 1 from public.payment_protection_transactions where paystack_reference=ref) then raise exception 'FAIL: later-year rent created a new protection hold';end if;
 if not exists(select 1 from public.booking_payments where id=p.id and metadata#>>'{rent_provider_settlement,status}'='pending') then raise exception 'FAIL: charge was falsely reported as a settled payout';end if;
 if (select total_paid_out<>0 from public.rent_plans where reservation_id='rent-agreement-monthly') then raise exception 'FAIL: charge confirmation counted as paid-out earnings';end if;
 if exists(select 1 from public.wallets where owner_id='rent-owner' and owner_type='property_partner' and available_balance>0) then raise exception 'FAIL: direct rent also credited a withdrawable wallet';end if;
 select count(*) into before_count from public.ledger_transactions where idempotency_key in('paystack-charge:'||ref,'rent-route:'||p.id);
 if before_count<>2 then raise exception 'FAIL: direct rent did not post charge and allocation once';end if;
 perform public.process_verified_paystack_charge('charge.success:987654','charge.success',ref,repeat('a',64),now(),15000000,'NGN','987654');
 if (select count(*) from public.ledger_transactions where idempotency_key in('paystack-charge:'||ref,'rent-route:'||p.id))<>before_count then raise exception 'FAIL: duplicate receipt credited rent twice';end if;
 perform public.record_verified_rent_settlement(p.id,'778899','987654','987123',13500000,'NGN','test',repeat('c',64));
 perform public.record_verified_rent_settlement(p.id,'778899','987654','987123',13500000,'NGN','test',repeat('c',64));
 if (select total_contributed<>150000 or total_paid_out<>135000 from public.rent_plans where reservation_id='rent-agreement-monthly') then raise exception 'FAIL: gross rent credit and net paid out do not reconcile';end if;
 if (select count(*) from public.ledger_transactions where idempotency_key='rent-settlement:'||p.id)<>1 then raise exception 'FAIL: duplicate settlement paid twice';end if;
end $cycle$;
select set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000004","session_id":"b7990000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
do $credit$
declare history jsonb;y jsonb;receipt jsonb;
begin
 history:=public.get_my_later_rent_history('rent-agreement-monthly');y:=history#>'{years,0}';
 if (y->>'completed_months')::integer<>1 or (y->>'partial_month_credit')::numeric<>50000 or (y->>'next_month_balance')::numeric<>50000
  or (y->>'gross_rent_paid')::numeric<>150000 or (y->>'remaining_year_rent')::numeric<>1050000 then raise exception 'FAIL: one of eight payments did not fund 1.5 months';end if;
 if history#>>'{items,0,settlement_status}'<>'settled' or history#>>'{items,0,payment_status}'<>'paid' then raise exception 'FAIL: paid/settled history did not reconcile';end if;
 receipt:=public.get_my_payment_receipts(current_setting('test.later_rent_reference'))->0;
 if receipt->>'rent_target_year'<>'2' or receipt->>'rent_payment_protection_hold'<>'false' or receipt->>'rent_settlement_status'<>'settled'
  or receipt->>'description'<>'Later-year rent' or receipt->>'booking_id'<>'rent-agreement-monthly' then raise exception 'FAIL: receipt lost its rent year, settlement rules or exact booking';end if;
 begin perform public.cancel_my_apartment_reservation('rent-agreement-monthly');raise exception 'FAIL: occupied tenancy cancelled without agreed exit';exception when raise_exception then if sqlerrm not like 'Reservation can no longer%' then raise;end if;end;
end $credit$;
reset role;
select set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000001","session_id":"b7990000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$begin
 if public.get_my_later_rent_history('rent-agreement-monthly')->>'viewer'<>'partner' then raise exception 'FAIL: owner cannot reconcile tenant rent';end if;
 if jsonb_array_length(public.get_my_property_later_rent_accounts('b7990000-2000-4000-8000-000000000003')->'items')<>1 then raise exception 'FAIL: owner rent account is not connected';end if;
end $$;
reset role;
-- Optional automatic debit is a separate tenant choice. Source payment,
-- canonical obligation, dispatch claim and disabling are exercised without PSP traffic.
set local session_replication_role=replica;
update public.reservations set tenancy_start_date=((now() at time zone 'Africa/Lagos')::date-interval '5 months')::date where id='rent-agreement-monthly';
update public.rent_plans set tenancy_start_date=((now() at time zone 'Africa/Lagos')::date-interval '5 months')::date where reservation_id='rent-agreement-monthly';
update public.rent_plan_contributions c set due_date=(p.tenancy_start_date+make_interval(months=>c.agreement_sequence+2))::date
 from public.rent_plans p where p.id=c.rent_plan_id and c.reservation_id='rent-agreement-monthly';
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000004","session_id":"b7990000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
do $$declare h jsonb;prepared jsonb;begin
 h:=public.get_my_later_rent_history('rent-agreement-monthly');
 if public.get_my_later_rent_debit('rent-agreement-monthly')->>'status'<>'manual' then raise exception 'FAIL: automatic debit enabled by default';end if;
 if has_table_privilege('authenticated','private.later_rent_debit','select') or has_function_privilege('authenticated','private.create_later_rent_payment(uuid,text)','execute') then raise exception 'FAIL: private debit secrets or constructor exposed';end if;
 begin perform public.prepare_my_later_rent_debit('rent-agreement-monthly',h->>'agreement_digest',false);raise exception 'FAIL: automatic debit without consent';exception when raise_exception then if sqlerrm not like 'Explicit consent%' then raise;end if;end;
 prepared:=public.prepare_my_later_rent_debit('rent-agreement-monthly',h->>'agreement_digest',true);
 perform set_config('test.auto_consent',prepared->>'consent_id',true);
 if prepared->>'source_reference' is distinct from current_setting('test.later_rent_reference') then raise exception 'FAIL: automatic debit source is not the tenant verified payment';end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$declare job jsonb;consent uuid:=current_setting('test.auto_consent')::uuid;begin
 perform public.bind_verified_later_rent_debit(consent,current_setting('test.later_rent_reference'),'AUTH_SyntheticOnly','rent-customer@example.invalid','0123','Visa','test',(current_date+interval '1 year')::date);
 job:=public.claim_due_later_rent_debit();
 if job->>'attempted'<>'false' or (job->>'amount_minor')::numeric<>15000000 then raise exception 'FAIL: automatic job did not reuse the exact due obligation';end if;
 perform set_config('test.auto_payment_id',job->>'payment_id',true);
 if not public.start_later_rent_debit_split(consent,(job->>'payment_id')::uuid) or public.start_later_rent_debit_split(consent,(job->>'payment_id')::uuid) then raise exception 'FAIL: duplicate provider split creation claim';end if;
 if not public.save_later_rent_debit_split(consent,(job->>'payment_id')::uuid,'SPL_SyntheticOnly') then raise exception 'FAIL: split receipt not saved';end if;
 if not public.authorize_later_rent_debit_dispatch(consent,(job->>'payment_id')::uuid) or public.authorize_later_rent_debit_dispatch(consent,(job->>'payment_id')::uuid) then raise exception 'FAIL: duplicate debit dispatch grant';end if;
 update private.later_rent_debit set lease_until=null,next_check_at=now()-interval '1 minute' where consent_id=consent;
 job:=public.claim_due_later_rent_debit();if job->>'attempted'<>'true' then raise exception 'FAIL: lost response allowed a second debit';end if;
 if (select count(*) from public.activity_events where event_type='rent.debit.sent' and subject_id='rent-agreement-monthly')<>1 then raise exception 'FAIL: automatic payment Activity repeated or was missing';end if;
 if not exists(select 1 from public.activity_events where event_type='rent.debit.active' and route='my_reservations' and route_params->>'reservation_id'='rent-agreement-monthly') then raise exception 'FAIL: automatic payment Activity lost the exact reservation';end if;
end $$;
select set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000004","session_id":"b7990000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
do $$declare status jsonb;h jsonb;begin
 status:=public.get_my_later_rent_debit('rent-agreement-monthly');
 if status->>'status'<>'active' or status->>'last4'<>'0123' or status ? 'authorization_code' or status ? 'email' then raise exception 'FAIL: card mask or private authorization boundary';end if;
 h:=public.get_my_later_rent_history('rent-agreement-monthly');
 if h#>>'{items,1,can_pay}'<>'false' then raise exception 'FAIL: automatic in-flight payment also offered manual checkout';end if;
 status:=public.disable_my_later_rent_debit('rent-agreement-monthly');
 if status->>'status'<>'disabled' or status->>'payment_pending'<>'true' then raise exception 'FAIL: disabling erased an in-flight charge';end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$declare consent uuid:=current_setting('test.auto_consent')::uuid;payment uuid:=current_setting('test.auto_payment_id')::uuid;begin
 if public.authorize_later_rent_debit_dispatch(consent,payment) then raise exception 'FAIL: disabled mandate authorized another debit';end if;
 perform public.finish_later_rent_debit_check(consent,payment,'pending');
 if (select status from public.booking_payments where id=payment)<>'pending' then raise exception 'FAIL: unknown payment became terminal or paid';end if;
 perform public.finish_later_rent_debit_check(consent,payment,'failed');
 if not exists(select 1 from public.booking_payments where id=payment and status='failed') then raise exception 'FAIL: terminal failed payment was not retained';end if;
 if exists(select 1 from private.later_rent_debit where consent_id=consent and (authorization_code is not null or email is not null)) then raise exception 'FAIL: disabled mandate retained charge credentials';end if;
end $$;
select set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000004","session_id":"b7990000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
do $$declare c uuid;payment jsonb;h jsonb;begin
 select id into c from public.rent_plan_contributions where reservation_id='rent-agreement-monthly' and agreement_sequence=3;
 payment:=public.create_rent_plan_contribution_payment(c);
 if payment->>'success'<>'true' then raise exception 'FAIL: verified failed automatic debit did not restore manual payment';end if;
 h:=public.get_my_later_rent_history('rent-agreement-monthly');
 if (h#>>'{years,0,gross_rent_paid}')::numeric<>150000 then raise exception 'FAIL: failed automatic debit created rent credit';end if;
end $$;
reset role;
select 'Long Let agreement, protected initial rent, direct collection, credit, settlement and consented debit recovery passed' as result;
rollback;
