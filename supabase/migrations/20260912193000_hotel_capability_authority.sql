-- D-002: Hotel authority is capability-based. Manager/Front desk are presets,
-- not authorization decisions by themselves.

create or replace function public.hotel_default_capabilities(p_role text)
returns text[]
language sql
immutable
as $$
  select case p_role
    when 'owner' then array[
      'stay.read','stay.message','stay.assign_unit','stay.check_in','stay.check_out',
      'stay.modify_commercial','room.mark_ready','hotel.inventory.manage',
      'hotel.rate.manage','hotel.policy.manage','hotel.team.manage'
    ]::text[]
    when 'manager' then array[
      'stay.read','stay.message','stay.assign_unit','stay.check_in','stay.check_out',
      'room.mark_ready','hotel.inventory.manage','hotel.rate.manage'
    ]::text[]
    when 'staff' then array[
      'stay.read','stay.message','stay.assign_unit','stay.check_in','stay.check_out',
      'room.mark_ready'
    ]::text[]
    else array[]::text[]
  end;
$$;

create or replace function public.hotel_capabilities_valid(p_caps text[])
returns boolean
language sql
immutable
as $$
  select coalesce(p_caps, array[]::text[]) <@ array[
    'stay.read','stay.message','stay.assign_unit','stay.check_in','stay.check_out',
    'stay.modify_commercial','room.mark_ready','hotel.inventory.manage',
    'hotel.rate.manage','hotel.policy.manage','hotel.team.manage'
  ]::text[];
$$;

alter table public.hotel_team_members
  add column if not exists capabilities text[] not null default array[]::text[];

update public.hotel_team_members
set capabilities=public.hotel_default_capabilities(hotel_role)
where cardinality(capabilities)=0;

alter table public.hotel_team_members
  drop constraint if exists hotel_team_members_capabilities_valid;
alter table public.hotel_team_members
  add constraint hotel_team_members_capabilities_valid
  check (public.hotel_capabilities_valid(capabilities));

create or replace function public.set_hotel_team_default_capabilities()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if tg_op='INSERT' or new.hotel_role is distinct from old.hotel_role then
    new.capabilities:=public.hotel_default_capabilities(new.hotel_role);
  end if;
  return new;
end;
$$;

drop trigger if exists hotel_team_default_capabilities on public.hotel_team_members;
create trigger hotel_team_default_capabilities
before insert or update of hotel_role on public.hotel_team_members
for each row execute function public.set_hotel_team_default_capabilities();

create or replace function public.hotel_actor_has_capability(
  p_hotel_id integer,
  p_capability text
)
returns boolean
language plpgsql
stable
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_user text;
begin
  select user_id into v_user
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_user is null then return false; end if;

  if exists(select 1 from public.hotels where hotel_id=p_hotel_id and owner_id=v_user) then
    return p_capability=any(public.hotel_default_capabilities('owner'));
  end if;

  return exists(
    select 1 from public.hotel_team_members tm
    where tm.hotel_id=p_hotel_id
      and tm.member_user_id=v_user
      and tm.status='active'
      and p_capability=any(tm.capabilities)
  );
end;
$$;

grant execute on function public.hotel_actor_has_capability(integer,text) to authenticated;
revoke all on function public.hotel_actor_has_capability(integer,text) from anon;

create or replace function public.get_my_hotel_capabilities(p_hotel_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_user text;
  v_role text;
  v_caps text[];
begin
  select user_id into v_user
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_user is null then raise exception 'Active WeHouse account required'; end if;

  if exists(select 1 from public.hotels where hotel_id=p_hotel_id and owner_id=v_user) then
    v_role:='owner';
    v_caps:=public.hotel_default_capabilities('owner');
  else
    select hotel_role,capabilities into v_role,v_caps
    from public.hotel_team_members
    where hotel_id=p_hotel_id and member_user_id=v_user and status='active'
    limit 1;
  end if;
  if v_role is null then raise exception 'Hotel access required'; end if;
  return jsonb_build_object('hotel_id',p_hotel_id,'role',v_role,'capabilities',to_jsonb(coalesce(v_caps,array[]::text[])));
end;
$$;

grant execute on function public.get_my_hotel_capabilities(integer) to authenticated;
revoke all on function public.get_my_hotel_capabilities(integer) from anon;

create or replace function public.owner_set_hotel_team_capabilities(
  p_membership_id uuid,
  p_capabilities text[]
)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_owner text;
  v_row public.hotel_team_members;
  v_caps text[]:=coalesce(p_capabilities,array[]::text[]);
begin
  select user_id into v_owner
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  select tm.* into v_row
  from public.hotel_team_members tm
  join public.hotels h on h.hotel_id=tm.hotel_id
  where tm.id=p_membership_id and h.owner_id=v_owner
  for update;
  if v_row.id is null then raise exception 'Hotel owner access required'; end if;
  if not public.hotel_capabilities_valid(v_caps) then raise exception 'Unsupported hotel capability'; end if;
  update public.hotel_team_members
  set capabilities=v_caps,updated_at=now()
  where id=v_row.id
  returning * into v_row;
  return jsonb_build_object('id',v_row.id,'hotel_id',v_row.hotel_id,'hotel_role',v_row.hotel_role,'status',v_row.status,'capabilities',to_jsonb(v_row.capabilities));
end;
$$;

grant execute on function public.owner_set_hotel_team_capabilities(uuid,text[]) to authenticated;
revoke all on function public.owner_set_hotel_team_capabilities(uuid,text[]) from anon;

create or replace function public.get_my_hotel_team(p_hotel_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path='pg_catalog','public'
as $$
declare v_user text; v_result jsonb;
begin
  select user_id into v_user from public.profiles where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false);
  if not exists(select 1 from public.hotels where hotel_id=p_hotel_id and owner_id=v_user)
    then raise exception 'Hotel owner access required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',tm.id,'member_user_id',tm.member_user_id,
    'hotel_role',tm.hotel_role,'status',tm.status,'capabilities',tm.capabilities,
    'name',coalesce(p.full_name,p.username,'Team member'),'username',p.username,'updated_at',tm.updated_at)
    order by case when tm.status='invited' then 0 else 1 end,tm.created_at),'[]'::jsonb)
  into v_result from public.hotel_team_members tm join public.profiles p on p.user_id=tm.member_user_id
  where tm.hotel_id=p_hotel_id and tm.status in ('invited','active');
  return v_result;
