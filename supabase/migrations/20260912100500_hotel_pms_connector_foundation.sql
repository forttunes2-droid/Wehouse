-- Provider-neutral PMS boundary. A hotel may be manual or connected without becoming
-- a second product. WeHouse remains authority for identity, publication, public media,
-- payments, Payment Protection, and booking lifecycle truth.

create table if not exists public.hotel_integrations (
  id uuid primary key default gen_random_uuid(),
  hotel_id integer not null references public.hotels(hotel_id) on delete cascade,
  provider text not null,
  name text not null,
  status text not null default 'active' check (status in ('pending','active','paused','error','revoked')),
  external_hotel_id text,
  token_hash text not null unique,
  token_prefix text not null,
  scopes text[] not null default array['reservations.read','reservations.ack','catalog.write','room_status.write']::text[],
  authoritative_domains text[] not null default '{}'::text[],
  last_cursor text,
  last_sync_at timestamptz,
  last_error text,
  created_by text references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  revoked_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(hotel_id,provider,external_hotel_id)
);

create table if not exists public.hotel_integration_events (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.hotel_integrations(id) on delete cascade,
  idempotency_key text not null,
  direction text not null check (direction in ('inbound','outbound')),
  event_type text not null,
  external_reference text,
  payload_hash text,
  status text not null default 'processed' check (status in ('pending','processed','review_required','failed')),
  error_message text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(integration_id,idempotency_key)
);

alter table public.hotel_integrations enable row level security;
alter table public.hotel_integration_events enable row level security;

create index if not exists hotel_integrations_hotel_status_idx on public.hotel_integrations(hotel_id,status);
create index if not exists hotel_integration_events_status_idx on public.hotel_integration_events(integration_id,status,created_at desc);

alter table public.hotel_bookings
  add column if not exists integration_id uuid references public.hotel_integrations(id) on delete set null,
  add column if not exists pms_external_reservation_id text,
  add column if not exists pms_sync_status text not null default 'not_connected',
  add column if not exists pms_last_synced_at timestamptz;

alter table public.hotel_bookings drop constraint if exists hotel_bookings_pms_sync_status_check;
alter table public.hotel_bookings add constraint hotel_bookings_pms_sync_status_check
  check (pms_sync_status in ('not_connected','pending','delivered','acknowledged','review_required'));

alter table public.hotel_inventory_daily
  add column if not exists source_system text not null default 'wehouse',
  add column if not exists external_reference text;

alter table public.hotel_room_units
  add column if not exists source_system text not null default 'wehouse',
  add column if not exists external_reference text;

create unique index if not exists hotel_rooms_external_source_unique
  on public.hotel_rooms(hotel_id,source_system,external_reference)
  where external_reference is not null;
create unique index if not exists hotel_rate_plans_external_source_unique
  on public.hotel_rate_plans(hotel_id,source_system,external_reference)
  where external_reference is not null;
create unique index if not exists hotel_room_units_external_source_unique
  on public.hotel_room_units(hotel_id,source_system,external_reference)
  where external_reference is not null;

create or replace function public.hotel_integration_owns_domain(p_hotel_id integer,p_domain text)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select exists(
    select 1 from public.hotel_integrations i
    where i.hotel_id=p_hotel_id and i.status='active' and p_domain=any(i.authoritative_domains)
  );
$$;

