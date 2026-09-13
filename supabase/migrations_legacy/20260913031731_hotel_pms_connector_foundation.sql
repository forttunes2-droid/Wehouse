-- Selective extraction of the preserved branch's pms_connector work.
-- A connected hotel remains Property Partner supply. WeHouse keeps identity,
-- publication, customer, payment, Payment Protection and booking authority.

alter table public.hotel_rooms
  add column if not exists source_system text not null default 'wehouse',
  add column if not exists external_reference text;
alter table public.hotel_rate_plans
  add column if not exists source_system text not null default 'wehouse',
  add column if not exists external_reference text;
alter table public.hotel_inventory_daily
  add column if not exists source_system text not null default 'wehouse',
  add column if not exists external_reference text;
alter table public.hotel_room_units
  add column if not exists source_system text not null default 'wehouse',
  add column if not exists external_reference text;

create table if not exists public.hotel_integrations(
  integration_id uuid primary key default gen_random_uuid(),
  hotel_id integer not null references public.hotels(hotel_id) on delete cascade,
  provider text not null,
  connection_name text not null,
  status text not null default 'active'
    check(status in ('pending','active','paused','error','revoked')),
  external_hotel_id text,
  token_hash text not null unique,
  token_prefix text not null,
  scopes text[] not null default array[
    'reservations.read','reservations.ack','catalog.write','room_status.write'
  ]::text[],
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

create table if not exists public.hotel_integration_events(
  integration_event_id uuid primary key default gen_random_uuid(),
  integration_id uuid not null
    references public.hotel_integrations(integration_id) on delete restrict,
  idempotency_key text not null,
  direction text not null check(direction in ('inbound','outbound')),
  event_type text not null,
  external_reference text,
  payload_hash text,
  status text not null default 'processed'
    check(status in ('pending','processed','review_required','failed')),
  error_message text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(integration_id,idempotency_key)
);

alter table public.hotel_bookings
  add column if not exists integration_id uuid
    references public.hotel_integrations(integration_id) on delete set null,
  add column if not exists pms_external_reservation_id text,
  add column if not exists pms_sync_status text not null default 'not_connected',
  add column if not exists pms_last_synced_at timestamptz;
alter table public.hotel_bookings
  drop constraint if exists hotel_bookings_pms_sync_status_check;
alter table public.hotel_bookings
  add constraint hotel_bookings_pms_sync_status_check check(pms_sync_status in (
    'not_connected','pending','delivered','acknowledged','review_required'
  ));

create unique index if not exists hotel_rooms_external_source_unique
  on public.hotel_rooms(hotel_id,source_system,external_reference)
  where external_reference is not null;
create unique index if not exists hotel_rate_plans_external_source_unique
  on public.hotel_rate_plans(hotel_id,source_system,external_reference)
  where external_reference is not null;
create unique index if not exists hotel_room_units_external_source_unique
  on public.hotel_room_units(hotel_id,source_system,external_reference)
  where external_reference is not null;
create index if not exists hotel_integrations_hotel_status_idx
  on public.hotel_integrations(hotel_id,status);
create index if not exists hotel_integration_events_status_idx
  on public.hotel_integration_events(integration_id,status,created_at desc);

alter table public.hotel_integrations enable row level security;
alter table public.hotel_integration_events enable row level security;
drop policy if exists hotel_integrations_owner_read on public.hotel_integrations;
create policy hotel_integrations_owner_read
on public.hotel_integrations for select to authenticated
using(public.hotel_actor_has_capability(hotel_id,'hotel.integration.manage'));
drop policy if exists hotel_integration_events_owner_read on public.hotel_integration_events;
create policy hotel_integration_events_owner_read
on public.hotel_integration_events for select to authenticated
using(exists(
  select 1 from public.hotel_integrations i
  where i.integration_id=hotel_integration_events.integration_id
    and public.hotel_actor_has_capability(
      i.hotel_id,'hotel.integration.manage'
    )
));

revoke all on table public.hotel_integrations from public,anon,authenticated;
revoke all on table public.hotel_integration_events from public,anon,authenticated;
grant select on table public.hotel_integrations to authenticated;
grant select on table public.hotel_integration_events to authenticated;
grant all on table public.hotel_integrations to service_role;
grant all on table public.hotel_integration_events to service_role;

create or replace function public.hotel_integration_owns_domain(
  p_hotel_id integer,p_domain text
)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select exists(
    select 1 from public.hotel_integrations i
    where i.hotel_id=p_hotel_id and i.status='active'
      and p_domain=any(i.authoritative_domains)
  )
$$;

create or replace function public.owner_create_hotel_integration(
  p_hotel_id integer,p_provider text,p_name text,
  p_external_hotel_id text default null,
  p_authoritative_domains text[] default array['rooms','rates','inventory']::text[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','extensions'
as $$
declare
  v_actor public.profiles;
  v_raw_token text;
  v_hash text;
  v_row public.hotel_integrations;
  v_domains text[];
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if not public.hotel_actor_has_capability(
    p_hotel_id,'hotel.integration.manage'
  ) then raise exception 'Hotel integration management access required'; end if;
  select coalesce(array_agg(distinct x order by x),'{}'::text[])
  into v_domains
  from unnest(coalesce(p_authoritative_domains,'{}'::text[])) x;
  if exists(
    select 1 from unnest(v_domains) x
    where x not in ('rooms','rates','inventory','room_status')
  ) then raise exception 'Unsupported PMS authority domain'; end if;
  if nullif(btrim(p_provider),'') is null or nullif(btrim(p_name),'') is null
    then raise exception 'Provider and connection name are required'; end if;
  if exists(
    select 1 from public.hotel_integrations i
    where i.hotel_id=p_hotel_id and i.status='active'
      and i.authoritative_domains&&v_domains
  ) then raise exception 'Another active integration owns one of these domains'; end if;

  v_raw_token:='whpms_live_'||encode(gen_random_bytes(32),'hex');
  v_hash:=encode(digest(v_raw_token,'sha256'),'hex');
  insert into public.hotel_integrations(
    hotel_id,provider,connection_name,status,external_hotel_id,
    token_hash,token_prefix,authoritative_domains,created_by
  ) values(
    p_hotel_id,lower(btrim(p_provider)),btrim(p_name),'active',
    nullif(btrim(coalesce(p_external_hotel_id,'')),''),
    v_hash,left(v_raw_token,20),v_domains,v_actor.user_id
  ) returning * into v_row;
  insert into public.audit_logs(
    id,admin_id,admin_email,action,target_type,target_id,details,created_at
  ) values(
    gen_random_uuid()::text,v_actor.user_id,v_actor.email,
    'HOTEL_PMS_INTEGRATION_CREATED','hotel_integration',
    v_row.integration_id::text,jsonb_build_object(
      'hotel_id',p_hotel_id,'provider',v_row.provider,'domains',v_domains
    )::text,now()
  );
  return jsonb_build_object(
    'integration_id',v_row.integration_id,
    'hotel_id',v_row.hotel_id,
    'provider',v_row.provider,
    'name',v_row.connection_name,
    'token',v_raw_token,
    'token_prefix',v_row.token_prefix,
    'authoritative_domains',v_row.authoritative_domains
  );
end
$$;

create or replace function public.owner_rotate_hotel_integration(
  p_integration_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','extensions'
as $$
declare v_row public.hotel_integrations; v_raw_token text;
begin
  select * into v_row from public.hotel_integrations
  where integration_id=p_integration_id for update;
  if v_row.integration_id is null or not public.hotel_actor_has_capability(
    v_row.hotel_id,'hotel.integration.manage'
  ) then raise exception 'Hotel integration management access required'; end if;
  if v_row.status='revoked' then
    raise exception 'A revoked integration cannot be rotated'; end if;
  v_raw_token:='whpms_live_'||encode(gen_random_bytes(32),'hex');
  update public.hotel_integrations
  set token_hash=encode(digest(v_raw_token,'sha256'),'hex'),
    token_prefix=left(v_raw_token,20),rotated_at=now(),
    updated_at=now(),last_error=null
  where integration_id=p_integration_id returning * into v_row;
  return jsonb_build_object(
    'integration_id',v_row.integration_id,
    'token',v_raw_token,'token_prefix',v_row.token_prefix
  );
end
$$;

create or replace function public.get_my_hotel_integrations(p_hotel_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_result jsonb;
begin
  if not public.hotel_actor_has_capability(
    p_hotel_id,'hotel.integration.manage'
  ) then raise exception 'Hotel integration management access required'; end if;
  select coalesce(jsonb_agg(
    to_jsonb(i)-'token_hash' order by i.created_at desc
  ),'[]'::jsonb) into v_result
  from public.hotel_integrations i where i.hotel_id=p_hotel_id;
  return v_result;
end
$$;

create or replace function public.guard_pms_owned_hotel_domain()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_hotel_id integer; v_domain text;
begin
  if coalesce((select auth.role()),'')='service_role' then
    return coalesce(new,old); end if;
  if tg_table_name='hotel_rooms' then
    v_hotel_id:=coalesce(new.hotel_id,old.hotel_id);v_domain:='rooms';
  elsif tg_table_name='hotel_rate_plans' then
    v_hotel_id:=coalesce(new.hotel_id,old.hotel_id);v_domain:='rates';
  elsif tg_table_name='hotel_inventory_daily' then
    v_hotel_id:=coalesce(new.hotel_id,old.hotel_id);v_domain:='inventory';
  else return coalesce(new,old);
  end if;
  if public.hotel_integration_owns_domain(v_hotel_id,v_domain) then
    raise exception 'This hotel % domain is managed by its connected PMS',v_domain;
  end if;
  return coalesce(new,old);
end
$$;

drop trigger if exists hotel_rooms_pms_authority_guard on public.hotel_rooms;
create trigger hotel_rooms_pms_authority_guard
before insert or update or delete on public.hotel_rooms
for each row execute function public.guard_pms_owned_hotel_domain();
drop trigger if exists hotel_rate_plans_pms_authority_guard
  on public.hotel_rate_plans;
create trigger hotel_rate_plans_pms_authority_guard
before insert or update or delete on public.hotel_rate_plans
for each row execute function public.guard_pms_owned_hotel_domain();
drop trigger if exists hotel_inventory_pms_authority_guard
  on public.hotel_inventory_daily;
create trigger hotel_inventory_pms_authority_guard
before insert or update or delete on public.hotel_inventory_daily
for each row execute function public.guard_pms_owned_hotel_domain();

create or replace function public.queue_hotel_booking_for_pms()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_integration uuid;
begin
  if new.payment_status='paid'
    and new.status in ('confirmed','checked_in','checked_out','completed') then
    select i.integration_id into v_integration
    from public.hotel_integrations i
    where i.hotel_id=new.hotel_id and i.status='active'
      and 'reservations.read'=any(i.scopes)
    order by i.created_at limit 1;
    if v_integration is not null then
      new.integration_id:=coalesce(new.integration_id,v_integration);
      if new.pms_external_reservation_id is null then
        new.pms_sync_status:='pending';
      end if;
    end if;
  end if;
  return new;
end
$$;
drop trigger if exists hotel_bookings_queue_pms on public.hotel_bookings;
create trigger hotel_bookings_queue_pms
before insert or update of payment_status,status,hotel_id on public.hotel_bookings
for each row execute function public.queue_hotel_booking_for_pms();

revoke all on function public.hotel_integration_owns_domain(integer,text)
from public,anon;
revoke all on function public.owner_create_hotel_integration(
  integer,text,text,text,text[]
) from public,anon;
revoke all on function public.owner_rotate_hotel_integration(uuid)
from public,anon;
revoke all on function public.get_my_hotel_integrations(integer)
from public,anon;
revoke all on function public.guard_pms_owned_hotel_domain()
from public,anon,authenticated;
revoke all on function public.queue_hotel_booking_for_pms()
from public,anon,authenticated;
grant execute on function public.hotel_integration_owns_domain(integer,text)
to authenticated,service_role;
grant execute on function public.owner_create_hotel_integration(
  integer,text,text,text,text[]
) to authenticated,service_role;
grant execute on function public.owner_rotate_hotel_integration(uuid)
to authenticated,service_role;
grant execute on function public.get_my_hotel_integrations(integer)
to authenticated,service_role;
grant execute on function public.guard_pms_owned_hotel_domain() to service_role;
grant execute on function public.queue_hotel_booking_for_pms() to service_role;

comment on table public.hotel_integrations
is 'Optional PMS connection. WeHouse retains payment, Payment Protection and booking authority.';
