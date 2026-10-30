\set ON_ERROR_STOP on
begin;
create function pg_temp.expect(value boolean, description text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAILED: %', description; end if; end $$;
create function pg_temp.rejects(statement text) returns boolean language plpgsql as $$begin execute statement; return false; exception when others then return true; end $$;
grant execute on function pg_temp.expect(boolean,text),pg_temp.rejects(text) to authenticated,anon;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,account_kind,full_name,state,city,local_government) values
('97100000-0000-4000-8000-000000000001','hr-guest@example.invalid','hr-guest','user',true,'consumer','Guest','Abuja','Garki','Garki'),
('97100000-0000-4000-8000-000000000002','hr-owner@example.invalid','hr-owner','user',true,'consumer','Owner','Abuja','Garki','Garki'),
('97100000-0000-4000-8000-000000000003','hr-admin@example.invalid','hr-admin','user',true,'consumer','Admin','Lagos','Ikeja','Ikeja'),
('97100000-0000-4000-8000-000000000004','hr-other@example.invalid','hr-other','user',true,'consumer','Other','Lagos','Ajah','Ajah'),
('97100000-0000-4000-8000-000000000005','hr-abuja@example.invalid','hr-abuja','user',true,'consumer','Abuja','Abuja','Garki','Garki'),
('97100000-0000-4000-8000-000000000006','hr-creator@example.invalid','hr-creator','user',true,'consumer','Creator','Abuja','Garki','Garki');
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,scope_state,scope_lga) values
('hr-admin','admin','branch','Lagos','Ikeja'),('hr-other','admin','branch','Lagos','Ajah'),
('hr-abuja','admin','state','Abuja',null),('hr-creator','creator','global',null,null);
insert into public.hotels(hotel_id,name,state,city,owner_id,status) values
(-97101,'Report Contract Hotel','Lagos','Ikeja','hr-owner','active'),
(-97102,'Inactive Contract Hotel','Lagos','Ikeja','hr-owner','inactive');
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"sub":"97100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
create temp table hr_receipt as select public.report_hotel(-97101,'scam','Incorrect listing') as id;
select pg_temp.expect((select id is not null from hr_receipt),'report returns a receipt');
select pg_temp.expect(public.report_hotel(-97101,'scam','duplicate')=(select id from hr_receipt),'repeat open concern returns the same receipt');
select pg_temp.expect((select count(*) from public.list_my_content_reports() where subject_type='hotel' and report_id=(select id from hr_receipt))=1,'reporter sees one private receipt');
select pg_temp.expect(pg_temp.rejects($$select public.report_hotel(-97102,'scam')$$),'inactive hotel cannot be arbitrarily reported');
select pg_temp.expect(pg_temp.rejects($$select public.report_hotel(-97101,'invalid')$$),'invalid reason rejected');
select pg_temp.expect(pg_temp.rejects($$select * from public.content_reports$$),'direct report table is closed');
select pg_temp.expect(pg_temp.rejects($$select * from public.admin_list_content_reports()$$),'normal reporter cannot read operator queue');
select set_config('request.jwt.claims','{"sub":"97100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select pg_temp.expect(pg_temp.rejects($$select public.report_hotel(-97101,'scam')$$),'owner cannot report own hotel');
select pg_temp.expect((select count(*) from public.list_my_content_reports() where subject_ref='-97101')=0,'owner cannot see reporter receipts');
select set_config('request.jwt.claims','{"sub":"97100000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select pg_temp.expect((select count(*) from public.admin_list_content_reports() where subject_type='hotel' and subject_ref='-97101')=0,'owner home state does not route hotel report');
select pg_temp.expect(pg_temp.rejects($$select public.admin_resolve_content_report((select id from hr_receipt),'dismissed')$$),'out-of-state resolution denied');
select set_config('request.jwt.claims','{"sub":"97100000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select pg_temp.expect((select count(*) from public.admin_list_content_reports() where subject_type='hotel' and subject_ref='-97101')=0,'wrong branch cannot review hotel report');
select set_config('request.jwt.claims','{"sub":"97100000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select pg_temp.expect((select count(*) from public.admin_list_content_reports() where subject_type='hotel' and subject_ref='-97101')=1,'hotel-location branch sees report');
select public.admin_resolve_content_report((select id from hr_receipt),'reviewing','Investigating');
select set_config('request.jwt.claims','{"sub":"97100000-0000-4000-8000-000000000006","role":"authenticated"}',true);
select pg_temp.expect((select count(*) from public.admin_list_content_reports('reviewing') where subject_type='hotel' and subject_ref='-97101')=1,'Creator sees reviewing report');
select public.admin_resolve_content_report((select id from hr_receipt),'actioned','Reviewed evidence');
select set_config('request.jwt.claims','{"sub":"97100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select pg_temp.expect((select status='actioned' and resolved_at is not null from public.list_my_content_reports() where report_id=(select id from hr_receipt)),'reporter sees final status');
reset role;
select pg_temp.expect(not has_function_privilege('anon','public.report_hotel(integer,text,text)','EXECUTE'),'anonymous report RPC denied');
select pg_temp.expect(not has_function_privilege('authenticated','public._content_report_in_actor_scope(text,text,text,text,public.profiles)','EXECUTE'),'scope helper is not a client endpoint');
select 'hotel_listing_reports_contract_ok' as result;
rollback;
