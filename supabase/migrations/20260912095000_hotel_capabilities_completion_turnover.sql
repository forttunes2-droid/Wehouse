-- Canonical hotel operations: explicit capabilities, configurable stay completion,
-- turnover readiness, and exactly-once release of protected partner earnings.

alter table public.hotel_team_members
  add column if not exists capabilities text[] not null default '{}'::text[];

alter table public.hotels
  add column if not exists turnover_minutes integer not null default 120,
  add column if not exists completion_mode text not null default 'auto',
  add column if not exists completion_review_hours integer not null default 24,
  add column if not exists manual_completion_sla_hours integer not null default 48;

alter table public.hotels drop constraint if exists hotels_turnover_minutes_check;
alter table public.hotels add constraint hotels_turnover_minutes_check check (turnover_minutes between 0 and 1440);
alter table public.hotels drop constraint if exists hotels_completion_mode_check;
alter table public.hotels add constraint hotels_completion_mode_check check (completion_mode in ('immediate','auto','manual'));
alter table public.hotels drop constraint if exists hotels_completion_review_hours_check;
alter table public.hotels add constraint hotels_completion_review_hours_check check (completion_review_hours between 0 and 168);
alter table public.hotels drop constraint if exists hotels_manual_completion_sla_hours_check;
alter table public.hotels add constraint hotels_manual_completion_sla_hours_check check (manual_completion_sla_hours between 1 and 336);

alter table public.hotel_bookings
  add column if not exists completion_due_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by text references public.profiles(user_id) on delete set null,
  add column if not exists completion_source text;

alter table public.hotel_bookings drop constraint if exists hotel_bookings_completion_source_check;
alter table public.hotel_bookings add constraint hotel_bookings_completion_source_check
  check (completion_source is null or completion_source in ('immediate','hotel_manual','auto_review','manual_sla_fallback','wehouse_review'));

alter table public.hotel_room_units
  add column if not exists ready_after timestamptz;

create or replace function public.hotel_allowed_capabilities()
returns text[]
language sql
immutable
set search_path to 'pg_catalog','public'
as $$
  select array[
    'hotel.read','hotel.policy.manage','hotel.rooms.manage','hotel.rates.manage',
    'hotel.inventory.manage','hotel.team.read','hotel.team.manage',
    'stay.read','stay.message','stay.assign_unit','stay.check_in','stay.check_out','stay.complete',
    'room.mark_ready'
  ]::text[];
$$;

create or replace function public.hotel_default_capabilities(p_role text)
returns text[]
language sql
immutable
set search_path to 'pg_catalog','public'
as $$
  select case p_role
    when 'manager' then array[
      'hotel.read','hotel.policy.manage','hotel.rooms.manage','hotel.rates.manage',
      'hotel.inventory.manage','hotel.team.read',
      'stay.read','stay.message','stay.assign_unit','stay.check_in','stay.check_out','stay.complete',
      'room.mark_ready'
    ]::text[]
    when 'staff' then array[
      'stay.read','stay.message','stay.assign_unit','stay.check_in','stay.check_out','room.mark_ready'
    ]::text[]
    else '{}'::text[] end;
$$;

update public.hotel_team_members
set capabilities=public.hotel_default_capabilities(hotel_role),updated_at=now()
where cardinality(coalesce(capabilities,'{}'::text[]))=0
  and hotel_role in ('manager','staff');

create or replace function public.current_actor_hotel_capabilities(p_hotel_id integer)
returns text[]
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  with actor as (
    select user_id from public.profiles
    where auth_id=(select auth.uid())::text
      and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)
    limit 1
  )
  select case
    when h.owner_id=a.user_id then public.hotel_allowed_capabilities()
    else coalesce(tm.capabilities,'{}'::text[])
  end
  from public.hotels h
  cross join actor a
  left join public.hotel_team_members tm
    on tm.hotel_id=h.hotel_id and tm.member_user_id=a.user_id and tm.status='active'
  where h.hotel_id=p_hotel_id
    and (h.owner_id=a.user_id or tm.id is not null)
  limit 1;
$$;

create or replace function public.current_actor_has_hotel_capability(p_hotel_id integer,p_capability text)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select coalesce(p_capability=any(public.current_actor_hotel_capabilities(p_hotel_id)),false);
$$;

