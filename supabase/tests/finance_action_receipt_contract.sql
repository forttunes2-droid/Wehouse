begin;
create function pg_temp.expect(value boolean,description text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAIL: %',description;end if;end$$;
create function pg_temp.rejects(statement text) returns boolean language plpgsql as $$begin execute statement;return false;exception when others then return true;end$$;
grant execute on function pg_temp.expect(boolean,text),pg_temp.rejects(text) to authenticated,service_role;
do $$
declare actors jsonb:='{}'; actor jsonb; kind text; au uuid; sess uuid; person text;
 wallet uuid:=gen_random_uuid(); withdrawal uuid:=gen_random_uuid(); receipt jsonb; replay jsonb;
 protection uuid:=gen_random_uuid(); stale_action uuid:=gen_random_uuid(); fresh_action uuid:=gen_random_uuid(); pending_action uuid:=gen_random_uuid(); recovered integer;
begin
 for kind in select unnest(array['owner','creator','finance','other_branch','orphan','outsider']) loop
  au:=gen_random_uuid();sess:=gen_random_uuid();person:='finance-check-'||au;
  insert into auth.users(id,aud,role,email,created_at,updated_at) values(au,'authenticated','authenticated',au||'@example.invalid',now(),now());
  insert into public.profiles(auth_id,email,user_id,role,profile_complete,full_name,state,city,local_government)
   values(au,au||'@example.invalid',person,'user',true,'Finance check','Nasarawa','Lafia','Lafia');
  insert into auth.sessions(id,user_id,created_at,updated_at) values(sess,au,now(),now());
  insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status)
   values(person,au,sess,'check-'||au,'Browser',true,'trusted');
  if kind in ('finance','other_branch') then
   insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,scope_state,scope_lga) values
    (person,'staff','branch','Nasarawa',case when kind='other_branch' then 'Karu' else 'Lafia' end),
    (person,'finance_operations','branch','Nasarawa',case when kind='other_branch' then 'Karu' else 'Lafia' end);
  elsif kind='orphan' then
   insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,scope_state,scope_lga) values(person,'finance_operations','branch','Nasarawa','Lafia');
  elsif kind in ('creator','owner') then
   insert into public.workspace_role_assignments(user_id,workspace_role,scope_type) values(person,case when kind='creator' then 'creator' else 'worker' end,'global');
  end if;
  actors:=actors||jsonb_build_object(kind,jsonb_build_object('auth',au,'session',sess,'person',person));
 end loop;
 insert into public.wallets(id,owner_id,owner_type,available_balance,pending_balance,frozen_balance,total_withdrawn)
 values(wallet,actors->'owner'->>'person','worker',0,0,100,0);
 insert into public.withdrawals(id,wallet_id,amount,status,payout_recipient_code)
 values(withdrawal,wallet,100,'awaiting_review','RCP_contract');
 insert into public.payment_protection_transactions(id,booking_type,payer_user_id,payee_user_id,amount_total,amount_commission,amount_payee,commission_rate,status,protection_state,subject_type,subject_id,paystack_reference)
 values(protection,'worker_booking',actors->'owner'->>'person',actors->'owner'->>'person',100,0,100,0,'risk_held','risk_held','worker_booking',gen_random_uuid()::text,'RECOVERY-'||protection);
 insert into public.financial_action_outbox(financial_action_id,action_type,subject_type,subject_id,payment_protection_id,amount,idempotency_key,status,claimed_at,claimed_by)
 values(stale_action,'refund_worker_review','worker_booking','recovery-stale',protection,10,'recovery-stale-'||stale_action,'processing',now()-interval '20 minutes','interrupted-fixture'),
 (fresh_action,'refund_worker_review','worker_booking','recovery-fresh',protection,10,'recovery-fresh-'||fresh_action,'processing',now(),'active-fixture'),
 (pending_action,'refund_worker_review','worker_booking','recovery-pending',protection,10,'recovery-pending-'||pending_action,'pending',null,null);
 for kind in select unnest(array['creator','finance','other_branch','orphan','outsider']) loop
  actor:=actors->kind;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor->>'auth','session_id',actor->>'session','role','authenticated')::text,true);
  execute 'set local role authenticated';
  if kind in ('creator','finance','other_branch') then
   receipt:=public.get_my_staff_finance_queue();
   perform pg_temp.expect(receipt->>'actor_role'=case when kind='creator' then 'creator' else 'staff' end,'queue returns canonical role from active grants despite Personal profile role');
   perform pg_temp.expect(exists(select 1 from jsonb_array_elements(receipt->'withdrawals')x where x->>'id'=withdrawal::text)=(kind<>'other_branch'),'finance queue respects geographic coverage');
   perform pg_temp.expect(exists(select 1 from jsonb_array_elements(receipt->'financial_actions')x where x->>'id'=stale_action::text)=(kind<>'other_branch'),'financial actions use the same scoped Finance authority');
  else
   perform pg_temp.expect(pg_temp.rejects('select public.get_my_staff_finance_queue()'),'orphan domain and ordinary account cannot read finance queue');
  end if;
  perform pg_temp.expect(pg_temp.rejects(format('select public.claim_withdrawal_for_payout(%L,%L)',withdrawal,actor->>'person')),'browser roles cannot call the service payout writer');
  perform pg_temp.expect(pg_temp.rejects('select public.recover_stale_financial_actions(100)'),'browser roles cannot recover service claims');
  perform pg_temp.expect(pg_temp.rejects('select public.claim_due_refund_reconciliations(2)'),'browser roles cannot claim provider checks');
  if kind in ('creator','finance') then
   receipt:=public.get_my_financial_action_reconciliation(stale_action);
   perform pg_temp.expect(receipt->>'financial_action_id'=stale_action::text,'in-scope Finance can inspect the exact reconciliation target');
  else
   perform pg_temp.expect(pg_temp.rejects(format('select public.get_my_financial_action_reconciliation(%L)',stale_action)),'out-of-scope and ordinary accounts cannot inspect a reconciliation target');
  end if;
  perform pg_temp.expect(pg_temp.rejects(format('select public.process_verified_paystack_refund_lookup(%L,%L,%L,%L,%L,now(),1000,%L)',stale_action,'987654','pending','RECOVERY-'||protection,repeat('d',64),'NGN')),'browser cannot write provider lookup proof');
  execute 'reset role';
 end loop;
 actor:=actors->'creator';
 perform set_config('request.jwt.claim.role','service_role',true);
 execute 'set local role service_role';
 recovered:=public.recover_stale_financial_actions(100);
 perform pg_temp.expect(recovered>=1,'interrupted action enters manual review');
 perform pg_temp.expect((select status='manual_review' and metadata ? 'stale_claim_recovered_at' from public.financial_action_outbox where financial_action_id=stale_action),'recovery preserves an audit marker');
 perform pg_temp.expect((select status='processing' from public.financial_action_outbox where financial_action_id=fresh_action),'fresh claim is not recovered');
 perform pg_temp.expect(public.recover_stale_financial_actions(100)=0,'recovery retry does not recover the same action twice');
 update public.financial_action_outbox set status='manual_review' where financial_action_id=fresh_action;
 perform public.claim_financial_actions('recovery-contract',50);
 perform pg_temp.expect((select status='pending' from public.financial_action_outbox where financial_action_id=pending_action),'uncertain refund blocks another refund for the same protection');
 update public.financial_action_outbox set attempt_count=1 where financial_action_id in(stale_action,fresh_action);
 receipt:=public.process_verified_paystack_refund_event('recovery-event-'||stale_action,'refund.pending','RECOVERY-'||protection,null,'987654',repeat('a',64),now(),1000,'NGN');
 perform pg_temp.expect((receipt->>'success')::boolean=false,'ambiguous late refund must remain unresolved');
 update public.financial_action_outbox set attempt_count=0 where financial_action_id=fresh_action;
 receipt:=public.process_verified_paystack_refund_event('recovery-event-'||stale_action,'refund.pending','RECOVERY-'||protection,null,'987654',repeat('a',64),now(),1000,'NGN');
 perform pg_temp.expect((receipt->>'success')::boolean and receipt->>'financial_action_id'=stale_action::text,'verified late event recovers the unique attempted manual-review refund');
 perform pg_temp.expect((select status='provider_pending' and provider_action_id='987654' from public.financial_action_outbox where financial_action_id=stale_action),'late receipt binds the provider ID without resubmission');
 receipt:=to_jsonb(public.record_refund_provider_submission(stale_action,'987654','pending',repeat('c',64)));
 perform pg_temp.expect(receipt->>'financial_action_id'=stale_action::text and receipt->>'status'='provider_pending','submission response after webhook reuses its bound receipt');
 perform pg_temp.expect(pg_temp.rejects(format('select public.record_refund_provider_submission(%L,%L,%L,%L)',stale_action,'different-refund','pending',repeat('c',64))),'different refund ID cannot replace a bound provider receipt');
 replay:=public.process_verified_paystack_refund_event('recovery-event-'||stale_action,'refund.pending','RECOVERY-'||protection,null,'987654',repeat('a',64),now(),1000,'NGN');
 perform pg_temp.expect((replay->>'already_processed')::boolean,'signed-event replay does not apply twice');
 perform pg_temp.expect(pg_temp.rejects(format('select public.process_verified_paystack_refund_event(%L,%L,%L,null,%L,%L,null,1000,%L)','missing-proof-'||stale_action,'refund.pending','RECOVERY-'||protection,'987654',repeat('b',64),'NGN')),'missing signature-verification time is rejected');
 receipt:=public.process_verified_paystack_refund_lookup(stale_action,'987654','processing','RECOVERY-'||protection,repeat('d',64),now(),1000,'NGN');
 perform pg_temp.expect((receipt->>'success')::boolean and receipt->>'financial_action_id'=stale_action::text,'provider API lookup uses the canonical refund processor');
 perform pg_temp.expect(exists(select 1 from public.verified_provider_events where provider_event_key='api-refund:987654:'||repeat('d',64) and verification_method='provider_api' and signature_verified_at is null and api_verified_at is not null),'API lookup is not falsely recorded as a signed webhook');
 perform pg_temp.expect(exists(select 1 from public.verified_provider_events where provider_event_key='recovery-event-'||stale_action and verification_method='signed_webhook' and signature_verified_at is not null and api_verified_at is null),'webhook signature proof is retained separately');
 update public.financial_action_outbox set reconciliation_due_at=now()-interval '1 minute' where financial_action_id=stale_action;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into receipt from public.claim_due_refund_reconciliations(2)x;
 perform pg_temp.expect(exists(select 1 from jsonb_array_elements(receipt)x where x->>'financial_action_id'=stale_action::text),'due refund is claimed for bounded provider reconciliation');
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into replay from public.claim_due_refund_reconciliations(2)x;
 perform pg_temp.expect(not exists(select 1 from jsonb_array_elements(replay)x where x->>'financial_action_id'=stale_action::text),'another worker cannot claim the same active lookup lease');
 perform public.record_refund_reconciliation_failure(stale_action);
 perform pg_temp.expect((select status='provider_pending' and reconciliation_due_at>now() from public.financial_action_outbox where financial_action_id=stale_action),'unknown provider lookup preserves state and defers retry');
 perform public.post_ledger_transaction('recovery-funding-'||protection,'provider_charge','NGN','worker_booking',protection::text,null,'{}',jsonb_build_array(
   jsonb_build_object('account_key','asset:paystack_clearing:NGN','account_class','asset','amount',100),
   jsonb_build_object('account_key','liability:payment_protection:'||protection,'account_class','liability','owner_type','worker_booking','owner_id',protection::text,'amount',-100)));
 receipt:=public.process_verified_paystack_refund_lookup(stale_action,'987654','processed','RECOVERY-'||protection,repeat('e',64),now(),1000,'NGN');
 perform pg_temp.expect((receipt->>'success')::boolean and receipt->>'status'='completed','verified processed lookup completes the refund through the canonical ledger');
 perform pg_temp.expect((select refunded_amount=10 from public.payment_protection_transactions where id=protection),'only the verified refund amount is applied');
 replay:=public.process_verified_paystack_refund_lookup(stale_action,'987654','processed','RECOVERY-'||protection,repeat('e',64),now(),1000,'NGN');
 perform pg_temp.expect((replay->>'success')::boolean and (select refunded_amount=10 from public.payment_protection_transactions where id=protection),'provider lookup replay cannot refund twice');
 perform pg_temp.expect((select count(*)=1 from public.ledger_transactions where transaction_type='provider_refund' and metadata->>'financial_action_id'=stale_action::text),'one canonical refund ledger transaction exists');
 perform pg_temp.expect(pg_temp.rejects(format('select public.process_verified_paystack_refund_lookup(%L,%L,%L,%L,%L,now(),1000,%L)',fresh_action,'987654','processed','RECOVERY-'||protection,repeat('f',64),'NGN')),'one provider refund cannot satisfy two obligations');
 receipt:=public.claim_withdrawal_for_payout(withdrawal,actor->>'person');
 replay:=public.claim_withdrawal_for_payout(withdrawal,actor->>'person');
 perform pg_temp.expect(receipt->>'reference' ~ '^whp-[a-f0-9]{32}$','new transfer reference follows provider lowercase format');
 perform pg_temp.expect(replay->>'reference'=receipt->>'reference' and (replay->>'already_claimed')::boolean,'duplicate claim preserves the same transfer reference');
 execute 'reset role';
 perform pg_temp.expect((select frozen_balance=100 and available_balance=0 from public.wallets where id=wallet),'claim and its retry preserve held funds');
 perform set_config('request.jwt.claim.role','authenticated',true);
 actor:=actors->'creator';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor->>'auth','session_id',actor->>'session','role','authenticated')::text,true);
 execute 'set local role authenticated';
 perform pg_temp.expect(public.creator_set_worker_pro_setting('worker_pro_monthly_price_ngn','12.50'),'canonical Creator grant can configure Service Pro despite Personal compatibility role');
 perform pg_temp.expect(public.creator_set_partner_pro_setting('partner_pro_monthly_price_ngn','12.50'),'same canonical Creator configures Partner Pro');
 perform pg_temp.expect(pg_temp.rejects($q$select public.creator_set_worker_pro_setting('worker_pro_monthly_price_ngn','12.501')$q$),'Service Pro rejects a sub-minor price');
 perform pg_temp.expect(pg_temp.rejects($q$select public.creator_set_partner_pro_setting('partner_pro_monthly_price_ngn','12.501')$q$),'Partner Pro rejects a sub-minor price');
 execute 'reset role';
 update public.user_sessions set is_active=false where user_id=actor->>'person';
 execute 'set local role authenticated';
 perform pg_temp.expect(pg_temp.rejects($q$select public.creator_set_worker_pro_setting('worker_pro_monthly_price_ngn','13')$q$),'revoked Creator device cannot configure Service Pro');
 perform pg_temp.expect(pg_temp.rejects($q$select public.creator_set_partner_pro_setting('partner_pro_monthly_price_ngn','13')$q$),'revoked Creator device cannot configure Partner Pro');
 execute 'reset role';
 actor:=actors->'finance';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor->>'auth','session_id',actor->>'session','role','authenticated')::text,true);
 update public.user_sessions set is_active=false where user_id=actor->>'person';
 execute 'set local role authenticated';
 perform pg_temp.expect(pg_temp.rejects('select public.get_my_staff_finance_queue()'),'revoked device cannot load finance queue');
 execute 'reset role';
