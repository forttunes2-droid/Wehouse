alter table public.profiles add column if not exists account_kind text;
update public.profiles set account_kind=case
  when role='property_partner' then 'property_partner'
  when role='worker' then 'worker'
  when role='creator' then 'creator'
  else 'consumer' end
where account_kind is null;
alter table public.profiles alter column account_kind set default 'consumer';
alter table public.profiles alter column account_kind set not null;
alter table public.profiles drop constraint if exists profiles_account_kind_check;
alter table public.profiles add constraint profiles_account_kind_check
  check(account_kind in('consumer','worker','property_partner','creator'));

create table if not exists public.workspace_role_assignments(
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.profiles(user_id) on delete cascade,
  workspace_role text not null check(workspace_role in('staff','admin','creator')),
  scope_type text not null default 'global' check(scope_type in('global','state','branch')),
  scope_state text,
  scope_lga text,
  status text not null default 'active' check(status in('active','revoked')),
  granted_by text references public.profiles(user_id),
  granted_at timestamptz not null default now(),
  revoked_by text references public.profiles(user_id),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists workspace_role_one_active_role
  on public.workspace_role_assignments(user_id,workspace_role)
  where status='active';
create index if not exists workspace_role_active_scope
  on public.workspace_role_assignments(workspace_role,scope_state,scope_lga)
  where status='active';
alter table public.workspace_role_assignments enable row level security;
drop policy if exists workspace_role_owner_read on public.workspace_role_assignments;
create policy workspace_role_owner_read on public.workspace_role_assignments
  for select to authenticated using(user_id=public.current_profile_user_id());
grant select on public.workspace_role_assignments to authenticated;
revoke insert,update,delete on public.workspace_role_assignments from authenticated,anon;

insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,scope_state,scope_lga,granted_by,granted_at)
select p.user_id,p.role,
  case when p.role='creator' then 'global' else 'branch' end,
  p.assigned_state,p.assigned_lga,p.updated_by,coalesce(p.updated_at,p.created_at,now())
from public.profiles p
where p.role in('staff','admin','creator')
  and not exists(select 1 from public.workspace_role_assignments a where a.user_id=p.user_id and a.workspace_role=p.role and a.status='active');

create or replace function public.current_actor_has_workspace_role(p_role text)
returns boolean language sql stable security definer set search_path to 'pg_catalog','public'
as $$
  select exists(
    select 1 from public.workspace_role_assignments a
    join public.profiles p on p.user_id=a.user_id
    where p.auth_id=auth.uid()::text and a.workspace_role=p_role and a.status='active'
      and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)
  );
$$;
revoke all on function public.current_actor_has_workspace_role(text) from public,anon;
grant execute on function public.current_actor_has_workspace_role(text) to authenticated;

create or replace function public.get_my_workspace_access()
returns jsonb language sql stable security definer set search_path to 'pg_catalog','public'
as $$
  select jsonb_build_object(
    'identity',jsonb_build_object('user_id',p.user_id,'account_kind',p.account_kind),
    'personal_workspace',p.account_kind='consumer',
    'privileged_workspaces',coalesce((
      select jsonb_agg(jsonb_build_object('role',a.workspace_role,'scope_type',a.scope_type,'state',a.scope_state,'lga',a.scope_lga) order by a.workspace_role)
      from public.workspace_role_assignments a where a.user_id=p.user_id and a.status='active'
    ),'[]'::jsonb)
  ) from public.profiles p where p.auth_id=auth.uid()::text;
$$;
revoke all on function public.get_my_workspace_access() from public,anon;
grant execute on function public.get_my_workspace_access() to authenticated;

create or replace function public.sync_legacy_profile_role_assignment()
returns trigger language plpgsql security definer set search_path to 'pg_catalog','public'
as $$
begin
  if new.role in('staff','admin','creator') and (tg_op='INSERT' or old.role is distinct from new.role or old.assigned_state is distinct from new.assigned_state or old.assigned_lga is distinct from new.assigned_lga) then
    update public.workspace_role_assignments set status='revoked',revoked_by=new.updated_by,revoked_at=now(),updated_at=now()
      where user_id=new.user_id and workspace_role in('staff','admin') and workspace_role<>new.role and status='active';
    insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,scope_state,scope_lga,granted_by)
      values(new.user_id,new.role,case when new.role='creator' then 'global' else 'branch' end,new.assigned_state,new.assigned_lga,new.updated_by)
    on conflict(user_id,workspace_role) where status='active' do update
      set scope_type=excluded.scope_type,scope_state=excluded.scope_state,scope_lga=excluded.scope_lga,updated_at=now();
  elsif tg_op='UPDATE' and old.role in('staff','admin') and new.role not in('staff','admin') then
    update public.workspace_role_assignments set status='revoked',revoked_by=new.updated_by,revoked_at=now(),updated_at=now()
      where user_id=new.user_id and workspace_role=old.role and status='active';
  end if;
  return new;
end $$;
drop trigger if exists profiles_sync_workspace_assignment on public.profiles;
create trigger profiles_sync_workspace_assignment after insert or update of role,assigned_state,assigned_lga on public.profiles
for each row execute function public.sync_legacy_profile_role_assignment();

-- Enforce conflict-of-interest at the affected records, so every old and new
-- RPC is covered even before the compatibility role checks are fully retired.
create or replace function public.prevent_privileged_self_review()
returns trigger language plpgsql security definer set search_path to 'pg_catalog','public'
as $$
declare actor text:=public.current_profile_user_id();
begin
  if actor is null then return new; end if;
  if tg_table_name='listings' and (new.approved_by is distinct from old.approved_by or (old.status is distinct from new.status and new.status in('available','rejected')))
     and actor in(coalesce(new.owner_id,''),coalesce(new.partner_id,'')) then raise exception 'Another authorized person must review your listing';
  elsif tg_table_name='profiles' and (new.worker_status in('verified','rejected') or new.worker_verified=true)
     and (new.worker_status is distinct from old.worker_status or new.worker_verified is distinct from old.worker_verified)
     and actor=new.user_id then raise exception 'Another authorized person must review your Worker verification';
  elsif tg_table_name='reservations' and new.status='refunded' and old.status is distinct from new.status and actor=new.user_id then raise exception 'Another authorized person must process your refund';
  elsif tg_table_name='inspection_requests' and new.access_evidence_status in('verified','rejected') and old.access_evidence_status is distinct from new.access_evidence_status and actor=new.owner_id then raise exception 'Another authorized person must review your property evidence';
  end if;
  return new;
end $$;
drop trigger if exists listings_no_self_review on public.listings;
create trigger listings_no_self_review before update on public.listings for each row execute function public.prevent_privileged_self_review();
drop trigger if exists workers_no_self_review on public.profiles;
create trigger workers_no_self_review before update of worker_status,worker_verified on public.profiles for each row execute function public.prevent_privileged_self_review();
drop trigger if exists reservation_refunds_no_self_review on public.reservations;
create trigger reservation_refunds_no_self_review before update of status on public.reservations for each row execute function public.prevent_privileged_self_review();
drop trigger if exists property_evidence_no_self_review on public.inspection_requests;
create trigger property_evidence_no_self_review before update of access_evidence_status on public.inspection_requests for each row execute function public.prevent_privileged_self_review();

revoke all on function public.sync_legacy_profile_role_assignment(),public.prevent_privileged_self_review() from public,anon,authenticated;
