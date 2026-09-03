-- Shared 30-day identity gate and property authority/access evidence lifecycle.
-- Identity expiry pauses privileged workspace access only; it never mutates business records.

insert into public.platform_settings(key,value,category,label,description,data_type,is_active,updated_at)
values('worker_identity_recheck_days','30','security','Identity recheck interval','Days between mandatory private identity live checks','number',true,now())
on conflict(key) do update set value='30',description=excluded.description,is_active=true,updated_at=now();

alter table public.worker_identity_checks add column if not exists account_role text;
update public.worker_identity_checks w
set account_role=p.role
from public.profiles p
where p.user_id=w.worker_id and w.account_role is null;
alter table public.worker_identity_checks drop constraint if exists worker_identity_checks_account_role_check;
alter table public.worker_identity_checks add constraint worker_identity_checks_account_role_check
  check(account_role is null or account_role in ('worker','property_partner'));

create or replace function public.account_identity_recheck_days() returns integer
language sql stable security definer set search_path='pg_catalog','public' as $$ select 30 $$;

create or replace function public.account_identity_is_current(p_user_id text) returns boolean
language sql stable security definer set search_path='pg_catalog','public' as $$
  select exists(
    select 1 from public.worker_identity_checks c
    where c.worker_id=p_user_id and c.status='passed' and c.captured_at is not null
      and c.captured_at + make_interval(days=>public.account_identity_recheck_days()) > now()
  )
$$;

create or replace function public.get_my_account_identity_status() returns jsonb
language plpgsql stable security definer set search_path='pg_catalog','public' as $$
declare v_actor public.profiles; v_check public.worker_identity_checks; v_days integer:=public.account_identity_recheck_days();
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text and role in ('worker','property_partner')
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor is null then raise exception 'Active Worker or Property Partner account required'; end if;
  select * into v_check from public.worker_identity_checks where worker_id=v_actor.user_id;
  return jsonb_build_object(
    'current',public.account_identity_is_current(v_actor.user_id),
    'enrolled',coalesce(nullif(btrim(coalesce(v_check.enrollment_photo_path,'')),'') is not null,false),
    'status',coalesce(v_check.status,'not_started'),'recheck_days',v_days,
    'captured_at',v_check.captured_at,
    'due_at',case when v_check.captured_at is null then null else v_check.captured_at+make_interval(days=>v_days) end
  );
end $$;

create or replace function public.get_my_account_identity_reference() returns jsonb
language plpgsql stable security definer set search_path='pg_catalog','public' as $$
declare v_actor public.profiles; v_check public.worker_identity_checks;
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text and role in ('worker','property_partner')
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor is null then raise exception 'Active Worker or Property Partner account required'; end if;
  select * into v_check from public.worker_identity_checks where worker_id=v_actor.user_id;
  return jsonb_build_object('has_reference',coalesce(nullif(btrim(coalesce(v_check.enrollment_photo_path,'')),'') is not null,false),
    'anchor_photo_path',v_check.enrollment_photo_path,'recent_photo_path',coalesce(v_check.latest_reference_photo_path,v_check.enrollment_photo_path),
    'captured_at',v_check.captured_at,'status',coalesce(v_check.status,'not_started'));
end $$;

