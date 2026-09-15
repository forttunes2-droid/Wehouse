\set ON_ERROR_STOP on

begin;

-- The fixture is isolated and rolled back. FK triggers are suspended only while
-- synthetic provider records are inserted; the functions under test execute normally.
set local session_replication_role=replica;

insert into public.profiles(
  auth_id,email,user_id,role,profile_complete,full_name,worker_status,
  worker_verified,available,worker_occupation,worker_skills,
  worker_experience,state,city,local_government
) values(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'service-provider-face-contract@example.invalid',
  'worker-face-contract','worker',true,'Service Provider Face Contract','pending',
  false,false,'Electrician','["Electrical","Wiring"]'::jsonb,
  'Five years of residential electrical work','Nasarawa','Lafia','Lafia'
);

insert into public.worker_service_coverage(worker_id,state,lga,areas)
values('worker-face-contract','Nasarawa','Lafia',array['Lafia']);

insert into public.worker_verifications(
  worker_id,verification_video_url,status
) values(
  'worker-face-contract','worker-face-contract/work-video.mp4','evidence_ready'
);

set local session_replication_role=origin;
select set_config(
  'request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true
);
select set_config('request.jwt.claim.role','authenticated',true);

-- 1. The biometric policy gate is disabled by default. Professional evidence
-- can enter WeHouse review without pretending that a face check passed.
update public.platform_settings
set value='false',is_active=true
where key='worker_identity_checks_enabled';
update public.platform_settings
set value='false',is_active=true
where key='account_identity_recurring_enabled';

select public.submit_my_worker_verification();

do $$
begin
  if not exists(
    select 1 from public.profiles
    where user_id='worker-face-contract'
      and worker_status='profile_under_review'
      and worker_verified=false
      and available=false
  ) then
    raise exception 'Policy-disabled identity gate incorrectly blocked professional review';
  end if;
  if public.account_identity_is_current('worker-face-contract') then
    raise exception 'Biometric policy exemption was falsely reported as an approved identity check';
  end if;
end;
$$;

-- Return the synthetic provider to evidence-ready so the enabled-gate behavior
-- can be tested independently.
update public.profiles
set worker_status='pending',worker_verified=false,available=false
where user_id='worker-face-contract';
update public.worker_verifications
set status='evidence_ready',submitted_at=null,reviewed_at=null,reviewed_by=null
where worker_id='worker-face-contract';

-- 2. The real production trigger deliberately refuses to enable regulated
-- biometric processing without a recorded launch approval. This contract is
-- testing the behavior *after* that separate launch gate has approved it, so
-- only this rolled-back superuser fixture update bypasses setting triggers.
-- Production/API callers never receive this bypass.
set local session_replication_role=replica;
update public.platform_settings
set value='true',is_active=true
where key='worker_identity_checks_enabled';
set local session_replication_role=origin;

do $$
declare
  rejected boolean:=false;
begin
  begin
    perform public.submit_my_worker_verification();
  exception when others then
    rejected:=position('private live-face check' in sqlerrm)>0;
  end;
  if not rejected then
    raise exception 'Enabled biometric policy gate was bypassed';
  end if;
end;
$$;

-- 3. Initial identity approval does not silently become a 30-day lockout while
-- recurring verification is disabled.
insert into public.worker_identity_checks(
  worker_id,status,enrollment_photo_path,latest_reference_photo_path,
  challenge_version,face_match_score,liveness_score,anti_spoof_score,
  challenge_result,consent_at,captured_at,attempt_count,account_role
) values(
  'worker-face-contract','passed',
  'worker-face-contract/private-reference.jpg',
  'worker-face-contract/private-reference.jpg',
  'contract-live-face-v1',0.9,0.9,0.9,
  '{"automatic":true,"center_start":true,"side_one":true,"side_two":true,"center_end":true,"recorded_video":false}'::jsonb,
  now()-interval '100 days',now()-interval '100 days',1,'worker'
);

select public.submit_my_worker_verification();

do $$
begin
  if not public.account_identity_is_current('worker-face-contract') then
    raise exception 'Approved identity check expired while recurring policy was disabled';
  end if;
  if not exists(
    select 1 from public.profiles
    where user_id='worker-face-contract' and worker_status='profile_under_review'
  ) then
    raise exception 'Approved identity check did not allow professional review';
  end if;
end;
$$;

-- Reset again and prove that the separate recurring switch has real effect when
-- explicitly enabled later. Like the initial biometric toggle above, this is a
-- rolled-back fixture state representing an already-approved future policy.
update public.profiles
set worker_status='pending',worker_verified=false,available=false
where user_id='worker-face-contract';
update public.worker_verifications
set status='evidence_ready',submitted_at=null,reviewed_at=null,reviewed_by=null
where worker_id='worker-face-contract';
set local session_replication_role=replica;
update public.platform_settings
set value='true',is_active=true
where key='account_identity_recurring_enabled';
set local session_replication_role=origin;

do $$
declare
  rejected boolean:=false;
begin
  if public.account_identity_is_current('worker-face-contract') then
    raise exception 'Old identity check stayed current after recurring policy was enabled';
  end if;
  begin
    perform public.submit_my_worker_verification();
  exception when others then
    rejected:=position('private live-face check' in sqlerrm)>0;
  end;
  if not rejected then
    raise exception 'Recurring identity policy did not enforce freshness';
  end if;
end;
$$;

update public.worker_identity_checks
set captured_at=now(),status='passed'
where worker_id='worker-face-contract';
select public.submit_my_worker_verification();

rollback;