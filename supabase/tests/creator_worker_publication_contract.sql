\set ON_ERROR_STOP on
begin;
create function pg_temp.expect(value boolean, description text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAIL: %',description; end if;end$$;
grant execute on function pg_temp.expect(boolean,text) to authenticated,anon,service_role;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,account_kind,full_name,state,city,local_government,worker_occupation,worker_skills,worker_status,worker_verified,available) values
('93000000-0000-4000-8000-000000000001','pub-creator@example.invalid','pub-creator','creator',true,'consumer','Creator','Nasarawa','Lafia','Lafia',null,null,null,false,false),
('93000000-0000-4000-8000-000000000002','pub-worker@example.invalid','pub-worker','user',true,'consumer','Plumber','Nasarawa','Lafia','Lafia','Plumber','["Plumbing"]','verified',true,true),
('93000000-0000-4000-8000-000000000003','pub-customer@example.invalid','pub-customer','user',true,'consumer','Customer','Nasarawa','Lafia','Lafia',null,null,null,false,false);
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status) values('pub-creator','creator','global','active'),('pub-worker','worker','global','active');
insert into public.worker_service_coverage(worker_id,state,lga,areas) values('pub-worker','Nasarawa','Lafia','{}');
insert into public.creator_elevation_grants(creator_elevation_id,creator_user_id,auth_user_id,auth_session_id,action_classes,issued_at,expires_at,verification_method)
values('93000000-0000-4000-8000-000000000099','pub-creator','93000000-0000-4000-8000-000000000001','publication-session',array['all_sensitive'],now(),now()+interval '10 minutes','password');
insert into public.platform_settings(key,value,category,label,data_type,is_active) values
('worker_marketplace_launch_enabled','false','marketplace','Worker marketplace','boolean',true),
('worker_identity_checks_enabled','false','security','Identity requirement','boolean',true)
on conflict(key) do update set value=excluded.value,is_active=true;
-- Identity disabled explicitly is a policy exemption, not a synthetic face pass.
update public.legal_launch_approvals set status='pending',approved_at=null where gate_key='worker_marketplace';
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"sub":"93000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
do $$begin
 begin perform public.creator_get_worker_publication('pub-worker');raise exception 'FAIL: Customer received Creator controls';exception when others then if sqlerrm like 'FAIL:%' then raise;end if;end;
 perform pg_temp.expect((select count(*)=0 from public.get_public_workers() where user_id='pub-worker'),'Closed marketplace is hidden to ordinary customers');
end$$;
reset role;
select set_config('request.jwt.claims','{"sub":"93000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"publication-session"}',true);
set local role authenticated;
do $$declare outcome jsonb;begin
 begin perform public.creator_set_worker_marketplace(true,'Open reviewed discovery','93000000-0000-4000-8000-000000000099');raise exception 'FAIL: Unreviewed launch accepted';exception when others then if sqlerrm like 'FAIL:%' then raise;end if;end;
 begin perform public.creator_set_worker_publication('pub-worker',true,'Pause until inspection',null);raise exception 'FAIL: No elevation accepted';exception when others then if sqlerrm like 'FAIL:%' then raise;end if;end;
 outcome:=public.creator_record_worker_launch_review('Synthetic reviewer','rollback-only-review','Test-only marketplace review',now()-interval '1 day',now()+interval '7 days','93000000-0000-4000-8000-000000000099');
 perform pg_temp.expect(outcome->>'enabled'='false' and outcome->>'launch_approved'='true','Recording a review does not publish the marketplace');
 perform public.creator_set_worker_marketplace(true,'Open reviewed discovery','93000000-0000-4000-8000-000000000099');
end$$;
reset role;
select set_config('request.jwt.claims','{"sub":"93000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect((select count(*)=1 from public.get_public_workers() where user_id='pub-worker'),'Eligible free Worker is public after deliberate Creator opening');
reset role;
select set_config('request.jwt.claims','{"sub":"93000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"publication-session"}',true);
set local role authenticated;
select public.creator_set_worker_publication('pub-worker',true,'Pause this public listing','93000000-0000-4000-8000-000000000099');
reset role;
select pg_temp.expect((select role='user' and worker_verified=true and not coalesce(suspended,false) from public.profiles where user_id='pub-worker'),'Publication pause preserves Personal identity and review');
select pg_temp.expect(public._worker_publication_state('pub-worker')->>'eligible'='false','Paused worker cannot be discovered');
select pg_temp.expect((select count(*)=1 from public.admin_audit_log where action='creator_worker_publication' and target_id='pub-worker'),'Publication action is audited');
update public.workspace_role_assignments set status='revoked' where user_id='pub-creator' and workspace_role='creator';
set local role authenticated;
do $$begin
 begin perform public.creator_set_worker_publication('pub-worker',false,'Restore eligibility','93000000-0000-4000-8000-000000000099');raise exception 'FAIL: Revoked Creator kept control';exception when others then if sqlerrm like 'FAIL:%' then raise;end if;end;
end$$;
reset role;
rollback;