create or replace function public.current_actor_can_read_hotel_record(p_hotel_id integer,p_owner_id text,p_state text,p_city text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor public.profiles;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null then return false; end if;
  return p_owner_id=v_actor.user_id
    or v_actor.role='creator'
    or public.current_actor_has_hotel_capability(p_hotel_id,'hotel.read')
    or (((v_actor.role='admin') or (v_actor.role='staff' and public.current_staff_has_permission('operations')))
        and public.current_actor_in_scope(p_state,p_city));
end;
$$;

create or replace function public.current_actor_can_read_hotel_booking_record(p_hotel_id integer,p_customer_id text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor public.profiles; v_hotel public.hotels;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null then return false; end if;
  if p_customer_id=v_actor.user_id or v_actor.role='creator' then return true; end if;
  select * into v_hotel from public.hotels where hotel_id=p_hotel_id;
  if v_hotel.hotel_id is null then return false; end if;
  return v_hotel.owner_id=v_actor.user_id
    or public.current_actor_has_hotel_capability(p_hotel_id,'stay.read')
    or (((v_actor.role='admin') or (v_actor.role='staff' and public.current_staff_has_permission('operations')))
        and public.current_actor_in_scope(v_hotel.state,v_hotel.city));
end;
$$;

create or replace function public.can_access_hotel_booking_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  with actor as (
    select user_id from public.profiles
    where auth_id=(select auth.uid())::text
      and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)
    limit 1
  )
  select exists(
    select 1 from public.hotel_booking_conversations c
    join public.hotels h on h.hotel_id=c.hotel_id
    cross join actor a
    where c.id=p_conversation_id
      and (c.guest_user_id=a.user_id or h.owner_id=a.user_id or public.current_actor_has_hotel_capability(c.hotel_id,'stay.message'))
  );
$$;

create or replace function public.owner_invite_hotel_team_member(p_hotel_id integer,p_identifier text,p_role text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_owner public.profiles; v_member public.profiles; v_membership public.hotel_team_members; v_identifier text;
begin
  select * into v_owner from public.profiles where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_owner.user_id is null or not exists(select 1 from public.hotels where hotel_id=p_hotel_id and owner_id=v_owner.user_id)
    then raise exception 'Hotel owner access required'; end if;
  if p_role not in('manager','staff') then raise exception 'Choose Manager or Front desk'; end if;
  v_identifier:=btrim(regexp_replace(coalesce(p_identifier,''),'^@','','g'));
  if v_identifier='' then raise exception 'Enter a WeHouse username or user ID'; end if;
  select * into v_member from public.profiles
    where (lower(username)=lower(v_identifier) or user_id=v_identifier)
      and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)
    order by case when user_id=v_identifier then 0 else 1 end limit 1;
  if v_member.user_id is null then raise exception 'No active Personal WeHouse account matches that username or user ID'; end if;
  if v_member.user_id=v_owner.user_id then raise exception 'The hotel owner already has full access'; end if;
  if exists(select 1 from public.hotel_team_members where hotel_id=p_hotel_id and member_user_id=v_member.user_id and status='active')
    then raise exception 'This person already has hotel access'; end if;
  insert into public.hotel_team_members(hotel_id,member_user_id,hotel_role,status,invited_by,capabilities,updated_at,revoked_at,responded_at)
  values(p_hotel_id,v_member.user_id,p_role,'invited',v_owner.user_id,public.hotel_default_capabilities(p_role),now(),null,null)
  on conflict(hotel_id,member_user_id) do update set hotel_role=excluded.hotel_role,status='invited',invited_by=excluded.invited_by,
    capabilities=excluded.capabilities,updated_at=now(),revoked_at=null,responded_at=null
  returning * into v_membership;
  insert into public.notifications(recipient_id,type,title,message,related_id,source_type,source_id,destination_route,destination_params,event_key,workspace_scope)
  select v_member.user_id,'hotel_team_invitation','Hotel team invitation',
    'You were invited to join '||h.name||' as '||case when p_role='manager' then 'Manager' else 'Front desk' end||'.',
    v_membership.id::text,'hotel_team_invitation',v_membership.id::text,'notifications',
    jsonb_build_object('membership_id',v_membership.id,'hotel_id',p_hotel_id),
    'hotel-team-invite:'||v_membership.id::text||':'||extract(epoch from v_membership.updated_at)::bigint,'personal'
  from public.hotels h where h.hotel_id=p_hotel_id;
  return jsonb_build_object('id',v_membership.id,'name',coalesce(v_member.full_name,v_member.username,'WeHouse member'),
    'username',v_member.username,'user_id',v_member.user_id,'hotel_role',v_membership.hotel_role,'status',v_membership.status,'capabilities',v_membership.capabilities);
end;
$$;

create or replace function public.owner_set_hotel_team_capabilities(p_membership_id uuid,p_capabilities text[])
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_owner public.profiles; v_row public.hotel_team_members; v_caps text[]; v_invalid text[];
begin
  select * into v_owner from public.profiles where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  select tm.* into v_row from public.hotel_team_members tm join public.hotels h on h.hotel_id=tm.hotel_id
    where tm.id=p_membership_id and h.owner_id=v_owner.user_id for update;
  if v_row.id is null then raise exception 'Hotel owner access required'; end if;
  select coalesce(array_agg(distinct x order by x),'{}'::text[]) into v_caps from unnest(coalesce(p_capabilities,'{}'::text[])) x;
  select coalesce(array_agg(x),'{}'::text[]) into v_invalid from unnest(v_caps) x where not x=any(public.hotel_allowed_capabilities());
  if cardinality(v_invalid)>0 then raise exception 'Unsupported hotel capability'; end if;
  update public.hotel_team_members set capabilities=v_caps,updated_at=now() where id=v_row.id returning * into v_row;
  insert into public.audit_logs(id,admin_id,admin_email,action,target_type,target_id,details,created_at)
  values(gen_random_uuid()::text,v_owner.user_id,v_owner.email,'HOTEL_TEAM_CAPABILITIES_UPDATED','hotel_team_member',v_row.id::text,
    jsonb_build_object('hotel_id',v_row.hotel_id,'member_user_id',v_row.member_user_id,'capabilities',v_caps)::text,now());
  return jsonb_build_object('id',v_row.id,'hotel_id',v_row.hotel_id,'member_user_id',v_row.member_user_id,'hotel_role',v_row.hotel_role,'status',v_row.status,'capabilities',v_row.capabilities);
end;
$$;

create or replace function public.get_my_hotel_team(p_hotel_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_user text; v_result jsonb;
begin
  select user_id into v_user from public.profiles where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false);
  if not exists(select 1 from public.hotels where hotel_id=p_hotel_id and owner_id=v_user) then raise exception 'Hotel owner access required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',tm.id,'member_user_id',tm.member_user_id,'hotel_role',tm.hotel_role,
    'status',tm.status,'capabilities',tm.capabilities,'name',coalesce(p.full_name,p.username,'Team member'),'username',p.username,'updated_at',tm.updated_at)
    order by case when tm.status='invited' then 0 else 1 end,tm.created_at),'[]'::jsonb)
  into v_result from public.hotel_team_members tm join public.profiles p on p.user_id=tm.member_user_id
  where tm.hotel_id=p_hotel_id and tm.status in ('invited','active');
  return v_result;
