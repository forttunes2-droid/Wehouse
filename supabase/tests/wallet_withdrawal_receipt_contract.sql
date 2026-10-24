\set ON_ERROR_STOP on
begin;
-- Synthetic balances and identities exist only within this rolled-back test.
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,account_kind) values
('10100000-0000-4000-8000-000000000001','wallet-owner@example.invalid','wallet-qa-owner','worker',true,'worker'),
('10100000-0000-4000-8000-000000000002','wallet-other@example.invalid','wallet-qa-other','worker',true,'worker');
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status) values
('wallet-qa-owner','worker','global','active'),('wallet-qa-owner','property_partner','global','active'),
('wallet-qa-other','worker','global','active');
insert into auth.sessions(id,user_id,created_at,updated_at) values
('10100000-0000-4000-8000-000000000011','10100000-0000-4000-8000-000000000001',now(),now());
insert into public.wallets(id,owner_id,owner_type,available_balance,pending_balance,frozen_balance,total_withdrawn) values
('10100000-0000-4000-8000-000000000021','wallet-qa-owner','worker',100000,0,0,0),
('10100000-0000-4000-8000-000000000022','wallet-qa-owner','property_partner',100000,0,0,0),
('10100000-0000-4000-8000-000000000023','wallet-qa-other','worker',100000,0,0,0);
insert into public.bank_accounts(id,user_id,bank_name,bank_code,account_number,account_name,
  paystack_recipient_code,verified_at,is_active,is_default) values
('10100000-0000-4000-8000-000000000031','wallet-qa-owner','Test Bank','058','0123456789','Wallet Owner','RCP_wallet_owner',now(),true,true),
('10100000-0000-4000-8000-000000000032','wallet-qa-owner','Old Bank','058','0123456780','Wallet Owner','RCP_wallet_old',now(),false,false),
('10100000-0000-4000-8000-000000000033','wallet-qa-other','Test Bank','058','0123456781','Other Owner','RCP_wallet_other',now(),true,true);
insert into public.platform_settings(key,value,category,label,is_active) values('wallet_minimum_withdrawal','100','wallet','Minimum withdrawal',true)
  on conflict(key) do update set value='100',is_active=true;
update public.creator_policy_versions set status='retired',effective_until=now(),retired_at=now()
  where policy_key='withdrawal_controls' and status='active';
insert into public.creator_policy_versions(policy_key,version,value,status,effective_from,reason,checksum)
  values('withdrawal_controls',990001,'{"new_account_cooldown_hours":0,"daily_max_count":0,"daily_max_amount":0,"require_recent_login_minutes":10}',
    'active',now()-interval '1 minute','Isolated wallet test','wallet-test');
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"sub":"10100000-0000-4000-8000-000000000001","role":"authenticated","session_id":"10100000-0000-4000-8000-000000000011"}',true);
set local role authenticated;
do $$
declare a jsonb; b jsonb; denied boolean;
begin
  a:=public.request_my_wallet_withdrawal('worker',5000,'10100000-0000-4000-8000-000000000031','10100000-0000-4000-8000-000000000041');
  if not coalesce((a->>'success')::boolean,false) then raise exception 'Initial request failed: %',a; end if;
  b:=public.request_my_wallet_withdrawal('worker',5000,'10100000-0000-4000-8000-000000000031','10100000-0000-4000-8000-000000000041');
  if b->>'request_id' is distinct from a->>'request_id' or not (b->>'replayed')::boolean then raise exception 'Retry did not recover original request'; end if;
  perform set_config('test.wallet_receipt',a->>'request_id',true);
  if (select available_balance from public.wallets where id='10100000-0000-4000-8000-000000000021')<>95000
    or (select frozen_balance from public.wallets where id='10100000-0000-4000-8000-000000000021')<>5000 then raise exception 'Retry reserved money twice'; end if;
  b:=public.request_my_wallet_withdrawal('worker',5000,'10100000-0000-4000-8000-000000000031','10100000-0000-4000-8000-000000000042');
  if coalesce((b->>'success')::boolean,false) then raise exception 'Second open withdrawal accepted'; end if;
  denied:=false;
  begin perform public.request_my_wallet_withdrawal('worker',6000,'10100000-0000-4000-8000-000000000031','10100000-0000-4000-8000-000000000041');
  exception when invalid_parameter_value then denied:=true; end;
  if not denied then raise exception 'Request key accepted changed details'; end if;
  denied:=false;
  begin perform public.request_my_wallet_withdrawal('property_partner',5000,'10100000-0000-4000-8000-000000000033','10100000-0000-4000-8000-000000000043');
  exception when invalid_parameter_value then denied:=true; end;
  if not denied then raise exception 'Another owner bank accepted'; end if;
  a:=public.request_my_wallet_withdrawal('property_partner',5000,'10100000-0000-4000-8000-000000000031','10100000-0000-4000-8000-000000000041');
  if not coalesce((a->>'success')::boolean,false) then raise exception 'Separate Partner wallet could not use its own intent'; end if;
  if (select count(*) from public.wallets where owner_id='wallet-qa-other')<>0 then raise exception 'Cross-owner wallet read'; end if;
  if has_table_privilege('authenticated','public.wallet_transactions','INSERT')
    or has_table_privilege('authenticated','public.wallets','UPDATE')
    or has_table_privilege('authenticated','public.withdrawals','INSERT')
    or has_table_privilege('authenticated','public.bank_accounts','UPDATE') then raise exception 'Client financial writes remain granted'; end if;
  if (public.get_my_property_partner_finance()->>'minimum_withdrawal')::numeric<>100 then raise exception 'UI and command minimum differ'; end if;
