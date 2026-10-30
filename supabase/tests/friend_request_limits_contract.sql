\set ON_ERROR_STOP on
begin;
\ir private_message_fixture_helpers.sql
create function pg_temp.expect(value boolean, description text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAIL: %',description; end if;end$$;
grant execute on function pg_temp.expect(boolean,text) to authenticated,anon,service_role;
create function pg_temp.rejects(statement text) returns boolean language plpgsql as $$
begin execute statement; return false; exception when others then return true; end $$;
grant execute on function pg_temp.rejects(text) to authenticated,anon,service_role;

set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,account_kind,full_name,state,city,local_government) values
('97100000-0000-4000-8000-000000000001','rl-a@example.invalid','rl-a','user',true,'consumer','A','Lagos','Ikeja','Ikeja'),
('97100000-0000-4000-8000-000000000002','rl-b@example.invalid','rl-b','user',true,'consumer','B','Lagos','Ikeja','Ikeja'),
('97100000-0000-4000-8000-000000000003','rl-c@example.invalid','rl-c','user',true,'consumer','C','Lagos','Ikeja','Ikeja');
select pg_temp.prepare_private_message_fixture(array['97100000']);
set local session_replication_role=origin;

select set_config('request.jwt.claims','{"sub":"97100000-0000-4000-8000-000000000001","session_id":"97100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.send_friend_request('rl-b');
select pg_temp.expect(pg_temp.rejects($$select count(*) from public.friend_request_log$$),'request log is not readable by users');
select set_config('request.jwt.claims','{"sub":"97100000-0000-4000-8000-000000000002","session_id":"97100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select pg_temp.expect(jsonb_array_length(public.list_my_friends())=1,'a fresh request is listed');

-- 25 hours later the request has expired: it is hidden, cannot be accepted and no longer holds a slot.
reset role;
update public.friends set updated_at=now()-interval '25 hours' where user_low='rl-a' and user_high='rl-b';
select set_config('request.jwt.claims','{"sub":"97100000-0000-4000-8000-000000000002","session_id":"97100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect(jsonb_array_length(public.list_my_friends())=0,'an expired request is hidden');
reset role;
select set_config('test.cid',(select id::text from public.friends where user_low='rl-a' and user_high='rl-b'),true);
set local role authenticated;
select pg_temp.expect(pg_temp.rejects(format('select public.respond_to_friend_request(%L::uuid,true)',current_setting('test.cid'))),'an expired request cannot be accepted');
reset role;
select pg_temp.expect(public.friend_bucket_count('rl-a')=0,'an expired request frees the slot');
select set_config('request.jwt.claims','{"sub":"97100000-0000-4000-8000-000000000001","session_id":"97100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect((public.send_friend_request('rl-b')->>'status')='pending','the sender can ask again after expiry');

-- Daily cap: after 10 requests in 24 hours, a new request is refused.
reset role;
insert into public.friend_request_log(sender) select 'rl-a' from generate_series(1,10);
set local role authenticated;
select pg_temp.expect(pg_temp.rejects($$select public.send_friend_request('rl-c')$$),'the daily request cap is enforced');

-- Block and Unblock: a block ends the Friendship, stops requests both ways, and only the blocker can lift it.
reset role;
delete from public.friends where user_low='rl-a' and user_high='rl-c';
update public.friend_request_log set created_at=now()-interval '2 days';
reset role;
select set_config('test.pid',(select id::text from public.friends where user_low='rl-a' and user_high='rl-b'),true);
select set_config('request.jwt.claims','{"sub":"97100000-0000-4000-8000-000000000002","session_id":"97100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select public.respond_to_friend_request(current_setting('test.pid')::uuid,true);
select set_config('request.jwt.claims','{"sub":"97100000-0000-4000-8000-000000000001","session_id":"97100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select pg_temp.expect((public.block_friend('rl-b')->>'blocked')='true','a Friend can be blocked');
select pg_temp.expect(pg_temp.rejects($$select public.send_friend_request('rl-b')$$),'a request to a blocked person is refused');
select pg_temp.expect((select (x->>'status')='blocked' from jsonb_array_elements(public.list_my_friends()) x limit 1),'the blocker sees the blocked person to unblock');
select set_config('request.jwt.claims','{"sub":"97100000-0000-4000-8000-000000000002","session_id":"97100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select pg_temp.expect(pg_temp.rejects($$select public.send_friend_request('rl-a')$$),'the blocked person cannot send a request');
select pg_temp.expect(jsonb_array_length(public.list_my_friends())=0,'the blocked person is not shown the block');
select pg_temp.expect((public.unblock_friend('rl-a')->>'unblocked')='false','the blocked person cannot unblock');
select set_config('request.jwt.claims','{"sub":"97100000-0000-4000-8000-000000000001","session_id":"97100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select pg_temp.expect((public.unblock_friend('rl-b')->>'unblocked')='true','the blocker can unblock');
select pg_temp.expect((select (x->>'status')='accepted' from jsonb_array_elements(public.list_my_friends()) x limit 1),'unblock restores the Friend without a new request');

-- Friend chat: reactions, delete for me, media paths, and block rules.
reset role;
select set_config('test.fid',(select id::text from public.friends where user_low='rl-a' and user_high='rl-b'),true);
set local role authenticated;
select set_config('test.mid',public.send_friend_encrypted_message(current_setting('test.fid')::uuid,'ZmFrZQ==','aXY=','[]',null,null,pg_temp.current_envelope_token('friend',current_setting('test.fid')::uuid))::text,true);
select pg_temp.expect(pg_temp.rejects(format($q$select public.send_friend_encrypted_message(%L::uuid,'ZmFrZQ==','aXY=',%L::jsonb)$q$,current_setting('test.fid'),'[{"path":"e2ee/friend/00000000-0000-4000-8000-000000000000/x.bin","file_iv":"AAAAAAAAAAAAAAAA","metadata_iv":"AAAAAAAAAAAAAAAA","metadata_ciphertext":"AAAAAAAAAAAAAAAAAAAAAAAAAAAA"}]')),'media from another conversation is refused');
select pg_temp.expect(public.send_friend_encrypted_message(current_setting('test.fid')::uuid,'ZmFrZQ==','aXY=',format('[{"path":"e2ee/friend/%s/x.bin","file_iv":"AAAAAAAAAAAAAAAA","metadata_iv":"AAAAAAAAAAAAAAAA","metadata_ciphertext":"AAAAAAAAAAAAAAAAAAAAAAAAAAAA"}]',current_setting('test.fid'))::jsonb,null,null,pg_temp.current_envelope_token('friend',current_setting('test.fid')::uuid)) is not null,'valid encrypted media is accepted');
select set_config('request.jwt.claims','{"sub":"97100000-0000-4000-8000-000000000002","session_id":"97100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select pg_temp.expect((public.set_friend_message_reaction(current_setting('test.fid')::uuid,current_setting('test.mid')::uuid,'👍')->>'rl-b')='👍','a Friend can react');
select pg_temp.expect((select reactions->>'rl-b'='👍' from public.get_friend_encrypted_messages_page(current_setting('test.fid')::uuid) where id=current_setting('test.mid')::uuid),'the reaction is returned with the message');
select pg_temp.expect(public.delete_friend_message_for_me(current_setting('test.fid')::uuid,current_setting('test.mid')::uuid),'delete for me works');
select pg_temp.expect((select count(*)=1 from public.get_friend_encrypted_messages_page(current_setting('test.fid')::uuid)),'a deleted message is hidden only for me');
select set_config('request.jwt.claims','{"sub":"97100000-0000-4000-8000-000000000001","session_id":"97100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select pg_temp.expect((select count(*)=2 from public.get_friend_encrypted_messages_page(current_setting('test.fid')::uuid)),'the other person still sees both');
select public.block_friend('rl-b');
select pg_temp.expect(pg_temp.rejects(format('select public.send_friend_encrypted_message(%L::uuid,%L,%L)',current_setting('test.fid'),'a','b')),'nobody can send while blocked');
select pg_temp.expect(pg_temp.rejects(format('select public.set_friend_message_reaction(%L::uuid,%L::uuid,%L)',current_setting('test.fid'),current_setting('test.mid'),'👍')),'nobody can react while blocked');
select pg_temp.expect((select count(*)=2 from public.get_friend_encrypted_messages_page(current_setting('test.fid')::uuid)),'the old chat can still be read while blocked');
select public.unblock_friend('rl-b');
rollback;