end;
$$;

create or replace function public.get_my_hotel_operations()
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'hotel_id',h.hotel_id,'name',h.name,'description',h.description,'state',h.state,'city',h.city,'area',h.area,'address',h.address,
    'images',h.images,'amenities',h.amenities,'owner_id',h.owner_id,'status',h.status,'rating',h.rating,'review_count',h.review_count,
    'featured',h.featured,'check_in_time',h.check_in_time,'check_out_time',h.check_out_time,'turnover_minutes',h.turnover_minutes,
    'completion_mode',h.completion_mode,'completion_review_hours',h.completion_review_hours,'manual_completion_sla_hours',h.manual_completion_sla_hours,
    'created_at',h.created_at,'updated_at',h.updated_at,
    'access_role',case when h.owner_id=p.user_id then 'owner' else tm.hotel_role end,
    'capabilities',case when h.owner_id=p.user_id then public.hotel_allowed_capabilities() else coalesce(tm.capabilities,'{}'::text[]) end
  ) order by h.updated_at desc),'[]'::jsonb)
  from public.profiles p
  join public.hotels h on h.owner_id=p.user_id or exists(select 1 from public.hotel_team_members x where x.hotel_id=h.hotel_id and x.member_user_id=p.user_id and x.status='active')
  left join public.hotel_team_members tm on tm.hotel_id=h.hotel_id and tm.member_user_id=p.user_id and tm.status='active'
  where p.auth_id=(select auth.uid())::text and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false);
$$;

create or replace function public.partner_create_hotel_room(p_hotel_id integer,p_room_type text,p_description text,p_price_per_night integer,p_max_guests integer,p_bed_type text,p_total_rooms integer,p_amenities text[] default '{}'::text[],p_images text[] default '{}'::text[])
returns public.hotel_rooms
language plpgsql security definer set search_path to 'pg_catalog','public'
as $$
declare v_room public.hotel_rooms;
begin
  if not public.current_actor_has_hotel_capability(p_hotel_id,'hotel.rooms.manage') then raise exception 'Room management access required'; end if;
  if not exists(select 1 from public.hotels h where h.hotel_id=p_hotel_id and h.status in ('draft','active')) then raise exception 'Rooms cannot be changed while this hotel is closed or rejected'; end if;
  if nullif(btrim(p_room_type),'') is null or coalesce(p_price_per_night,0)<=0 or coalesce(p_max_guests,0)<1 or coalesce(p_total_rooms,0)<1 then raise exception 'Valid room name, rate, capacity and inventory are required'; end if;
  insert into public.hotel_rooms(hotel_id,room_type,description,price_per_night,max_guests,bed_type,total_rooms,amenities,images,source_system)
  values(p_hotel_id,btrim(p_room_type),nullif(btrim(coalesce(p_description,'')),''),p_price_per_night,p_max_guests,nullif(btrim(coalesce(p_bed_type,'')),''),p_total_rooms,coalesce(p_amenities,'{}'),coalesce(p_images,'{}'),'wehouse') returning * into v_room;
  insert into public.hotel_rate_plans(hotel_id,room_id,name,description,meal_plan,payment_timing,refundable,price_per_night,included_features)
  values(p_hotel_id,v_room.room_id,'Room only','Room without a meal package','room_only','pay_now',false,p_price_per_night,'{}');
  return v_room;
