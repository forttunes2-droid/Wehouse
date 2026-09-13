-- A WeHouse account is one Personal identity. Worker and Property Partner are
-- independent capability grants, not mutually exclusive account types.

drop trigger if exists one_marketplace_workspace on public.workspace_role_assignments;

alter table public.workspace_role_assignments
  drop constraint if exists workspace_role_assignments_workspace_role_check;
alter table public.workspace_role_assignments
  add constraint workspace_role_assignments_workspace_role_check
  check(workspace_role in ('worker','property_partner','staff','admin','creator'));

update public.profiles
set account_kind='consumer',updated_at=now()
where account_kind is distinct from 'consumer';

insert into public.workspace_role_assignments(
  user_id,workspace_role,scope_type,scope_state,scope_lga,status,granted_by,
  granted_at,created_at,updated_at
)
select
  profile.user_id,
  profile.role,
  case
    when profile.role='creator' then 'global'
    when profile.role in ('admin','staff') then 'branch'
    else 'global'
  end,
  case when profile.role in ('admin','staff') then profile.assigned_state else null end,
  case when profile.role in ('admin','staff') then profile.assigned_lga else null end,
  'active',null,now(),now(),now()
from public.profiles profile
where profile.role in ('worker','property_partner','staff','admin','creator')
  and not coalesce(profile.deleted,false)
  and not coalesce(profile.banned,false)
on conflict(user_id,workspace_role) where status='active' do nothing;

create or replace function public.user_has_active_workspace(
  p_user_id text,
  p_workspace_role text
)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select exists(
    select 1
    from public.profiles profile
    where profile.user_id=p_user_id
      and not coalesce(profile.deleted,false)
      and not coalesce(profile.suspended,false)
      and not coalesce(profile.banned,false)
      and (
        profile.role=p_workspace_role
        or exists(
          select 1
          from public.workspace_role_assignments assignment
          where assignment.user_id=profile.user_id
            and assignment.workspace_role=p_workspace_role
            and assignment.status='active'
        )
      )
  );
$$;

create or replace function public.current_actor_has_workspace_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select public.user_has_active_workspace(public.current_profile_user_id(),p_role);
$$;

create or replace function public.current_actor_has_workspace(
  p_workspace text,
  p_state text default null
)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select exists(
    select 1
    from public.profiles profile
    where profile.auth_id=(select auth.uid())::text
      and not coalesce(profile.deleted,false)
      and not coalesce(profile.suspended,false)
      and not coalesce(profile.banned,false)
      and (
        profile.role=p_workspace
        or exists(
          select 1
          from public.workspace_role_assignments assignment
          where assignment.user_id=profile.user_id
            and assignment.workspace_role=p_workspace
            and assignment.status='active'
            and (
              p_state is null
              or assignment.scope_type='global'
              or public.wehouse_state_key(assignment.scope_state)=public.wehouse_state_key(p_state)
            )
        )
      )
  );
$$;

revoke all on function public.user_has_active_workspace(text,text) from public,anon;
revoke all on function public.current_actor_has_workspace_role(text) from public,anon;
revoke all on function public.current_actor_has_workspace(text,text) from public,anon;
grant execute on function public.user_has_active_workspace(text,text) to authenticated,service_role;
grant execute on function public.current_actor_has_workspace_role(text) to authenticated,service_role;
grant execute on function public.current_actor_has_workspace(text,text) to authenticated,service_role;

create or replace function public.current_actor_has_personal_workspace()
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select exists(
    select 1
    from public.profiles profile
    where profile.auth_id=(select auth.uid())::text
      and profile.account_kind='consumer'
      and not coalesce(profile.deleted,false)
      and not coalesce(profile.suspended,false)
      and not coalesce(profile.banned,false)
  );
$$;

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
      'account_kind','consumer',
      'compatibility_role',profile.role
    ),
    'personal_workspace',
      not coalesce(profile.deleted,false)
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
        where assignment.user_id=profile.user_id and assignment.status='active'
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

