-- Canonical personal identity, additive workspaces, Creator elevation and
-- immutable Creator policy registry.
--
-- This migration is additive and compatible with production main e79b2dc2. It
-- deliberately does not delete legacy profile.role until every caller uses
-- current_actor_has_workspace(). Public signup always creates Personal first.

update public.profiles
set account_kind='consumer', updated_at=now()
where account_kind is distinct from 'consumer';

alter table public.workspace_role_assignments
  drop constraint if exists workspace_role_assignments_workspace_role_check;
alter table public.workspace_role_assignments
  add constraint workspace_role_assignments_workspace_role_check
  check (workspace_role=any(array[
    'worker','property_partner','staff','admin','creator',
    'property_operations','field_operations','worker_operations',
    'finance_operations','security_operations','support'
  ]::text[]));

insert into public.workspace_role_assignments(
  user_id,workspace_role,scope_type,scope_state,scope_lga,status,
  granted_by,granted_at,created_at,updated_at
)
select p.user_id,p.role,
  case when p.role='creator' then 'global'
       when p.role in ('staff','admin') then 'state'
       else 'global' end,
  case when p.role in ('staff','admin') then
    coalesce(nullif(btrim(p.assigned_state),''),nullif(btrim(p.state),''))
  end,
  null,'active',null,now(),now(),now()
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
  )
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
  with actor as (
    select p.user_id,p.role
    from public.profiles p
    where p.auth_id=(select auth.uid())::text
      and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false)
      and not coalesce(p.banned,false)
    limit 1
  )
  select exists(
    select 1 from actor a
    where
      (p_workspace='personal')
      or exists(
        select 1
        from public.workspace_role_assignments w
        where w.user_id=a.user_id
          and w.workspace_role=p_workspace
          and w.status='active'
          and (
            p_state is null
            or w.scope_type='global'
            or lower(btrim(coalesce(w.scope_state,'')))=lower(btrim(p_state))
          )
      )
  )
$$;

create or replace function public.get_my_workspace_access()
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  with actor as (
    select p.* from public.profiles p
    where p.auth_id=(select auth.uid())::text
  ), access as (
    select 'personal'::text role,'global'::text scope_type,
      null::text state,null::text lga from actor
    union
    select w.workspace_role,w.scope_type,w.scope_state,w.scope_lga
    from public.workspace_role_assignments w join actor a on a.user_id=w.user_id
    where w.status='active'
    union
    select 'hotel'::text,'hotel'::text,tm.hotel_id::text,null::text
    from public.hotel_team_members tm join actor a on a.user_id=tm.member_user_id
    where tm.status='active'
  )
  select jsonb_build_object(
    'identity',jsonb_build_object(
      'user_id',a.user_id,'account_kind','consumer','compatibility_role',a.role
    ),
    'personal_workspace',not coalesce(a.deleted,false)
      and not coalesce(a.suspended,false) and not coalesce(a.banned,false),
    'workspaces',coalesce((select jsonb_agg(to_jsonb(x) order by x.role) from access x),'[]'::jsonb),
    'privileged_workspaces',coalesce((select jsonb_agg(to_jsonb(x) order by x.role) from access x where x.role<>'personal'),'[]'::jsonb)
  ) from actor a
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
  v_user_id text;
  v_username text;
