-- profiles.role remains a compatibility projection during the migration to
-- workspace authority. Personal access is universal and does not depend on it.
-- Only one marketplace profession may be projected at launch.

create or replace function public.sync_marketplace_role_projection()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_user_id text:=case when tg_op='DELETE' then old.user_id else new.user_id end;
  v_workspace text;
  v_count integer;
begin
  select count(*)::integer,min(workspace_role)
  into v_count,v_workspace
  from public.workspace_role_assignments
  where user_id=v_user_id
    and workspace_role in ('worker','property_partner')
    and status='active';
  if v_count=1 then
    update public.profiles
    set role=v_workspace,account_kind='consumer',updated_at=now()
    where user_id=v_user_id
      and role in ('user','worker','property_partner')
      and role is distinct from v_workspace;
  elsif v_count=0 then
    update public.profiles
    set role='user',account_kind='consumer',updated_at=now()
    where user_id=v_user_id and role in ('worker','property_partner');
  end if;
  return case when tg_op='DELETE' then old else new end;
end
$$;

drop trigger if exists marketplace_role_projection
on public.workspace_role_assignments;
create trigger marketplace_role_projection
after insert or update of user_id,workspace_role,status or delete
on public.workspace_role_assignments
for each row execute function public.sync_marketplace_role_projection();

with single_profession as (
  select user_id,min(workspace_role) workspace_role
  from public.workspace_role_assignments
  where workspace_role in ('worker','property_partner') and status='active'
  group by user_id
  having count(*)=1
)
update public.profiles profile
set role=profession.workspace_role,account_kind='consumer',updated_at=now()
from single_profession profession
where profile.user_id=profession.user_id
  and profile.role in ('user','worker','property_partner')
  and profile.role is distinct from profession.workspace_role;

create or replace function public.get_or_create_my_property_partner()
returns public.property_partners
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_profile public.profiles;
  v_partner public.property_partners;
  v_code text;
begin
  select * into v_profile
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_profile is null
     or not public.current_actor_has_workspace('property_partner',null) then
    raise exception 'Property Partner workspace required';
  end if;
  select * into v_partner
  from public.property_partners
  where profile_id=v_profile.user_id limit 1;
  if v_partner is not null then return v_partner; end if;
  v_code:='WHP-'||replace(v_profile.user_id,'WHU-','')||'-'
    ||upper(substr(md5(v_profile.user_id||clock_timestamp()::text),1,4));
  insert into public.property_partners(
    profile_id,partner_code,status,commission_rate,total_earnings,
    total_paid_out,properties_count,created_at,updated_at
  ) values(
    v_profile.user_id,v_code,'pending_verification',0,0,0,0,now(),now()
  ) on conflict(profile_id) do update
    set updated_at=public.property_partners.updated_at
  returning * into v_partner;
  return v_partner;
end
$$;

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
  if v_actor is null
     or not public.current_actor_has_workspace('property_partner',null) then
    raise exception 'Property Partner workspace required';
  end if;
  if not public.account_identity_is_current(v_actor.user_id) then
    raise exception 'Complete the private identity check before adding properties';
  end if;
  v_code:=lpad(((('x'||substr(
    encode(extensions.gen_random_bytes(4),'hex'),1,8
  ))::bit(32)::bigint%1000000))::text,6,'0');
  insert into public.property_access_challenges(partner_id,code,expires_at)
  values(v_actor.user_id,v_code,now()+interval '24 hours')
  returning * into v_row;
  return jsonb_build_object(
    'id',v_row.id,'code',v_row.code,'expires_at',v_row.expires_at
  );
end
$$;

