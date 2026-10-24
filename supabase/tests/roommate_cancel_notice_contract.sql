\set ON_ERROR_STOP on
begin;
create function pg_temp.expect(value boolean, description text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAILED: %', description; end if; end $$;
create function pg_temp.rejects(statement text) returns boolean language plpgsql as $$
begin execute statement; return false; exception when others then return true; end $$;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,account_kind,full_name,state,city,local_government) values
('99000000-0000-4000-8000-000000000001','rw-a@example.invalid','rw-a','user',true,'consumer','A','Lagos','Ikeja','Ikeja'),
('99000000-0000-4000-8000-000000000002','rw-b@example.invalid','rw-b','user',true,'consumer','B','Lagos','Ikeja','Ikeja');
set local session_replication_role=origin;
insert into public.roommate_user_blocks(blocker_user_id,blocked_user_id) values('rw-a','rw-b');
select pg_temp.expect((select count(*) from public.notifications where recipient_id='rw-b' and type='roommate_connection_cancelled')=1,'the other person is told once');
select pg_temp.expect((select message not like '%reason%' from public.notifications where recipient_id='rw-b' and type='roommate_connection_cancelled'),'no reason is shared');
select pg_temp.expect((select count(*) from public.notifications where recipient_id='rw-a')=0,'the person cancelling is not notified');
select 'roommate_cancel_notice_contract_ok';
rollback;
