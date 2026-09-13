-- Every WeHouse account is one person with a Personal workspace plus optional workspaces.
-- Legacy profiles.role remains temporarily for compatibility with mature domain RPCs,
-- but it no longer decides whether the person owns a Personal workspace.

update public.profiles
set account_kind='consumer', updated_at=now()
where account_kind is distinct from 'consumer';

alter table public.workspace_role_assignments
  drop constraint if exists workspace_role_assignments_workspace_role_check;
alter table public.workspace_role_assignments
  add constraint workspace_role_assignments_workspace_role_check
  check (workspace_role = any(array['worker','property_partner','staff','admin','creator']::text[]));

insert into public.workspace_role_assignments(
  user_id,workspace_role,scope_type,scope_state,scope_lga,status,granted_by,granted_at,created_at,updated_at
)
select
  p.user_id,
  p.role,
  case when p.role='creator' then 'global'
       when p.role in ('admin','staff') and nullif(btrim(coalesce(p.assigned_state,p.state,'')),'') is not null then 'branch'
       else 'global' end,
  case when p.role in ('admin','staff') then coalesce(nullif(btrim(p.assigned_state),''),nullif(btrim(p.state),'')) else null end,
  case when p.role in ('admin','staff') then coalesce(nullif(btrim(p.assigned_lga),''),nullif(btrim(p.city),'')) else null end,
  'active',null,now(),now(),now()
from public.profiles p
where p.role in ('worker','property_partner','staff','admin','creator')
  and not coalesce(p.deleted,false)
  and not coalesce(p.banned,false)
on conflict (user_id,workspace_role) where status='active' do nothing;

create or replace function public.current_actor_has_personal_workspace()
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select exists(
    select 1 from public.profiles p
    where p.auth_id=(select auth.uid())::text
      and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false)
      and not coalesce(p.banned,false)
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
    'identity',jsonb_build_object('user_id',p.user_id,'account_kind','consumer','compatibility_role',p.role),
    'personal_workspace',not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false),
    'privileged_workspaces',coalesce((
      select jsonb_agg(x order by x->>'role') from (
        select jsonb_build_object('role',a.workspace_role,'scope_type',a.scope_type,'state',a.scope_state,'lga',a.scope_lga) x
        from public.workspace_role_assignments a
        where a.user_id=p.user_id and a.status='active'
        union all
        select jsonb_build_object('role','hotel','scope_type','hotel','state',null,'lga',null)
        where exists(select 1 from public.hotel_team_members tm where tm.member_user_id=p.user_id and tm.status='active')
      ) roles
    ),'[]'::jsonb)
  ) from public.profiles p
  where p.auth_id=(select auth.uid())::text;
$$;

create or replace function public.create_my_profile(p_email text,p_role text default 'user')
returns public.profiles
language plpgsql
security definer
set search_path to 'pg_catalog','public','extensions'
as $$
declare
  v_profile public.profiles;
  v_auth_id text := (select auth.uid())::text;
  v_email text := lower(trim(coalesce((select auth.jwt()->>'email'),p_email)));
  v_user_id text;
  v_username text;
begin
  perform p_role;
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  select * into v_profile from public.profiles where auth_id=v_auth_id;
  if v_profile.user_id is not null then return v_profile; end if;
  if v_email is null or v_email='' then raise exception 'Authenticated email is required'; end if;
  if exists(select 1 from public.profiles p where lower(p.email)=v_email and p.auth_id<>v_auth_id) then
    raise exception 'This email is already linked to another WeHouse identity. Contact WeHouse Support.';
  end if;
  v_user_id := 'WHU-' || lpad(nextval('public.wehouse_user_id_seq')::text,8,'0');
  v_username := regexp_replace(split_part(v_email,'@',1),'[^a-z0-9_]','','g');
  if length(v_username)<3 then v_username:='member'; end if;
  v_username := left(v_username,15) || substr(v_user_id,length(v_user_id)-4);
  insert into public.profiles(auth_id,email,username,role,user_id,profile_complete,worker_status,account_kind)
  values(v_auth_id,v_email,v_username,'user',v_user_id,false,null,'consumer')
  returning * into v_profile;
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
  select * into v_profile from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)
  for update;
  if v_profile.user_id is null then raise exception 'Active Personal account required'; end if;
  if v_profile.role not in ('user','worker') then
    raise exception 'This account already has internal or supply authority. Worker activation requires a separate reviewed grant.';
  end if;
  insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status,granted_at,created_at,updated_at)
  values(v_profile.user_id,'worker','global','active',now(),now(),now())
  on conflict (user_id,workspace_role) where status='active' do nothing;
  update public.profiles set role='worker',account_kind='consumer',worker_status=coalesce(worker_status,'pending'),updated_at=now()
  where user_id=v_profile.user_id;
  return jsonb_build_object('success',true,'workspace','worker');
end;
$$;

create or replace function public.activate_my_property_partner_workspace()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_profile public.profiles; v_partner public.property_partners; v_code text;
begin
  select * into v_profile from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)
  for update;
  if v_profile.user_id is null then raise exception 'Active Personal account required'; end if;
  if v_profile.role not in ('user','property_partner') then
    raise exception 'This account already has internal or professional authority. Property Partner activation requires a separate reviewed grant.';
  end if;
  insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status,granted_at,created_at,updated_at)
  values(v_profile.user_id,'property_partner','global','active',now(),now(),now())
  on conflict (user_id,workspace_role) where status='active' do nothing;
  update public.profiles set role='property_partner',account_kind='consumer',updated_at=now() where user_id=v_profile.user_id;
  select * into v_partner from public.property_partners where profile_id=v_profile.user_id;
  if v_partner.profile_id is null then
    v_code:='WHP-'||replace(v_profile.user_id,'WHU-','')||'-'||upper(substr(md5(v_profile.user_id||clock_timestamp()::text),1,4));
    insert into public.property_partners(profile_id,partner_code,status,commission_rate,total_earnings,total_paid_out,properties_count,created_at,updated_at)
    values(v_profile.user_id,v_code,'pending_verification',0,0,0,0,now(),now()) on conflict(profile_id) do nothing;
  end if;
  return jsonb_build_object('success',true,'workspace','property_partner');
end;
$$;

revoke all on function public.activate_my_worker_workspace() from public,anon;
revoke all on function public.activate_my_property_partner_workspace() from public,anon;
grant execute on function public.activate_my_worker_workspace() to authenticated,service_role;
grant execute on function public.activate_my_property_partner_workspace() to authenticated,service_role;

comment on function public.get_my_workspace_access()
is 'Returns one Personal workspace plus active additive workspaces. Compatibility profile.role is not the person identity.';
