begin;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,state,city,local_government) values
 ('b8110000-0000-4000-8000-000000000001','sanction-admin@example.invalid','sanction-admin','user',true,'Nasarawa','Lafia','Lafia'),
 ('b8110000-0000-4000-8000-000000000002','sanction-person@example.invalid','sanction-person','worker',true,'Nasarawa','Lafia','Lafia'),
 ('b8110000-0000-4000-8000-000000000003','sanction-other@example.invalid','sanction-other','user',true,'Nasarawa','Keffi','Keffi'),
 ('b8110000-0000-4000-8000-000000000004','sanction-creator@example.invalid','sanction-creator','user',true,'Nasarawa','Lafia','Lafia');
insert into auth.users(id,email,email_confirmed_at) values('b8110000-0000-4000-8000-000000000001','sanction-admin@example.invalid',now());
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values('b8110000-f000-4000-8000-000000000001','b8110000-0000-4000-8000-000000000001','totp','verified',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at)
 select auth_id::uuid,auth_id::uuid,now(),now() from public.profiles where user_id like 'sanction-%';
insert into auth.sessions(id,user_id,created_at,updated_at) values('b8110000-0000-4000-8000-000000000006','b8110000-0000-4000-8000-000000000002',now(),now());
insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status)
 select user_id,auth_id,auth_id,'sanction-'||user_id,'Synthetic trusted browser',true,'trusted' from public.profiles where user_id like 'sanction-%';
insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status)
 values('sanction-person','b8110000-0000-4000-8000-000000000002','b8110000-0000-4000-8000-000000000006','sanction-second','Synthetic second device',true,'trusted');
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,scope_state,scope_lga,status) values
 ('sanction-admin','admin','branch','Nasarawa','Lafia','active'),
 ('sanction-creator','creator','global',null,null,'active'),
 ('sanction-person','worker','global',null,null,'active'),('sanction-person','property_partner','global',null,null,'active');
insert into public.creator_elevation_grants(creator_elevation_id,creator_user_id,auth_user_id,auth_session_id,action_classes,expires_at,verification_method)
 values('b8110000-9000-4000-8000-000000000001','sanction-creator','b8110000-0000-4000-8000-000000000004','b8110000-0000-4000-8000-000000000004',array['all_sensitive'],now()+interval '5 minutes','password');
insert into public.operational_cases(operational_case_id,case_number,reason_code,owning_domain,subject_type,subject_id,requester_user_id,state_scope,status,priority) overriding system value values
 ('b8110000-2000-4000-8000-000000000001',981110001,'account_compromise','security_operations','account','sanction-person','sanction-person','Nasarawa','open','normal'),
 ('b8110000-2000-4000-8000-000000000002',981110002,'account_compromise','security_operations','account','sanction-other','sanction-other','Nasarawa','decision_ready','normal'),
 ('b8110000-2000-4000-8000-000000000003',981110003,'account_compromise','security_operations','account','sanction-creator','sanction-creator','Nasarawa','decision_ready','normal');
insert into public.booking_payments(payment_reference,user_id,type,purpose,status,amount,currency)
 values('SANCTION-RETAIN-RECORD','sanction-person','apartment','apartment_rent','pending',100,'NGN');
update public.platform_settings set value='review@example.invalid' where key='support_email';
insert into public.platform_settings(key,value,category,label) select 'support_email','review@example.invalid','general','Support email' where not exists(select 1 from public.platform_settings where key='support_email');
update public.profiles set worker_status='verified',worker_verified=true,available=true where user_id='sanction-person';
insert into public.worker_verifications(worker_id,status,certificate_path,verification_video_url,reviewed_by,reviewed_at)
 values('sanction-person','verified','private/test-approved-certificate.pdf','private/test-approved-work-video.mp4','sanction-creator',now());
create temporary table sanction_evidence_before on commit drop as
 select to_jsonb(v) as evidence from public.worker_verifications v where worker_id='sanction-person';
set local session_replication_role=origin;

