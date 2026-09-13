-- A hotel is one approved property with many room types, rate plans, venues,
-- dated inventory and reservations.  Public discovery is deliberately served
-- through redacting RPCs so exact coordinates and internal identifiers never
-- cross the pre-payment boundary.

alter table public.inspection_requests
  add column if not exists property_display_name text;

alter table public.inspection_requests
  drop constraint if exists inspection_requests_property_display_name_check;
alter table public.inspection_requests
  add constraint inspection_requests_property_display_name_check
  check (property_display_name is null or char_length(btrim(property_display_name)) between 2 and 100);

create or replace function public.create_my_property_inspection_batch_v4(p_batch_id uuid, p_items jsonb)
returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  actor_id text := (select auth.uid())::text;
  result jsonb;
  created jsonb;
  item jsonb;
  v_position integer;
  request_id uuid;
  v_max_guests integer;
  v_display_name text;
begin
  if actor_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.property_submission_batches b
    where b.id=p_batch_id and b.partner_user_id=actor_id and b.status in ('draft','submitting')
    for update
  ) then raise exception 'Property submission batch not found'; end if;
  update public.property_submission_batches set status='submitting',updated_at=now() where id=p_batch_id;
  result := public.create_my_property_inspection_batch_v3(p_items);
  for created in select value from jsonb_array_elements(result->'requests') loop
    v_position := (created->>'position')::integer;
    request_id := (created->>'id')::uuid;
    item := p_items->(v_position-1);
    v_max_guests := nullif(item->>'max_guests','')::integer;
    v_display_name := nullif(btrim(coalesce(item->>'property_display_name','')),'');
    if item->>'property_type'='apartment' and item->>'sub_type'='short_let' and coalesce(v_max_guests,0)<1 then
      raise exception 'Property %: Short Let guest capacity must be at least 1',v_position;
    end if;
    if item->>'property_type'='apartment' and item->>'sub_type'='short_let' and v_display_name is null then
      raise exception 'Property %: Short Stay property or host name is required',v_position;
    end if;
    update public.inspection_requests set
      submission_schema_version=2,
      hotel_program=case when item->>'property_type'='hotel' then item->'hotel_program' else null end,
      max_guests=case when item->>'property_type'='apartment' and item->>'sub_type'='short_let' then v_max_guests else null end,
      property_display_name=case when item->>'property_type'='apartment' and item->>'sub_type'='short_let' then v_display_name else null end,
      submission_batch_id=p_batch_id,
      updated_at=now()
    where id=request_id;
    update public.property_submission_items set
      inspection_request_id=request_id,status='submitted',updated_at=now()
    where batch_id=p_batch_id and position=v_position-1;
  end loop;
  update public.property_submission_batches set status='submitted',submitted_at=now(),updated_at=now() where id=p_batch_id;
  return result || jsonb_build_object('batch_id',p_batch_id);
exception when others then
  update public.property_submission_batches set status='draft',updated_at=now() where id=p_batch_id and partner_user_id=actor_id;
  raise;
end $$;

create or replace function public.get_my_property_pipeline_v2(p_stage text default 'all')
returns jsonb
language sql
set search_path to 'pg_catalog','public'
as $$
  select coalesce(jsonb_agg(
    item||jsonb_build_object(
      'property_display_name',ir.property_display_name,
      'submission_schema_version',ir.submission_schema_version,
      'submission_batch_id',ir.submission_batch_id,
      'hotel_program',coalesce(ir.hotel_program,'{}'::jsonb),
      'lifecycle_stage',ir.lifecycle_stage,
      'field_evidence_review_status',ir.field_evidence_review_status,
      'field_evidence_reviewed_by',ir.field_evidence_reviewed_by,
      'field_evidence_reviewed_at',ir.field_evidence_reviewed_at,
      'field_evidence_review_note',ir.field_evidence_review_note,
      'final_media_reviewed_at',ir.final_media_reviewed_at,
      'final_media_reviewed_by',ir.final_media_reviewed_by,
      'final_media_sources',ir.final_media_sources,
      'final_hotel_media_sources',ir.final_hotel_media_sources,
      'final_room_media_sources',ir.final_room_media_sources
    ) order by (item->>'created_at')::timestamptz desc
  ),'[]'::jsonb)
  from jsonb_array_elements(public.get_my_property_pipeline('all')) item
  join public.inspection_requests ir on ir.id=(item->>'id')::uuid
  where p_stage='all'
    or (p_stage='new' and ir.lifecycle_stage in ('access_required','access_review','inspection_ready'))
    or (p_stage='inspection' and ir.lifecycle_stage='inspection')
    or (p_stage='review' and ir.lifecycle_stage='awaiting_review')
    or (p_stage='ready' and ir.lifecycle_stage='ready_to_prepare')
    or (p_stage='preparing' and ir.lifecycle_stage='listing_prepared')
    or (p_stage='published' and ir.lifecycle_stage='live')
    or (p_stage='rejected' and ir.lifecycle_stage in ('changes_requested','rejected'));
$$;

create table if not exists public.hotel_rate_plans (
  rate_plan_id integer generated by default as identity primary key,
  hotel_id integer not null references public.hotels(hotel_id) on delete cascade,
  room_id integer not null references public.hotel_rooms(room_id) on delete cascade,
  name text not null,
  description text,
  meal_plan text not null default 'room_only'
    check (meal_plan in ('room_only','breakfast','half_board','full_board','all_inclusive')),
  payment_timing text not null default 'pay_now'
    check (payment_timing in ('pay_now','before_arrival','at_property')),
  refundable boolean not null default false,
  cancellation_hours integer check (cancellation_hours is null or cancellation_hours >= 0),
  price_per_night integer not null check (price_per_night > 0),
  included_features text[] not null default '{}',
  active boolean not null default true,
  source_system text not null default 'wehouse',
  external_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (room_id, name),
  unique (hotel_id, rate_plan_id),
  unique (room_id, rate_plan_id)
);

