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
insert into auth.sessions(id,user_id,created_at,updated_at) values
 ('b7888888-0000-4000-8000-000000000001','b7888888-0000-4000-8000-000000000001',now(),now());
insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status)
 values('commission-customer','b7888888-0000-4000-8000-000000000001','b7888888-0000-4000-8000-000000000001','commission-contract','Synthetic contract browser',true,'trusted');
insert into public.worker_bookings(id,user_id,worker_id,status,agreed_amount,service_type) values
 ('b7888888-0000-4000-8000-000000000011','commission-customer','commission-provider','waiting_payment',10000,'Cleaning'),
 ('b7888888-0000-4000-8000-000000000012','commission-customer','commission-provider','waiting_payment',10000,'Cleaning');
update public.worker_bookings set service_quote_revision=1,service_quote_accepted_revision=1,service_quote_accepted_at=now(),
 service_quote=jsonb_build_object('revision',1,'booking_id',id,'customer_id',user_id,'provider_id',worker_id,'amount',10000,'currency','NGN','customer_service_charge',0,
 'scope','Clean the agreed rooms','address','Synthetic service location','starts_at',now()+interval '14 days','timezone','Africa/Lagos',
 'cancellation',jsonb_build_object('version','service-standard-24h-v1','full_refund_until',now()+interval '13 days','late_cancellation','wehouse_review','provider_cancellation','full_refund'))
 where id in('b7888888-0000-4000-8000-000000000011','b7888888-0000-4000-8000-000000000012');
update public.creator_policy_versions set status='retired' where policy_key='commission_worker' and status='active';
insert into public.creator_policy_versions(policy_version_id,policy_key,version,value,status,effective_from,reason,checksum) values
 ('b7888888-0000-4000-8000-000000000021','commission_worker',910001,'{"percent":10}','active',now()-interval '1 minute','Rollback contract','synthetic10');
set local session_replication_role=origin;
create temp table checkout_reference(reference text);
do $$
declare first_receipt jsonb;second_receipt jsonb;receipt jsonb;ref text;before_setting text;changed boolean:=false;
begin
 perform set_config('request.jwt.claims','{"sub":"b7888888-0000-4000-8000-000000000001","session_id":"b7888888-0000-4000-8000-000000000001","role":"authenticated"}',true);
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
 perform set_config('request.jwt.claims','{"sub":"b7888888-0000-4000-8000-000000000001","session_id":"b7888888-0000-4000-8000-000000000001","role":"authenticated"}',true);
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
-- Exercise a genuine participant dispute, then restore this paid fixture so the
-- independent release assertions below retain their original starting state.
savepoint participant_dispute;
select set_config('request.jwt.claims','{"sub":"b7888888-0000-4000-8000-000000000001","session_id":"b7888888-0000-4000-8000-000000000001","role":"authenticated"}',true);
select pg_temp.expect(public.customer_raise_dispute('b7888888-0000-4000-8000-000000000011','The delivered service needs WeHouse review'),'customer can actually raise a paid job dispute');
select pg_temp.expect(exists(select 1 from public.worker_bookings b join public.payment_protection_transactions p on p.id=b.payment_protection_id where b.id='b7888888-0000-4000-8000-000000000011' and b.status='disputed' and p.protection_state='disputed'),'job and canonical protected balance both enter review');
rollback to savepoint participant_dispute;
release savepoint participant_dispute;
-- Exercise the real release projector as well as the verified-charge path.
-- The service-role fixture supplies an already authorized release action.
do $$
declare protection uuid;action_id uuid;receipt jsonb;before_balance numeric;
begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 select id into protection from public.payment_protection_transactions where paystack_reference=(select reference from checkout_reference);
 select coalesce(available_balance,0) into before_balance from public.wallets where owner_id=(select payee_user_id from public.payment_protection_transactions where id=protection) and owner_type='worker';
 before_balance:=coalesce(before_balance,0);
 perform public.transition_payment_protection(protection,'release_eligible','contract_release_authorized','checkout-release-authorized:'||protection,null,'contract_fixture',null,null,'{}');
 insert into public.financial_action_outbox(action_type,subject_type,subject_id,payment_protection_id,amount,idempotency_key,status)
 values('release_worker_payment','worker_job','b7888888-0000-4000-8000-000000000011',protection,10000,'checkout-release:'||protection,'processing') returning financial_action_id into action_id;
 receipt:=public.complete_internal_release_action(action_id);
 perform pg_temp.expect(receipt->>'success'='true','frozen Service checkout can release through the canonical projector');
 perform pg_temp.expect(exists(select 1 from public.booking_payments where paystack_reference=(select reference from checkout_reference) and amount_commission=1000 and net_amount=9000),'release preserves the accepted commission and net snapshot');
 perform pg_temp.expect(exists(select 1 from public.wallets w join public.payment_protection_transactions p on p.payee_user_id=w.owner_id where p.id=protection and w.owner_type='worker' and w.available_balance=before_balance+9000),'provider receives the accepted net in the existing Worker wallet');
 receipt:=public.complete_internal_release_action(action_id);
 perform pg_temp.expect((receipt->>'already_completed')::boolean,'release replay is a no-op');
 perform pg_temp.expect((select count(*)=1 from public.canonical_wallet_release_receipts where financial_action_id=action_id),'release retry creates one wallet receipt');
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
