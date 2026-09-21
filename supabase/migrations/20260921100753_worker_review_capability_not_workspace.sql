begin;

create or replace function public.canonical_staff_domain(p_permission text)
returns text
language sql
immutable
set search_path to 'pg_catalog','public'
as $$
  select case lower(btrim(coalesce(p_permission,'')))
    when 'operations' then 'property_operations'
    when 'property_operations' then 'property_operations'
    when 'field_officer' then 'field_operations'
    when 'field_operation' then 'field_operations'
    when 'filed_officer' then 'field_operations'
    when 'filed_operation' then 'field_operations'
    when 'field_operations' then 'field_operations'
    when 'verification' then 'worker_review'
    when 'worker_verification' then 'worker_review'
    when 'worker_operations' then 'worker_review'
    when 'worker_review' then 'worker_review'
    when 'finance' then 'finance_operations'
    when 'finance_operations' then 'finance_operations'
    when 'security' then 'security_operations'
    when 'security_operations' then 'security_operations'
    when 'support' then 'support'
    else null
  end
$$;

create or replace function public.canonical_operational_domain(p_channel text)
returns text
language sql
immutable
set search_path to 'pg_catalog','public'
as $$
  select case lower(btrim(coalesce(p_channel,'')))
    when 'operations' then 'property_operations'
    when 'reservation_operations' then 'property_operations'
    when 'property_operations' then 'property_operations'
    when 'field_operations' then 'field_operations'
    when 'worker_operations' then 'worker_review'
    when 'worker_review' then 'worker_review'
    when 'finance_operations' then 'finance_operations'
    when 'security_operations' then 'security_operations'
    when 'support_case' then 'support'
    when 'support' then 'support'
    else null
  end
$$;

insert into public.staff_permissions(
  staff_id,permission,granted_by,granted_at,revoked_at,is_active
)
select
  legacy.staff_id,'worker_review',legacy.granted_by,
  coalesce(legacy.granted_at,now()),null,true
from public.staff_permissions legacy
where legacy.is_active
  and legacy.revoked_at is null
  and lower(btrim(legacy.permission)) in(
    'verification','worker_verification','worker_operations'
  )
on conflict(staff_id,permission) do update set
  granted_by=excluded.granted_by,
  granted_at=coalesce(staff_permissions.granted_at,excluded.granted_at),
  revoked_at=null,
  is_active=true;

update public.staff_permissions
set is_active=false,revoked_at=coalesce(revoked_at,now())
where lower(btrim(permission)) in(
  'verification','worker_verification','worker_operations'
) and is_active;

update public.workspace_role_assignments
set status='revoked',revoked_at=coalesce(revoked_at,now()),updated_at=now()
where workspace_role='worker_operations' and status='active';

create or replace function public.current_staff_has_permission(p_permission text)
returns boolean
language sql
stable security definer
set search_path to 'pg_catalog','public'
as $$
  with actor as (
    select p.* from public.profiles p
    where p.auth_id=(select auth.uid())::text
      and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false)
      and not coalesce(p.banned,false)
    limit 1
  ), requested as (
    select public.canonical_staff_domain(p_permission) domain
  )
  select exists(
    select 1
    from actor a, requested r
    where a.role='staff'
      and public.current_actor_has_workspace('staff',null)
      and r.domain is not null
      and nullif(btrim(coalesce(a.assigned_state,'')),'') is not null
      and nullif(btrim(coalesce(a.assigned_lga,'')),'') is not null
      and exists(
        select 1
        from public.staff_permissions permission_row
        where permission_row.staff_id=a.user_id
          and permission_row.is_active
          and permission_row.revoked_at is null
          and public.canonical_staff_domain(permission_row.permission)=r.domain
      )
  ) or exists(
    select 1 from actor a
    where (a.role='admin' and public.current_actor_has_workspace('admin',null))
       or (a.role='creator' and public.current_actor_has_workspace('creator',null))
  )
$$;

