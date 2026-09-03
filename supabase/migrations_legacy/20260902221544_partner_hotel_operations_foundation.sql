-- Give a published hotel an owner-operated layer without turning hotel states
-- into navigation. Submission/review remains on inspection_requests; these
-- records begin only after a canonical hotel and room types exist.

create table if not exists public.hotel_inventory_daily (
  id uuid primary key default gen_random_uuid(),
  hotel_id integer not null references public.hotels(hotel_id) on delete cascade,
  room_id integer not null references public.hotel_rooms(room_id) on delete cascade,
  inventory_date date not null,
  available_quantity integer not null check (available_quantity >= 0),
  rate_override integer check (rate_override is null or rate_override > 0),
  closed boolean not null default false,
  note text,
  updated_by text references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(room_id, inventory_date)
);

create index if not exists hotel_inventory_daily_hotel_date_idx
  on public.hotel_inventory_daily(hotel_id, inventory_date);

alter table public.hotel_inventory_daily enable row level security;
revoke all on public.hotel_inventory_daily from public, anon, authenticated;
grant select on public.hotel_inventory_daily to anon, authenticated;

drop policy if exists hotel_inventory_daily_read on public.hotel_inventory_daily;
create policy hotel_inventory_daily_read on public.hotel_inventory_daily
for select to anon, authenticated using (
  exists (
    select 1 from public.hotels h
    where h.hotel_id=hotel_inventory_daily.hotel_id
      and (
        h.status='active'
        or h.owner_id=public.current_profile_user_id()
        or public.current_profile_role() in ('staff','admin','creator')
      )
  )
);

drop policy if exists hotel_bookings_partner_select on public.hotel_bookings;
create policy hotel_bookings_partner_select on public.hotel_bookings
for select to authenticated using (
  exists (
    select 1 from public.hotels h
    where h.hotel_id=hotel_bookings.hotel_id
      and h.owner_id=public.current_profile_user_id()
  )
);

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
set search_path='pg_catalog','public' as $$
declare v_actor public.profiles; v_room public.hotel_rooms;
begin
  select * into v_actor from public.profiles
  where auth_id=auth.uid()::text and role='property_partner'
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)
  limit 1;
  if v_actor is null then raise exception 'Active Property Partner account required'; end if;
  if nullif(btrim(p_room_type),'') is null or coalesce(p_price_per_night,0)<=0
     or coalesce(p_max_guests,0)<1 or coalesce(p_total_rooms,0)<0 then
    raise exception 'Valid room name, rate, capacity and quantity are required';
  end if;
  select r.* into v_room from public.hotel_rooms r join public.hotels h on h.hotel_id=r.hotel_id
  where r.room_id=p_room_id and h.owner_id=v_actor.user_id for update;
  if v_room is null then raise exception 'Room type not found for this Partner'; end if;
  update public.hotel_rooms set
    room_type=btrim(p_room_type), description=nullif(btrim(coalesce(p_description,'')),''),
    price_per_night=p_price_per_night, max_guests=p_max_guests,
    bed_type=nullif(btrim(coalesce(p_bed_type,'')),''), total_rooms=p_total_rooms,
    amenities=coalesce(p_amenities,amenities), images=coalesce(p_images,images), updated_at=now()
  where room_id=p_room_id returning * into v_room;
  return v_room;
end $$;

create or replace function public.partner_set_hotel_inventory_range(
  p_room_id integer,
  p_start_date date,
  p_end_date date,
  p_available_quantity integer,
  p_closed boolean default false,
  p_rate_override integer default null,
  p_note text default null
) returns integer
language plpgsql security definer
set search_path='pg_catalog','public' as $$
declare v_actor public.profiles; v_room public.hotel_rooms; v_count integer;
begin
  select * into v_actor from public.profiles
  where auth_id=auth.uid()::text and role='property_partner'
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)
  limit 1;
  if v_actor is null then raise exception 'Active Property Partner account required'; end if;
  select r.* into v_room from public.hotel_rooms r join public.hotels h on h.hotel_id=r.hotel_id
  where r.room_id=p_room_id and h.owner_id=v_actor.user_id;
  if v_room is null then raise exception 'Room type not found for this Partner'; end if;
  if p_start_date<current_date or p_end_date<p_start_date or p_end_date>p_start_date+366 then raise exception 'Choose a valid date range up to one year'; end if;
  if p_available_quantity<0 or p_available_quantity>v_room.total_rooms then raise exception 'Availability must be within this room type quantity'; end if;
  if p_rate_override is not null and p_rate_override<=0 then raise exception 'Rate override must be positive'; end if;
  insert into public.hotel_inventory_daily(hotel_id,room_id,inventory_date,available_quantity,rate_override,closed,note,updated_by,updated_at)
  select v_room.hotel_id,v_room.room_id,d,p_available_quantity,p_rate_override,coalesce(p_closed,false),nullif(btrim(coalesce(p_note,'')),''),v_actor.user_id,now()
  from generate_series(p_start_date,p_end_date,interval '1 day') d
  on conflict(room_id,inventory_date) do update set
    available_quantity=excluded.available_quantity,rate_override=excluded.rate_override,closed=excluded.closed,
    note=excluded.note,updated_by=excluded.updated_by,updated_at=now();
  get diagnostics v_count=row_count;
  return v_count;
end $$;

create or replace function public.partner_transition_hotel_booking(p_booking_id integer,p_status text)
returns public.hotel_bookings language plpgsql security definer
set search_path='pg_catalog','public' as $$
declare v_actor public.profiles; v_booking public.hotel_bookings;
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text and role='property_partner'
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor is null then raise exception 'Active Property Partner account required'; end if;
  select b.* into v_booking from public.hotel_bookings b join public.hotels h on h.hotel_id=b.hotel_id
  where b.booking_id=p_booking_id and h.owner_id=v_actor.user_id for update of b;
  if v_booking is null then raise exception 'Hotel reservation not found for this Partner'; end if;
  if p_status='checked_in' and not (v_booking.status='confirmed' and v_booking.payment_status='paid' and v_booking.check_in<=current_date) then
    raise exception 'Only a paid confirmed arrival can be checked in';
  elsif p_status='checked_out' and not (v_booking.status='checked_in' and v_booking.check_out<=current_date) then
    raise exception 'Only a current stay reaching departure can be checked out';
  elsif p_status not in ('checked_in','checked_out') then raise exception 'Unsupported hotel reservation transition';
  end if;
  update public.hotel_bookings set status=p_status,updated_at=now() where booking_id=p_booking_id returning * into v_booking;
  return v_booking;
end $$;

revoke all on function public.partner_update_hotel_room(integer,text,text,integer,integer,text,integer,text[],text[]) from public,anon;
revoke all on function public.partner_set_hotel_inventory_range(integer,date,date,integer,boolean,integer,text) from public,anon;
revoke all on function public.partner_transition_hotel_booking(integer,text) from public,anon;
grant execute on function public.partner_update_hotel_room(integer,text,text,integer,integer,text,integer,text[],text[]) to authenticated;
grant execute on function public.partner_set_hotel_inventory_range(integer,date,date,integer,boolean,integer,text) to authenticated;
grant execute on function public.partner_transition_hotel_booking(integer,text) to authenticated;