end $$;
do $$
declare protection uuid:=gen_random_uuid(); first_action uuid:=gen_random_uuid(); second_action uuid:=gen_random_uuid(); receipt jsonb;
begin
 insert into public.payment_protection_transactions(id,booking_type,payer_user_id,payee_user_id,amount_total,amount_commission,amount_payee,commission_rate,status,protection_state,subject_type,subject_id,paystack_reference)
 values(protection,'worker_booking','claim-contract','claim-contract',100,0,100,0,'risk_held','risk_held','worker_booking',gen_random_uuid()::text,'CLAIM-'||protection);
 insert into public.financial_action_outbox(financial_action_id,action_type,subject_type,subject_id,payment_protection_id,amount,idempotency_key,status,available_at,created_at)
 values(first_action,'refund_worker_review','worker_booking','claim-first',protection,10,'claim-'||first_action,'pending',now()-interval '2 minutes',now()-interval '2 minutes'),
 (second_action,'refund_worker_review','worker_booking','claim-second',protection,10,'claim-'||second_action,'pending',now()-interval '1 minute',now()-interval '1 minute');
 perform set_config('request.jwt.claim.role','service_role',true);
 execute 'set local role service_role';
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into receipt from public.claim_financial_actions('same-payment-contract',50)x;
 perform pg_temp.expect((select count(*)=1 from jsonb_array_elements(receipt)x where x->>'payment_protection_id'=protection::text),'one batch claims only one action for a protected payment');
 perform pg_temp.expect(exists(select 1 from jsonb_array_elements(receipt)x where x->>'financial_action_id'=first_action::text),'oldest due action is selected first');
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into receipt from public.claim_financial_actions('competing-worker-contract',50)x;
 perform pg_temp.expect(not exists(select 1 from jsonb_array_elements(receipt)x where x->>'payment_protection_id'=protection::text),'a processing effect blocks another effect on the same protected payment');
 execute 'reset role';
 perform pg_temp.expect((select status='pending' and attempt_count=0 from public.financial_action_outbox where financial_action_id=second_action),'the second action remains unattempted');
end $$;
rollback;
select 'Finance role, scope, session, service-only claim and stable reference checks passed; fixtures rolled back' as result;
