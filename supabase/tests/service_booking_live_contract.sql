begin;
create function pg_temp.expect(value boolean,description text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAIL: %',description;end if;end $$;
grant execute on function pg_temp.expect(boolean,text) to authenticated;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete) values
 ('95200000-0000-4000-8000-000000000001','service-live-customer@example.invalid','service-live-customer','user',true),
 ('95200000-0000-4000-8000-000000000002','service-live-provider@example.invalid','service-live-provider','user',true);
insert into public.worker_bookings(id,user_id,worker_id,status,service_type) values
 ('95200000-0000-4000-8000-000000000010','service-live-customer','service-live-provider','negotiating','Cleaning');
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update public.worker_bookings set negotiated_amount=25000,agreed_amount=25000,status='waiting_payment',scheduled_date=current_date+1
 where id='95200000-0000-4000-8000-000000000010';
select pg_temp.expect((select count(*)=2 from realtime.messages where event='service_booking_changed' and payload->>'booking_id'='95200000-0000-4000-8000-000000000010'),'one private quote signal per participant');
select pg_temp.expect(not exists(select 1 from realtime.messages where event='service_booking_changed' and payload->>'booking_id'='95200000-0000-4000-8000-000000000010' and (not private or payload ? 'price' or payload ? 'negotiated_amount' or payload ? 'description' or payload ? 'address')),'signals expose no price, scope, address or message');
update public.worker_bookings set updated_at=now() where id='95200000-0000-4000-8000-000000000010';
select pg_temp.expect((select count(*)=2 from realtime.messages where event='service_booking_changed' and payload->>'booking_id'='95200000-0000-4000-8000-000000000010'),'unrelated update does not repeat a quote signal');
select set_config('request.jwt.claims','{"sub":"95200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect((select count(*)=1 from realtime.messages where event='service_booking_changed' and payload->>'booking_id'='95200000-0000-4000-8000-000000000010'),'customer reads only their own quote signal');
reset role;
select set_config('request.jwt.claims','{"sub":"95200000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect((select count(*)=1 from realtime.messages where event='service_booking_changed' and payload->>'booking_id'='95200000-0000-4000-8000-000000000010'),'provider reads only their own quote signal');
reset role;
select set_config('request.jwt.claims','{"sub":"95200000-0000-4000-8000-000000000099","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect(not exists(select 1 from realtime.messages where event='service_booking_changed' and payload->>'booking_id'='95200000-0000-4000-8000-000000000010'),'outsider cannot read quote signals');
reset role;
select pg_temp.expect(not has_function_privilege('authenticated','public.broadcast_service_booking_change()','EXECUTE'),'signal sender cannot be called by a customer');
update public.worker_bookings set service_quote_revision=1,service_quote='{"revision":1,"scope":"Initial agreed work"}'::jsonb
 where id='95200000-0000-4000-8000-000000000010';
select pg_temp.expect((select count(*)=4 from realtime.messages where event='service_booking_changed' and payload->>'booking_id'='95200000-0000-4000-8000-000000000010'),'new contract signals both participants without changing price');
update public.worker_bookings set service_quote=jsonb_set(service_quote,'{scope}','"Revised agreed work"')
 where id='95200000-0000-4000-8000-000000000010';
select pg_temp.expect((select count(*)=6 from realtime.messages where event='service_booking_changed' and payload->>'booking_id'='95200000-0000-4000-8000-000000000010'),'scope-only revision signals both participants');
update public.worker_bookings set service_quote_accepted_revision=1,service_quote_accepted_at=now()
 where id='95200000-0000-4000-8000-000000000010';
select pg_temp.expect((select count(*)=8 from realtime.messages where event='service_booking_changed' and payload->>'booking_id'='95200000-0000-4000-8000-000000000010'),'acceptance signals both participants');
select pg_temp.expect(not exists(select 1 from realtime.messages where event='service_booking_changed' and payload->>'booking_id'='95200000-0000-4000-8000-000000000010' and payload-'booking_id'-'id'<>'{}'::jsonb),'contract invalidation exposes only booking ID and the Realtime-generated delivery ID');
select 'service_booking_live_contract_ok' as result;
rollback;
