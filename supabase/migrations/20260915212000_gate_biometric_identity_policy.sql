begin;

-- Biometric/liveness processing is powerful but sensitive. Keep the technical
-- capability, while making enforcement server-authoritative and disabled until
-- the policy/privacy gate is explicitly enabled. Recurring re-checks are a
-- separate switch so enabling initial identity continuity never silently turns
-- into a monthly lockout.
insert into public.platform_settings(
  key,value,category,label,description,data_type,editable,is_active,created_at,updated_at
) values(
  'account_identity_recurring_enabled','false','security',
  'Recurring identity re-checks',
  'Require an already-approved Service Provider or Property Partner to repeat the private live identity check after the configured interval. Enable only after the approved biometric/privacy policy gate.',
  'boolean',true,true,now(),now()
)
on conflict(key) do nothing;

create or replace function public.account_identity_checks_enabled()
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select coalesce((
    select lower(setting.value) in('true','1','yes','on')
    from public.platform_settings setting
    where setting.key='worker_identity_checks_enabled'
      and coalesce(setting.is_active,true)
    limit 1
  ),false)
$$;

create or replace function public.account_identity_recurring_enabled()
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select coalesce((
    select lower(setting.value) in('true','1','yes','on')
    from public.platform_settings setting
    where setting.key='account_identity_recurring_enabled'
      and coalesce(setting.is_active,true)
    limit 1
  ),false)
$$;

-- Truthful evidence state: this never becomes true merely because biometric
-- enforcement is disabled. When recurring checks are disabled, an independently
-- approved identity check does not expire on an arbitrary 30-day timer.
create or replace function public.account_identity_is_current(p_user_id text)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select exists(
    select 1
    from public.worker_identity_checks check_row
    where check_row.worker_id=p_user_id
      and check_row.status='passed'
      and check_row.captured_at is not null
      and (
        not public.account_identity_recurring_enabled()
        or check_row.captured_at
          + make_interval(days=>public.account_identity_recheck_days()) > now()
      )
  )
$$;

-- Historical helper name retained because many mature booking/review functions
-- call it. Its contract is now "the identity policy gate is satisfied": either
-- the sensitive biometric gate is disabled, or the required check is current.
-- UI/read models must use account_identity_is_current() when they need to say
-- whether a face/liveness check actually passed.
create or replace function public.worker_identity_is_current(p_worker_id text)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select not public.account_identity_checks_enabled()
    or public.account_identity_is_current(p_worker_id)
$$;

create or replace function public.get_my_account_identity_status()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_check public.worker_identity_checks;
  v_required boolean:=public.account_identity_checks_enabled();
  v_recurring boolean:=public.account_identity_recurring_enabled();
  v_current boolean:=false;
  v_days integer:=public.account_identity_recheck_days();
  v_due_at timestamptz;
begin
  select * into v_actor
  from public.profiles profile
  where profile.auth_id=(select auth.uid())::text
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
  limit 1;

  if v_actor.user_id is null or not (
    public.current_actor_has_workspace('worker',null)
    or public.current_actor_has_workspace('property_partner',null)
  ) then
    raise exception 'Service Provider or Property Partner workspace required';
  end if;

  select * into v_check
  from public.worker_identity_checks check_row
  where check_row.worker_id=v_actor.user_id;

  v_current:=public.account_identity_is_current(v_actor.user_id);
  if v_recurring and v_check.captured_at is not null then
    v_due_at:=v_check.captured_at+make_interval(days=>v_days);
  end if;

  return jsonb_build_object(
    'required',v_required,
    'gate_satisfied',not v_required or v_current,
    'current',v_current,
    'recurring_required',v_required and v_recurring,
    'enrolled',coalesce(
      nullif(btrim(coalesce(v_check.enrollment_photo_path,'')),'') is not null,
      false
    ),
    'status',case
      when not v_required then 'not_required'
      when v_recurring and v_check.status='passed' and not v_current then 'expired'
      else coalesce(v_check.status,'not_started')
    end,
    'review_notes',v_check.review_notes,
    'recheck_days',case when v_required and v_recurring then v_days else null end,
    'captured_at',v_check.captured_at,
    'due_at',v_due_at
  );
end;
$$;