create or replace function public.validate_my_property_access_challenge(
  p_challenge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_row public.property_access_challenges;
  v_valid boolean;
begin
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor is null
     or not public.current_actor_has_workspace('property_partner',null) then
    raise exception 'Property Partner workspace required';
  end if;
  select * into v_row
  from public.property_access_challenges
  where id=p_challenge_id and partner_id=v_actor.user_id
  for update;
  if v_row.id is null then raise exception 'Property access challenge not found'; end if;
  v_valid:=v_row.status in ('prepared','submitted') and v_row.expires_at>now();
  if not v_valid and v_row.status='prepared' then
    update public.property_access_challenges
    set status='expired' where id=v_row.id;
  end if;
  return jsonb_build_object(
    'valid',v_valid,
    'status',case when v_valid then v_row.status else 'expired' end,
    'expires_at',v_row.expires_at
  );
end
$$;

create or replace function public.submit_my_property_access_challenge(
  p_challenge_id uuid,
  p_video_path text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','storage'
as $$
declare
  v_actor public.profiles;
  v_row public.property_access_challenges;
  v_duration integer;
begin
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor is null
     or not public.current_actor_has_workspace('property_partner',null) then
    raise exception 'Property Partner workspace required';
  end if;
  select * into v_row
  from public.property_access_challenges
  where id=p_challenge_id and partner_id=v_actor.user_id
  for update;
  if v_row.id is null then raise exception 'Property access challenge not found'; end if;
  if v_row.status='submitted' and v_row.video_path is not null then
    return jsonb_build_object(
      'success',true,'status','submitted','already_submitted',true,
      'video_path',v_row.video_path,
      'duration_seconds',v_row.duration_seconds
    );
  end if;
  if v_row.status='consumed' then
    raise exception 'This property was already submitted';
  end if;
  if v_row.status<>'prepared' then
    raise exception 'Create a new one-use recording code';
  end if;
  if v_row.expires_at<=now() then
    update public.property_access_challenges
    set status='expired' where id=v_row.id;
    raise exception 'The one-use code expired. Create a new code and record again';
  end if;
  if split_part(p_video_path,'/',1)<>v_actor.user_id
     or split_part(p_video_path,'/',2)<>p_challenge_id::text then
    raise exception 'Invalid private property access path';
  end if;
  v_duration:=nullif((regexp_match(
    p_video_path,'-([0-9]+)s[.][a-z0-9]+$'
  ))[1],'')::integer;
  if coalesce(v_duration,0)<20 then
    raise exception 'Record at least 20 seconds of continuous entrance-to-interior access evidence';
  end if;
  if not exists(
    select 1 from storage.objects object
    where object.bucket_id='property-access-private'
      and object.name=p_video_path
  ) then raise exception 'Private property access recording was not found'; end if;
  update public.property_access_challenges
  set video_path=p_video_path,duration_seconds=v_duration,
      status='submitted',submitted_at=now()
  where id=v_row.id;
  return jsonb_build_object(
    'success',true,'status','submitted','already_submitted',false,
    'video_path',p_video_path,'duration_seconds',v_duration
  );
end
$$;

create or replace function public.create_my_property_access_correction(
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','extensions'
as $$
declare
  v_actor public.profiles;
  v_request public.inspection_requests;
  v_challenge public.property_access_challenges;
  v_code text;
begin
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor is null
     or not public.current_actor_has_workspace('property_partner',null) then
    raise exception 'Property Partner workspace required';
  end if;
  select * into v_request
  from public.inspection_requests
  where id=p_request_id and owner_id=v_actor.user_id
  for update;
  if v_request.id is null then raise exception 'Property submission not found'; end if;
  if v_request.published_at is not null or v_request.lifecycle_stage='live' then
    raise exception 'A public property does not require new access evidence';
  end if;
  if v_request.lifecycle_stage='rejected'
     or lower(coalesce(v_request.status,''))='rejected' then
    raise exception 'This submission was stopped. Contact WeHouse from Inbox';
  end if;
  if v_request.access_evidence_status<>'rejected' then
    raise exception 'WeHouse has not requested replacement access evidence';
  end if;
  if coalesce(
    v_request.assigned_field_officer_id,
    v_request.field_officer_id,
    v_request.assigned_to
  ) is not null then
    raise exception 'Access evidence cannot be replaced after Field Operations is assigned';
  end if;
  update public.property_access_challenges set status='expired'
  where partner_id=v_actor.user_id and request_id=p_request_id
    and status='prepared';
  v_code:=lpad(((('x'||substr(
    encode(extensions.gen_random_bytes(4),'hex'),1,8
  ))::bit(32)::bigint%1000000))::text,6,'0');
  insert into public.property_access_challenges(
    partner_id,code,expires_at,request_id
  ) values(
    v_actor.user_id,v_code,now()+interval '24 hours',p_request_id
  ) returning * into v_challenge;
  return jsonb_build_object(
    'id',v_challenge.id,'code',v_challenge.code,
    'expires_at',v_challenge.expires_at
  );
end
$$;

create or replace function public.submit_my_property_access_correction(
  p_request_id uuid,
  p_challenge_id uuid,
  p_video_path text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','storage'
as $$
declare
  v_actor public.profiles;
  v_request public.inspection_requests;
  v_challenge public.property_access_challenges;
  v_previous_path text;
  v_duration integer;
begin
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor is null
     or not public.current_actor_has_workspace('property_partner',null) then
    raise exception 'Property Partner workspace required';
  end if;
  select * into v_request
  from public.inspection_requests
  where id=p_request_id and owner_id=v_actor.user_id
  for update;
  if v_request.id is null then raise exception 'Property submission not found'; end if;
  if v_request.access_evidence_status<>'rejected'
     or v_request.lifecycle_stage<>'changes_requested' then
    raise exception 'Replacement evidence is not currently requested';
  end if;
  select * into v_challenge
  from public.property_access_challenges
  where id=p_challenge_id and partner_id=v_actor.user_id
    and request_id=p_request_id
  for update;
  if v_challenge.id is null or v_challenge.status<>'prepared' then
    raise exception 'This one-use correction code is unavailable';
  end if;
  if v_challenge.expires_at<=now() then
    update public.property_access_challenges
    set status='expired' where id=p_challenge_id;
    raise exception 'The one-use code expired. Create a new code and record again';
  end if;
  if split_part(p_video_path,'/',1)<>v_actor.user_id
     or split_part(p_video_path,'/',2)<>p_challenge_id::text then
    raise exception 'Invalid private property access path';
  end if;
  v_duration:=nullif((regexp_match(
    p_video_path,'-([0-9]+)s[.][a-z0-9]+$'
  ))[1],'')::integer;
  if coalesce(v_duration,0)<20 then
    raise exception 'Record at least 20 seconds of continuous entrance-to-interior access evidence';
  end if;
  if not exists(
    select 1 from storage.objects object
    where object.bucket_id='property-access-private'
      and object.name=p_video_path
  ) then raise exception 'Private property access recording was not found'; end if;
  v_previous_path:=v_request.access_evidence_video_path;
  update public.property_access_challenges
  set video_path=p_video_path,duration_seconds=v_duration,status='consumed',
      submitted_at=now(),consumed_at=now()
  where id=p_challenge_id;
  update public.inspection_requests
  set access_evidence_video_path=p_video_path,
      access_evidence_duration_seconds=v_duration,
      access_evidence_status='submitted',updated_at=now()
  where id=p_request_id;
  if v_previous_path is not null and v_previous_path<>p_video_path then
    delete from storage.objects
    where bucket_id='property-access-private' and name=v_previous_path;
  end if;
  return jsonb_build_object(
    'success',true,'status','submitted','duration_seconds',v_duration
  );
end
$$;

create or replace function public.refresh_my_property_access_challenge(
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_code text;
  v_expires_at timestamptz:=now()+interval '7 days';
begin
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor is null
     or not public.current_actor_has_workspace('property_partner',null) then
    raise exception 'Property Partner workspace required';
  end if;
  v_code:=upper(substring(replace(gen_random_uuid()::text,'-','') from 1 for 6));
  update public.inspection_requests
  set access_challenge_code=v_code,access_challenge_expires_at=v_expires_at,
      access_evidence_status='required',updated_at=now()
  where id=p_request_id and owner_id=v_actor.user_id and published_at is null;
  if not found then raise exception 'Property request not found'; end if;
  return jsonb_build_object('code',v_code,'expires_at',v_expires_at);
end
$$;

create or replace function public.create_my_property_inspection_batch_v4(
  p_batch_id uuid,
  p_items jsonb
)
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
  if v_actor is null
     or not public.current_actor_has_workspace('property_partner',null) then
    raise exception 'Property Partner workspace required';
  end if;
  if not public.account_identity_is_current(v_actor) then
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
  for v_created in
    select value from jsonb_array_elements(v_result->'requests')
  loop
    v_position:=(v_created->>'position')::integer;
    v_request_id:=(v_created->>'id')::uuid;
    v_item:=p_items->(v_position-1);
    v_max_guests:=nullif(v_item->>'max_guests','')::integer;
    v_display_name:=nullif(
      btrim(coalesce(v_item->>'property_display_name','')),''
    );
    if v_item->>'property_type'='apartment'
       and v_item->>'sub_type'='short_let'
       and coalesce(v_max_guests,0)<1 then
      raise exception 'Property %: Short Let guest capacity must be at least 1',
        v_position;
    end if;
    if v_item->>'property_type'='apartment'
       and v_item->>'sub_type'='short_let'
       and v_display_name is null then
      raise exception 'Property %: Short Let property or host name is required',
        v_position;
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
end
$$;

-- v4 is the only client submission command. Earlier wrappers remain as
-- implementation dependencies until the consolidated schema removes them.
revoke all on function public.create_my_property_inspection_batch(jsonb)
from public,anon,authenticated;
revoke all on function public.create_my_property_inspection_batch_v2(jsonb)
from public,anon,authenticated;
revoke all on function public.create_my_property_inspection_batch_v3(jsonb)
from public,anon,authenticated;
grant execute on function public.create_my_property_inspection_batch(jsonb)
to service_role;
grant execute on function public.create_my_property_inspection_batch_v2(jsonb)
to service_role;
grant execute on function public.create_my_property_inspection_batch_v3(jsonb)
to service_role;

revoke all on function public.sync_marketplace_role_projection()
from public,anon,authenticated;
grant execute on function public.sync_marketplace_role_projection()
to service_role;

revoke all on function public.get_or_create_my_property_partner()
from public,anon;
revoke all on function public.create_my_property_access_challenge()
from public,anon;
revoke all on function public.validate_my_property_access_challenge(uuid)
from public,anon;
revoke all on function public.submit_my_property_access_challenge(uuid,text)
from public,anon;
revoke all on function public.create_my_property_access_correction(uuid)
from public,anon;
revoke all on function public.submit_my_property_access_correction(uuid,uuid,text)
from public,anon;
revoke all on function public.refresh_my_property_access_challenge(uuid)
from public,anon;
revoke all on function public.create_my_property_inspection_batch_v4(uuid,jsonb)
from public,anon;

grant execute on function public.get_or_create_my_property_partner()
to authenticated,service_role;
grant execute on function public.create_my_property_access_challenge()
to authenticated,service_role;
grant execute on function public.validate_my_property_access_challenge(uuid)
to authenticated,service_role;
grant execute on function public.submit_my_property_access_challenge(uuid,text)
to authenticated,service_role;
grant execute on function public.create_my_property_access_correction(uuid)
to authenticated,service_role;
grant execute on function public.submit_my_property_access_correction(uuid,uuid,text)
to authenticated,service_role;
grant execute on function public.refresh_my_property_access_challenge(uuid)
to authenticated,service_role;
grant execute on function public.create_my_property_inspection_batch_v4(uuid,jsonb)
to authenticated,service_role;

insert into public.function_execution_registry(
  function_signature,function_name,security_mode,public_allowed,anon_allowed,
  authenticated_allowed,service_role_allowed,review_state,rationale,captured_at
)
select
  procedure.oid::regprocedure::text,procedure.proname,
  case when procedure.prosecdef then 'definer' else 'invoker' end,
  has_function_privilege('public',procedure.oid,'execute'),
  has_function_privilege('anon',procedure.oid,'execute'),
  has_function_privilege('authenticated',procedure.oid,'execute'),
  has_function_privilege('service_role',procedure.oid,'execute'),
  case when procedure.proname in (
    'sync_marketplace_role_projection',
    'create_my_property_inspection_batch',
    'create_my_property_inspection_batch_v2',
    'create_my_property_inspection_batch_v3'
  ) then 'approved_service_only' else 'approved_client_rpc' end,
  case when procedure.proname='sync_marketplace_role_projection'
    then 'Internal compatibility projection; workspace assignment remains authoritative'
    when procedure.proname in (
      'create_my_property_inspection_batch',
      'create_my_property_inspection_batch_v2',
      'create_my_property_inspection_batch_v3'
    ) then 'Internal legacy submission dependency reachable through workspace-guarded v4 only'
    else 'Actor-bound Property Partner submission or access-evidence action'
  end,
  now()
from pg_proc procedure
join pg_namespace namespace on namespace.oid=procedure.pronamespace
where namespace.nspname='public' and procedure.proname in(
  'sync_marketplace_role_projection','get_or_create_my_property_partner',
  'create_my_property_access_challenge',
  'validate_my_property_access_challenge',
  'submit_my_property_access_challenge',
  'create_my_property_access_correction',
  'submit_my_property_access_correction',
  'refresh_my_property_access_challenge',
  'create_my_property_inspection_batch',
  'create_my_property_inspection_batch_v2',
  'create_my_property_inspection_batch_v3',
  'create_my_property_inspection_batch_v4'
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

comment on function public.sync_marketplace_role_projection() is
  'Maintains profiles.role only as a one-profession compatibility projection; Personal access and authorization use workspace grants.';
