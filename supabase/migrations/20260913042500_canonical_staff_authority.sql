-- Canonical staff work-area codes and audited authority changes.
-- A platform Staff account has one operational work area. Hotel team
-- capabilities remain separately composable by each hotel owner.

create or replace function public.canonical_staff_domain(p_permission text)
returns text
language sql
immutable
security invoker
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
    when 'verification' then 'worker_operations'
    when 'worker_verification' then 'worker_operations'
    when 'worker_review' then 'worker_operations'
    when 'worker_operations' then 'worker_operations'
    when 'finance' then 'finance_operations'
    when 'finance_operations' then 'finance_operations'
    when 'security' then 'security_operations'
    when 'security_operations' then 'security_operations'
    when 'support' then 'support'
    else null
  end
$$;

update public.staff_permissions
set permission=public.canonical_staff_domain(permission)
where public.canonical_staff_domain(permission) is not null
  and permission<>public.canonical_staff_domain(permission);

create or replace function public.current_staff_has_permission(p_permission text)
returns boolean
language sql
stable
security definer
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
    select 1 from actor a,requested r
    where a.role='staff' and r.domain is not null
      and nullif(btrim(coalesce(a.assigned_state,'')),'') is not null
      and nullif(btrim(coalesce(a.assigned_lga,'')),'') is not null
      and exists(
        select 1 from public.workspace_role_assignments w
        where w.user_id=a.user_id and w.workspace_role=r.domain
          and w.status='active'
      )
  ) or exists(
    select 1 from actor a
    where a.role in('admin','creator')
  )
$$;

