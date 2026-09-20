-- Repair the recorded Creator/Team journeys. No memberships or customer data are changed.
CREATE OR REPLACE FUNCTION public.get_my_workspace_access()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select jsonb_build_object(
    'identity',jsonb_build_object(
      'user_id',profile.user_id,
      'account_kind','consumer',
      'compatibility_role',profile.role
    ),
    'personal_workspace',
      profile.deleted_at is null and not coalesce(profile.deleted,false)
      and not coalesce(profile.suspended,false)
      and not coalesce(profile.banned,false),
    'privileged_workspaces',coalesce((
      select jsonb_agg(workspace.item order by workspace.item->>'role')
      from (
        select jsonb_build_object(
          'role',assignment.workspace_role,
          'scope_type',assignment.scope_type,
          'state',assignment.scope_state,
          'lga',assignment.scope_lga
        ) as item
        from public.workspace_role_assignments assignment
        where assignment.user_id=profile.user_id
          and assignment.status='active' and assignment.revoked_at is null
          and profile.deleted_at is null and not coalesce(profile.deleted,false)
          and not coalesce(profile.suspended,false) and not coalesce(profile.banned,false)
          and assignment.workspace_role in(
            'worker','property_partner','staff','admin','creator'
          )
        union all
        select jsonb_build_object(
          'role','hotel','scope_type','hotel','state',null,'lga',null
        )
        where profile.deleted_at is null and not coalesce(profile.deleted,false)
          and not coalesce(profile.suspended,false) and not coalesce(profile.banned,false)
          and exists(
          select 1 from public.hotel_team_members team
          where team.member_user_id=profile.user_id and team.status='active'
        )
      ) workspace
    ),'[]'::jsonb)
  )
  from public.profiles profile
  where profile.auth_id=(select auth.uid())::text;
$function$;

CREATE OR REPLACE FUNCTION public.manage_staff_permission(p_staff_id text, p_permission text, p_enabled boolean, p_creator_elevation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
  else raise exception 'Not authorised'; end if;
  if v_target.user_id is null then raise exception 'Staff profile not found'; end if;
  if v_domain is null then raise exception 'Invalid Staff work area'; end if;
  if v_actor.role='creator'
     and not public.creator_has_elevation(p_creator_elevation_id,'staff_authority') then
    raise exception 'Recent Creator authentication required';
  end if;
  if v_actor.role='admin' and not public.current_actor_in_scope(v_target.assigned_state,v_target.assigned_lga) then
    raise exception 'Admin can manage only Staff in the assigned branch';
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
$function$;

create or replace function public.get_my_managed_team()
returns jsonb language plpgsql stable security definer
set search_path to 'pg_catalog','public'
as $$
declare is_creator boolean:=public.current_actor_has_workspace('creator',null); result jsonb;
begin
  if not is_creator and not public.current_actor_has_workspace('admin',null) then
    raise exception 'Active team management access required';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id',p.user_id,'full_name',p.full_name,'username',p.username,'email',p.email,
    'avatar_url',p.avatar_url,'role',case when public.user_has_active_workspace(p.user_id,'admin') then 'admin' else 'staff' end,
    'assigned_state',p.assigned_state,'assigned_lga',p.assigned_lga,
    'work_areas',coalesce((select jsonb_agg(w.workspace_role order by w.workspace_role)
      from public.workspace_role_assignments w where w.user_id=p.user_id and w.status='active' and w.revoked_at is null
        and w.workspace_role in ('property_operations','field_operations','worker_operations','finance_operations','security_operations','support')),'[]'::jsonb)
  ) order by coalesce(p.full_name,p.username,p.user_id)),'[]'::jsonb) into result
  from public.profiles p
  where (public.user_has_active_workspace(p.user_id,'staff')
      or (is_creator and public.user_has_active_workspace(p.user_id,'admin')))
    and (is_creator or public.current_actor_in_scope(p.assigned_state,p.assigned_lga));
  return result;
end;
$$;
revoke all on function public.get_my_managed_team() from public,anon;
grant execute on function public.get_my_managed_team() to authenticated,service_role;

-- These boolean RLS predicates were accidentally removed from the callable
-- policy surface. Harden their authority before restoring only the needed grants.
create or replace function public.current_staff_can_review_worker(p_worker_id text)
returns boolean language sql stable security definer
set search_path to 'pg_catalog','public'
as $$
  select public.current_actor_has_workspace('staff',null)
    and public.current_staff_has_permission('worker_operations')
    and public.user_has_active_workspace(p_worker_id,'worker')
    and exists(select 1 from public.profiles p where p.user_id=p_worker_id
      and public.current_actor_in_scope(p.state,coalesce(nullif(p.local_government,''),p.city)));
$$;
create or replace function public.current_oversight_can_review_worker(p_worker_id text)
returns boolean language sql stable security definer
set search_path to 'pg_catalog','public'
as $$
  select public.user_has_active_workspace(p_worker_id,'worker')
    and (public.current_actor_has_workspace('creator',null)
      or (public.current_actor_has_workspace('admin',null)
        and exists(select 1 from public.profiles p where p.user_id=p_worker_id
          and public.current_actor_in_scope(p.state,coalesce(nullif(p.local_government,''),p.city)))));
$$;
revoke all on function public.current_staff_can_review_worker(text),public.current_oversight_can_review_worker(text),
  private.can_access_support_object(text),private.can_read_support_object(text) from public,anon;
grant execute on function public.current_staff_can_review_worker(text),public.current_oversight_can_review_worker(text),
  private.can_access_support_object(text),private.can_read_support_object(text) to authenticated,service_role;
notify pgrst,'reload schema';
