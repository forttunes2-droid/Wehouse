-- Connected PMS mode is fail-closed. Manual WeHouse hotel operations remain
-- complete. A connection can become active only for one named, certified
-- provider after hotel authorization and current legal launch approvals.

create table if not exists public.hotel_pms_providers (
  provider_key text primary key,
  display_name text not null,
  adapter_version text,
  certification_status text not null default 'candidate'
    check (certification_status in ('candidate','sandbox','certified','suspended','retired')),
  supported_domains text[] not null default array[]::text[],
  certification_evidence_uri text,
  contract_reviewed_at timestamptz,
  security_reviewed_at timestamptz,
  dpa_reviewed_at timestamptz,
  mapping_reviewed_at timestamptz,
  pilot_approved_at timestamptz,
  certified_at timestamptz,
  certified_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (provider_key ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  check (nullif(btrim(display_name),'') is not null),
  check (supported_domains <@ array['rooms','rates','inventory','room_status']::text[]),
  check (
    certification_status<>'certified'
    or (
      nullif(btrim(coalesce(adapter_version,'')),'') is not null
      and nullif(btrim(coalesce(certification_evidence_uri,'')),'') is not null
      and contract_reviewed_at is not null
      and security_reviewed_at is not null
      and dpa_reviewed_at is not null
      and mapping_reviewed_at is not null
      and pilot_approved_at is not null
      and certified_at is not null
    )
  )
);

create table if not exists public.hotel_integrations (
  integration_id uuid primary key default gen_random_uuid(),
  hotel_id integer not null references public.hotels(hotel_id) on delete cascade,
  provider text not null,
  connection_name text not null,
  status text not null default 'requested',
  external_hotel_id text,
  token_hash text unique,
  token_prefix text,
  scopes text[] not null default array['reservations.receive','reservations.ack']::text[],
  authoritative_domains text[] not null default array[]::text[],
  last_cursor text,
  last_sync_at timestamptz,
  last_error text,
  created_by text references public.profiles(user_id) on delete set null,
  hotel_authorized_by text references public.profiles(user_id) on delete set null,
  hotel_authorized_at timestamptz,
  activated_at timestamptz,
  activated_by text,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  revoked_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(hotel_id,provider,external_hotel_id)
);

alter table public.hotel_integrations
  add column if not exists hotel_authorized_by text references public.profiles(user_id) on delete set null,
  add column if not exists hotel_authorized_at timestamptz,
  add column if not exists activated_at timestamptz,
  add column if not exists activated_by text;

alter table public.hotel_integrations alter column token_hash drop not null;
alter table public.hotel_integrations alter column token_prefix drop not null;
alter table public.hotel_integrations alter column status set default 'requested';

update public.hotel_integrations
set provider=coalesce(
      nullif(trim(both '-' from regexp_replace(lower(btrim(provider)),'[^a-z0-9_-]+','-','g')),''),
      'legacy-provider'
    ),
    status=case when status='active' then 'pending_certification' else status end,
    last_error=case when status='active'
      then 'Paused by named-provider certification gate'
      else last_error end,
    updated_at=now();

insert into public.hotel_pms_providers(provider_key,display_name,certification_status)
select distinct integration.provider,initcap(replace(integration.provider,'-',' ')),'candidate'
from public.hotel_integrations integration
on conflict(provider_key) do nothing;

alter table public.hotel_integrations
  drop constraint if exists hotel_integrations_status_check;
alter table public.hotel_integrations
  add constraint hotel_integrations_status_check
  check (status in (
    'requested','pending_certification','active','paused','error','revoked'
  ));

alter table public.hotel_integrations
  drop constraint if exists hotel_integrations_authoritative_domains_check;
alter table public.hotel_integrations
  add constraint hotel_integrations_authoritative_domains_check
  check (authoritative_domains <@ array['rooms','rates','inventory','room_status']::text[]);

alter table public.hotel_integrations
  drop constraint if exists hotel_integrations_activation_evidence_check;
alter table public.hotel_integrations
  add constraint hotel_integrations_activation_evidence_check
  check (
    status<>'active'
    or (
      hotel_authorized_by is not null and hotel_authorized_at is not null
      and activated_at is not null
      and nullif(btrim(coalesce(external_hotel_id,'')),'') is not null
      and nullif(btrim(coalesce(token_hash,'')),'') is not null
      and nullif(btrim(coalesce(token_prefix,'')),'') is not null
    )
  );

do $$
begin
  if not exists(
    select 1 from pg_constraint
    where conrelid='public.hotel_integrations'::regclass
      and conname='hotel_integrations_provider_fkey'
  ) then
    alter table public.hotel_integrations
      add constraint hotel_integrations_provider_fkey
      foreign key(provider) references public.hotel_pms_providers(provider_key)
      on update cascade on delete restrict;
  end if;
end;
$$;

create table if not exists public.hotel_integration_events (
  integration_event_id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.hotel_integrations(integration_id) on delete restrict,
  idempotency_key text not null,
  direction text not null check(direction in ('inbound','outbound')),
  event_type text not null,
  external_reference text,
  payload_hash text,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz,
  delivered_at timestamptz,
  acknowledged_at timestamptz,
  dead_lettered_at timestamptz,
  error_message text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(integration_id,idempotency_key)
);

alter table public.hotel_integration_events
  add column if not exists attempt_count integer not null default 0,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists acknowledged_at timestamptz,
  add column if not exists dead_lettered_at timestamptz;

update public.hotel_integration_events
set status=case status when 'processed' then 'acknowledged' when 'failed' then 'retry' else status end;

alter table public.hotel_integration_events
  drop constraint if exists hotel_integration_events_status_check;
alter table public.hotel_integration_events
  add constraint hotel_integration_events_status_check
  check (status in (
    'pending','delivered','acknowledged','retry','review_required','dead_letter'
  ));

alter table public.hotel_integration_events
  drop constraint if exists hotel_integration_events_attempt_count_check;
alter table public.hotel_integration_events
  add constraint hotel_integration_events_attempt_count_check
  check (attempt_count>=0);

create index if not exists hotel_integrations_hotel_status_idx
  on public.hotel_integrations(hotel_id,status);
create index if not exists hotel_integration_events_delivery_idx
  on public.hotel_integration_events(integration_id,status,next_attempt_at,created_at,integration_event_id);

alter table public.hotel_bookings
  add column if not exists integration_id uuid references public.hotel_integrations(integration_id) on delete set null,
  add column if not exists pms_external_reservation_id text,
  add column if not exists pms_sync_status text not null default 'not_connected',
  add column if not exists pms_last_synced_at timestamptz;

alter table public.hotel_bookings
  drop constraint if exists hotel_bookings_pms_sync_status_check;
alter table public.hotel_bookings
  add constraint hotel_bookings_pms_sync_status_check
  check (pms_sync_status in (
    'not_connected','pending','delivered','acknowledged','review_required'
  ));

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

create unique index if not exists hotel_rooms_external_source_unique
  on public.hotel_rooms(hotel_id,source_system,external_reference)
  where external_reference is not null;
create unique index if not exists hotel_rate_plans_external_source_unique
  on public.hotel_rate_plans(hotel_id,source_system,external_reference)
  where external_reference is not null;
create unique index if not exists hotel_inventory_external_source_unique
  on public.hotel_inventory_daily(hotel_id,source_system,external_reference,inventory_date)
  where external_reference is not null;
create unique index if not exists hotel_room_units_external_source_unique
  on public.hotel_room_units(hotel_id,source_system,external_reference)
  where external_reference is not null;

create or replace function public.hotel_integration_runtime_active(p_integration_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select exists(
    select 1
    from public.hotel_integrations integration
    join public.hotel_pms_providers provider
      on provider.provider_key=integration.provider
    join public.hotels hotel on hotel.hotel_id=integration.hotel_id
    where integration.integration_id=p_integration_id
      and integration.status='active'
      and provider.certification_status='certified'
      and hotel.status='active'
      and public._legal_launch_gate_is_approved('hotel_marketplace')
      and public._legal_launch_gate_is_approved('hotel_pms_connected_mode')
  )
$$;

create or replace function public.hotel_integration_owns_domain(
  p_hotel_id integer,
  p_domain text
)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select exists(
    select 1 from public.hotel_integrations integration
    where integration.hotel_id=p_hotel_id
      and p_domain=any(integration.authoritative_domains)
      and public.hotel_integration_runtime_active(integration.integration_id)
  )
$$;

create or replace function public.owner_request_hotel_pms_connection(
  p_hotel_id integer,
  p_provider text,
  p_connection_name text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_provider text:=lower(btrim(coalesce(p_provider,'')));
  v_row public.hotel_integrations;
begin
  if v_actor is null or not exists(
    select 1 from public.hotels
    where hotel_id=p_hotel_id and owner_id=v_actor
  ) then raise exception 'Hotel owner access required'; end if;
  if nullif(btrim(coalesce(p_connection_name,'')),'') is null then
    raise exception 'Connection name is required';
  end if;
  if not exists(
    select 1 from public.hotel_pms_providers
    where provider_key=v_provider
      and certification_status in ('candidate','sandbox','certified')
  ) then raise exception 'That named PMS adapter is not available for certification'; end if;
  if exists(
    select 1 from public.hotel_integrations
    where hotel_id=p_hotel_id and provider=v_provider
      and status not in ('revoked')
  ) then raise exception 'This hotel already has an open request for that PMS'; end if;
  insert into public.hotel_integrations(
    hotel_id,provider,connection_name,status,created_by,
    hotel_authorized_by,hotel_authorized_at
  ) values(
    p_hotel_id,v_provider,btrim(p_connection_name),'requested',v_actor,v_actor,now()
  ) returning * into v_row;
  insert into public.audit_logs(action,target_type,target_id,details,admin_id)
  values(
    'HOTEL_PMS_CONNECTION_REQUESTED','hotel_integration',v_row.integration_id::text,
    jsonb_build_object('hotel_id',p_hotel_id,'provider',v_provider)::text,v_actor
  );
  return jsonb_build_object(
    'integration_id',v_row.integration_id,'hotel_id',v_row.hotel_id,
    'provider',v_row.provider,'connection_name',v_row.connection_name,
    'status',v_row.status
  );
end;
$$;

create or replace function public.get_my_hotel_integrations(p_hotel_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_result jsonb;
begin
  if v_actor is null or not exists(
    select 1 from public.hotels where hotel_id=p_hotel_id and owner_id=v_actor
  ) then raise exception 'Hotel owner access required'; end if;
  select coalesce(jsonb_agg(
    (to_jsonb(integration)-'token_hash')
      ||jsonb_build_object(
        'provider_name',provider.display_name,
        'provider_certification_status',provider.certification_status,
        'runtime_active',public.hotel_integration_runtime_active(integration.integration_id)
      )
    order by integration.created_at desc
  ),'[]'::jsonb)
  into v_result
  from public.hotel_integrations integration
  join public.hotel_pms_providers provider
    on provider.provider_key=integration.provider
  where integration.hotel_id=p_hotel_id;
  return v_result;
end;
$$;

create or replace function public._certify_hotel_pms_provider(
  p_provider_key text,
  p_display_name text,
  p_adapter_version text,
  p_supported_domains text[],
  p_evidence_uri text,
  p_certified_by text
)
returns public.hotel_pms_providers
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_provider public.hotel_pms_providers; v_domains text[];
begin
  select coalesce(array_agg(distinct domain_value order by domain_value),array[]::text[])
    into v_domains from unnest(coalesce(p_supported_domains,array[]::text[])) domain_value;
  if not(v_domains<@array['rooms','rates','inventory','room_status']::text[]) then
    raise exception 'Unsupported PMS authority domain';
  end if;
  insert into public.hotel_pms_providers(
    provider_key,display_name,adapter_version,certification_status,
    supported_domains,certification_evidence_uri,contract_reviewed_at,
    security_reviewed_at,dpa_reviewed_at,mapping_reviewed_at,pilot_approved_at,
    certified_at,certified_by,updated_at
  ) values(
    lower(btrim(p_provider_key)),btrim(p_display_name),btrim(p_adapter_version),
    'certified',v_domains,btrim(p_evidence_uri),now(),now(),now(),now(),now(),
    now(),nullif(btrim(coalesce(p_certified_by,'')),''),now()
  ) on conflict(provider_key) do update set
    display_name=excluded.display_name,adapter_version=excluded.adapter_version,
    certification_status='certified',supported_domains=excluded.supported_domains,
    certification_evidence_uri=excluded.certification_evidence_uri,
    contract_reviewed_at=excluded.contract_reviewed_at,
    security_reviewed_at=excluded.security_reviewed_at,
    dpa_reviewed_at=excluded.dpa_reviewed_at,
    mapping_reviewed_at=excluded.mapping_reviewed_at,
    pilot_approved_at=excluded.pilot_approved_at,
    certified_at=excluded.certified_at,certified_by=excluded.certified_by,
    updated_at=now()
  returning * into v_provider;
  return v_provider;
end;
$$;

create or replace function public._activate_hotel_pms_integration(
  p_integration_id uuid,
  p_external_hotel_id text,
  p_token_hash text,
  p_token_prefix text,
  p_authoritative_domains text[],
  p_activated_by text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_row public.hotel_integrations;
  v_provider public.hotel_pms_providers;
  v_domains text[];
begin
  select * into v_row from public.hotel_integrations
  where integration_id=p_integration_id for update;
  if v_row.integration_id is null then raise exception 'PMS request not found'; end if;
  select * into v_provider from public.hotel_pms_providers
  where provider_key=v_row.provider;
  if v_provider.certification_status<>'certified' then
    raise exception 'The named PMS adapter is not certified';
  end if;
  if not public._legal_launch_gate_is_approved('hotel_marketplace')
     or not public._legal_launch_gate_is_approved('hotel_pms_connected_mode') then
    raise exception 'Current hotel and PMS launch approvals are required';
  end if;
  if not exists(
    select 1 from public.hotels where hotel_id=v_row.hotel_id and status='active'
  ) then raise exception 'Only an eligible active hotel can enter connected mode'; end if;
  if v_row.hotel_authorized_at is null or v_row.hotel_authorized_by is null then
    raise exception 'Hotel owner authorization is required';
  end if;
  if nullif(btrim(coalesce(p_external_hotel_id,'')),'') is null
     or nullif(btrim(coalesce(p_token_hash,'')),'') is null
     or nullif(btrim(coalesce(p_token_prefix,'')),'') is null then
    raise exception 'External hotel mapping and credential hash are required';
  end if;
  select coalesce(array_agg(distinct domain_value order by domain_value),array[]::text[])
    into v_domains from unnest(coalesce(p_authoritative_domains,array[]::text[])) domain_value;
  if not(v_domains<@v_provider.supported_domains) then
    raise exception 'Requested authority exceeds the certified adapter mapping';
  end if;
  if exists(
    select 1 from public.hotel_integrations other
    where other.hotel_id=v_row.hotel_id and other.integration_id<>v_row.integration_id
      and other.status='active' and other.authoritative_domains&&v_domains
  ) then raise exception 'Another active connector owns one of these hotel domains'; end if;
  update public.hotel_integrations set
    status='active',external_hotel_id=btrim(p_external_hotel_id),
    token_hash=btrim(p_token_hash),token_prefix=btrim(p_token_prefix),
    authoritative_domains=v_domains,activated_at=now(),
    activated_by=nullif(btrim(coalesce(p_activated_by,'')),''),
    last_error=null,revoked_at=null,updated_at=now()
  where integration_id=v_row.integration_id
  returning * into v_row;
  return jsonb_build_object(
    'integration_id',v_row.integration_id,'hotel_id',v_row.hotel_id,
    'provider',v_row.provider,'status',v_row.status,
    'authoritative_domains',to_jsonb(v_row.authoritative_domains)
  );
end;
$$;

create or replace function public._set_hotel_pms_integration_status(
  p_integration_id uuid,
  p_status text,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  if p_status not in ('paused','error','revoked') then
    raise exception 'Only pause, error or revoke is allowed here';
  end if;
  update public.hotel_integrations set
    status=p_status,last_error=nullif(btrim(coalesce(p_reason,'')),''),
    revoked_at=case when p_status='revoked' then now() else revoked_at end,
    updated_at=now()
  where integration_id=p_integration_id;
  if not found then raise exception 'PMS integration not found'; end if;
  return true;
end;
$$;

create or replace function public._queue_hotel_pms_event(
  p_integration_id uuid,
  p_idempotency_key text,
  p_event_type text,
  p_external_reference text,
  p_details jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public','extensions'
as $$
declare v_event_id uuid;
begin
  if not public.hotel_integration_runtime_active(p_integration_id) then
    raise exception 'Certified active PMS integration required';
  end if;
  if nullif(btrim(coalesce(p_idempotency_key,'')),'') is null
     or nullif(btrim(coalesce(p_event_type,'')),'') is null then
    raise exception 'PMS event identity is required';
  end if;
  insert into public.hotel_integration_events(
    integration_id,idempotency_key,direction,event_type,external_reference,
    payload_hash,status,next_attempt_at,details
  ) values(
    p_integration_id,btrim(p_idempotency_key),'outbound',btrim(p_event_type),
    nullif(btrim(coalesce(p_external_reference,'')),''),
    encode(digest(coalesce(p_details,'{}'::jsonb)::text,'sha256'),'hex'),
    'pending',now(),coalesce(p_details,'{}'::jsonb)
  ) on conflict(integration_id,idempotency_key) do update set
    details=public.hotel_integration_events.details
  returning integration_event_id into v_event_id;
  return v_event_id;
end;
$$;

create or replace function public.queue_paid_hotel_booking_for_pms()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_integration public.hotel_integrations; v_event_id uuid;
begin
  if new.payment_status<>'paid' or new.status<>'confirmed'
     or (old.payment_status='paid' and old.status='confirmed') then
    return new;
  end if;
  select integration.* into v_integration
  from public.hotel_integrations integration
  where integration.hotel_id=new.hotel_id
    and 'reservations.receive'=any(integration.scopes)
    and public.hotel_integration_runtime_active(integration.integration_id)
  order by integration.activated_at desc,integration.integration_id
  limit 1;
  if v_integration.integration_id is null then return new; end if;
  v_event_id:=public._queue_hotel_pms_event(
    v_integration.integration_id,
    'hotel-booking:'||new.booking_id||':paid-confirmed:v1',
    'reservation.paid_confirmed',new.booking_id::text,
    jsonb_build_object(
      'booking_id',new.booking_id,'hotel_id',new.hotel_id,'room_id',new.room_id,
      'rate_plan_id',new.rate_plan_id,'check_in',new.check_in,
      'check_out',new.check_out,'guest_count',new.guest_count,
      'guest_name',new.guest_name,'guest_phone',new.guest_phone,
      'total_price',new.total_price,'booking_status',new.status,
      'payment_status',new.payment_status
    )
  );
  update public.hotel_bookings set
    integration_id=v_integration.integration_id,pms_sync_status='pending',
    pms_last_synced_at=null,updated_at=now()
  where booking_id=new.booking_id;
  return new;
end;
$$;

drop trigger if exists queue_paid_hotel_booking_for_pms_after_update
  on public.hotel_bookings;
create trigger queue_paid_hotel_booking_for_pms_after_update
after update of status,payment_status on public.hotel_bookings
for each row execute function public.queue_paid_hotel_booking_for_pms();

create or replace function public.guard_connected_hotel_domain()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_hotel_id integer:=case when tg_op='DELETE' then old.hotel_id else new.hotel_id end;
  v_domain text:=tg_argv[0];
begin
  if coalesce(auth.role(),'')<>'service_role'
     and public.hotel_integration_owns_domain(v_hotel_id,v_domain) then
    raise exception 'The certified PMS is the authority for hotel %',v_domain;
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

drop trigger if exists guard_connected_hotel_rooms on public.hotel_rooms;
create trigger guard_connected_hotel_rooms
before insert or update or delete on public.hotel_rooms
for each row execute function public.guard_connected_hotel_domain('rooms');

drop trigger if exists guard_connected_hotel_rates on public.hotel_rate_plans;
create trigger guard_connected_hotel_rates
before insert or update or delete on public.hotel_rate_plans
for each row execute function public.guard_connected_hotel_domain('rates');

drop trigger if exists guard_connected_hotel_inventory on public.hotel_inventory_daily;
create trigger guard_connected_hotel_inventory
before insert or update or delete on public.hotel_inventory_daily
for each row execute function public.guard_connected_hotel_domain('inventory');

drop trigger if exists guard_connected_hotel_room_status on public.hotel_room_units;
create trigger guard_connected_hotel_room_status
before insert or update or delete on public.hotel_room_units
for each row execute function public.guard_connected_hotel_domain('room_status');

-- Revocation/expiry makes runtime checks fail immediately; an explicit
-- non-approved approval update also pauses currently active connectors.
create or replace function public._close_revoked_legal_launch_gate()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_setting_key text;
begin
  if new.status='approved' and (new.expires_at is null or new.expires_at>now()) then
    return new;
  end if;
  v_setting_key:=case new.gate_key
    when 'worker_marketplace' then 'worker_marketplace_launch_enabled'
    when 'worker_identity_checks' then 'worker_identity_checks_enabled'
    else null
  end;
  if v_setting_key is not null then
    update public.platform_settings set value='false',updated_at=now()
    where key=v_setting_key and lower(btrim(value)) in ('true','1','yes','on');
  end if;
  if new.gate_key in ('hotel_marketplace','hotel_pms_connected_mode') then
    update public.hotel_bookings booking set
      pms_sync_status=case when booking.pms_sync_status='not_connected'
        then booking.pms_sync_status else 'review_required' end,
      updated_at=now()
    where exists(
      select 1 from public.hotel_integrations integration
      where integration.integration_id=booking.integration_id
        and integration.status='active'
    );
    update public.hotel_integrations set
      status='paused',last_error='Legal launch approval is not current',updated_at=now()
    where status='active';
  end if;
  return new;
end;
$$;

-- Remove the earlier provider-neutral self-service activation surface if it is
-- present on an already-provisioned preview database.
drop function if exists public.owner_create_hotel_integration(integer,text,text,text,text[]);
drop function if exists public.owner_rotate_hotel_integration(uuid);
drop function if exists public.owner_set_hotel_integration_status(uuid,text);

alter table public.hotel_pms_providers enable row level security;
alter table public.hotel_integrations enable row level security;
alter table public.hotel_integration_events enable row level security;

drop policy if exists hotel_pms_providers_creator_read on public.hotel_pms_providers;
create policy hotel_pms_providers_creator_read on public.hotel_pms_providers
for select to authenticated using(public.is_current_creator());

drop policy if exists hotel_integrations_owner_read on public.hotel_integrations;
create policy hotel_integrations_owner_read on public.hotel_integrations
for select to authenticated using(exists(
  select 1 from public.hotels hotel
  where hotel.hotel_id=hotel_integrations.hotel_id
    and hotel.owner_id=public.current_profile_user_id()
));

drop policy if exists hotel_integration_events_owner_read on public.hotel_integration_events;
create policy hotel_integration_events_owner_read on public.hotel_integration_events
for select to authenticated using(exists(
  select 1 from public.hotel_integrations integration
  join public.hotels hotel on hotel.hotel_id=integration.hotel_id
  where integration.integration_id=hotel_integration_events.integration_id
    and hotel.owner_id=public.current_profile_user_id()
));

revoke all on table public.hotel_pms_providers from public,anon,authenticated;
revoke all on table public.hotel_integrations from public,anon,authenticated;
revoke all on table public.hotel_integration_events from public,anon,authenticated;
grant select on table public.hotel_pms_providers to authenticated,service_role;
grant select on table public.hotel_integrations to authenticated,service_role;
grant select on table public.hotel_integration_events to authenticated,service_role;
grant insert,update,delete on table public.hotel_pms_providers to service_role;
grant insert,update,delete on table public.hotel_integrations to service_role;
grant insert,update,delete on table public.hotel_integration_events to service_role;

revoke all on function public.hotel_integration_runtime_active(uuid) from public,anon,authenticated;
revoke all on function public.hotel_integration_owns_domain(integer,text) from public,anon;
revoke all on function public.owner_request_hotel_pms_connection(integer,text,text) from public,anon;
revoke all on function public.get_my_hotel_integrations(integer) from public,anon;
revoke all on function public._certify_hotel_pms_provider(text,text,text,text[],text,text) from public,anon,authenticated;
revoke all on function public._activate_hotel_pms_integration(uuid,text,text,text,text[],text) from public,anon,authenticated;
revoke all on function public._set_hotel_pms_integration_status(uuid,text,text) from public,anon,authenticated;
revoke all on function public._queue_hotel_pms_event(uuid,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.queue_paid_hotel_booking_for_pms() from public,anon,authenticated;
revoke all on function public.guard_connected_hotel_domain() from public,anon,authenticated;
revoke all on function public._close_revoked_legal_launch_gate() from public,anon,authenticated;

grant execute on function public.hotel_integration_runtime_active(uuid) to service_role;
grant execute on function public.hotel_integration_owns_domain(integer,text) to authenticated,service_role;
grant execute on function public.owner_request_hotel_pms_connection(integer,text,text) to authenticated,service_role;
grant execute on function public.get_my_hotel_integrations(integer) to authenticated,service_role;
grant execute on function public._certify_hotel_pms_provider(text,text,text,text[],text,text) to service_role;
grant execute on function public._activate_hotel_pms_integration(uuid,text,text,text,text[],text) to service_role;
grant execute on function public._set_hotel_pms_integration_status(uuid,text,text) to service_role;
grant execute on function public._queue_hotel_pms_event(uuid,text,text,text,jsonb) to service_role;

comment on table public.hotel_pms_providers is
  'Named PMS adapters and certification evidence. An unlisted or uncertified provider cannot be activated.';
comment on table public.hotel_integrations is
  'Hotel-authorized PMS connection requests. Runtime active additionally requires current legal gates and a certified named adapter.';
comment on table public.hotel_integration_events is
  'Idempotent PMS outbox/inbox evidence with retry, acknowledgement, review and dead-letter states.';