create table if not exists public.hotel_venues (
  venue_id integer generated by default as identity primary key,
  hotel_id integer not null references public.hotels(hotel_id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('restaurant','bar','cafe','spa','lounge','pool','gym','other')),
  description text,
  opening_hours text,
  package_notes text,
  active boolean not null default true,
  external_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hotel_id, name)
);

alter table public.hotel_bookings
  add column if not exists rate_plan_id integer references public.hotel_rate_plans(rate_plan_id) on delete restrict,
  add column if not exists rate_plan_name text,
  add column if not exists rate_plan_snapshot jsonb not null default '{}'::jsonb;

alter table public.hotel_rooms
  add column if not exists source_system text not null default 'wehouse',
  add column if not exists external_reference text;

create index if not exists hotel_rate_plans_hotel_room_active_idx
  on public.hotel_rate_plans(hotel_id, room_id, active);
create index if not exists hotel_venues_hotel_active_idx
  on public.hotel_venues(hotel_id, active);
create index if not exists hotel_bookings_rate_plan_idx
  on public.hotel_bookings(rate_plan_id);

insert into public.hotel_rate_plans(
  hotel_id, room_id, name, description, meal_plan, payment_timing,
  refundable, price_per_night, included_features
)
select r.hotel_id, r.room_id, 'Room only', 'Room without a meal package',
       'room_only', 'pay_now', false, r.price_per_night, '{}'::text[]
from public.hotel_rooms r
where not exists (
  select 1 from public.hotel_rate_plans rp where rp.room_id = r.room_id
);

with default_plans as (
  select distinct on (plan.room_id) plan.*
  from public.hotel_rate_plans plan
  order by plan.room_id, (plan.name = 'Room only') desc, plan.price_per_night, plan.rate_plan_id
)
update public.hotel_bookings hb
set rate_plan_id = rp.rate_plan_id,
    rate_plan_name = rp.name,
    rate_plan_snapshot = jsonb_build_object(
      'rate_plan_id', rp.rate_plan_id,
      'name', rp.name,
      'meal_plan', rp.meal_plan,
      'payment_timing', rp.payment_timing,
      'refundable', rp.refundable,
      'cancellation_hours', rp.cancellation_hours,
      'price_per_night', rp.price_per_night,
      'included_features', rp.included_features
    )
from default_plans rp
where hb.rate_plan_id is null and rp.room_id = hb.room_id;

alter table public.hotel_rate_plans enable row level security;
alter table public.hotel_venues enable row level security;

drop policy if exists hotel_rate_plans_read on public.hotel_rate_plans;
create policy hotel_rate_plans_read on public.hotel_rate_plans
for select to authenticated using (
  active and exists (
    select 1 from public.hotels h
    where h.hotel_id = hotel_rate_plans.hotel_id and h.status = 'active'
  )
  or public.current_actor_hotel_role(hotel_id) in ('owner','manager','staff')
  or public.current_profile_role() = 'creator'
  or exists (
    select 1 from public.hotels h
    where h.hotel_id = hotel_rate_plans.hotel_id
      and (public.current_profile_role()='admin' or (public.current_profile_role()='staff' and public.current_staff_has_permission('operations')))
      and public.current_actor_in_scope(h.state, h.city)
  )
);

drop policy if exists hotel_venues_read on public.hotel_venues;
create policy hotel_venues_read on public.hotel_venues
for select to authenticated using (
  active and exists (
    select 1 from public.hotels h
    where h.hotel_id = hotel_venues.hotel_id and h.status = 'active'
  )
  or public.current_actor_hotel_role(hotel_id) in ('owner','manager','staff')
  or public.current_profile_role() = 'creator'
  or exists (
    select 1 from public.hotels h
    where h.hotel_id = hotel_venues.hotel_id
      and (public.current_profile_role()='admin' or (public.current_profile_role()='staff' and public.current_staff_has_permission('operations')))
      and public.current_actor_in_scope(h.state, h.city)
  )
);

create or replace function public.partner_create_hotel_room(
  p_hotel_id integer,
  p_room_type text,
  p_description text,
  p_price_per_night integer,
  p_max_guests integer,
  p_bed_type text,
  p_total_rooms integer,
  p_amenities text[] default '{}',
  p_images text[] default '{}'
) returns public.hotel_rooms
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_room public.hotel_rooms;
  v_role text;
begin
  v_role := public.current_actor_hotel_role(p_hotel_id);
  if v_role not in ('owner','manager') then
    raise exception 'Hotel owner or Manager access required';
  end if;
  if not exists (
    select 1 from public.hotels h where h.hotel_id = p_hotel_id
      and h.status = 'active' and h.approved_at is not null and h.published_at is not null
  ) then
    raise exception 'Rooms can be managed after the hotel is approved and live';
  end if;
  if nullif(btrim(p_room_type),'') is null or coalesce(p_price_per_night,0) <= 0
     or coalesce(p_max_guests,0) < 1 or coalesce(p_total_rooms,0) < 1 then
    raise exception 'Valid room name, rate, capacity and inventory are required';
  end if;
  insert into public.hotel_rooms(
    hotel_id, room_type, description, price_per_night, max_guests,
    bed_type, total_rooms, amenities, images, source_system
  ) values (
    p_hotel_id, btrim(p_room_type), nullif(btrim(coalesce(p_description,'')),''),
    p_price_per_night, p_max_guests, nullif(btrim(coalesce(p_bed_type,'')),''),
    p_total_rooms, coalesce(p_amenities,'{}'), coalesce(p_images,'{}'), 'wehouse'
  ) returning * into v_room;
  insert into public.hotel_rate_plans(
    hotel_id, room_id, name, description, meal_plan, payment_timing,
    refundable, price_per_night, included_features
  ) values (
    p_hotel_id, v_room.room_id, 'Room only', 'Room without a meal package',
    'room_only', 'pay_now', false, p_price_per_night, '{}'
  );
  return v_room;
