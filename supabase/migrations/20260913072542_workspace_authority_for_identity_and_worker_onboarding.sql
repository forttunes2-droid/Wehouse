-- A Personal-first account keeps profiles.role as a compatibility field.
-- Marketplace authority comes from workspace_role_assignments. These RPCs
-- must therefore authorize the active workspace, not the signup-era role.

create or replace function public.user_has_active_workspace(
  p_user_id text,
  p_workspace_role text
)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select exists(
    select 1
    from public.profiles profile
    where profile.user_id=p_user_id
      and not coalesce(profile.deleted,false)
      and not coalesce(profile.suspended,false)
      and not coalesce(profile.banned,false)
      and (
        profile.role=p_workspace_role
        or exists(
          select 1
          from public.workspace_role_assignments assignment
          where assignment.user_id=profile.user_id
            and assignment.workspace_role=p_workspace_role
            and assignment.status='active'
        )
      )
  )
$$;

revoke all on function public.user_has_active_workspace(text,text)
from public;
grant execute on function public.user_has_active_workspace(text,text)
to anon,authenticated,service_role;

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
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor is null then raise exception 'Active Personal account required'; end if;
  if public.current_actor_has_workspace('worker',null) then
    v_account_role:='worker';
  elsif public.current_actor_has_workspace('property_partner',null) then
    v_account_role:='property_partner';
  else
    raise exception 'Worker or Property Partner workspace required';
  end if;
  if not coalesce(p_consent,false) then
    raise exception 'Private face-check consent is required';
  end if;
  select * into v_existing
  from public.worker_identity_checks
  where worker_id=v_actor.user_id
  for update;
  v_renewal:=v_existing.worker_id is not null
    and nullif(btrim(coalesce(v_existing.enrollment_photo_path,'')),'') is not null;
  if nullif(btrim(coalesce(p_photo_path,'')),'') is null
     or split_part(p_photo_path,'/',1)<>v_actor.user_id then
    raise exception 'Invalid private identity path';
  end if;
  if v_renewal and p_photo_path<>v_existing.enrollment_photo_path then
    raise exception 'Renewal must reuse the original private identity reference';
  end if;
  if not exists(
    select 1 from storage.objects
    where bucket_id='worker-identity-private' and name=p_photo_path
  ) then raise exception 'Private identity reference was not found'; end if;
  if p_face_match_score not between 0 and 1
     or p_liveness_score not between 0 and 1
     or p_anti_spoof_score not between 0 and 1 then
    raise exception 'Invalid automatic face-check score';
  end if;
  if p_face_match_score<0.55 then
    raise exception 'Live face did not match the private identity reference closely enough';
  end if;
  if p_liveness_score<0.50 then raise exception 'Automatic liveness check did not pass'; end if;
  if p_anti_spoof_score<0.50 then raise exception 'Automatic anti-spoof check did not pass'; end if;
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
    latest_reference_photo_path,latest_reference_at,challenge_version,
    face_match_score,liveness_score,anti_spoof_score,challenge_result,
    consent_at,captured_at,attempt_count,updated_at
  ) values(
    v_actor.user_id,v_account_role,'passed',p_photo_path,p_photo_path,now(),
    'human-3.3.6-head-turn-v4-shared',p_face_match_score,p_liveness_score,
    p_anti_spoof_score,p_challenge_result,now(),now(),v_attempts,now()
  ) on conflict(worker_id) do update set
    account_role=excluded.account_role,status='passed',
    enrollment_photo_path=coalesce(
      worker_identity_checks.enrollment_photo_path,
      excluded.enrollment_photo_path
    ),
    latest_reference_photo_path=excluded.latest_reference_photo_path,
    latest_reference_at=excluded.latest_reference_at,
    challenge_version=excluded.challenge_version,
    face_match_score=excluded.face_match_score,
    liveness_score=excluded.liveness_score,
    anti_spoof_score=excluded.anti_spoof_score,
    challenge_result=excluded.challenge_result,
    consent_at=excluded.consent_at,
    captured_at=excluded.captured_at,
    attempt_count=v_attempts,
    updated_at=now();
  insert into public.audit_logs(
    action,target_type,target_id,details,admin_id,admin_email
  ) values(
    case when v_renewal then 'ACCOUNT_IDENTITY_RECHECK_PASSED'
      else 'ACCOUNT_IDENTITY_ENROLLED' end,
    'profiles',v_actor.user_id,
    jsonb_build_object(
      'workspace',v_account_role,
      'challenge_version','human-3.3.6-head-turn-v4-shared'
    )::text,
    v_actor.user_id,v_actor.email
  );
  return jsonb_build_object(
    'success',true,'current',true,'renewal',v_renewal,
    'recheck_days',public.account_identity_recheck_days()
  );