create or replace function public.create_my_profile(
  p_email text,
  p_role text default 'user'
)
returns public.profiles
language plpgsql
security definer
set search_path to 'pg_catalog','public','extensions'
as $$
declare
  v_profile public.profiles;
  v_auth_id text:=(select auth.uid())::text;
  v_email text:=lower(trim(coalesce((select auth.jwt()->>'email'),p_email)));
  v_requested_workspace text:=case when p_role in ('worker','property_partner') then p_role else 'user' end;
  v_user_id text;
  v_username text;
  v_partner_code text;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if p_role not in ('user','worker','property_partner') then raise exception 'Invalid initial workspace'; end if;
  select * into v_profile from public.profiles where auth_id=v_auth_id;
  if v_profile.user_id is not null then return v_profile; end if;
  if v_email is null or v_email='' then raise exception 'Authenticated email is required'; end if;
  if exists(
    select 1 from public.profiles profile
    where lower(profile.email)=v_email and profile.auth_id<>v_auth_id
  ) then
    raise exception 'This email is already linked to another WeHouse identity. Contact WeHouse Support.';
  end if;

  v_user_id:='WHU-'||lpad(nextval('public.wehouse_user_id_seq')::text,8,'0');
  v_username:=regexp_replace(split_part(v_email,'@',1),'[^a-z0-9_]','','g');
  if length(v_username)<3 then v_username:='member'; end if;
  v_username:=left(v_username,15)||substr(v_user_id,length(v_user_id)-4);

  insert into public.profiles(
    auth_id,email,username,role,user_id,profile_complete,worker_status,account_kind
  ) values(
    v_auth_id,v_email,v_username,v_requested_workspace,v_user_id,false,
    case when v_requested_workspace='worker' then 'pending' else null end,
    'consumer'
  ) returning * into v_profile;

  if v_requested_workspace in ('worker','property_partner') then
    insert into public.workspace_role_assignments(
      user_id,workspace_role,scope_type,status,granted_at,created_at,updated_at
    ) values(
      v_profile.user_id,v_requested_workspace,'global','active',now(),now(),now()
    ) on conflict(user_id,workspace_role) where status='active' do nothing;
  end if;

  if v_requested_workspace='property_partner' then
    v_partner_code:='WHP-'||replace(v_profile.user_id,'WHU-','')||'-'||
      upper(substr(md5(v_profile.user_id||clock_timestamp()::text),1,4));
    insert into public.property_partners(
      profile_id,partner_code,status,commission_rate,total_earnings,
      total_paid_out,properties_count,created_at,updated_at
    ) values(
      v_profile.user_id,v_partner_code,'pending_verification',0,0,0,0,now(),now()
    ) on conflict(profile_id) do nothing;
  end if;
  return v_profile;
end;
$$;

create or replace function public.activate_my_worker_workspace()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_profile public.profiles;
begin
  select * into v_profile
  from public.profiles
  where auth_id=(select auth.uid())::text
    and account_kind='consumer'
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  for update;
  if v_profile.user_id is null then raise exception 'Active Personal account required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_profile.user_id,1));
  insert into public.workspace_role_assignments(
    user_id,workspace_role,scope_type,status,granted_at,created_at,updated_at
  ) values(v_profile.user_id,'worker','global','active',now(),now(),now())
  on conflict(user_id,workspace_role) where status='active' do nothing;
  update public.profiles
  set role=case when role='user' then 'worker' else role end,
      worker_status=coalesce(worker_status,'pending'),account_kind='consumer',updated_at=now()
  where user_id=v_profile.user_id;
  return jsonb_build_object('success',true,'workspace','worker','free',true);
end;
$$;

create or replace function public.activate_my_property_partner_workspace()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_profile public.profiles;
  v_partner_code text;
