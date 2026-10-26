begin;
create function pg_temp.expect(value boolean,description text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAIL: %',description;end if;end$$;
create function pg_temp.rejects(statement text) returns boolean language plpgsql as $$begin execute statement;return false;exception when others then return true;end$$;
create function pg_temp.rejects_with(statement text,expected text) returns boolean language plpgsql as $$begin execute statement;return false;exception when others then return position(expected in sqlerrm)>0;end$$;
grant execute on function pg_temp.expect(boolean,text),pg_temp.rejects(text) to authenticated;
set local session_replication_role=replica;
insert into auth.users(id,aud,role,email,created_at,updated_at) values
('f8610000-0000-4000-8000-000000000001','authenticated','authenticated','credential-worker@example.invalid',now(),now()),
('f8610000-0000-4000-8000-000000000002','authenticated','authenticated','credential-reviewer@example.invalid',now(),now()),
('f8610000-0000-4000-8000-000000000003','authenticated','authenticated','credential-wrong@example.invalid',now(),now());
insert into public.profiles(auth_id,email,user_id,role,profile_complete,full_name,state,city,local_government,worker_occupation,worker_skills) values
('f8610000-0000-4000-8000-000000000001','credential-worker@example.invalid','credential-worker','user',true,'Credential Worker','Lagos','Ikeja','Ikeja','Electrician','["Electrical repairs"]'),
('f8610000-0000-4000-8000-000000000002','credential-reviewer@example.invalid','credential-reviewer','user',true,'Credential Reviewer','Lagos','Ikeja','Ikeja',null,'[]'),
('f8610000-0000-4000-8000-000000000003','credential-wrong@example.invalid','credential-wrong','user',true,'Wrong Area Reviewer','Abuja','Garki','Garki',null,'[]');
insert into auth.sessions(id,user_id,created_at,updated_at) values
('f8610000-1000-4000-8000-000000000001','f8610000-0000-4000-8000-000000000001',now(),now()),
('f8610000-1000-4000-8000-000000000002','f8610000-0000-4000-8000-000000000002',now(),now()),
('f8610000-1000-4000-8000-000000000003','f8610000-0000-4000-8000-000000000003',now(),now());
insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status) values
('credential-worker','f8610000-0000-4000-8000-000000000001','f8610000-1000-4000-8000-000000000001','credential-device-worker','Browser',true,'trusted'),
('credential-reviewer','f8610000-0000-4000-8000-000000000002','f8610000-1000-4000-8000-000000000002','credential-device-reviewer','Browser',true,'trusted'),
('credential-wrong','f8610000-0000-4000-8000-000000000003','f8610000-1000-4000-8000-000000000003','credential-device-wrong','Browser',true,'trusted');
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,scope_state,scope_lga) values
('credential-worker','worker','global',null,null),('credential-worker','creator','global',null,null),
('credential-reviewer','admin','branch','Lagos','Ikeja'),('credential-wrong','admin','state','Abuja',null);
insert into public.worker_service_coverage(worker_id,state,lga) values('credential-worker','Lagos','Ikeja');
insert into public.worker_verifications(worker_id,status,verification_video_url) values('credential-worker','profile_under_review','credential-worker/work.mp4');
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"sub":"f8610000-0000-4000-8000-000000000001","session_id":"f8610000-1000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect(not (public.get_worker_credential_review('credential-worker')->>'configured')::boolean,'unconfigured credentials are not approved');
select pg_temp.expect(pg_temp.rejects($$select public.configure_worker_credential_requirements('credential-worker',0,'[]','Self review is not acceptable even for an owning Creator')$$),'own Creator cannot configure own requirements');
select pg_temp.expect(pg_temp.rejects($$select public.begin_worker_credential_upload('credential-worker','licence',gen_random_uuid(),'application/pdf',12,'licence.pdf')$$),'uploads closed until requirements accepted');
select set_config('request.jwt.claims','{"sub":"f8610000-0000-4000-8000-000000000003","session_id":"f8610000-1000-4000-8000-000000000003","role":"authenticated"}',true);
select pg_temp.expect(pg_temp.rejects($$select public.get_worker_credential_review('credential-worker')$$),'out-of-area Admin denied');
select set_config('request.jwt.claims','{"sub":"f8610000-0000-4000-8000-000000000002","session_id":"f8610000-1000-4000-8000-000000000002","role":"authenticated"}',true);
select public.configure_worker_credential_requirements('credential-worker',0,'[{"code":"licence","label":"Accepted trade licence","instructions":"Provide the current accepted qualification for this service and operating area.","requires_expiry":true}]','Test-only acceptance of the applicable service licence and accepted alternatives.');
select pg_temp.expect(pg_temp.rejects($$select public.configure_worker_credential_requirements('credential-worker',0,'[]','An obsolete review must not overwrite the current decision.')$$),'stale requirement revision denied');
select set_config('request.jwt.claims','{"sub":"f8610000-0000-4000-8000-000000000001","session_id":"f8610000-1000-4000-8000-000000000001","role":"authenticated"}',true);
create temp table credential_upload as select public.begin_worker_credential_upload('credential-worker','licence','f8610000-3000-4000-8000-000000000001','application/pdf',12,'licence.pdf') as doc;
select pg_temp.expect(pg_temp.rejects($$select public.finish_worker_credential_upload((select (doc->>'id')::uuid from credential_upload))$$),'absent storage object is not a submitted credential');
select public.reserve_my_media_upload('worker-credentials',doc->>'object_path') from credential_upload;
insert into storage.objects(bucket_id,name,metadata,version) select 'worker-credentials',doc->>'object_path','{"size":12,"mimetype":"application/pdf"}'::jsonb,gen_random_uuid()::text from credential_upload;
select public.finish_worker_credential_upload((select (doc->>'id')::uuid from credential_upload));
select pg_temp.expect(pg_temp.rejects($$select public.review_worker_credential((select (doc->>'id')::uuid from credential_upload),'approved','Self approval is forbidden',now()+interval '1 year')$$),'Worker cannot self-approve credential');
select set_config('request.jwt.claims','{"sub":"f8610000-0000-4000-8000-000000000002","session_id":"f8610000-1000-4000-8000-000000000002","role":"authenticated"}',true);
select pg_temp.expect(pg_temp.rejects($$select public.review_worker_credential((select (doc->>'id')::uuid from credential_upload),'approved','Expiry must be entered',null)$$),'time-limited evidence requires expiry');
select public.review_worker_credential((select (doc->>'id')::uuid from credential_upload),'correction_required','Provide a clear current licence.',null);
select set_config('request.jwt.claims','{"sub":"f8610000-0000-4000-8000-000000000001","session_id":"f8610000-1000-4000-8000-000000000001","role":"authenticated"}',true);
select pg_temp.expect(public.get_worker_credential_review('credential-worker')->'documents'->0->>'review_note'='Provide a clear current licence.','correction reason persists for Worker');
create temp table credential_replacement as select public.begin_worker_credential_upload('credential-worker','licence','f8610000-3000-4000-8000-000000000002','application/pdf',12,'current-licence.pdf') as doc;
select public.reserve_my_media_upload('worker-credentials',doc->>'object_path') from credential_replacement;
insert into storage.objects(bucket_id,name,metadata,version) select 'worker-credentials',doc->>'object_path','{"size":12,"mimetype":"application/pdf"}'::jsonb,gen_random_uuid()::text from credential_replacement;
select public.finish_worker_credential_upload((select (doc->>'id')::uuid from credential_replacement));
select set_config('request.jwt.claims','{"sub":"f8610000-0000-4000-8000-000000000002","session_id":"f8610000-1000-4000-8000-000000000002","role":"authenticated"}',true);
select pg_temp.expect(pg_temp.rejects($$select public.review_worker_credential((select (doc->>'id')::uuid from credential_upload),'approved','Old version cannot be approved',now()+interval '1 year')$$),'superseded evidence denied');
select public.review_worker_credential((select (doc->>'id')::uuid from credential_replacement),'approved','Checked the current accepted service qualification.',now()+interval '1 year');
select pg_temp.expect((public.get_worker_credential_review('credential-worker')->>'ready')::boolean,'current independently approved credentials satisfy gate');
reset role;
select pg_temp.expect(private.worker_credentials_current('credential-worker'),'server credential gate current');
select pg_temp.expect(not exists(select 1 from public.activity_event_audiences a join public.activity_events e using(activity_event_id)
 where e.subject_type='worker_credentials' and e.subject_id='credential-worker' and e.event_type='worker.credentials.required'
  and a.domain='services' and a.resolved_at is null),'current credential approval resolves the Worker attention task');
