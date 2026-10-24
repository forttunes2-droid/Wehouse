\set ON_ERROR_STOP on
begin;
create function pg_temp.expect(value boolean, description text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAILED: %', description; end if; end $$;
grant execute on function pg_temp.expect(boolean,text) to authenticated,anon,service_role;
create function pg_temp.rejects(statement text) returns boolean language plpgsql as $$
begin execute statement; return false; exception when others then return true; end $$;
grant execute on function pg_temp.rejects(text) to authenticated,anon,service_role;

set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete) values
('98100000-0000-4000-8000-000000000001','wr-cust@example.invalid','wr-cust','user',true),
('98100000-0000-4000-8000-000000000002','wr-other@example.invalid','wr-other','user',true),
('98100000-0000-4000-8000-000000000003','wr-admin@example.invalid','wr-admin','admin',true),
('98100000-0000-4000-8000-000000000004','wr-staff@example.invalid','wr-staff','staff',true),
('98100000-0000-4000-8000-000000000005','wr-creator@example.invalid','wr-creator','creator',true);
insert into auth.sessions(id,user_id,created_at,updated_at)
select auth_id::uuid,auth_id::uuid,now(),now() from public.profiles
where user_id in('wr-cust','wr-other','wr-admin','wr-staff','wr-creator');
insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status)
select user_id,auth_id,auth_id,'refund-contract-'||user_id,'Synthetic contract browser',true,'trusted'
from public.profiles where user_id in('wr-cust','wr-other','wr-admin','wr-staff','wr-creator');
create function pg_temp.wr_actor(actor uuid) returns text language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',actor,'session_id',actor,'role','authenticated')::text,true)
$$;
grant execute on function pg_temp.wr_actor(uuid) to authenticated;
insert into public.payment_protection_transactions(id,booking_type,payer_user_id,payee_user_id,amount_total,amount_commission,amount_payee,commission_rate,status,protection_state,subject_type,subject_id,paystack_reference) values
('98100000-1000-4000-8000-000000000001','worker_booking','wr-cust','wr-worker',10000,800,9200,8,'protected','protected','worker_booking','a','WR-A'),
('98100000-1000-4000-8000-000000000002','worker_booking','wr-cust','wr-worker',10000,800,9200,8,'protected','protected','worker_booking','b','WR-B');
insert into public.worker_bookings(id,user_id,worker_id,status,canonical_job_state,payment_protection_id,started_at) values
('98100000-2000-4000-8000-000000000001','wr-cust','wr-worker','confirmed','confirmed','98100000-1000-4000-8000-000000000001',null),
('98100000-2000-4000-8000-000000000002','wr-cust','wr-worker','in_progress','in_progress','98100000-1000-4000-8000-000000000002',now());
set local session_replication_role=origin;

-- Someone else cannot cancel; cancel before start refunds what was paid, once.
select pg_temp.wr_actor('98100000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.expect(pg_temp.rejects($$select public.cancel_my_worker_booking('98100000-2000-4000-8000-000000000001','changed my mind')$$),'outsider cannot cancel');
select pg_temp.wr_actor('98100000-0000-4000-8000-000000000001');
select pg_temp.expect((public.cancel_my_worker_booking('98100000-2000-4000-8000-000000000001','changed my mind')->>'refund_amount')::numeric=10000,'full refund before start');
select pg_temp.expect((public.cancel_my_worker_booking('98100000-2000-4000-8000-000000000001','changed my mind')->>'already')::boolean,'second cancel is a no-op');
select pg_temp.expect(pg_temp.rejects($$select public.cancel_my_worker_booking('98100000-2000-4000-8000-000000000002','too late')$$),'cancel after start is refused');
reset role;
select pg_temp.expect((select count(*) from public.financial_action_outbox where idempotency_key='refund_worker_cancellation:98100000-2000-4000-8000-000000000001')=1,'one refund command');
select pg_temp.expect((select protection_state from public.payment_protection_transactions where id='98100000-1000-4000-8000-000000000001')='risk_held','money held while refund runs');

-- After start: review holds the money; only operations decides; share is split.
select pg_temp.wr_actor('98100000-0000-4000-8000-000000000001');
set local role authenticated;
create temp table rv(id uuid);
grant all on rv to authenticated;
insert into rv select public.request_worker_refund_review('98100000-2000-4000-8000-000000000002','customer_cancel_after_start','Worker started but left early');
select pg_temp.expect((select public.request_worker_refund_review('98100000-2000-4000-8000-000000000002','customer_cancel_after_start','Worker started but left early'))=(select id from rv),'review request is idempotent');
select pg_temp.expect(pg_temp.rejects($$select public.decide_worker_refund((select id from rv),40,'customer is not operations')$$),'customer cannot decide');
reset role;
select pg_temp.expect((select protection_state from public.payment_protection_transactions where id='98100000-1000-4000-8000-000000000002')='disputed','money stays protected during review');
select pg_temp.wr_actor('98100000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.expect(pg_temp.rejects($$select * from public.list_worker_refund_reviews('open')$$),'Admin cannot read globally unscoped refund queue');
select pg_temp.expect(pg_temp.rejects($$select public.decide_worker_refund((select id from rv),40,'Admin is not Creator')$$),'Admin cannot decide an unscoped refund');
reset role;

select pg_temp.wr_actor('98100000-0000-4000-8000-000000000004');
set local role authenticated;
select pg_temp.expect(pg_temp.rejects($$select * from public.list_worker_refund_reviews('open')$$),'Staff cannot read globally unscoped refund queue');
select pg_temp.expect(pg_temp.rejects($$select public.decide_worker_refund((select id from rv),40,'Staff is not Creator')$$),'Staff cannot decide an unscoped refund');
reset role;

select pg_temp.wr_actor('98100000-0000-4000-8000-000000000005');
set local role authenticated;
select pg_temp.expect((select count(*) from public.list_worker_refund_reviews('open'))=1,'Creator can see the global refund queue');
select pg_temp.expect(pg_temp.rejects($$select public.decide_worker_refund((select id from rv),150,'over one hundred percent')$$),'invalid share refused');
select pg_temp.expect((public.decide_worker_refund((select id from rv),40,'Half the work was done')).refund_amount=4000,'Creator can decide partial refund');
reset role;
select pg_temp.expect((select amount from public.financial_action_outbox where action_type='release_worker_payment' and payment_protection_id='98100000-1000-4000-8000-000000000002')=6000,'rest goes to the worker');
rollback;