begin
  perform p_role; -- accepted only for backward-compatible clients; never trusted.
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;

  select * into v_profile from public.profiles where auth_id=v_auth_id;
  if v_profile.user_id is not null then return v_profile; end if;
  if coalesce(v_email,'')='' then raise exception 'Authenticated email is required'; end if;
  if exists(
    select 1 from public.profiles p
    where lower(p.email)=v_email and p.auth_id<>v_auth_id
  ) then
    raise exception 'This email is already linked to another WeHouse identity';
  end if;

  v_user_id:='WHU-'||lpad(nextval('public.wehouse_user_id_seq')::text,8,'0');
  v_username:=regexp_replace(split_part(v_email,'@',1),'[^a-z0-9_]','','g');
  if length(v_username)<3 then v_username:='member'; end if;
  v_username:=left(v_username,15)||substr(v_user_id,length(v_user_id)-4);

  insert into public.profiles(
    auth_id,email,username,role,user_id,profile_complete,worker_status,account_kind
  ) values(
    v_auth_id,v_email,v_username,'user',v_user_id,false,null,'consumer'
  ) returning * into v_profile;
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
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  for update;
  if v_profile.user_id is null then raise exception 'Active Personal account required'; end if;
  insert into public.workspace_role_assignments(
    user_id,workspace_role,scope_type,status,granted_at,created_at,updated_at
  ) values(
    v_profile.user_id,'worker','global','active',now(),now(),now()
  ) on conflict (user_id,workspace_role) where status='active' do nothing;
  update public.profiles
  set account_kind='consumer',
      worker_status=coalesce(worker_status,'pending'),
      updated_at=now()
  where user_id=v_profile.user_id;
  return jsonb_build_object('success',true,'workspace','worker');
end
$$;

create or replace function public.activate_my_property_partner_workspace()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_profile public.profiles;
  v_code text;
begin
  select * into v_profile
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  for update;
  if v_profile.user_id is null then raise exception 'Active Personal account required'; end if;
  insert into public.workspace_role_assignments(
    user_id,workspace_role,scope_type,status,granted_at,created_at,updated_at
  ) values(
    v_profile.user_id,'property_partner','global','active',now(),now(),now()
  ) on conflict (user_id,workspace_role) where status='active' do nothing;
  update public.profiles
  set account_kind='consumer',updated_at=now()
  where user_id=v_profile.user_id;

  if not exists(
    select 1 from public.property_partners pp
    where pp.profile_id=v_profile.user_id
  ) then
    v_code:='WHP-'||replace(v_profile.user_id,'WHU-','')||'-'
      ||upper(substr(md5(v_profile.user_id||clock_timestamp()::text),1,4));
    insert into public.property_partners(
      profile_id,partner_code,status,commission_rate,total_earnings,
      total_paid_out,properties_count,created_at,updated_at
    ) values(
      v_profile.user_id,v_code,'pending_verification',0,0,0,0,now(),now()
    ) on conflict(profile_id) do nothing;
  end if;
  return jsonb_build_object('success',true,'workspace','property_partner');
end
$$;

revoke all on function public.current_actor_has_personal_workspace() from public,anon;
revoke all on function public.current_actor_has_workspace(text,text) from public,anon;
revoke all on function public.get_my_workspace_access() from public,anon;
revoke all on function public.create_my_profile(text,text) from public,anon;
revoke all on function public.activate_my_worker_workspace() from public,anon;
revoke all on function public.activate_my_property_partner_workspace() from public,anon;
grant execute on function public.current_actor_has_personal_workspace() to authenticated,service_role;
grant execute on function public.current_actor_has_workspace(text,text) to authenticated,service_role;
grant execute on function public.get_my_workspace_access() to authenticated,service_role;
grant execute on function public.create_my_profile(text,text) to authenticated,service_role;
grant execute on function public.activate_my_worker_workspace() to authenticated,service_role;
grant execute on function public.activate_my_property_partner_workspace() to authenticated,service_role;

-- Creator is bootstrapped in profiles plus workspace assignments. Elevation is
-- issued only by the creator-step-up Edge Function after Auth password and any
-- enrolled auth.mfa_factors have been verified.
create table if not exists public.creator_elevation_grants(
  creator_elevation_id uuid primary key default gen_random_uuid(),
  creator_user_id text not null references public.profiles(user_id) on delete cascade,
  auth_user_id uuid not null,
  auth_session_id text not null,
  action_classes text[] not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  verification_method text not null
    check(verification_method in ('password','password_mfa')),
  issued_ip_hash text,
  created_at timestamptz not null default now(),
  check(expires_at>issued_at and expires_at<=issued_at+interval '10 minutes')
);