end;
$$;

create or replace function public.partner_update_hotel_room(p_room_id integer,p_room_type text,p_description text,p_price_per_night integer,p_max_guests integer,p_bed_type text,p_total_rooms integer,p_amenities text[] default null,p_images text[] default null)
returns public.hotel_rooms
language plpgsql security definer set search_path to 'pg_catalog','public'
as $$
declare v_room public.hotel_rooms;
begin
  select * into v_room from public.hotel_rooms where room_id=p_room_id for update;
  if v_room.room_id is null then raise exception 'Room type not found'; end if;
  if not public.current_actor_has_hotel_capability(v_room.hotel_id,'hotel.rooms.manage') then raise exception 'Room management access required'; end if;
  if nullif(btrim(p_room_type),'') is null or coalesce(p_price_per_night,0)<=0 or coalesce(p_max_guests,0)<1 or coalesce(p_total_rooms,0)<1 then raise exception 'Valid room name, rate, capacity and inventory are required'; end if;
  update public.hotel_rooms set room_type=btrim(p_room_type),description=nullif(btrim(coalesce(p_description,'')),''),price_per_night=p_price_per_night,
    max_guests=p_max_guests,bed_type=nullif(btrim(coalesce(p_bed_type,'')),''),total_rooms=p_total_rooms,amenities=coalesce(p_amenities,amenities),images=coalesce(p_images,images),updated_at=now()
  where room_id=p_room_id returning * into v_room;
  update public.hotel_rate_plans set price_per_night=p_price_per_night,updated_at=now() where room_id=p_room_id and name='Room only' and source_system='wehouse';
  return v_room;
end;
$$;

create or replace function public.partner_save_hotel_rate_plan(p_rate_plan_id integer,p_room_id integer,p_name text,p_description text,p_meal_plan text,p_payment_timing text,p_refundable boolean,p_cancellation_hours integer,p_price_per_night integer,p_included_features text[],p_active boolean default true)
returns public.hotel_rate_plans
language plpgsql security definer set search_path to 'pg_catalog','public'
as $$
declare v_room public.hotel_rooms; v_plan public.hotel_rate_plans;
begin
  select * into v_room from public.hotel_rooms where room_id=p_room_id;
  if v_room.room_id is null then raise exception 'Room type not found'; end if;
  if not public.current_actor_has_hotel_capability(v_room.hotel_id,'hotel.rates.manage') then raise exception 'Rate management access required'; end if;
  if nullif(btrim(p_name),'') is null or coalesce(p_price_per_night,0)<=0 then raise exception 'Package name and nightly price are required'; end if;
  if p_meal_plan not in ('room_only','breakfast','half_board','full_board','all_inclusive') or p_payment_timing not in ('pay_now','before_arrival','at_property') then raise exception 'Choose valid meal and payment options'; end if;
  if coalesce(p_refundable,false) and p_cancellation_hours is null then raise exception 'Refundable packages need a cancellation window'; end if;
  if p_rate_plan_id is not null and not coalesce(p_active,true) and not exists(select 1 from public.hotel_rate_plans plan where plan.room_id=v_room.room_id and plan.active and plan.rate_plan_id<>p_rate_plan_id) then raise exception 'A room must keep at least one visible package'; end if;
  if p_rate_plan_id is null then
    insert into public.hotel_rate_plans(hotel_id,room_id,name,description,meal_plan,payment_timing,refundable,cancellation_hours,price_per_night,included_features,active)
    values(v_room.hotel_id,v_room.room_id,btrim(p_name),nullif(btrim(coalesce(p_description,'')),''),p_meal_plan,p_payment_timing,coalesce(p_refundable,false),case when coalesce(p_refundable,false) then p_cancellation_hours else null end,p_price_per_night,coalesce(p_included_features,'{}'),coalesce(p_active,true)) returning * into v_plan;
  else
    update public.hotel_rate_plans set name=btrim(p_name),description=nullif(btrim(coalesce(p_description,'')),''),meal_plan=p_meal_plan,payment_timing=p_payment_timing,refundable=coalesce(p_refundable,false),cancellation_hours=case when coalesce(p_refundable,false) then p_cancellation_hours else null end,price_per_night=p_price_per_night,included_features=coalesce(p_included_features,'{}'),active=coalesce(p_active,true),updated_at=now()
    where rate_plan_id=p_rate_plan_id and room_id=v_room.room_id returning * into v_plan;
    if v_plan.rate_plan_id is null then raise exception 'Package not found for this room'; end if;
  end if;
  return v_plan;
end;
$$;

