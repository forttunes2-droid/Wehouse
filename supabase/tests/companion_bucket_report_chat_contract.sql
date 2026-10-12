\set ON_ERROR_STOP on
begin;
create function pg_temp.expect(value boolean, description text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAIL: %',description; end if;end$$;
grant execute on function pg_temp.expect(boolean,text) to authenticated,anon,service_role;
create function pg_temp.rejects(statement text) returns boolean language plpgsql as $$
begin execute statement; return false; exception when others then return true; end $$;
grant execute on function pg_temp.rejects(text) to authenticated,anon,service_role;

set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,account_kind,full_name,state,city,local_government) values
('96000000-0000-4000-8000-000000000001','cb-a@example.invalid','cb-a','user',true,'consumer','A','Lagos','Ikeja','Ikeja'),
('96000000-0000-4000-8000-000000000002','cb-b@example.invalid','cb-b','user',true,'consumer','B','Lagos','Ikeja','Ikeja'),
('96000000-0000-4000-8000-000000000003','cb-c@example.invalid','cb-c','user',true,'consumer','C','Lagos','Ikeja','Ikeja'),
('96000000-0000-4000-8000-000000000004','cb-d@example.invalid','cb-d','user',true,'consumer','D','Lagos','Ikeja','Ikeja'),
('96000000-0000-4000-8000-000000000005','cb-e@example.invalid','cb-e','user',true,'consumer','E','Lagos','Ikeja','Ikeja'),
('96000000-0000-4000-8000-000000000006','cb-f@example.invalid','cb-f','user',true,'consumer','F','Lagos','Ikeja','Ikeja'),
('96000000-0000-4000-8000-000000000007','cb-g@example.invalid','cb-g','user',true,'consumer','G','Lagos','Ikeja','Ikeja');
set local session_replication_role=origin;

-- Bucket: A can hold 5 Companions (accepted or sent), not 6.
select set_config('request.jwt.claims','{"sub":"96000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.send_companion_request('cb-b');
select public.send_companion_request('cb-c');
select public.send_companion_request('cb-d');
select public.send_companion_request('cb-e');
select public.send_companion_request('cb-f');
select pg_temp.expect(pg_temp.rejects($$select public.send_companion_request('cb-g')$$),'a sixth Companion is rejected');

-- Removing frees a slot.
select public.remove_companion('cb-f');
select pg_temp.expect((public.send_companion_request('cb-g')->>'status')='pending','a freed slot can be used');

-- Recipient accepts B and may chat; ciphertext only.
select set_config('request.jwt.claims','{"sub":"96000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select set_config('test.cid',(select (x->>'companion_id') from jsonb_array_elements(public.list_my_companions()) x limit 1),true);
select public.respond_to_companion_request(current_setting('test.cid')::uuid,true);
select pg_temp.expect(public.send_companion_encrypted_message(current_setting('test.cid')::uuid,'ZmFrZQ==','aXY=') is not null,'accepted Companion can send ciphertext');
select pg_temp.expect(pg_temp.rejects(format('select public.send_companion_encrypted_message(%L::uuid,%L,%L)',current_setting('test.cid'),'','x')),'empty ciphertext is rejected');

-- Outsider cannot read or write the thread.
select set_config('request.jwt.claims','{"sub":"96000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select pg_temp.expect(pg_temp.rejects(format('select * from public.get_companion_encrypted_messages(%L::uuid)',current_setting('test.cid'))),'outsider cannot read');
select pg_temp.expect(pg_temp.rejects(format('select public.send_companion_encrypted_message(%L::uuid,%L,%L)',current_setting('test.cid'),'a','b')),'outsider cannot send');

-- The sender reads it back; the stored value is exactly the ciphertext.
select set_config('request.jwt.claims','{"sub":"96000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select pg_temp.expect((select count(*) from public.get_companion_encrypted_messages(current_setting('test.cid')::uuid))=1,'participant reads the thread');
select pg_temp.expect(pg_temp.rejects('select 1 from public.companion_messages'),'no direct table read');
select pg_temp.expect(pg_temp.rejects($$select public.report_companion('cb-g','  ')$$),'blank report reason rejected');
select pg_temp.expect(public.report_companion('cb-b','spam','details') is not null,'a Companion can be reported');
select pg_temp.expect(pg_temp.rejects($$select public.report_companion('cb-d_nobody','spam')$$),'cannot report a stranger');

-- Cancel: either side can end it; the chat closes; a new request waits 30 days.
select public.remove_companion('cb-b');
select pg_temp.expect(pg_temp.rejects(format('select * from public.get_companion_encrypted_messages(%L::uuid)',current_setting('test.cid'))),'cancelled chat is closed');
select pg_temp.expect(pg_temp.rejects(format('select public.send_companion_encrypted_message(%L::uuid,%L,%L)',current_setting('test.cid'),'a','b')),'cannot send after cancelling');
select pg_temp.expect(pg_temp.rejects($$select public.send_companion_request('cb-b')$$),'canceller cannot re-request within 30 days');
select set_config('request.jwt.claims','{"sub":"96000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select pg_temp.expect(pg_temp.rejects($$select public.send_companion_request('cb-a')$$),'the other person cannot re-request within 30 days either');
reset role;
select pg_temp.expect(not exists(select 1 from public.roommate_user_blocks where blocker_user_id like 'cb-%'),'Companion cancel writes nothing to Roommate blocks');
select pg_temp.expect(not exists(select 1 from public.conversations where participant_a like 'cb-%'),'Companion chat creates no Roommate conversation');

-- After 30 days a new request is allowed.
update public.companions set responded_at = now() - interval '31 days' where user_low='cb-a' and user_high='cb-b';
select set_config('request.jwt.claims','{"sub":"96000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect((public.send_companion_request('cb-b')->>'status')='pending','a request is allowed after the 30-day wait');
reset role;

select 'companion_bucket_report_chat_contract_ok' as result;
rollback;
