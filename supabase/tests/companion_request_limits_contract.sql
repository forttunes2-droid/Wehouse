\set ON_ERROR_STOP on
begin;
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
set local session_replication_role=origin;

select set_config('request.jwt.claims','{"sub":"97100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.send_companion_request('rl-b');
select pg_temp.expect(pg_temp.rejects($$select count(*) from public.companion_request_log$$),'request log is not readable by users');
select set_config('request.jwt.claims','{"sub":"97100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select pg_temp.expect(jsonb_array_length(public.list_my_companions())=1,'a fresh request is listed');

-- 25 hours later the request has expired: it is hidden, cannot be accepted and no longer holds a slot.
reset role;
update public.companions set updated_at=now()-interval '25 hours' where user_low='rl-a' and user_high='rl-b';
select set_config('request.jwt.claims','{"sub":"97100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect(jsonb_array_length(public.list_my_companions())=0,'an expired request is hidden');
reset role;
select set_config('test.cid',(select id::text from public.companions where user_low='rl-a' and user_high='rl-b'),true);
set local role authenticated;
select pg_temp.expect(pg_temp.rejects(format('select public.respond_to_companion_request(%L::uuid,true)',current_setting('test.cid'))),'an expired request cannot be accepted');
reset role;
select pg_temp.expect(public.companion_bucket_count('rl-a')=0,'an expired request frees the slot');
select set_config('request.jwt.claims','{"sub":"97100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect((public.send_companion_request('rl-b')->>'status')='pending','the sender can ask again after expiry');

-- Daily cap: after 10 requests in 24 hours, a new request is refused.
reset role;
insert into public.companion_request_log(sender) select 'rl-a' from generate_series(1,10);
set local role authenticated;
select pg_temp.expect(pg_temp.rejects($$select public.send_companion_request('rl-c')$$),'the daily request cap is enforced');

-- Block and Unblock: a block ends the Friendship, stops requests both ways, and only the blocker can lift it.
reset role;
delete from public.companions where user_low='rl-a' and user_high='rl-c';
update public.companion_request_log set created_at=now()-interval '2 days';
select set_config('request.jwt.claims','{"sub":"97100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect((public.block_friend('rl-b')->>'blocked')='true','a Friend can be blocked');
select pg_temp.expect(pg_temp.rejects($$select public.send_companion_request('rl-b')$$),'the blocker cannot send a request to someone they blocked');
select pg_temp.expect((select (x->>'status')='blocked' from jsonb_array_elements(public.list_my_companions()) x limit 1),'the blocker sees the blocked person to unblock');
select set_config('request.jwt.claims','{"sub":"97100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select pg_temp.expect(pg_temp.rejects($$select public.send_companion_request('rl-a')$$),'the blocked person cannot send a request');
select pg_temp.expect(jsonb_array_length(public.list_my_companions())=0,'the blocked person is not shown the block');
select pg_temp.expect((public.unblock_friend('rl-a')->>'unblocked')='false','the blocked person cannot unblock');
select set_config('request.jwt.claims','{"sub":"97100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select pg_temp.expect((public.unblock_friend('rl-b')->>'unblocked')='true','the blocker can unblock');
select pg_temp.expect((public.send_companion_request('rl-b')->>'status')='pending','after unblock they must ask again');
rollback;