end;
$$;

create or replace function public.partner_update_hotel_room(
  p_room_id integer,
  p_room_type text,
  p_description text,
  p_price_per_night integer,
  p_max_guests integer,
  p_bed_type text,
  p_total_rooms integer,
  p_amenities text[] default null,
  p_images text[] default null
) returns public.hotel_rooms
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_room public.hotel_rooms;
  v_role text;
begin
  select * into v_room from public.hotel_rooms where room_id = p_room_id for update;
  if v_room.room_id is null then raise exception 'Room type not found'; end if;
  v_role := public.current_actor_hotel_role(v_room.hotel_id);
  if v_role not in ('owner','manager') then
    raise exception 'Hotel owner or Manager access required';
  end if;
  if nullif(btrim(p_room_type),'') is null or coalesce(p_price_per_night,0) <= 0
     or coalesce(p_max_guests,0) < 1 or coalesce(p_total_rooms,0) < 1 then
    raise exception 'Valid room name, rate, capacity and inventory are required';
  end if;
  update public.hotel_rooms set
    room_type = btrim(p_room_type),
    description = nullif(btrim(coalesce(p_description,'')),''),
    price_per_night = p_price_per_night,
    max_guests = p_max_guests,
    bed_type = nullif(btrim(coalesce(p_bed_type,'')),''),
    total_rooms = p_total_rooms,
    amenities = coalesce(p_amenities, amenities),
    images = coalesce(p_images, images),
    updated_at = now()
  where room_id = p_room_id returning * into v_room;

  update public.hotel_rate_plans
  set price_per_night = p_price_per_night, updated_at = now()
  where room_id = p_room_id and name = 'Room only' and source_system = 'wehouse';
  return v_room;
end;
$$;

create or replace function public.partner_save_hotel_rate_plan(
  p_rate_plan_id integer,
  p_room_id integer,
  p_name text,
  p_description text,
  p_meal_plan text,
  p_payment_timing text,
  p_refundable boolean,
  p_cancellation_hours integer,
  p_price_per_night integer,
  p_included_features text[],
  p_active boolean default true
) returns public.hotel_rate_plans
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_room public.hotel_rooms;
  v_plan public.hotel_rate_plans;
begin
  select * into v_room from public.hotel_rooms where room_id = p_room_id;
  if v_room.room_id is null then raise exception 'Room type not found'; end if;
  if public.current_actor_hotel_role(v_room.hotel_id) not in ('owner','manager') then
    raise exception 'Hotel owner or Manager access required';
  end if;
  if nullif(btrim(p_name),'') is null or coalesce(p_price_per_night,0) <= 0 then
    raise exception 'Package name and nightly price are required';
  end if;
  if p_meal_plan not in ('room_only','breakfast','half_board','full_board','all_inclusive')
     or p_payment_timing not in ('pay_now','before_arrival','at_property') then
    raise exception 'Choose valid meal and payment options';
  end if;
  if coalesce(p_refundable,false) and p_cancellation_hours is null then
    raise exception 'Refundable packages need a cancellation window';
  end if;
  if p_rate_plan_id is not null and not coalesce(p_active,true) and not exists (
    select 1 from public.hotel_rate_plans plan
    where plan.room_id=v_room.room_id and plan.active and plan.rate_plan_id<>p_rate_plan_id
  ) then
    raise exception 'A room must keep at least one visible package';
  end if;

  if p_rate_plan_id is null then
    insert into public.hotel_rate_plans(
      hotel_id, room_id, name, description, meal_plan, payment_timing,
      refundable, cancellation_hours, price_per_night, included_features, active
    ) values (
      v_room.hotel_id, v_room.room_id, btrim(p_name), nullif(btrim(coalesce(p_description,'')),''),
      p_meal_plan, p_payment_timing, coalesce(p_refundable,false),
      case when coalesce(p_refundable,false) then p_cancellation_hours else null end,
      p_price_per_night, coalesce(p_included_features,'{}'), coalesce(p_active,true)
    ) returning * into v_plan;
  else
    update public.hotel_rate_plans set
      name = btrim(p_name),
      description = nullif(btrim(coalesce(p_description,'')),''),
      meal_plan = p_meal_plan,
      payment_timing = p_payment_timing,
      refundable = coalesce(p_refundable,false),
      cancellation_hours = case when coalesce(p_refundable,false) then p_cancellation_hours else null end,
      price_per_night = p_price_per_night,
      included_features = coalesce(p_included_features,'{}'),
      active = coalesce(p_active,true),
      updated_at = now()
    where rate_plan_id = p_rate_plan_id and room_id = v_room.room_id
    returning * into v_plan;
    if v_plan.rate_plan_id is null then raise exception 'Package not found for this room'; end if;
  end if;
  return v_plan;
end;
$$;

