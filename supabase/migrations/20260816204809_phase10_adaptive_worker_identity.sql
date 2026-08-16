alter table public.worker_identity_checks
  add column if not exists latest_reference_photo_path text,
  add column if not exists latest_reference_at timestamptz;

update public.worker_identity_checks
set latest_reference_photo_path = enrollment_photo_path,
    latest_reference_at = coalesce(captured_at, updated_at, now())
where latest_reference_photo_path is null
  and enrollment_photo_path is not null;

create or replace function public.get_my_worker_identity_reference() returns jsonb language plpgsql security definer set search_path='public' as $$
declare
  v_actor public.profiles;
  v_identity public.worker_identity_checks;
begin
  select * into v_actor
  from public.profiles
  where auth_id=auth.uid()::text
    and role='worker'
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor is null then raise exception 'Active Worker account required'; end if;

  select * into v_identity from public.worker_identity_checks where worker_id=v_actor.user_id;

  return jsonb_build_object(
    'has_reference',coalesce(nullif(btrim(coalesce(v_identity.enrollment_photo_path,'')),'') is not null,false),
    'photo_path',v_identity.enrollment_photo_path,
    'anchor_photo_path',v_identity.enrollment_photo_path,
    'recent_photo_path',coalesce(v_identity.latest_reference_photo_path,v_identity.enrollment_photo_path),
    'recent_reference_at',v_identity.latest_reference_at,
    'captured_at',v_identity.captured_at,
    'status',coalesce(v_identity.status,'not_started')
  );
end; $$;
revoke all on function public.get_my_worker_identity_reference() from public,anon;
grant execute on function public.get_my_worker_identity_reference() to authenticated;

create or replace function public.complete_my_worker_identity_check(
  p_photo_path text,
  p_face_match_score numeric,
  p_liveness_score numeric,
  p_anti_spoof_score numeric,
  p_challenge_result jsonb,
  p_consent boolean
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare
  v_actor public.profiles;
  v_existing public.worker_identity_checks;
  v_attempts integer;
  v_is_renewal boolean:=false;
  v_anchor_similarity numeric;
  v_recent_similarity numeric;
  v_best_similarity numeric;
begin
  select * into v_actor
  from public.profiles
  where auth_id=auth.uid()::text
    and role='worker'
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor is null then raise exception 'Active Worker account required'; end if;
  if coalesce(p_consent,false)=false then raise exception 'Private face-check consent is required'; end if;

  select * into v_existing from public.worker_identity_checks where worker_id=v_actor.user_id;
  v_is_renewal:=v_existing.worker_id is not null and nullif(btrim(coalesce(v_existing.enrollment_photo_path,'')),'') is not null;

  if nullif(btrim(coalesce(p_photo_path,'')),'') is null or p_photo_path not like v_actor.user_id||'/%' then
    raise exception 'Invalid private face reference path';
  end if;
  if not exists(select 1 from storage.objects where bucket_id='worker-identity-private' and name=p_photo_path) then
    raise exception 'Private identity reference was not found';
  end if;

  if p_face_match_score is null or p_face_match_score<0 or p_face_match_score>1
     or p_liveness_score is null or p_liveness_score<0 or p_liveness_score>1
     or p_anti_spoof_score is null or p_anti_spoof_score<0 or p_anti_spoof_score>1 then
    raise exception 'Invalid automatic face-check score';
  end if;

  if coalesce((p_challenge_result->>'automatic')::boolean,false)=false
     or coalesce((p_challenge_result->>'center_start')::boolean,false)=false
     or coalesce((p_challenge_result->>'side_one')::boolean,false)=false
     or coalesce((p_challenge_result->>'side_two')::boolean,false)=false
     or coalesce((p_challenge_result->>'center_end')::boolean,false)=false
     or coalesce((p_challenge_result->>'recorded_video')::boolean,true)=true then
    raise exception 'Automatic head-movement challenge is incomplete';
  end if;

  v_anchor_similarity := case
    when coalesce(p_challenge_result->>'anchor_similarity','') ~ '^(0([.][0-9]+)?|1([.]0+)?)$'
      then (p_challenge_result->>'anchor_similarity')::numeric
    else null
  end;
  v_recent_similarity := case
    when coalesce(p_challenge_result->>'recent_similarity','') ~ '^(0([.][0-9]+)?|1([.]0+)?)$'
      then (p_challenge_result->>'recent_similarity')::numeric
    else null
  end;
  v_best_similarity := greatest(coalesce(v_anchor_similarity,0),coalesce(v_recent_similarity,0),p_face_match_score);

  if v_is_renewal then
    if v_anchor_similarity is null then raise exception 'Original identity anchor score is required'; end if;
    if v_anchor_similarity < 0.50 then raise exception 'Your current face changed too much from the original Worker identity. WeHouse review is required'; end if;
    if greatest(v_anchor_similarity,coalesce(v_recent_similarity,0)) < 0.55 then raise exception 'Your live face did not match the trusted Worker references closely enough'; end if;
  elsif p_face_match_score < 0.55 then
    raise exception 'Live face did not match the enrolled Worker closely enough';
  end if;

  if p_liveness_score<0.50 then raise exception 'Automatic liveness check did not pass'; end if;
  if p_anti_spoof_score<0.50 then raise exception 'Automatic anti-spoof check did not pass'; end if;

  v_attempts:=coalesce(v_existing.attempt_count,0)+1;

  insert into public.worker_identity_checks(
    worker_id,status,enrollment_photo_path,latest_reference_photo_path,latest_reference_at,
    challenge_version,face_match_score,liveness_score,anti_spoof_score,challenge_result,
    consent_at,captured_at,attempt_count,updated_at
  ) values(
    v_actor.user_id,'passed',p_photo_path,p_photo_path,now(),
    'human-3.3.6-head-turn-v3-adaptive',v_best_similarity,p_liveness_score,p_anti_spoof_score,p_challenge_result,
    now(),now(),v_attempts,now()
  )
  on conflict(worker_id) do update set
    status='passed',
    enrollment_photo_path=coalesce(worker_identity_checks.enrollment_photo_path,excluded.enrollment_photo_path),
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

  insert into public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
  values(
    case when v_is_renewal then 'WORKER_ADAPTIVE_IDENTITY_RECHECK_PASSED' else 'WORKER_AUTOMATIC_FACE_CHECK_PASSED' end,
    'profiles',v_actor.user_id,
    jsonb_build_object(
      'challenge_version','human-3.3.6-head-turn-v3-adaptive',
      'face_match_score',v_best_similarity,
      'anchor_similarity',v_anchor_similarity,
      'recent_similarity',v_recent_similarity,
      'liveness_score',p_liveness_score,
      'anti_spoof_score',p_anti_spoof_score,
      'adaptive_reference',v_is_renewal,
      'original_anchor_preserved',v_is_renewal,
      'liveness_video_recorded',false,
      'private_selfie',true
    )::text,
    v_actor.user_id,v_actor.email
  );

  return jsonb_build_object(
    'status','passed',
    'captured_at',now(),
    'attempt_count',v_attempts,
    'adaptive_reference',v_is_renewal,
    'anchor_preserved',v_is_renewal
  );
end; $$;

revoke all on function public.complete_my_worker_identity_check(text,numeric,numeric,numeric,jsonb,boolean) from public,anon;
grant execute on function public.complete_my_worker_identity_check(text,numeric,numeric,numeric,jsonb,boolean) to authenticated;