end
$$;

create or replace function public.get_my_account_identity_reference()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_check public.worker_identity_checks;
begin
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor is null
     or not (
       public.current_actor_has_workspace('worker',null)
       or public.current_actor_has_workspace('property_partner',null)
     ) then
    raise exception 'Worker or Property Partner workspace required';
  end if;
  select * into v_check
  from public.worker_identity_checks
  where worker_id=v_actor.user_id;
  return jsonb_build_object(
    'has_reference',coalesce(
      nullif(btrim(coalesce(v_check.enrollment_photo_path,'')),'') is not null,
      false
    ),
    'anchor_photo_path',v_check.enrollment_photo_path,
    'recent_photo_path',coalesce(
      v_check.latest_reference_photo_path,
      v_check.enrollment_photo_path
    ),
    'captured_at',v_check.captured_at,
    'status',coalesce(v_check.status,'not_started')
  );
end
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
  v_days integer:=public.account_identity_recheck_days();
begin
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor is null
     or not (
       public.current_actor_has_workspace('worker',null)
       or public.current_actor_has_workspace('property_partner',null)
     ) then
    raise exception 'Worker or Property Partner workspace required';
  end if;
  select * into v_check
  from public.worker_identity_checks
  where worker_id=v_actor.user_id;
  return jsonb_build_object(
    'current',public.account_identity_is_current(v_actor.user_id),
    'enrolled',coalesce(
      nullif(btrim(coalesce(v_check.enrollment_photo_path,'')),'') is not null,
      false
    ),
    'status',coalesce(v_check.status,'not_started'),
    'recheck_days',v_days,
    'captured_at',v_check.captured_at,
    'due_at',case when v_check.captured_at is null then null
      else v_check.captured_at+make_interval(days=>v_days) end
  );
end
$$;

create or replace function public.get_my_worker_activation()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_profile public.profiles;
  v_ver public.worker_verifications;
  v_payment public.booking_payments;
  v_identity public.worker_identity_checks;
  v_profile_ready boolean:=false;
  v_paid boolean:=false;
  v_payment_required boolean:=true;
  v_payment_complete boolean:=false;
  v_days integer:=public.worker_identity_recheck_days();
  v_identity_current boolean:=false;
  v_due_at timestamptz;
  v_days_remaining integer;
begin
  select * into v_profile
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_profile is null or not public.current_actor_has_workspace('worker',null) then
    raise exception 'Worker workspace required';
  end if;
  select coalesce(lower(btrim(value)) not in ('false','0','off','no'),true)
  into v_payment_required
  from public.platform_settings
  where key='worker_verification_fee_enabled' and coalesce(is_active,true)
  limit 1;
  v_payment_required:=coalesce(v_payment_required,true);
  v_profile_ready:=public.worker_professional_profile_ready(v_profile.user_id);
  select * into v_ver from public.worker_verifications
  where worker_id=v_profile.user_id order by created_at desc limit 1;
  select * into v_payment from public.booking_payments
  where user_id=v_profile.user_id and purpose='worker_verification'
  order by created_at desc limit 1;
  select * into v_identity from public.worker_identity_checks
  where worker_id=v_profile.user_id;
  v_paid:=coalesce(v_payment.status in ('paid','completed'),false);
  v_payment_complete:=v_paid or not v_payment_required or coalesce(
    v_profile.worker_status='verified' and v_profile.worker_verified,
    false
  );
  if v_identity.status='passed' and v_identity.captured_at is not null then
    v_due_at:=v_identity.captured_at+make_interval(days=>v_days);
    v_identity_current:=v_due_at>now();
    v_days_remaining:=greatest(
      0,
      ceil(extract(epoch from (v_due_at-now()))/86400.0)::integer
    );
  end if;
  return jsonb_build_object(
    'worker_status',coalesce(v_profile.worker_status,'pending'),
    'live',coalesce(
      v_profile.worker_status='verified'
      and v_profile.worker_verified
      and v_identity_current,
      false
    ),
    'profile_complete',v_profile_ready,
    'payment_status',v_payment.status,
    'payment_required',v_payment_required and not coalesce(
      v_profile.worker_status='verified' and v_profile.worker_verified,
      false
    ),
    'payment_confirmed',v_payment_complete,
    'fee_waived',not v_paid and not v_payment_required,
    'gold_badge',coalesce(
      v_profile.worker_status='verified' and v_profile.worker_verified,
      false
    ),
    'identity_required',true,
    'identity_status',case
      when v_identity.status='passed' and not v_identity_current then 'expired'
      else coalesce(v_identity.status,'not_started')
    end,
    'identity_captured',coalesce(v_identity.status='passed',false),
    'identity_passed',v_identity_current,
    'identity_current',v_identity_current,
    'identity_captured_at',v_identity.captured_at,
    'identity_due_at',v_due_at,
    'identity_recheck_days',v_days,
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
      select rejection_reason
      from public.worker_verification_reviews
      where worker_id=v_profile.user_id
      order by created_at desc limit 1
    )
  );