create index if not exists creator_elevation_active_session_idx
  on public.creator_elevation_grants(auth_user_id,auth_session_id,expires_at)
  where revoked_at is null;

alter table public.creator_elevation_grants enable row level security;
revoke all on table public.creator_elevation_grants from public,anon,authenticated;
grant select,insert,update,delete on table public.creator_elevation_grants to service_role;

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
    and p.role='creator'
    and exists(
      select 1 from public.workspace_role_assignments w
      where w.user_id=p.user_id and w.workspace_role='creator'
        and w.status='active' and w.scope_type='global'
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

create or replace function public.creator_has_elevation(
  p_creator_elevation_id uuid,
  p_action_class text
)
returns boolean
language sql
stable
security definer
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
      and p.role='creator'
      and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false)
      and not coalesce(p.banned,false)
      and (
        p_action_class=any(g.action_classes)
        or 'all_sensitive'=any(g.action_classes)
      )
  )
$$;

create or replace function public.reauthenticate_creator_action(
  p_creator_elevation_id uuid,
  p_action_class text
)
returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  if not public.creator_has_elevation(
    p_creator_elevation_id,p_action_class
  ) then
    raise exception 'Recent Creator authentication required';
  end if;
  return true;
end
$$;

revoke all on function public.issue_creator_elevation_from_service(
  uuid,text,text[],text,text
) from public,anon,authenticated;
grant execute on function public.issue_creator_elevation_from_service(
  uuid,text,text[],text,text
) to service_role;
revoke all on function public.creator_has_elevation(uuid,text) from public,anon;
revoke all on function public.reauthenticate_creator_action(uuid,text) from public,anon;
grant execute on function public.creator_has_elevation(uuid,text) to authenticated,service_role;
grant execute on function public.reauthenticate_creator_action(uuid,text) to authenticated,service_role;

create or replace function public.creator_auth_verify_v3(
  p_auth_id text,p_password text
)
returns boolean language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$ begin raise exception 'Legacy Creator password authentication is disabled'; end $$;
create or replace function public.creator_auth_set_v3(
  p_auth_id text,p_password text
)
returns boolean language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$ begin raise exception 'Legacy Creator password authentication is disabled'; end $$;
create or replace function public.creator_auth_status_v3(p_auth_id text)
returns jsonb language sql security definer
set search_path to 'pg_catalog','public'
as $$ select jsonb_build_object('enabled',false,'method','supabase_auth_step_up') $$;
create or replace function public.creator_action_password_verify(p_password text)
returns boolean language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$ begin raise exception 'Use Creator server step-up'; end $$;
create or replace function public.creator_action_password_set(
  p_new_password text,p_current_password text default null
)
returns boolean language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$ begin raise exception 'Use Supabase account security settings'; end $$;
create or replace function public.creator_action_password_status()
returns jsonb language sql security definer
set search_path to 'pg_catalog','public'
as $$ select jsonb_build_object('enabled',false,'method','supabase_auth_step_up') $$;
revoke all on function public.creator_auth_verify_v3(text,text) from public,anon,authenticated;
revoke all on function public.creator_auth_set_v3(text,text) from public,anon,authenticated;
revoke all on function public.creator_auth_status_v3(text) from public,anon,authenticated;
revoke all on function public.creator_action_password_verify(text) from public,anon,authenticated;
revoke all on function public.creator_action_password_set(text,text) from public,anon,authenticated;
revoke all on function public.creator_action_password_status() from public,anon,authenticated;
alter table public.profiles drop column if exists creator_auth_password;
alter table public.profiles drop column if exists creator_auth_enabled;