create or replace function public.partner_save_hotel_venue(
  p_venue_id integer,
  p_hotel_id integer,
  p_name text,
  p_kind text,
  p_description text,
  p_opening_hours text,
  p_package_notes text,
  p_active boolean default true
) returns public.hotel_venues
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_venue public.hotel_venues;
begin
  if public.current_actor_hotel_role(p_hotel_id) not in ('owner','manager') then
    raise exception 'Hotel owner or Manager access required';
  end if;
  if nullif(btrim(p_name),'') is null
     or p_kind not in ('restaurant','bar','cafe','spa','lounge','pool','gym','other') then
    raise exception 'Venue name and type are required';
  end if;
  if p_venue_id is null then
    insert into public.hotel_venues(hotel_id,name,kind,description,opening_hours,package_notes,active)
    values (p_hotel_id,btrim(p_name),p_kind,nullif(btrim(coalesce(p_description,'')),''),
      nullif(btrim(coalesce(p_opening_hours,'')),''),nullif(btrim(coalesce(p_package_notes,'')),''),coalesce(p_active,true))
    returning * into v_venue;
  else
    update public.hotel_venues set
      name=btrim(p_name), kind=p_kind,
      description=nullif(btrim(coalesce(p_description,'')),''),
      opening_hours=nullif(btrim(coalesce(p_opening_hours,'')),''),
      package_notes=nullif(btrim(coalesce(p_package_notes,'')),''),
      active=coalesce(p_active,true), updated_at=now()
    where venue_id=p_venue_id and hotel_id=p_hotel_id
    returning * into v_venue;
    if v_venue.venue_id is null then raise exception 'Hotel venue not found'; end if;
  end if;
  return v_venue;
end;
$$;