create or replace function public.complete_my_account_identity_check(
  p_photo_path text,p_face_match_score numeric,p_liveness_score numeric,p_anti_spoof_score numeric,
  p_challenge_result jsonb,p_consent boolean
) returns jsonb language plpgsql security definer set search_path='pg_catalog','public','storage' as $$
declare v_actor public.profiles; v_existing public.worker_identity_checks; v_renewal boolean; v_attempts integer;
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text and role in ('worker','property_partner')
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor is null then raise exception 'Active Worker or Property Partner account required'; end if;
  if not coalesce(p_consent,false) then raise exception 'Private face-check consent is required'; end if;
  select * into v_existing from public.worker_identity_checks where worker_id=v_actor.user_id for update;
  v_renewal:=v_existing.worker_id is not null and nullif(btrim(coalesce(v_existing.enrollment_photo_path,'')),'') is not null;
  if nullif(btrim(coalesce(p_photo_path,'')),'') is null or split_part(p_photo_path,'/',1)<>v_actor.user_id then raise exception 'Invalid private identity path'; end if;
  if v_renewal and p_photo_path<>v_existing.enrollment_photo_path then raise exception 'Renewal must reuse the original private identity reference'; end if;
  if not exists(select 1 from storage.objects where bucket_id='worker-identity-private' and name=p_photo_path) then raise exception 'Private identity reference was not found'; end if;
  if p_face_match_score not between 0 and 1 or p_liveness_score not between 0 and 1 or p_anti_spoof_score not between 0 and 1 then raise exception 'Invalid automatic face-check score'; end if;
  if p_face_match_score<0.55 then raise exception 'Live face did not match the private identity reference closely enough'; end if;
  if p_liveness_score<0.50 then raise exception 'Automatic liveness check did not pass'; end if;
  if p_anti_spoof_score<0.50 then raise exception 'Automatic anti-spoof check did not pass'; end if;
  if not coalesce((p_challenge_result->>'automatic')::boolean,false)
    or not coalesce((p_challenge_result->>'center_start')::boolean,false)
    or not coalesce((p_challenge_result->>'side_one')::boolean,false)
    or not coalesce((p_challenge_result->>'side_two')::boolean,false)
    or not coalesce((p_challenge_result->>'center_end')::boolean,false)
    or coalesce((p_challenge_result->>'recorded_video')::boolean,true) then raise exception 'Automatic head-movement challenge is incomplete'; end if;
  v_attempts:=coalesce(v_existing.attempt_count,0)+1;
  insert into public.worker_identity_checks(worker_id,account_role,status,enrollment_photo_path,latest_reference_photo_path,latest_reference_at,
    challenge_version,face_match_score,liveness_score,anti_spoof_score,challenge_result,consent_at,captured_at,attempt_count,updated_at)
  values(v_actor.user_id,v_actor.role,'passed',p_photo_path,p_photo_path,now(),'human-3.3.6-head-turn-v4-shared',p_face_match_score,
    p_liveness_score,p_anti_spoof_score,p_challenge_result,now(),now(),v_attempts,now())
  on conflict(worker_id) do update set account_role=excluded.account_role,status='passed',
    enrollment_photo_path=coalesce(worker_identity_checks.enrollment_photo_path,excluded.enrollment_photo_path),
    latest_reference_photo_path=excluded.latest_reference_photo_path,latest_reference_at=excluded.latest_reference_at,
    challenge_version=excluded.challenge_version,face_match_score=excluded.face_match_score,liveness_score=excluded.liveness_score,
    anti_spoof_score=excluded.anti_spoof_score,challenge_result=excluded.challenge_result,consent_at=excluded.consent_at,
    captured_at=excluded.captured_at,attempt_count=v_attempts,updated_at=now();
  insert into public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
  values(case when v_renewal then 'ACCOUNT_IDENTITY_RECHECK_PASSED' else 'ACCOUNT_IDENTITY_ENROLLED' end,'profiles',v_actor.user_id,
    jsonb_build_object('role',v_actor.role,'challenge_version','human-3.3.6-head-turn-v4-shared')::text,v_actor.user_id,v_actor.email);
  return jsonb_build_object('success',true,'current',true,'renewal',v_renewal,'recheck_days',public.account_identity_recheck_days());
end $$;

-- The old Worker helper now shares the approved 30-day interval.
create or replace function public.worker_identity_recheck_days() returns integer
language sql stable security definer set search_path='pg_catalog','public' as $$ select public.account_identity_recheck_days() $$;

alter table public.inspection_requests add column if not exists authority_relationship text;
alter table public.inspection_requests add column if not exists access_challenge_code text;
alter table public.inspection_requests add column if not exists access_challenge_expires_at timestamptz;
alter table public.inspection_requests add column if not exists access_evidence_status text not null default 'required';
alter table public.inspection_requests add column if not exists access_evidence_video_path text;
alter table public.inspection_requests add column if not exists access_evidence_submitted_at timestamptz;
alter table public.inspection_requests add column if not exists access_evidence_verified_at timestamptz;
alter table public.inspection_requests add column if not exists access_evidence_verified_by text;
alter table public.inspection_requests drop constraint if exists inspection_requests_authority_relationship_check;
alter table public.inspection_requests add constraint inspection_requests_authority_relationship_check
  check(authority_relationship is null or authority_relationship in ('owner','property_manager','agent','authorized_representative'));