-- Versioned Creator policy registry.
create table if not exists public.creator_policy_versions(
  policy_version_id uuid primary key default gen_random_uuid(),
  policy_key text not null,
  scope_type text not null default 'global'
    check(scope_type in ('global','country','state','product','hotel','worker_category')),
  scope_key text not null default '*',
  version integer not null check(version>0),
  value jsonb not null,
  value_schema jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check(status in ('draft','scheduled','active','retired')),
  effective_from timestamptz not null,
  effective_until timestamptz,
  public_disclosure boolean not null default false,
  disclosure_text text,
  legal_review_state text not null default 'pending'
    check(legal_review_state in ('pending','reviewed','not_required')),
  reason text not null,
  created_by text references public.profiles(user_id),
  approved_by text references public.profiles(user_id),
  supersedes uuid references public.creator_policy_versions(policy_version_id),
  checksum text not null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  retired_at timestamptz,
  unique(policy_key,scope_type,scope_key,version),
  check(effective_until is null or effective_until>effective_from),
  check(status='draft' or approved_by is not null or created_by is null)
);

create unique index if not exists creator_policy_one_active_scope
  on public.creator_policy_versions(policy_key,scope_type,scope_key)
  where status='active';
create unique index if not exists creator_policy_one_scheduled_scope
  on public.creator_policy_versions(policy_key,scope_type,scope_key)
  where status='scheduled';
create index if not exists creator_policy_effective_lookup
  on public.creator_policy_versions(policy_key,scope_type,scope_key,effective_from desc)
  where status in ('active','scheduled');

create table if not exists public.policy_acceptance_receipts(
  receipt_id uuid primary key default gen_random_uuid(),
  user_id text not null references public.profiles(user_id) on delete restrict,
  policy_version_id uuid not null references public.creator_policy_versions(policy_version_id),
  lifecycle_subject_type text,
  lifecycle_subject_id text,
  presentation text not null,
  locale text not null default 'en-NG',
  accepted_at timestamptz not null default now(),
  source text not null,
  unique(user_id,policy_version_id,lifecycle_subject_type,lifecycle_subject_id)
);

create table if not exists public.obligation_policy_snapshots(
  snapshot_id uuid primary key default gen_random_uuid(),
  subject_type text not null,
  subject_id text not null,
  policy_version_id uuid not null references public.creator_policy_versions(policy_version_id),
  calculated_value jsonb not null,
  created_at timestamptz not null default now(),
  unique(subject_type,subject_id,policy_version_id)
);

alter table public.creator_policy_versions enable row level security;
alter table public.policy_acceptance_receipts enable row level security;
alter table public.obligation_policy_snapshots enable row level security;

create policy creator_policy_public_read
on public.creator_policy_versions for select
to anon,authenticated
using(
  public_disclosure=true
  and status='active'
  and effective_from<=now()
  and (effective_until is null or effective_until>now())
);
create policy creator_policy_creator_read
on public.creator_policy_versions for select
to authenticated
using(public.current_actor_has_workspace('creator',null));
create policy policy_receipt_own_read
on public.policy_acceptance_receipts for select
to authenticated
using(user_id=public.current_profile_user_id());

revoke all on table public.creator_policy_versions from public,anon,authenticated;
grant select on table public.creator_policy_versions to anon,authenticated;
grant all on table public.creator_policy_versions to service_role;
revoke all on table public.policy_acceptance_receipts from public,anon,authenticated;
grant select on table public.policy_acceptance_receipts to authenticated;
grant all on table public.policy_acceptance_receipts to service_role;
revoke all on table public.obligation_policy_snapshots from public,anon,authenticated;
grant all on table public.obligation_policy_snapshots to service_role;

