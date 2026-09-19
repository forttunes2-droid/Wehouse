begin;

-- Browser-computed face and liveness scores are useful screening evidence, but
-- they are not a trusted approval authority: a modified browser can invent
-- those values. Keep the evidence private and require a different authorised
-- WeHouse account to make the final identity decision.
alter table public.worker_identity_checks
  drop constraint if exists worker_identity_checks_status_check;
alter table public.worker_identity_checks
  add constraint worker_identity_checks_status_check
  check(status in('not_started','pending_review','passed','failed','rejected'));
alter table public.worker_identity_checks
  add column if not exists submitted_at timestamptz,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by text,
  add column if not exists review_notes text,
  add column if not exists pending_reference_photo_path text;

create or replace function public.current_actor_can_review_account_identity(
  p_user_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_target public.profiles;
begin
  select * into v_actor from public.profiles profile
  where profile.auth_id=(select auth.uid())::text
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
  limit 1;
  select * into v_target from public.profiles profile
  where profile.user_id=p_user_id
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
  limit 1;
  if v_actor.user_id is null or v_target.user_id is null
     or v_actor.user_id=v_target.user_id then return false; end if;
  if not (
    public.user_has_active_workspace(v_target.user_id,'worker')
    or public.user_has_active_workspace(v_target.user_id,'property_partner')
  ) then return false; end if;
  if v_actor.role='creator' then return true; end if;
  if v_actor.role='admin' then
    return nullif(public.wehouse_state_key(v_actor.assigned_state),'') is not null
      and public.wehouse_state_key(v_actor.assigned_state)=public.wehouse_state_key(v_target.state);
  end if;
  if v_actor.role='staff' and (
    (public.user_has_active_workspace(v_target.user_id,'worker')
      and public.current_staff_has_permission('worker_operations'))
    or (public.user_has_active_workspace(v_target.user_id,'property_partner')
      and public.current_staff_has_permission('property_operations'))
  ) then
    return public.wehouse_state_key(v_actor.assigned_state)=public.wehouse_state_key(v_target.state);
  end if;
  return false;
end;
$$;

create or replace function public.current_actor_can_read_account_identity_reference(
  p_object_name text
)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select exists(
    select 1
    from public.worker_identity_checks check_row
    where check_row.worker_id=split_part(p_object_name,'/',1)
      and check_row.status='pending_review'
      and p_object_name=coalesce(
        check_row.pending_reference_photo_path,
        check_row.latest_reference_photo_path,
        check_row.enrollment_photo_path
      )
      and public.current_actor_can_review_account_identity(check_row.worker_id)
  );
$$;

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
  select * into v_actor from public.profiles profile
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
  else raise exception 'Worker or Property Partner workspace required'; end if;
  if not coalesce(p_consent,false) then
    raise exception 'Private face-check consent is required';
  end if;
  select * into v_existing from public.worker_identity_checks check_row
  where check_row.worker_id=v_actor.user_id for update;
  v_renewal:=v_existing.worker_id is not null
    and nullif(btrim(coalesce(v_existing.enrollment_photo_path,'')),'') is not null;
  if nullif(btrim(coalesce(p_photo_path,'')),'') is null
     or split_part(p_photo_path,'/',1)<>v_actor.user_id then
    raise exception 'Invalid private identity path';
  end if;
  if v_renewal and p_photo_path=v_existing.enrollment_photo_path then
    raise exception 'Renewal requires a fresh private live-check still';
  end if;
  if not exists(select 1 from storage.objects object_row
    where object_row.bucket_id='worker-identity-private'
      and object_row.name=p_photo_path) then
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
    latest_reference_photo_path,latest_reference_at,pending_reference_photo_path,challenge_version,
    face_match_score,liveness_score,anti_spoof_score,challenge_result,
    consent_at,captured_at,attempt_count,submitted_at,reviewed_at,reviewed_by,
    review_notes,updated_at
  ) values(
    v_actor.user_id,v_account_role,'pending_review',p_photo_path,null,null,p_photo_path,
    'human-3.3.6-head-turn-v4-manual-review',p_face_match_score,p_liveness_score,
    p_anti_spoof_score,p_challenge_result,now(),null,v_attempts,now(),null,null,
    null,now()
  ) on conflict(worker_id) do update set
    account_role=excluded.account_role,status='pending_review',
    enrollment_photo_path=coalesce(worker_identity_checks.enrollment_photo_path,excluded.enrollment_photo_path),
    pending_reference_photo_path=excluded.pending_reference_photo_path,
    challenge_version=excluded.challenge_version,
    face_match_score=excluded.face_match_score,
    liveness_score=excluded.liveness_score,
    anti_spoof_score=excluded.anti_spoof_score,
    challenge_result=excluded.challenge_result,
    consent_at=excluded.consent_at,captured_at=null,attempt_count=v_attempts,
    submitted_at=now(),reviewed_at=null,reviewed_by=null,review_notes=null,
    updated_at=now();
  insert into public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
  values('ACCOUNT_IDENTITY_REVIEW_REQUESTED','profiles',v_actor.user_id,
    jsonb_build_object('workspace',v_account_role,'renewal',v_renewal,
      'challenge_version','human-3.3.6-head-turn-v4-manual-review')::text,
    v_actor.user_id,v_actor.email);
  return jsonb_build_object('success',true,'current',false,'status','pending_review',
    'renewal',v_renewal,'recheck_days',public.account_identity_recheck_days());
