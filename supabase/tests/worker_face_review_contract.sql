\set ON_ERROR_STOP on

begin;

-- The fixture is isolated and rolled back.  FK triggers are suspended only
-- while the synthetic Worker records are inserted; the functions under test
-- execute normally.
set local session_replication_role=replica;

insert into public.profiles(
  auth_id,email,user_id,role,profile_complete,full_name,worker_status,
  worker_verified,available,worker_occupation,worker_skills,
  worker_experience,state,city,local_government
) values(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'worker-face-contract@example.invalid',
  'worker-face-contract','worker',true,'Worker Face Contract','pending',
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
    raise exception 'Worker review submission bypassed the live-face check';
  end if;
  if not exists(
    select 1 from public.profiles
    where user_id='worker-face-contract' and worker_status='pending'
  ) then
    raise exception 'Rejected review submission changed the Worker state';
  end if;
end;
$$;

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
  now(),now(),1,'worker'
);

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
    raise exception 'Valid Worker review submission did not enter review';
  end if;
  if not exists(
    select 1 from public.worker_verifications
    where worker_id='worker-face-contract'
      and status='profile_under_review'
      and submitted_at is not null
  ) then
    raise exception 'Valid Worker evidence was not marked under review';
  end if;
end;
$$;

rollback;