-- Creator restricts only Services; identity, Partner and approvals survive.
select set_config('request.jwt.claims','{"sub":"b8110000-0000-4000-8000-000000000004","session_id":"b8110000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select public.review_workspace_access('sanction-person','worker',true,'Service conduct review is required',null,'b8110000-9000-4000-8000-000000000001');
reset role;
select set_config('test.worker_version',(select version::text from private.workspace_restrictions where user_id='sanction-person' and workspace='worker'),true);
select set_config('request.jwt.claims','{"sub":"b8110000-0000-4000-8000-000000000002","session_id":"b8110000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $$declare result jsonb;begin
 if public.user_has_active_workspace('sanction-person','worker') then raise exception 'FAIL: restricted Services grant remained usable';end if;
 if not public.user_has_active_workspace('sanction-person','property_partner') then raise exception 'FAIL: Services restriction blocked Partner';end if;
 if public.current_profile_user_id()<>'sanction-person' then raise exception 'FAIL: workspace restriction suspended identity';end if;
 result:=public.get_my_workspace_access();
 if result->>'personal_workspace'<>'true' or result->'privileged_workspaces' @> '[{"role":"worker"}]'::jsonb then raise exception 'FAIL: wrong workspace projection';end if;
 update public.profiles set bio='Personal identity editing remains available' where user_id='sanction-person';
 begin update public.profiles set worker_occupation='Disallowed occupation edit' where user_id='sanction-person';raise exception 'FAIL: restricted professional mutation';exception when insufficient_privilege then null;end;
 if has_function_privilege('authenticated','private.account_review_portal(text,text,text,uuid,uuid,text,uuid)','execute') then raise exception 'FAIL: private review identity substitution exposed';end if;
 begin perform public.account_recovery_portal(repeat('a',64));raise exception 'FAIL: service recovery bypass';exception when insufficient_privilege then null;end;
 result:=public.my_account_reviews('worker','Please review the existing approved professional evidence.',current_setting('test.worker_version')::uuid);
 if jsonb_array_length(result->'appeals')<>1 then raise exception 'FAIL: missing review receipt';end if;
 perform public.my_account_reviews('worker','Retry after an uncertain response must reuse the receipt.',current_setting('test.worker_version')::uuid);
end $$;
reset role;
do $$begin
 if (select count(*) from private.workspace_appeals where user_id='sanction-person')<>1 then raise exception 'FAIL: duplicate appeal';end if;
 if not exists(select 1 from public.profiles where user_id='sanction-person' and worker_status='verified' and worker_verified and not suspended) then raise exception 'FAIL: restriction reset approval';end if;
 if (select to_jsonb(v) from public.worker_verifications v where worker_id='sanction-person') is distinct from (select evidence from sanction_evidence_before) then raise exception 'FAIL: restriction changed evidence';end if;
end $$;
select set_config('test.case_id',(select case_id::text from private.workspace_appeals where user_id='sanction-person'),true);
select set_config('test.case_version',(select updated_at::text from public.operational_cases where operational_case_id=current_setting('test.case_id')::uuid),true);

-- An unrelated account cannot read the appeal, even with a valid device.
select set_config('request.jwt.claims','{"sub":"b8110000-0000-4000-8000-000000000003","session_id":"b8110000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
do $$declare result jsonb;begin
 result:=public.my_account_reviews();
 if jsonb_array_length(result->'appeals')<>0 then raise exception 'FAIL: outsider read another appeal';end if;
 begin perform public.decide_account_review(current_setting('test.case_id')::uuid,'restored','Unauthorized restoration attempt','',current_setting('test.case_version')::timestamptz,gen_random_uuid());raise exception 'FAIL: outsider decided appeal';exception when insufficient_privilege then null;end;
end $$;
reset role;

-- Assigned review, private notes, request for information and idempotent reply.
select set_config('request.jwt.claims','{"sub":"b8110000-0000-4000-8000-000000000004","session_id":"b8110000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
do $$begin
 begin perform public.decide_account_review(current_setting('test.case_id')::uuid,'restored','Cannot decide before assignment','',current_setting('test.case_version')::timestamptz,'b8110000-9000-4000-8000-000000000001');raise exception 'FAIL: unassigned restoration';exception when raise_exception then if sqlerrm<>'Claim the open review before deciding' then raise;end if;end;
 perform public.decide_account_review(current_setting('test.case_id')::uuid,'claim','We are reviewing the conduct report.','PRIVATE-REVIEW-NOTE',current_setting('test.case_version')::timestamptz,'b8110000-9000-4000-8000-000000000001');
end $$;
reset role;
select set_config('test.case_version',(select updated_at::text from public.operational_cases where operational_case_id=current_setting('test.case_id')::uuid),true);
set local role authenticated;
select public.decide_account_review(current_setting('test.case_id')::uuid,'request_information','Please explain the disputed event; no evidence re-upload is required.','PRIVATE-SECOND-NOTE',current_setting('test.case_version')::timestamptz,'b8110000-9000-4000-8000-000000000001');
reset role;
select set_config('request.jwt.claims','{"sub":"b8110000-0000-4000-8000-000000000002","session_id":"b8110000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $$declare result jsonb;begin
 result:=public.my_account_reviews();
 if result::text like '%PRIVATE-%' then raise exception 'FAIL: internal notes leaked to appellant';end if;
 if result->'appeals'->0->>'status'<>'waiting_customer' then raise exception 'FAIL: information request not visible';end if;
 perform public.my_account_reviews(null,null,null,current_setting('test.case_id')::uuid,'The reference belongs to a different job. Existing evidence is current.','b8110000-a000-4000-8000-000000000001');
 perform public.my_account_reviews(null,null,null,current_setting('test.case_id')::uuid,'Retry must not create another reply.','b8110000-a000-4000-8000-000000000001');
end $$;
reset role;
do $$begin
 if (select count(*) from public.operational_case_events where event_key='appeal_reply:b8110000-a000-4000-8000-000000000001')<>1 then raise exception 'FAIL: duplicate reply';end if;
end $$;
select set_config('test.case_version',(select updated_at::text from public.operational_cases where operational_case_id=current_setting('test.case_id')::uuid),true);
select set_config('request.jwt.claims','{"sub":"b8110000-0000-4000-8000-000000000004","session_id":"b8110000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select public.decide_account_review(current_setting('test.case_id')::uuid,'restored','Review accepted. Your Services workspace access is restored.','PRIVATE-FINAL-NOTE',current_setting('test.case_version')::timestamptz,'b8110000-9000-4000-8000-000000000001');
reset role;
do $$begin
 if exists(select 1 from private.workspace_restrictions where user_id='sanction-person' and workspace='worker' and restricted) then raise exception 'FAIL: reviewed workspace not restored';end if;
 if not exists(select 1 from public.profiles where user_id='sanction-person' and worker_status='verified' and worker_verified) then raise exception 'FAIL: appeal reset professional approval';end if;
 if not exists(select 1 from auth.sessions where id='b8110000-0000-4000-8000-000000000002') then raise exception 'FAIL: workspace appeal forced identity sign-out';end if;
 if not exists(select 1 from public.notifications where recipient_id='sanction-person' and type='account_review_update' and destination_route='account_reviews') then raise exception 'FAIL: decision notification not connected';end if;
end $$;

-- Independently restrict Personal and Partner; restoring Personal keeps Partner restricted.
set local role authenticated;
select public.review_workspace_access('sanction-person','personal',true,'Personal matching conduct review',null,'b8110000-9000-4000-8000-000000000001');
select public.review_workspace_access('sanction-person','property_partner',true,'Property conduct review remains open',null,'b8110000-9000-4000-8000-000000000001');
reset role;
select set_config('test.personal_version',(select version::text from private.workspace_restrictions where user_id='sanction-person' and workspace='personal'),true);
select set_config('request.jwt.claims','{"sub":"b8110000-0000-4000-8000-000000000002","session_id":"b8110000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $$declare result jsonb;begin
 result:=public.get_my_workspace_access();
 if result->>'personal_workspace'<>'false' or not result->'privileged_workspaces' @> '[{"role":"worker"}]'::jsonb then raise exception 'FAIL: Personal restriction blocked Services';end if;
 begin perform public.send_friend_request('sanction-other');raise exception 'FAIL: restricted Personal action';exception when insufficient_privilege then null;end;
 perform public.my_account_reviews(); -- Account review/security remain available.
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"b8110000-0000-4000-8000-000000000004","session_id":"b8110000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select public.review_workspace_access('sanction-person','personal',false,'Personal review has been resolved',current_setting('test.personal_version')::uuid,'b8110000-9000-4000-8000-000000000001');
reset role;
do $$begin
 if public.workspace_access_allowed('sanction-person','property_partner') or not public.workspace_access_allowed('sanction-person','personal') then raise exception 'FAIL: restore crossed workspace boundary';end if;
end $$;

-- Account access removal is not deletion and keeps existing work evidence.
set local role authenticated;
select public.creator_ban_user('sanction-person','Serious misconduct requires an account access decision','b8110000-9000-4000-8000-000000000001');
reset role;
do $$begin
 if not exists(select 1 from public.profiles where user_id='sanction-person' and banned and not coalesce(deleted,false) and worker_verified and worker_status='verified') then raise exception 'FAIL: account access removal deleted identity or approval';end if;
 if (select to_jsonb(v) from public.worker_verifications v where worker_id='sanction-person') is distinct from (select evidence from sanction_evidence_before) then raise exception 'FAIL: account removal changed professional evidence';end if;
end $$;
-- Restore the fixture for independent branch/recovery tests; this does not reopen old sessions.
select set_config('test.account_version',(select version::text from private.workspace_restrictions where user_id='sanction-person' and workspace='account'),true);

-- Existing Admin endpoints and new scoped controls require fresh MFA and branch scope.
select set_config('request.jwt.claims','{"sub":"b8110000-0000-4000-8000-000000000001","session_id":"b8110000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$begin
 begin perform public.admin_suspend_user('sanction-person','Missing fresh confirmation');raise exception 'FAIL: old Admin path bypassed MFA';exception when raise_exception then if sqlerrm<>'Fresh Admin authenticator confirmation required' then raise;end if;end;
 begin perform public.review_workspace_access('sanction-person','worker',true,'Missing fresh confirmation');raise exception 'FAIL: scoped Admin path bypassed MFA';exception when raise_exception then if sqlerrm<>'Fresh Admin authenticator confirmation required' then raise;end if;end;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub','b8110000-0000-4000-8000-000000000001','session_id','b8110000-0000-4000-8000-000000000001','role','authenticated','aal','aal2','amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',floor(extract(epoch from now())))))::text,true);
set local role authenticated;
do $$declare receipt jsonb;begin
 receipt:=public.review_workspace_access('sanction-person');
 if receipt->'workspaces' @> '["staff"]'::jsonb then raise exception 'FAIL: Admin offered Creator-only team control';end if;
 begin perform public.review_workspace_access('sanction-other');raise exception 'FAIL: Admin read outside branch';exception when raise_exception then if sqlerrm<>'Review is outside your scope' then raise;end if;end;
 begin perform public.review_workspace_access('sanction-person','worker',true,'Stale Services workspace decision',gen_random_uuid(),null);raise exception 'FAIL: stale revision accepted';exception when raise_exception then if sqlerrm not like 'Workspace access changed%' then raise;end if;end;
end $$;
reset role;
-- Security Operations investigates within its own domain scope, never decides access.
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,state,city,local_government) values('b8110000-0000-4000-8000-000000000005','security@example.invalid','sanction-security','user',true,'Nasarawa','Lafia','Lafia');
insert into auth.sessions(id,user_id,created_at,updated_at) values('b8110000-0000-4000-8000-000000000005','b8110000-0000-4000-8000-000000000005',now(),now());
insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status) values('sanction-security','b8110000-0000-4000-8000-000000000005','b8110000-0000-4000-8000-000000000005','security-device','Test browser',true,'trusted');
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,scope_state,scope_lga,status) values('sanction-security','staff','global',null,null,'active'),('sanction-security','security_operations','branch','Nasarawa','Lafia','active');
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"sub":"b8110000-0000-4000-8000-000000000005","session_id":"b8110000-0000-4000-8000-000000000005","role":"authenticated"}',true);
set local role authenticated;
do $$begin
 perform public.review_workspace_access('sanction-person');
 begin perform public.review_workspace_access('sanction-other');raise exception 'FAIL: global staff grant widened Security branch';exception when raise_exception then if sqlerrm<>'Review is outside your scope' then raise;end if;end;
 begin perform public.review_workspace_access('sanction-person','worker',true,'Staff cannot impose access decision');raise exception 'FAIL: Staff decided access';exception when raise_exception then if sqlerrm<>'Security Operations investigates; Admin or Creator decides access' then raise;end if;end;
end $$;
reset role;
update public.workspace_role_assignments set revoked_at=now() where user_id='sanction-security' and workspace_role='security_operations';
set local role authenticated;
do $$begin
 begin perform public.review_workspace_access('sanction-person');raise exception 'FAIL: revoked domain scope retained access';exception when insufficient_privilege or raise_exception then if sqlerrm not in('Review is outside your scope','Authorized account review workspace required') then raise;end if;end;
end $$;
reset role;

-- The recovery-only exchange revokes its Auth bearer and stores only a token hash.
set local session_replication_role=replica;
insert into auth.users(id,email,email_confirmed_at) values('b8110000-0000-4000-8000-000000000002','sanction-person@example.invalid',now());
insert into auth.sessions(id,user_id,created_at,updated_at) values('b8110000-0000-4000-8000-000000000007','b8110000-0000-4000-8000-000000000002',now(),now());
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.bind_account_recovery_session('b8110000-0000-4000-8000-000000000002','b8110000-0000-4000-8000-000000000007',repeat('a',64));
do $$declare result jsonb;begin
 result:=public.account_recovery_portal(repeat('a',64));
 if jsonb_array_length(result->'appeals')<>1 or result::text like '%PRIVATE-%' then raise exception 'FAIL: recovery projection';end if;
 begin perform public.account_recovery_portal(repeat('b',64));raise exception 'FAIL: wrong recovery token';exception when raise_exception then if sqlerrm<>'Verify account ownership again' then raise;end if;end;
end $$;
reset role;
do $$begin
 if exists(select 1 from auth.sessions where id='b8110000-0000-4000-8000-000000000007') then raise exception 'FAIL: recovery returned a marketplace Auth session';end if;
 if not exists(select 1 from private.recovery_sessions where token_hash=extensions.digest(repeat('a',64),'sha256')) then raise exception 'FAIL: token hash not bound';end if;
end $$;
-- Signed-out person appeals whole-account removal; Creator restores that exact revision.
set local role service_role;
select public.account_recovery_portal(repeat('a',64),'account','Please review this account decision using the retained evidence.',current_setting('test.account_version')::uuid);
reset role;
select set_config('test.account_case',(select case_id::text from private.workspace_appeals where user_id='sanction-person' and workspace='account'),true);
update public.workspace_role_assignments set revoked_at=null where user_id='sanction-security' and workspace_role='security_operations';
select set_config('request.jwt.claims','{"sub":"b8110000-0000-4000-8000-000000000005","session_id":"b8110000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select set_config('test.case_version',(select updated_at::text from public.operational_cases where operational_case_id=current_setting('test.account_case')::uuid),true);
set local role authenticated;
select public.decide_account_review(current_setting('test.account_case')::uuid,'claim','Security Operations is examining the existing case evidence.',null,current_setting('test.case_version')::timestamptz,null);
reset role;
select set_config('test.case_version',(select updated_at::text from public.operational_cases where operational_case_id=current_setting('test.account_case')::uuid),true);
set local role authenticated;
select public.decide_account_review(current_setting('test.account_case')::uuid,'escalate','Investigation complete. An authorized account reviewer will decide.',null,current_setting('test.case_version')::timestamptz,null);
reset role;
do $$begin
 if not exists(select 1 from public.operational_cases where operational_case_id=current_setting('test.account_case')::uuid and status='decision_ready') then raise exception 'FAIL: Security handoff did not reach decision queue';end if;
end $$;

select set_config('request.jwt.claims','{"sub":"b8110000-0000-4000-8000-000000000004","session_id":"b8110000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select set_config('test.case_version',(select updated_at::text from public.operational_cases where operational_case_id=current_setting('test.account_case')::uuid),true);
set local role authenticated;
select public.decide_account_review(current_setting('test.account_case')::uuid,'claim','Account review has been assigned to an authorized reviewer.',null,current_setting('test.case_version')::timestamptz,null);
reset role;
select set_config('test.case_version',(select updated_at::text from public.operational_cases where operational_case_id=current_setting('test.account_case')::uuid),true);
set local role authenticated;
select public.decide_account_review(current_setting('test.account_case')::uuid,'restored','Account review accepted. Sign in again to use your account.',null,current_setting('test.case_version')::timestamptz,'b8110000-9000-4000-8000-000000000001');
reset role;
do $$begin
 if exists(select 1 from public.profiles where user_id='sanction-person' and (banned or suspended)) then raise exception 'FAIL: account decision not restored';end if;
 if exists(select 1 from auth.sessions where user_id='b8110000-0000-4000-8000-000000000002') then raise exception 'FAIL: account appeal resurrected marketplace sessions';end if;
 if (select to_jsonb(v) from public.worker_verifications v where worker_id='sanction-person') is distinct from (select evidence from sanction_evidence_before) then raise exception 'FAIL: account appeal changed work evidence';end if;
 if not exists(select 1 from private.workspace_restrictions where user_id='sanction-person' and workspace='property_partner' and restricted) then raise exception 'FAIL: account appeal cleared independent workspace restriction';end if;
end $$;
insert into private.recovery_sessions(token_hash,user_id,expires_at) values(extensions.digest(repeat('b',64),'sha256'),'sanction-person',now()+interval '30 minutes');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.close_account_recovery_session(repeat('b',64));
do $$begin
 begin perform public.account_recovery_portal(repeat('b',64));raise exception 'FAIL: closed recovery session still valid';exception when raise_exception then if sqlerrm<>'Verify account ownership again' then raise;end if;end;
end $$;
reset role;
update private.recovery_sessions set expires_at=now()-interval '1 second';
set local role service_role;
do $$begin
 begin perform public.account_recovery_portal(repeat('a',64));raise exception 'FAIL: expired recovery token';exception when raise_exception then if sqlerrm<>'Verify account ownership again' then raise;end if;end;
end $$;
reset role;
select 'Workspace isolation, preserved approvals/evidence, tracked appeal/assignment/reply/decision, notifications and recovery token boundaries passed' as result;
rollback;