end $$;
reset role;
-- Simulate finalized processing without calling a provider or changing real money.
update public.withdrawals set status='paid' where id=current_setting('test.wallet_receipt')::uuid;
update public.wallets set frozen_balance=0,total_withdrawn=5000 where id='10100000-0000-4000-8000-000000000021';
update public.bank_accounts set is_active=false,is_default=false where id='10100000-0000-4000-8000-000000000031';
set local role authenticated;
do $$
declare r jsonb; denied boolean:=false;
begin
  r:=public.request_my_wallet_withdrawal('worker',5000,'10100000-0000-4000-8000-000000000031','10100000-0000-4000-8000-000000000041');
  if r->>'status'<>'paid' or r->>'request_id'<>current_setting('test.wallet_receipt') then raise exception 'Finalized receipt was not recovered'; end if;
  if (select available_balance from public.wallets where id='10100000-0000-4000-8000-000000000021')<>95000 then raise exception 'Finalized retry debited again'; end if;
  begin perform public.request_my_wallet_withdrawal('worker',5000,'10100000-0000-4000-8000-000000000031','10100000-0000-4000-8000-000000000044');
  exception when invalid_parameter_value then denied:=true; end;
  if not denied then raise exception 'Retired payout account accepted'; end if;
  r:=public.request_worker_withdrawal(5000,'10100000-0000-4000-8000-000000000032');
  if coalesce((r->>'success')::boolean,false) then raise exception 'Legacy Worker RPC accepted retired account'; end if;
  denied:=false;
  begin perform public.request_my_property_partner_withdrawal(5000,'10100000-0000-4000-8000-000000000032');
  exception when others then denied:=true; end;
  if not denied then raise exception 'Legacy Partner RPC accepted retired account'; end if;
end $$;
reset role;
-- A missing/revoked session and a different user's session fail before money commits.
update public.bank_accounts set is_active=true,is_default=true where id='10100000-0000-4000-8000-000000000031';
select set_config('request.jwt.claims','{"sub":"10100000-0000-4000-8000-000000000001","role":"authenticated","session_id":"10100000-0000-4000-8000-000000000099"}',true);
set local role authenticated;
do $$
declare denied boolean:=false;
begin
  begin perform public.request_my_wallet_withdrawal('worker',5000,'10100000-0000-4000-8000-000000000031','10100000-0000-4000-8000-000000000045');
  exception when invalid_authorization_specification then denied:=true; end;
  if not denied then raise exception 'Unknown session accepted'; end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"10100000-0000-4000-8000-000000000002","role":"authenticated","session_id":"10100000-0000-4000-8000-000000000011"}',true);
set local role authenticated;
do $$
declare denied boolean:=false;
begin
  begin perform public.request_my_wallet_withdrawal('worker',5000,'10100000-0000-4000-8000-000000000033','10100000-0000-4000-8000-000000000046');
  exception when invalid_authorization_specification then denied:=true; end;
  if not denied then raise exception 'Another user session accepted'; end if;
end $$;
reset role;
do $$ begin
  if has_function_privilege('anon','public.request_my_wallet_withdrawal(text,numeric,uuid,uuid)','EXECUTE') then raise exception 'Anonymous withdrawal grant'; end if;
  if exists(select 1 from public.wallets where owner_id='wallet-qa-other' and available_balance<>100000) then raise exception 'Denied withdrawal changed another wallet'; end if;
end $$;
rollback;
select 'wallet_withdrawal_receipt_contract_ok' as result;