create or replace function public.manage_staff_permission(
  p_staff_id text,
  p_permission text,
  p_enabled boolean,
  p_creator_elevation_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_target public.profiles;
  v_domain text:=public.canonical_staff_domain(p_permission);
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;

  select * into v_target from public.profiles
  where user_id=p_staff_id and public.user_has_active_workspace(user_id,'staff')
  for update;

  if public.current_actor_has_workspace('creator',null) then
    v_actor.role:='creator';
  elsif public.current_actor_has_workspace('admin',null) then
    v_actor.role:='admin';
  else
    raise exception 'Not authorised';
  end if;

  if v_target.user_id is null then raise exception 'Staff profile not found'; end if;
  if v_domain is null then raise exception 'Invalid Staff work area'; end if;
  if v_actor.role='creator'
     and not public.creator_has_elevation(p_creator_elevation_id,'staff_authority') then
    raise exception 'Recent Creator authentication required';
  end if;
  if v_actor.role='admin'
     and not public.current_actor_in_scope(v_target.assigned_state,v_target.assigned_lga) then
    raise exception 'Admin can manage only Staff in the assigned branch';
  end if;

  if p_enabled then
    update public.staff_permissions
    set is_active=false,revoked_at=now()
    where staff_id=p_staff_id and is_active
      and public.canonical_staff_domain(permission) is distinct from v_domain;

    update public.workspace_role_assignments
    set status='revoked',revoked_by=v_actor.user_id,revoked_at=now(),updated_at=now()
    where user_id=p_staff_id and status='active'
      and workspace_role in(
        'property_operations','field_operations','worker_operations',
        'finance_operations','security_operations','support'
      )
      and (
        v_domain='worker_review'
        or workspace_role<>v_domain
      );
  end if;

  insert into public.staff_permissions(
    staff_id,permission,granted_by,granted_at,revoked_at,is_active
  ) values(
    p_staff_id,v_domain,v_actor.user_id,
    case when p_enabled then now() else null end,
    case when p_enabled then null else now() end,p_enabled
  ) on conflict(staff_id,permission) do update set
    granted_by=excluded.granted_by,
    granted_at=case when excluded.is_active then now()
      else staff_permissions.granted_at end,
    revoked_at=case when excluded.is_active then null else now() end,
    is_active=excluded.is_active;

  if p_enabled and v_domain<>'worker_review' then
    insert into public.workspace_role_assignments(
      user_id,workspace_role,scope_type,scope_state,scope_lga,status,
      granted_by,granted_at,created_at,updated_at
    ) values(
      p_staff_id,v_domain,'state',v_target.assigned_state,v_target.assigned_lga,
      'active',v_actor.user_id,now(),now(),now()
    ) on conflict(user_id,workspace_role) where status='active' do update set
      scope_type='state',scope_state=excluded.scope_state,
      scope_lga=excluded.scope_lga,granted_by=excluded.granted_by,
      granted_at=now(),updated_at=now();
  elsif not p_enabled and v_domain<>'worker_review' then
    update public.workspace_role_assignments
    set status='revoked',revoked_by=v_actor.user_id,revoked_at=now(),updated_at=now()
    where user_id=p_staff_id and workspace_role=v_domain and status='active';
  end if;

  insert into public.admin_audit_log(
    admin_id,action,target_type,target_id,details,created_at
  ) values(
    v_actor.user_id,'staff_work_area_changed','profiles',p_staff_id,
    jsonb_build_object(
      'work_area',v_domain,'enabled',p_enabled,
      'actor_role',v_actor.role,'state',v_target.assigned_state,
      'lga',v_target.assigned_lga,
      'authority_model',case when v_domain='worker_review'
        then 'staff_capability' else 'operational_workspace' end
    )::text,now()
  );
end
$$;

create or replace function public.current_staff_can_review_worker(p_worker_id text)
returns boolean
language sql
stable security definer
set search_path to 'pg_catalog','public'
as $$
  select public.current_actor_has_workspace('staff',null)
    and public.current_staff_has_permission('worker_review')
    and public.user_has_active_workspace(p_worker_id,'worker')
    and exists(
      select 1 from public.profiles p
      where p.user_id=p_worker_id
        and public.current_actor_in_scope(
          p.state,coalesce(nullif(p.local_government,''),p.city)
        )
    )
$$;

create or replace function public.get_my_staff_worker_reviews(
  p_status text default 'pending'::text
)
returns setof public.profiles
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor public.profiles;
begin
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
  limit 1;

  if v_actor.user_id is null
     or coalesce(v_actor.deleted,false)
     or coalesce(v_actor.suspended,false)
     or coalesce(v_actor.banned,false) then
    raise exception 'Active WeHouse Team account required';
  end if;

  if v_actor.role='staff'
     and not public.current_staff_has_permission('worker_review') then
    raise exception 'Worker Review capability required';
  end if;

  if v_actor.role not in('staff','admin','creator') then
    raise exception 'WeHouse Team access required';
  end if;

  return query
  select worker.*
  from public.profiles worker
  where public.user_has_active_workspace(worker.user_id,'worker')
    and not coalesce(worker.deleted,false)
    and not coalesce(worker.suspended,false)
    and not coalesce(worker.banned,false)
    and (p_status is null or p_status='all' or worker.worker_status=p_status)
    and (
      v_actor.role='creator'
      or public.current_actor_in_scope(
        worker.state,coalesce(nullif(worker.local_government,''),worker.city)
      )
    )
  order by worker.created_at desc;
end
$$;

create or replace function public.review_my_staff_worker_v2(
  p_worker_id text,
  p_status text,
  p_reason text default null,
  p_notes text default null
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_worker public.profiles;
  v_ver public.worker_verifications;
begin
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
  limit 1;

  if v_actor.user_id is null
     or v_actor.role<>'staff'
     or not public.current_actor_has_workspace('staff',null)
     or coalesce(v_actor.deleted,false)
     or coalesce(v_actor.suspended,false)
     or coalesce(v_actor.banned,false) then
    raise exception 'Active WeHouse Team account required';
  end if;

  if not public.current_staff_has_permission('worker_review') then
    raise exception 'Worker Review capability required';
  end if;
  if p_status not in ('verified','rejected') then
    raise exception 'Invalid review outcome';
  end if;
  if p_status='rejected'
     and nullif(btrim(coalesce(p_reason,'')),'') is null then
    raise exception 'Rejection reason is required';
  end if;

  select * into v_worker
  from public.profiles
  where user_id=p_worker_id
    and public.user_has_active_workspace(user_id,'worker')
  for update;
  if v_worker.user_id is null then raise exception 'Worker not found'; end if;

  if not public.current_actor_in_scope(
    v_worker.state,coalesce(nullif(v_worker.local_government,''),v_worker.city)
  ) then
    raise exception 'Worker is outside your assigned branch';
  end if;

  select * into v_ver
  from public.worker_verifications
  where worker_id=p_worker_id
  order by created_at desc
  limit 1;

  if p_status='verified' then
    if v_worker.worker_status<>'profile_under_review' then
      raise exception 'Worker is not in the review queue';
    end if;
    if not public.worker_identity_is_current(p_worker_id) then
      raise exception 'The required private identity check has not passed';
    end if;
    if v_ver.id is null
       or nullif(btrim(coalesce(v_ver.verification_video_url,'')),'') is null then
      raise exception 'Professional work evidence is incomplete';
    end if;
  end if;

  update public.profiles
  set worker_status=p_status,
      worker_verified=(p_status='verified'),
      available=(p_status='verified'),
      updated_at=now(),updated_by=v_actor.user_id
  where user_id=p_worker_id;

  update public.worker_verifications
  set status=p_status,reviewed_by=v_actor.user_id,
      review_notes=coalesce(nullif(btrim(p_notes),''),nullif(btrim(p_reason),'')),
      reviewed_at=now(),updated_at=now()
  where id=v_ver.id;

  insert into public.worker_verification_reviews(
    worker_id,reviewer_id,reviewer_role,action,rejection_reason,notes,created_at
  ) values(
    p_worker_id,v_actor.user_id,'staff',p_status,
    case when p_status='rejected' then btrim(p_reason) else null end,
    nullif(btrim(coalesce(p_notes,'')),''),now()
  );
  return true;
end
$$;

create or replace function public.admin_get_worker_review_trust_status(
  p_worker_id text
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_worker public.profiles;
begin
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;

  if v_actor.user_id is null
     or not (
       public.current_actor_has_workspace('staff',null)
       or public.current_actor_has_workspace('admin',null)
       or public.current_actor_has_workspace('creator',null)
     ) then
    raise exception 'WeHouse Team review access required';
  end if;

  if public.current_actor_has_workspace('staff',null)
     and not public.current_staff_has_permission('worker_review') then
    raise exception 'Worker Review capability required';
  end if;

  select * into v_worker
  from public.profiles
  where user_id=p_worker_id
    and public.user_has_active_workspace(user_id,'worker');

  if v_worker.user_id is null then
    raise exception 'Worker not found';
  end if;

  if not public.current_actor_has_workspace('creator',null)
     and not public.current_actor_in_scope(
       v_worker.state,coalesce(nullif(v_worker.local_government,''),v_worker.city)
     ) then
    raise exception 'Worker is outside your assigned scope';
  end if;

  return public._worker_review_trust_payload(p_worker_id);
end
$$;

create or replace function public.current_actor_can_review_account_identity(
  p_user_id text
)
returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog','public'
as $$
declare
  actor public.profiles;
  target public.profiles;
  pending_role text;
begin
  select * into actor
  from public.profiles p
  where p.auth_id=(select auth.uid())::text
    and p.deleted_at is null
    and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
  limit 1;

  select * into target
  from public.profiles p
  where p.user_id=p_user_id
    and p.deleted_at is null
    and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
  limit 1;

  if actor.user_id is null
     or target.user_id is null
     or actor.user_id=target.user_id then
    return false;
  end if;

  select check_row.account_role into pending_role
  from public.worker_identity_checks check_row
  where check_row.worker_id=p_user_id
    and check_row.status='pending_review'
  limit 1;

  if pending_role not in('worker','property_partner') then return false; end if;
  if pending_role='worker'
     and not public.user_has_active_workspace(target.user_id,'worker') then
    return false;
  end if;
  if pending_role='property_partner'
     and not public.user_has_active_workspace(target.user_id,'property_partner') then
    return false;
  end if;

  if public.current_actor_has_workspace('creator',null) then return true; end if;

  if public.current_actor_has_workspace('admin',null) then
    return public.current_actor_in_scope(
      target.state,coalesce(nullif(target.local_government,''),target.city)
    );
  end if;

  if not public.current_actor_has_workspace('staff',null) then return false; end if;
  if not public.current_actor_in_scope(
    target.state,coalesce(nullif(target.local_government,''),target.city)
  ) then return false; end if;

  if pending_role='worker' then
    return public.current_staff_has_permission('worker_review');
  end if;
  return public.current_staff_has_permission('property_operations');
end
$$;

create or replace function public.get_my_managed_team()
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog','public'
as $$
declare
  is_creator boolean:=public.current_actor_has_workspace('creator',null);
  result jsonb;
begin
  if not is_creator and not public.current_actor_has_workspace('admin',null) then
    raise exception 'Active team management access required';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id',p.user_id,
    'full_name',p.full_name,
    'username',p.username,
    'email',p.email,
    'avatar_url',p.avatar_url,
    'role',case when public.user_has_active_workspace(p.user_id,'admin')
      then 'admin' else 'staff' end,
    'assigned_state',p.assigned_state,
    'assigned_lga',p.assigned_lga,
    'work_areas',coalesce((
      select jsonb_agg(domain order by domain)
      from (
        select distinct public.canonical_staff_domain(permission_row.permission) domain
        from public.staff_permissions permission_row
        where permission_row.staff_id=p.user_id
          and permission_row.is_active
          and permission_row.revoked_at is null
          and public.canonical_staff_domain(permission_row.permission) is not null
      ) domains
    ),'[]'::jsonb)
  ) order by coalesce(p.full_name,p.username,p.user_id)),'[]'::jsonb)
  into result
  from public.profiles p
  where (
      public.user_has_active_workspace(p.user_id,'staff')
      or (is_creator and public.user_has_active_workspace(p.user_id,'admin'))
    )
    and (is_creator or public.current_actor_in_scope(p.assigned_state,p.assigned_lga));

  return result;
end
$$;

commit;
