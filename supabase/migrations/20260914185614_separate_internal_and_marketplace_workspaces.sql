begin;

-- Creator is an internal control identity, not a consumer identity.  Keep
-- Worker, Property Partner and Hotel Team as additive workspaces on a Personal
-- consumer identity, while removing Personal from Creator/Admin/Staff access.
update public.profiles
set account_kind='creator',updated_at=now()
where role='creator'
  and account_kind is distinct from 'creator';

create or replace function public.get_my_workspace_access()
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select jsonb_build_object(
    'identity',jsonb_build_object(
      'user_id',profile.user_id,
      'account_kind',profile.account_kind,
      'compatibility_role',profile.role
    ),
    'personal_workspace',
      profile.account_kind='consumer'
      and profile.role not in('creator','admin','staff','hotel_staff')
      and not coalesce(profile.deleted,false)
      and not coalesce(profile.suspended,false)
      and not coalesce(profile.banned,false),
    'privileged_workspaces',coalesce((
      select jsonb_agg(workspace.item order by workspace.item->>'role')
      from (
        -- Module assignments such as finance_operations belong inside the one
        -- Staff workspace.  They must not render as repeated workspace tiles.
        select jsonb_build_object(
          'role',assignment.workspace_role,
          'scope_type',assignment.scope_type,
          'state',assignment.scope_state,
          'lga',assignment.scope_lga
        ) as item
        from public.workspace_role_assignments assignment
        where assignment.user_id=profile.user_id
          and assignment.status='active'
          and assignment.workspace_role in(
            'worker','property_partner','staff','admin','creator'
          )
        union all
        select jsonb_build_object(
          'role','hotel','scope_type','hotel','state',null,'lga',null
        )
        where exists(
          select 1 from public.hotel_team_members team
          where team.member_user_id=profile.user_id and team.status='active'
        )
      ) workspace
    ),'[]'::jsonb)
  )
  from public.profiles profile
  where profile.auth_id=(select auth.uid())::text;
$$;

revoke all on function public.get_my_workspace_access() from public,anon;
grant execute on function public.get_my_workspace_access()
to authenticated,service_role;

create or replace function public.bootstrap_first_creator_from_service(
  p_auth_user_id uuid,
  p_expected_email text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','auth'
as $$
declare
  v_auth_email text;
  v_auth_confirmed_at timestamptz;
  v_profile public.profiles;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service role required';
  end if;
  if p_auth_user_id is null or nullif(lower(btrim(p_expected_email)),'') is null then
    raise exception 'Exact Auth user ID and email are required';
  end if;
  if length(btrim(coalesce(p_reason,''))) < 12 then
    raise exception 'A specific bootstrap reason is required';
  end if;

  perform pg_advisory_xact_lock(hashtext('wehouse:first-creator-bootstrap'));

  select lower(btrim(auth_user.email)),auth_user.email_confirmed_at
  into v_auth_email,v_auth_confirmed_at
  from auth.users auth_user where auth_user.id=p_auth_user_id;
  if v_auth_email is null then raise exception 'Auth user not found'; end if;
  if v_auth_confirmed_at is null then
    raise exception 'Creator email must be confirmed first';
  end if;
  if v_auth_email<>lower(btrim(p_expected_email)) then
    raise exception 'Auth user ID and expected email do not match';
  end if;

  select * into v_profile from public.profiles profile
  where profile.auth_id=p_auth_user_id::text for update;
  if v_profile.user_id is null then
    raise exception 'Create the exact base identity before Creator bootstrap';
  end if;
  if lower(btrim(v_profile.email))<>v_auth_email then
    raise exception 'Base identity and Auth email do not match';
  end if;
  if coalesce(v_profile.deleted,false) or coalesce(v_profile.suspended,false)
    or coalesce(v_profile.banned,false) then
    raise exception 'Creator bootstrap requires an active base identity';
  end if;
  if exists(
    select 1 from public.workspace_role_assignments assignment
    where assignment.user_id=v_profile.user_id and assignment.status='active'
      and assignment.workspace_role in('worker','property_partner')
  ) then
    raise exception 'Bootstrap a clean internal identity, not a marketplace professional account';
  end if;
  if exists(
    select 1 from public.workspace_role_assignments assignment
    where assignment.workspace_role='creator' and assignment.status='active'
      and assignment.user_id<>v_profile.user_id
  ) then
    raise exception 'A different active Creator is already configured';
  end if;

  update public.profiles
  set role='creator',account_kind='creator',updated_at=now()
  where user_id=v_profile.user_id;

  insert into public.workspace_role_assignments(
    user_id,workspace_role,scope_type,scope_state,scope_lga,status,
    granted_by,granted_at,created_at,updated_at
  ) values(
    v_profile.user_id,'creator','global',null,null,'active',
    null,now(),now(),now()
  ) on conflict(user_id,workspace_role) where status='active'
  do update set scope_type='global',scope_state=null,scope_lga=null,
    updated_at=now();

  insert into public.admin_audit_log(
    admin_id,admin_email,action,target_type,target_id,details,created_at
  ) values(
    v_profile.user_id,v_auth_email,'FIRST_CREATOR_BOOTSTRAPPED',
    'creator_identity',v_profile.user_id,
    jsonb_build_object(
      'auth_user_id',p_auth_user_id,
      'reason',btrim(p_reason),
      'method','service_role_exact_identity'
    )::text,now()
  );

  return jsonb_build_object(
    'success',true,'user_id',v_profile.user_id,'email',v_auth_email,
    'workspace','creator','scope','global','account_kind','creator'
  );
end
$$;

revoke all on function public.bootstrap_first_creator_from_service(
  uuid,text,text
) from public,anon,authenticated;
grant execute on function public.bootstrap_first_creator_from_service(
  uuid,text,text
) to service_role;

comment on function public.get_my_workspace_access() is
  'Returns one Personal consumer workspace, distinct marketplace workspaces, one Staff shell for internal modules, and one Hotel Team shell.';
comment on function public.bootstrap_first_creator_from_service(uuid,text,text) is
  'One-time service-only and audited Creator bootstrap. Creator remains an internal identity and never gains Personal consumer access.';

commit;
