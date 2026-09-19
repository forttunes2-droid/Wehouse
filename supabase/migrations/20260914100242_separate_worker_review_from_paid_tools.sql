-- WeHouse review/approval is the only Worker verification authority. The
-- optional paid-tools subscription is a separate product and never controls
-- test access, discovery, booking eligibility, ranking or review decisions.

create or replace function public.create_booking_request_v2(
  p_worker_id text,
  p_service_type text,
  p_description text,
  p_address text,
  p_scheduled_date text,
  p_customer_message text default null,
  p_location_source text default 'manual',
  p_latitude numeric default null,
  p_longitude numeric default null,
  p_accuracy_m numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_source text:=lower(btrim(coalesce(p_location_source,'manual')));
  v_result jsonb;
  v_booking_id uuid;
begin
  if v_source not in ('manual','current','saved') then
    raise exception 'Choose current location, saved location or enter an address';
  end if;
  if (p_latitude is null)<>(p_longitude is null) then
    raise exception 'Location coordinates are incomplete';
  end if;
  if p_latitude is not null and (p_latitude< -90 or p_latitude>90) then
    raise exception 'Location latitude is invalid';
  end if;
  if p_longitude is not null and (p_longitude< -180 or p_longitude>180) then
    raise exception 'Location longitude is invalid';
  end if;
  if p_accuracy_m is not null and p_accuracy_m<0 then
    raise exception 'Location accuracy is invalid';
  end if;
  if v_source in ('current','saved')
    and (p_latitude is null or p_longitude is null) then
    raise exception 'This location choice requires coordinates';
  end if;

  -- create_booking_request performs the current WeHouse-reviewed Worker,
  -- identity, availability, service and account-state checks atomically.
  v_result:=public.create_booking_request(
    p_worker_id,p_service_type,p_description,p_address,p_scheduled_date,
    p_customer_message
  );
  v_booking_id:=nullif(v_result->>'booking_id','')::uuid;

  update public.worker_bookings
  set service_latitude=p_latitude,
      service_longitude=p_longitude,
      service_location_accuracy_m=p_accuracy_m,
      service_location_source=v_source,
      updated_at=now()
  where id=v_booking_id;

  return v_result||jsonb_build_object('location_source',v_source);
end;
$$;

create or replace function public.start_my_worker_test()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_profile public.profiles;
  v_attempt public.worker_test_attempts;
  v_ids uuid[];
  v_questions jsonb;
  v_recent_failed integer;
begin
  select * into v_profile
  from public.profiles profile
  where profile.auth_id=(select auth.uid())::text
    and public.user_has_active_workspace(profile.user_id,'worker')
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
  limit 1;
  if v_profile.user_id is null then raise exception 'Active Worker account required'; end if;

  if public.worker_test_passed(v_profile.user_id) then
    select * into v_attempt from public.worker_test_attempts
    where worker_id=v_profile.user_id and passed=true
    order by submitted_at desc limit 1;
    return jsonb_build_object(
      'already_passed',true,'passed',true,'score',v_attempt.score,
      'total',v_attempt.total_questions,'percent',v_attempt.percent,
      'pass_percent',80
    );
  end if;

  update public.worker_test_attempts
  set submitted_at=now(),score=0,percent=0,passed=false,
      answers='{}'::jsonb
  where worker_id=v_profile.user_id and submitted_at is null
    and started_at<now()-interval '45 minutes';

  select count(*) into v_recent_failed
  from public.worker_test_attempts
  where worker_id=v_profile.user_id
    and submitted_at is not null
    and submitted_at>=now()-interval '24 hours'
    and passed=false;
  if v_recent_failed>=5 then
    raise exception 'Daily Worker test attempt limit reached. Try again after 24 hours';
  end if;

  select * into v_attempt
  from public.worker_test_attempts
  where worker_id=v_profile.user_id and submitted_at is null
  order by started_at desc limit 1;
  if v_attempt.id is null then
    select array_agg(question.id) into v_ids
    from (
      select question_row.id
      from public.worker_test_questions question_row
      where question_row.is_active=true
        and (
          question_row.category is null
          or lower(question_row.category)=lower(coalesce(v_profile.worker_occupation,''))
        )
      order by case when question_row.category is null then 1 else 0 end,random()
      limit 8
    ) question;
    if coalesce(array_length(v_ids,1),0)<5 then
      raise exception 'Worker test question bank is not configured';
    end if;
    insert into public.worker_test_attempts(worker_id,question_ids,total_questions)
    values(v_profile.user_id,v_ids,array_length(v_ids,1))
    returning * into v_attempt;
  else
    v_ids:=v_attempt.question_ids;
  end if;

  select jsonb_agg(
    jsonb_build_object('id',question.id,'question',question.question,'options',question.options)
    order by selected.ord
  ) into v_questions
  from unnest(v_ids) with ordinality as selected(id,ord)
  join public.worker_test_questions question on question.id=selected.id;

  return jsonb_build_object(
    'already_passed',false,'attempt_id',v_attempt.id,
    'questions',coalesce(v_questions,'[]'::jsonb),'pass_percent',80,
    'expires_at',v_attempt.started_at+interval '45 minutes'
  );
end;
$$;

create or replace function public._worker_review_trust_payload(p_worker_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_worker public.profiles;
  v_verification public.worker_verifications;
  v_identity public.worker_identity_checks;
  v_profile_ready boolean:=false;
begin
  select * into v_worker from public.profiles
  where user_id=p_worker_id
    and public.user_has_active_workspace(user_id,'worker')
  limit 1;
  if v_worker.user_id is null then raise exception 'Worker not found'; end if;
  select * into v_verification from public.worker_verifications
  where worker_id=p_worker_id limit 1;
  select * into v_identity from public.worker_identity_checks
  where worker_id=p_worker_id;
  v_profile_ready:=public.worker_professional_profile_ready(p_worker_id);

  return jsonb_build_object(
    'profile_ready',v_profile_ready,
    'identity_status',case when public.worker_identity_is_current(p_worker_id)
      then 'passed' else coalesce(v_identity.status,'not_started') end,
    'identity_captured',coalesce(v_identity.status='passed',false),
    'identity_passed',public.worker_identity_is_current(p_worker_id),
    'face_match_score',v_identity.face_match_score,
    'liveness_score',v_identity.liveness_score,
    'anti_spoof_score',v_identity.anti_spoof_score,
    'readiness_passed',v_profile_ready,
    'readiness_percent',case when v_profile_ready then 100 else 0 end,
    'evidence_saved',coalesce(nullif(btrim(coalesce(v_verification.verification_video_url,'')),'') is not null,false),
    'certificate_path',v_verification.certificate_path,
    'verification_video_url',v_verification.verification_video_url,
    'submitted',coalesce(v_verification.submitted_at is not null,false),
    'review_status',v_verification.status
  );
end;
$$;

revoke all on function public._worker_review_trust_payload(text)
from public,anon,authenticated;
grant execute on function public._worker_review_trust_payload(text)
to service_role;