create or replace function private.hotel_booking_quote_v2(
  p_room_id integer,
  p_rate_plan_id integer,
  p_check_in date,
  p_check_out date,
  p_exclude_booking_id integer default null,
  p_include_live_holds boolean default true
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_room public.hotel_rooms;
  v_plan public.hotel_rate_plans;
  v_day date;
  v_capacity integer;
  v_reserved integer;
  v_base_rate numeric;
  v_rate numeric;
  v_total numeric := 0;
begin
  if p_check_in is null or p_check_out is null or p_check_out <= p_check_in then
    raise exception 'Choose valid check-in and check-out dates';
  end if;
  select * into v_room from public.hotel_rooms where room_id = p_room_id for update;
  select * into v_plan from public.hotel_rate_plans
  where rate_plan_id = p_rate_plan_id and room_id = p_room_id and active;
  if v_room.room_id is null or coalesce(v_room.total_rooms,0) < 1
     or v_plan.rate_plan_id is null or coalesce(v_plan.price_per_night,0) <= 0 then
    raise exception 'Room package is not available for booking';
  end if;

  for v_day in select generate_series(p_check_in,p_check_out-1,interval '1 day')::date loop
    select
      case when coalesce(i.closed,false) then 0 else coalesce(i.available_quantity,v_room.total_rooms) end,
      coalesce(i.rate_override,v_room.price_per_night)
    into v_capacity,v_base_rate
    from (select 1) seed
    left join public.hotel_inventory_daily i
      on i.room_id=v_room.room_id and i.inventory_date=v_day;

    select count(*)::integer into v_reserved
    from public.hotel_bookings hb
    where hb.room_id=v_room.room_id
      and hb.booking_id is distinct from p_exclude_booking_id
      and hb.check_in<=v_day and hb.check_out>v_day
      and (hb.status in ('confirmed','checked_in') or (
        p_include_live_holds and hb.status='pending'
        and coalesce(hb.payment_expires_at,hb.created_at+interval '30 minutes')>now()
      ));
    if coalesce(v_capacity,0)<=v_reserved then
      return jsonb_build_object('available',false,'blocked_date',v_day,'capacity',coalesce(v_capacity,0),'reserved',v_reserved);
    end if;
    v_rate := greatest(1,v_base_rate + (v_plan.price_per_night-v_room.price_per_night));
    v_total := v_total + v_rate;
  end loop;
  return jsonb_build_object(
    'available',true,'nights',p_check_out-p_check_in,'total_price',round(v_total,2),
    'rate_plan_id',v_plan.rate_plan_id,'rate_plan_name',v_plan.name,
    'meal_plan',v_plan.meal_plan,'payment_timing',v_plan.payment_timing,
    'refundable',v_plan.refundable,'cancellation_hours',v_plan.cancellation_hours
  );
end;
$$;

create or replace function public.quote_hotel_room_rate(
  p_hotel_id integer,
  p_room_id integer,
  p_rate_plan_id integer,
  p_check_in date,
  p_check_out date
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
begin
  if p_check_in is null or p_check_out is null or p_check_in <= current_date or p_check_out <= p_check_in then
    raise exception 'Choose valid future check-in and check-out dates';
  end if;
  if not exists (
    select 1 from public.hotels h
    join public.hotel_rooms r on r.hotel_id=h.hotel_id
    join public.hotel_rate_plans rp on rp.room_id=r.room_id and rp.hotel_id=h.hotel_id
    where h.hotel_id=p_hotel_id and r.room_id=p_room_id and rp.rate_plan_id=p_rate_plan_id
      and rp.active and h.status='active' and h.approved_at is not null and h.published_at is not null
  ) then raise exception 'Hotel room package is not available'; end if;
  return private.hotel_booking_quote_v2(p_room_id,p_rate_plan_id,p_check_in,p_check_out,null,true);
end;
$$;

create or replace function public.create_my_hotel_booking_with_rate(
  p_hotel_id integer,
  p_room_id integer,
  p_rate_plan_id integer,
  p_check_in date,
  p_check_out date,
  p_guest_count integer,
  p_guest_name text,
  p_guest_phone text,
  p_special_requests text default null
) returns public.hotel_bookings
language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
declare v_actor public.profiles; v_result public.hotel_bookings;
begin
  select * into v_actor from public.profiles
  where auth_id=auth.uid()::text and role='user'
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null then raise exception 'Active User account required'; end if;
  insert into public.hotel_bookings(
    hotel_id,room_id,rate_plan_id,user_id,check_in,check_out,guest_count,
    guest_name,guest_phone,special_requests
  ) values (
    p_hotel_id,p_room_id,p_rate_plan_id,v_actor.user_id,p_check_in,p_check_out,p_guest_count,
    btrim(p_guest_name),btrim(p_guest_phone),nullif(btrim(p_special_requests),'')
  ) returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.enforce_hotel_booking_integrity()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor public.profiles;
  v_hotel public.hotels;
  v_room public.hotel_rooms;
  v_plan public.hotel_rate_plans;
  v_quote jsonb;
begin
  select * into v_actor from public.profiles
  where auth_id=auth.uid()::text and not coalesce(deleted,false)
    and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if tg_op='INSERT' then
    if v_actor.user_id is null or v_actor.role<>'user' then raise exception 'Active User account required'; end if;
    new.user_id:=v_actor.user_id; new.status:='pending'; new.payment_status:='unpaid';
    new.payment_expires_at:=coalesce(new.payment_expires_at,now()+interval '30 minutes');
    if new.check_in is null or new.check_out is null or new.check_in<=current_date or new.check_out<=new.check_in then
      raise exception 'Choose valid future check-in and check-out dates';
    end if;
    if coalesce(new.guest_count,0)<1 then raise exception 'At least one guest is required'; end if;
    if nullif(btrim(new.guest_name),'') is null or nullif(btrim(new.guest_phone),'') is null then
      raise exception 'Guest name and phone are required';
    end if;
    select * into v_hotel from public.hotels where hotel_id=new.hotel_id and status='active'
      and approved_at is not null and published_at is not null;
    if v_hotel.hotel_id is null then raise exception 'Hotel is not available for booking'; end if;
    select * into v_room from public.hotel_rooms where room_id=new.room_id and hotel_id=new.hotel_id;
    if v_room.room_id is null then raise exception 'Room type not found for this hotel'; end if;
    if new.guest_count>coalesce(v_room.max_guests,2) then raise exception 'Guest count exceeds this room type capacity'; end if;
    if new.rate_plan_id is null then
      select * into v_plan from public.hotel_rate_plans where room_id=new.room_id and active
      order by (name='Room only') desc,price_per_night,rate_plan_id limit 1;
      new.rate_plan_id:=v_plan.rate_plan_id;
    else
      select * into v_plan from public.hotel_rate_plans
      where rate_plan_id=new.rate_plan_id and room_id=new.room_id and hotel_id=new.hotel_id and active;
    end if;
    if v_plan.rate_plan_id is null then raise exception 'Room package is not available'; end if;
    v_quote:=private.hotel_booking_quote_v2(new.room_id,v_plan.rate_plan_id,new.check_in,new.check_out,null,true);
    if not coalesce((v_quote->>'available')::boolean,false) then
      raise exception 'This room type is unavailable on %',v_quote->>'blocked_date';
    end if;
    new.total_nights:=(v_quote->>'nights')::integer;
    new.total_price:=(v_quote->>'total_price')::numeric;
    new.rate_plan_name:=v_plan.name;
    new.rate_plan_snapshot:=jsonb_build_object(
      'rate_plan_id',v_plan.rate_plan_id,'name',v_plan.name,'description',v_plan.description,
      'meal_plan',v_plan.meal_plan,'payment_timing',v_plan.payment_timing,
      'refundable',v_plan.refundable,'cancellation_hours',v_plan.cancellation_hours,
      'price_per_night',v_plan.price_per_night,'included_features',v_plan.included_features
    );
    new.created_at:=coalesce(new.created_at,now()); new.updated_at:=now(); return new;
  end if;
  if tg_op='UPDATE' then
    if current_user not in ('anon','authenticated') then new.updated_at:=now(); return new; end if;
    if v_actor.user_id is null then raise exception 'Authentication required'; end if;
    if v_actor.role='creator' then new.updated_at:=now(); return new; end if;
    if v_actor.role<>'user' or old.user_id is distinct from v_actor.user_id then raise exception 'Booking owner access required'; end if;
    if old.status<>'pending' or new.status<>'cancelled' or old.payment_status='paid' then
      raise exception 'Customers can only cancel their own unpaid pending booking';
    end if;
    new.hotel_id:=old.hotel_id; new.room_id:=old.room_id; new.rate_plan_id:=old.rate_plan_id;
    new.rate_plan_name:=old.rate_plan_name; new.rate_plan_snapshot:=old.rate_plan_snapshot;
    new.user_id:=old.user_id; new.check_in:=old.check_in; new.check_out:=old.check_out;
    new.guest_count:=old.guest_count; new.total_nights:=old.total_nights; new.total_price:=old.total_price;
    new.guest_name:=old.guest_name; new.guest_phone:=old.guest_phone;
    new.special_requests:=old.special_requests; new.payment_reference:=old.payment_reference;
    new.paid_at:=old.paid_at; new.confirmed_at:=old.confirmed_at;
    new.created_at:=old.created_at; new.updated_at:=now(); return new;
  end if;
  return new;
end;
$$;

create or replace function public.fulfill_hotel_booking_payment()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
declare v_booking public.hotel_bookings; v_quote jsonb;
begin
  if new.purpose<>'hotel_booking' or new.status not in ('paid','completed') then return new; end if;
  if tg_op='UPDATE' and old.status in ('paid','completed') then return new; end if;
  select * into v_booking from public.hotel_bookings
  where booking_id=new.hotel_booking_id and user_id=coalesce(new.payer_user_id,new.user_id) for update;
  if v_booking.booking_id is null then raise exception 'Hotel payment has no matching booking'; end if;
  if v_booking.payment_reference is distinct from new.paystack_reference then raise exception 'Hotel payment reference mismatch'; end if;
  if round(v_booking.total_price,2)<>round(coalesce(new.amount_total,new.amount),2) then raise exception 'Hotel payment amount mismatch'; end if;
  if v_booking.status='confirmed' and v_booking.payment_status='paid' then return new; end if;
  v_quote:=private.hotel_booking_quote_v2(v_booking.room_id,v_booking.rate_plan_id,v_booking.check_in,v_booking.check_out,v_booking.booking_id,false);
  if not coalesce((v_quote->>'available')::boolean,false) then
    update public.hotel_bookings set status='payment_conflict',payment_status='paid',
      paid_at=coalesce(paid_at,now()),updated_at=now() where booking_id=v_booking.booking_id;
    return new;
  end if;
  update public.hotel_bookings set status='confirmed',payment_status='paid',
    paid_at=coalesce(paid_at,now()),confirmed_at=coalesce(confirmed_at,now()),updated_at=now()
  where booking_id=v_booking.booking_id;
  return new;
end;
$$;

create or replace function public.create_hotel_booking_payment(p_booking_id integer)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id text; v_booking public.hotel_bookings; v_hotel public.hotels;
  v_reference text; v_pending public.booking_payments;
begin
  select user_id into v_user_id from public.profiles
  where auth_id=auth.uid()::text and role='user' and not coalesce(deleted,false)
    and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_user_id is null then raise exception 'Active User account required'; end if;
  select * into v_booking from public.hotel_bookings
  where booking_id=p_booking_id and user_id=v_user_id for update;
  if v_booking.booking_id is null then raise exception 'Hotel booking not found'; end if;
  if v_booking.status='confirmed' and v_booking.payment_status='paid' then
    return jsonb_build_object('success',true,'already_paid',true,'booking_code',v_booking.booking_code);
  end if;
  if v_booking.status<>'pending' then raise exception 'Hotel booking is no longer awaiting payment'; end if;
  if v_booking.payment_expires_at is null or v_booking.payment_expires_at<=now() then
    update public.hotel_bookings set status='expired',payment_status='expired',updated_at=now() where booking_id=v_booking.booking_id;
    raise exception 'Hotel checkout hold has expired. Choose the room again.';
  end if;
  if coalesce(v_booking.total_price,0)<=0 then raise exception 'Hotel booking amount is invalid'; end if;
  select * into v_hotel from public.hotels where hotel_id=v_booking.hotel_id;
  if v_hotel.hotel_id is null then raise exception 'Hotel not found'; end if;
  select * into v_pending from public.booking_payments
  where user_id=v_user_id and purpose='hotel_booking' and hotel_booking_id=v_booking.booking_id and status='pending'
    and round(coalesce(amount_total,amount),2)=round(v_booking.total_price,2)
  order by created_at desc limit 1;
  if v_pending.id is not null then
    update public.hotel_bookings set payment_status='payment_pending',payment_reference=v_pending.paystack_reference,updated_at=now()
    where booking_id=v_booking.booking_id;
    return jsonb_build_object('success',true,'reference',v_pending.paystack_reference,'amount',coalesce(v_pending.amount_total,v_pending.amount),'existing',true,'booking_code',v_booking.booking_code);
  end if;
  v_reference:='WHHOTEL-'||upper(replace(gen_random_uuid()::text,'-',''));
  insert into public.booking_payments(
    payment_reference,user_id,payer_user_id,type,booking_type,hotel_booking_id,amount,amount_total,currency,status,
    purpose,payment_method,paystack_reference,metadata,created_at,updated_at
  ) values (
    v_reference,v_user_id,v_user_id,'hotel','hotel',v_booking.booking_id,v_booking.total_price,v_booking.total_price,'NGN','pending',
    'hotel_booking','paystack',v_reference,jsonb_build_object(
      'hotel_booking_id',v_booking.booking_id,'hotel_id',v_booking.hotel_id,'hotel_name',v_hotel.name,
      'room_id',v_booking.room_id,'rate_plan_id',v_booking.rate_plan_id,'rate_plan_name',v_booking.rate_plan_name,
      'booking_code',v_booking.booking_code,'check_in',v_booking.check_in,'check_out',v_booking.check_out,
      'eligible_partner_amount',v_booking.total_price
    ),now(),now()
  );
  update public.hotel_bookings set payment_status='payment_pending',payment_reference=v_reference,updated_at=now()
  where booking_id=v_booking.booking_id;
  return jsonb_build_object('success',true,'reference',v_reference,'amount',v_booking.total_price,'existing',false,'booking_code',v_booking.booking_code);
end;
$$;

create or replace function public.get_discoverable_hotels()
returns jsonb language sql stable security definer
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(
    (to_jsonb(h)-'address'-'gps_latitude'-'gps_longitude'-'owner_id'-'inspection_request_id'-'approved_by')
    || jsonb_build_object(
      'address',null,
      'gps_latitude',case when h.gps_latitude is null then null else round(h.gps_latitude,2) end,
      'gps_longitude',case when h.gps_longitude is null then null else round(h.gps_longitude,2) end,
      'location_exact',false,
      'hotel_rooms',coalesce((
        select jsonb_agg(jsonb_build_object(
          'room_id',r.room_id,'price_per_night',coalesce((select min(rp.price_per_night) from public.hotel_rate_plans rp where rp.room_id=r.room_id and rp.active),r.price_per_night),'room_type',r.room_type
        ) order by r.price_per_night) from public.hotel_rooms r where r.hotel_id=h.hotel_id
      ),'[]'::jsonb)
    ) order by h.featured desc,h.created_at desc
  ),'[]'::jsonb)
  from public.hotels h where h.status='active' and h.approved_at is not null and h.published_at is not null
$$;

create or replace function public.get_public_hotel_detail(p_hotel_id integer)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  v_hotel public.hotels; v_actor public.profiles;
  v_internal boolean:=false; v_paid boolean:=false;
  v_rooms jsonb; v_venues jsonb;
begin
  select * into v_hotel from public.hotels where hotel_id=p_hotel_id;
  if v_hotel.hotel_id is null then return null; end if;
  select * into v_actor from public.profiles where auth_id=auth.uid()::text
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor.user_id is not null then
    v_internal:=v_hotel.owner_id=v_actor.user_id
      or exists(select 1 from public.hotel_team_members tm where tm.hotel_id=v_hotel.hotel_id and tm.member_user_id=v_actor.user_id and tm.status='active')
      or v_actor.role='creator'
      or (v_actor.role='admin' and public.current_actor_in_scope(v_hotel.state,v_hotel.city))
      or (v_actor.role='staff' and public.current_staff_has_permission('operations') and public.current_actor_in_scope(v_hotel.state,v_hotel.city));
    v_paid:=exists(select 1 from public.hotel_bookings hb where hb.hotel_id=v_hotel.hotel_id and hb.user_id=v_actor.user_id
      and hb.payment_status='paid' and hb.status in ('confirmed','checked_in','checked_out','completed'));
  end if;
  if v_hotel.status<>'active' and not v_internal then return null; end if;
  select coalesce(jsonb_agg(
    to_jsonb(r)||jsonb_build_object('rate_plans',coalesce((
      select jsonb_agg(to_jsonb(rp) order by rp.price_per_night,rp.rate_plan_id)
      from public.hotel_rate_plans rp where rp.room_id=r.room_id and (rp.active or v_internal)
    ),'[]'::jsonb)) order by r.price_per_night
  ),'[]'::jsonb) into v_rooms from public.hotel_rooms r where r.hotel_id=v_hotel.hotel_id;
  select coalesce(jsonb_agg(to_jsonb(v) order by v.kind,v.name),'[]'::jsonb)
  into v_venues from public.hotel_venues v where v.hotel_id=v_hotel.hotel_id and (v.active or v_internal);
  if v_internal then
    return to_jsonb(v_hotel)||jsonb_build_object('hotel_rooms',v_rooms,'venues',v_venues,'location_exact',true);
  end if;
  return (to_jsonb(v_hotel)-'address'-'gps_latitude'-'gps_longitude'-'owner_id'-'inspection_request_id'-'approved_by')
    ||jsonb_build_object(
      'address',case when v_paid then v_hotel.address else null end,
      'gps_latitude',case when v_hotel.gps_latitude is null then null when v_paid then v_hotel.gps_latitude else round(v_hotel.gps_latitude,2) end,
      'gps_longitude',case when v_hotel.gps_longitude is null then null when v_paid then v_hotel.gps_longitude else round(v_hotel.gps_longitude,2) end,
      'hotel_rooms',v_rooms,'venues',v_venues,'location_exact',v_paid
    );
end;
$$;

create or replace function public.get_discoverable_listings()
returns jsonb language sql stable security definer
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(
    (to_jsonb(l)-'address'-'gps_latitude'-'gps_longitude'-'location_accuracy_m'-'owner_id'-'partner_id'-'chat_agent_id'-'contact_phone'-'reserved_by'-'occupied_by'-'current_reservation_id'-'inspection_request_id')
    ||jsonb_build_object(
      'address',null,
      'gps_latitude',case when l.gps_latitude is null then null else round(l.gps_latitude,2) end,
      'gps_longitude',case when l.gps_longitude is null then null else round(l.gps_longitude,2) end,
      'location_exact',false,
      'partner_display_name',coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.username),''))
    ) order by l.created_at desc
  ),'[]'::jsonb)
  from public.listings l
  left join public.profiles p on p.user_id=coalesce(l.partner_id,l.owner_id)
  where l.deleted_at is null and l.inspection_request_id is not null and l.approved_at is not null
    and (l.status='available' or (l.status='occupied' and l.sub_type='short_let'))