alter table public.inspection_requests drop constraint if exists inspection_requests_access_evidence_status_check;
alter table public.inspection_requests add constraint inspection_requests_access_evidence_status_check
  check(access_evidence_status in ('required','submitted','verified','rejected'));
update public.inspection_requests set access_challenge_code=upper(substring(replace(gen_random_uuid()::text,'-','') from 1 for 6)),
  access_challenge_expires_at=now()+interval '7 days' where access_challenge_code is null and published_at is null;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('property-access-private','property-access-private',false,104857600,array['video/mp4','video/webm','video/quicktime'])
on conflict(id) do update set public=false,file_size_limit=104857600,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "account owners upload private identity reference" on storage.objects;
create policy "account owners upload private identity reference" on storage.objects for insert to authenticated
with check(bucket_id='worker-identity-private' and exists(select 1 from public.profiles p where p.auth_id=auth.uid()::text
  and p.role in ('worker','property_partner') and split_part(name,'/',1)=p.user_id));
drop policy if exists "account owners read private identity reference" on storage.objects;
create policy "account owners read private identity reference" on storage.objects for select to authenticated
using(bucket_id='worker-identity-private' and exists(select 1 from public.profiles p where p.auth_id=auth.uid()::text
  and p.role in ('worker','property_partner') and split_part(name,'/',1)=p.user_id));

drop policy if exists "property partners upload own access evidence" on storage.objects;
create policy "property partners upload own access evidence" on storage.objects for insert to authenticated
with check(bucket_id='property-access-private' and exists(select 1 from public.profiles p where p.auth_id=auth.uid()::text
  and p.role='property_partner' and split_part(name,'/',1)=p.user_id and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)));
drop policy if exists "property partners read own access evidence" on storage.objects;
create policy "property partners read own access evidence" on storage.objects for select to authenticated
using(bucket_id='property-access-private' and exists(select 1 from public.profiles p where p.auth_id=auth.uid()::text and split_part(name,'/',1)=p.user_id));
drop policy if exists "property partners delete failed access evidence" on storage.objects;
create policy "property partners delete failed access evidence" on storage.objects for delete to authenticated
using(bucket_id='property-access-private' and exists(select 1 from public.profiles p where p.auth_id=auth.uid()::text and split_part(name,'/',1)=p.user_id));
drop policy if exists "authorized operations read property access evidence" on storage.objects;
create policy "authorized operations read property access evidence" on storage.objects for select to authenticated
using(bucket_id='property-access-private' and exists(select 1 from public.profiles p where p.auth_id=auth.uid()::text
  and p.role in ('creator','admin') and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)));

create or replace function public.enforce_property_access_before_assignment() returns trigger
language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_actor public.profiles;
begin
  if new.authority_relationship is not null
     and coalesce(new.assigned_field_officer_id,new.field_officer_id,new.assigned_to) is distinct from coalesce(old.assigned_field_officer_id,old.field_officer_id,old.assigned_to) then
    if new.access_evidence_status not in ('submitted','verified') then raise exception 'Review the Property Partner access evidence before assigning a field visit'; end if;
    if new.access_evidence_status='submitted' then
      select * into v_actor from public.profiles where auth_id=auth.uid()::text limit 1;
      new.access_evidence_status:='verified'; new.access_evidence_verified_at:=now(); new.access_evidence_verified_by:=v_actor.user_id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_require_property_access_before_assignment on public.inspection_requests;
create trigger trg_require_property_access_before_assignment before update of assigned_field_officer_id,field_officer_id,assigned_to
on public.inspection_requests for each row execute function public.enforce_property_access_before_assignment();

