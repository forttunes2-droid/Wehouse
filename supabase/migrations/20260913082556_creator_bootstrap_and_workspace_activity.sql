-- Close two launch blockers found during the current-main audit:
-- 1. provide an auditable, service-only first-Creator bootstrap;
-- 2. keep Activity scoped to the exact workspace while retaining legacy staff
--    and partner delivery compatibility.

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

  select lower(btrim(u.email)),u.email_confirmed_at
  into v_auth_email,v_auth_confirmed_at
  from auth.users u where u.id=p_auth_user_id;
  if v_auth_email is null then raise exception 'Auth user not found'; end if;
  if v_auth_confirmed_at is null then
    raise exception 'Creator email must be confirmed first';
  end if;
  if v_auth_email<>lower(btrim(p_expected_email)) then
    raise exception 'Auth user ID and expected email do not match';
  end if;

  select * into v_profile from public.profiles p
  where p.auth_id=p_auth_user_id::text for update;
  if v_profile.user_id is null then
    raise exception 'Create the normal Personal profile before Creator bootstrap';
  end if;
  if lower(btrim(v_profile.email))<>v_auth_email then
    raise exception 'Personal profile and Auth email do not match';
  end if;
  if coalesce(v_profile.deleted,false) or coalesce(v_profile.suspended,false)
    or coalesce(v_profile.banned,false) then
    raise exception 'Creator bootstrap requires an active Personal profile';
  end if;
  if exists(
    select 1 from public.workspace_role_assignments w
    where w.user_id=v_profile.user_id and w.status='active'
      and w.workspace_role in('worker','property_partner')
  ) then
    raise exception 'Bootstrap a clean Personal account, not a marketplace professional account';
  end if;
  if exists(
    select 1 from public.workspace_role_assignments w
    where w.workspace_role='creator' and w.status='active'
      and w.user_id<>v_profile.user_id
  ) then
    raise exception 'A different active Creator is already configured';
  end if;

  update public.profiles
  set role='creator',account_kind='consumer',updated_at=now()
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
    'workspace','creator','scope','global'
  );
end
$$;

revoke all on function public.bootstrap_first_creator_from_service(
  uuid,text,text
) from public,anon,authenticated;
grant execute on function public.bootstrap_first_creator_from_service(
  uuid,text,text
) to service_role;
comment on function public.bootstrap_first_creator_from_service(uuid,text,text)
is 'One-time exact-identity Creator bootstrap. Service role only, serialized and audited.';

alter table public.notifications
drop constraint if exists notifications_workspace_scope_check;
alter table public.notifications
add constraint notifications_workspace_scope_check check(workspace_scope in(
  'personal','account','worker','partner','property_partner','hotel',
  'staff','admin','creator','property_operations','field_operations',
  'worker_operations','finance_operations','security_operations','support'
));

do $$
begin
  if exists(
    select 1 from pg_publication where pubname='supabase_realtime'
  ) and not exists(
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public'
      and tablename='activity_event_audiences'
  ) then
    alter publication supabase_realtime
    add table public.activity_event_audiences;
  end if;
end
$$;

create or replace function public.set_notification_workspace_scope()
returns trigger
language plpgsql
set search_path to 'pg_catalog','public'
as $$
begin
  new.workspace_scope:=coalesce(
    nullif(btrim(new.workspace_scope),''),
    public.infer_notification_workspace_scope(
      new.recipient_id,new.type,new.source_type,new.destination_route,new.title
    )
  );
  if new.workspace_scope='property_partner' then
    new.workspace_scope:='partner';
  end if;
  if new.workspace_scope not in(
    'personal','account','worker','partner','hotel','staff','admin','creator',
    'property_operations','field_operations','worker_operations',
    'finance_operations','security_operations','support'
  ) then raise exception 'Unsupported notification workspace scope'; end if;
  return new;
end
$$;

create or replace function public.get_my_canonical_activity(
  p_workspace text default 'personal',p_limit integer default 100
)
returns table(
  id uuid,type text,title text,message text,read boolean,created_at timestamptz,
  source_type text,source_id text,destination_route text,
  destination_params jsonb,workspace text
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_user text:=public.current_profile_user_id();
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_workspace not in(
    'personal','account','worker','partner','property_partner','hotel',
    'staff','admin','creator','property_operations','field_operations',
    'worker_operations','finance_operations','security_operations','support'
  ) then raise exception 'Invalid Activity workspace'; end if;
  return query
  select e.activity_event_id,e.event_type,e.title,e.summary,
    a.read_at is not null,e.occurred_at,e.subject_type,e.subject_id,
    e.route,e.route_params,a.workspace
  from public.activity_event_audiences a
  join public.activity_events e on e.activity_event_id=a.activity_event_id
  where a.recipient_user_id=v_user
    and (
      (p_workspace='personal' and a.workspace in('personal','account'))
      or (p_workspace='partner' and a.workspace in('partner','property_partner'))
      or (p_workspace='hotel' and a.workspace in('hotel','hotel_staff'))
      or (p_workspace in(
        'property_operations','field_operations','worker_operations',
        'finance_operations','security_operations','support'
      ) and a.workspace in(p_workspace,'staff'))
      or (p_workspace not in('personal','partner','hotel',
        'property_operations','field_operations','worker_operations',
        'finance_operations','security_operations','support')
        and a.workspace=p_workspace)
    )
  order by e.occurred_at desc
  limit greatest(1,least(coalesce(p_limit,100),200));
end
$$;

create or replace function public.mark_my_canonical_activity_read(
  p_activity_event_id uuid,p_workspace text
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_user text:=public.current_profile_user_id();
begin
  update public.activity_event_audiences set read_at=coalesce(read_at,now())
  where activity_event_id=p_activity_event_id and recipient_user_id=v_user
    and (
      workspace=p_workspace
      or (p_workspace='personal' and workspace='account')
      or (p_workspace='partner' and workspace='property_partner')
      or (p_workspace='hotel' and workspace='hotel_staff')
      or (p_workspace in(
        'property_operations','field_operations','worker_operations',
        'finance_operations','security_operations','support'
      ) and workspace='staff')
    );
  return found;
end
$$;

create or replace function public.mark_all_my_canonical_activity_read(
  p_workspace text
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_user text:=public.current_profile_user_id(); v_count integer;
begin
  update public.activity_event_audiences set read_at=coalesce(read_at,now())
  where recipient_user_id=v_user and read_at is null
    and (
      workspace=p_workspace
      or (p_workspace='personal' and workspace='account')
      or (p_workspace='partner' and workspace='property_partner')
      or (p_workspace='hotel' and workspace='hotel_staff')
      or (p_workspace in(
        'property_operations','field_operations','worker_operations',
        'finance_operations','security_operations','support'
      ) and workspace='staff')
    );
  get diagnostics v_count=row_count;
  return v_count;
end
$$;

revoke all on function public.set_notification_workspace_scope()
from public,anon,authenticated;
grant execute on function public.set_notification_workspace_scope()
to service_role;
revoke all on function public.get_my_canonical_activity(text,integer)
from public,anon;
grant execute on function public.get_my_canonical_activity(text,integer)
to authenticated,service_role;
revoke all on function public.mark_my_canonical_activity_read(uuid,text)
from public,anon;
grant execute on function public.mark_my_canonical_activity_read(uuid,text)
to authenticated,service_role;
revoke all on function public.mark_all_my_canonical_activity_read(text)
from public,anon;
grant execute on function public.mark_all_my_canonical_activity_read(text)
to authenticated,service_role;
