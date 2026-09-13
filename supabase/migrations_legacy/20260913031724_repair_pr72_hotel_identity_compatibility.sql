-- Selective repair of PR #72. This preserves its capability model without
-- merging unrelated UI changes, repairs fresh-database compatibility, and uses
-- the locked Front Desk name.

-- Forward repair for databases where the historical optional overload did exist.
-- to_regprocedure makes the migration safe across live, preview and zero-build
-- histories with different quote_hotel_room overloads.
do $quote_compatibility$
declare
  v_signature regprocedure;
begin
  v_signature:=to_regprocedure(
    'public.quote_hotel_room(integer,integer,date,date)'
  );
  if v_signature is not null then
    execute format('revoke all on function %s from public,anon',v_signature);
    execute format(
      'grant execute on function %s to authenticated,service_role',
      v_signature
    );
  end if;
end
$quote_compatibility$;

alter table public.hotel_team_members
  drop constraint if exists hotel_team_members_hotel_role_check;
update public.hotel_team_members
set hotel_role='front_desk',updated_at=now()
where hotel_role='staff';
alter table public.hotel_team_members
  add constraint hotel_team_members_hotel_role_check
  check(hotel_role in ('manager','front_desk'));
alter table public.hotel_team_members
  drop constraint if exists hotel_team_members_status_check;
alter table public.hotel_team_members
  add constraint hotel_team_members_status_check
  check(status in ('invited','active','revoked'));

create or replace function public.hotel_default_capabilities(p_role text)
returns text[]
language sql
immutable
set search_path to 'pg_catalog','public'
as $$
  select case p_role
    when 'owner' then array[
      'stay.read','stay.message','stay.assign_unit','stay.check_in','stay.check_out',
      'stay.modify_commercial','room.mark_ready','hotel.inventory.manage',
      'hotel.rate.manage','hotel.policy.manage','hotel.team.manage',
      'hotel.integration.manage'
    ]::text[]
    when 'manager' then array[
      'stay.read','stay.message','stay.assign_unit','stay.check_in','stay.check_out',
      'room.mark_ready','hotel.inventory.manage','hotel.rate.manage'
    ]::text[]
    when 'front_desk' then array[
      'stay.read','stay.message','stay.assign_unit','stay.check_in','stay.check_out',
      'room.mark_ready'
    ]::text[]
    when 'staff' then array[
      'stay.read','stay.message','stay.assign_unit','stay.check_in','stay.check_out',
      'room.mark_ready'
    ]::text[] -- compatibility input only
    else array[]::text[]
  end
$$;

create or replace function public.hotel_capabilities_valid(p_caps text[])
returns boolean
language sql
immutable
set search_path to 'pg_catalog','public'
as $$
  select coalesce(p_caps,array[]::text[]) <@ array[
    'stay.read','stay.message','stay.assign_unit','stay.check_in','stay.check_out',
    'stay.modify_commercial','room.mark_ready','hotel.inventory.manage',
    'hotel.rate.manage','hotel.policy.manage','hotel.team.manage',
    'hotel.integration.manage'
  ]::text[]
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
  check(public.hotel_capabilities_valid(capabilities));

create or replace function public.set_hotel_team_default_capabilities()
returns trigger
language plpgsql
set search_path to 'pg_catalog','public'
as $$
begin
  if tg_op='INSERT' or new.hotel_role is distinct from old.hotel_role then
    new.capabilities:=public.hotel_default_capabilities(new.hotel_role);
  end if;
  return new;
end
$$;
drop trigger if exists hotel_team_default_capabilities
  on public.hotel_team_members;
create trigger hotel_team_default_capabilities
before insert or update of hotel_role on public.hotel_team_members
for each row execute function public.set_hotel_team_default_capabilities();

