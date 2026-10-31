-- Actual reviewed export commands; synthetic accounts/data, transaction rolled back.
begin;
set local session_replication_role=replica;
insert into auth.users(id,aud,role,email,created_at,updated_at)
select ('99700000-0000-4000-8000-00000000000'||n)::uuid,'authenticated','authenticated','privacy-'||n||'@example.invalid',now(),now() from generate_series(1,3)n;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,state,city,local_government)
select '99700000-0000-4000-8000-00000000000'||n,'privacy-'||n||'@example.invalid','privacy-'||n,'user',true,'Nasarawa','Lafia','Lafia' from generate_series(1,3)n;
insert into auth.sessions(id,user_id,created_at,updated_at)
select auth_id::uuid,auth_id::uuid,now(),now() from public.profiles where user_id in('privacy-1','privacy-2','privacy-3');
insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status)
select user_id,auth_id,auth_id,'privacy-contract-'||user_id,'Synthetic trusted browser',true,'trusted' from public.profiles where user_id in('privacy-1','privacy-2','privacy-3');
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status) values('privacy-3','creator','global','active');
insert into public.creator_elevation_grants(creator_elevation_id,creator_user_id,auth_user_id,auth_session_id,action_classes,expires_at,verification_method)
values('99700000-9000-4000-8000-000000000001','privacy-3','99700000-0000-4000-8000-000000000003','99700000-0000-4000-8000-000000000003',array['all_sensitive'],now()+interval '5 minutes','password');
set local session_replication_role=origin;