create or replace function public.prevent_published_policy_mutation()
returns trigger
language plpgsql
set search_path to 'pg_catalog','public'
as $$
begin
  if old.status<>'draft' then
    if old.status in ('active','scheduled') and new.status='retired'
      and new.policy_version_id=old.policy_version_id
      and new.policy_key=old.policy_key
      and new.scope_type=old.scope_type
      and new.scope_key=old.scope_key
      and new.version=old.version
      and new.value=old.value
      and new.value_schema=old.value_schema
      and new.effective_from=old.effective_from
      and new.public_disclosure=old.public_disclosure
      and new.disclosure_text is not distinct from old.disclosure_text
      and new.legal_review_state=old.legal_review_state
      and new.reason=old.reason
      and new.created_by is not distinct from old.created_by
      and new.approved_by is not distinct from old.approved_by
      and new.supersedes is not distinct from old.supersedes
      and new.checksum=old.checksum
      and new.created_at=old.created_at
      and new.published_at is not distinct from old.published_at
    then
      return new;
    end if;
    if old.status='scheduled' and new.status='active'
      and (select auth.role())='service_role'
      and new.policy_version_id=old.policy_version_id
      and new.policy_key=old.policy_key
      and new.scope_type=old.scope_type
      and new.scope_key=old.scope_key
      and new.version=old.version
      and new.value=old.value
      and new.value_schema=old.value_schema
      and new.effective_from=old.effective_from
      and new.public_disclosure=old.public_disclosure
      and new.disclosure_text is not distinct from old.disclosure_text
      and new.legal_review_state=old.legal_review_state
      and new.reason=old.reason
      and new.created_by is not distinct from old.created_by
      and new.approved_by is not distinct from old.approved_by
      and new.supersedes is not distinct from old.supersedes
      and new.checksum=old.checksum
      and new.created_at=old.created_at
    then return new; end if;
    raise exception 'Published policy versions are immutable except retirement';
  end if;
  return new;
end
$$;
drop trigger if exists creator_policy_immutable on public.creator_policy_versions;
create trigger creator_policy_immutable
before update or delete on public.creator_policy_versions
for each row execute function public.prevent_published_policy_mutation();

create or replace function public.get_effective_policy(
  p_policy_key text,
  p_scope_type text default 'global',
  p_scope_key text default '*',
  p_at timestamptz default now()
)
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select jsonb_build_object(
    'policy_version_id',p.policy_version_id,
    'policy_key',p.policy_key,
    'scope_type',p.scope_type,
    'scope_key',p.scope_key,
    'version',p.version,
    'value',p.value,
    'disclosure_text',p.disclosure_text,
    'effective_from',p.effective_from,
    'legal_review_state',p.legal_review_state
  )
  from public.creator_policy_versions p
  where p.policy_key=p_policy_key
    and (
      (p.scope_type=p_scope_type and p.scope_key=p_scope_key)
      or (p.scope_type='global' and p.scope_key='*')
    )
    and p.status='active'
    and p.effective_from<=p_at
    and (p.effective_until is null or p.effective_until>p_at)
    and (
      p.public_disclosure
      or public.current_actor_has_personal_workspace()
    )
  order by case when p.scope_type=p_scope_type and p.scope_key=p_scope_key then 0 else 1 end,
    p.effective_from desc
  limit 1
$$;

create or replace function public.creator_publish_policy(
  p_creator_elevation_id uuid,
  p_policy_key text,
  p_scope_type text,
  p_scope_key text,
  p_value jsonb,
  p_value_schema jsonb,
  p_effective_from timestamptz,
  p_public_disclosure boolean,
  p_disclosure_text text,
  p_legal_review_state text,
  p_reason text
)
returns public.creator_policy_versions
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_previous public.creator_policy_versions;
  v_result public.creator_policy_versions;
  v_version integer;
  v_status text;
begin
  if not public.creator_has_elevation(p_creator_elevation_id,'policy_publish') then
    raise exception 'Recent Creator policy authentication required';
  end if;
  select * into v_previous
  from public.creator_policy_versions
  where policy_key=p_policy_key and scope_type=p_scope_type
    and scope_key=p_scope_key and status='active'
  for update;
  select coalesce(max(version),0)+1 into v_version
  from public.creator_policy_versions
  where policy_key=p_policy_key and scope_type=p_scope_type and scope_key=p_scope_key;

  v_status:=case when p_effective_from>now() then 'scheduled' else 'active' end;
  update public.creator_policy_versions
  set status='retired',retired_at=now()
  where policy_key=p_policy_key and scope_type=p_scope_type
    and scope_key=p_scope_key and status='scheduled';
  if v_status='active' and v_previous.policy_version_id is not null then
    update public.creator_policy_versions
    set status='retired',effective_until=p_effective_from,retired_at=now()
    where policy_version_id=v_previous.policy_version_id;
  end if;

  insert into public.creator_policy_versions(
    policy_key,scope_type,scope_key,version,value,value_schema,status,
    effective_from,public_disclosure,disclosure_text,legal_review_state,
    reason,created_by,approved_by,supersedes,checksum,published_at
  ) values(
    p_policy_key,p_scope_type,p_scope_key,v_version,p_value,
    coalesce(p_value_schema,'{}'::jsonb),v_status,p_effective_from,
    p_public_disclosure,p_disclosure_text,p_legal_review_state,p_reason,
    v_actor,v_actor,v_previous.policy_version_id,
    md5(p_policy_key||p_scope_type||p_scope_key||v_version::text||p_value::text),
    now()
  ) returning * into v_result;
  return v_result;