create or replace function public.manage_staff_permission(
  p_staff_id text,p_permission text,p_enabled boolean,
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
  where user_id=p_staff_id and role='staff' and not coalesce(deleted,false)
  for update;
  if v_actor.role not in('creator','admin') then raise exception 'Not authorised'; end if;
  if v_target.user_id is null then raise exception 'Staff profile not found'; end if;
  if v_domain is null then raise exception 'Invalid Staff work area'; end if;
  if v_actor.role='creator'
     and not public.creator_has_elevation(p_creator_elevation_id,'staff_authority') then
    raise exception 'Recent Creator authentication required';
  end if;
  if v_actor.role='admin' and public.wehouse_state_key(v_actor.assigned_state)
     <>public.wehouse_state_key(v_target.assigned_state) then
    raise exception 'Admin can manage only Staff in the assigned State';
  end if;

  if p_enabled then
    update public.staff_permissions set is_active=false,revoked_at=now()
    where staff_id=p_staff_id and is_active and permission<>v_domain;
    update public.workspace_role_assignments
    set status='revoked',revoked_by=v_actor.user_id,revoked_at=now(),updated_at=now()
    where user_id=p_staff_id and status='active'
      and workspace_role in(
        'property_operations','field_operations','worker_operations',
        'finance_operations','security_operations','support'
      ) and workspace_role<>v_domain;
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

  if p_enabled then
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
  else
    update public.workspace_role_assignments
    set status='revoked',revoked_by=v_actor.user_id,revoked_at=now(),updated_at=now()
    where user_id=p_staff_id and workspace_role=v_domain and status='active';
  end if;

  insert into public.admin_audit_log(
    admin_id,action,target_type,target_id,details,created_at
  ) values(
    v_actor.user_id,'staff_work_area_changed','profiles',p_staff_id,
    jsonb_build_object('work_area',v_domain,'enabled',p_enabled,
      'actor_role',v_actor.role,'state',v_target.assigned_state,
      'lga',v_target.assigned_lga)::text,now()
  );
end
$$;

create or replace function public.manage_staff_permission(
  p_staff_id text,p_permission text,p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor_role text;
begin
  select role into v_actor_role from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor_role='creator' then
    raise exception 'Recent Creator authentication required';
  end if;
  perform public.manage_staff_permission(
    p_staff_id,p_permission,p_enabled,null::uuid
  );
end
$$;

create or replace function public.creator_set_team_role(
  p_target_user_id text,p_new_role text,p_state text,p_lga text,p_module text,
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
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.role<>'creator'
     or not public.current_actor_has_workspace('creator',null) then
    raise exception 'Creator authority required';
  end if;
  if not public.creator_has_elevation(p_creator_elevation_id,'staff_authority') then
    raise exception 'Recent Creator authentication required';
  end if;
  select * into v_target from public.profiles
  where user_id=p_target_user_id for update;
  if v_target.user_id is null then raise exception 'Target account not found'; end if;
  if v_target.user_id=v_actor.user_id or v_target.role='creator' then
    raise exception 'Creator authority cannot be modified here';
  end if;
  if p_new_role not in('admin','staff','user') then raise exception 'Invalid team role'; end if;
  if p_new_role in('admin','staff') and (v_state is null or v_lga is null) then
    raise exception 'State and LGA are required';
  end if;
  if p_new_role='staff' and v_domain is null then
    raise exception 'A valid Staff work area is required';
  end if;

  update public.workspace_role_assignments
  set status='revoked',revoked_by=v_actor.user_id,revoked_at=now(),updated_at=now()
  where user_id=p_target_user_id and status='active'
    and workspace_role in(
      'staff','admin','property_operations','field_operations',
      'worker_operations','finance_operations','security_operations','support'
    );
  update public.staff_permissions set is_active=false,revoked_at=now()
  where staff_id=p_target_user_id and is_active;

  if p_new_role='user' then
    update public.profiles set role='user',assigned_state=null,assigned_lga=null,
      scope=null,updated_by=v_actor.user_id,updated_at=now()
    where user_id=p_target_user_id;
  else
    update public.profiles set role=p_new_role,assigned_state=v_state,
      assigned_lga=v_lga,scope='local',updated_by=v_actor.user_id,updated_at=now()
    where user_id=p_target_user_id;
    insert into public.workspace_role_assignments(
      user_id,workspace_role,scope_type,scope_state,scope_lga,status,
      granted_by,granted_at,created_at,updated_at
    ) values(
      p_target_user_id,p_new_role,'state',v_state,v_lga,'active',
      v_actor.user_id,now(),now(),now()
    ) on conflict(user_id,workspace_role) where status='active' do update set
      scope_type='state',scope_state=excluded.scope_state,
      scope_lga=excluded.scope_lga,granted_by=excluded.granted_by,
      granted_at=now(),updated_at=now();
    if p_new_role='staff' then
      perform public.manage_staff_permission(
        p_target_user_id,v_domain,true,p_creator_elevation_id
      );
    end if;
  end if;

  insert into public.audit_logs(
    action,target_type,target_id,details,admin_id,admin_email
  ) values(
    'ROLE_CHANGE','profiles',p_target_user_id,jsonb_build_object(
      'old_role',v_target.role,'new_role',p_new_role,'assigned_state',v_state,
      'assigned_lga',v_lga,'staff_work_area',case when p_new_role='staff'
        then v_domain else null end,'authority_model','creator_step_up'
    )::text,v_actor.user_id,v_actor.email
  );
  return true;
end
$$;

create or replace function public.creator_set_team_role(
  p_target_user_id text,p_new_role text,p_state text default null,
  p_lga text default null,p_module text default null
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

create or replace function public.creator_reassign_branch(
  p_target_user_id text,p_new_state text,p_new_lga text,
  p_creator_elevation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor public.profiles; v_target public.profiles;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if v_actor.role<>'creator'
     or not public.creator_has_elevation(p_creator_elevation_id,'staff_authority') then
    raise exception 'Recent Creator authentication required';
  end if;
  select * into v_target from public.profiles
  where user_id=p_target_user_id and role in('admin','staff') for update;
  if v_target.user_id is null then raise exception 'Admin or Staff account required'; end if;
  if nullif(btrim(coalesce(p_new_state,'')),'') is null
     or nullif(btrim(coalesce(p_new_lga,'')),'') is null then
    raise exception 'State and LGA are required';
  end if;
  update public.profiles set assigned_state=btrim(p_new_state),
    assigned_lga=btrim(p_new_lga),updated_by=v_actor.user_id,updated_at=now()
  where user_id=p_target_user_id;
  update public.workspace_role_assignments set
    scope_state=btrim(p_new_state),scope_lga=btrim(p_new_lga),updated_at=now()
  where user_id=p_target_user_id and status='active'
    and workspace_role in(
      'staff','admin','property_operations','field_operations',
      'worker_operations','finance_operations','security_operations','support'
    );
  insert into public.admin_audit_log(
    admin_id,action,target_type,target_id,details,created_at
  ) values(v_actor.user_id,'team_branch_reassigned','profiles',p_target_user_id,
    jsonb_build_object('old_state',v_target.assigned_state,
      'old_lga',v_target.assigned_lga,'new_state',btrim(p_new_state),
      'new_lga',btrim(p_new_lga))::text,now());
  return true;
end
$$;

create or replace function public.creator_reassign_branch(
  p_target_user_id text,p_new_state text,p_new_lga text
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

create or replace function public.admin_appoint_staff(
  p_target_user_id text,p_module text
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
  v_limit integer:=0;
  v_used integer:=0;
  v_lga text;
begin
  if v_domain is null then raise exception 'A valid Staff work area is required'; end if;
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text and role='admin'
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if v_actor.user_id is null then raise exception 'Admin access required'; end if;
  select * into v_target from public.profiles
  where user_id=p_target_user_id and not coalesce(deleted,false) for update;
  if v_target.user_id is null or v_target.role not in('user','staff') then
    raise exception 'Only a User or existing Staff account can be appointed';
  end if;
  if public.wehouse_state_key(v_target.state)
     <>public.wehouse_state_key(v_actor.assigned_state) then
    raise exception 'Admin can appoint only Users in the assigned State';
  end if;
  v_lga:=coalesce(nullif(btrim(v_target.local_government),''),
    nullif(btrim(v_target.city),''),nullif(btrim(v_actor.assigned_lga),''));
  if v_lga is null then raise exception 'The Staff LGA is required'; end if;
  if v_target.role<>'staff' then
    v_limit:=coalesce(public.get_admin_staff_limit_v2(),0);
    if v_limit>0 then
      select count(*)::integer into v_used from public.profiles p
      where p.role='staff' and not coalesce(p.deleted,false)
        and public.wehouse_state_key(p.assigned_state)
          =public.wehouse_state_key(v_actor.assigned_state);
      if v_used>=v_limit then raise exception 'State Staff appointment limit reached'; end if;
    end if;
    perform public.admin_update_role(p_target_user_id,'staff');
  end if;
  update public.profiles set assigned_state=v_actor.assigned_state,
    assigned_lga=v_lga,updated_by=v_actor.user_id,updated_at=now()
  where user_id=p_target_user_id;
  perform public.manage_staff_permission(p_target_user_id,v_domain,true);
  return true;
end
$$;

revoke all on function public.canonical_staff_domain(text) from public,anon;
revoke all on function public.current_staff_has_permission(text) from public,anon;
revoke all on function public.manage_staff_permission(text,text,boolean,uuid) from public,anon;
revoke all on function public.manage_staff_permission(text,text,boolean) from public,anon;
revoke all on function public.creator_set_team_role(text,text,text,text,text,uuid) from public,anon;
revoke all on function public.creator_set_team_role(text,text,text,text,text) from public,anon;
revoke all on function public.creator_reassign_branch(text,text,text,uuid) from public,anon;
revoke all on function public.creator_reassign_branch(text,text,text) from public,anon;
revoke all on function public.admin_appoint_staff(text,text) from public,anon;
grant execute on function public.canonical_staff_domain(text) to authenticated,service_role;
grant execute on function public.current_staff_has_permission(text) to authenticated,service_role;
grant execute on function public.manage_staff_permission(text,text,boolean,uuid) to authenticated,service_role;
grant execute on function public.manage_staff_permission(text,text,boolean) to authenticated,service_role;
grant execute on function public.creator_set_team_role(text,text,text,text,text,uuid) to authenticated,service_role;
grant execute on function public.creator_set_team_role(text,text,text,text,text) to authenticated,service_role;
grant execute on function public.creator_reassign_branch(text,text,text,uuid) to authenticated,service_role;
grant execute on function public.creator_reassign_branch(text,text,text) to authenticated,service_role;
grant execute on function public.admin_appoint_staff(text,text) to authenticated,service_role;