end
$$;

create or replace function public.create_worker_verification_payment()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_caller text:=public.current_profile_user_id();
  v_amount numeric;
  v_reference text;
  v_existing record;
  v_payment_required boolean:=true;
begin
  if v_caller is null then
    return jsonb_build_object('success',false,'error','Not authenticated');
  end if;
  if not public.current_actor_has_workspace('worker',null) then
    return jsonb_build_object('success',false,'error','Worker workspace required');
  end if;
  if not public.worker_professional_profile_ready(v_caller) then
    return jsonb_build_object(
      'success',false,
      'error','Complete your professional profile and service coverage before payment'
    );
  end if;
  select coalesce(lower(btrim(value)) not in ('false','0','off','no'),true)
  into v_payment_required
  from public.platform_settings
  where key='worker_verification_fee_enabled' and coalesce(is_active,true)
  limit 1;
  if not coalesce(v_payment_required,true) then
    return jsonb_build_object(
      'success',false,'fee_waived',true,
      'error','Worker onboarding is currently free; no payment is required'
    );
  end if;
  select coalesce(nullif(value,'')::numeric,0) into v_amount
  from public.platform_settings where key='worker_verification_fee';
  if v_amount<=0 then
    return jsonb_build_object('success',false,'error','Verification fee not configured');
  end if;
  update public.booking_payments set status='expired',updated_at=now()
  where user_id=v_caller and purpose='worker_verification'
    and status='pending' and created_at<now()-interval '30 minutes';
  select * into v_existing from public.booking_payments
  where user_id=v_caller and purpose='worker_verification' and status='pending'
  order by created_at desc limit 1;
  if v_existing is not null then
    if v_existing.amount_total=v_amount then
      return jsonb_build_object(
        'success',true,'reference',v_existing.paystack_reference,
        'amount',v_amount,'existing',true
      );
    end if;
    update public.booking_payments set status='expired',updated_at=now()
    where id=v_existing.id;
  end if;
  v_reference:='WH-'||gen_random_uuid()::text;
  insert into public.booking_payments(
    payment_reference,user_id,payer_user_id,payee_user_id,type,booking_type,
    amount,amount_total,net_amount,amount_commission,currency,status,purpose,
    paystack_reference,metadata,created_at,updated_at
  ) values(
    v_reference,v_caller,v_caller,v_caller,'worker_subscription',
    'worker_subscription',v_amount,v_amount,v_amount,0,'NGN','pending',
    'worker_verification',v_reference,
    jsonb_build_object('source','create_worker_verification_payment'),now(),now()
  );
  return jsonb_build_object(
    'success',true,'reference',v_reference,'amount',v_amount,'existing',false
  );
exception when unique_violation then
  select * into v_existing from public.booking_payments
  where user_id=v_caller and purpose='worker_verification' and status='pending'
  order by created_at desc limit 1;
  if v_existing is not null then
    return jsonb_build_object(
      'success',true,'reference',v_existing.paystack_reference,
      'amount',v_existing.amount_total,'existing',true
    );
  end if;
  return jsonb_build_object(
    'success',false,'error','Payment initialization race condition'
  );