create or replace function public.partner_save_hotel_venue(p_venue_id integer,p_hotel_id integer,p_name text,p_kind text,p_description text,p_opening_hours text,p_package_notes text,p_active boolean default true)
returns public.hotel_venues
language plpgsql security definer set search_path to 'pg_catalog','public'
as $$
declare v_venue public.hotel_venues;
begin
  if not public.current_actor_has_hotel_capability(p_hotel_id,'hotel.policy.manage') then raise exception 'Hotel facility management access required'; end if;
  if nullif(btrim(p_name),'') is null or p_kind not in ('restaurant','bar','cafe','spa','lounge','pool','gym','other') then raise exception 'Facility name and type are required'; end if;
  if p_venue_id is null then
    insert into public.hotel_venues(hotel_id,name,kind,description,opening_hours,package_notes,active)
    values(p_hotel_id,btrim(p_name),p_kind,nullif(btrim(coalesce(p_description,'')),''),nullif(btrim(coalesce(p_opening_hours,'')),''),nullif(btrim(coalesce(p_package_notes,'')),''),coalesce(p_active,true)) returning * into v_venue;
  else
    update public.hotel_venues set name=btrim(p_name),kind=p_kind,description=nullif(btrim(coalesce(p_description,'')),''),opening_hours=nullif(btrim(coalesce(p_opening_hours,'')),''),package_notes=nullif(btrim(coalesce(p_package_notes,'')),''),active=coalesce(p_active,true),updated_at=now()
    where venue_id=p_venue_id and hotel_id=p_hotel_id returning * into v_venue;
    if v_venue.venue_id is null then raise exception 'Hotel facility not found'; end if;
  end if;
  return v_venue;
end;
$$;

create or replace function public.partner_set_hotel_inventory_range(p_room_id integer,p_start_date date,p_end_date date,p_available_quantity integer,p_closed boolean default false,p_rate_override integer default null,p_note text default null)
returns integer
language plpgsql security definer set search_path to 'pg_catalog','public'
as $$
declare v_room public.hotel_rooms; v_count integer; v_user text;
begin
  select * into v_room from public.hotel_rooms where room_id=p_room_id;
  if v_room.room_id is null then raise exception 'Room type not found'; end if;
  if not public.current_actor_has_hotel_capability(v_room.hotel_id,'hotel.inventory.manage') then raise exception 'Inventory management access required'; end if;
  select user_id into v_user from public.profiles where auth_id=(select auth.uid())::text;
  if p_start_date<current_date or p_end_date<p_start_date or p_end_date>p_start_date+366 then raise exception 'Choose a valid date range up to one year'; end if;
  if p_available_quantity<0 or p_available_quantity>v_room.total_rooms then raise exception 'Availability must be within this room type quantity'; end if;
  if p_rate_override is not null and p_rate_override<=0 then raise exception 'Rate override must be positive'; end if;
  insert into public.hotel_inventory_daily(hotel_id,room_id,inventory_date,available_quantity,rate_override,closed,note,updated_by,updated_at)
  select v_room.hotel_id,v_room.room_id,d,p_available_quantity,p_rate_override,coalesce(p_closed,false),nullif(btrim(coalesce(p_note,'')),''),v_user,now() from generate_series(p_start_date,p_end_date,interval '1 day') d
  on conflict(room_id,inventory_date) do update set available_quantity=excluded.available_quantity,rate_override=excluded.rate_override,closed=excluded.closed,note=excluded.note,updated_by=excluded.updated_by,updated_at=now();
  get diagnostics v_count=row_count; return v_count;
end;
$$;

create or replace function public.partner_update_hotel_stay_policy_v2(p_hotel_id integer,p_check_in_time time,p_check_out_time time,p_turnover_minutes integer,p_completion_mode text,p_completion_review_hours integer,p_manual_completion_sla_hours integer)
returns public.hotels
language plpgsql security definer set search_path to 'pg_catalog','public'
as $$
declare result public.hotels;
begin
  if not public.current_actor_has_hotel_capability(p_hotel_id,'hotel.policy.manage') then raise exception 'Hotel policy management access required'; end if;
  if p_check_in_time is null or p_check_out_time is null then raise exception 'Check-in and checkout times are required'; end if;
  if coalesce(p_turnover_minutes,-1) not between 0 and 1440 then raise exception 'Turnover must be between 0 and 1440 minutes'; end if;
  if p_completion_mode not in ('immediate','auto','manual') then raise exception 'Choose immediate, auto or manual completion'; end if;
  update public.hotels set check_in_time=p_check_in_time,check_out_time=p_check_out_time,turnover_minutes=p_turnover_minutes,completion_mode=p_completion_mode,
    completion_review_hours=greatest(0,least(coalesce(p_completion_review_hours,24),168)),manual_completion_sla_hours=greatest(1,least(coalesce(p_manual_completion_sla_hours,48),336)),updated_at=now()
  where hotel_id=p_hotel_id returning * into result;
  if result.hotel_id is null then raise exception 'Hotel not found'; end if;
  return result;
end;
$$;