$$;

create or replace function public.get_public_listing_detail(p_listing_id text)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  v_listing public.listings; v_actor public.profiles; v_partner_name text;
  v_internal boolean:=false; v_paid boolean:=false;
begin
  select * into v_listing from public.listings l
  where (l.id::text=p_listing_id or l.listing_id=p_listing_id) and l.deleted_at is null limit 1;
  if v_listing.id is null then return null; end if;
  select coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.username),'')) into v_partner_name
  from public.profiles p where p.user_id=coalesce(v_listing.partner_id,v_listing.owner_id);
  select * into v_actor from public.profiles where auth_id=auth.uid()::text
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor.user_id is not null then
    v_internal:=v_listing.owner_id=v_actor.user_id or v_listing.partner_id=v_actor.user_id or v_actor.role='creator'
      or (v_actor.role='admin' and public.current_actor_in_scope(v_listing.state,v_listing.city))
      or (v_actor.role='staff' and public.current_staff_has_permission('operations') and public.current_actor_in_scope(v_listing.state,v_listing.city));
    v_paid:=exists(select 1 from public.reservations r where r.user_id=v_actor.user_id
      and r.listing_id in (v_listing.id::text,v_listing.listing_id)
      and (r.paid_at is not null or r.manual_payment_status in ('paid','completed'))
      and r.status not in ('cancelled','expired'));
  end if;
  if not v_internal and not (v_listing.status='available' or (v_listing.status='occupied' and v_listing.sub_type='short_let')) then return null; end if;
  if v_internal then return to_jsonb(v_listing)||jsonb_build_object('location_exact',true,'partner_display_name',v_partner_name); end if;
  return (to_jsonb(v_listing)-'address'-'gps_latitude'-'gps_longitude'-'location_accuracy_m'-'owner_id'-'partner_id'-'chat_agent_id'-'contact_phone'-'reserved_by'-'occupied_by'-'current_reservation_id'-'inspection_request_id')
    ||jsonb_build_object(
      'address',case when v_paid then v_listing.address else null end,
      'gps_latitude',case when v_listing.gps_latitude is null then null when v_paid then v_listing.gps_latitude else round(v_listing.gps_latitude,2) end,
      'gps_longitude',case when v_listing.gps_longitude is null then null when v_paid then v_listing.gps_longitude else round(v_listing.gps_longitude,2) end,
      'location_accuracy_m',case when v_paid then v_listing.location_accuracy_m else null end,
      'location_exact',v_paid,'partner_display_name',v_partner_name
    );
