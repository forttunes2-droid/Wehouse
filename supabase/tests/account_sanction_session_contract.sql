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

select set_config('request.jwt.claims','{"sub":"b8110000-0000-4000-8000-000000000002","session_id":"b8110000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $$begin
 begin perform public.admin_security_case_decision_v2('b8110000-2000-4000-8000-000000000001','suspend','Unauthorized attempt',now());raise exception 'FAIL: ordinary customer imposed a sanction';exception when raise_exception then if sqlerrm not like 'Admin or Creator account required%' then raise;end if;end;
 if has_function_privilege('authenticated','private.admin_security_case_decision_core(uuid,text,text)','execute') then raise exception 'FAIL: unversioned sanction core exposed';end if;
 if has_function_privilege('authenticated','public._set_account_suspension(text,text,boolean,text)','execute') then raise exception 'FAIL: raw suspension helper exposed';end if;
 begin perform public.creator_set_account_suspension('sanction-other',true,'Unauthorized Creator claim',gen_random_uuid());raise exception 'FAIL: ordinary account used Creator sanction command';exception when raise_exception then if sqlerrm not like 'Recent Creator authentication required%' then raise;end if;end;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"b8110000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$begin
 begin perform public.admin_security_case_decision_v2('b8110000-2000-4000-8000-000000000001','suspend','Missing trusted session',now());raise exception 'FAIL: untrusted session sanctioned an account';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub','b8110000-0000-4000-8000-000000000001','session_id','b8110000-0000-4000-8000-000000000001','role','authenticated','aal','aal2','amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',floor(extract(epoch from now())))))::text,true);
set local role authenticated;
do $$begin
 begin perform public.admin_security_case_decision('b8110000-2000-4000-8000-000000000001','suspend','Old client bypass');raise exception 'FAIL: old command bypassed expected-version check';exception when raise_exception then if sqlerrm not like 'Refresh the security case%' then raise;end if;end;
 begin perform public.admin_security_case_decision_v2('b8110000-2000-4000-8000-000000000001','suspend','Stale case','1970-01-01');raise exception 'FAIL: stale case imposed sanction';exception when raise_exception then if sqlerrm not like 'Security case changed%' then raise;end if;end;
 begin perform public.admin_security_case_decision_v2('b8110000-2000-4000-8000-000000000001','suspend','Investigation not escalated',now());raise exception 'FAIL: investigation bypassed escalation';exception when raise_exception then if sqlerrm not like 'Security investigation must be escalated%' then raise;end if;end;
 begin perform public.admin_security_case_decision_v2('b8110000-2000-4000-8000-000000000002','suspend','Outside branch',now());raise exception 'FAIL: out-of-branch sanction';exception when raise_exception then if sqlerrm not like 'Security case is outside your branch%' then raise;end if;end;
 begin perform public.admin_security_case_decision_v2('b8110000-2000-4000-8000-000000000003','suspend','Creator workspace protected',now());raise exception 'FAIL: user-role Creator was suspended';exception when raise_exception then if sqlerrm not like 'Cannot modify Creator%' then raise;end if;end;
end $$;
reset role;
update public.operational_cases set status='decision_ready' where operational_case_id='b8110000-2000-4000-8000-000000000001';
set local role authenticated;
do $$declare receipt jsonb;begin
 receipt:=public.admin_security_case_decision_v2('b8110000-2000-4000-8000-000000000001','suspend','Reviewed misconduct requires account restriction',now());
 if receipt->>'success'<>'true' or receipt->>'decision'<>'suspend' then raise exception 'FAIL: sanction receipt missing';end if;
end $$;
reset role;
do $$begin
 if exists(select 1 from auth.sessions where user_id='b8110000-0000-4000-8000-000000000002') or exists(select 1 from public.user_sessions where user_id='sanction-person' and is_active) then raise exception 'FAIL: restricted account retained devices';end if;
 if not exists(select 1 from auth.sessions where user_id='b8110000-0000-4000-8000-000000000003') then raise exception 'FAIL: unrelated account sessions were revoked';end if;
 if not exists(select 1 from public.booking_payments where payment_reference='SANCTION-RETAIN-RECORD' and amount=100) then raise exception 'FAIL: sanction erased a financial record';end if;
 if not exists(select 1 from public.profiles where user_id='sanction-person' and worker_status='verified' and worker_verified) then raise exception 'FAIL: suspension reset professional approval';end if;
 if (select to_jsonb(v) from public.worker_verifications v where worker_id='sanction-person') is distinct from (select evidence from sanction_evidence_before) then raise exception 'FAIL: suspension changed approved evidence';end if;
 if exists(select 1 from public.profiles where user_id='sanction-person' and available) then raise exception 'FAIL: suspended worker still accepts new work';end if;
 if not exists(select 1 from public.audit_logs where action='RESTRICTED_ACCOUNT_SESSIONS_ENDED' and target_id='sanction-person') then raise exception 'FAIL: session revocation was not audited';end if;
end $$;
select set_config('request.jwt.claims','{"sub":"b8110000-0000-4000-8000-000000000002","session_id":"b8110000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $$begin
 if public.current_profile_user_id() is not null then raise exception 'FAIL: suspended token remained an active actor';end if;
 begin perform public.get_my_payment_receipts('SANCTION-RETAIN-RECORD');raise exception 'FAIL: suspended token opened receipts';exception when raise_exception then if sqlerrm<>'Active account required' then raise;end if;end;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"b8110000-0000-4000-8000-000000000004","session_id":"b8110000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select public.creator_set_account_suspension('sanction-person',false,'Account review accepted; require a fresh sign-in','b8110000-9000-4000-8000-000000000001');
reset role;
do $$begin
 if not exists(select 1 from public.profiles where user_id='sanction-person' and worker_status='verified' and worker_verified) then raise exception 'FAIL: restore sent an approved worker back to onboarding';end if;
 if (select to_jsonb(v) from public.worker_verifications v where worker_id='sanction-person') is distinct from (select evidence from sanction_evidence_before) then raise exception 'FAIL: restore changed approved evidence';end if;
 if (select count(*) from public.workspace_role_assignments where user_id='sanction-person' and status='active' and workspace_role in('worker','property_partner'))<>2 then raise exception 'FAIL: restore changed workspace grants';end if;
 if exists(select 1 from public.profiles where user_id='sanction-person' and suspended) then raise exception 'FAIL: Creator restore not recorded';end if;
 if exists(select 1 from public.user_sessions where user_id='sanction-person' and is_active) or exists(select 1 from auth.sessions where user_id='b8110000-0000-4000-8000-000000000002') then raise exception 'FAIL: restoration resurrected ended sessions';end if;
end $$;
select set_config('request.jwt.claims','{"sub":"b8110000-0000-4000-8000-000000000002","session_id":"b8110000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $$begin
 begin perform public.get_my_payment_receipts('SANCTION-RETAIN-RECORD');raise exception 'FAIL: restored account reused an ended session';exception when raise_exception then if sqlerrm<>'Active account required' then raise;end if;end;
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$declare contact jsonb;begin
 contact:=public.get_public_account_support();if contact->>'email'<>'review@example.invalid' or (select count(*) from jsonb_object_keys(contact))<>1 then raise exception 'FAIL: public support contact unavailable or excess fields exposed';end if;
end $$;
reset role;
select 'Sanction role/scope/version/Creator guards, account-wide session revocation, retained payment records, restoration and public review contact passed' as result;
rollback;
