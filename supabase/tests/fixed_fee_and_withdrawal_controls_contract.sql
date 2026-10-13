\set ON_ERROR_STOP on
begin;
create function pg_temp.expect(value boolean, description text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAILED: %', description; end if; end $$;
create function pg_temp.rejects(statement text) returns boolean language plpgsql as $$
begin execute statement; return false; exception when others then return true; end $$;

-- Fixed fee is off until a Creator publishes it, and never exceeds the amount.
select pg_temp.expect(public.fixed_fee_amount('worker')=0,'fixed fee is off by default');
select pg_temp.expect(pg_temp.rejects($$insert into public.creator_policy_versions(policy_key,version,value,status,effective_from,reason,checksum) values('fixed_fee_worker',900,'{"enabled":true,"amount":-5}','active',now()-interval '1 minute','bad','x')$$),'negative fixed fee refused');
select pg_temp.expect(pg_temp.rejects($$insert into public.creator_policy_versions(policy_key,version,value,status,effective_from,reason,checksum) values('fixed_fee_other',900,'{"enabled":true,"amount":5}','active',now()-interval '1 minute','bad','x')$$),'unknown fixed fee key refused');
create temp table base as select public.calculate_commission(10000,'worker') as pct_only;
insert into public.creator_policy_versions(policy_key,version,value,status,effective_from,reason,checksum)
values('fixed_fee_worker',901,'{"enabled":true,"amount":500}','active',now()-interval '1 minute','test','t901');
select pg_temp.expect(public.fixed_fee_amount('worker')=500,'enabled fee is read');
select pg_temp.expect(public.calculate_commission(10000,'worker')=(select pct_only from base)+500,'commission adds the fixed fee');
select pg_temp.expect(public.calculate_commission(300,'worker')<=300,'fee never exceeds the amount');
update public.creator_policy_versions set value='{"enabled":false,"amount":500}' where policy_key='fixed_fee_worker' and version=901;
select pg_temp.expect(public.calculate_commission(10000,'worker')=(select pct_only from base),'turning it off removes the fee');

-- Withdrawal controls.
select pg_temp.expect(pg_temp.rejects($$insert into public.creator_policy_versions(policy_key,version,value,status,effective_from,reason,checksum) values('withdrawal_controls',900,'{"new_account_cooldown_hours":-1,"daily_max_count":1,"daily_max_amount":1}','active',now()-interval '1 minute','bad','x')$$),'invalid controls refused');
set local session_replication_role=replica;
insert into public.wallets(id,owner_id,owner_type,available_balance) values('99100000-0000-4000-8000-000000000001','wd-owner','worker',100000);
insert into public.bank_accounts(id,user_id,account_number,bank_code,bank_name,account_name,verified_at,created_at,activated_at,updated_at) values
('99100000-0000-4000-8000-0000000000b1','wd-owner','0123456789','058','Test Bank','A',now(),now(),now(),now()),
('99100000-0000-4000-8000-0000000000b2','wd-owner','0123456780','058','Test Bank','A',now()-interval '30 days',now()-interval '30 days',now()-interval '30 days',now()-interval '30 days');
set local session_replication_role=origin;
insert into public.creator_policy_versions(policy_key,version,value,status,effective_from,reason,checksum)
values('withdrawal_controls',901,'{"new_account_cooldown_hours":24,"daily_max_count":2,"daily_max_amount":20000}','active',now()-interval '1 minute','test','w901');
select pg_temp.expect(pg_temp.rejects($$insert into public.withdrawals(wallet_id,amount,status,bank_account_id) values('99100000-0000-4000-8000-000000000001',5000,'awaiting_review','99100000-0000-4000-8000-0000000000b1')$$),'new payout account is in cooldown');
insert into public.withdrawals(wallet_id,amount,status,bank_account_id) values('99100000-0000-4000-8000-000000000001',5000,'paid','99100000-0000-4000-8000-0000000000b2');
select pg_temp.expect(pg_temp.rejects($$insert into public.withdrawals(wallet_id,amount,status,bank_account_id) values('99100000-0000-4000-8000-000000000001',16000,'awaiting_review','99100000-0000-4000-8000-0000000000b2')$$),'daily amount limit holds');
insert into public.withdrawals(wallet_id,amount,status,bank_account_id) values('99100000-0000-4000-8000-000000000001',5000,'paid','99100000-0000-4000-8000-0000000000b2');
select pg_temp.expect(pg_temp.rejects($$insert into public.withdrawals(wallet_id,amount,status,bank_account_id) values('99100000-0000-4000-8000-000000000001',5000,'awaiting_review','99100000-0000-4000-8000-0000000000b2')$$),'daily count limit holds');
rollback;
