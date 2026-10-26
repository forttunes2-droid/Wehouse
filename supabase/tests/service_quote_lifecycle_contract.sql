-- Full synthetic Service contract lifecycle; rollback only, no provider request.
begin;
create function pg_temp.expect(ok boolean,msg text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',msg;end if;end$$;
create function pg_temp.rejects(statement text) returns boolean language plpgsql as $$begin execute statement;return false;exception when others then return true;end$$;
create function pg_temp.failure_message(statement text) returns text language plpgsql as $$begin execute statement;return null;exception when others then return sqlerrm;end$$;
create function pg_temp.actor(actor uuid) returns text language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',actor,'session_id',actor,'role','authenticated')::text,true)$$;
grant execute on function pg_temp.expect(boolean,text),pg_temp.rejects(text),pg_temp.actor(uuid) to authenticated;
grant execute on function pg_temp.failure_message(text) to authenticated;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,account_kind,full_name,state,city,local_government,worker_occupation,worker_skills,worker_status,worker_verified,available) values
('93000000-0000-4000-8000-000000000001','pub-creator@example.invalid','pub-creator','creator',true,'consumer','Creator','Nasarawa','Lafia','Lafia',null,null,null,false,false),
('93000000-0000-4000-8000-000000000002','pub-worker@example.invalid','pub-worker','user',true,'consumer','Plumber','Nasarawa','Lafia','Lafia','Plumber','["Plumbing"]','verified',true,true),
('93000000-0000-4000-8000-000000000003','pub-customer@example.invalid','pub-customer','user',true,'consumer','Customer','Nasarawa','Lafia','Lafia',null,null,null,false,false);
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status) values('pub-creator','creator','global','active'),('pub-worker','worker','global','active');
insert into public.worker_service_coverage(worker_id,state,lga,areas) values('pub-worker','Nasarawa','Keffi','{}');
insert into public.worker_verifications(worker_id,status,credential_requirements,
 credential_revision,credential_requirements_set_by,credential_requirements_set_at)
values('pub-worker','verified','[{"code":"trade","label":"Plumbing credential","requires_expiry":false}]',
 1,'pub-creator',now());
update public.worker_verifications set credential_context=private.worker_credential_context('pub-worker')
 where worker_id='pub-worker';
insert into public.worker_credential_documents(worker_id,requirement_code,requirements_revision,
 version,request_key,original_name,mime_type,byte_size,object_path,status,submitted_at,
 reviewed_at,reviewed_by,review_note)
values('pub-worker','trade',1,1,'93000000-0000-4000-8000-000000000009',
 'synthetic-publication-trade.pdf','application/pdf',12,'pub-worker/synthetic-trade.pdf',
 'approved',now(),now(),'pub-creator','Synthetic reviewed trade credential');