create or replace function public.partner_update_hotel_stay_policy(p_hotel_id integer,p_check_in_time time,p_check_out_time time)
returns public.hotels
language plpgsql security definer set search_path to 'pg_catalog','public'
as $$
declare h public.hotels;
begin
  select * into h from public.hotels where hotel_id=p_hotel_id;
  if h.hotel_id is null then raise exception 'Hotel not found'; end if;
  return public.partner_update_hotel_stay_policy_v2(p_hotel_id,p_check_in_time,p_check_out_time,h.turnover_minutes,h.completion_mode,h.completion_review_hours,h.manual_completion_sla_hours);
end;
$$;

create or replace function public.partner_update_hotel_room_unit(p_unit_id bigint,p_unit_label text,p_floor_label text,p_status text)
returns public.hotel_room_units
language plpgsql security definer set search_path to 'pg_catalog','public'
as $$
declare unit public.hotel_room_units;
begin
  select * into unit from public.hotel_room_units where unit_id=p_unit_id for update;
  if unit.unit_id is null then raise exception 'Hotel room not found'; end if;
  if not public.current_actor_has_hotel_capability(unit.hotel_id,'room.mark_ready') then raise exception 'Room readiness access required'; end if;
  if nullif(btrim(coalesce(p_unit_label,'')),'') is null then raise exception 'Room number or label is required'; end if;
  if p_status not in ('ready','cleaning','maintenance','out_of_service') then raise exception 'Choose ready, cleaning, maintenance or out of service'; end if;
  if unit.current_booking_id is not null then raise exception 'An occupied room cannot be changed until checkout'; end if;
  update public.hotel_room_units set unit_label=btrim(p_unit_label),floor_label=nullif(btrim(coalesce(p_floor_label,'')),''),status=p_status,
    ready_after=case when p_status='ready' then null else ready_after end,updated_at=now()
  where unit_id=p_unit_id returning * into unit;
  return unit;
end;
$$;

create or replace function public.complete_hotel_stay_internal(p_booking_id integer,p_source text,p_actor_id text default null)
returns public.hotel_bookings
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare b public.hotel_bookings;
begin
  select * into b from public.hotel_bookings where booking_id=p_booking_id for update;
  if b.booking_id is null then raise exception 'Hotel booking not found'; end if;
  if b.status='completed' then return b; end if;
  if b.status<>'checked_out' or b.payment_status<>'paid' then raise exception 'Only a paid checked-out stay can be completed'; end if;
  update public.hotel_bookings set status='completed',completed_at=now(),completed_by=p_actor_id,completion_source=p_source,completion_due_at=null,updated_at=now()
  where booking_id=b.booking_id returning * into b;
  return b;
end;
$$;

create or replace function public.partner_complete_hotel_stay(p_booking_id integer)
returns public.hotel_bookings
language plpgsql security definer set search_path to 'pg_catalog','public'
as $$
declare b public.hotel_bookings; actor text;
begin
  select * into b from public.hotel_bookings where booking_id=p_booking_id;
  if b.booking_id is null then raise exception 'Hotel booking not found'; end if;
  if not public.current_actor_has_hotel_capability(b.hotel_id,'stay.complete') then raise exception 'Stay completion access required'; end if;
  select user_id into actor from public.profiles where auth_id=(select auth.uid())::text;
  return public.complete_hotel_stay_internal(p_booking_id,'hotel_manual',actor);
end;
$$;

create or replace function public.partner_transition_hotel_booking(p_booking_id integer,p_status text)
returns public.hotel_bookings
language plpgsql security definer set search_path to 'pg_catalog','public'
as $$
declare b public.hotel_bookings; h public.hotels; unit public.hotel_room_units; local_now timestamp; arrival_at timestamp; departure_at timestamp; due timestamptz;
begin
  select * into b from public.hotel_bookings where booking_id=p_booking_id for update;
  if b.booking_id is null then raise exception 'Hotel booking not found'; end if;
  select * into h from public.hotels where hotel_id=b.hotel_id;
  local_now:=timezone('Africa/Lagos',now()); arrival_at:=b.check_in::timestamp+h.check_in_time; departure_at:=b.check_out::timestamp+h.check_out_time;
  if p_status='checked_in' then
    if not public.current_actor_has_hotel_capability(b.hotel_id,'stay.check_in') then raise exception 'Check-in access required'; end if;
    if not (b.status='confirmed' and b.payment_status='paid' and local_now>=arrival_at and local_now<departure_at) then raise exception 'Check-in opens at % on %',to_char(h.check_in_time,'HH12:MI AM'),to_char(b.check_in,'Mon DD, YYYY'); end if;
    select * into unit from public.hotel_room_units where room_id=b.room_id and status='ready' and current_booking_id is null order by unit_label for update skip locked limit 1;
    if unit.unit_id is null then raise exception 'No ready room is available. Mark a cleaned room ready first'; end if;
    update public.hotel_room_units set status='occupied',current_booking_id=b.booking_id,ready_after=null,updated_at=now() where unit_id=unit.unit_id;
    update public.hotel_bookings set status='checked_in',assigned_room_unit_id=unit.unit_id,checked_in_at=now(),updated_at=now() where booking_id=b.booking_id returning * into b;
  elsif p_status='checked_out' then
    if not public.current_actor_has_hotel_capability(b.hotel_id,'stay.check_out') then raise exception 'Checkout access required'; end if;
    if not (b.status='checked_in' and b.payment_status='paid') then raise exception 'Only a paid checked-in stay can be checked out'; end if;
    if h.completion_mode='immediate' then due:=now(); elsif h.completion_mode='manual' then due:=now()+make_interval(hours=>h.manual_completion_sla_hours); else due:=now()+make_interval(hours=>h.completion_review_hours); end if;
    if b.assigned_room_unit_id is not null then
      update public.hotel_room_units set status='cleaning',current_booking_id=null,ready_after=now()+make_interval(mins=>h.turnover_minutes),updated_at=now() where unit_id=b.assigned_room_unit_id;
    end if;
    update public.hotel_bookings set status='checked_out',checked_out_at=now(),completion_due_at=due,updated_at=now() where booking_id=b.booking_id returning * into b;
    if h.completion_mode='immediate' then b:=public.complete_hotel_stay_internal(b.booking_id,'immediate',null); end if;
  else raise exception 'Unsupported hotel booking transition'; end if;
  return b;