begin
  select * into v_profile
  from public.profiles
  where auth_id=(select auth.uid())::text
    and account_kind='consumer'
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  for update;
  if v_profile.user_id is null then raise exception 'Active Personal account required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_profile.user_id,2));
  insert into public.workspace_role_assignments(
    user_id,workspace_role,scope_type,status,granted_at,created_at,updated_at
  ) values(v_profile.user_id,'property_partner','global','active',now(),now(),now())
  on conflict(user_id,workspace_role) where status='active' do nothing;
  update public.profiles
  set role=case when role='user' then 'property_partner' else role end,
      account_kind='consumer',updated_at=now()
  where user_id=v_profile.user_id;
  v_partner_code:='WHP-'||replace(v_profile.user_id,'WHU-','')||'-'||
    upper(substr(md5(v_profile.user_id||clock_timestamp()::text),1,4));
  insert into public.property_partners(
    profile_id,partner_code,status,commission_rate,total_earnings,
    total_paid_out,properties_count,created_at,updated_at
  ) values(
    v_profile.user_id,v_partner_code,'pending_verification',0,0,0,0,now(),now()
  ) on conflict(profile_id) do nothing;
  return jsonb_build_object('success',true,'workspace','property_partner');
end;
$$;

revoke all on function public.current_actor_has_personal_workspace() from public,anon;
revoke all on function public.get_my_workspace_access() from public,anon;
revoke all on function public.activate_my_worker_workspace() from public,anon;
revoke all on function public.activate_my_property_partner_workspace() from public,anon;
grant execute on function public.current_actor_has_personal_workspace() to authenticated,service_role;
grant execute on function public.get_my_workspace_access() to authenticated,service_role;
grant execute on function public.activate_my_worker_workspace() to authenticated,service_role;
grant execute on function public.activate_my_property_partner_workspace() to authenticated,service_role;

create or replace function public._guard_worker_profile_state()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if not public.user_has_active_workspace(new.user_id,'worker') then return new; end if;
  if new.worker_status='approved_for_verification' then
    new.worker_status:='profile_under_review';
  elsif new.worker_status='approved' then
    new.worker_status:='pending';
  elsif new.worker_status='declined' then
    new.worker_status:='rejected';
  end if;
  new.worker_verified:=new.worker_status='verified';
  if new.worker_status<>'verified'
     or coalesce(new.deleted,false)
     or coalesce(new.suspended,false)
     or coalesce(new.banned,false) then
    new.available:=false;
  end if;
  return new;
end;
$$;

create or replace function public.worker_professional_profile_ready(p_worker_id text)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select exists(
    select 1 from public.profiles profile
    where profile.user_id=p_worker_id
      and public.user_has_active_workspace(profile.user_id,'worker')
      and coalesce(profile.profile_complete,false)=true
      and nullif(btrim(coalesce(profile.full_name,'')),'') is not null
      and nullif(btrim(coalesce(profile.worker_occupation,'')),'') is not null
      and jsonb_typeof(coalesce(profile.worker_skills,'[]'::jsonb))='array'
      and jsonb_array_length(coalesce(profile.worker_skills,'[]'::jsonb))>0
      and nullif(btrim(coalesce(profile.state,'')),'') is not null
      and nullif(btrim(coalesce(profile.local_government,profile.city,'')),'') is not null
      and not coalesce(profile.deleted,false)
      and not coalesce(profile.suspended,false)
      and not coalesce(profile.banned,false)
      and exists(
        select 1 from public.worker_service_coverage coverage
        where coverage.worker_id=profile.user_id
          and nullif(btrim(coalesce(coverage.state,'')),'') is not null
          and nullif(btrim(coalesce(coverage.lga,'')),'') is not null
      )
  );
$$;

-- Recompile the existing domain RPCs so their authorization checks consume the
-- additive grants. The replacements are intentionally narrow and the function
-- list is fixed so unrelated role/scoping code cannot be rewritten.
do $rewrite$
declare
  v_function record;
  v_definition text;