create or replace function public.create_my_property_inspection_batch_v2(p_items jsonb) returns jsonb
language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_actor public.profiles; v_result jsonb; v_request jsonb; v_relation text;
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text and role='property_partner'
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor is null then raise exception 'Active Property Partner account required'; end if;
  if not public.account_identity_is_current(v_actor.user_id) then raise exception 'Complete the private identity check before submitting properties'; end if;
  v_result:=public.create_my_property_inspection_batch(p_items);
  for v_request in select value from jsonb_array_elements(v_result->'requests') loop
    v_relation:=nullif(btrim(p_items->((v_request->>'position')::integer-1)->>'authority_relationship'),'');
    if v_relation not in ('owner','property_manager','agent','authorized_representative') then raise exception 'Choose your relationship to property %',v_request->>'position'; end if;
    update public.inspection_requests set authority_relationship=v_relation,
      access_challenge_code=upper(substring(replace(gen_random_uuid()::text,'-','') from 1 for 6)),
      access_challenge_expires_at=now()+interval '7 days',access_evidence_status='required',updated_at=now()
    where id=(v_request->>'id')::uuid and owner_id=v_actor.user_id;
  end loop;
  return v_result;
end $$;

create or replace function public.submit_my_property_access_evidence(p_request_id uuid,p_video_path text) returns jsonb
language plpgsql security definer set search_path='pg_catalog','public','storage' as $$
declare v_actor public.profiles; v_request public.inspection_requests;
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text and role='property_partner'
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor is null then raise exception 'Active Property Partner account required'; end if;
  if not public.account_identity_is_current(v_actor.user_id) then raise exception 'Complete the private identity check before submitting access evidence'; end if;
  select * into v_request from public.inspection_requests where id=p_request_id and owner_id=v_actor.user_id for update;
  if v_request.id is null then raise exception 'Property request not found'; end if;
  if v_request.access_challenge_expires_at<=now() then raise exception 'This temporary code expired. Request a new code'; end if;
  if split_part(p_video_path,'/',1)<>v_actor.user_id or split_part(p_video_path,'/',2)<>p_request_id::text then raise exception 'Invalid private access evidence path'; end if;
  if not exists(select 1 from storage.objects where bucket_id='property-access-private' and name=p_video_path) then raise exception 'Private access evidence upload was not found'; end if;
  update public.inspection_requests set access_evidence_video_path=p_video_path,access_evidence_status='submitted',
    access_evidence_submitted_at=now(),updated_at=now() where id=p_request_id;
  insert into public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
  values('PROPERTY_ACCESS_EVIDENCE_SUBMITTED','inspection_requests',p_request_id::text,
    jsonb_build_object('request_code',v_request.request_code,'relationship',v_request.authority_relationship)::text,v_actor.user_id,v_actor.email);
  return jsonb_build_object('success',true,'status','submitted');
end $$;

create or replace function public.refresh_my_property_access_challenge(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_actor public.profiles; v_code text;
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text and role='property_partner' limit 1;
  if v_actor is null then raise exception 'Property Partner account required'; end if;
  v_code:=upper(substring(replace(gen_random_uuid()::text,'-','') from 1 for 6));
  update public.inspection_requests set access_challenge_code=v_code,access_challenge_expires_at=now()+interval '7 days',
    access_evidence_status='required',updated_at=now() where id=p_request_id and owner_id=v_actor.user_id and published_at is null;
  if not found then raise exception 'Property request not found'; end if;
  return jsonb_build_object('code',v_code,'expires_at',now()+interval '7 days');
end $$;

revoke all on function public.account_identity_recheck_days(),public.account_identity_is_current(text),
  public.get_my_account_identity_status(),public.get_my_account_identity_reference(),
  public.complete_my_account_identity_check(text,numeric,numeric,numeric,jsonb,boolean),
  public.create_my_property_inspection_batch_v2(jsonb),public.submit_my_property_access_evidence(uuid,text),
  public.refresh_my_property_access_challenge(uuid) from public,anon;
revoke all on function public.account_identity_recheck_days(),public.account_identity_is_current(text) from authenticated;
revoke all on function public.enforce_property_access_before_assignment() from public,anon,authenticated;
grant execute on function public.get_my_account_identity_status(),public.get_my_account_identity_reference(),
  public.complete_my_account_identity_check(text,numeric,numeric,numeric,jsonb,boolean),
  public.create_my_property_inspection_batch_v2(jsonb),public.submit_my_property_access_evidence(uuid,text),
  public.refresh_my_property_access_challenge(uuid) to authenticated;
grant execute on function public.account_identity_recheck_days(),public.account_identity_is_current(text) to service_role;
