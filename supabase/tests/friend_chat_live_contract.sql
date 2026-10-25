\set ON_ERROR_STOP on
begin;
create function pg_temp.expect(value boolean,description text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAIL: %',description; end if; end $$;
grant execute on function pg_temp.expect(boolean,text) to authenticated;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,account_kind) values
('95100000-0000-4000-8000-000000000001','live-a@example.invalid','live-friend-a','user',true,'consumer'),
('95100000-0000-4000-8000-000000000002','live-b@example.invalid','live-friend-b','user',true,'consumer');
insert into public.friends(id,user_low,user_high,requested_by,status) values
('95100000-0000-4000-8000-000000000010','live-friend-a','live-friend-b','live-friend-a','accepted');
set local session_replication_role=origin;
insert into public.friend_messages(id,friend_id,sender_id,ciphertext,encryption_iv) values
('95100000-0000-4000-8000-000000000020','95100000-0000-4000-8000-000000000010','live-friend-a','ZmFrZQ==','aXY=');
select pg_temp.expect((select count(*)=2 from realtime.messages where payload->>'message_id'='95100000-0000-4000-8000-000000000020'),'one private signal per participant');
select pg_temp.expect(not exists(select 1 from realtime.messages where payload->>'message_id'='95100000-0000-4000-8000-000000000020' and
 (not private or payload ? 'ciphertext' or payload ? 'content' or payload ? 'reactions' or event<>'friend_chat_changed')),'signals contain no message, emoji map or ciphertext');
select set_config('request.jwt.claims','{"sub":"95100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select public.set_friend_message_reaction('95100000-0000-4000-8000-000000000010','95100000-0000-4000-8000-000000000020','👍');
select public.set_friend_message_reaction('95100000-0000-4000-8000-000000000010','95100000-0000-4000-8000-000000000020','👍');
select pg_temp.expect((select count(*)=2 from realtime.messages where payload->>'message_id'='95100000-0000-4000-8000-000000000020'),'participant reads only own two signals');
reset role;
select pg_temp.expect((select count(*)=4 from realtime.messages where payload->>'message_id'='95100000-0000-4000-8000-000000000020'),'unchanged reaction creates no repeated signal');
select pg_temp.expect(not has_table_privilege('authenticated','public.friend_messages','SELECT'),'encrypted source table remains RPC-only');
select pg_temp.expect(not has_function_privilege('authenticated','public.broadcast_friend_chat_change()','EXECUTE'),'trigger is not an authenticated RPC');
select set_config('request.jwt.claims','{"sub":"95100000-0000-4000-8000-000000000099","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect(not exists(select 1 from realtime.messages where payload->>'message_id'='95100000-0000-4000-8000-000000000020'),'outsider cannot read participant signals');
reset role;
update public.friend_messages set reactions='{}'::jsonb where id='95100000-0000-4000-8000-000000000020';
select pg_temp.expect((select count(*)=6 from realtime.messages where payload->>'message_id'='95100000-0000-4000-8000-000000000020'),'reaction removal synchronizes both people');
select 'friend_chat_live_contract_ok' as result;
rollback;