begin
  for v_function in
    select procedure.oid,procedure.proname
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='public'
      and procedure.proname=any(array[
        '_set_account_suspension','_worker_review_trust_payload',
        'accept_current_worker_pro_terms','admin_get_all_workers',
        'admin_get_my_branch_stats','admin_get_worker_review_trust_status',
        'admin_review_my_branch_worker','complete_my_worker_identity_check',
        'confirm_worker_booking_payment','create_my_property_inspection_batch',
        'create_my_property_inspection_batch_v2','create_my_property_inspection_batch_v3',
        'create_my_property_inspection_request','create_my_property_inspection_request_v2',
        'create_worker_booking_payment','create_worker_pro_web_payment',
        'creator_get_platform_analytics','creator_review_worker',
        'current_oversight_can_review_worker','current_staff_can_review_worker',
        'get_my_property_partner_finance','get_my_worker_activation',
        'get_my_worker_identity_check','get_my_worker_identity_reference','get_my_worker_pro',
        'get_or_create_my_property_partner','get_public_workers',
        'get_worker_marketplace_trust','post_property_from_inspection',
        'prepare_property_listing','request_my_property_partner_withdrawal',
        'request_worker_withdrawal','review_my_staff_worker_v2',
        'save_my_worker_professional_evidence','set_my_worker_availability',
        'set_my_worker_work_post_hidden','start_my_worker_test',
        'submit_my_property_access_evidence','submit_my_worker_test',
        'submit_my_worker_verification','worker_accept_booking','worker_mark_complete',
        'worker_start_job'
      ]::text[])
  loop
    v_definition:=pg_get_functiondef(v_function.oid);

    v_definition:=replace(v_definition,'p.role=''worker''',
      'public.user_has_active_workspace(p.user_id,''worker'')');
    v_definition:=replace(v_definition,'p.role = ''worker''',
      'public.user_has_active_workspace(p.user_id,''worker'')');
    v_definition:=replace(v_definition,'profile.role=''worker''',
      'public.user_has_active_workspace(profile.user_id,''worker'')');
    v_definition:=replace(v_definition,'profile.role = ''worker''',
      'public.user_has_active_workspace(profile.user_id,''worker'')');
    v_definition:=replace(v_definition,'w.role<>''worker''',
      'not public.user_has_active_workspace(w.user_id,''worker'')');
    v_definition:=replace(v_definition,'w.role <> ''worker''',
      'not public.user_has_active_workspace(w.user_id,''worker'')');
    v_definition:=replace(v_definition,'v_profile.role<>''worker''',
      'not public.user_has_active_workspace(v_profile.user_id,''worker'')');
    v_definition:=replace(v_definition,'v_profile.role <> ''worker''',
      'not public.user_has_active_workspace(v_profile.user_id,''worker'')');
    v_definition:=replace(v_definition,'v_profile.role=''worker''',
      'public.user_has_active_workspace(v_profile.user_id,''worker'')');
    v_definition:=replace(v_definition,'v_profile.role = ''worker''',
      'public.user_has_active_workspace(v_profile.user_id,''worker'')');
    v_definition:=replace(v_definition,' and role=''worker''',
      ' and public.user_has_active_workspace(user_id,''worker'')');
    v_definition:=replace(v_definition,' AND role=''worker''',
      ' AND public.user_has_active_workspace(user_id,''worker'')');
    v_definition:=replace(v_definition,' where role=''worker''',
      ' where public.user_has_active_workspace(user_id,''worker'')');
    v_definition:=replace(v_definition,' WHERE role=''worker''',
      ' WHERE public.user_has_active_workspace(user_id,''worker'')');

    v_definition:=replace(v_definition,'p.role=''property_partner''',
      'public.user_has_active_workspace(p.user_id,''property_partner'')');
    v_definition:=replace(v_definition,'p.role = ''property_partner''',
      'public.user_has_active_workspace(p.user_id,''property_partner'')');
    v_definition:=replace(v_definition,'v_profile.role<>''property_partner''',
      'not public.user_has_active_workspace(v_profile.user_id,''property_partner'')');
    v_definition:=replace(v_definition,'v_profile.role <> ''property_partner''',
      'not public.user_has_active_workspace(v_profile.user_id,''property_partner'')');
    v_definition:=replace(v_definition,'v_profile.role=''property_partner''',
      'public.user_has_active_workspace(v_profile.user_id,''property_partner'')');
    v_definition:=replace(v_definition,'v_profile.role = ''property_partner''',
      'public.user_has_active_workspace(v_profile.user_id,''property_partner'')');
    v_definition:=replace(v_definition,' and role=''property_partner''',
      ' and public.user_has_active_workspace(user_id,''property_partner'')');
    v_definition:=replace(v_definition,' AND role=''property_partner''',
      ' AND public.user_has_active_workspace(user_id,''property_partner'')');
    v_definition:=replace(v_definition,' where role=''property_partner''',
      ' where public.user_has_active_workspace(user_id,''property_partner'')');
    v_definition:=replace(v_definition,' WHERE role=''property_partner''',
      ' WHERE public.user_has_active_workspace(user_id,''property_partner'')');

    execute v_definition;
  end loop;