update public.profiles set worker_status='verified',worker_verified=true,available=true where user_id='credential-worker';
insert into public.worker_bookings(id,worker_id,user_id,service_type,description,address) values('f8610000-4000-4000-8000-000000000001','credential-worker','credential-reviewer','Electrical repairs','Contract-only existing request','Test address');
select set_config('request.jwt.claims','{"sub":"f8610000-0000-4000-8000-000000000001","session_id":"f8610000-1000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect((public.get_my_provider_workspace_capabilities()->>'service_reviewed')::boolean and (public.get_my_provider_workspace_capabilities()->>'can_manage_jobs')::boolean,'current reviewed provider retains requested-service management');
reset role;
select set_config('request.jwt.claims','{"sub":"f8610000-0000-4000-8000-000000000002","session_id":"f8610000-1000-4000-8000-000000000002","role":"authenticated"}',true);
update public.worker_credential_documents set expires_at=now()-interval '1 second' where id=(select (doc->>'id')::uuid from credential_replacement);
select pg_temp.expect(not private.worker_credentials_current('credential-worker'),'expired approval immediately blocks new work');
select pg_temp.expect(not (public._worker_publication_state('credential-worker')->>'publicly_visible')::boolean,'publication remains hidden with expired evidence');
select pg_temp.expect(pg_temp.rejects_with($$insert into public.worker_bookings(worker_id,user_id,service_type,description,address) values('credential-worker','credential-reviewer','Electrical repairs','Contract-only request','Test address')$$,'service provider needs current credential approval'),'new job is denied specifically by the credential gate');
select pg_temp.expect(private.expire_worker_credentials()=1,'expiry maintenance returns Worker to the existing review queue');
select pg_temp.expect(private.expire_worker_credentials()=0,'expiry maintenance is idempotent');
select pg_temp.expect((select not worker_verified and not available and worker_status='profile_under_review' from public.profiles where user_id='credential-worker'),'expired Worker cannot accept new work');
select pg_temp.expect((select status='booking_requested' from public.worker_bookings where id='f8610000-4000-4000-8000-000000000001'),'expiry does not cancel the existing booking');
select set_config('request.jwt.claims','{"sub":"f8610000-0000-4000-8000-000000000001","session_id":"f8610000-1000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect(not (public.get_my_provider_workspace_capabilities()->>'service_reviewed')::boolean and (public.get_my_provider_workspace_capabilities()->>'has_existing_jobs')::boolean and (public.get_my_provider_workspace_capabilities()->>'can_manage_jobs')::boolean,'expired service approval preserves management of existing jobs');
reset role;
select set_config('request.jwt.claims','{"sub":"f8610000-0000-4000-8000-000000000002","session_id":"f8610000-1000-4000-8000-000000000002","role":"authenticated"}',true);
update public.worker_credential_documents set expires_at=now()+interval '1 year' where id=(select (doc->>'id')::uuid from credential_replacement);
update public.worker_service_coverage set lga='Surulere' where worker_id='credential-worker';
select pg_temp.expect(not private.worker_credentials_current('credential-worker'),'new operating area invalidates the accepted requirements');
select set_config('request.jwt.claims','{"sub":"f8610000-0000-4000-8000-000000000002","session_id":"f8610000-1000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect(pg_temp.rejects($$select public.get_worker_credential_review('credential-worker')$$),'reviewer must cover every operating area, not only the home branch');
reset role;
select set_config('request.jwt.claims','{"sub":"f8610000-0000-4000-8000-000000000001","session_id":"f8610000-1000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect(not (public.get_worker_credential_review('credential-worker')->>'can_submit')::boolean,'stale operating-area requirements cannot accept uploads');
reset role;
update public.user_sessions set is_active=false,trust_status='rejected' where user_id='credential-worker';
set local role authenticated;
select pg_temp.expect(pg_temp.rejects($$select public.get_worker_credential_review('credential-worker')$$),'revoked device cannot read credentials');
reset role;
select pg_temp.expect(not has_table_privilege('authenticated','public.worker_credential_documents','update'),'client cannot forge document approval');
select pg_temp.expect(not has_function_privilege('anon','public.get_worker_credential_review(text)','execute'),'anonymous credential RPC denied');
rollback;
