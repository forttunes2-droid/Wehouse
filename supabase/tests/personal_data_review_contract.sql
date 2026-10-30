-- Real trusted commands, synthetic identities, no provider calls or data erasure.
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
select set_config('request.jwt.claims','{"sub":"99700000-0000-4000-8000-000000000001","session_id":"99700000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$declare r jsonb;draft uuid:=public.create_my_support_message_draft();begin
 begin perform public.send_my_first_contextual_help_message(draft,'personal_data_deletion','account','privacy-2','Not my account','{"requester_workspace":"personal"}','Denied request for another account.',array[]::text[],array[]::text[]);raise exception 'FAIL: requested another account';exception when raise_exception then if sqlerrm<>'Subject access required' then raise;end if;end;
 r:=public.send_my_first_contextual_help_message(draft,'personal_data_deletion','account','privacy-1','Request data deletion','{"requester_workspace":"personal"}','Please review the personal information that can be deleted.',array[]::text[],array[]::text[]);
 perform set_config('test.privacy_conversation',r->>'conversation_id',true);
 if r->>'conversation_id' is null then raise exception 'Request did not reach canonical Help';end if;
 perform public.send_my_first_contextual_help_message(draft,'personal_data_deletion','account','privacy-1','Request data deletion','{"requester_workspace":"personal"}','Please review the personal information that can be deleted.',array[]::text[],array[]::text[]);
 r:=public.get_personal_data_case_review(current_setting('test.privacy_conversation')::uuid);
 if r->>'can_respond'<>'false' or r->'response'<>'null'::jsonb then raise exception 'Requester may resolve its own data review';end if;
 if has_table_privilege('authenticated','public.operational_case_events','INSERT') or has_table_privilege('authenticated','public.operational_case_events','SELECT')
  or has_table_privilege('authenticated','public.operational_cases','UPDATE') or has_function_privilege('anon','public.get_personal_data_case_review(uuid)','EXECUTE') then raise exception 'Case audit authority is browser-writable or anonymously readable';end if;
end $$;
reset role;
do $$begin if (select count(*) from public.operational_cases where requester_user_id='privacy-1' and reason_code='personal_data_deletion')<>1 then raise exception 'Help retry duplicated privacy case';end if;end $$;
select set_config('request.jwt.claims','{"sub":"99700000-0000-4000-8000-000000000002","session_id":"99700000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $$begin
 begin perform public.get_personal_data_case_review(current_setting('test.privacy_conversation')::uuid);raise exception 'FAIL: unrelated account read privacy response';exception when insufficient_privilege then null;end;
 begin perform public.respond_to_personal_data_case(gen_random_uuid(),current_setting('test.privacy_conversation')::uuid,now(),'completed','A synthetic review response for denied caller.','',null);raise exception 'FAIL: customer reviewed another account';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"99700000-0000-4000-8000-000000000003","session_id":"99700000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select public.claim_my_communication_case(current_setting('test.privacy_conversation')::uuid);
do $$declare r jsonb;begin
 begin perform public.transition_my_support_case(current_setting('test.privacy_conversation')::uuid,'resolve','A generic note cannot stand in for a review.');raise exception 'FAIL: generic resolution bypassed review';exception when insufficient_privilege then null;end;
 r:=public.get_personal_data_case_review(current_setting('test.privacy_conversation')::uuid);
 perform set_config('test.privacy_revision',r->>'revision',true);
 if r->>'can_respond'<>'true' or r->>'status'='resolved' then raise exception 'Failed resolution partially mutated the request';end if;
 begin perform public.respond_to_personal_data_case(gen_random_uuid(),current_setting('test.privacy_conversation')::uuid,(r->>'revision')::timestamptz,'completed','Synthetic reviewed work, never actual erased data.','',null);raise exception 'FAIL: missing step-up accepted';exception when raise_exception then if sqlerrm<>'Recent Creator confirmation required' then raise;end if;end;
 begin perform public.respond_to_personal_data_case(gen_random_uuid(),current_setting('test.privacy_conversation')::uuid,now()-interval '1 hour','completed','Synthetic reviewed work, never actual erased data.','','99700000-9000-4000-8000-000000000001');raise exception 'FAIL: stale review accepted';exception when serialization_failure then null;end;
 begin perform public.respond_to_personal_data_case(gen_random_uuid(),current_setting('test.privacy_conversation')::uuid,(r->>'revision')::timestamptz,'partly_completed','Synthetic reviewed work, never actual erased data.','','99700000-9000-4000-8000-000000000001');raise exception 'FAIL: partial response omitted retention reason';exception when invalid_parameter_value then null;end;
 r:=public.respond_to_personal_data_case('99700000-2000-4000-8000-000000000001',current_setting('test.privacy_conversation')::uuid,current_setting('test.privacy_revision')::timestamptz,'partly_completed','Synthetic completed-work description; no real data erased.','Synthetic retained booking record for unresolved financial claim.','99700000-9000-4000-8000-000000000001');
 if r->>'status'<>'resolved' or r#>>'{response,outcome}'<>'partly_completed' or r->>'can_respond'<>'false' then raise exception 'Response did not resolve canonical case';end if;
 perform public.respond_to_personal_data_case('99700000-2000-4000-8000-000000000001',current_setting('test.privacy_conversation')::uuid,current_setting('test.privacy_revision')::timestamptz,'partly_completed','Synthetic completed-work description; no real data erased.','Synthetic retained booking record for unresolved financial claim.','99700000-9000-4000-8000-000000000001');
 begin perform public.respond_to_personal_data_case('99700000-2000-4000-8000-000000000001',current_setting('test.privacy_conversation')::uuid,current_setting('test.privacy_revision')::timestamptz,'partly_completed','Changed payload must not reuse a response receipt.','Synthetic retained booking record for unresolved financial claim.','99700000-9000-4000-8000-000000000001');raise exception 'FAIL: changed response replay accepted';exception when invalid_parameter_value then null;end;
 perform public.transition_my_support_case(current_setting('test.privacy_conversation')::uuid,'close',null);
end $$;
reset role;
do $$begin
 if (select count(*) from public.operational_case_events where event_key='personal_data_response:99700000-2000-4000-8000-000000000001')<>1 then raise exception 'Duplicate final response';end if;
 if (select count(*) from public.partner_support_messages where conversation_id=current_setting('test.privacy_conversation')::uuid and action_metadata->>'event_type'='resolved')<>1 then raise exception 'No single customer-visible resolution';end if;
end $$;
select set_config('request.jwt.claims','{"sub":"99700000-0000-4000-8000-000000000001","session_id":"99700000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$declare r jsonb;begin
 r:=public.get_personal_data_case_review(current_setting('test.privacy_conversation')::uuid);
 if r#>>'{response,retained}' not like '%unresolved financial claim%' or r::text like '%resolution_transaction%' or r::text like '%payload%' then raise exception 'Requester response missing or internal metadata exposed';end if;
end $$;
reset role;
update public.user_sessions set is_active=false where user_id='privacy-1';
set local role authenticated;
do $$begin
 begin perform public.get_personal_data_case_review(current_setting('test.privacy_conversation')::uuid);raise exception 'FAIL: revoked session read privacy review';exception when insufficient_privilege then null;end;
 begin perform public.send_my_first_contextual_help_message(public.create_my_support_message_draft(),'personal_data_access','account','privacy-1','Denied ended session','{"requester_workspace":"personal"}','Denied ended-session request.',array[]::text[],array[]::text[]);raise exception 'FAIL: revoked session opened data request';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'Personal data intake, ownership, assignment, step-up, stale/retried decisions, public response and revoked sessions pass; fixtures rolled back' result;
