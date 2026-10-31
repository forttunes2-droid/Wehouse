\set ON_ERROR_STOP on
begin;
\ir private_message_fixture_helpers.sql
create function pg_temp.expect(value boolean, description text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAILED: %', description; end if; end $$;
grant execute on function pg_temp.expect(boolean,text) to authenticated,anon,service_role;
create function pg_temp.rejects(statement text) returns boolean language plpgsql as $$
begin execute statement; return false; exception when others then return true; end $$;
grant execute on function pg_temp.rejects(text) to authenticated,anon,service_role;

set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,account_kind,full_name,state,city,local_government) values
('98000000-0000-4000-8000-000000000001','kx-a@example.invalid','kx-a','user',true,'consumer','A','Lagos','Ikeja','Ikeja'),
('98000000-0000-4000-8000-000000000002','kx-b@example.invalid','kx-b','user',true,'consumer','B','Lagos','Ikeja','Ikeja'),
('98000000-0000-4000-8000-000000000003','kx-c@example.invalid','kx-c','user',true,'consumer','C','Lagos','Ikeja','Ikeja'),
('98000000-0000-4000-8000-000000000004','kx-d@example.invalid','kx-d','user',true,'consumer','D','Lagos','Ikeja','Ikeja');
insert into public.user_encryption_identities(user_id,public_key_jwk,encrypted_private_key,backup_iv,backup_salt)
select u,'{"kty":"EC"}'::jsonb,'x','x','x' from unnest(array['kx-a','kx-b','kx-c','kx-d']) u;
insert into public.friends(id,user_low,user_high,status,requested_by) values
('98000000-0000-4000-8000-0000000000a1','kx-a','kx-b','accepted','kx-a'),
('98000000-0000-4000-8000-0000000000a2','kx-a','kx-c','pending','kx-a');
select pg_temp.prepare_private_message_fixture(array['98000000']);
set local session_replication_role=origin;

create function pg_temp.env(a text,b text) returns jsonb language sql as $$ select jsonb_build_array(
 jsonb_build_object('recipient_user_id',a,'recipient_key_version',1,'sender_ephemeral_public_key_jwk','{}'::jsonb,'wrapped_key','k','wrap_iv','i'),
 jsonb_build_object('recipient_user_id',b,'recipient_key_version',1,'sender_ephemeral_public_key_jwk','{}'::jsonb,'wrapped_key','k','wrap_iv','i')) $$;
grant execute on function pg_temp.env(text,text) to authenticated;

select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000001","session_id":"98000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect((select count(*) from public.get_private_chat_peer_public_key('friend','98000000-0000-4000-8000-0000000000a1','kx-b'))=1,'accepted friend can fetch the peer key');
select pg_temp.expect(pg_temp.rejects($$select * from public.get_private_chat_peer_public_key('friend','98000000-0000-4000-8000-0000000000a2','kx-c')$$),'pending friend cannot fetch a key');
select pg_temp.expect(pg_temp.rejects($$select public.establish_private_conversation_key('friend','98000000-0000-4000-8000-0000000000a2',pg_temp.env('kx-a','kx-c'))$$),'pending friend cannot establish a key');
select pg_temp.expect(public.establish_private_conversation_key('friend','98000000-0000-4000-8000-0000000000a1',pg_temp.env('kx-a','kx-b')),'accepted friend establishes the key');
select pg_temp.expect(not public.establish_private_conversation_key('friend','98000000-0000-4000-8000-0000000000a1',pg_temp.env('kx-a','kx-b')),'second setup reports the key already exists');

select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000004","session_id":"98000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select pg_temp.expect(pg_temp.rejects($$select * from public.get_private_chat_peer_public_key('friend','98000000-0000-4000-8000-0000000000a1','kx-b')$$),'an outsider cannot fetch keys for someone else''s friend chat');
select pg_temp.expect(pg_temp.rejects($$select public.establish_private_conversation_key('friend','98000000-0000-4000-8000-0000000000a1',pg_temp.env('kx-d','kx-b'))$$),'an outsider cannot set up a friend chat key');
select 'friend_chat_key_exchange_contract_ok';
rollback;
