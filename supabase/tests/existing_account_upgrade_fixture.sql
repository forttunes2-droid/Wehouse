\set ON_ERROR_STOP on
-- Disposable local CI only, loaded at the production migration baseline.
begin;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,worker_status,worker_verified,available)
values
('99999999-1111-4111-8111-999999999999','upgrade-approved@example.invalid','upgrade-approved','worker',true,'verified',true,true),
('99999999-2222-4222-8222-999999999999','upgrade-review@example.invalid','upgrade-review','worker',true,'profile_under_review',false,false);
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status)
values('upgrade-approved','worker','global','active'),('upgrade-review','worker','global','active');
insert into public.worker_verifications(worker_id,verification_video_url,status,submitted_at,reviewed_by,review_notes,reviewed_at)
values
('upgrade-approved','upgrade-approved/work.mp4','verified','2026-09-10','ci-reviewer','Keep the existing professional approval.','2026-09-11'),
('upgrade-review','upgrade-review/work.mp4','profile_under_review','2026-09-12',null,'Keep this submitted review in the queue.',null);
insert into public.worker_identity_checks(worker_id,status,enrollment_photo_path,latest_reference_photo_path,captured_at,consent_at,attempt_count,challenge_result)
values('upgrade-approved','passed','upgrade-approved/private.jpg','upgrade-approved/private.jpg','2026-09-10','2026-09-10',1,'{"automatic":true}');
insert into public.wallets(owner_id,owner_type,available_balance,pending_balance)
values('upgrade-approved','worker',123.45,50);
commit;
