-- WeHouse Team membership is Creator-only. Admins may assign one Operation only
-- to an existing Staff member in the same exact branch (State + LGA).
-- Workspace grants, not client-provided roles, are the authorization authority.

update public.workspace_role_assignments operation
set scope_type='branch',
    scope_state=coalesce(nullif(operation.scope_state,''),profile.assigned_state),
    scope_lga=profile.assigned_lga,
    updated_at=now()
from public.profiles profile
where operation.user_id=profile.user_id
  and operation.status='active'
  and operation.revoked_at is null
  and operation.workspace_role in(
    'property_operations','field_operations','worker_operations',
    'finance_operations','security_operations','support'
  )
  and nullif(btrim(profile.assigned_state),'') is not null
  and nullif(btrim(profile.assigned_lga),'') is not null
  and (
    operation.scope_type<>'branch'
    or public.wehouse_state_key(operation.scope_state)
       is distinct from public.wehouse_state_key(profile.assigned_state)
    or lower(btrim(coalesce(operation.scope_lga,'')))
       is distinct from lower(btrim(profile.assigned_lga))
  );

update public.platform_settings
set is_active=false,
    editable=false,
    description='Retired: Admins cannot create WeHouse Team members. Creator grants Team membership with recent authentication.',
    updated_at=now()
where key='admin_staff_limit';