end;
$$;

create or replace function public.release_completed_hotel_partner_earning()
returns trigger
language plpgsql security definer set search_path to 'pg_catalog','public'
as $$
declare bp public.booking_payments; e public.property_partner_earning_releases; w public.wallets; new_pending numeric; new_available numeric;
begin
  if new.status<>'completed' or old.status='completed' or new.payment_status<>'paid' then return new; end if;
  select * into bp from public.booking_payments where hotel_booking_id=new.booking_id and purpose='hotel_booking' and status in ('paid','completed') order by created_at desc limit 1;
  if bp.id is null then
    insert into public.financial_audit_logs(event_type,user_id,amount,reference_id,reference_type,description,metadata)
    values('hotel_completion_payout_review',new.user_id,new.total_price,new.booking_id::text,'hotel_booking','Completed hotel stay has no verified booking payment',jsonb_build_object('hotel_id',new.hotel_id));
    return new;
  end if;
  select * into e from public.property_partner_earning_releases where payment_id=bp.id for update;
  if e.id is null or e.status='available' then return new; end if;
  if e.status<>'pending' or e.earning_type<>'hotel_payment' then return new; end if;
  select * into w from public.wallets where owner_id=e.partner_id and owner_type='property_partner' for update;
  if w.id is null or coalesce(w.is_frozen,false) or coalesce(w.pending_balance,0)<e.net_amount then
    insert into public.financial_audit_logs(event_type,user_id,target_user_id,amount,reference_id,reference_type,description,metadata)
    values('hotel_completion_payout_review',new.user_id,e.partner_id,e.net_amount,bp.id::text,'booking_payment','Completed hotel earning requires Finance review',jsonb_build_object('booking_id',new.booking_id,'earning_status',e.status));
    return new;
  end if;
  new_pending:=w.pending_balance-e.net_amount; new_available:=coalesce(w.available_balance,0)+e.net_amount;
  update public.wallets set pending_balance=new_pending,available_balance=new_available,updated_at=now() where id=w.id;
  update public.property_partner_earning_releases set status='available',release_event='hotel_stay_completed',released_by=null,released_at=now(),updated_at=now() where id=e.id and status='pending';
  update public.commission_ledger set status='settled',updated_at=now() where payment_id=bp.id and status='collected';
  update public.property_partners set total_earnings=coalesce(total_earnings,0)+e.net_amount,updated_at=now() where profile_id=e.partner_id;
  insert into public.wallet_transactions(user_id,transaction_type,amount,balance_after,reference_id,reference_type,description,metadata,created_at)
  values(e.partner_id,'property_earning_released',e.net_amount,new_available,bp.id::text,'booking_payment','Hotel stay earnings released after completion',jsonb_build_object('release_event','hotel_stay_completed','hotel_booking_id',new.booking_id,'pending_balance_after',new_pending,'available_balance_after',new_available),now());
  insert into public.financial_audit_logs(event_type,user_id,target_user_id,amount,reference_id,reference_type,description,metadata)
  values('payment_protection_credit_wallet',new.user_id,e.partner_id,e.net_amount,bp.id::text,'booking_payment','Hotel stay completed; protected earnings released',jsonb_build_object('hotel_booking_id',new.booking_id,'release_event','hotel_stay_completed'));
  return new;
end;
$$;

drop trigger if exists hotel_booking_release_partner_earning on public.hotel_bookings;
create trigger hotel_booking_release_partner_earning
after update of status on public.hotel_bookings
for each row execute function public.release_completed_hotel_partner_earning();