end
$rewrite$;

-- update_my_profile has two variable-based Worker checks which are clearer and
-- safer to replace after the general recompilation above.
do $profile_rewrite$
declare v_function oid; v_definition text;
begin
  select procedure.oid into v_function
  from pg_proc procedure join pg_namespace namespace on namespace.oid=procedure.pronamespace
  where namespace.nspname='public' and procedure.proname='update_my_profile'
  limit 1;
  if v_function is not null then
    v_definition:=pg_get_functiondef(v_function);
    v_definition:=replace(v_definition,
      'v_profile.role<>''worker''',
      'not public.user_has_active_workspace(v_profile.user_id,''worker'')');
    v_definition:=replace(v_definition,
      'v_profile.role=''worker''',
      'public.user_has_active_workspace(v_profile.user_id,''worker'')');
    execute v_definition;
  end if;
end
$profile_rewrite$;

drop policy if exists property_partners_owner_insert on public.property_partners;
create policy property_partners_owner_insert on public.property_partners
for insert to authenticated
with check(
  profile_id=public.current_profile_user_id()
  and public.current_actor_has_workspace_role('property_partner')
);

drop policy if exists worker_coverage_public_read on public.worker_service_coverage;
create policy worker_coverage_public_read on public.worker_service_coverage
for select to authenticated
using(
  public.user_has_active_workspace(worker_id,'worker')
  and exists(
    select 1 from public.profiles profile
    where profile.user_id=worker_service_coverage.worker_id
      and profile.worker_status='verified'
      and not coalesce(profile.deleted,false)
      and not coalesce(profile.suspended,false)
      and not coalesce(profile.banned,false)
  )
);

drop policy if exists worker_services_verified_public_select on public.worker_services;
create policy worker_services_verified_public_select on public.worker_services
for select to authenticated
using(
  public.user_has_active_workspace(worker_id,'worker')
  and exists(
    select 1 from public.profiles worker
    where worker.user_id=worker_services.worker_id
      and worker.worker_status='verified'
      and coalesce(worker.worker_verified,false)
      and coalesce(worker.available,false)
      and not coalesce(worker.deleted,false)
      and not coalesce(worker.suspended,false)
      and not coalesce(worker.banned,false)
  )
);

drop policy if exists worker_showcase_select on public.worker_showcase_posts;
create policy worker_showcase_select on public.worker_showcase_posts
for select to authenticated
using(
  deleted_at is null
  and (
    worker_id=public.current_profile_user_id()
    or (
      hidden_at is null
      and kind='work_post'
      and public.user_has_active_workspace(worker_id,'worker')
      and exists(
        select 1 from public.profiles worker
        where worker.user_id=worker_showcase_posts.worker_id
          and worker.worker_status='verified'
          and coalesce(worker.worker_verified,false)
          and not coalesce(worker.deleted,false)
          and not coalesce(worker.suspended,false)
          and not coalesce(worker.banned,false)
      )
    )
  )
);

comment on function public.get_my_workspace_access()
is 'Returns one Personal identity plus independent active Worker, Property Partner and privileged workspace grants.';