create or replace function public.owner_create_hotel_integration(
  p_hotel_id integer,
  p_provider text,
  p_name text,
  p_external_hotel_id text default null,
  p_authoritative_domains text[] default array['rooms','rates','inventory']::text[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','extensions'
as $$
declare actor public.profiles; raw_token text; token_hash text; row public.hotel_integrations; domains text[]; invalid text[];
begin
  select * into actor from public.profiles where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if actor.user_id is null or not exists(select 1 from public.hotels h where h.hotel_id=p_hotel_id and h.owner_id=actor.user_id) then
    raise exception 'Hotel owner access required';
  end if;
  select coalesce(array_agg(distinct x order by x),'{}'::text[]) into domains from unnest(coalesce(p_authoritative_domains,'{}'::text[])) x;
  select coalesce(array_agg(x),'{}'::text[]) into invalid from unnest(domains) x where x not in ('rooms','rates','inventory','room_status');
  if cardinality(invalid)>0 then raise exception 'Unsupported PMS authority domain'; end if;
  if nullif(btrim(coalesce(p_provider,'')),'') is null or nullif(btrim(coalesce(p_name,'')),'') is null then raise exception 'Provider and connection name are required'; end if;
  if exists(select 1 from public.hotel_integrations i where i.hotel_id=p_hotel_id and i.status='active' and i.authoritative_domains && domains) then
    raise exception 'Another active hotel integration already owns one of these domains';
  end if;
  raw_token:='whpms_live_'||encode(gen_random_bytes(32),'hex');
  token_hash:=encode(digest(raw_token,'sha256'),'hex');
  insert into public.hotel_integrations(hotel_id,provider,name,status,external_hotel_id,token_hash,token_prefix,authoritative_domains,created_by)
  values(p_hotel_id,lower(btrim(p_provider)),btrim(p_name),'active',nullif(btrim(coalesce(p_external_hotel_id,'')),''),token_hash,left(raw_token,20),domains,actor.user_id)
  returning * into row;
  insert into public.audit_logs(id,admin_id,admin_email,action,target_type,target_id,details,created_at)
  values(gen_random_uuid()::text,actor.user_id,actor.email,'HOTEL_PMS_INTEGRATION_CREATED','hotel_integration',row.id::text,
    jsonb_build_object('hotel_id',p_hotel_id,'provider',row.provider,'domains',domains)::text,now());
  return jsonb_build_object('integration_id',row.id,'hotel_id',row.hotel_id,'provider',row.provider,'name',row.name,'token',raw_token,'token_prefix',row.token_prefix,'authoritative_domains',row.authoritative_domains);
end;
$$;

create or replace function public.owner_rotate_hotel_integration(p_integration_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','extensions'
as $$
declare actor public.profiles; row public.hotel_integrations; raw_token text;
begin
  select * into actor from public.profiles where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  select i.* into row from public.hotel_integrations i join public.hotels h on h.hotel_id=i.hotel_id
  where i.id=p_integration_id and h.owner_id=actor.user_id for update;
  if row.id is null then raise exception 'Hotel owner access required'; end if;
  if row.status='revoked' then raise exception 'A revoked integration cannot be rotated'; end if;
  raw_token:='whpms_live_'||encode(gen_random_bytes(32),'hex');
  update public.hotel_integrations set token_hash=encode(digest(raw_token,'sha256'),'hex'),token_prefix=left(raw_token,20),rotated_at=now(),updated_at=now(),last_error=null
  where id=row.id returning * into row;
  return jsonb_build_object('integration_id',row.id,'token',raw_token,'token_prefix',row.token_prefix);
end;
$$;

create or replace function public.owner_set_hotel_integration_status(p_integration_id uuid,p_status text)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare actor public.profiles; row public.hotel_integrations;
begin
  if p_status not in ('active','paused','revoked') then raise exception 'Choose active, paused or revoked'; end if;
  select * into actor from public.profiles where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  select i.* into row from public.hotel_integrations i join public.hotels h on h.hotel_id=i.hotel_id
  where i.id=p_integration_id and h.owner_id=actor.user_id for update;
  if row.id is null then raise exception 'Hotel owner access required'; end if;
  update public.hotel_integrations set status=p_status,revoked_at=case when p_status='revoked' then now() else null end,updated_at=now() where id=row.id;
  return true;
end;
$$;

create or replace function public.get_my_hotel_integrations(p_hotel_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare actor text; result jsonb;
begin
  select user_id into actor from public.profiles where auth_id=(select auth.uid())::text and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if not exists(select 1 from public.hotels h where h.hotel_id=p_hotel_id and h.owner_id=actor) then raise exception 'Hotel owner access required'; end if;
  select coalesce(jsonb_agg(to_jsonb(i)-'token_hash' order by i.created_at desc),'[]'::jsonb) into result from public.hotel_integrations i where i.hotel_id=p_hotel_id;
  return result;
end;
$$;

-- Direct reads are owner-only; event payload details are never public.
drop policy if exists hotel_integrations_owner_read on public.hotel_integrations;
create policy hotel_integrations_owner_read on public.hotel_integrations for select to authenticated
using (exists(select 1 from public.hotels h where h.hotel_id=hotel_integrations.hotel_id and h.owner_id=public.current_profile_user_id()));

drop policy if exists hotel_integration_events_owner_read on public.hotel_integration_events;
create policy hotel_integration_events_owner_read on public.hotel_integration_events for select to authenticated
using (exists(select 1 from public.hotel_integrations i join public.hotels h on h.hotel_id=i.hotel_id where i.id=hotel_integration_events.integration_id and h.owner_id=public.current_profile_user_id()));

revoke all on table public.hotel_integrations from public,anon;
revoke all on table public.hotel_integration_events from public,anon;
grant select on table public.hotel_integrations to authenticated,service_role;
grant select on table public.hotel_integration_events to authenticated,service_role;
grant insert,update,delete on table public.hotel_integrations to service_role;
grant insert,update,delete on table public.hotel_integration_events to service_role;

revoke all on function public.owner_create_hotel_integration(integer,text,text,text,text[]) from public,anon;
revoke all on function public.owner_rotate_hotel_integration(uuid) from public,anon;
revoke all on function public.owner_set_hotel_integration_status(uuid,text) from public,anon;
revoke all on function public.get_my_hotel_integrations(integer) from public,anon;
grant execute on function public.owner_create_hotel_integration(integer,text,text,text,text[]) to authenticated,service_role;
grant execute on function public.owner_rotate_hotel_integration(uuid) to authenticated,service_role;
grant execute on function public.owner_set_hotel_integration_status(uuid,text) to authenticated,service_role;
grant execute on function public.get_my_hotel_integrations(integer) to authenticated,service_role;

-- When a hotel is connected, manual owner/team RPCs may not edit domains owned by PMS.
-- Payment, verification, publication, guest credentials and Payment Protection are never PMS domains.
comment on table public.hotel_integrations is 'PMS/channel-manager connections. Only token hashes are stored; WeHouse remains payment/publication authority.';