end
$$;

create or replace function public.save_my_worker_professional_evidence(
  p_certificate_path text,
  p_video_path text
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_profile public.profiles;
  v_paid boolean:=false;
  v_payment_required boolean:=true;
  v_id uuid;
begin
  select * into v_profile
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_profile is null or not public.current_actor_has_workspace('worker',null) then
    raise exception 'Worker workspace required';
  end if;
  if v_profile.worker_status='verified' then
    raise exception 'Live Worker evidence changes require a new review process';
  end if;
  if not public.worker_professional_profile_ready(v_profile.user_id) then
    raise exception 'Complete your professional profile and service coverage first';
  end if;
  if not public.worker_identity_is_current(v_profile.user_id) then
    raise exception 'Complete the current private WeHouse face check first';
  end if;
  select coalesce(lower(btrim(value)) not in ('false','0','off','no'),true)
  into v_payment_required
  from public.platform_settings
  where key='worker_verification_fee_enabled' and coalesce(is_active,true)
  limit 1;
  select exists(
    select 1 from public.booking_payments
    where user_id=v_profile.user_id and purpose='worker_verification'
      and status in ('paid','completed')
  ) into v_paid;
  if coalesce(v_payment_required,true) and not v_paid then
    raise exception 'Confirmed Paystack payment is required first';
  end if;
  if nullif(btrim(coalesce(p_video_path,'')),'') is null then
    raise exception 'Skill demonstration video is required';
  end if;
  if split_part(p_video_path,'/',1)<>v_profile.user_id then
    raise exception 'Invalid Worker video path';
  end if;
  if nullif(btrim(coalesce(p_certificate_path,'')),'') is not null
     and split_part(p_certificate_path,'/',1)<>v_profile.user_id then
    raise exception 'Invalid Worker certificate path';
  end if;
  insert into public.worker_verifications(
    worker_id,certificate_path,verification_video_url,status,
    submitted_at,created_at,updated_at
  ) values(
    v_profile.user_id,
    nullif(btrim(coalesce(p_certificate_path,'')),''),
    btrim(p_video_path),'evidence_ready',null,now(),now()
  ) on conflict(worker_id) do update set
    certificate_path=excluded.certificate_path,
    verification_video_url=excluded.verification_video_url,
    status='evidence_ready',submitted_at=null,reviewed_by=null,
    review_notes=null,reviewed_at=null,updated_at=now()
  returning id into v_id;
  update public.profiles
  set worker_status=case when v_paid then 'verification_paid' else 'pending' end,
      worker_verified=false,available=false,
      worker_cert_url=nullif(btrim(coalesce(p_certificate_path,'')),''),
      worker_video_url=btrim(p_video_path),updated_at=now()
  where user_id=v_profile.user_id;
  return v_id;
end
$$;

create or replace function public.submit_my_worker_verification()
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_profile public.profiles;
  v_ver public.worker_verifications;
  v_paid boolean:=false;
  v_payment_required boolean:=true;
begin
  select * into v_profile
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_profile is null or not public.current_actor_has_workspace('worker',null) then
    raise exception 'Worker workspace required';
  end if;
  if not public.worker_professional_profile_ready(v_profile.user_id) then
    raise exception 'Complete your professional profile and service coverage first';
  end if;
  if not public.worker_identity_is_current(v_profile.user_id) then
    raise exception 'Complete the current private WeHouse face check before submission';
  end if;
  select coalesce(lower(btrim(value)) not in ('false','0','off','no'),true)
  into v_payment_required
  from public.platform_settings
  where key='worker_verification_fee_enabled' and coalesce(is_active,true)
  limit 1;
  select exists(
    select 1 from public.booking_payments
    where user_id=v_profile.user_id and purpose='worker_verification'
      and status in ('paid','completed')
  ) into v_paid;
  if coalesce(v_payment_required,true) and not v_paid then
    raise exception 'Confirmed Paystack payment is required before submission';
  end if;
  select * into v_ver from public.worker_verifications
  where worker_id=v_profile.user_id limit 1;
  if v_ver is null
     or nullif(btrim(coalesce(v_ver.verification_video_url,'')),'') is null then
    raise exception 'A work demonstration video is required before review';
  end if;
  update public.worker_verifications
  set status='profile_under_review',submitted_at=now(),updated_at=now()
  where id=v_ver.id;
  update public.profiles
  set worker_status='profile_under_review',worker_verified=false,
      available=false,updated_at=now()
  where user_id=v_profile.user_id;
end
$$;

create or replace function public.set_my_worker_availability(
  p_is_available boolean
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_worker public.profiles;
begin
  select * into v_worker
  from public.profiles
  where auth_id=(select auth.uid())::text
  for update;
  if v_worker is null or not public.current_actor_has_workspace('worker',null) then
    raise exception 'Worker workspace required';
  end if;
  if coalesce(v_worker.deleted,false)
     or coalesce(v_worker.suspended,false)
     or coalesce(v_worker.banned,false) then
    raise exception 'Worker account is not active';
  end if;
  if p_is_available
     and (v_worker.worker_status<>'verified'
       or v_worker.worker_verified is distinct from true) then
    raise exception 'Only verified Workers can become available';
  end if;
  if p_is_available
     and not public.worker_identity_is_current(v_worker.user_id) then
    raise exception 'Repeat your WeHouse identity check before going available';
  end if;
  update public.profiles
  set available=p_is_available,updated_at=now()
  where id=v_worker.id;
end
$$;

revoke all on function public.complete_my_account_identity_check(
  text,numeric,numeric,numeric,jsonb,boolean
) from public,anon;
revoke all on function public.get_my_account_identity_reference()
from public,anon;
revoke all on function public.get_my_account_identity_status()
from public,anon;
revoke all on function public.get_my_worker_activation()
from public,anon;
revoke all on function public.create_worker_verification_payment()
from public,anon;
revoke all on function public.save_my_worker_professional_evidence(text,text)
from public,anon;
revoke all on function public.submit_my_worker_verification()
from public,anon;
revoke all on function public.set_my_worker_availability(boolean)
from public,anon;

grant execute on function public.complete_my_account_identity_check(
  text,numeric,numeric,numeric,jsonb,boolean
) to authenticated,service_role;
grant execute on function public.get_my_account_identity_reference()
to authenticated,service_role;
grant execute on function public.get_my_account_identity_status()
to authenticated,service_role;
grant execute on function public.get_my_worker_activation()
to authenticated,service_role;
grant execute on function public.create_worker_verification_payment()
to authenticated,service_role;
grant execute on function public.save_my_worker_professional_evidence(text,text)
to authenticated,service_role;
grant execute on function public.submit_my_worker_verification()
to authenticated,service_role;
grant execute on function public.set_my_worker_availability(boolean)
to authenticated,service_role;

insert into public.function_execution_registry(
  function_signature,function_name,security_mode,public_allowed,anon_allowed,
  authenticated_allowed,service_role_allowed,review_state,rationale,captured_at
)
select
  p.oid::regprocedure::text,p.proname,
  case when p.prosecdef then 'definer' else 'invoker' end,
  has_function_privilege('public',p.oid,'execute'),
  has_function_privilege('anon',p.oid,'execute'),
  has_function_privilege('authenticated',p.oid,'execute'),
  has_function_privilege('service_role',p.oid,'execute'),
  case when p.proname='user_has_active_workspace'
    then 'approved_policy_helper' else 'approved_client_rpc' end,
  case when p.proname='user_has_active_workspace'
    then 'Boolean active-workspace projection used by public policies and discovery'
    else 'Personal-first Worker or shared professional identity action bound to workspace authority'
  end,
  now()
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in(
  'user_has_active_workspace',
  'complete_my_account_identity_check',
  'get_my_account_identity_reference',
  'get_my_account_identity_status',
  'get_my_worker_activation',
  'create_worker_verification_payment',
  'save_my_worker_professional_evidence',
  'submit_my_worker_verification',
  'set_my_worker_availability'
)
on conflict(function_signature) do update set
  function_name=excluded.function_name,
  security_mode=excluded.security_mode,
  public_allowed=excluded.public_allowed,
  anon_allowed=excluded.anon_allowed,
  authenticated_allowed=excluded.authenticated_allowed,
  service_role_allowed=excluded.service_role_allowed,
  review_state=excluded.review_state,
  rationale=excluded.rationale,
  captured_at=now();

comment on function public.user_has_active_workspace(text,text) is
  'Returns only whether an active, unsuspended profile has the requested legacy or granted workspace.';
