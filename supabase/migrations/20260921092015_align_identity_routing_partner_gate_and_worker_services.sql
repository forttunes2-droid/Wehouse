begin;

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
  v_worker boolean;
  v_partner boolean;
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

  v_worker:=public.current_actor_has_workspace('worker',null);
  v_partner:=public.current_actor_has_workspace('property_partner',null);
  v_account_role:=lower(nullif(btrim(coalesce(p_challenge_result->>'workspace','')),''));

  if v_account_role is null then
    if v_worker and not v_partner then v_account_role:='worker';
    elsif v_partner and not v_worker then v_account_role:='property_partner';
    else
      raise exception 'Choose the Worker or Property Partner workspace for this identity check';
    end if;
  end if;

  if v_account_role not in ('worker','property_partner') then
    raise exception 'Identity check workspace is invalid';
  end if;
  if v_account_role='worker' and not v_worker then
    raise exception 'Worker workspace required';
  end if;
  if v_account_role='property_partner' and not v_partner then
    raise exception 'Property Partner workspace required';
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
    'workspace',v_account_role,
    'renewal',v_renewal,
    'recurring_required',public.account_identity_recurring_enabled(),
    'recheck_days',case when public.account_identity_recurring_enabled()
      then public.account_identity_recheck_days() else null end
  );
end;
$$;

revoke all on function public.complete_my_account_identity_check(text,numeric,numeric,numeric,jsonb,boolean) from public,anon;
grant execute on function public.complete_my_account_identity_check(text,numeric,numeric,numeric,jsonb,boolean) to authenticated,service_role;

create or replace function public.current_actor_can_review_account_identity(p_user_id text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  actor public.profiles;
  target public.profiles;
  pending_role text;
begin
  select * into actor from public.profiles p
  where p.auth_id=(select auth.uid())::text
    and p.deleted_at is null and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false) and not coalesce(p.banned,false)
  limit 1;
  select * into target from public.profiles p
  where p.user_id=p_user_id
    and p.deleted_at is null and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false) and not coalesce(p.banned,false)
  limit 1;
  if actor.user_id is null or target.user_id is null or actor.user_id=target.user_id then return false; end if;

  select check_row.account_role into pending_role
  from public.worker_identity_checks check_row
  where check_row.worker_id=p_user_id and check_row.status='pending_review'
  limit 1;

  if pending_role not in ('worker','property_partner') then return false; end if;
  if pending_role='worker' and not public.user_has_active_workspace(target.user_id,'worker') then return false; end if;
  if pending_role='property_partner' and not public.user_has_active_workspace(target.user_id,'property_partner') then return false; end if;

  if public.current_actor_has_workspace('creator',null) then return true; end if;

  return exists(
    select 1 from public.workspace_role_assignments w
    where w.user_id=actor.user_id and w.status='active' and w.revoked_at is null
      and (
        (w.workspace_role='admin' and public.current_actor_has_workspace('admin',null))
        or (
          public.current_actor_has_workspace('staff',null)
          and (
            (pending_role='worker' and w.workspace_role='worker_operations')
            or (pending_role='property_partner' and w.workspace_role='property_operations')
          )
        )
      )
      and (
        w.scope_type='global'
        or (
          w.scope_type in('state','branch')
          and nullif(public.wehouse_state_key(w.scope_state),'') is not null
          and public.wehouse_state_key(w.scope_state)=public.wehouse_state_key(target.state)
          and (
            w.scope_type='state'
            or (
              nullif(lower(btrim(w.scope_lga)),'') is not null
              and lower(btrim(w.scope_lga))=
                lower(btrim(coalesce(nullif(target.local_government,''),target.city)))
            )
          )
        )
      )
  );
end;
$$;

revoke all on function public.current_actor_can_review_account_identity(text) from public,anon;
grant execute on function public.current_actor_can_review_account_identity(text) to authenticated,service_role;

create or replace function public.create_my_property_access_challenge()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','extensions'
as $$
declare
  v_actor public.profiles;
  v_row public.property_access_challenges;
  v_code text;
begin
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor is null or not public.current_actor_has_workspace('property_partner',null) then
    raise exception 'Property Partner workspace required';
  end if;
  if public.account_identity_checks_enabled()
     and not public.account_identity_is_current(v_actor.user_id) then
    raise exception 'Complete the private identity check before adding properties';
  end if;
  v_code:=lpad(((('x'||substr(
    encode(extensions.gen_random_bytes(4),'hex'),1,8
  ))::bit(32)::bigint%1000000))::text,6,'0');
  insert into public.property_access_challenges(partner_id,code,expires_at)
  values(v_actor.user_id,v_code,now()+interval '24 hours')
  returning * into v_row;
  return jsonb_build_object('id',v_row.id,'code',v_row.code,'expires_at',v_row.expires_at);
end;
$$;

revoke all on function public.create_my_property_access_challenge() from public,anon;
grant execute on function public.create_my_property_access_challenge() to authenticated,service_role;

