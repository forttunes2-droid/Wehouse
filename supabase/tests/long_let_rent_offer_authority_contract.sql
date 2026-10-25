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
insert into public.listings(id,listing_id,title,sub_type,state,city,status,availability_status,owner_id,partner_id,approved_at,management_mode,management_updated_at,management_host_user_id,price,currency,future_installments_allowed)
 values('b7990000-2000-4000-8000-000000000003','rent-monthly-home','Monthly rent home','long_stay','Rent Contract Region','Rent Contract Town','reserved','reserved','rent-owner','rent-owner',now(),'host',now(),'rent-owner',1200000,'NGN',true);
insert into public.property_host_assignments(listing_id,user_id,assignment_role,status,invited_by,accepted_at,access_level)
 values('b7990000-2000-4000-8000-000000000003','rent-owner','owner','active','rent-owner',now(),'full_hosting');
insert into public.bank_accounts(id,user_id,account_number,bank_code,bank_name,account_name,is_default,is_active,verified_at,rent_subaccount_code,rent_subaccount_provider_id,rent_subaccount_environment,rent_subaccount_verified_at)
 values('b7990000-5000-4000-8000-000000000001','rent-owner','0000000000','000','Synthetic Bank','Synthetic Owner',true,true,now(),'ACCT_contractbank','12345','test',now());
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
 receipt:=public.set_my_long_let_rent_terms('b7990000-2000-4000-8000-000000000001',1,array[12,3,6],true);
 if receipt->>'revision'<>'2' or receipt->'accepted_terms_months'<>'[3,6,12]'::jsonb or receipt->>'monthly_accepted'<>'true' then raise exception 'FAIL: owner offer was not saved';end if;
 retry:=public.set_my_long_let_rent_terms('b7990000-2000-4000-8000-000000000001',1,array[3,6,12],true);
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
 quote:=public.preview_my_long_let_agreement('rent-agreement-monthly',12,'monthly');
 if (quote->'rent_schedule'->>'due_before_handover')::numeric<>100000 then raise exception 'FAIL: monthly first amount';end if;
 perform public.accept_my_long_let_agreement('rent-agreement-monthly',12,'monthly',quote->>'quote_digest');
 checkout:=public.create_apartment_rent_payment('rent-agreement-monthly');
 if checkout->>'success'<>'true' or (checkout->>'amount')::numeric<>100000 then raise exception 'FAIL: monthly initial checkout amount';end if;
 insert into rent_contract_references values('monthly',checkout->>'reference');
end $contract$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $contract$
declare ref record;receipt jsonb;expected numeric;
begin
 for ref in select * from rent_contract_references loop
  expected:=case when ref.kind='full' then 300000 else 100000 end;
  receipt:=public.process_verified_paystack_charge('charge.success:'||ref.reference,'charge.success',ref.reference,repeat('d',64),now(),(expected*100)::bigint,'NGN',ref.reference);
  if receipt->>'success'<>'true' then raise exception 'FAIL: canonical rent confirmation %, %',receipt,(select processing_error from public.verified_provider_events where provider_reference=ref.reference limit 1);end if;
  if not exists(select 1 from public.payment_protection_transactions where paystack_reference=ref.reference and amount_total=expected and amount_commission=expected*0.1 and amount_payee=expected*0.9) then
   raise exception 'FAIL: rent Protection and commission split';end if;
 end loop;
 update public.reservations set requested_move_in_at=now()-interval '1 minute' where id in('rent-agreement-full','rent-agreement-monthly');
 if exists(select 1 from public.rent_plans where reservation_id='rent-agreement-full') then raise exception 'FAIL: full contract created unpaid future obligations';end if;
 if (select count(*) from public.rent_plan_contributions where reservation_id='rent-agreement-monthly')<>11 then raise exception 'FAIL: monthly agreement did not create eleven remaining payments';end if;
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
 if not exists(select 1 from public.rent_plan_contributions where reservation_id='rent-agreement-monthly' and installment_number=1 and target_year=1 and due_date=(start_day+interval '1 month')::date) then raise exception 'FAIL: first later monthly payment was not anchored to actual handover';end if;
 if (select sum(amount) from public.rent_plan_contributions where reservation_id='rent-agreement-monthly')<>1100000 then raise exception 'FAIL: remaining monthly amounts drifted';end if;
end $contract$;

select 'Long Let commercial authority, reviewed agreement, checkout, protected receipt and handover checks passed' as result;
rollback;