set local session_replication_role=replica;
update public.profiles set bio='Synthetic personal biography',banned_reason='INTERNAL-REASON-NEVER-EXPORT' where user_id='privacy-1';
insert into public.worker_services(id,worker_id,service_name,price,price_type)
 select ('99700000-3000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'privacy-1','Export fixture '||n,1000,'per_job' from generate_series(1,27)n;
insert into public.worker_services(id,worker_id,service_name,price,price_type)
 values('99700000-3000-4000-8001-000000000001','privacy-2','OTHER-ACCOUNT-SECRET',1000,'per_job');
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"sub":"99700000-0000-4000-8000-000000000001","session_id":"99700000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$declare r jsonb;begin
 r:=public.send_my_first_contextual_help_message(public.create_my_support_message_draft(),'personal_data_access','account','privacy-1','Get a copy of my data','{"requester_workspace":"personal"}','Please review and prepare my account records.',array[]::text[],array[]::text[]);
 perform set_config('test.export_conversation',r->>'conversation_id',true);
 r:=public.get_personal_data_case_review(current_setting('test.export_conversation')::uuid);
 if r#>>'{export,can_download}'<>'false' or r#>>'{export,approval_id}' is not null then raise exception 'Unreviewed export became available';end if;
 begin perform public.get_my_personal_data_export_page(current_setting('test.export_conversation')::uuid,gen_random_uuid(),'account',null);raise exception 'FAIL: unapproved export allowed';exception when insufficient_privilege then null;end;
 begin perform public.set_personal_data_export_access(gen_random_uuid(),current_setting('test.export_conversation')::uuid,(r->>'revision')::timestamptz,true,null);raise exception 'FAIL: self approval allowed';exception when insufficient_privilege then null;end;
 if has_function_privilege('anon','public.get_my_personal_data_export_page(uuid,uuid,text,text)','execute')
 or has_function_privilege('authenticated','private.personal_data_export_sources()','execute')
 or has_function_privilege('authenticated','private.personal_data_case_review_before_export(uuid)','execute') then raise exception 'Private export authority is exposed';end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"99700000-0000-4000-8000-000000000003","session_id":"99700000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select public.claim_my_communication_case(current_setting('test.export_conversation')::uuid);
do $$declare r jsonb;revision timestamptz;begin
 r:=public.get_personal_data_case_review(current_setting('test.export_conversation')::uuid);revision:=(r->>'revision')::timestamptz;
 perform set_config('test.export_revision',revision::text,true);
 begin perform public.set_personal_data_export_access(gen_random_uuid(),current_setting('test.export_conversation')::uuid,revision,true,null);raise exception 'FAIL: missing step-up allowed';exception when raise_exception then if sqlerrm<>'Recent Creator confirmation required' then raise;end if;end;
 begin perform public.set_personal_data_export_access(gen_random_uuid(),current_setting('test.export_conversation')::uuid,revision-interval '1 hour',true,'99700000-9000-4000-8000-000000000001');raise exception 'FAIL: stale approval allowed';exception when serialization_failure then null;end;
 r:=public.set_personal_data_export_access('99700000-4000-4000-8000-000000000001',current_setting('test.export_conversation')::uuid,revision,true,'99700000-9000-4000-8000-000000000001');
 if r#>>'{export,approval_id}'<>'99700000-4000-4000-8000-000000000001' or r#>>'{export,can_download}'<>'false' or r->>'status' in('resolved','closed') then raise exception 'Approval resolved case or granted reviewer download';end if;
 perform public.set_personal_data_export_access('99700000-4000-4000-8000-000000000001',current_setting('test.export_conversation')::uuid,revision,true,'99700000-9000-4000-8000-000000000001');
 begin perform public.set_personal_data_export_access('99700000-4000-4000-8000-000000000001',current_setting('test.export_conversation')::uuid,revision,false,'99700000-9000-4000-8000-000000000001');raise exception 'FAIL: changed retry reused decision';exception when invalid_parameter_value then null;end;
 begin perform public.get_my_personal_data_export_page(current_setting('test.export_conversation')::uuid,'99700000-4000-4000-8000-000000000001','account',null);raise exception 'FAIL: reviewer downloaded customer private data';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"99700000-0000-4000-8000-000000000002","session_id":"99700000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $$begin
 begin perform public.get_my_personal_data_export_page(current_setting('test.export_conversation')::uuid,'99700000-4000-4000-8000-000000000001','account',null);raise exception 'FAIL: outsider downloaded customer private data';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"99700000-0000-4000-8000-000000000001","session_id":"99700000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$declare r jsonb;cursor_value text;s record;begin
 begin perform public.get_my_personal_data_export_page(current_setting('test.export_conversation')::uuid,'99700000-4000-4000-8000-000000000001','profiles',null);raise exception 'FAIL: arbitrary table export allowed';exception when invalid_parameter_value then null;end;
 begin perform public.get_my_personal_data_export_page(current_setting('test.export_conversation')::uuid,'99700000-4000-4000-8000-000000000001','services','99700000-3000-4000-8000-000000000026');raise exception 'FAIL: jumped past unread export records';exception when invalid_parameter_value then null;end;
 r:=public.get_my_personal_data_export_page(current_setting('test.export_conversation')::uuid,'99700000-4000-4000-8000-000000000001','account',null);
 if jsonb_array_length(r->'records')<>1 or r->'records'->0->>'bio'<>'Synthetic personal biography' or r::text like '%INTERNAL-REASON-NEVER-EXPORT%' or r::text like '%auth_id%' then raise exception 'Account export incomplete or leaked internal fields';end if;
 r:=public.get_my_personal_data_export_page(current_setting('test.export_conversation')::uuid,'99700000-4000-4000-8000-000000000001','services',null);cursor_value:=r->>'next_cursor';
 if jsonb_array_length(r->'records')<>25 or cursor_value is null or r::text like '%OTHER-ACCOUNT-SECRET%' then raise exception 'Export first page exceeded bounds or leaked another account';end if;
 perform public.get_my_personal_data_export_page(current_setting('test.export_conversation')::uuid,'99700000-4000-4000-8000-000000000001','services',null);
 r:=public.get_my_personal_data_export_page(current_setting('test.export_conversation')::uuid,'99700000-4000-4000-8000-000000000001','services',cursor_value);
 if jsonb_array_length(r->'records')<>2 or r->>'next_cursor' is not null then raise exception 'Export lost or duplicated records across pages';end if;
 r:=public.get_personal_data_case_review(current_setting('test.export_conversation')::uuid);
 if r#>>'{export,can_download}'<>'true' or not (r#>'{export,prepared_sections}') ? 'services' or r->>'status' in('resolved','closed') then raise exception 'Prepared section did not retain tracked request';end if;
 for s in select jsonb_array_elements_text(r#>'{export,sections}') as name loop
  perform public.get_my_personal_data_export_page(current_setting('test.export_conversation')::uuid,'99700000-4000-4000-8000-000000000001',s.name,null);
 end loop;
end $$;
reset role;
-- Another verified approval ID is still not an authorised receipt for this case.
select set_config('request.jwt.claims','{"sub":"99700000-0000-4000-8000-000000000003","session_id":"99700000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
do $$declare r jsonb;begin
 r:=public.get_personal_data_case_review(current_setting('test.export_conversation')::uuid);
 perform public.set_personal_data_export_access('99700000-4000-4000-8000-000000000002',current_setting('test.export_conversation')::uuid,(r->>'revision')::timestamptz,false,'99700000-9000-4000-8000-000000000001');
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"99700000-0000-4000-8000-000000000001","session_id":"99700000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$begin
 begin perform public.get_my_personal_data_export_page(current_setting('test.export_conversation')::uuid,'99700000-4000-4000-8000-000000000001','account',null);raise exception 'FAIL: withdrawn export still readable';exception when insufficient_privilege then null;end;
end $$;
reset role;
update public.user_sessions set is_active=false where user_id='privacy-1';
set local role authenticated;
do $$begin
 begin perform public.get_my_personal_data_export_page(current_setting('test.export_conversation')::uuid,'99700000-4000-4000-8000-000000000001','account',null);raise exception 'FAIL: ended session exported data';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'Reviewed exports enforce identity, independent assignment, fresh confirmation, private field allowlists, page continuity, retries, revocation and ended sessions; synthetic records rolled back' result;