end;
$$;

create or replace function public.get_my_hotel_bookings()
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare v_user text;
begin
  select user_id into v_user from public.profiles where auth_id=auth.uid()::text
    and role='user' and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_user is null then raise exception 'Active User account required'; end if;
  return coalesce((select jsonb_agg(
    to_jsonb(hb)||jsonb_build_object(
      'hotels',(to_jsonb(h)-'address'-'gps_latitude'-'gps_longitude'-'owner_id'-'inspection_request_id'-'approved_by')
        ||jsonb_build_object(
          'address',case when hb.payment_status='paid' and hb.status in ('confirmed','checked_in','checked_out','completed') then h.address else null end,
          'gps_latitude',case when h.gps_latitude is null then null when hb.payment_status='paid' and hb.status in ('confirmed','checked_in','checked_out','completed') then h.gps_latitude else round(h.gps_latitude,2) end,
          'gps_longitude',case when h.gps_longitude is null then null when hb.payment_status='paid' and hb.status in ('confirmed','checked_in','checked_out','completed') then h.gps_longitude else round(h.gps_longitude,2) end,
          'location_exact',hb.payment_status='paid' and hb.status in ('confirmed','checked_in','checked_out','completed')
        ),
      'hotel_rooms',to_jsonb(hr),
      'hotel_rate_plans',to_jsonb(rp)
    ) order by hb.created_at desc
  ) from public.hotel_bookings hb
  join public.hotels h on h.hotel_id=hb.hotel_id
  join public.hotel_rooms hr on hr.room_id=hb.room_id
  left join public.hotel_rate_plans rp on rp.rate_plan_id=hb.rate_plan_id
  where hb.user_id=v_user),'[]'::jsonb);