insert into auth.sessions(id,user_id,created_at,updated_at)
select auth_id::uuid,auth_id::uuid,now(),now() from public.profiles where user_id in('pub-worker','pub-customer','pub-creator');
insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status)
select user_id,auth_id,auth_id,'service-contract-'||user_id,'Synthetic contract browser',true,'trusted'
from public.profiles where user_id in('pub-worker','pub-customer','pub-creator');
update public.platform_settings set value='false' where key='worker_identity_checks_enabled';
insert into public.worker_bookings(id,user_id,worker_id,status,service_type,description,address)
select ('93300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'pub-customer','pub-worker','booking_requested','Plumbing','Fix kitchen sink','Synthetic agreed service address' from generate_series(1,3)n;
set local session_replication_role=origin;
create temp table refs(booking uuid,reference text);
grant all on refs to authenticated;
select pg_temp.actor('93000000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.expect(pg_temp.rejects($$select public.send_my_service_quote('93300000-0000-4000-8000-000000000001',11000,now()+interval '14 days','Africa/Lagos','Fix the sink and test for leaks')$$),'customer cannot publish a provider quote');
select pg_temp.actor('93000000-0000-4000-8000-000000000002');
select pg_temp.expect((public.send_my_service_quote('93300000-0000-4000-8000-000000000001',11000,now()+interval '14 days','Africa/Lagos','Fix the sink and test for leaks')->>'revision')::integer=1,'provider sends exact scheduled quote');
select pg_temp.expect((public.send_my_service_quote('93300000-0000-4000-8000-000000000001',11000,now()+interval '14 days','Africa/Lagos','Fix the sink and test for leaks')->>'revision')::integer=1,'quote retry is idempotent');
select pg_temp.expect(pg_temp.rejects($$select public.accept_my_service_quote('93300000-0000-4000-8000-000000000001',1)$$),'provider cannot accept for customer');
select pg_temp.actor('93000000-0000-4000-8000-000000000003');
select pg_temp.expect(pg_temp.rejects($$select public.create_worker_booking_payment('93300000-0000-4000-8000-000000000001')$$),'price alone cannot initialize checkout');
select pg_temp.expect((public.accept_my_service_quote('93300000-0000-4000-8000-000000000001',1)->>'accepted')::boolean,'customer accepts exact quote');
select pg_temp.actor('93000000-0000-4000-8000-000000000002');
select public.send_my_service_quote('93300000-0000-4000-8000-000000000001',12000,now()+interval '14 days','Africa/Lagos','Fix the sink and test for leaks');
select public.send_my_service_quote('93300000-0000-4000-8000-000000000002',12000,now()+interval '14 days','Africa/Lagos','Fix the sink and test for leaks');
select public.send_my_service_quote('93300000-0000-4000-8000-000000000003',12000,now()+interval '10 hours','Africa/Lagos','Fix the sink and test for leaks');
select pg_temp.actor('93000000-0000-4000-8000-000000000001');
select pg_temp.expect(pg_temp.rejects($$select public.accept_my_service_quote('93300000-0000-4000-8000-000000000001',2)$$),'outsider cannot accept quote');
select pg_temp.actor('93000000-0000-4000-8000-000000000003');
select pg_temp.expect(pg_temp.rejects($$select public.accept_my_service_quote('93300000-0000-4000-8000-000000000001',1)$$),'stale quote acceptance refused');
select pg_temp.expect(pg_temp.rejects($$select public.create_worker_booking_payment('93300000-0000-4000-8000-000000000001')$$),'changed quote invalidates prior acceptance');
select public.accept_my_service_quote('93300000-0000-4000-8000-000000000001',2);
select public.accept_my_service_quote('93300000-0000-4000-8000-000000000002',1);
select public.accept_my_service_quote('93300000-0000-4000-8000-000000000003',1);
insert into refs select id,(public.create_worker_booking_payment(id)->>'reference') from public.worker_bookings
where id in('93300000-0000-4000-8000-000000000001','93300000-0000-4000-8000-000000000002','93300000-0000-4000-8000-000000000003');
select pg_temp.expect((public.create_worker_booking_payment('93300000-0000-4000-8000-000000000001')->>'reference')=(select reference from refs where booking='93300000-0000-4000-8000-000000000001'),'checkout retry returns one reference');
select pg_temp.actor('93000000-0000-4000-8000-000000000002');
select pg_temp.expect(pg_temp.rejects($$select public.send_my_service_quote('93300000-0000-4000-8000-000000000001',13000,now()+interval '14 days','Africa/Lagos','Fix the sink and test for leaks')$$),'provider cannot change terms while checkout is pending');
reset role;
select pg_temp.expect((select count(*)=3 from public.booking_payments where paystack_reference in(select reference from refs) and metadata->'service_quote' is not null),'each payment preserves accepted quote');
select pg_temp.expect(pg_temp.rejects($$update public.booking_payments set metadata=metadata||'{"service_quote":null}'::jsonb where paystack_reference=(select reference from refs limit 1)$$),'accepted payment contract cannot be erased');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$declare r record;receipt jsonb;begin
 for r in select * from refs loop
  receipt:=public.process_verified_paystack_charge('charge.success:'||r.reference,'charge.success',r.reference,repeat('d',64),now(),1200000,'NGN',r.reference);
  perform pg_temp.expect(receipt->>'success'='true','verified payment becomes protected: '||receipt::text);
 end loop;
end$$;
select pg_temp.actor('93000000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.expect(position('accepted start time' in pg_temp.failure_message($$select public.worker_start_job('93300000-0000-4000-8000-000000000001')$$))>0,'provider cannot defeat cancellation protection by starting before accepted time');
select pg_temp.expect((public.provider_cancel_my_service_booking('93300000-0000-4000-8000-000000000001','Unable to attend the agreed appointment')->>'refund_amount')::numeric=12000,'provider cancellation queues full customer refund');
select pg_temp.expect((public.provider_cancel_my_service_booking('93300000-0000-4000-8000-000000000001','Unable to attend the agreed appointment')->>'already')::boolean,'provider cancellation retry is idempotent');
select pg_temp.actor('93000000-0000-4000-8000-000000000003');
select pg_temp.expect((public.cancel_my_worker_booking('93300000-0000-4000-8000-000000000002','Plans changed before deadline')->>'refund_amount')::numeric=12000,'customer cancellation before saved 24-hour deadline queues full refund');
select pg_temp.expect(pg_temp.rejects($$select public.cancel_my_worker_booking('93300000-0000-4000-8000-000000000003','Plans changed after deadline')$$),'late cancellation cannot claim automatic full refund');
select pg_temp.expect(public.request_worker_refund_review('93300000-0000-4000-8000-000000000003','customer_late_cancellation','Plans changed and I need to cancel this appointment') is not null,'late customer cancellation has an explicit protected review path');
reset role;
select pg_temp.expect((select count(*)=2 from public.financial_action_outbox where subject_id in('93300000-0000-4000-8000-000000000001','93300000-0000-4000-8000-000000000002') and action_type='refund_worker_cancellation' and amount=12000),'one full refund command per cancelled booking');
select pg_temp.expect(not exists(select 1 from public.financial_action_outbox where subject_id='93300000-0000-4000-8000-000000000003'),'late review invents no automatic deduction or refund');
select pg_temp.expect(not has_function_privilege('anon','public.accept_my_service_quote(uuid,integer)','execute'),'anonymous acceptance denied');
select pg_temp.expect(not has_function_privilege('authenticated','private.accepted_service_quote(uuid,boolean)','execute'),'private contract authority not exposed to customers');
select 'service_quote_lifecycle_contract_ok';
rollback;