create or replace function public.submit_my_property_access_evidence(p_request_id uuid,p_video_path text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','storage'
as $$
declare v_actor public.profiles; v_request public.inspection_requests;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and public.user_has_active_workspace(user_id,'property_partner')
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor is null then raise exception 'Active Property Partner account required'; end if;
  if public.account_identity_checks_enabled()
     and not public.account_identity_is_current(v_actor.user_id) then
    raise exception 'Complete the private identity check before submitting access evidence';
  end if;
  select * into v_request from public.inspection_requests
  where id=p_request_id and owner_id=v_actor.user_id for update;
  if v_request.id is null then raise exception 'Property request not found'; end if;
  if v_request.access_challenge_expires_at<=now() then
    raise exception 'This temporary code expired. Request a new code';
  end if;
  if split_part(p_video_path,'/',1)<>v_actor.user_id
     or split_part(p_video_path,'/',2)<>p_request_id::text then
    raise exception 'Invalid private access evidence path';
  end if;
  if not exists(
    select 1 from storage.objects
    where bucket_id='property-access-private' and name=p_video_path
  ) then raise exception 'Private access evidence upload was not found'; end if;
  update public.inspection_requests
  set access_evidence_video_path=p_video_path,
      access_evidence_status='submitted',
      access_evidence_submitted_at=now(),
      updated_at=now()
  where id=p_request_id;
  insert into public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
  values(
    'PROPERTY_ACCESS_EVIDENCE_SUBMITTED','inspection_requests',p_request_id::text,
    jsonb_build_object('request_code',v_request.request_code,'relationship',v_request.authority_relationship)::text,
    v_actor.user_id,v_actor.email
  );
  return jsonb_build_object('success',true,'status','submitted');
end;
$$;

revoke all on function public.submit_my_property_access_evidence(uuid,text) from public,anon;
grant execute on function public.submit_my_property_access_evidence(uuid,text) to authenticated,service_role;

create or replace function public.create_my_property_inspection_batch_v2(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor public.profiles; v_result jsonb; v_request jsonb; v_relation text;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and public.user_has_active_workspace(user_id,'property_partner')
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor is null then raise exception 'Active Property Partner account required'; end if;
  if public.account_identity_checks_enabled()
     and not public.account_identity_is_current(v_actor.user_id) then
    raise exception 'Complete the private identity check before submitting properties';
  end if;
  v_result:=public.create_my_property_inspection_batch(p_items);
  for v_request in select value from jsonb_array_elements(v_result->'requests') loop
    v_relation:=nullif(btrim(p_items->((v_request->>'position')::integer-1)->>'authority_relationship'),'');
    if v_relation not in ('owner','property_manager','agent','authorized_representative') then
      raise exception 'Choose your relationship to property %',v_request->>'position';
    end if;
    update public.inspection_requests
    set authority_relationship=v_relation,
        access_challenge_code=upper(substring(replace(gen_random_uuid()::text,'-','') from 1 for 6)),
        access_challenge_expires_at=now()+interval '7 days',
        access_evidence_status='required',
        updated_at=now()
    where id=(v_request->>'id')::uuid and owner_id=v_actor.user_id;
  end loop;
  return v_result;
end;
$$;

revoke all on function public.create_my_property_inspection_batch_v2(jsonb) from public,anon;
grant execute on function public.create_my_property_inspection_batch_v2(jsonb) to authenticated,service_role;

create or replace function public.create_my_property_inspection_batch_v4(p_batch_id uuid,p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_auth_id text:=(select auth.uid())::text;
  v_actor text:=public.current_profile_user_id();
  v_result jsonb;
  v_created jsonb;
  v_item jsonb;
  v_position integer;
  v_request_id uuid;
  v_max_guests integer;
  v_display_name text;
begin
  if v_actor is null or not public.current_actor_has_workspace('property_partner',null) then
    raise exception 'Property Partner workspace required';
  end if;
  if public.account_identity_checks_enabled()
     and not public.account_identity_is_current(v_actor) then
    raise exception 'Complete the private identity check before submitting properties';
  end if;
  if not exists(
    select 1 from public.property_submission_batches batch
    where batch.id=p_batch_id
      and batch.partner_user_id=v_auth_id
      and batch.status in ('draft','submitting')
    for update
  ) then raise exception 'Property submission batch not found'; end if;
  update public.property_submission_batches
  set status='submitting',updated_at=now() where id=p_batch_id;
  v_result:=public.create_my_property_inspection_batch_v3(p_items);
  for v_created in select value from jsonb_array_elements(v_result->'requests') loop
    v_position:=(v_created->>'position')::integer;
    v_request_id:=(v_created->>'id')::uuid;
    v_item:=p_items->(v_position-1);
    v_max_guests:=nullif(v_item->>'max_guests','')::integer;
    v_display_name:=nullif(btrim(coalesce(v_item->>'property_display_name','')),'');
    if v_item->>'property_type'='apartment'
       and v_item->>'sub_type'='short_let'
       and coalesce(v_max_guests,0)<1 then
      raise exception 'Property %: Short Let guest capacity must be at least 1',v_position;
    end if;
    if v_item->>'property_type'='apartment'
       and v_item->>'sub_type'='short_let'
       and v_display_name is null then
      raise exception 'Property %: Short Let property or host name is required',v_position;
    end if;
    update public.inspection_requests set
      submission_schema_version=2,
      hotel_program=case when v_item->>'property_type'='hotel'
        then v_item->'hotel_program' else null end,
      max_guests=case
        when v_item->>'property_type'='apartment'
          and v_item->>'sub_type'='short_let'
        then v_max_guests else null end,
      property_display_name=case
        when v_item->>'property_type'='apartment'
          and v_item->>'sub_type'='short_let'
        then v_display_name else null end,
      submission_batch_id=p_batch_id,
      updated_at=now()
    where id=v_request_id and owner_id=v_actor;
    update public.property_submission_items
    set inspection_request_id=v_request_id,status='submitted',updated_at=now()
    where batch_id=p_batch_id and position=v_position-1;
  end loop;
  update public.property_submission_batches
  set status='submitted',submitted_at=now(),updated_at=now()
  where id=p_batch_id and partner_user_id=v_auth_id;
  return v_result||jsonb_build_object('batch_id',p_batch_id);
exception when others then
  update public.property_submission_batches
  set status='draft',updated_at=now()
  where id=p_batch_id and partner_user_id=v_auth_id;
  raise;
end;
$$;

revoke all on function public.create_my_property_inspection_batch_v4(uuid,jsonb) from public,anon;
grant execute on function public.create_my_property_inspection_batch_v4(uuid,jsonb) to authenticated,service_role;

create or replace function public.set_my_worker_services(p_services jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_item jsonb;
  v_name text;
  v_category text;
  v_price integer;
  v_price_type text;
  v_description text;
  v_count integer:=0;
  v_names text[]:='{}'::text[];
  v_search text[]:='{}'::text[];
begin
  select * into v_actor
  from public.profiles profile
  where profile.auth_id=(select auth.uid())::text
    and public.user_has_active_workspace(profile.user_id,'worker')
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
  limit 1;
  if v_actor.user_id is null then raise exception 'Active Worker account required'; end if;
  if p_services is null or jsonb_typeof(p_services)<>'array' then
    raise exception 'Services must be a list';
  end if;
  if jsonb_array_length(p_services)<1 then
    raise exception 'Add at least one service';
  end if;
  if jsonb_array_length(p_services)>10 then
    raise exception 'A Worker can list up to 10 services';
  end if;

  for v_item in select value from jsonb_array_elements(p_services) loop
    v_name:=nullif(btrim(coalesce(v_item->>'name','')),'');
    v_category:=nullif(btrim(coalesce(v_item->>'category','')),'');
    v_price:=greatest(0,coalesce(nullif(v_item->>'price','')::integer,0));
    v_price_type:=lower(coalesce(nullif(btrim(v_item->>'price_type'),''),'starting_from'));
    v_description:=nullif(btrim(coalesce(v_item->>'description','')),'');
    if v_name is null then raise exception 'Every service needs a name'; end if;
    if length(v_name)>120 then raise exception 'Service names must be 120 characters or less'; end if;
    if v_price_type not in ('starting_from','fixed','hourly','daily','negotiable') then
      raise exception 'Unsupported service price type';
    end if;
    if exists(select 1 from unnest(v_names) existing where lower(existing)=lower(v_name)) then
      raise exception 'Each service can only be added once';
    end if;
    v_names:=array_append(v_names,v_name);
    if v_category is not null then v_search:=array_append(v_search,v_category); end if;
    v_search:=array_append(v_search,v_name);
  end loop;

  delete from public.worker_services where worker_id=v_actor.user_id;
  for v_item in select value from jsonb_array_elements(p_services) loop
    v_name:=btrim(v_item->>'name');
    v_price:=greatest(0,coalesce(nullif(v_item->>'price','')::integer,0));
    v_price_type:=lower(coalesce(nullif(btrim(v_item->>'price_type'),''),'starting_from'));
    v_description:=nullif(btrim(coalesce(v_item->>'description','')),'');
    insert into public.worker_services(worker_id,service_name,price,price_type,description,created_at,updated_at)
    values(v_actor.user_id,v_name,v_price,v_price_type,v_description,now(),now());
    v_count:=v_count+1;
  end loop;

  update public.profiles
  set worker_skills=(
        select coalesce(jsonb_agg(value order by ord),'[]'::jsonb)
        from (
          select min(ord) ord, value
          from unnest(v_search) with ordinality item(value,ord)
          where nullif(btrim(value),'') is not null
          group by lower(btrim(value)),value
        ) deduped
      ),
      updated_at=now()
  where user_id=v_actor.user_id;

  return jsonb_build_object('success',true,'count',v_count,'services',to_jsonb(v_names));
end;
$$;

revoke all on function public.set_my_worker_services(jsonb) from public,anon;
grant execute on function public.set_my_worker_services(jsonb) to authenticated,service_role;

commit;
