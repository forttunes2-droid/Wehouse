begin;
create function pg_temp.expect(value boolean,label text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAIL: %',label;end if;end $$;
create function pg_temp.denied(statement text) returns boolean language plpgsql as $$begin execute statement;return false;exception when insufficient_privilege then return true;end $$;
grant execute on function pg_temp.expect(boolean,text),pg_temp.denied(text) to authenticated;
set local session_replication_role=replica;
insert into auth.users(id,aud,role,email,created_at,updated_at) values('99500000-0000-4000-8000-000000000001','authenticated','authenticated','authority@example.invalid',now(),now());
insert into public.profiles(auth_id,email,user_id,role,profile_complete) values('99500000-0000-4000-8000-000000000001','authority@example.invalid','authority-fixture','user',true);
insert into public.profiles(auth_id,email,user_id,role,profile_complete) values('99500000-0000-4000-8000-000000000002','authority-peer@example.invalid','authority-peer','user',true);
insert into public.friends(id,user_low,user_high,status,requested_by) values('99500000-4000-4000-8000-000000000001','authority-fixture','authority-peer','accepted','authority-fixture');
insert into storage.objects(id,bucket_id,name,owner_id,metadata,version) values('99500000-5000-4000-8000-000000000001','chat-files','e2ee/friend/99500000-4000-4000-8000-000000000001/file.bin','99500000-0000-4000-8000-000000000001','{"size":100,"mimetype":"application/octet-stream"}','synthetic-version');
insert into auth.sessions(id,user_id,created_at,updated_at) select ('99500000-1000-4000-8000-00000000000'||n)::uuid,'99500000-0000-4000-8000-000000000001',now(),now() from generate_series(1,3)n;
insert into public.user_sessions(id,user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status) values
('99500000-2000-4000-8000-000000000001','authority-fixture','99500000-0000-4000-8000-000000000001','99500000-1000-4000-8000-000000000001','readable-device-label-123','Synthetic approved browser',true,'trusted'),
('99500000-2000-4000-8000-000000000003','authority-fixture','99500000-0000-4000-8000-000000000001',null,'legacy-row-label-123456','Synthetic unbound legacy row',true,'trusted');
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"sub":"99500000-0000-4000-8000-000000000001","session_id":"99500000-1000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect(pg_temp.denied($q$update public.user_sessions set trust_status='trusted',is_active=true where id='99500000-2000-4000-8000-000000000003'$q$),'browser cannot trust or revive a row');
select pg_temp.expect(pg_temp.denied($q$insert into public.user_sessions(user_id,auth_id,device,trust_status) values('authority-fixture','99500000-0000-4000-8000-000000000001','Synthetic','trusted')$q$),'browser cannot mint trusted rows');
select pg_temp.expect(public.register_current_device('readable-device-label-123','Synthetic copy','Test','Test','99500000-2000-4000-8000-000000000003')->>'trust_status'='pending','copied ID and unbound legacy row do not prove trust');
select pg_temp.expect((select is_active and trust_status='trusted' from public.user_sessions where id='99500000-2000-4000-8000-000000000001'),'copied label does not evict legitimate device');
select pg_temp.expect((select auth_session_id is null from public.user_sessions where id='99500000-2000-4000-8000-000000000003'),'legacy row cannot be rebound');
select pg_temp.expect(not public.touch_current_device_session('99500000-2000-4000-8000-000000000001',true),'pending bearer cannot end another device via heartbeat');
select pg_temp.expect(pg_temp.denied($q$select public.respond_to_device_login((select id from public.user_sessions where auth_session_id='99500000-1000-4000-8000-000000000002'),true)$q$),'pending session cannot approve itself');
-- A pending session cannot create identities or fresh private-file links.
select pg_temp.expect(pg_temp.denied($q$select public.create_my_automatic_private_identity(jsonb_build_object('kty','EC','crv','P-256','x',repeat('A',43),'y',repeat('A',43)))$q$),'pending identity setup denied');
reset role;
select set_config('request.jwt.claims','{"sub":"99500000-0000-4000-8000-000000000001","session_id":"99500000-1000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect(pg_temp.denied($q$select public.respond_to_device_login((select id from public.user_sessions where auth_session_id='99500000-1000-4000-8000-000000000002'),true)$q$),'retired browser approval API stays retired even on a trusted device');
reset role;
insert into public.email_account_challenges(id,auth_id,purpose,device_session_id,device_id,auth_session_id,code_hash,proof_verified_at,expires_at,status)
select '99500000-6000-4000-8000-000000000001','99500000-0000-4000-8000-000000000001','device_confirmation',id,device_id,'99500000-1000-4000-8000-000000000002',repeat('0',64),clock_timestamp(),clock_timestamp()+interval '1 minute','processing'
from public.user_sessions where auth_session_id='99500000-1000-4000-8000-000000000002';
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.finish_email_device_confirmation('99500000-6000-4000-8000-000000000001','99500000-1000-4000-8000-000000000002');
reset role;
select set_config('request.jwt.claims','{"sub":"99500000-0000-4000-8000-000000000001","session_id":"99500000-1000-4000-8000-000000000001","role":"authenticated"}',true);
delete from auth.sessions where id='99500000-1000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.expect(pg_temp.denied($q$select public.respond_to_device_login((select id from public.user_sessions where auth_session_id='99500000-1000-4000-8000-000000000003'),true)$q$),'removed Auth session cannot exercise a surviving trusted row');
reset role;
-- Abandoned allocations are reclaimed lazily under the same transaction lock
-- used by Storage's final metadata write. An expired path is never reopened.
insert into private.media_upload_reservations(id,actor_auth_id,bucket_id,object_name,reserved_bytes,previous_version,expires_at)
values('99500000-3000-4000-8000-000000000001','99500000-0000-4000-8000-000000000001','chat-files','e2ee/friend/99500000-4000-4000-8000-000000000001/abandoned.bin',1000000,null,clock_timestamp()-interval '1 second');
select private.reclaim_expired_media_uploads();
select pg_temp.expect((select state='expired' from private.media_upload_reservations where id='99500000-3000-4000-8000-000000000001'),'abandoned capacity reclaimed');
select set_config('request.jwt.claims','{"sub":"99500000-0000-4000-8000-000000000001","session_id":"99500000-1000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect(not private.storage_upload_within_budget('chat-files',gen_random_uuid(),'e2ee/friend/99500000-4000-4000-8000-000000000001/abandoned.bin','{"size":10,"mimetype":"application/octet-stream"}'),'late upload with expired allocation denied');
select pg_temp.expect((select count(*)=1 from storage.objects where id='99500000-5000-4000-8000-000000000001'),'approved session reads its chat file');
do $$begin
 begin perform public.reserve_my_media_upload('chat-files','e2ee/friend/99500000-4000-4000-8000-000000000001/abandoned.bin');raise exception 'FAIL expired path reopened';
 exception when raise_exception then if sqlerrm not like 'This upload expired.%' then raise;end if;end;
end $$;
reset role;
update public.user_sessions set is_active=false where auth_session_id='99500000-1000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.expect((select count(*)=0 from storage.objects where id='99500000-5000-4000-8000-000000000001'),'revoked bearer cannot read the same chat file or mint a fresh signed link');
reset role;
select pg_temp.expect((select provolatile='v' from pg_proc where oid='private.storage_upload_within_budget(text,uuid,text,jsonb)'::regprocedure),'final Storage check can hold a transaction lock');
select pg_temp.expect(exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='private_chat_files_require_live_session' and permissive='RESTRICTIVE'),'private file RLS cannot bypass session check through another permissive policy');
select 'device_authority_and_upload_recovery_contract_ok';
rollback;