end
$$;

create or replace function public.activate_due_creator_policy_versions()
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_due public.creator_policy_versions; v_count integer:=0;
begin
  if (select auth.role())<>'service_role' then raise exception 'service role required'; end if;
  for v_due in
    select * from public.creator_policy_versions
    where status='scheduled' and effective_from<=now()
    order by effective_from,created_at for update skip locked
  loop
    update public.creator_policy_versions
    set status='retired',effective_until=v_due.effective_from,retired_at=now()
    where policy_key=v_due.policy_key and scope_type=v_due.scope_type
      and scope_key=v_due.scope_key and status='active';
    update public.creator_policy_versions
    set status='active',published_at=coalesce(published_at,now())
    where policy_version_id=v_due.policy_version_id;
    v_count:=v_count+1;
  end loop;
  return v_count;
end
$$;

create or replace function public.accept_effective_policy(
  p_policy_version_id uuid,
  p_presentation text,
  p_locale text default 'en-NG',
  p_source text default 'account',
  p_subject_type text default null,
  p_subject_id text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_user text:=public.current_profile_user_id(); v_id uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not exists(
    select 1 from public.creator_policy_versions p
    where p.policy_version_id=p_policy_version_id
      and p.status='active' and p.effective_from<=now()
      and (p.effective_until is null or p.effective_until>now())
  ) then raise exception 'Policy version is not effective'; end if;
  insert into public.policy_acceptance_receipts(
    user_id,policy_version_id,lifecycle_subject_type,lifecycle_subject_id,
    presentation,locale,source
  ) values(
    v_user,p_policy_version_id,p_subject_type,p_subject_id,
    p_presentation,coalesce(nullif(p_locale,''),'en-NG'),p_source
  ) on conflict(
    user_id,policy_version_id,lifecycle_subject_type,lifecycle_subject_id
  ) do update set presentation=excluded.presentation
  returning receipt_id into v_id;
  return v_id;
end
$$;

revoke all on function public.creator_publish_policy(
  uuid,text,text,text,jsonb,jsonb,timestamptz,boolean,text,text,text
) from public,anon,authenticated;
grant execute on function public.creator_publish_policy(
  uuid,text,text,text,jsonb,jsonb,timestamptz,boolean,text,text,text
) to authenticated;
revoke all on function public.activate_due_creator_policy_versions()
from public,anon,authenticated;
grant execute on function public.activate_due_creator_policy_versions()
to service_role;
revoke all on function public.get_effective_policy(text,text,text,timestamptz) from public;
grant execute on function public.get_effective_policy(text,text,text,timestamptz)
to anon,authenticated,service_role;
revoke all on function public.accept_effective_policy(
  uuid,text,text,text,text,text
) from public,anon;
grant execute on function public.accept_effective_policy(
  uuid,text,text,text,text,text
) to authenticated,service_role;

insert into public.creator_policy_versions(
  policy_key,scope_type,scope_key,version,value,value_schema,status,
  effective_from,public_disclosure,disclosure_text,legal_review_state,
  reason,created_by,approved_by,checksum,published_at
) values
('commission_long_let','global','*',1,'{"percent":5}'::jsonb,'{"type":"percent"}','active',now(),true,'WeHouse receives 5% from Partner economics.','pending','Locked launch default',null,null,md5('commission_long_let:1:5'),now()),
('commission_short_let','global','*',1,'{"percent":10}'::jsonb,'{"type":"percent"}','active',now(),true,'WeHouse receives 10% from Partner economics.','pending','Locked launch default',null,null,md5('commission_short_let:1:10'),now()),
('commission_hotel','global','*',1,'{"percent":12}'::jsonb,'{"type":"percent"}','active',now(),true,'WeHouse receives 12% from Partner economics.','pending','Locked launch default',null,null,md5('commission_hotel:1:12'),now()),
('commission_worker','global','*',1,'{"percent":8}'::jsonb,'{"type":"percent"}','active',now(),true,'WeHouse receives 8% from Worker economics.','pending','Locked launch default',null,null,md5('commission_worker:1:8'),now()),
('long_let_reservation_hold','global','*',1,'{"hours":72,"full_refund_hours":24,"reminders_hours_remaining":[24,6,0]}'::jsonb,'{"type":"duration_policy"}','active',now(),true,'A Long Let reservation is held for three days.','pending','Locked launch default',null,null,md5('long_let_reservation_hold:1'),now()),
('short_let_shared_checkout','global','*',1,'{"minutes":30}'::jsonb,'{"type":"duration_policy"}','active',now(),true,'All invited payers must complete within the shown checkout window.','pending','Locked launch default',null,null,md5('short_let_shared_checkout:1'),now()),
('worker_completion_release','global','*',1,'{"reminder_hours":12,"release_eligible_hours":24,"help_days":3,"review_edit_hours":48}'::jsonb,'{"type":"duration_policy"}','active',now(),true,'Job funds are released after confirmed or controlled completion.','pending','Locked launch default',null,null,md5('worker_completion_release:1'),now()),
('caution_claim_windows','global','*',1,'{"guest_damage_hours":4,"partner_claim_hours":24,"guest_response_hours":48,"appeal_hours":48}'::jsonb,'{"type":"duration_policy"}','active',now(),true,'Short Let Caution claims use evidence and published response windows.','pending','Locked launch default',null,null,md5('caution_claim_windows:1'),now())
,
('short_let_caution_cap','global','*',1,'{"enabled":false,"maximum_amount":null,"currency":"NGN"}'::jsonb,'{"type":"amount_cap"}','active',now(),true,'A Property Partner may charge a Caution fee only after the Creator publishes a maximum.','pending','Safe launch default: disabled until configured',null,null,md5('short_let_caution_cap:1'),now()),
('long_let_reservation_fee','global','*',1,'{"source":"platform_settings","customer_disclosure_required":true}'::jsonb,'{"type":"fee_policy"}','active',now(),true,'The current Creator-set Long Let reservation fee is disclosed before payment.','pending','Preserve current Creator amount through compatibility read',null,null,md5('long_let_reservation_fee:1'),now()),
('long_let_cancellation','global','*',1,'{"full_refund_hours":24,"requires_no_material_process":true,"later_refund":"published_stage_calculation","legal_exceptions_reviewable":true}'::jsonb,'{"type":"cancellation_policy"}','active',now(),true,'Cancellation within 24 hours is fully refundable only before a material process starts; later outcomes follow the disclosed stage calculation.','pending','Locked launch cancellation model',null,null,md5('long_let_cancellation:1'),now()),
('future_long_let_installments','global','*',1,'{"enabled":false,"partner_opt_in":true,"payment_protection_hold":false,"grace_days":7,"automatic_late_fee":false,"automatic_eviction":false}'::jsonb,'{"type":"feature_policy"}','active',now(),true,'Partner-approved installments are a future feature and are disabled at launch.','pending','Deferred launch feature',null,null,md5('future_long_let_installments:1'),now())
on conflict(policy_key,scope_type,scope_key,version) do nothing;

comment on table public.creator_policy_versions
is 'Immutable versioned Creator rules. Bookings snapshot the effective row.';