end;
$$;

create or replace function public.get_my_account_identity_review_queue()
returns table(
  user_id text,account_role text,full_name text,username text,state text,
  local_government text,city text,submitted_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  if not public.current_user_is_staff() then raise exception 'WeHouse Team access required'; end if;
  return query
  select profile.user_id,check_row.account_role,profile.full_name,profile.username,
    profile.state,profile.local_government,profile.city,check_row.submitted_at
  from public.worker_identity_checks check_row
  join public.profiles profile on profile.user_id=check_row.worker_id
  where check_row.status='pending_review'
    and public.current_actor_can_review_account_identity(profile.user_id)
  order by check_row.submitted_at;
end;
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
  select * into v_actor from public.profiles profile
  where profile.auth_id=(select auth.uid())::text
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
  limit 1;
  if v_actor.user_id is null or not (
    public.current_actor_has_workspace('worker',null)
    or public.current_actor_has_workspace('property_partner',null)
  ) then raise exception 'Worker or Property Partner workspace required'; end if;
  select * into v_check from public.worker_identity_checks check_row
  where check_row.worker_id=v_actor.user_id;
  return jsonb_build_object(
    'current',public.account_identity_is_current(v_actor.user_id),
    'enrolled',coalesce(nullif(btrim(coalesce(v_check.enrollment_photo_path,'')),'') is not null,false),
    'status',coalesce(v_check.status,'not_started'),
    'review_notes',v_check.review_notes,
    'recheck_days',v_days,'captured_at',v_check.captured_at,
    'due_at',case when v_check.captured_at is null then null
      else v_check.captured_at+make_interval(days=>v_days) end
  );
end;
$$;

create or replace function public.get_review_account_identity_check(p_user_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_check public.worker_identity_checks;
begin
  if not public.current_actor_can_review_account_identity(p_user_id) then
    raise exception 'Identity review is outside your authority';
  end if;
  select * into v_check from public.worker_identity_checks check_row
  where check_row.worker_id=p_user_id;
  return jsonb_build_object(
    'status',coalesce(v_check.status,'not_started'),
    'account_role',v_check.account_role,
    'photo_path',case when v_check.status='pending_review' then
      coalesce(v_check.pending_reference_photo_path,v_check.latest_reference_photo_path,v_check.enrollment_photo_path)
      else null end,
    'face_match_score',v_check.face_match_score,
    'liveness_score',v_check.liveness_score,
    'anti_spoof_score',v_check.anti_spoof_score,
    'challenge_version',v_check.challenge_version,
    'submitted_at',v_check.submitted_at,
    'attempt_count',coalesce(v_check.attempt_count,0)
  );
end;
$$;

create or replace function public.review_account_identity_check(
  p_user_id text,p_decision text,p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_check public.worker_identity_checks;
begin
  if p_decision not in('approved','rejected') then raise exception 'Choose approved or rejected'; end if;
  if p_decision='rejected' and nullif(btrim(coalesce(p_notes,'')),'') is null then
    raise exception 'A rejection reason is required';
  end if;
  if not public.current_actor_can_review_account_identity(p_user_id) then
    raise exception 'Identity review is outside your authority';
  end if;
  select * into v_actor from public.profiles profile
  where profile.auth_id=(select auth.uid())::text limit 1;
  select * into v_check from public.worker_identity_checks check_row
  where check_row.worker_id=p_user_id for update;
  if v_check.worker_id is null or v_check.status<>'pending_review' then
    raise exception 'This identity check is not awaiting review';
  end if;
  update public.worker_identity_checks
  set status=case when p_decision='approved' then 'passed' else 'rejected' end,
    captured_at=case when p_decision='approved' then now() else null end,
    enrollment_photo_path=case
      when p_decision='rejected' and latest_reference_photo_path is null then null
      else enrollment_photo_path end,
    latest_reference_photo_path=case when p_decision='approved'
      then coalesce(pending_reference_photo_path,latest_reference_photo_path,enrollment_photo_path)
      else latest_reference_photo_path end,
    latest_reference_at=case when p_decision='approved' then now() else latest_reference_at end,
    pending_reference_photo_path=null,
    reviewed_at=now(),reviewed_by=v_actor.user_id,
    review_notes=nullif(btrim(coalesce(p_notes,'')),''),updated_at=now()
  where worker_id=p_user_id;
  insert into public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
  values(case when p_decision='approved' then 'ACCOUNT_IDENTITY_REVIEW_APPROVED'
      else 'ACCOUNT_IDENTITY_REVIEW_REJECTED' end,
    'profiles',p_user_id,jsonb_build_object('notes',nullif(btrim(coalesce(p_notes,'')),''))::text,
    v_actor.user_id,v_actor.email);
  return jsonb_build_object('success',true,'status',
    case when p_decision='approved' then 'passed' else 'rejected' end);
end;
$$;

create or replace function public.get_staff_worker_identity_check(p_worker_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  return public.get_review_account_identity_check(p_worker_id);
end;
$$;

drop policy if exists identity_reviewer_read_private_reference on storage.objects;
create policy identity_reviewer_read_private_reference on storage.objects
for select to authenticated
using(
  bucket_id='worker-identity-private'
  and public.current_actor_can_read_account_identity_reference(name)
);

-- Earlier automatic passes were based only on caller-supplied browser scores.
-- Preserve their evidence, but require the new independent decision before
-- they can unlock review or public discovery.
update public.worker_identity_checks
set status='pending_review',submitted_at=coalesce(submitted_at,updated_at),
  pending_reference_photo_path=coalesce(latest_reference_photo_path,enrollment_photo_path),
  captured_at=null,reviewed_at=null,reviewed_by=null,review_notes=null,
  updated_at=now()
where status='passed';

update public.profiles profile
set worker_status=case when profile.worker_status='verified' then 'pending' else profile.worker_status end,
  worker_verified=false,available=false,updated_at=now()
where public.user_has_active_workspace(profile.user_id,'worker')
  and not public.worker_identity_is_current(profile.user_id);

-- Trigger helpers never need browser/API execution. Date-of-birth submission is
-- signed-in only; name anon explicitly so later default grants cannot blur it.
revoke all on function public.require_adult_before_profile_completion() from public,anon,authenticated;
grant execute on function public.require_adult_before_profile_completion() to service_role;
revoke all on function public.set_my_date_of_birth(date) from public,anon;
grant execute on function public.set_my_date_of_birth(date) to authenticated,service_role;

revoke all on function public.current_actor_can_review_account_identity(text) from public,anon;
grant execute on function public.current_actor_can_review_account_identity(text) to authenticated,service_role;
revoke all on function public.current_actor_can_read_account_identity_reference(text) from public,anon;
grant execute on function public.current_actor_can_read_account_identity_reference(text) to authenticated,service_role;
revoke all on function public.complete_my_account_identity_check(text,numeric,numeric,numeric,jsonb,boolean) from public,anon;
grant execute on function public.complete_my_account_identity_check(text,numeric,numeric,numeric,jsonb,boolean) to authenticated,service_role;
revoke all on function public.get_my_account_identity_review_queue() from public,anon;
grant execute on function public.get_my_account_identity_review_queue() to authenticated,service_role;
revoke all on function public.get_my_account_identity_status() from public,anon;
grant execute on function public.get_my_account_identity_status() to authenticated,service_role;
revoke all on function public.get_review_account_identity_check(text) from public,anon;
grant execute on function public.get_review_account_identity_check(text) to authenticated,service_role;
revoke all on function public.review_account_identity_check(text,text,text) from public,anon;
grant execute on function public.review_account_identity_check(text,text,text) to authenticated,service_role;
revoke all on function public.get_staff_worker_identity_check(text) from public,anon;
grant execute on function public.get_staff_worker_identity_check(text) to authenticated,service_role;

comment on function public.complete_my_account_identity_check(text,numeric,numeric,numeric,jsonb,boolean) is
  'Stores private browser face-screening evidence as pending_review; it never self-approves identity.';
comment on function public.review_account_identity_check(text,text,text) is
  'Separate-authority decision for pending Worker or Property Partner identity evidence.';

commit;