create or replace function public._assert_admin_lga_scope(p_target_user_id text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_target public.profiles;
  v_target_state text;
  v_target_lga text;
begin
  select * into v_actor
  from public.profiles p
  where p.auth_id=(select auth.uid())::text
    and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
  limit 1;

  if v_actor.user_id is null then raise exception 'Admin access required'; end if;
  if public.current_actor_has_workspace('creator',null) then return; end if;
  if not public.current_actor_has_workspace('admin',null) then
    raise exception 'Admin access required';
  end if;

  select * into v_target
  from public.profiles
  where user_id=p_target_user_id
    and not coalesce(deleted,false)
  limit 1;
  if v_target.user_id is null then raise exception 'Target user not found'; end if;

  v_target_state:=case
    when public.user_has_active_workspace(v_target.user_id,'staff')
      or public.user_has_active_workspace(v_target.user_id,'admin')
      then nullif(btrim(v_target.assigned_state),'')
    else nullif(btrim(v_target.state),'')
  end;
  v_target_lga:=case
    when public.user_has_active_workspace(v_target.user_id,'staff')
      or public.user_has_active_workspace(v_target.user_id,'admin')
      then nullif(btrim(v_target.assigned_lga),'')
    else coalesce(nullif(btrim(v_target.local_government),''),nullif(btrim(v_target.city),''))
  end;

  if v_target_state is null or v_target_lga is null then
    raise exception 'Target account does not have a complete branch';
  end if;

  if not exists(
    select 1
    from public.workspace_role_assignments grant_row
    where grant_row.user_id=v_actor.user_id
      and grant_row.workspace_role='admin'
      and grant_row.status='active'
      and grant_row.revoked_at is null
      and grant_row.scope_type='branch'
      and public.wehouse_state_key(grant_row.scope_state)=public.wehouse_state_key(v_target_state)
      and lower(btrim(grant_row.scope_lga))=lower(btrim(v_target_lga))
  ) then
    raise exception 'Admin scope violation: target is outside the assigned branch';
  end if;
end
$$;

create or replace function public.current_staff_has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  with actor as (
    select p.*
    from public.profiles p
    where p.auth_id=(select auth.uid())::text
      and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false)
      and not coalesce(p.banned,false)
    limit 1
  ),
  requested as (
    select public.canonical_staff_domain(p_permission) domain
  )
  select
    exists(
      select 1
      from actor a, requested r
      where r.domain is not null
        and public.user_has_active_workspace(a.user_id,'staff')
        and nullif(btrim(a.assigned_state),'') is not null
        and nullif(btrim(a.assigned_lga),'') is not null
        and exists(
          select 1
          from public.workspace_role_assignments staff_grant
          where staff_grant.user_id=a.user_id
            and staff_grant.workspace_role='staff'
            and staff_grant.status='active'
            and staff_grant.revoked_at is null
            and staff_grant.scope_type='branch'
            and public.wehouse_state_key(staff_grant.scope_state)=public.wehouse_state_key(a.assigned_state)
            and lower(btrim(staff_grant.scope_lga))=lower(btrim(a.assigned_lga))
        )
        and exists(
          select 1
          from public.workspace_role_assignments operation_grant
          where operation_grant.user_id=a.user_id
            and operation_grant.workspace_role=r.domain
            and operation_grant.status='active'
            and operation_grant.revoked_at is null
            and operation_grant.scope_type='branch'
            and public.wehouse_state_key(operation_grant.scope_state)=public.wehouse_state_key(a.assigned_state)
            and lower(btrim(operation_grant.scope_lga))=lower(btrim(a.assigned_lga))
        )
        and exists(
          select 1
          from public.staff_permissions permission_row
          where permission_row.staff_id=a.user_id
            and permission_row.permission=r.domain
            and permission_row.is_active
            and permission_row.revoked_at is null
        )
    )
    or exists(
      select 1 from actor a
      where public.user_has_active_workspace(a.user_id,'admin')
         or public.user_has_active_workspace(a.user_id,'creator')
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
  v_actor_is_creator boolean:=false;
  v_actor_is_admin boolean:=false;
begin
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null then raise exception 'Not authorised'; end if;

  v_actor_is_creator:=public.current_actor_has_workspace('creator',null);
  v_actor_is_admin:=public.current_actor_has_workspace('admin',null);
  if not v_actor_is_creator and not v_actor_is_admin then
    raise exception 'Not authorised';
  end if;

  select * into v_target
  from public.profiles
  where user_id=p_staff_id
    and public.user_has_active_workspace(user_id,'staff')
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  for update;
  if v_target.user_id is null then raise exception 'Active Staff workspace not found'; end if;
  if v_target.user_id=v_actor.user_id then raise exception 'Cannot change your own Operation assignment'; end if;
  if v_domain is null then raise exception 'Invalid Staff work area'; end if;
  if nullif(btrim(v_target.assigned_state),'') is null
     or nullif(btrim(v_target.assigned_lga),'') is null then
    raise exception 'Staff branch assignment is incomplete';
  end if;

  if v_actor_is_creator then
    if not public.creator_has_elevation(p_creator_elevation_id,'staff_authority') then
      raise exception 'Recent Creator authentication required';
    end if;
  else
    if not exists(
      select 1
      from public.workspace_role_assignments grant_row
      where grant_row.user_id=v_actor.user_id
        and grant_row.workspace_role='admin'
        and grant_row.status='active'
        and grant_row.revoked_at is null
        and grant_row.scope_type='branch'
        and public.wehouse_state_key(grant_row.scope_state)=public.wehouse_state_key(v_target.assigned_state)
        and lower(btrim(grant_row.scope_lga))=lower(btrim(v_target.assigned_lga))
    ) then
      raise exception 'Admin can manage only Staff in the assigned branch';
    end if;
  end if;

  if p_enabled then
    update public.staff_permissions
    set is_active=false,revoked_at=now()
    where staff_id=p_staff_id and is_active and permission<>v_domain;

    update public.workspace_role_assignments
    set status='revoked',revoked_by=v_actor.user_id,revoked_at=now(),updated_at=now()
    where user_id=p_staff_id and status='active' and revoked_at is null
      and workspace_role in(
        'property_operations','field_operations','worker_operations',
        'finance_operations','security_operations','support'
      )
      and workspace_role<>v_domain;
  end if;

  insert into public.staff_permissions(
    staff_id,permission,granted_by,granted_at,revoked_at,is_active
  ) values(
    p_staff_id,v_domain,v_actor.user_id,
    case when p_enabled then now() else null end,
    case when p_enabled then null else now() end,p_enabled
  )
  on conflict(staff_id,permission) do update set
    granted_by=excluded.granted_by,
    granted_at=case when excluded.is_active then now()
      else public.staff_permissions.granted_at end,
    revoked_at=case when excluded.is_active then null else now() end,
    is_active=excluded.is_active;

  if p_enabled then
    insert into public.workspace_role_assignments(
      user_id,workspace_role,scope_type,scope_state,scope_lga,status,
      granted_by,granted_at,created_at,updated_at
    ) values(
      p_staff_id,v_domain,'branch',v_target.assigned_state,v_target.assigned_lga,
      'active',v_actor.user_id,now(),now(),now()
    )
    on conflict(user_id,workspace_role) where status='active' do update set
      scope_type='branch',
      scope_state=excluded.scope_state,
      scope_lga=excluded.scope_lga,
      granted_by=excluded.granted_by,
      granted_at=now(),
      updated_at=now();
  else
    update public.workspace_role_assignments
    set status='revoked',revoked_by=v_actor.user_id,revoked_at=now(),updated_at=now()
    where user_id=p_staff_id
      and workspace_role=v_domain
      and status='active'
      and revoked_at is null;
  end if;

  insert into public.admin_audit_log(
    admin_id,action,target_type,target_id,details,created_at
  ) values(
    v_actor.user_id,'staff_work_area_changed','profiles',p_staff_id,
    jsonb_build_object(
      'work_area',v_domain,
      'enabled',p_enabled,
      'actor_workspace',case when v_actor_is_creator then 'creator' else 'admin' end,
      'scope_type','branch',
      'state',v_target.assigned_state,
      'lga',v_target.assigned_lga
    )::text,now()
  );
end
$$;

create or replace function public.manage_staff_permission(
  p_staff_id text,
  p_permission text,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  if public.current_actor_has_workspace('creator',null) then
    raise exception 'Recent Creator authentication required';
  end if;
  perform public.manage_staff_permission(
    p_staff_id,p_permission,p_enabled,null::uuid
  );
end
$$;

create or replace function public.admin_appoint_staff(
  p_target_user_id text,
  p_module text
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_target public.profiles;
  v_domain text:=public.canonical_staff_domain(p_module);
begin
  if v_domain is null then raise exception 'A valid Staff Operation is required'; end if;
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null or not public.current_actor_has_workspace('admin',null) then
    raise exception 'Active Admin workspace required';
  end if;

  select * into v_target
  from public.profiles
  where user_id=p_target_user_id
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  for update;
  if v_target.user_id is null then raise exception 'Target account not found'; end if;
  if v_target.user_id=v_actor.user_id then raise exception 'Cannot appoint yourself'; end if;
  if not public.user_has_active_workspace(v_target.user_id,'staff') then
    raise exception 'Creator must add this person to the WeHouse Team first';
  end if;
  if nullif(btrim(v_target.assigned_state),'') is null
     or nullif(btrim(v_target.assigned_lga),'') is null then
    raise exception 'Staff branch assignment is incomplete';
  end if;
  if not exists(
    select 1
    from public.workspace_role_assignments grant_row
    where grant_row.user_id=v_actor.user_id
      and grant_row.workspace_role='admin'
      and grant_row.status='active'
      and grant_row.revoked_at is null
      and grant_row.scope_type='branch'
      and public.wehouse_state_key(grant_row.scope_state)=public.wehouse_state_key(v_target.assigned_state)
      and lower(btrim(grant_row.scope_lga))=lower(btrim(v_target.assigned_lga))
  ) then
    raise exception 'Admin can manage only Staff in the assigned branch';
  end if;

  perform public.manage_staff_permission(p_target_user_id,v_domain,true);
  return true;
end
$$;

create or replace function public.admin_update_role(
  p_target_user_id text,
  p_new_role text
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  raise exception 'WeHouse Team membership is managed by Creator';
end
$$;

create or replace function public.creator_set_team_role(
  p_target_user_id text,
  p_new_role text,
  p_state text,
  p_lga text,
  p_module text,
  p_creator_elevation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_target public.profiles;
  v_state text:=nullif(btrim(coalesce(p_state,'')),'');
  v_lga text:=nullif(btrim(coalesce(p_lga,'')),'');
  v_domain text:=public.canonical_staff_domain(p_module);
begin
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null
     or not public.current_actor_has_workspace('creator',null) then
    raise exception 'Creator authority required';
  end if;
  if not public.creator_has_elevation(p_creator_elevation_id,'staff_authority') then
    raise exception 'Recent Creator authentication required';
  end if;

  select * into v_target
  from public.profiles
  where user_id=p_target_user_id
  for update;
  if v_target.user_id is null then raise exception 'Target account not found'; end if;
  if v_target.user_id=v_actor.user_id
     or public.user_has_active_workspace(v_target.user_id,'creator') then
    raise exception 'Creator authority cannot be modified here';
  end if;
  if p_new_role not in('admin','staff','user') then
    raise exception 'Invalid team role';
  end if;
  if p_new_role in('admin','staff') and (v_state is null or v_lga is null) then
    raise exception 'State and LGA are required';
  end if;
  if p_new_role='staff' and v_domain is null then
    raise exception 'A valid Staff Operation is required';
  end if;

  update public.workspace_role_assignments
  set status='revoked',revoked_by=v_actor.user_id,revoked_at=now(),updated_at=now()
  where user_id=p_target_user_id
    and status='active'
    and revoked_at is null
    and workspace_role in(
      'staff','admin','property_operations','field_operations',
      'worker_operations','finance_operations','security_operations','support'
    );

  update public.staff_permissions
  set is_active=false,revoked_at=now()
  where staff_id=p_target_user_id and is_active;

  if p_new_role='user' then
    update public.profiles
    set role='user',assigned_state=null,assigned_lga=null,
        scope=null,updated_by=v_actor.user_id,updated_at=now()
    where user_id=p_target_user_id;
  else
    update public.profiles
    set role=p_new_role,assigned_state=v_state,assigned_lga=v_lga,
        scope='local',updated_by=v_actor.user_id,updated_at=now()
    where user_id=p_target_user_id;

    insert into public.workspace_role_assignments(
      user_id,workspace_role,scope_type,scope_state,scope_lga,status,
      granted_by,granted_at,created_at,updated_at
    ) values(
      p_target_user_id,p_new_role,'branch',v_state,v_lga,'active',
      v_actor.user_id,now(),now(),now()
    )
    on conflict(user_id,workspace_role) where status='active' do update set
      scope_type='branch',
      scope_state=excluded.scope_state,
      scope_lga=excluded.scope_lga,
      granted_by=excluded.granted_by,
      granted_at=now(),
      updated_at=now();

    if p_new_role='staff' then
      perform public.manage_staff_permission(
        p_target_user_id,v_domain,true,p_creator_elevation_id
      );
    end if;
  end if;

  insert into public.audit_logs(
    action,target_type,target_id,details,admin_id,admin_email
  ) values(
    'ROLE_CHANGE','profiles',p_target_user_id,
    jsonb_build_object(
      'old_role',v_target.role,
      'new_role',p_new_role,
      'assigned_state',v_state,
      'assigned_lga',v_lga,
      'staff_operation',case when p_new_role='staff' then v_domain else null end,
      'authority_model','creator_step_up_branch_grant'
    )::text,
    v_actor.user_id,v_actor.email
  );
  return true;
end
$$;

create or replace function public.creator_set_team_role(
  p_target_user_id text,
  p_new_role text,
  p_state text default null,
  p_lga text default null,
  p_module text default null
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  raise exception 'Recent Creator authentication required';
end
$$;

create or replace function public.activate_my_worker_workspace()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_profile public.profiles;
begin
  select * into v_profile
  from public.profiles
  where auth_id=(select auth.uid())::text
    and account_kind='consumer'
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  for update;

  if v_profile.user_id is null then
    raise exception 'Active Personal account required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('service-worker:'||v_profile.user_id,1));

  insert into public.workspace_role_assignments(
    user_id,workspace_role,scope_type,status,granted_at,created_at,updated_at
  ) values(
    v_profile.user_id,'worker','global','active',now(),now(),now()
  )
  on conflict(user_id,workspace_role) where status='active'
  do update set updated_at=public.workspace_role_assignments.updated_at;

  update public.profiles
  set worker_status=coalesce(worker_status,'pending'),
      account_kind='consumer',
      updated_at=now()
  where user_id=v_profile.user_id;

  return jsonb_build_object(
    'success',true,
    'workspace','worker',
    'product_label','Service Worker',
    'state','onboarding',
    'free',true
  );
end
$$;
