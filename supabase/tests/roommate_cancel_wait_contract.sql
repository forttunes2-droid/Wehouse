\set ON_ERROR_STOP on
begin;
create function pg_temp.expect(value boolean, description text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAILED: %', description; end if; end $$;
create function pg_temp.rejects(statement text) returns boolean language plpgsql as $$
begin execute statement; return false; exception when others then return true; end $$;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,account_kind,full_name,state,city,local_government) values
('99000000-0000-4000-8000-000000000001','rw-a@example.invalid','rw-a','user',true,'consumer','A','Lagos','Ikeja','Ikeja'),
('99000000-0000-4000-8000-000000000002','rw-b@example.invalid','rw-b','user',true,'consumer','B','Lagos','Ikeja','Ikeja');
insert into public.roommate_user_blocks(blocker_user_id,blocked_user_id,updated_at) values('rw-a','rw-b',now());
set local session_replication_role=origin;
select pg_temp.expect(pg_temp.rejects($$delete from public.roommate_user_blocks where blocker_user_id='rw-a'$$),'restore is refused inside the wait');
update public.roommate_user_blocks set updated_at=now()-interval '31 days';
select pg_temp.expect(not pg_temp.rejects($$delete from public.roommate_user_blocks where blocker_user_id='rw-a'$$),'restore works after the wait');
select 'roommate_cancel_wait_contract_ok';
rollback;