create or replace function public.hotel_actor_has_capability(
  p_hotel_id integer,p_capability text
)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  with actor as(
    select p.user_id
    from public.profiles p
    where p.auth_id=(select auth.uid())::text
      and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false)
      and not coalesce(p.banned,false)
    limit 1
  )
  select exists(
    select 1 from actor a
    join public.hotels h on h.hotel_id=p_hotel_id and h.owner_id=a.user_id
    where p_capability=any(public.hotel_default_capabilities('owner'))
  ) or exists(
    select 1 from actor a
    join public.hotel_team_members tm
      on tm.member_user_id=a.user_id and tm.hotel_id=p_hotel_id
    where tm.status='active' and p_capability=any(tm.capabilities)
  )
$$;

create or replace function public.get_my_hotel_capabilities(p_hotel_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_user text:=public.current_profile_user_id(); v_role text; v_caps text[];
begin
  if v_user is null then raise exception 'Active WeHouse account required'; end if;
  if exists(
    select 1 from public.hotels where hotel_id=p_hotel_id and owner_id=v_user
  ) then
    v_role:='owner';v_caps:=public.hotel_default_capabilities('owner');
  else
    select tm.hotel_role,tm.capabilities into v_role,v_caps
    from public.hotel_team_members tm
    where tm.hotel_id=p_hotel_id and tm.member_user_id=v_user
      and tm.status='active' limit 1;
  end if;
  if v_role is null then raise exception 'Hotel access required'; end if;
  return jsonb_build_object(
    'hotel_id',p_hotel_id,'role',v_role,
    'capabilities',to_jsonb(coalesce(v_caps,array[]::text[]))
  );
end
$$;

create or replace function public.owner_set_hotel_team_capabilities(
  p_membership_id uuid,p_capabilities text[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_owner text:=public.current_profile_user_id();
  v_row public.hotel_team_members;
  v_caps text[]:=coalesce(p_capabilities,array[]::text[]);
begin
  select tm.* into v_row
  from public.hotel_team_members tm
  join public.hotels h on h.hotel_id=tm.hotel_id
  where tm.id=p_membership_id and h.owner_id=v_owner
  for update;
  if v_row.id is null then raise exception 'Hotel owner access required'; end if;
  if not public.hotel_capabilities_valid(v_caps) then
    raise exception 'Unsupported hotel capability'; end if;
  update public.hotel_team_members
  set capabilities=v_caps,updated_at=now()
  where id=v_row.id returning * into v_row;
  return jsonb_build_object(
    'id',v_row.id,'hotel_id',v_row.hotel_id,'hotel_role',v_row.hotel_role,
    'status',v_row.status,'capabilities',to_jsonb(v_row.capabilities)
  );
end
$$;

create or replace function public.owner_set_hotel_team_member(
  p_hotel_id integer,p_email text,p_role text,p_enabled boolean default true
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_owner text:=public.current_profile_user_id();
  v_member public.profiles;
  v_role text:=case when p_role='staff' then 'front_desk' else p_role end;
begin
  if not exists(
    select 1 from public.hotels
    where hotel_id=p_hotel_id and owner_id=v_owner
  ) then raise exception 'Hotel owner access required'; end if;
  if v_role not in ('manager','front_desk') then
    raise exception 'Choose Manager or Front Desk'; end if;
  select * into v_member from public.profiles
  where lower(email)=lower(btrim(p_email))
    and not coalesce(deleted,false) limit 1;
  if v_member.user_id is null then raise exception 'WeHouse account not found'; end if;
  if v_member.user_id=v_owner then raise exception 'Owner already has full hotel access'; end if;

  if p_enabled then
    insert into public.hotel_team_members(
      hotel_id,member_user_id,hotel_role,status,invited_by,capabilities,
      created_at,updated_at
    ) values(
      p_hotel_id,v_member.user_id,v_role,'active',v_owner,
      public.hotel_default_capabilities(v_role),now(),now()
    ) on conflict(hotel_id,member_user_id) do update
      set hotel_role=excluded.hotel_role,status='active',revoked_at=null,
        capabilities=public.hotel_default_capabilities(excluded.hotel_role),
        updated_at=now();
  else
    update public.hotel_team_members
    set status='revoked',revoked_at=now(),updated_at=now()
    where hotel_id=p_hotel_id and member_user_id=v_member.user_id;
  end if;
  return true;
end
$$;

-- If an older database lacks the uniqueness constraint expected by the upsert,
-- add the equivalent index without assuming a constraint name.
create unique index if not exists hotel_team_member_unique
  on public.hotel_team_members(hotel_id,member_user_id);

create or replace function public.get_my_hotel_team(p_hotel_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_user text:=public.current_profile_user_id(); v_result jsonb;
begin
  if not exists(
    select 1 from public.hotels where hotel_id=p_hotel_id and owner_id=v_user
  ) then raise exception 'Hotel owner access required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',tm.id,'member_user_id',tm.member_user_id,
    'hotel_role',tm.hotel_role,'status',tm.status,
    'capabilities',tm.capabilities,
    'name',coalesce(p.full_name,p.username,'Team member'),
    'username',p.username,'updated_at',tm.updated_at
  ) order by case when tm.status='invited' then 0 else 1 end,tm.created_at),'[]'::jsonb)
  into v_result
  from public.hotel_team_members tm
  join public.profiles p on p.user_id=tm.member_user_id
  where tm.hotel_id=p_hotel_id and tm.status in ('invited','active');
  return v_result;
end
$$;

create or replace function public.can_access_hotel_booking_conversation(
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  with actor as(select public.current_profile_user_id() user_id)
  select exists(
    select 1
    from public.hotel_booking_conversations c cross join actor
    where c.id=p_conversation_id
      and (
        c.guest_user_id=actor.user_id
        or public.hotel_actor_has_capability(c.hotel_id,'stay.message')
      )
  )
$$;

create or replace function public.partner_transition_hotel_booking(
  p_booking_id integer,p_status text
)
returns public.hotel_bookings
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_booking public.hotel_bookings;
  v_hotel public.hotels;
  v_unit public.hotel_room_units;
  v_local_now timestamp;
  v_arrival timestamp;
  v_departure timestamp;
  v_actor text:=public.current_profile_user_id();
begin
  select * into v_booking from public.hotel_bookings
  where booking_id=p_booking_id for update;
  if v_booking.booking_id is null then raise exception 'Hotel booking not found'; end if;
  select * into v_hotel from public.hotels where hotel_id=v_booking.hotel_id;
  v_local_now:=timezone('Africa/Lagos',now());
  v_arrival:=v_booking.check_in::timestamp+v_hotel.check_in_time;
  v_departure:=v_booking.check_out::timestamp+v_hotel.check_out_time;

  if p_status='checked_in' then
    if not public.hotel_actor_has_capability(v_booking.hotel_id,'stay.check_in')
      or not public.hotel_actor_has_capability(v_booking.hotel_id,'stay.assign_unit') then
      raise exception 'Hotel check-in and room-assignment capabilities required';
    end if;
    if not (
      coalesce(v_booking.canonical_state,v_booking.status) in ('confirmed','check_in_ready')
      and v_booking.payment_status='paid'
      and v_local_now>=v_arrival and v_local_now<v_departure
    ) then raise exception 'This stay is not ready for check-in'; end if;
    if v_booking.payment_protection_id is null or not exists(
      select 1 from public.payment_protection_transactions p
      where p.id=v_booking.payment_protection_id
        and p.protection_state in ('protected','release_eligible')
    ) then raise exception 'Verified Hotel Payment Protection is required'; end if;

    select * into v_unit from public.hotel_room_units
    where hotel_id=v_booking.hotel_id and room_id=v_booking.room_id
      and status='ready' and current_booking_id is null
    order by unit_label for update skip locked limit 1;
    if v_unit.unit_id is null then
      raise exception 'No ready room is available'; end if;
    update public.hotel_room_units
    set status='occupied',current_booking_id=v_booking.booking_id,updated_at=now()
    where unit_id=v_unit.unit_id;
    update public.hotel_bookings
    set status='checked_in',canonical_state='checked_in',
      assigned_room_unit_id=v_unit.unit_id,checked_in_at=now(),updated_at=now()
    where booking_id=v_booking.booking_id returning * into v_booking;
    insert into public.hotel_stay_transitions(
      hotel_booking_id,from_state,to_state,event_type,event_key,
      actor_user_id,actor_type,policy_version_id
    ) values(
      v_booking.booking_id,'check_in_ready','checked_in','hotel_checked_in',
      'hotel_checked_in:'||v_booking.booking_id,v_actor,'hotel_team',
      v_booking.policy_version_id
    ) on conflict(event_key) do nothing;
  elsif p_status='checked_out' then
    if not public.hotel_actor_has_capability(v_booking.hotel_id,'stay.check_out')
      then raise exception 'Hotel checkout capability required'; end if;
    if coalesce(v_booking.canonical_state,v_booking.status)<>'checked_in'
      or v_booking.payment_status<>'paid' then
      raise exception 'Only a paid checked-in stay can check out'; end if;
    update public.hotel_room_units
    set status='cleaning',current_booking_id=null,updated_at=now()
    where unit_id=v_booking.assigned_room_unit_id;
    update public.hotel_bookings
    set status='checked_out',canonical_state='checked_out',
      checked_out_at=now(),updated_at=now()
    where booking_id=v_booking.booking_id returning * into v_booking;
    insert into public.hotel_stay_transitions(
      hotel_booking_id,from_state,to_state,event_type,event_key,
      actor_user_id,actor_type,policy_version_id
    ) values(
      v_booking.booking_id,'checked_in','checked_out','hotel_checked_out',
      'hotel_checked_out:'||v_booking.booking_id,v_actor,'hotel_team',
      v_booking.policy_version_id
    ) on conflict(event_key) do nothing;
  else
    raise exception 'Unsupported Hotel transition';
  end if;
  return v_booking;
end
$$;

drop policy if exists hotel_inventory_team_read on public.hotel_inventory_daily;
create policy hotel_inventory_capability_read
on public.hotel_inventory_daily for select to authenticated
using(public.hotel_actor_has_capability(hotel_id,'hotel.inventory.manage'));
drop policy if exists hotel_room_units_operator_read on public.hotel_room_units;
create policy hotel_room_units_capability_read
on public.hotel_room_units for select to authenticated
using(public.hotel_actor_has_capability(hotel_id,'stay.read'));

grant select on table public.hotel_inventory_daily to authenticated;
grant select on table public.hotel_room_units to authenticated;

revoke all on function public.hotel_default_capabilities(text) from public,anon;
revoke all on function public.hotel_capabilities_valid(text[]) from public,anon;
revoke all on function public.hotel_actor_has_capability(integer,text) from public,anon;
revoke all on function public.get_my_hotel_capabilities(integer) from public,anon;
revoke all on function public.owner_set_hotel_team_capabilities(uuid,text[]) from public,anon;
revoke all on function public.owner_set_hotel_team_member(integer,text,text,boolean)
from public,anon;
revoke all on function public.get_my_hotel_team(integer) from public,anon;
revoke all on function public.can_access_hotel_booking_conversation(uuid)
from public,anon;
revoke all on function public.partner_transition_hotel_booking(integer,text)
from public,anon;
grant execute on function public.hotel_default_capabilities(text)
to authenticated,service_role;
grant execute on function public.hotel_capabilities_valid(text[])
to authenticated,service_role;
grant execute on function public.hotel_actor_has_capability(integer,text)
to authenticated,service_role;
grant execute on function public.get_my_hotel_capabilities(integer)
to authenticated,service_role;
grant execute on function public.owner_set_hotel_team_capabilities(uuid,text[])
to authenticated,service_role;
grant execute on function public.owner_set_hotel_team_member(integer,text,text,boolean)
to authenticated,service_role;
grant execute on function public.get_my_hotel_team(integer)
to authenticated,service_role;
grant execute on function public.can_access_hotel_booking_conversation(uuid)
to authenticated,service_role;
grant execute on function public.partner_transition_hotel_booking(integer,text)
to authenticated,service_role;

comment on column public.hotel_team_members.capabilities
is 'Owner-editable effective Hotel permissions. Manager and Front Desk are defaults only.';

