-- Hotel arrival policy and physical-room lifecycle share one authoritative state.

alter table public.hotels
  add column if not exists check_in_time time not null default time '14:00',
  add column if not exists check_out_time time not null default time '12:00';

alter table public.hotel_bookings
  add column if not exists assigned_room_unit_id bigint,
  add column if not exists checked_in_at timestamptz,
  add column if not exists checked_out_at timestamptz;

create table if not exists public.hotel_room_units (
  unit_id bigint generated always as identity primary key,
  hotel_id integer not null references public.hotels(hotel_id) on delete cascade,
  room_id integer not null references public.hotel_rooms(room_id) on delete cascade,
  unit_label text not null,
  floor_label text,
  status text not null default 'ready'
    check (status in ('ready','occupied','cleaning','maintenance','out_of_service')),
  current_booking_id integer references public.hotel_bookings(booking_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (nullif(btrim(unit_label),'') is not null),
  check ((status='occupied')=(current_booking_id is not null))
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='hotel_bookings_assigned_room_unit_id_fkey'
      and conrelid='public.hotel_bookings'::regclass
  ) then
    alter table public.hotel_bookings
      add constraint hotel_bookings_assigned_room_unit_id_fkey
      foreign key (assigned_room_unit_id)
      references public.hotel_room_units(unit_id) on delete set null;
  end if;
end $$;

create unique index if not exists hotel_room_units_label_unique
  on public.hotel_room_units(hotel_id,lower(unit_label));
create index if not exists hotel_room_units_room_status_idx
  on public.hotel_room_units(room_id,status,unit_id);
create index if not exists hotel_room_units_current_booking_idx
  on public.hotel_room_units(current_booking_id)
  where current_booking_id is not null;
create index if not exists hotel_bookings_assigned_room_unit_idx
  on public.hotel_bookings(assigned_room_unit_id)
  where assigned_room_unit_id is not null;

create or replace function public.sync_hotel_room_units()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare start_at integer;
begin
  start_at:=case when tg_op='INSERT' then 1 else old.total_rooms+1 end;
  if new.total_rooms>=start_at then
    insert into public.hotel_room_units(hotel_id,room_id,unit_label,status)
    select new.hotel_id,new.room_id,new.room_type||' '||series.value,'ready'
    from generate_series(start_at,new.total_rooms) as series(value)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_hotel_room_units_after_room_change on public.hotel_rooms;
create trigger sync_hotel_room_units_after_room_change
after insert or update of total_rooms on public.hotel_rooms
for each row execute function public.sync_hotel_room_units();

insert into public.hotel_room_units(hotel_id,room_id,unit_label,status)
select room.hotel_id,room.room_id,room.room_type||' '||series.value,'ready'
from public.hotel_rooms room
cross join lateral generate_series(1,greatest(room.total_rooms,0)) as series(value)
on conflict do nothing;

alter table public.hotel_room_units enable row level security;
drop policy if exists hotel_room_units_operator_read on public.hotel_room_units;
create policy hotel_room_units_operator_read
on public.hotel_room_units for select to authenticated
using (public.current_actor_hotel_role(hotel_id) in ('owner','manager','staff'));

revoke all on table public.hotel_room_units from public,anon;
grant select on table public.hotel_room_units to authenticated;
grant all on table public.hotel_room_units to service_role;
grant usage,select on sequence public.hotel_room_units_unit_id_seq to service_role;

create or replace function public.partner_update_hotel_stay_policy(
  p_hotel_id integer,
  p_check_in_time time,
  p_check_out_time time
)
returns public.hotels
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare result public.hotels;
begin
  if public.current_actor_hotel_role(p_hotel_id) not in ('owner','manager') then
    raise exception 'Hotel owner or manager access required';
  end if;
  if p_check_in_time is null or p_check_out_time is null then
    raise exception 'Check-in and checkout times are required';
  end if;
  update public.hotels
  set check_in_time=p_check_in_time,check_out_time=p_check_out_time,updated_at=now()
  where hotel_id=p_hotel_id
  returning * into result;
  if result is null then raise exception 'Hotel not found'; end if;
  return result;
end;
$$;

create or replace function public.partner_update_hotel_room_unit(
  p_unit_id bigint,
  p_unit_label text,
  p_floor_label text,
  p_status text
)
returns public.hotel_room_units
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare unit public.hotel_room_units;
begin
  select * into unit from public.hotel_room_units where unit_id=p_unit_id for update;
  if unit is null then raise exception 'Hotel room not found'; end if;
  if public.current_actor_hotel_role(unit.hotel_id) not in ('owner','manager','staff') then
    raise exception 'Hotel operations access required';
  end if;
  if nullif(btrim(coalesce(p_unit_label,'')),'') is null then
    raise exception 'Room number or label is required';
  end if;
  if p_status not in ('ready','cleaning','maintenance','out_of_service') then
    raise exception 'Choose ready, cleaning, maintenance or out of service';
  end if;
  if unit.current_booking_id is not null then
    raise exception 'An occupied room cannot be changed until checkout';
  end if;
  update public.hotel_room_units
  set unit_label=btrim(p_unit_label),
      floor_label=nullif(btrim(coalesce(p_floor_label,'')),''),
      status=p_status,
      updated_at=now()
  where unit_id=p_unit_id
  returning * into unit;
  return unit;
end;
$$;

create or replace function public.partner_transition_hotel_booking(
  p_booking_id integer,
  p_status text
)
returns public.hotel_bookings
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  booking public.hotel_bookings;
  hotel public.hotels;
  actor_role text;
  unit public.hotel_room_units;
  local_now timestamp;
  arrival_at timestamp;
  departure_at timestamp;
begin
  select * into booking
  from public.hotel_bookings
  where booking_id=p_booking_id
  for update;
  if booking is null then raise exception 'Hotel booking not found'; end if;

  actor_role:=public.current_actor_hotel_role(booking.hotel_id);
  if actor_role not in ('owner','staff') then
    raise exception 'Hotel owner or Front Desk access required';
  end if;
  select * into hotel from public.hotels where hotel_id=booking.hotel_id;
  local_now:=timezone('Africa/Lagos',now());
  arrival_at:=booking.check_in::timestamp+hotel.check_in_time;
  departure_at:=booking.check_out::timestamp+hotel.check_out_time;

  if p_status='checked_in' then
    if not (
      booking.status='confirmed'
      and booking.payment_status='paid'
      and local_now>=arrival_at
      and local_now<departure_at
    ) then
      raise exception 'Check-in opens at % on %',to_char(hotel.check_in_time,'HH12:MI AM'),to_char(booking.check_in,'Mon DD, YYYY');
    end if;
    select * into unit
    from public.hotel_room_units
    where room_id=booking.room_id and status='ready' and current_booking_id is null
    order by unit_label
    for update skip locked
    limit 1;
    if unit is null then
      raise exception 'No ready room is available. Mark a cleaned room ready first';
    end if;
    update public.hotel_room_units
    set status='occupied',current_booking_id=booking.booking_id,updated_at=now()
    where unit_id=unit.unit_id;
    update public.hotel_bookings
    set status='checked_in',assigned_room_unit_id=unit.unit_id,
        checked_in_at=now(),updated_at=now()
    where booking_id=booking.booking_id
    returning * into booking;
  elsif p_status='checked_out' then
    if not (booking.status='checked_in' and booking.payment_status='paid') then
      raise exception 'Only a paid checked-in stay can be checked out';
    end if;
    if booking.assigned_room_unit_id is not null then
      update public.hotel_room_units
      set status='cleaning',current_booking_id=null,updated_at=now()
      where unit_id=booking.assigned_room_unit_id;
    end if;
    update public.hotel_bookings
    set status='checked_out',checked_out_at=now(),updated_at=now()
    where booking_id=booking.booking_id
    returning * into booking;
  else
    raise exception 'Unsupported hotel booking transition';
  end if;
  return booking;
end;
$$;

create or replace function public.notify_hotel_booking_lifecycle()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare hotel public.hotels; event_type text; event_title text; event_message text;
begin
  select * into hotel from public.hotels where hotel_id=new.hotel_id;
  if new.status='confirmed' and new.payment_status='paid'
    and (old.status is distinct from new.status or old.payment_status is distinct from new.payment_status) then
    insert into public.notifications(
      recipient_id,type,title,message,related_id,read,source_type,source_id,
      destination_route,destination_params,event_key,workspace_scope
    ) values (
      new.user_id,'hotel_stay_confirmed','Hotel stay confirmed',
      hotel.name||' is confirmed for '||to_char(new.check_in,'Mon DD')||' at '||to_char(hotel.check_in_time,'HH12:MI AM')||'.',
      new.booking_id::text,false,'hotel_booking',new.booking_id::text,'my_reservations',
      jsonb_build_object('bookingId',new.booking_id,'hotelId',new.hotel_id),
      'hotel_booking:'||new.booking_id||':confirmed:'||new.user_id,'personal'
    ) on conflict(recipient_id,event_key) where event_key is not null do nothing;
    if hotel.owner_id is not null then
      insert into public.notifications(
        recipient_id,type,title,message,related_id,read,source_type,source_id,
        destination_route,destination_params,event_key,workspace_scope
      ) values (
        hotel.owner_id,'hotel_reservation_paid','New paid hotel stay',
        coalesce(new.guest_name,'A guest')||' booked '||to_char(new.check_in,'Mon DD')||' to '||to_char(new.check_out,'Mon DD')||'.',
        new.booking_id::text,false,'hotel_booking',new.booking_id::text,'hotel_booking',
        jsonb_build_object('bookingId',new.booking_id,'hotelId',new.hotel_id),
        'hotel_booking:'||new.booking_id||':confirmed:'||hotel.owner_id,'partner'
      ) on conflict(recipient_id,event_key) where event_key is not null do nothing;
    end if;
  elsif new.status='checked_in' and old.status is distinct from new.status then
    event_type:='hotel_checked_in'; event_title:='Hotel check-in completed';
    event_message:='You are checked in at '||hotel.name||'. Checkout is by '||to_char(hotel.check_out_time,'HH12:MI AM')||' on '||to_char(new.check_out,'Mon DD')||'.';
  elsif new.status='checked_out' and old.status is distinct from new.status then
    event_type:='hotel_checked_out'; event_title:='Hotel checkout completed';
    event_message:='Your stay at '||hotel.name||' is complete.';
  else
    return new;
  end if;
  if event_type is not null then
    insert into public.notifications(
      recipient_id,type,title,message,related_id,read,source_type,source_id,
      destination_route,destination_params,event_key,workspace_scope
    ) values (
      new.user_id,event_type,event_title,event_message,new.booking_id::text,false,
      'hotel_booking',new.booking_id::text,'my_reservations',
      jsonb_build_object('bookingId',new.booking_id,'hotelId',new.hotel_id),
      'hotel_booking:'||new.booking_id||':'||new.status||':'||new.user_id,'personal'
    ) on conflict(recipient_id,event_key) where event_key is not null do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists notify_hotel_booking_lifecycle_after_update on public.hotel_bookings;
create trigger notify_hotel_booking_lifecycle_after_update
after update of status,payment_status on public.hotel_bookings
for each row execute function public.notify_hotel_booking_lifecycle();

revoke all on function public.partner_update_hotel_stay_policy(integer,time,time) from public,anon;
revoke all on function public.partner_update_hotel_room_unit(bigint,text,text,text) from public,anon;
revoke all on function public.partner_transition_hotel_booking(integer,text) from public,anon;
revoke all on function public.sync_hotel_room_units() from public,anon,authenticated;
revoke all on function public.notify_hotel_booking_lifecycle() from public,anon,authenticated;
grant execute on function public.partner_update_hotel_stay_policy(integer,time,time) to authenticated,service_role;
grant execute on function public.partner_update_hotel_room_unit(bigint,text,text,text) to authenticated,service_role;
grant execute on function public.partner_transition_hotel_booking(integer,text) to authenticated,service_role;
grant execute on function public.sync_hotel_room_units() to service_role;
grant execute on function public.notify_hotel_booking_lifecycle() to service_role;

comment on column public.hotels.check_in_time is 'Local hotel time from which a confirmed guest may check in.';
comment on column public.hotels.check_out_time is 'Local hotel time by which a checked-in guest should depart.';
comment on table public.hotel_room_units is 'Physical room units and their ready, occupied, cleaning, maintenance or out-of-service state.';

-- Earlier clients created empty drafts when the form was only opened.
delete from public.property_submission_batches batch
where batch.status='draft'
  and not exists (
    select 1 from public.property_submission_items item where item.batch_id=batch.id
  );
