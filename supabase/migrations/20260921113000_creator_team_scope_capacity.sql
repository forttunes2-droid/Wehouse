-- Canonical WeHouse Team authority.
-- Personal identity remains durable. Admin/Staff authority comes from additive workspace grants.
-- Coverage is explicit: state or branch. Creator alone sets Admin delegation and Operation limits.

begin;

-- Legacy profile fields are now display/compatibility data only. They must never mint,
-- widen or revoke privileged workspace authority.
create or replace function public.sync_legacy_profile_role_assignment()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  return new;
end
$$;

create table if not exists public.admin_team_authority (
  admin_user_id text primary key references public.profiles(user_id) on delete cascade,
  can_manage_staff boolean not null default false,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_operation_limits (
  admin_user_id text not null references public.profiles(user_id) on delete cascade,
  operation text not null,
  max_active integer not null default 0,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(admin_user_id,operation),
  constraint admin_operation_limits_operation_check check (
    operation in (
      'property_operations','worker_operations','field_operations',
      'support','finance_operations','security_operations'
    )
  ),
  constraint admin_operation_limits_max_check check (max_active between 0 and 1000)
);

alter table public.admin_team_authority enable row level security;
alter table public.admin_operation_limits enable row level security;
revoke all on table public.admin_team_authority from public,anon,authenticated;
revoke all on table public.admin_operation_limits from public,anon,authenticated;
grant all on table public.admin_team_authority to service_role;
grant all on table public.admin_operation_limits to service_role;

-- Existing Admins keep their existing coverage but do not silently receive Team-management
-- delegation. Creator must opt them in and choose their capacities.
insert into public.admin_team_authority(admin_user_id,can_manage_staff,created_at,updated_at)
select distinct w.user_id,false,now(),now()
from public.workspace_role_assignments w
where w.workspace_role='admin'
  and w.status='active'
  and w.revoked_at is null
on conflict(admin_user_id) do nothing;

-- An Operation grant always follows the Staff base workspace coverage.
update public.workspace_role_assignments operation
set scope_type=staff_grant.scope_type,
    scope_state=staff_grant.scope_state,
    scope_lga=case when staff_grant.scope_type='branch' then staff_grant.scope_lga else null end,
    updated_at=now()
from public.workspace_role_assignments staff_grant
where operation.user_id=staff_grant.user_id
  and staff_grant.workspace_role='staff'
  and staff_grant.status='active'
  and staff_grant.revoked_at is null
  and operation.status='active'
  and operation.revoked_at is null
  and operation.workspace_role in(
    'property_operations','worker_operations','field_operations',
    'support','finance_operations','security_operations'
  )
  and (
    operation.scope_type is distinct from staff_grant.scope_type
    or public.wehouse_state_key(operation.scope_state)
       is distinct from public.wehouse_state_key(staff_grant.scope_state)
    or lower(btrim(coalesce(operation.scope_lga,'')))
       is distinct from lower(btrim(coalesce(
         case when staff_grant.scope_type='branch' then staff_grant.scope_lga else null end,''
       )))
  );

create or replace function public._admin_dashboard_actor()
returns public.profiles
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_grant public.workspace_role_assignments;
begin
  select * into v_actor
  from public.profiles p
  where p.auth_id=(select auth.uid())::text
    and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
  limit 1;
  if v_actor.user_id is null then
    raise exception 'Admin or Creator account required';
  end if;

  if public.user_has_active_workspace(v_actor.user_id,'creator') then
    v_actor.role:='creator';
    v_actor.assigned_state:=null;
    v_actor.assigned_lga:=null;
    return v_actor;
  end if;

  select * into v_grant
  from public.workspace_role_assignments w
  where w.user_id=v_actor.user_id
    and w.workspace_role='admin'
    and w.status='active'
    and w.revoked_at is null
  limit 1;

  if v_grant.id is null then
    raise exception 'Admin or Creator account required';
  end if;
  if v_grant.scope_type not in ('state','branch')
     or nullif(public.wehouse_state_key(v_grant.scope_state),'') is null
     or (v_grant.scope_type='branch'
         and nullif(btrim(coalesce(v_grant.scope_lga,'')),'') is null) then
    raise exception 'Admin coverage is incomplete. Contact Creator.';
  end if;

  -- Normalise legacy callers without mutating profiles.role.
  v_actor.role:='admin';
  v_actor.assigned_state:=v_grant.scope_state;
  v_actor.assigned_lga:=case when v_grant.scope_type='branch'
    then v_grant.scope_lga else null end;
  return v_actor;
end
$$;

create or replace function public._assert_admin_lga_scope(p_target_user_id text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_target public.profiles;
  v_state text;
  v_lga text;
begin
  v_actor:=public._admin_dashboard_actor();
  if v_actor.role='creator' then return; end if;

  select * into v_target
  from public.profiles
  where user_id=p_target_user_id
    and not coalesce(deleted,false)
  limit 1;
  if v_target.user_id is null then raise exception 'Target account not found'; end if;

  if public.user_has_active_workspace(v_target.user_id,'admin')
     or public.user_has_active_workspace(v_target.user_id,'staff') then
    select scope_state,
           case when scope_type='branch' then scope_lga else null end
      into v_state,v_lga
    from public.workspace_role_assignments
    where user_id=v_target.user_id
      and workspace_role=case
        when public.user_has_active_workspace(v_target.user_id,'admin') then 'admin'
        else 'staff'
      end
      and status='active'
      and revoked_at is null
    limit 1;
  else
    v_state:=v_target.state;
    v_lga:=coalesce(nullif(v_target.local_government,''),nullif(v_target.city,''));
  end if;

  if not public.current_actor_in_scope(v_state,v_lga) then
    raise exception 'Admin scope violation: target is outside the assigned coverage';
  end if;
end
$$;

create or replace function public._team_scope_contains(
  p_parent_scope text,
  p_parent_state text,
  p_parent_lga text,
  p_child_scope text,
  p_child_state text,
  p_child_lga text
)
returns boolean
language sql
immutable
set search_path to 'pg_catalog','public'
as $$
  select case
    when p_parent_scope='global' then true
    when p_parent_scope='state' then
      p_child_scope in ('state','branch')
      and nullif(public.wehouse_state_key(p_parent_state),'') is not null
      and public.wehouse_state_key(p_parent_state)=public.wehouse_state_key(p_child_state)
    when p_parent_scope='branch' then
      p_child_scope='branch'
      and nullif(public.wehouse_state_key(p_parent_state),'') is not null
      and public.wehouse_state_key(p_parent_state)=public.wehouse_state_key(p_child_state)
      and nullif(lower(btrim(coalesce(p_parent_lga,''))),'') is not null
      and lower(btrim(p_parent_lga))=lower(btrim(coalesce(p_child_lga,'')))
    else false
  end
$$;

create or replace function public._count_operation_in_scope(
  p_operation text,
  p_scope_type text,
  p_state text,
  p_lga text
)
returns integer
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select count(distinct op.user_id)::integer
  from public.workspace_role_assignments op
  join public.profiles p on p.user_id=op.user_id
  where op.workspace_role=public.canonical_staff_domain(p_operation)
    and op.status='active'
    and op.revoked_at is null
    and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
    and public.user_has_active_workspace(op.user_id,'staff')
    and (
      p_scope_type='global'
      or (
        public.wehouse_state_key(op.scope_state)=public.wehouse_state_key(p_state)
        and (
          p_scope_type='state'
          or (
            p_scope_type='branch'
            and (
              op.scope_type='state'
              or (
                op.scope_type='branch'
                and lower(btrim(coalesce(op.scope_lga,'')))=
                    lower(btrim(coalesce(p_lga,'')))
              )
            )
          )
        )
      )
    )
$$;

create or replace function public.creator_has_elevation(
  p_creator_elevation_id uuid,
  p_action_class text
)
returns boolean
language sql
stable security definer
set search_path to 'pg_catalog','public'
as $$
  select exists(
    select 1
    from public.creator_elevation_grants g
    join public.profiles p on p.user_id=g.creator_user_id
    where g.creator_elevation_id=p_creator_elevation_id
      and g.auth_user_id=(select auth.uid())
      and g.auth_session_id=coalesce((select auth.jwt()->>'session_id'),'')
      and g.revoked_at is null
      and g.expires_at>now()
      and exists(
        select 1
        from public.workspace_role_assignments w
        where w.user_id=p.user_id
          and w.workspace_role='creator'
          and w.status='active'
          and w.revoked_at is null
          and w.scope_type='global'
      )
      and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false)
      and not coalesce(p.banned,false)
      and (
        p_action_class=any(g.action_classes)
        or 'all_sensitive'=any(g.action_classes)
      )
  )
$$;

create or replace function public.issue_creator_elevation_from_service(
  p_auth_user_id uuid,
  p_auth_session_id text,
  p_action_classes text[],
  p_verification_method text,
  p_ip_hash text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public','auth'
as $$
declare
  v_creator public.profiles;
  v_id uuid;
  v_method text;
begin
  if (select auth.role())<>'service_role' then
    raise exception 'service role required';
  end if;
  if coalesce(cardinality(p_action_classes),0)=0 then
    raise exception 'At least one action class is required';
  end if;

  select * into v_creator
  from public.profiles p
  where p.auth_id=p_auth_user_id::text
    and exists(
      select 1
      from public.workspace_role_assignments w
      where w.user_id=p.user_id
        and w.workspace_role='creator'
        and w.status='active'
        and w.revoked_at is null
        and w.scope_type='global'
    )
    and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
  limit 1;
  if v_creator.user_id is null then raise exception 'Creator authority required'; end if;

  v_method:=case when exists(
    select 1 from auth.mfa_factors f
    where f.user_id=p_auth_user_id and f.status='verified'
  ) then 'password_mfa' else 'password' end;
  if p_verification_method<>v_method then
    raise exception 'Creator MFA assurance does not match enrolled factors';
  end if;

  update public.creator_elevation_grants
  set revoked_at=now()
  where auth_user_id=p_auth_user_id
    and auth_session_id=p_auth_session_id
    and revoked_at is null;

  insert into public.creator_elevation_grants(
    creator_user_id,auth_user_id,auth_session_id,action_classes,
    issued_at,expires_at,verification_method,issued_ip_hash
  ) values(
    v_creator.user_id,p_auth_user_id,p_auth_session_id,
    array(select distinct unnest(p_action_classes)),
    now(),now()+interval '10 minutes',v_method,p_ip_hash
  ) returning creator_elevation_id into v_id;

  insert into public.admin_audit_log(
    admin_id,action,target_type,target_id,details,created_at
  ) values(
    v_creator.user_id,'creator_elevation_issued','creator_session',
    p_auth_session_id,jsonb_build_object(
      'creator_elevation_id',v_id,
      'action_classes',p_action_classes,
      'verification_method',v_method,
      'expires_at',now()+interval '10 minutes'
    )::text,now()
  );
  return v_id;
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
    select p.user_id
    from public.profiles p
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
    from actor a,requested r
    where r.domain is not null
      and public.user_has_active_workspace(a.user_id,'staff')
      and public.user_has_active_workspace(a.user_id,r.domain)
  )
  or exists(
    select 1
    from actor a
    where public.user_has_active_workspace(a.user_id,'admin')
       or public.user_has_active_workspace(a.user_id,'creator')
  )
$$;

create or replace function public.get_admin_team_authority(
  p_admin_user_id text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_target text;
  v_grant public.workspace_role_assignments;
  v_can boolean:=false;
  v_limits jsonb;
begin
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null then raise exception 'Active account required'; end if;

  v_target:=coalesce(nullif(p_admin_user_id,''),v_actor.user_id);
  if not public.user_has_active_workspace(v_target,'admin') then
    raise exception 'Active Admin workspace required';
  end if;
  if not public.user_has_active_workspace(v_actor.user_id,'creator')
     and v_actor.user_id<>v_target then
    raise exception 'Only Creator can inspect another Admin authority';
  end if;
  if not public.user_has_active_workspace(v_actor.user_id,'creator')
     and not public.user_has_active_workspace(v_actor.user_id,'admin') then
    raise exception 'Admin or Creator authority required';
  end if;

  select * into v_grant
  from public.workspace_role_assignments
  where user_id=v_target
    and workspace_role='admin'
    and status='active'
    and revoked_at is null
  limit 1;
  if v_grant.id is null then raise exception 'Active Admin workspace required'; end if;

  select coalesce(a.can_manage_staff,false)
  into v_can
  from public.admin_team_authority a
  where a.admin_user_id=v_target;
  v_can:=coalesce(v_can,false);

  select jsonb_object_agg(
    op.operation,
    jsonb_build_object(
      'max',coalesce(l.max_active,0),
      'active',public._count_operation_in_scope(
        op.operation,v_grant.scope_type,v_grant.scope_state,v_grant.scope_lga
      )
    )
  )
  into v_limits
  from (
    values
      ('property_operations'),('worker_operations'),('field_operations'),
      ('support'),('finance_operations'),('security_operations')
  ) as op(operation)
  left join public.admin_operation_limits l
    on l.admin_user_id=v_target
   and l.operation=op.operation;

  return jsonb_build_object(
    'admin_user_id',v_target,
    'scope_type',v_grant.scope_type,
    'state',v_grant.scope_state,
    'lga',case when v_grant.scope_type='branch' then v_grant.scope_lga else null end,
    'can_manage_staff',v_can,
    'limits',coalesce(v_limits,'{}'::jsonb)
  );
end
$$;

create or replace function public.creator_set_admin_authority(
  p_admin_user_id text,
  p_scope_type text,
  p_state text,
  p_lga text,
  p_can_manage_staff boolean,
  p_limits jsonb,
  p_creator_elevation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_scope text:=lower(btrim(coalesce(p_scope_type,'')));
  v_state text:=nullif(btrim(coalesce(p_state,'')),'');
  v_lga text:=nullif(btrim(coalesce(p_lga,'')),'');
  v_operation text;
  v_limit integer;
begin
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null
     or not public.user_has_active_workspace(v_actor.user_id,'creator') then
    raise exception 'Creator authority required';
  end if;
  if not public.creator_has_elevation(p_creator_elevation_id,'staff_authority') then
    raise exception 'Recent Creator authentication required';
  end if;
  if p_admin_user_id=v_actor.user_id
     or public.user_has_active_workspace(p_admin_user_id,'creator') then
    raise exception 'Creator authority cannot be changed here';
  end if;
  if not public.user_has_active_workspace(p_admin_user_id,'admin') then
    raise exception 'Active Admin workspace required';
  end if;
  if v_scope not in ('state','branch') then
    raise exception 'Coverage must be Whole State or One LGA';
  end if;
  if v_state is null then raise exception 'State is required'; end if;
  if v_scope='branch' and v_lga is null then raise exception 'LGA is required'; end if;
  if v_scope='state' then v_lga:=null; end if;

  update public.workspace_role_assignments
  set scope_type=v_scope,
      scope_state=v_state,
      scope_lga=v_lga,
      updated_at=now(),
      granted_by=v_actor.user_id
  where user_id=p_admin_user_id
    and workspace_role='admin'
    and status='active'
    and revoked_at is null;

  update public.profiles
  set assigned_state=v_state,
      assigned_lga=v_lga,
      updated_by=v_actor.user_id,
      updated_at=now()
  where user_id=p_admin_user_id;

  insert into public.admin_team_authority(
    admin_user_id,can_manage_staff,created_by,updated_by,created_at,updated_at
  ) values(
    p_admin_user_id,coalesce(p_can_manage_staff,false),
    v_actor.user_id,v_actor.user_id,now(),now()
  )
  on conflict(admin_user_id) do update set
    can_manage_staff=excluded.can_manage_staff,
    updated_by=excluded.updated_by,
    updated_at=now();

  foreach v_operation in array array[
    'property_operations','worker_operations','field_operations',
    'support','finance_operations','security_operations'
  ] loop
    begin
      v_limit:=coalesce((coalesce(p_limits,'{}'::jsonb)->>v_operation)::integer,0);
    exception when invalid_text_representation then
      raise exception 'Operation limits must be whole numbers';
    end;
    if v_limit<0 or v_limit>1000 then
      raise exception 'Operation limit must be between 0 and 1000';
    end if;

    insert into public.admin_operation_limits(
      admin_user_id,operation,max_active,created_by,updated_by,created_at,updated_at
    ) values(
      p_admin_user_id,v_operation,v_limit,v_actor.user_id,v_actor.user_id,now(),now()
    )
    on conflict(admin_user_id,operation) do update set
      max_active=excluded.max_active,
      updated_by=excluded.updated_by,
      updated_at=now();
  end loop;

  insert into public.admin_audit_log(
    admin_id,action,target_type,target_id,details,created_at
  ) values(
    v_actor.user_id,'admin_team_authority_changed','profiles',p_admin_user_id,
    jsonb_build_object(
      'scope_type',v_scope,
      'state',v_state,
      'lga',v_lga,
      'can_manage_staff',coalesce(p_can_manage_staff,false),
      'limits',coalesce(p_limits,'{}'::jsonb)
    )::text,now()
  );

  return public.get_admin_team_authority(p_admin_user_id);
end
$$;

create or replace function public._admin_grant_staff_operation(
  p_target_user_id text,
  p_operation text,
  p_scope_type text,
  p_state text,
  p_lga text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_target public.profiles;
  v_admin_grant public.workspace_role_assignments;
  v_domain text:=public.canonical_staff_domain(p_operation);
  v_scope text:=lower(btrim(coalesce(p_scope_type,'')));
  v_state text:=nullif(btrim(coalesce(p_state,'')),'');
  v_lga text:=nullif(btrim(coalesce(p_lga,'')),'');
  v_limit integer:=0;
  v_used integer:=0;
  v_same boolean:=false;
  v_target_lga text;
begin
  select * into v_actor
  from public.profiles p
  where p.auth_id=(select auth.uid())::text
    and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
  limit 1;
  if v_actor.user_id is null
     or not public.user_has_active_workspace(v_actor.user_id,'admin') then
    raise exception 'Active Admin workspace required';
  end if;
  if v_domain is null then raise exception 'A valid Staff Operation is required'; end if;

  select * into v_admin_grant
  from public.workspace_role_assignments
  where user_id=v_actor.user_id
    and workspace_role='admin'
    and status='active'
    and revoked_at is null
  limit 1;
  if v_admin_grant.id is null then raise exception 'Active Admin workspace required'; end if;

  if not coalesce((
    select a.can_manage_staff
    from public.admin_team_authority a
    where a.admin_user_id=v_actor.user_id
  ),false) then
    raise exception 'Creator has not granted Team management to this Admin';
  end if;

  if v_scope not in ('state','branch') then
    raise exception 'Staff coverage must be Whole State or One LGA';
  end if;
  if v_state is null then raise exception 'Staff State is required'; end if;
  if v_scope='branch' and v_lga is null then raise exception 'Staff LGA is required'; end if;
  if v_scope='state' then v_lga:=null; end if;

  if not public._team_scope_contains(
    v_admin_grant.scope_type,v_admin_grant.scope_state,v_admin_grant.scope_lga,
    v_scope,v_state,v_lga
  ) then
    raise exception 'Admin cannot assign Staff outside the granted coverage';
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
  if coalesce(v_target.account_kind,'consumer')<>'consumer' then
    raise exception 'An active Personal identity is required';
  end if;
  if public.user_has_active_workspace(v_target.user_id,'creator')
     or public.user_has_active_workspace(v_target.user_id,'admin') then
    raise exception 'Admin cannot change Creator or Admin authority';
  end if;

  if not public.user_has_active_workspace(v_target.user_id,'staff') then
    v_target_lga:=coalesce(nullif(v_target.local_government,''),nullif(v_target.city,''));
    if not public.current_actor_in_scope(v_target.state,v_target_lga) then
      raise exception 'Admin can add only Personal accounts inside the granted coverage';
    end if;
  elsif not exists(
    select 1
    from public.workspace_role_assignments staff_grant
    where staff_grant.user_id=v_target.user_id
      and staff_grant.workspace_role='staff'
      and staff_grant.status='active'
      and staff_grant.revoked_at is null
      and public._team_scope_contains(
        v_admin_grant.scope_type,v_admin_grant.scope_state,v_admin_grant.scope_lga,
        staff_grant.scope_type,staff_grant.scope_state,staff_grant.scope_lga
      )
  ) then
    raise exception 'Admin cannot change Staff outside the granted coverage';
  end if;

  -- Serialize all staffing changes for an Operation within a State. This prevents
  -- two simultaneous Admin requests from both passing the same capacity check.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'wehouse-team-cap:'||public.wehouse_state_key(v_state)||':'||v_domain,0
    )
  );

  select coalesce(max_active,0)
  into v_limit
  from public.admin_operation_limits
  where admin_user_id=v_actor.user_id
    and operation=v_domain
  for update;
  v_limit:=coalesce(v_limit,0);
  if v_limit<=0 then
    raise exception 'Creator has not enabled capacity for this Operation';
  end if;

  select exists(
    select 1
    from public.workspace_role_assignments op
    where op.user_id=v_target.user_id
      and op.workspace_role=v_domain
      and op.status='active'
      and op.revoked_at is null
  )
  into v_same;

  v_used:=public._count_operation_in_scope(
    v_domain,v_admin_grant.scope_type,v_admin_grant.scope_state,v_admin_grant.scope_lga
  );
  if not v_same and v_used>=v_limit then
    raise exception 'Operation capacity reached (%/%). Creator must raise the limit.',
      v_used,v_limit;
  end if;

  update public.workspace_role_assignments
  set status='revoked',
      revoked_by=v_actor.user_id,
      revoked_at=now(),
      updated_at=now()
  where user_id=v_target.user_id
    and status='active'
    and revoked_at is null
    and workspace_role in(
      'property_operations','worker_operations','field_operations',
      'support','finance_operations','security_operations'
    )
    and workspace_role<>v_domain;

  update public.staff_permissions
  set is_active=false,
      revoked_at=now()
  where staff_id=v_target.user_id
    and is_active
    and public.canonical_staff_domain(permission) is distinct from v_domain;

  insert into public.workspace_role_assignments(
    user_id,workspace_role,scope_type,scope_state,scope_lga,status,
    granted_by,granted_at,created_at,updated_at
  ) values(
    v_target.user_id,'staff',v_scope,v_state,v_lga,'active',
    v_actor.user_id,now(),now(),now()
  )
  on conflict(user_id,workspace_role) where status='active' do update set
    scope_type=excluded.scope_type,
    scope_state=excluded.scope_state,
    scope_lga=excluded.scope_lga,
    granted_by=excluded.granted_by,
    granted_at=now(),
    updated_at=now();

  insert into public.workspace_role_assignments(
    user_id,workspace_role,scope_type,scope_state,scope_lga,status,
    granted_by,granted_at,created_at,updated_at
  ) values(
    v_target.user_id,v_domain,v_scope,v_state,v_lga,'active',
    v_actor.user_id,now(),now(),now()
  )
  on conflict(user_id,workspace_role) where status='active' do update set
    scope_type=excluded.scope_type,
    scope_state=excluded.scope_state,
    scope_lga=excluded.scope_lga,
    granted_by=excluded.granted_by,
    granted_at=now(),
    updated_at=now();

  -- Compatibility/search projection only. Authorization is the workspace grant above.
  insert into public.staff_permissions(
    staff_id,permission,granted_by,granted_at,revoked_at,is_active
  ) values(
    v_target.user_id,v_domain,v_actor.user_id,now(),null,true
  )
  on conflict(staff_id,permission) do update set
    granted_by=excluded.granted_by,
    granted_at=now(),
    revoked_at=null,
    is_active=true;

  update public.profiles
  set assigned_state=v_state,
      assigned_lga=v_lga,
      updated_by=v_actor.user_id,
      updated_at=now()
  where user_id=v_target.user_id;

  insert into public.admin_audit_log(
    admin_id,action,target_type,target_id,details,created_at
  ) values(
    v_actor.user_id,'staff_workspace_granted','profiles',v_target.user_id,
    jsonb_build_object(
      'operation',v_domain,
      'scope_type',v_scope,
      'state',v_state,
      'lga',v_lga,
      'capacity_before',v_used,
      'capacity_max',v_limit,
      'authority_model','additive_workspace_grant'
    )::text,now()
  );

  return jsonb_build_object(
    'success',true,
    'user_id',v_target.user_id,
    'operation',v_domain,
    'scope_type',v_scope,
    'state',v_state,
    'lga',v_lga,
    'active',case when v_same then v_used else v_used+1 end,
    'max',v_limit
  );
end
$$;

create or replace function public.admin_appoint_staff(
  p_target_user_id text,
  p_module text,
  p_scope_type text,
  p_state text,
  p_lga text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  return public._admin_grant_staff_operation(
    p_target_user_id,p_module,p_scope_type,p_state,p_lga
  );
end
$$;

-- Compatibility wrapper. It still uses the Admin's actual grant and the same capacity checks.
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
  v_grant public.workspace_role_assignments;
begin
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
  limit 1;
  if v_actor.user_id is null then raise exception 'Active Admin workspace required'; end if;

  select * into v_grant
  from public.workspace_role_assignments
  where user_id=v_actor.user_id
    and workspace_role='admin'
    and status='active'
    and revoked_at is null
  limit 1;
  if v_grant.id is null then raise exception 'Active Admin workspace required'; end if;

  perform public._admin_grant_staff_operation(
    p_target_user_id,p_module,
    v_grant.scope_type,v_grant.scope_state,v_grant.scope_lga
  );
  return true;
end
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
  v_staff_grant public.workspace_role_assignments;
  v_actor_creator boolean:=false;
  v_actor_admin boolean:=false;
begin
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null then raise exception 'Not authorised'; end if;
  if v_domain is null then raise exception 'Invalid Staff Operation'; end if;

  v_actor_creator:=public.user_has_active_workspace(v_actor.user_id,'creator');
  v_actor_admin:=public.user_has_active_workspace(v_actor.user_id,'admin');
  if not v_actor_creator and not v_actor_admin then raise exception 'Not authorised'; end if;

  select * into v_target
  from public.profiles
  where user_id=p_staff_id
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  for update;
  if v_target.user_id is null
     or not public.user_has_active_workspace(v_target.user_id,'staff') then
    raise exception 'Active Staff workspace not found';
  end if;
  if v_target.user_id=v_actor.user_id then
    raise exception 'Cannot change your own Operation assignment';
  end if;

  select * into v_staff_grant
  from public.workspace_role_assignments
  where user_id=p_staff_id
    and workspace_role='staff'
    and status='active'
    and revoked_at is null
  limit 1;

  if v_actor_admin then
    if not p_enabled then
      if not coalesce((
        select can_manage_staff
        from public.admin_team_authority
        where admin_user_id=v_actor.user_id
      ),false) then
        raise exception 'Creator has not granted Team management to this Admin';
      end if;
      perform public._assert_admin_lga_scope(p_staff_id);
      update public.workspace_role_assignments
      set status='revoked',
          revoked_by=v_actor.user_id,
          revoked_at=now(),
          updated_at=now()
      where user_id=p_staff_id
        and workspace_role=v_domain
        and status='active'
        and revoked_at is null;
      update public.staff_permissions
      set is_active=false,revoked_at=now()
      where staff_id=p_staff_id
        and public.canonical_staff_domain(permission)=v_domain
        and is_active;
      return;
    end if;

    perform public._admin_grant_staff_operation(
      p_staff_id,v_domain,
      v_staff_grant.scope_type,v_staff_grant.scope_state,v_staff_grant.scope_lga
    );
    return;
  end if;

  if not public.creator_has_elevation(p_creator_elevation_id,'staff_authority') then
    raise exception 'Recent Creator authentication required';
  end if;

  if p_enabled then
    update public.workspace_role_assignments
    set status='revoked',
        revoked_by=v_actor.user_id,
        revoked_at=now(),
        updated_at=now()
    where user_id=p_staff_id
      and status='active'
      and revoked_at is null
      and workspace_role in(
        'property_operations','worker_operations','field_operations',
        'support','finance_operations','security_operations'
      )
      and workspace_role<>v_domain;

    update public.staff_permissions
    set is_active=false,revoked_at=now()
    where staff_id=p_staff_id
      and is_active
      and public.canonical_staff_domain(permission) is distinct from v_domain;

    insert into public.workspace_role_assignments(
      user_id,workspace_role,scope_type,scope_state,scope_lga,status,
      granted_by,granted_at,created_at,updated_at
    ) values(
      p_staff_id,v_domain,v_staff_grant.scope_type,
      v_staff_grant.scope_state,v_staff_grant.scope_lga,'active',
      v_actor.user_id,now(),now(),now()
    )
    on conflict(user_id,workspace_role) where status='active' do update set
      scope_type=excluded.scope_type,
      scope_state=excluded.scope_state,
      scope_lga=excluded.scope_lga,
      granted_by=excluded.granted_by,
      granted_at=now(),
      updated_at=now();

    insert into public.staff_permissions(
      staff_id,permission,granted_by,granted_at,revoked_at,is_active
    ) values(
      p_staff_id,v_domain,v_actor.user_id,now(),null,true
    )
    on conflict(staff_id,permission) do update set
      granted_by=excluded.granted_by,
      granted_at=now(),
      revoked_at=null,
      is_active=true;
  else
    update public.workspace_role_assignments
    set status='revoked',
        revoked_by=v_actor.user_id,
        revoked_at=now(),
        updated_at=now()
    where user_id=p_staff_id
      and workspace_role=v_domain
      and status='active'
      and revoked_at is null;
    update public.staff_permissions
    set is_active=false,revoked_at=now()
    where staff_id=p_staff_id
      and public.canonical_staff_domain(permission)=v_domain
      and is_active;
  end if;

  insert into public.admin_audit_log(
    admin_id,action,target_type,target_id,details,created_at
  ) values(
    v_actor.user_id,'staff_work_area_changed','profiles',p_staff_id,
    jsonb_build_object(
      'operation',v_domain,
      'enabled',p_enabled,
      'scope_type',v_staff_grant.scope_type,
      'state',v_staff_grant.scope_state,
      'lga',v_staff_grant.scope_lga,
      'authority_model','workspace_grant'
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
  v_scope text:=case when nullif(btrim(coalesce(p_lga,'')),'') is null
    then 'state' else 'branch' end;
  v_domain text:=public.canonical_staff_domain(p_module);
  v_old_internal_role text;
begin
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null
     or not public.user_has_active_workspace(v_actor.user_id,'creator') then
    raise exception 'Creator authority required';
  end if;
  if not public.creator_has_elevation(p_creator_elevation_id,'staff_authority') then
    raise exception 'Recent Creator authentication required';
  end if;

  select * into v_target
  from public.profiles
  where user_id=p_target_user_id
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  for update;
  if v_target.user_id is null then raise exception 'Target account not found'; end if;
  if v_target.user_id=v_actor.user_id
     or public.user_has_active_workspace(v_target.user_id,'creator') then
    raise exception 'Creator authority cannot be modified here';
  end if;
  if coalesce(v_target.account_kind,'consumer')<>'consumer' then
    raise exception 'An active Personal identity is required';
  end if;
  if p_new_role not in ('admin','staff','user') then
    raise exception 'Invalid team role';
  end if;
  if p_new_role in ('admin','staff') and v_state is null then
    raise exception 'State is required';
  end if;
  if p_new_role='staff' and v_domain is null then
    raise exception 'A valid Staff Operation is required';
  end if;

  v_old_internal_role:=case
    when public.user_has_active_workspace(v_target.user_id,'admin') then 'admin'
    when public.user_has_active_workspace(v_target.user_id,'staff') then 'staff'
    else 'user'
  end;

  update public.workspace_role_assignments
  set status='revoked',
      revoked_by=v_actor.user_id,
      revoked_at=now(),
      updated_at=now()
  where user_id=v_target.user_id
    and status='active'
    and revoked_at is null
    and workspace_role in(
      'admin','staff','property_operations','worker_operations','field_operations',
      'support','finance_operations','security_operations'
    );

  update public.staff_permissions
  set is_active=false,revoked_at=now()
  where staff_id=v_target.user_id
    and is_active;

  if p_new_role='user' then
    delete from public.admin_team_authority
    where admin_user_id=v_target.user_id;
    delete from public.admin_operation_limits
    where admin_user_id=v_target.user_id;
    update public.profiles
    set assigned_state=null,
        assigned_lga=null,
        updated_by=v_actor.user_id,
        updated_at=now()
    where user_id=v_target.user_id;
  else
    update public.profiles
    set assigned_state=v_state,
        assigned_lga=v_lga,
        updated_by=v_actor.user_id,
        updated_at=now()
    where user_id=v_target.user_id;

    insert into public.workspace_role_assignments(
      user_id,workspace_role,scope_type,scope_state,scope_lga,status,
      granted_by,granted_at,created_at,updated_at
    ) values(
      v_target.user_id,p_new_role,v_scope,v_state,v_lga,'active',
      v_actor.user_id,now(),now(),now()
    );

    if p_new_role='admin' then
      insert into public.admin_team_authority(
        admin_user_id,can_manage_staff,created_by,updated_by,created_at,updated_at
      ) values(
        v_target.user_id,false,v_actor.user_id,v_actor.user_id,now(),now()
      )
      on conflict(admin_user_id) do update set
        updated_by=excluded.updated_by,
        updated_at=now();
    else
      delete from public.admin_team_authority
      where admin_user_id=v_target.user_id;
      delete from public.admin_operation_limits
      where admin_user_id=v_target.user_id;

      insert into public.workspace_role_assignments(
        user_id,workspace_role,scope_type,scope_state,scope_lga,status,
        granted_by,granted_at,created_at,updated_at
      ) values(
        v_target.user_id,v_domain,v_scope,v_state,v_lga,'active',
        v_actor.user_id,now(),now(),now()
      );

      insert into public.staff_permissions(
        staff_id,permission,granted_by,granted_at,revoked_at,is_active
      ) values(
        v_target.user_id,v_domain,v_actor.user_id,now(),null,true
      )
      on conflict(staff_id,permission) do update set
        granted_by=excluded.granted_by,
        granted_at=now(),
        revoked_at=null,
        is_active=true;
    end if;
  end if;

  insert into public.audit_logs(
    action,target_type,target_id,details,admin_id,admin_email
  ) values(
    'ROLE_CHANGE','profiles',v_target.user_id,
    jsonb_build_object(
      'old_team_workspace',v_old_internal_role,
      'new_team_workspace',p_new_role,
      'scope_type',case when p_new_role='user' then null else v_scope end,
      'assigned_state',case when p_new_role='user' then null else v_state end,
      'assigned_lga',case when p_new_role='user' then null else v_lga end,
      'staff_operation',case when p_new_role='staff' then v_domain else null end,
      'authority_model','additive_workspace_grant',
      'compatibility_profile_role',v_target.role
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

create or replace function public.creator_reassign_branch(
  p_target_user_id text,
  p_new_state text,
  p_new_lga text,
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
  v_base public.workspace_role_assignments;
  v_state text:=nullif(btrim(coalesce(p_new_state,'')),'');
  v_lga text:=nullif(btrim(coalesce(p_new_lga,'')),'');
  v_scope text:=case when nullif(btrim(coalesce(p_new_lga,'')),'') is null
    then 'state' else 'branch' end;
begin
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null
     or not public.user_has_active_workspace(v_actor.user_id,'creator')
     or not public.creator_has_elevation(p_creator_elevation_id,'staff_authority') then
    raise exception 'Recent Creator authentication required';
  end if;
  if v_state is null then raise exception 'State is required'; end if;

  select * into v_target
  from public.profiles
  where user_id=p_target_user_id
    and not coalesce(deleted,false)
  for update;
  if v_target.user_id is null then raise exception 'Team member not found'; end if;

  select * into v_base
  from public.workspace_role_assignments
  where user_id=v_target.user_id
    and workspace_role in ('admin','staff')
    and status='active'
    and revoked_at is null
  order by case workspace_role when 'admin' then 0 else 1 end
  limit 1;
  if v_base.id is null then
    raise exception 'Active Admin or Staff workspace required';
  end if;

  update public.workspace_role_assignments
  set scope_type=v_scope,
      scope_state=v_state,
      scope_lga=v_lga,
      updated_at=now()
  where user_id=v_target.user_id
    and status='active'
    and revoked_at is null
    and workspace_role in(
      'admin','staff','property_operations','worker_operations','field_operations',
      'support','finance_operations','security_operations'
    );

  update public.profiles
  set assigned_state=v_state,
      assigned_lga=v_lga,
      updated_by=v_actor.user_id,
      updated_at=now()
  where user_id=v_target.user_id;

  insert into public.admin_audit_log(
    admin_id,action,target_type,target_id,details,created_at
  ) values(
    v_actor.user_id,'team_coverage_changed','profiles',v_target.user_id,
    jsonb_build_object(
      'old_scope_type',v_base.scope_type,
      'old_state',v_base.scope_state,
      'old_lga',v_base.scope_lga,
      'new_scope_type',v_scope,
      'new_state',v_state,
      'new_lga',v_lga
    )::text,now()
  );
  return true;
end
$$;

create or replace function public.creator_reassign_branch(
  p_target_user_id text,
  p_new_state text,
  p_new_lga text
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

create or replace function public.get_my_managed_team()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_creator boolean:=false;
  v_admin boolean:=false;
  v_result jsonb;
begin
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null then
    raise exception 'Active team management access required';
  end if;

  v_creator:=public.user_has_active_workspace(v_actor.user_id,'creator');
  v_admin:=public.user_has_active_workspace(v_actor.user_id,'admin');
  if not v_creator and not v_admin then
    raise exception 'Active team management access required';
  end if;

  select coalesce(jsonb_agg(row_data order by row_data->>'full_name'),'[]'::jsonb)
  into v_result
  from (
    select jsonb_build_object(
      'user_id',p.user_id,
      'full_name',p.full_name,
      'username',p.username,
      'email',p.email,
      'avatar_url',p.avatar_url,
      'role',case when base.workspace_role='admin' then 'admin' else 'staff' end,
      'scope_type',base.scope_type,
      'assigned_state',base.scope_state,
      'assigned_lga',case when base.scope_type='branch' then base.scope_lga else null end,
      'can_manage_staff',case when base.workspace_role='admin'
        then coalesce(authority.can_manage_staff,false) else false end,
      'work_areas',coalesce((
        select jsonb_agg(op.workspace_role order by op.workspace_role)
        from public.workspace_role_assignments op
        where op.user_id=p.user_id
          and op.status='active'
          and op.revoked_at is null
          and op.workspace_role in(
            'property_operations','worker_operations','field_operations',
            'support','finance_operations','security_operations'
          )
      ),'[]'::jsonb)
    ) row_data
    from public.profiles p
    join lateral (
      select w.workspace_role,w.scope_type,w.scope_state,w.scope_lga
      from public.workspace_role_assignments w
      where w.user_id=p.user_id
        and w.status='active'
        and w.revoked_at is null
        and w.workspace_role in('admin','staff')
      order by case w.workspace_role when 'admin' then 0 else 1 end
      limit 1
    ) base on true
    left join public.admin_team_authority authority
      on authority.admin_user_id=p.user_id
    where not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false)
      and not coalesce(p.banned,false)
      and (
        v_creator
        or (
          base.workspace_role='staff'
          and public.current_actor_in_scope(
            base.scope_state,
            case when base.scope_type='branch' then base.scope_lga else null end
          )
        )
      )
  ) rows;

  return v_result;
end
$$;

create or replace function public.get_team_eligible_people(
  p_search text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_creator boolean:=false;
  v_admin boolean:=false;
  v_q text:=lower(btrim(coalesce(p_search,'')));
  v_result jsonb;
begin
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null then raise exception 'Active account required'; end if;

  v_creator:=public.user_has_active_workspace(v_actor.user_id,'creator');
  v_admin:=public.user_has_active_workspace(v_actor.user_id,'admin');
  if not v_creator and not v_admin then raise exception 'Team management access required'; end if;
  if v_admin and not coalesce((
    select can_manage_staff
    from public.admin_team_authority
    where admin_user_id=v_actor.user_id
  ),false) then
    raise exception 'Creator has not granted Team management to this Admin';
  end if;

  select coalesce(jsonb_agg(to_jsonb(candidate) order by candidate.full_name),'[]'::jsonb)
  into v_result
  from (
    select p.user_id,p.full_name,p.username,p.email,p.avatar_url,
           p.state,p.local_government,p.city
    from public.profiles p
    where p.user_id<>v_actor.user_id
      and coalesce(p.account_kind,'consumer')='consumer'
      and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false)
      and not coalesce(p.banned,false)
      and not public.user_has_active_workspace(p.user_id,'creator')
      and not public.user_has_active_workspace(p.user_id,'admin')
      and not public.user_has_active_workspace(p.user_id,'staff')
      and (
        v_creator
        or public.current_actor_in_scope(
          p.state,coalesce(nullif(p.local_government,''),nullif(p.city,''))
        )
      )
      and (
        v_q=''
        or lower(coalesce(p.full_name,'')) like '%'||v_q||'%'
        or lower(coalesce(p.username,'')) like '%'||v_q||'%'
        or lower(coalesce(p.email,'')) like '%'||v_q||'%'
      )
    order by p.created_at desc
    limit 30
  ) candidate;

  return v_result;
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
  raise exception 'Internal access is managed with workspace grants, not profile roles';
end
$$;

-- Preserve free additive Service Worker activation. No profile role promotion is required.
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

update public.platform_settings
set is_active=false,
    editable=false,
    description='Retired: Team capacity is configured per Admin and per Operation by Creator.',
    updated_at=now()
where key='admin_staff_limit';

revoke all on function public.sync_legacy_profile_role_assignment() from public,anon,authenticated;
revoke all on function public._team_scope_contains(text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public._count_operation_in_scope(text,text,text,text) from public,anon,authenticated;
revoke all on function public._admin_grant_staff_operation(text,text,text,text,text) from public,anon,authenticated;
revoke all on function public._assert_admin_lga_scope(text) from public,anon,authenticated;
revoke all on function public._admin_dashboard_actor() from public,anon,authenticated;

revoke all on function public.creator_has_elevation(uuid,text) from public,anon,authenticated;
grant execute on function public.creator_has_elevation(uuid,text) to service_role;
revoke all on function public.issue_creator_elevation_from_service(uuid,text,text[],text,text) from public,anon,authenticated;
grant execute on function public.issue_creator_elevation_from_service(uuid,text,text[],text,text) to service_role;

revoke all on function public.get_admin_team_authority(text) from public,anon;
grant execute on function public.get_admin_team_authority(text) to authenticated,service_role;
revoke all on function public.creator_set_admin_authority(text,text,text,text,boolean,jsonb,uuid) from public,anon;
grant execute on function public.creator_set_admin_authority(text,text,text,text,boolean,jsonb,uuid) to authenticated,service_role;
revoke all on function public.admin_appoint_staff(text,text,text,text,text) from public,anon;
grant execute on function public.admin_appoint_staff(text,text,text,text,text) to authenticated,service_role;
revoke all on function public.admin_appoint_staff(text,text) from public,anon;
grant execute on function public.admin_appoint_staff(text,text) to authenticated,service_role;
revoke all on function public.manage_staff_permission(text,text,boolean,uuid) from public,anon;
grant execute on function public.manage_staff_permission(text,text,boolean,uuid) to authenticated,service_role;
revoke all on function public.manage_staff_permission(text,text,boolean) from public,anon;
grant execute on function public.manage_staff_permission(text,text,boolean) to authenticated,service_role;
revoke all on function public.creator_set_team_role(text,text,text,text,text,uuid) from public,anon;
grant execute on function public.creator_set_team_role(text,text,text,text,text,uuid) to authenticated,service_role;
revoke all on function public.creator_set_team_role(text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.creator_set_team_role(text,text,text,text,text) to service_role;
revoke all on function public.creator_reassign_branch(text,text,text,uuid) from public,anon;
grant execute on function public.creator_reassign_branch(text,text,text,uuid) to authenticated,service_role;
revoke all on function public.creator_reassign_branch(text,text,text) from public,anon,authenticated;
grant execute on function public.creator_reassign_branch(text,text,text) to service_role;
revoke all on function public.get_my_managed_team() from public,anon;
grant execute on function public.get_my_managed_team() to authenticated,service_role;
revoke all on function public.get_team_eligible_people(text) from public,anon;
grant execute on function public.get_team_eligible_people(text) to authenticated,service_role;
revoke all on function public.current_staff_has_permission(text) from public,anon;
grant execute on function public.current_staff_has_permission(text) to authenticated,service_role;
revoke all on function public.admin_update_role(text,text) from public,anon;
grant execute on function public.admin_update_role(text,text) to authenticated,service_role;
revoke all on function public.activate_my_worker_workspace() from public,anon;
grant execute on function public.activate_my_worker_workspace() to authenticated,service_role;

commit;
