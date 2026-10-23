begin;
create function pg_temp.expect(value boolean, description text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAIL: %',description; end if;end$$;
create function pg_temp.rejects(statement text) returns boolean language plpgsql as $$begin execute statement;return false;exception when others then return true;end$$;
grant execute on function pg_temp.expect(boolean,text),pg_temp.rejects(text) to service_role;
set local session_replication_role=replica;
-- Transaction-only Auth rows satisfy proof FKs. No passwords, login tokens or
-- delivery calls are created; these are not hosted signed-in user journeys.
insert into auth.users(id,aud,role,email,created_at,updated_at) values
('f7450000-0000-4000-8000-000000000001','authenticated','authenticated','security-a@example.invalid',now(),now()),
('f7450000-0000-4000-8000-000000000002','authenticated','authenticated','security-b@example.invalid',now(),now());
insert into public.profiles(auth_id,email,user_id,role,profile_complete) values
('f7450000-0000-4000-8000-000000000001','security-a@example.invalid','security-a','user',true),
('f7450000-0000-4000-8000-000000000002','security-b@example.invalid','security-b','user',true);
insert into auth.sessions(id,user_id,created_at,updated_at) values
('f7450000-1000-4000-8000-000000000001','f7450000-0000-4000-8000-000000000001',now(),now()),
('f7450000-1000-4000-8000-000000000002','f7450000-0000-4000-8000-000000000002',now(),now());
insert into public.user_sessions(id,user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status) values
('f7450000-2000-4000-8000-000000000001','security-a','f7450000-0000-4000-8000-000000000001','f7450000-1000-4000-8000-000000000001','security-test-device-a','Browser',true,'pending');
insert into public.email_account_challenges(id,auth_id,purpose,device_session_id,auth_session_id,device_id,code_hash,status) values
('f7450000-3000-4000-8000-000000000001','f7450000-0000-4000-8000-000000000001','device_confirmation','f7450000-2000-4000-8000-000000000001','f7450000-1000-4000-8000-000000000001','security-test-device-a',repeat('a',64),'pending');
insert into public.email_account_challenges(id,auth_id,purpose,code_hash,status) values
('f7450000-3000-4000-8000-000000000002','f7450000-0000-4000-8000-000000000001','password_recovery',repeat('b',64),'pending'),
('f7450000-3000-4000-8000-000000000003','f7450000-0000-4000-8000-000000000001','password_recovery',repeat('c',64),'pending');
set local session_replication_role=origin;
select pg_temp.expect(not has_table_privilege('authenticated','public.email_account_challenges','select'),'browser cannot read proof hashes');
select pg_temp.expect(not has_function_privilege('authenticated','public.finish_email_device_confirmation(uuid,uuid)','execute'),'browser cannot promote devices');
select pg_temp.expect(not has_function_privilege('authenticated','public.confirm_current_device_with_google(uuid,text)','execute'),'old Google promotion is closed');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select pg_temp.expect(public.claim_email_account_challenge('f7450000-3000-4000-8000-000000000001','password_recovery') is null,'device code cannot claim a recovery purpose');
select pg_temp.expect(public.claim_email_account_challenge('f7450000-3000-4000-8000-000000000001','device_confirmation')->>'attempts'='1','first claim consumes an attempt');
select pg_temp.expect(public.claim_email_account_challenge('f7450000-3000-4000-8000-000000000001','device_confirmation') is null,'concurrent or replay claim denied');
select pg_temp.expect(pg_temp.rejects($$select public.finish_email_device_confirmation('f7450000-3000-4000-8000-000000000001','f7450000-1000-4000-8000-000000000001')$$),'unverified code cannot trust a device');
update public.email_account_challenges set proof_verified_at=now() where id='f7450000-3000-4000-8000-000000000001';
select pg_temp.expect(pg_temp.rejects($$select public.finish_email_device_confirmation('f7450000-3000-4000-8000-000000000001','f7450000-1000-4000-8000-000000000002')$$),'proof cannot authorize another account session');
select pg_temp.expect(public.finish_email_device_confirmation('f7450000-3000-4000-8000-000000000001','f7450000-1000-4000-8000-000000000001')->>'trust_status'='trusted','verified exact pending device is trusted');
select pg_temp.expect(pg_temp.rejects($$select public.finish_email_device_confirmation('f7450000-3000-4000-8000-000000000001','f7450000-1000-4000-8000-000000000001')$$),'completed device proof cannot be replayed');
update public.email_account_challenges set expires_at=now()-interval '1 second' where id='f7450000-3000-4000-8000-000000000003';
select pg_temp.expect(public.claim_email_account_challenge('f7450000-3000-4000-8000-000000000003','password_recovery') is null,'expired challenge denied');
do $$begin for i in 1..5 loop
  perform pg_temp.expect(public.claim_email_account_challenge('f7450000-3000-4000-8000-000000000002','password_recovery') is not null,'allowed attempt');
  update public.email_account_challenges set status='pending' where id='f7450000-3000-4000-8000-000000000002';
end loop;end$$;
select pg_temp.expect(public.claim_email_account_challenge('f7450000-3000-4000-8000-000000000002','password_recovery') is null,'sixth guess denied');
update public.email_account_challenges set status='processing',proof_verified_at=now() where id='f7450000-3000-4000-8000-000000000002';
select pg_temp.expect(not public.finish_email_password_recovery('f7450000-3000-4000-8000-000000000002'),'cleanup cannot claim success while Auth sessions survive');
select pg_temp.expect(public.auth_session_is_active('f7450000-0000-4000-8000-000000000001','f7450000-1000-4000-8000-000000000001'),'active Auth and device session accepted');
select set_config('request.jwt.claims','{"sub":"f7450000-0000-4000-8000-000000000001","role":"authenticated","session_id":"f7450000-1000-4000-8000-000000000001"}',true);
select pg_temp.expect(public.register_current_device('security-test-device-a','Browser','Windows','Edge',null)->>'trust_status'='trusted','live trusted device can still register');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update public.user_sessions set is_active=false,trust_status='rejected' where id='f7450000-2000-4000-8000-000000000001';
select pg_temp.expect(not public.auth_session_is_active('f7450000-0000-4000-8000-000000000001','f7450000-1000-4000-8000-000000000001'),'rejected device is denied before bearer expiry');
select set_config('request.jwt.claims','{"sub":"f7450000-0000-4000-8000-000000000001","role":"authenticated","session_id":"f7450000-1000-4000-8000-000000000001"}',true);
select pg_temp.expect(pg_temp.rejects($$select public.register_current_device('security-test-device-a','Browser','Windows','Edge',null)$$),'revoked bearer cannot reregister and change device metadata');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
reset role;
delete from auth.sessions where id='f7450000-1000-4000-8000-000000000001';
set local role service_role;
select pg_temp.expect(public.finish_email_password_recovery('f7450000-3000-4000-8000-000000000002'),'cleanup succeeds after actual Auth revocation');
select pg_temp.expect(public.finish_email_password_recovery('f7450000-3000-4000-8000-000000000002'),'cleanup retry is idempotent');
reset role;
select pg_temp.expect((select count(*)=1 from public.user_activity where user_id='security-a' and action_type='password_change'),'one password audit receipt');
rollback;
