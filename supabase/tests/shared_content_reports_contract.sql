\set ON_ERROR_STOP on
begin;
create function pg_temp.expect(value boolean, description text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAILED: %', description; end if; end $$;
grant execute on function pg_temp.expect(boolean,text) to authenticated,anon,service_role;
create function pg_temp.rejects(statement text) returns boolean language plpgsql as $$
begin execute statement; return false; exception when others then return true; end $$;
grant execute on function pg_temp.rejects(text) to authenticated,anon,service_role;

set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,account_kind,full_name,state,city,local_government) values
('97000000-0000-4000-8000-000000000001','sr-a@example.invalid','sr-a','user',true,'consumer','A','Lagos','Ikeja','Ikeja'),
('97000000-0000-4000-8000-000000000002','sr-b@example.invalid','sr-b','user',true,'consumer','B','Lagos','Ikeja','Ikeja'),
('97000000-0000-4000-8000-000000000003','sr-c@example.invalid','sr-c','user',true,'consumer','C','Abuja','Garki','Garki'),
('97000000-0000-4000-8000-000000000007','sr-d@example.invalid','sr-d','user',true,'consumer','D','Lagos','Ajah','Ajah'),
('97000000-0000-4000-8000-000000000004','sr-lagos-admin@example.invalid','sr-lagos-admin','user',true,'consumer','LA','Lagos','Ikeja','Ikeja'),
('97000000-0000-4000-8000-000000000005','sr-abuja-admin@example.invalid','sr-abuja-admin','user',true,'consumer','AA','Abuja','Garki','Garki'),
('97000000-0000-4000-8000-000000000006','sr-creator@example.invalid','sr-creator','user',true,'consumer','CR','Lagos','Ikeja','Ikeja'),
('97000000-0000-4000-8000-000000000008','sr-branch-admin@example.invalid','sr-branch-admin','user',true,'consumer','BA','Lagos','Ikeja','Ikeja');
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,scope_state,scope_lga) values
('sr-lagos-admin','admin','state','Lagos',null),('sr-abuja-admin','admin','state','Abuja',null),('sr-creator','creator','global',null,null),
('sr-branch-admin','admin','branch','Lagos','Ikeja');
insert into public.conversations(id,conversation_type,participant_a,participant_b) values
('97000000-0000-4000-8000-0000000000a1','roommate','sr-a','sr-b');
set local session_replication_role=origin;

select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect(public.report_content('roommate_chat','sr-b','harassment','rude')is not null,'a roommate can report their conversation partner');
select pg_temp.expect(pg_temp.rejects($$select public.report_content('roommate_chat','sr-c','spam')$$),'cannot report a roommate chat you are not in');
select pg_temp.expect(pg_temp.rejects($$select public.report_content('friend_chat','sr-b','spam')$$),'cannot report a non-friend as a friend');
select pg_temp.expect(pg_temp.rejects($$select public.report_content('worker_chat','sr-b','spam')$$),'cannot report a worker chat you are not in');
select pg_temp.expect(pg_temp.rejects($$select public.report_content('profile','sr-a','spam')$$),'cannot report yourself');
select pg_temp.expect(pg_temp.rejects($$select public.report_content('profile','sr-b','bad')$$),'reason must be from the list');
select pg_temp.expect(public.report_content('profile','sr-c','scam') is not null,'profiles can be reported');
select pg_temp.expect(public.report_content('profile','sr-d','scam') is not null,'same-state profile can be reported');
select pg_temp.expect(pg_temp.rejects($$select count(*) from public.content_reports$$),'users cannot read the reports table');
select pg_temp.expect(pg_temp.rejects($$select * from public.admin_list_content_reports()$$),'a normal user cannot open moderation');

select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select pg_temp.expect((select count(*) from public.admin_list_content_reports())=2,'Lagos admin sees only Lagos reports');

select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select pg_temp.expect((select count(*) from public.admin_list_content_reports())=1,'Abuja admin sees only Abuja reports');
select pg_temp.expect((select subject_user_id from public.admin_list_content_reports() limit 1)='sr-c','Abuja admin sees the Abuja subject');

select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
select pg_temp.expect((select count(*) from public.admin_list_content_reports())=3,'Creator sees every report');

select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000008","role":"authenticated"}',true);
select pg_temp.expect((select count(*) from public.admin_list_content_reports())=1,'branch admin sees only Ikeja reports');
select pg_temp.expect((select subject_user_id from public.admin_list_content_reports() limit 1)='sr-b','branch admin sees the Ikeja subject');

-- Resolve: out-of-area admin is refused, in-area admin succeeds.
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
create temp table t as select id from public.admin_list_content_reports() limit 1;
grant select on t to authenticated;
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select pg_temp.expect(pg_temp.rejects($$select public.admin_resolve_content_report((select id from t),'dismissed')$$),'Lagos admin cannot resolve an Abuja report');
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select public.admin_resolve_content_report((select id from t),'actioned','done');
select pg_temp.expect((select count(*) from public.admin_list_content_reports('open'))=0,'resolved report leaves the open queue');
select 'shared_content_reports_contract_ok';
rollback;