-- Do not collect new biometric/liveness evidence while the approved policy gate
-- is off. This prevents a hidden/direct RPC from bypassing the product UI and
-- causing unnecessary sensitive-data collection.
create or replace function public.complete_my_account_identity_check(
  p_photo_path text,
  p_face_match_score numeric,
  p_liveness_score numeric,
  p_anti_spoof_score numeric,
  p_challenge_result jsonb,
  p_consent boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','storage'
as $$
declare
  v_actor public.profiles;
  v_existing public.worker_identity_checks;
  v_renewal boolean;
  v_attempts integer;
  v_account_role text;
begin
  if not public.account_identity_checks_enabled() then
    raise exception 'Private identity verification is not enabled by current WeHouse policy';
  end if;

  select * into v_actor
  from public.profiles profile
  where profile.auth_id=(select auth.uid())::text
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
  limit 1;
  if v_actor.user_id is null then raise exception 'Active account required'; end if;

  if public.current_actor_has_workspace('worker',null) then
    v_account_role:='worker';
  elsif public.current_actor_has_workspace('property_partner',null) then
    v_account_role:='property_partner';
  else
    raise exception 'Service Provider or Property Partner workspace required';
  end if;

  if not coalesce(p_consent,false) then
    raise exception 'Private face-check consent is required';
  end if;

  select * into v_existing
  from public.worker_identity_checks check_row
  where check_row.worker_id=v_actor.user_id
  for update;
  v_renewal:=v_existing.worker_id is not null
    and nullif(btrim(coalesce(v_existing.enrollment_photo_path,'')),'') is not null;

  if nullif(btrim(coalesce(p_photo_path,'')),'') is null
     or split_part(p_photo_path,'/',1)<>v_actor.user_id then
    raise exception 'Invalid private identity path';
  end if;
  if v_renewal and p_photo_path=v_existing.enrollment_photo_path then
    raise exception 'Renewal requires a fresh private live-check still';
  end if;
  if not exists(
    select 1 from storage.objects object_row
    where object_row.bucket_id='worker-identity-private'
      and object_row.name=p_photo_path
  ) then
    raise exception 'Private identity reference was not found';
  end if;

  if p_face_match_score not between 0 and 1
     or p_liveness_score not between 0 and 1
     or p_anti_spoof_score not between 0 and 1 then
    raise exception 'Invalid automatic face-check score';
  end if;
  if p_face_match_score<0.55 then raise exception 'Face continuity check did not pass'; end if;
  if p_liveness_score<0.50 then raise exception 'Automatic liveness screening did not pass'; end if;
  if p_anti_spoof_score<0.50 then raise exception 'Automatic anti-spoof screening did not pass'; end if;
  if not coalesce((p_challenge_result->>'automatic')::boolean,false)
     or not coalesce((p_challenge_result->>'center_start')::boolean,false)
     or not coalesce((p_challenge_result->>'side_one')::boolean,false)
     or not coalesce((p_challenge_result->>'side_two')::boolean,false)
     or not coalesce((p_challenge_result->>'center_end')::boolean,false)
     or coalesce((p_challenge_result->>'recorded_video')::boolean,true) then
    raise exception 'Automatic head-movement challenge is incomplete';
  end if;

  v_attempts:=coalesce(v_existing.attempt_count,0)+1;
  insert into public.worker_identity_checks(
    worker_id,account_role,status,enrollment_photo_path,
    latest_reference_photo_path,latest_reference_at,
    pending_reference_photo_path,challenge_version,
    face_match_score,liveness_score,anti_spoof_score,challenge_result,
    consent_at,captured_at,attempt_count,submitted_at,reviewed_at,reviewed_by,
    review_notes,updated_at
  ) values(
    v_actor.user_id,v_account_role,'pending_review',p_photo_path,null,null,p_photo_path,
    'human-3.3.6-head-turn-v4-manual-review',p_face_match_score,p_liveness_score,
    p_anti_spoof_score,p_challenge_result,now(),null,v_attempts,now(),null,null,
    null,now()
  ) on conflict(worker_id) do update set
    account_role=excluded.account_role,
    status='pending_review',
    enrollment_photo_path=coalesce(
      worker_identity_checks.enrollment_photo_path,
      excluded.enrollment_photo_path
    ),
    pending_reference_photo_path=excluded.pending_reference_photo_path,
    challenge_version=excluded.challenge_version,
    face_match_score=excluded.face_match_score,
    liveness_score=excluded.liveness_score,
    anti_spoof_score=excluded.anti_spoof_score,
    challenge_result=excluded.challenge_result,
    consent_at=excluded.consent_at,
    captured_at=null,
    attempt_count=v_attempts,
    submitted_at=now(),
    reviewed_at=null,
    reviewed_by=null,
    review_notes=null,
    updated_at=now();

  insert into public.audit_logs(
    action,target_type,target_id,details,admin_id,admin_email
  ) values(
    'ACCOUNT_IDENTITY_REVIEW_REQUESTED','profiles',v_actor.user_id,
    jsonb_build_object(
      'workspace',v_account_role,
      'renewal',v_renewal,
      'challenge_version','human-3.3.6-head-turn-v4-manual-review'
    )::text,
    v_actor.user_id,v_actor.email
  );

  return jsonb_build_object(
    'success',true,
    'current',false,
    'status','pending_review',
    'renewal',v_renewal,
    'recurring_required',public.account_identity_recurring_enabled(),
    'recheck_days',case when public.account_identity_recurring_enabled()
      then public.account_identity_recheck_days() else null end
  );
end;
$$;

-- Service Provider activation truthfully distinguishes a real approved identity
-- check from a policy exemption. Business gates use worker_identity_is_current()
-- (policy satisfied); user-facing labels use account_identity_is_current().
create or replace function public.get_my_worker_activation()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_profile public.profiles;
  v_ver public.worker_verifications;
  v_identity public.worker_identity_checks;
  v_profile_ready boolean:=false;
  v_identity_required boolean:=public.account_identity_checks_enabled();
  v_identity_current boolean:=false;
  v_identity_gate boolean:=false;
  v_recurring boolean:=public.account_identity_recurring_enabled();
  v_marketplace_enabled boolean:=false;
  v_days integer:=public.account_identity_recheck_days();
  v_due_at timestamptz;
  v_days_remaining integer;
  v_pro_active boolean:=false;
begin
  select * into v_profile
  from public.profiles profile
  where profile.auth_id=(select auth.uid())::text
    and public.user_has_active_workspace(profile.user_id,'worker')
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
  limit 1;
  if v_profile.user_id is null then raise exception 'Service Provider profile not found'; end if;

  select coalesce(lower(setting.value) in('true','1','yes','on'),false)
  into v_marketplace_enabled
  from public.platform_settings setting
  where setting.key='worker_marketplace_launch_enabled'
    and setting.is_active=true
  limit 1;

  v_profile_ready:=public.worker_professional_profile_ready(v_profile.user_id);
  select * into v_ver
  from public.worker_verifications verification
  where verification.worker_id=v_profile.user_id
  order by verification.created_at desc
  limit 1;
  select * into v_identity
  from public.worker_identity_checks identity_check
  where identity_check.worker_id=v_profile.user_id;

  v_identity_current:=public.account_identity_is_current(v_profile.user_id);
  v_identity_gate:=not v_identity_required or v_identity_current;
  if v_identity_required and v_recurring and v_identity.captured_at is not null then
    v_due_at:=v_identity.captured_at+make_interval(days=>v_days);
    v_days_remaining:=greatest(
      0,ceil(extract(epoch from (v_due_at-now()))/86400.0)::integer
    );
  end if;
  v_pro_active:=public.worker_pro_is_active(v_profile.user_id);

  return jsonb_build_object(
    'worker_status',coalesce(v_profile.worker_status,'pending'),
    'reviewed',coalesce(
      v_profile.worker_status='verified' and v_profile.worker_verified,false
    ),
    'live',coalesce(
      v_profile.worker_status='verified'
      and v_profile.worker_verified
      and v_identity_gate
      and v_marketplace_enabled,
      false
    ),
    'marketplace_enabled',coalesce(v_marketplace_enabled,false),
    'profile_complete',v_profile_ready,
    'payment_status','not_required',
    'payment_required',false,
    'payment_confirmed',true,
    'fee_waived',true,
    'pro_active',v_pro_active,
    'identity_required',v_identity_required,
    'identity_gate_satisfied',v_identity_gate,
    'identity_recurring_required',v_identity_required and v_recurring,
    'identity_status',case
      when not v_identity_required then 'not_required'
      when v_recurring and v_identity.status='passed' and not v_identity_current then 'expired'
      else coalesce(v_identity.status,'not_started')
    end,
    'identity_captured',coalesce(v_identity.status='passed',false),
    'identity_passed',coalesce(v_identity.status='passed',false),
    'identity_current',v_identity_current,
    'identity_captured_at',v_identity.captured_at,
    'identity_due_at',v_due_at,
    'identity_recheck_days',case when v_identity_required and v_recurring then v_days else null end,
    'identity_days_remaining',v_days_remaining,
    'test_passed',true,
    'test_percent',100,
    'test_attempts_24h',0,
    'evidence_saved',coalesce(
      nullif(btrim(coalesce(v_ver.verification_video_url,'')),'') is not null,
      false
    ),
    'submitted',coalesce(
      v_profile.worker_status='profile_under_review'
      and v_ver.submitted_at is not null,
      false
    ),
    'review_status',v_ver.status,
    'rejection_reason',(
      select review.rejection_reason
      from public.worker_verification_reviews review
      where review.worker_id=v_profile.user_id
      order by review.created_at desc
      limit 1
    )
  );
end;
$$;

-- The review/trust payload must never claim a face check passed merely because
-- biometric enforcement is disabled.
create or replace function public._worker_review_trust_payload(p_worker_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_worker public.profiles;
  v_ver public.worker_verifications;
  v_identity public.worker_identity_checks;
  v_payment boolean:=false;
  v_actual_current boolean:=false;
begin
  select * into v_worker
  from public.profiles
  where user_id=p_worker_id
    and public.user_has_active_workspace(user_id,'worker')
  limit 1;
  if v_worker.user_id is null then raise exception 'Service Provider not found'; end if;

  select * into v_ver
  from public.worker_verifications
  where worker_id=p_worker_id
  limit 1;
  select * into v_identity
  from public.worker_identity_checks
  where worker_id=p_worker_id;
  select exists(
    select 1 from public.booking_payments
    where user_id=p_worker_id
      and purpose='worker_verification'
      and status in('paid','completed')
  ) into v_payment;
  v_actual_current:=public.account_identity_is_current(p_worker_id);

  return jsonb_build_object(
    'payment_confirmed',v_payment,
    'identity_required',public.account_identity_checks_enabled(),
    'identity_status',case
      when v_identity.status='passed' and v_actual_current then 'passed'
      when v_identity.status='passed' and public.account_identity_recurring_enabled() then 'expired'
      else coalesce(v_identity.status,'not_started')
    end,
    'identity_captured',coalesce(v_identity.status='passed',false),
    'identity_passed',coalesce(v_identity.status='passed',false),
    'identity_current',v_actual_current,
    'face_match_score',v_identity.face_match_score,
    'liveness_score',v_identity.liveness_score,
    'anti_spoof_score',v_identity.anti_spoof_score,
    'readiness_passed',true,
    'readiness_percent',100,
    'evidence_saved',coalesce(
      nullif(btrim(coalesce(v_ver.verification_video_url,'')),'') is not null,
      false
    ),
    'certificate_path',v_ver.certificate_path,
    'verification_video_url',v_ver.verification_video_url,
    'submitted',coalesce(v_ver.submitted_at is not null,false),
    'review_status',v_ver.status
  );
end;
$$;

revoke all on function public.account_identity_checks_enabled() from public,anon;
revoke all on function public.account_identity_recurring_enabled() from public,anon;
revoke all on function public.account_identity_is_current(text) from public,anon;
revoke all on function public.worker_identity_is_current(text) from public,anon;
grant execute on function public.account_identity_checks_enabled() to authenticated,service_role;
grant execute on function public.account_identity_recurring_enabled() to authenticated,service_role;
grant execute on function public.account_identity_is_current(text) to authenticated,service_role;
grant execute on function public.worker_identity_is_current(text) to authenticated,service_role;

comment on function public.account_identity_checks_enabled() is
  'Policy gate for sensitive private face/liveness identity verification. Disabled until WeHouse approves the required privacy/legal controls.';
comment on function public.account_identity_recurring_enabled() is
  'Separate policy gate for recurring biometric re-checks. Off by default; enabling initial identity verification does not imply monthly re-checks.';
comment on function public.account_identity_is_current(text) is
  'Truthful approved identity-check state. Never becomes true merely because the biometric requirement is disabled.';
comment on function public.worker_identity_is_current(text) is
  'Legacy internal gate helper: true when biometric checks are not required or when the required approved check is current. Do not use this helper as a public claim that biometrics passed.';

commit;