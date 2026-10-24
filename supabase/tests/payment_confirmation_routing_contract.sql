-- Synthetic provider receipts only. No provider API, charge or refund is sent.
begin;
create function pg_temp.expect(value boolean,description text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %',description;end if;end $$;
do $$
declare auth_id uuid:=gen_random_uuid(); person text; reference text:='routing-contract-'||gen_random_uuid(); receipt jsonb; event_key text;
begin
 person:='routing-customer-'||auth_id;
 insert into auth.users(id,aud,role,email,created_at,updated_at) values(auth_id,'authenticated','authenticated',auth_id||'@example.invalid',now(),now());
 insert into public.profiles(auth_id,email,user_id,role,profile_complete,full_name)
  values(auth_id,auth_id||'@example.invalid',person,'user',true,'Payment routing contract');
 insert into public.booking_payments(payment_reference,paystack_reference,user_id,payer_user_id,amount,amount_total,currency,status,purpose)
  values(reference,reference,person,person,42,42,'NGN','pending','other');
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 event_key:='charge.success:'||reference;
 receipt:=public.process_verified_paystack_charge(event_key,'charge.success',reference,repeat('e',64),now(),4200,'NGN',reference);
 perform pg_temp.expect(receipt->>'success'='false','unsupported purpose fails at the canonical gateway');
 perform pg_temp.expect((select status='pending' and paid_at is null from public.booking_payments where paystack_reference=reference),'failure cannot manufacture a paid booking');
 perform pg_temp.expect(exists(select 1 from public.verified_provider_events where provider_reference=reference and processing_status='failed' and processing_error like 'Unsupported payment purpose:%'),'unroutable verified receipt remains durable for Finance recovery');
 perform pg_temp.expect(not exists(select 1 from public.payment_protection_transactions where paystack_reference=reference),'failure creates no false protected balance');
 receipt:=public.process_verified_paystack_charge(event_key,'charge.success',reference,repeat('e',64),now(),4200,'NGN',reference);
 perform pg_temp.expect(receipt->>'success'='false','retry remains fail closed');
 perform pg_temp.expect((select count(*)=1 from public.verified_provider_events where provider_reference=reference),'retry preserves one canonical provider receipt');
 perform pg_temp.expect((select status='pending' from public.booking_payments where paystack_reference=reference),'retry does not advance booking state');
end $$;
select 'Unsupported-purpose gateway, durable failed receipt and retry checks passed; all fixtures rolled back' as result;
rollback;
