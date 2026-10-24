-- Provider-event fixtures only; this does not contact a billing provider.
begin;
create function pg_temp.expect(value boolean,description text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %',description;end if;end $$;
create function pg_temp.rejects(statement text) returns boolean language plpgsql as $$
begin execute statement;return false;exception when others then return true;end $$;
do $$
declare auth_one uuid:=gen_random_uuid(); auth_two uuid:=gen_random_uuid(); owner_one text; owner_two text;
 event_key text:='replay-contract-'||gen_random_uuid(); conflict_key text:='conflict-contract-'||gen_random_uuid(); receipt jsonb;
 subscription_snapshot jsonb; happened timestamptz:=now(); finish timestamptz:=now()+interval '1 month';
begin
 owner_one:='subscription-check-'||auth_one;owner_two:='subscription-check-'||auth_two;
 insert into auth.users(id,aud,role,email,created_at,updated_at) values
  (auth_one,'authenticated','authenticated',auth_one||'@example.invalid',now(),now()),
  (auth_two,'authenticated','authenticated',auth_two||'@example.invalid',now(),now());
 insert into public.profiles(auth_id,email,user_id,role,profile_complete,full_name) values
  (auth_one,auth_one||'@example.invalid',owner_one,'user',true,'Subscription check one'),
  (auth_two,auth_two||'@example.invalid',owner_two,'user',true,'Subscription check two');
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 receipt:=public.record_worker_pro_subscription_event(owner_one,'paystack','fixture-plan',null,event_key,'charge.success','active',happened,happened,finish,false,true,42,'NGN','sandbox',repeat('b',64),'{"billing_period":"monthly"}');
 perform pg_temp.expect(receipt->>'success'='true','initial verified event accepted');
 select to_jsonb(s) into subscription_snapshot from public.worker_pro_subscriptions s where worker_id=owner_one;
 receipt:=public.record_worker_pro_subscription_event(owner_one,'paystack','fixture-plan',null,event_key,'charge.success','active',happened,happened,finish,false,true,42,'NGN','sandbox',repeat('b',64),'{"billing_period":"monthly"}');
 perform pg_temp.expect(receipt->>'success'='true' and receipt->>'duplicate'='true','identical receipt retry acknowledged');
 perform pg_temp.expect(pg_temp.rejects(format('select public.record_worker_pro_subscription_event(%L,''paystack'',''fixture-plan'',null,%L,''charge.success'',''active'',%L,%L,%L,false,true,42,''NGN'',''sandbox'',%L,''{"billing_period":"monthly"}'')',owner_one,event_key,happened,happened,finish,repeat('c',64))),'changed payload cannot reuse a provider event ID');
 perform pg_temp.expect(pg_temp.rejects(format('select public.record_worker_pro_subscription_event(%L,''paystack'',''fixture-plan'',null,%L,''charge.success'',''active'',%L,%L,%L,false,true,42,''NGN'',''sandbox'',%L,''{"billing_period":"monthly"}'')',owner_two,event_key,happened,happened,finish,repeat('b',64))),'another account cannot reuse a provider event ID');
 perform pg_temp.expect(pg_temp.rejects(format('select public.record_worker_pro_subscription_event(%L,''paystack'',''fixture-plan'',null,%L,''charge.success'',''active'',%L,%L,%L,false,true,42,''NGN'',''sandbox'',%L,''{"billing_period":"monthly"}'')',owner_one,event_key,happened,happened,finish+interval '1 day',repeat('b',64))),'changed entitlement period cannot reuse a provider event ID');
 perform pg_temp.expect((select to_jsonb(s)=subscription_snapshot from public.worker_pro_subscriptions s where worker_id=owner_one),'retry and rejected replays do not mutate the existing entitlement');
 perform pg_temp.expect(not exists(select 1 from public.worker_pro_subscriptions where worker_id=owner_two),'cross-account replay creates no entitlement');
 receipt:=public.record_worker_pro_subscription_event(owner_one,'apple','fixture-plan',null,conflict_key,'charge.success','active',happened,happened,finish,false,true,42,'NGN','sandbox',repeat('d',64),'{"billing_period":"monthly"}');
 perform pg_temp.expect(receipt->>'success'='false' and receipt->>'conflict'='true','active provider cannot be replaced by another billing provider');
 receipt:=public.record_worker_pro_subscription_event(owner_one,'apple','fixture-plan',null,conflict_key,'charge.success','active',happened,happened,finish,false,true,42,'NGN','sandbox',repeat('d',64),'{"billing_period":"monthly"}');
 perform pg_temp.expect(receipt->>'success'='false' and receipt->>'conflict'='true' and receipt->>'requires_review'='true','retry of a conflict remains a conflict rather than success');
 perform pg_temp.expect((select count(*)=2 from public.worker_pro_subscription_events where worker_id=owner_one),'one canonical record for each original provider event');
 perform pg_temp.expect((select to_jsonb(s)=subscription_snapshot from public.worker_pro_subscriptions s where worker_id=owner_one),'conflict retry preserves the authoritative entitlement');
 receipt:=public.record_worker_pro_subscription_event(owner_one,'paystack','fixture-plan',null,event_key||'-old','subscription.disable','cancelled',happened-interval '1 day',happened-interval '1 day',finish,false,false,42,'NGN','sandbox',repeat('e',64),'{"billing_period":"monthly"}');
 perform pg_temp.expect(receipt->>'success'='true' and receipt->>'ignored'='true','older provider event is recorded without replacing the newer entitlement');
 receipt:=public.record_worker_pro_subscription_event(owner_one,'paystack','fixture-plan',null,event_key||'-old','subscription.disable','cancelled',happened-interval '1 day',happened-interval '1 day',finish,false,false,42,'NGN','sandbox',repeat('e',64),'{"billing_period":"monthly"}');
 perform pg_temp.expect(receipt->>'success'='true' and receipt->>'duplicate'='true' and receipt->>'ignored'='true','replayed old event remains ignored');
 perform pg_temp.expect((select to_jsonb(s)=subscription_snapshot from public.worker_pro_subscriptions s where worker_id=owner_one),'old event and retry do not change the authoritative entitlement');
 perform pg_temp.expect(not has_function_privilege('authenticated','public.record_worker_pro_subscription_event(text,text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,boolean,boolean,numeric,text,text,text,jsonb)','execute'),'customers cannot write provider subscription events');
 perform pg_temp.expect(not has_function_privilege('anon','public.record_worker_pro_subscription_event(text,text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,boolean,boolean,numeric,text,text,text,jsonb)','execute'),'anonymous callers cannot write provider subscription events');
end $$;
select 'Subscription receipt identity, replay, provider-conflict and unchanged-entitlement checks passed; fixtures rolled back' as result;
rollback;