create or replace function public.process_due_hotel_stay_completions()
returns integer
language plpgsql security definer set search_path to 'pg_catalog','public'
as $$
declare r record; n integer:=0; source text;
begin
  update public.hotel_room_units set status='ready',ready_after=null,updated_at=now()
  where status='cleaning' and current_booking_id is null and ready_after is not null and ready_after<=now();
  for r in
    select b.booking_id,h.completion_mode from public.hotel_bookings b join public.hotels h on h.hotel_id=b.hotel_id
    where b.status='checked_out' and b.payment_status='paid' and b.completion_due_at is not null and b.completion_due_at<=now()
    for update of b skip locked
  loop
    source:=case when r.completion_mode='manual' then 'manual_sla_fallback' else 'auto_review' end;
    perform public.complete_hotel_stay_internal(r.booking_id,source,null); n:=n+1;
  end loop;
  return n;
end;
$$;

-- Server-only helpers/triggers.
revoke all on function public.complete_hotel_stay_internal(integer,text,text) from public,anon,authenticated;
revoke all on function public.process_due_hotel_stay_completions() from public,anon,authenticated;
revoke all on function public.release_completed_hotel_partner_earning() from public,anon,authenticated;
grant execute on function public.complete_hotel_stay_internal(integer,text,text) to service_role;
grant execute on function public.process_due_hotel_stay_completions() to service_role;
grant execute on function public.release_completed_hotel_partner_earning() to service_role;

revoke all on function public.owner_set_hotel_team_capabilities(uuid,text[]) from public,anon;
revoke all on function public.partner_complete_hotel_stay(integer) from public,anon;
revoke all on function public.partner_update_hotel_stay_policy_v2(integer,time,time,integer,text,integer,integer) from public,anon;
grant execute on function public.owner_set_hotel_team_capabilities(uuid,text[]) to authenticated,service_role;
grant execute on function public.partner_complete_hotel_stay(integer) to authenticated,service_role;
grant execute on function public.partner_update_hotel_stay_policy_v2(integer,time,time,integer,text,integer,integer) to authenticated,service_role;

-- Capability-aware direct read policies.
drop policy if exists hotel_inventory_team_read on public.hotel_inventory_daily;
create policy hotel_inventory_team_read on public.hotel_inventory_daily for select to authenticated
using (public.current_actor_has_hotel_capability(hotel_id,'hotel.inventory.manage') or public.current_actor_has_hotel_capability(hotel_id,'stay.read'));

drop policy if exists hotel_room_units_operator_read on public.hotel_room_units;
create policy hotel_room_units_operator_read on public.hotel_room_units for select to authenticated
using (public.current_actor_has_hotel_capability(hotel_id,'stay.read') or public.current_actor_has_hotel_capability(hotel_id,'hotel.rooms.manage'));

-- No browser role may create or mutate supply records directly. Property Partner
-- submissions enter through the verified evidence/inspection pipeline; hotel owner/team
-- changes use narrow SECURITY DEFINER commands above.
drop policy if exists hotels_internal_insert on public.hotels;
drop policy if exists hotels_internal_update on public.hotels;
drop policy if exists hotels_internal_delete on public.hotels;
drop policy if exists hotel_rooms_internal_insert on public.hotel_rooms;
drop policy if exists hotel_rooms_internal_update on public.hotel_rooms;
drop policy if exists hotel_rooms_internal_delete on public.hotel_rooms;
drop policy if exists hotel_bookings_customer_insert_v2 on public.hotel_bookings;
drop policy if exists hotel_bookings_customer_update_v2 on public.hotel_bookings;

revoke insert,update,delete,truncate,trigger,references on table public.hotels from anon,authenticated;
revoke insert,update,delete,truncate,trigger,references on table public.hotel_rooms from anon,authenticated;
revoke insert,update,delete,truncate,trigger,references on table public.hotel_bookings from anon,authenticated;
revoke insert,update,delete,truncate,trigger,references on table public.hotel_rate_plans from anon,authenticated;
revoke insert,update,delete,truncate,trigger,references on table public.hotel_room_units from anon,authenticated;
revoke insert,update,delete,truncate,trigger,references on table public.hotel_inventory_daily from anon,authenticated;
revoke select on table public.hotel_inventory_daily from anon;

-- Mature public hotel reads use the safe RPC projection, not raw operational inventory.
drop policy if exists hotel_inventory_daily_read on public.hotel_inventory_daily;

-- Run completion/turnover reconciliation every 10 minutes. Replacing by job name is idempotent.
do $$
declare j record;
begin
  for j in select jobid from cron.job where jobname='wehouse-hotel-completion-v1' loop perform cron.unschedule(j.jobid); end loop;
  perform cron.schedule('wehouse-hotel-completion-v1','*/10 * * * *','select public.process_due_hotel_stay_completions();');
end $$;

comment on function public.partner_transition_hotel_booking(integer,text)
is 'Capability-authorized physical check-in/out. Checkout starts turnover and completion policy; completion releases protected hotel earnings exactly once.';