end;
$$;

create or replace function public.can_access_hotel_booking_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path='pg_catalog','public'
as $$
  with actor as (
    select user_id from public.profiles
    where auth_id=(select auth.uid())::text
      and not coalesce(deleted,false)
      and not coalesce(suspended,false)
      and not coalesce(banned,false)
    limit 1
  )
  select exists(
    select 1
    from public.hotel_booking_conversations conversation
    cross join actor
    where conversation.id=p_conversation_id
      and (
        conversation.guest_user_id=actor.user_id
        or public.hotel_actor_has_capability(conversation.hotel_id,'stay.message')
      )
  );
$$;

create or replace function public.partner_transition_hotel_booking(p_booking_id integer,p_status text)
returns public.hotel_bookings
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  booking public.hotel_bookings;
  hotel public.hotels;
  unit public.hotel_room_units;
  local_now timestamp;
  arrival_at timestamp;
  departure_at timestamp;
begin
  select * into booking from public.hotel_bookings where booking_id=p_booking_id for update;
  if booking is null then raise exception 'Hotel booking not found'; end if;
  if p_status='checked_in' then
    if not public.hotel_actor_has_capability(booking.hotel_id,'stay.check_in')
       or not public.hotel_actor_has_capability(booking.hotel_id,'stay.assign_unit') then
      raise exception 'Hotel check-in capability required';
    end if;
  elsif p_status='checked_out' then
    if not public.hotel_actor_has_capability(booking.hotel_id,'stay.check_out') then
      raise exception 'Hotel checkout capability required';
    end if;
  else
    raise exception 'Unsupported hotel booking transition';
  end if;

  select * into hotel from public.hotels where hotel_id=booking.hotel_id;
  local_now:=timezone('Africa/Lagos',now());
  arrival_at:=booking.check_in::timestamp+hotel.check_in_time;
  departure_at:=booking.check_out::timestamp+hotel.check_out_time;

  if p_status='checked_in' then
    if not (booking.status='confirmed' and booking.payment_status='paid' and local_now>=arrival_at and local_now<departure_at) then
      raise exception 'Check-in opens at % on %',to_char(hotel.check_in_time,'HH12:MI AM'),to_char(booking.check_in,'Mon DD, YYYY');
    end if;
    select * into unit from public.hotel_room_units
    where room_id=booking.room_id and status='ready' and current_booking_id is null
    order by unit_label for update skip locked limit 1;
    if unit is null then raise exception 'No ready room is available. Mark a cleaned room ready first'; end if;
    update public.hotel_room_units set status='occupied',current_booking_id=booking.booking_id,updated_at=now()
    where unit_id=unit.unit_id;
    update public.hotel_bookings set status='checked_in',assigned_room_unit_id=unit.unit_id,checked_in_at=now(),updated_at=now()
    where booking_id=booking.booking_id returning * into booking;
  else
    if not (booking.status='checked_in' and booking.payment_status='paid') then
      raise exception 'Only a paid checked-in stay can be checked out';
    end if;
    if booking.assigned_room_unit_id is not null then
      update public.hotel_room_units set status='cleaning',current_booking_id=null,updated_at=now()
      where unit_id=booking.assigned_room_unit_id;
    end if;
    update public.hotel_bookings set status='checked_out',checked_out_at=now(),updated_at=now()
    where booking_id=booking.booking_id returning * into booking;
  end if;
  return booking;
end;
$$;

grant execute on function public.partner_transition_hotel_booking(integer,text) to authenticated;