end;
$$;

-- Remove the raw-table public paths that previously exposed exact coordinates.
drop policy if exists hotels_canonical_select on public.hotels;
create policy hotels_canonical_select on public.hotels
for select to authenticated using (
  owner_id=public.current_profile_user_id()
  or public.current_actor_hotel_role(hotel_id) in ('manager','staff')
  or public.current_profile_role()='creator'
  or ((public.current_profile_role()='admin' or (public.current_profile_role()='staff' and public.current_staff_has_permission('operations'))) and public.current_actor_in_scope(state,city))
  or exists (
    select 1 from public.hotel_bookings hb where hb.hotel_id=hotels.hotel_id
      and hb.user_id=public.current_profile_user_id() and hb.payment_status='paid'
      and hb.status in ('confirmed','checked_in','checked_out','completed')
  )
);

drop policy if exists listings_read_canonical on public.listings;
create policy listings_read_canonical on public.listings
for select to authenticated using (
  deleted_at is null and (
    owner_id=public.current_profile_user_id() or partner_id=public.current_profile_user_id()
    or public.current_profile_role()='creator'
    or ((public.current_profile_role()='admin' or (public.current_profile_role()='staff' and public.current_staff_has_permission('operations'))) and public.current_actor_in_scope(state,city))
    or exists (
      select 1 from public.reservations r where r.user_id=public.current_profile_user_id()
        and r.listing_id in (listings.id::text,listings.listing_id)
        and (r.paid_at is not null or r.manual_payment_status in ('paid','completed'))
        and r.status not in ('cancelled','expired')
    )
  )
);

revoke all on public.hotel_rate_plans from anon;
revoke all on public.hotel_venues from anon;
grant select on public.hotel_rate_plans, public.hotel_venues to authenticated;
revoke all on function public.get_discoverable_hotels() from public;
revoke all on function public.get_public_hotel_detail(integer) from public;
revoke all on function public.get_discoverable_listings() from public;
revoke all on function public.get_public_listing_detail(text) from public;
revoke all on function public.get_my_hotel_bookings() from public;
revoke all on function public.quote_hotel_room_rate(integer,integer,integer,date,date) from public;
revoke all on function public.create_my_hotel_booking_with_rate(integer,integer,integer,date,date,integer,text,text,text) from public;
revoke all on function public.partner_create_hotel_room(integer,text,text,integer,integer,text,integer,text[],text[]) from public;
revoke all on function public.partner_save_hotel_rate_plan(integer,integer,text,text,text,text,boolean,integer,integer,text[],boolean) from public;
revoke all on function public.partner_save_hotel_venue(integer,integer,text,text,text,text,text,boolean) from public;
grant execute on function public.get_discoverable_hotels() to authenticated;
grant execute on function public.get_public_hotel_detail(integer) to authenticated;
grant execute on function public.get_discoverable_listings() to authenticated;
grant execute on function public.get_public_listing_detail(text) to authenticated;
grant execute on function public.get_my_hotel_bookings() to authenticated;
grant execute on function public.quote_hotel_room_rate(integer,integer,integer,date,date) to authenticated;
grant execute on function public.create_my_hotel_booking_with_rate(integer,integer,integer,date,date,integer,text,text,text) to authenticated;
grant execute on function public.partner_create_hotel_room(integer,text,text,integer,integer,text,integer,text[],text[]) to authenticated;
grant execute on function public.partner_save_hotel_rate_plan(integer,integer,text,text,text,text,boolean,integer,integer,text[],boolean) to authenticated;
grant execute on function public.partner_save_hotel_venue(integer,integer,text,text,text,text,text,boolean) to authenticated;

comment on table public.hotel_rate_plans is 'Bookable commercial packages belonging to one hotel room type.';
comment on table public.hotel_venues is 'Named on-site restaurants, bars and other guest facilities.';
comment on function public.get_discoverable_hotels() is 'Redacted hotel discovery; never returns an exact pre-payment destination.';
comment on function public.get_discoverable_listings() is 'Redacted apartment discovery; never returns an exact pre-payment destination.';
