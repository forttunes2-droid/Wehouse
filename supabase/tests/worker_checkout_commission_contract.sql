-- Synthetic checkout and provider receipts. Everything rolls back; no external charge.
begin;
create function pg_temp.expect(value boolean, description text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %',description;end if;end $$;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,worker_status,worker_verified) values
 ('b7888888-0000-4000-8000-000000000001','commission-customer@example.invalid','commission-customer','user',true,null,false),
 ('b7888888-0000-4000-8000-000000000002','commission-provider@example.invalid','commission-provider','user',true,'verified',true);
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status)
 values('commission-provider','worker','global','active');
insert into public.worker_bookings(id,user_id,worker_id,status,agreed_amount,service_type) values
 ('b7888888-0000-4000-8000-000000000011','commission-customer','commission-provider','waiting_payment',10000,'Cleaning'),
 ('b7888888-0000-4000-8000-000000000012','commission-customer','commission-provider','waiting_payment',10000,'Cleaning');
update public.creator_policy_versions set status='retired' where policy_key='commission_worker' and status='active';
insert into public.creator_policy_versions(policy_version_id,policy_key,version,value,status,effective_from,reason,checksum) values
 ('b7888888-0000-4000-8000-000000000021','commission_worker',910001,'{"percent":10}','active',now()-interval '1 minute','Rollback contract','synthetic10');
set local session_replication_role=origin;
create temp table checkout_reference(reference text);
do $$
declare first_receipt jsonb;second_receipt jsonb;receipt jsonb;ref text;before_setting text;changed boolean:=false;
begin
 perform set_config('request.jwt.claims','{"sub":"b7888888-0000-4000-8000-000000000001","role":"authenticated"}',true);
 first_receipt:=public.create_worker_booking_payment('b7888888-0000-4000-8000-000000000011');
 perform pg_temp.expect(first_receipt->>'success'='true','customer can open checkout');
 ref:=first_receipt->>'reference';
 perform pg_temp.expect(exists(select 1 from public.booking_payments where paystack_reference=ref and commission_rate=10
  and amount_commission=1000 and net_amount=9000 and commission_frozen_at is not null
  and commission_policy_version_id='b7888888-0000-4000-8000-000000000021'),'checkout freezes the original split');
 insert into checkout_reference values(ref);
end $$;
set local session_replication_role=replica;
 update public.creator_policy_versions set status='retired' where policy_version_id='b7888888-0000-4000-8000-000000000021';
 insert into public.creator_policy_versions(policy_version_id,policy_key,version,value,status,effective_from,reason,checksum) values
 ('b7888888-0000-4000-8000-000000000022','commission_worker',910002,'{"percent":20}','active',now(),'Rollback contract','synthetic20');
set local session_replication_role=origin;
do $$
declare second_receipt jsonb;receipt jsonb;ref text;before_setting text;changed boolean:=false;
begin
 select reference into ref from checkout_reference;
 perform set_config('request.jwt.claims','{"sub":"b7888888-0000-4000-8000-000000000001","role":"authenticated"}',true);
 receipt:=public.create_worker_booking_payment('b7888888-0000-4000-8000-000000000011');
 perform pg_temp.expect(receipt->>'reference'=ref and (receipt->>'existing')::boolean,'retry retains accepted checkout: '||receipt::text);
 second_receipt:=public.create_worker_booking_payment('b7888888-0000-4000-8000-000000000012');
 perform pg_temp.expect(exists(select 1 from public.booking_payments where paystack_reference=second_receipt->>'reference'
  and commission_rate=20 and amount_commission=2000 and net_amount=8000),'new checkout takes the new policy');
 begin
  update public.booking_payments set commission_rate=20 where paystack_reference=ref;
 exception when raise_exception then changed:=true;end;
 perform pg_temp.expect(changed,'accepted commission cannot be rewritten');
 update public.booking_payments set metadata=metadata||'{"contract_retry":true}'::jsonb where paystack_reference=ref;
 select value into before_setting from public.platform_settings where key='worker_commission_rate';
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 receipt:=public.process_verified_paystack_charge('charge.success:'||ref,'charge.success',ref,repeat('a',64),now(),1000000,'NGN',ref);
 perform pg_temp.expect(receipt->>'success'='true','canonical verified receipt succeeds: '||receipt::text);
 perform pg_temp.expect(exists(select 1 from public.payment_protection_transactions where paystack_reference=ref
  and amount_total=10000 and amount_commission=1000 and amount_payee=9000 and commission_rate=10),'protection uses accepted split');
 perform pg_temp.expect(exists(select 1 from public.worker_bookings where id='b7888888-0000-4000-8000-000000000011'
  and status='confirmed' and policy_version_id='b7888888-0000-4000-8000-000000000021'),'booking keeps the accepted policy');
 perform pg_temp.expect((select value is not distinct from before_setting from public.platform_settings where key='worker_commission_rate'),'receipt does not overwrite global configuration');
 receipt:=public.process_verified_paystack_charge('charge.success:'||ref,'charge.success',ref,repeat('a',64),now(),1000000,'NGN',ref);
 perform pg_temp.expect(receipt->>'success'='true','verified receipt retry succeeds');
 perform pg_temp.expect((select count(*)=1 from public.payment_protection_transactions where paystack_reference=ref),'duplicate receipt creates one protected balance');
 perform pg_temp.expect(not has_function_privilege('authenticated','public.confirm_worker_booking_payment(uuid,text,numeric,text,text)','EXECUTE'),'customer cannot directly confirm payment');
 perform pg_temp.expect(not has_function_privilege('anon','private.freeze_worker_checkout_commission()','EXECUTE'),'snapshot trigger is private');
end $$;
-- A pre-cutover receipt without an accepted snapshot remains visible for Finance.
set local session_replication_role=replica;
update public.booking_payments set commission_frozen_at=null,commission_policy_version_id=null
 where worker_booking_id='b7888888-0000-4000-8000-000000000012';
set local session_replication_role=origin;
do $$
declare ref text;receipt jsonb;
begin
 select paystack_reference into ref from public.booking_payments where worker_booking_id='b7888888-0000-4000-8000-000000000012';
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 receipt:=public.process_verified_paystack_charge('charge.success:'||ref,'charge.success',ref,repeat('b',64),now(),1000000,'NGN',ref);
 perform pg_temp.expect(receipt->>'success'='false','missing legacy snapshot cannot invent a rate');
 perform pg_temp.expect(exists(select 1 from public.verified_provider_events where provider_reference=ref
  and processing_status='failed' and processing_error like '%snapshot%'),'unresolved receipt is durable for Finance');
 perform pg_temp.expect(not exists(select 1 from public.payment_protection_transactions where paystack_reference=ref),'unresolved receipt cannot manufacture protected balance');
end $$;
select 'Service checkout commission, policy change, verification, immutability and replay checks passed' as result;
rollback;
