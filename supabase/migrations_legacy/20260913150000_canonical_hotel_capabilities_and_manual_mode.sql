-- D-002/D-014: hotel roles are display presets; capabilities authorize every
-- hotel action. Manual WeHouse operation remains the default. Verified hotel
-- facts cannot be changed directly after publication.

alter table public.hotels
  add column if not exists timezone text not null default 'Africa/Lagos';

create or replace function public.validate_hotel_timezone()
returns trigger
language plpgsql
set search_path to 'pg_catalog','public'
as $$
begin
  if nullif(btrim(coalesce(new.timezone,'')),'') is null
     or not exists(select 1 from pg_catalog.pg_timezone_names where name=new.timezone) then
    raise exception 'Choose a valid IANA hotel timezone';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_hotel_timezone_before_write on public.hotels;
create trigger validate_hotel_timezone_before_write
before insert or update of timezone on public.hotels
for each row execute function public.validate_hotel_timezone();

alter table public.hotel_team_members
  add column if not exists capabilities text[] not null default array[]::text[];

alter table public.hotel_team_members
  drop constraint if exists hotel_team_members_hotel_role_check;

update public.hotel_team_members
set hotel_role='front_desk',updated_at=now()
where hotel_role='staff';

alter table public.hotel_team_members
  add constraint hotel_team_members_hotel_role_check
  check (hotel_role in ('manager','front_desk'));

create or replace function public.hotel_allowed_capabilities()
returns text[]
language sql
immutable
set search_path to 'pg_catalog','public'
as $$
  select array[
    'stay.read','stay.message','stay.assign_unit','stay.check_in','stay.check_out',
    'stay.modify_commercial','room.mark_ready','hotel.inventory.manage',
    'hotel.rate.manage','hotel.policy.manage','hotel.team.manage'
  ]::text[]
$$;

create or replace function public.hotel_default_capabilities(p_role text)
returns text[]
language sql
immutable
set search_path to 'pg_catalog','public'
as $$
  select case p_role
    when 'owner' then public.hotel_allowed_capabilities()
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
    ]::text[] -- compatibility input; stored role is front_desk
    else array[]::text[]
  end
$$;

create or replace function public.hotel_capabilities_valid(p_caps text[])
returns boolean
language sql
immutable
set search_path to 'pg_catalog','public'
as $$
  select coalesce(p_caps,array[]::text[]) <@ public.hotel_allowed_capabilities()
$$;

update public.hotel_team_members
set capabilities=public.hotel_default_capabilities(hotel_role),updated_at=now()
where cardinality(coalesce(capabilities,array[]::text[]))=0;

alter table public.hotel_team_members
  drop constraint if exists hotel_team_members_capabilities_valid;
alter table public.hotel_team_members
  add constraint hotel_team_members_capabilities_valid
  check (public.hotel_capabilities_valid(capabilities));

create or replace function public.set_hotel_team_default_capabilities()
returns trigger
language plpgsql
set search_path to 'pg_catalog','public'
as $$
begin
  new.hotel_role:=case when new.hotel_role='staff' then 'front_desk' else new.hotel_role end;
  if (tg_op='INSERT' and cardinality(coalesce(new.capabilities,array[]::text[]))=0)
     or (tg_op='UPDATE' and new.hotel_role is distinct from old.hotel_role
         and new.capabilities is not distinct from old.capabilities) then
    new.capabilities:=public.hotel_default_capabilities(new.hotel_role);
  end if;
  return new;
end;
$$;

drop trigger if exists hotel_team_default_capabilities on public.hotel_team_members;
create trigger hotel_team_default_capabilities
before insert or update of hotel_role on public.hotel_team_members
for each row execute function public.set_hotel_team_default_capabilities();

create or replace function public.current_actor_hotel_capabilities(p_hotel_id integer)
returns text[]
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  with actor as (select public.current_profile_user_id() as user_id)
  select case
    when hotel.owner_id=actor.user_id then public.hotel_default_capabilities('owner')
    else coalesce(member.capabilities,array[]::text[])
  end
  from public.hotels hotel
  cross join actor
  left join public.hotel_team_members member
    on member.hotel_id=hotel.hotel_id
   and member.member_user_id=actor.user_id
   and member.status='active'
  where hotel.hotel_id=p_hotel_id
    and actor.user_id is not null
    and (hotel.owner_id=actor.user_id or member.id is not null)
  limit 1
$$;

create or replace function public.hotel_actor_has_capability(
  p_hotel_id integer,
  p_capability text
)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select coalesce(p_capability=any(public.current_actor_hotel_capabilities(p_hotel_id)),false)
$$;

create or replace function public.hotel_actor_has_any_capability(p_hotel_id integer)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select cardinality(coalesce(public.current_actor_hotel_capabilities(p_hotel_id),array[]::text[]))>0
$$;

create or replace function public.get_my_hotel_capabilities(p_hotel_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_user text:=public.current_profile_user_id();
  v_role text;
  v_caps text[];
begin
  if v_user is null then raise exception 'Active Personal account required'; end if;
  if exists(select 1 from public.hotels where hotel_id=p_hotel_id and owner_id=v_user) then
    v_role:='owner';
    v_caps:=public.hotel_default_capabilities('owner');
  else
    select member.hotel_role,member.capabilities into v_role,v_caps
    from public.hotel_team_members member
    where member.hotel_id=p_hotel_id and member.member_user_id=v_user
      and member.status='active'
    limit 1;
  end if;
  if v_role is null then raise exception 'Hotel access required'; end if;
  return jsonb_build_object(
    'hotel_id',p_hotel_id,'role',v_role,
    'capabilities',to_jsonb(coalesce(v_caps,array[]::text[]))
  );
end;
$$;

create or replace function public.current_actor_can_read_hotel_record(
  p_hotel_id integer,
  p_owner_id text,
  p_state text,
  p_city text
)
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
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null then return false; end if;
  return p_owner_id=v_actor.user_id
    or v_actor.role='creator'
    or public.hotel_actor_has_any_capability(p_hotel_id)
    or (((v_actor.role='admin')
      or (v_actor.role='staff' and public.current_staff_has_permission('operations')))
      and public.current_actor_in_scope(p_state,p_city));
end;
$$;

create or replace function public.current_actor_can_read_hotel_booking_record(
  p_hotel_id integer,
  p_customer_id text
)
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
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null then return false; end if;
  if p_customer_id=v_actor.user_id or v_actor.role='creator' then return true; end if;
  select * into v_hotel from public.hotels where hotel_id=p_hotel_id;
  if v_hotel.hotel_id is null then return false; end if;
  return public.hotel_actor_has_capability(p_hotel_id,'stay.read')
    or (((v_actor.role='admin')
      or (v_actor.role='staff' and public.current_staff_has_permission('operations')))
      and public.current_actor_in_scope(v_hotel.state,v_hotel.city));
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
    'hotel_id',hotel.hotel_id,'name',hotel.name,'description',hotel.description,
    'state',hotel.state,'city',hotel.city,'area',hotel.area,'address',hotel.address,
    'images',hotel.images,'amenities',hotel.amenities,'owner_id',hotel.owner_id,
    'status',hotel.status,'rating',hotel.rating,'review_count',hotel.review_count,
    'featured',hotel.featured,'check_in_time',hotel.check_in_time,
    'check_out_time',hotel.check_out_time,'timezone',hotel.timezone,
    'created_at',hotel.created_at,'updated_at',hotel.updated_at,
    'access_role',case when hotel.owner_id=profile.user_id then 'owner' else member.hotel_role end,
    'capabilities',case when hotel.owner_id=profile.user_id
      then to_jsonb(public.hotel_default_capabilities('owner'))
      else to_jsonb(coalesce(member.capabilities,array[]::text[])) end
  ) order by hotel.updated_at desc),'[]'::jsonb)
  from public.profiles profile
  join public.hotels hotel on hotel.owner_id=profile.user_id or exists(
    select 1 from public.hotel_team_members assigned
    where assigned.hotel_id=hotel.hotel_id
      and assigned.member_user_id=profile.user_id and assigned.status='active'
  )
  left join public.hotel_team_members member
    on member.hotel_id=hotel.hotel_id and member.member_user_id=profile.user_id
   and member.status='active'
  where profile.auth_id=(select auth.uid())::text
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
$$;

create or replace function public.owner_set_hotel_team_capabilities(
  p_membership_id uuid,
  p_capabilities text[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_row public.hotel_team_members;
  v_owner text;
  v_actor_caps text[]:=array[]::text[];
  v_caps text[];
begin
  if v_actor is null then raise exception 'Active Personal account required'; end if;
  select member.* into v_row
  from public.hotel_team_members member
  where member.id=p_membership_id
  for update of member;
  if v_row.id is null then raise exception 'Hotel membership not found'; end if;
  select owner_id into v_owner from public.hotels where hotel_id=v_row.hotel_id;
  select coalesce(array_agg(distinct cap order by cap),array[]::text[])
    into v_caps from unnest(coalesce(p_capabilities,array[]::text[])) cap;
  if not public.hotel_capabilities_valid(v_caps) then
    raise exception 'Unsupported hotel capability';
  end if;
  if v_owner<>v_actor then
    v_actor_caps:=public.current_actor_hotel_capabilities(v_row.hotel_id);
    if not coalesce('hotel.team.manage'=any(v_actor_caps),false) then
      raise exception 'Hotel team management access required';
    end if;
    if v_row.member_user_id=v_actor then
      raise exception 'Delegated managers cannot change their own permissions';
    end if;
    if not(v_row.capabilities<@v_actor_caps) or not(v_caps<@v_actor_caps) then
      raise exception 'You cannot manage permissions outside your own hotel access';
    end if;
  end if;
  update public.hotel_team_members
  set capabilities=v_caps,updated_at=now()
  where id=v_row.id returning * into v_row;
  insert into public.audit_logs(action,target_type,target_id,details,admin_id)
  values('HOTEL_TEAM_CAPABILITIES_UPDATED','hotel_team_member',v_row.id::text,
    jsonb_build_object('hotel_id',v_row.hotel_id,'member_user_id',v_row.member_user_id,
      'capabilities',v_caps)::text,v_actor);
  return jsonb_build_object(
    'id',v_row.id,'hotel_id',v_row.hotel_id,'member_user_id',v_row.member_user_id,
    'hotel_role',v_row.hotel_role,'status',v_row.status,
    'capabilities',to_jsonb(v_row.capabilities)
  );
end;
$$;

create or replace function public.get_my_hotel_team(p_hotel_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_result jsonb;
begin
  if not public.hotel_actor_has_capability(p_hotel_id,'hotel.team.manage') then
    raise exception 'Hotel team management access required';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',member.id,'member_user_id',member.member_user_id,
    'hotel_role',member.hotel_role,'status',member.status,
    'capabilities',member.capabilities,
    'name',coalesce(profile.full_name,profile.username,'Team member'),
    'username',profile.username,'updated_at',member.updated_at
  ) order by case when member.status='invited' then 0 else 1 end,member.created_at),'[]'::jsonb)
  into v_result
  from public.hotel_team_members member
  join public.profiles profile on profile.user_id=member.member_user_id
  where member.hotel_id=p_hotel_id and member.status in ('invited','active');
  return v_result;
end;
$$;

create or replace function public.owner_invite_hotel_team_member(
  p_hotel_id integer,
  p_identifier text,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_member public.profiles;
  v_membership public.hotel_team_members;
  v_identifier text;
  v_role text:=case when p_role='staff' then 'front_desk' else p_role end;
  v_owner text;
  v_actor_caps text[]:=array[]::text[];
  v_default_caps text[];
begin
  select * into v_actor from public.profiles
  where user_id=public.current_profile_user_id()
  limit 1;
  if v_actor.user_id is null then raise exception 'Active Personal account required'; end if;
  select owner_id into v_owner from public.hotels where hotel_id=p_hotel_id;
  if v_owner is null then raise exception 'Hotel not found'; end if;
  if v_owner<>v_actor.user_id then
    v_actor_caps:=public.current_actor_hotel_capabilities(p_hotel_id);
    if not coalesce('hotel.team.manage'=any(v_actor_caps),false) then
      raise exception 'Hotel team management access required';
    end if;
  end if;
  if v_role not in ('manager','front_desk') then
    raise exception 'Choose Manager or Front Desk';
  end if;
  v_default_caps:=public.hotel_default_capabilities(v_role);
  if v_owner<>v_actor.user_id and not(v_default_caps<@v_actor_caps) then
    raise exception 'You cannot grant permissions outside your own hotel access';
  end if;
  v_identifier:=btrim(regexp_replace(coalesce(p_identifier,''),'^@','','g'));
  if v_identifier='' then raise exception 'Enter a WeHouse username or user ID'; end if;
  select * into v_member from public.profiles
  where (lower(username)=lower(v_identifier) or user_id=v_identifier)
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false)
  order by case when user_id=v_identifier then 0 else 1 end
  limit 1;
  if v_member.user_id is null then
    raise exception 'No active Personal WeHouse account matches that username or user ID';
  end if;
  if v_member.user_id=v_actor.user_id then
    raise exception 'You cannot invite or change your own hotel access';
  end if;
  if exists(select 1 from public.hotel_team_members
    where hotel_id=p_hotel_id and member_user_id=v_member.user_id and status='active') then
    raise exception 'This person already has hotel access';
  end if;
  insert into public.hotel_team_members(
    hotel_id,member_user_id,hotel_role,status,invited_by,capabilities,
    updated_at,revoked_at,responded_at
  ) values(
    p_hotel_id,v_member.user_id,v_role,'invited',v_actor.user_id,v_default_caps,
    now(),null,null
  ) on conflict(hotel_id,member_user_id) do update set
    hotel_role=excluded.hotel_role,status='invited',invited_by=excluded.invited_by,
    capabilities=excluded.capabilities,updated_at=now(),revoked_at=null,responded_at=null
  returning * into v_membership;
  insert into public.notifications(
    recipient_id,type,title,message,related_id,source_type,source_id,
    destination_route,destination_params,event_key,workspace_scope
  ) select
    v_member.user_id,'hotel_team_invitation','Hotel team invitation',
    'You were invited to join '||hotel.name||' as '
      ||case when v_role='manager' then 'Manager' else 'Front Desk' end||'.',
    v_membership.id::text,'hotel_team_invitation',v_membership.id::text,
    'notifications',jsonb_build_object('membership_id',v_membership.id,'hotel_id',p_hotel_id),
    'hotel-team-invite:'||v_membership.id::text||':'
      ||extract(epoch from v_membership.updated_at)::bigint,'personal'
  from public.hotels hotel where hotel.hotel_id=p_hotel_id;
  return jsonb_build_object(
    'id',v_membership.id,'name',coalesce(v_member.full_name,v_member.username,'WeHouse member'),
    'username',v_member.username,'user_id',v_member.user_id,
    'hotel_role',v_membership.hotel_role,'status',v_membership.status,
    'capabilities',to_jsonb(v_membership.capabilities)
  );
end;
$$;

create or replace function public.owner_revoke_hotel_team_member(p_membership_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_row public.hotel_team_members;
  v_owner text;
  v_actor_caps text[]:=array[]::text[];
begin
  if v_actor is null then raise exception 'Active Personal account required'; end if;
  select member.* into v_row
  from public.hotel_team_members member
  where member.id=p_membership_id
  for update of member;
  if v_row.id is null then raise exception 'Hotel membership not found'; end if;
  select owner_id into v_owner from public.hotels where hotel_id=v_row.hotel_id;
  if v_owner<>v_actor then
    v_actor_caps:=public.current_actor_hotel_capabilities(v_row.hotel_id);
    if not coalesce('hotel.team.manage'=any(v_actor_caps),false) then
      raise exception 'Hotel team management access required';
    end if;
    if v_row.member_user_id=v_actor then
      raise exception 'Delegated managers cannot revoke their own access';
    end if;
    if not(v_row.capabilities<@v_actor_caps) then
      raise exception 'You cannot revoke a membership above your own hotel access';
    end if;
  end if;
  update public.hotel_team_members
  set status='revoked',revoked_at=now(),updated_at=now()
  where id=v_row.id;
  return true;
end;
$$;

create or replace function public.respond_to_hotel_team_invitation(
  p_membership_id uuid,
  p_accept boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_row public.hotel_team_members;
  v_hotel public.hotels;
begin
  select * into v_actor from public.profiles
  where user_id=public.current_profile_user_id()
  limit 1;
  if v_actor.user_id is null then raise exception 'Active Personal account required'; end if;
  select * into v_row from public.hotel_team_members
  where id=p_membership_id and member_user_id=v_actor.user_id
  for update;
  if v_row.id is null then raise exception 'Hotel invitation not found'; end if;
  if v_row.status<>'invited' then raise exception 'This hotel invitation is no longer pending'; end if;
  update public.hotel_team_members
  set status=case when p_accept then 'active' else 'declined' end,
    responded_at=now(),updated_at=now(),revoked_at=null
  where id=v_row.id returning * into v_row;
  select * into v_hotel from public.hotels where hotel_id=v_row.hotel_id;
  insert into public.notifications(
    recipient_id,type,title,message,related_id,source_type,source_id,
    destination_route,destination_params,event_key,workspace_scope
  ) values(
    v_row.invited_by,'hotel_team_invitation_response',
    case when p_accept then 'Hotel invitation accepted' else 'Hotel invitation declined' end,
    coalesce(v_actor.full_name,v_actor.username,'A WeHouse member')
      ||case when p_accept then ' accepted ' else ' declined ' end
      ||coalesce(v_hotel.name,'the hotel')||'.',
    v_row.id::text,'hotel_team_member',v_row.id::text,'property-owner',
    jsonb_build_object('hotel_id',v_row.hotel_id),
    'hotel-team-response:'||v_row.id::text||':'
      ||case when p_accept then 'accepted' else 'declined' end,'property_partner'
  );
  return jsonb_build_object(
    'id',v_row.id,'accepted',p_accept,'hotel_id',v_row.hotel_id,
    'hotel_role',v_row.hotel_role,'capabilities',to_jsonb(v_row.capabilities)
  );
end;
$$;

create table if not exists public.hotel_commercial_change_audit (
  change_id uuid primary key default gen_random_uuid(),
  hotel_id integer not null references public.hotels(hotel_id) on delete restrict,
  actor_user_id text references public.profiles(user_id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  before_values jsonb not null default '{}'::jsonb,
  after_values jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (nullif(btrim(action),'') is not null),
  check (nullif(btrim(target_type),'') is not null)
);

create index if not exists hotel_commercial_change_audit_hotel_time_idx
  on public.hotel_commercial_change_audit(hotel_id,created_at desc);
alter table public.hotel_commercial_change_audit enable row level security;
revoke all on table public.hotel_commercial_change_audit from public,anon,authenticated;
grant select,insert on table public.hotel_commercial_change_audit to service_role;

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
)
returns public.hotel_rooms
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_room public.hotel_rooms; v_actor text:=public.current_profile_user_id();
begin
  if not public.hotel_actor_has_capability(p_hotel_id,'hotel.inventory.manage')
     or not public.hotel_actor_has_capability(p_hotel_id,'hotel.rate.manage') then
    raise exception 'Hotel inventory and rate capabilities are required';
  end if;
  if not exists(select 1 from public.hotels where hotel_id=p_hotel_id and status='draft') then
    raise exception 'A live hotel needs WeHouse review before a room type is added';
  end if;
  if nullif(btrim(p_room_type),'') is null or coalesce(p_price_per_night,0)<=0
     or coalesce(p_max_guests,0)<1 or coalesce(p_total_rooms,0)<1 then
    raise exception 'Valid room name, rate, capacity and inventory are required';
  end if;
  insert into public.hotel_rooms(
    hotel_id,room_type,description,price_per_night,max_guests,bed_type,
    total_rooms,amenities,images,source_system
  ) values(
    p_hotel_id,btrim(p_room_type),nullif(btrim(coalesce(p_description,'')),''),
    p_price_per_night,p_max_guests,nullif(btrim(coalesce(p_bed_type,'')),''),
    p_total_rooms,coalesce(p_amenities,array[]::text[]),
    coalesce(p_images,array[]::text[]),'wehouse'
  ) returning * into v_room;
  insert into public.hotel_rate_plans(
    hotel_id,room_id,name,description,meal_plan,payment_timing,refundable,
    price_per_night,included_features
  ) values(
    p_hotel_id,v_room.room_id,'Room only','Room without a meal package',
    'room_only','pay_now',false,p_price_per_night,array[]::text[]
  );
  insert into public.hotel_commercial_change_audit(
    hotel_id,actor_user_id,action,target_type,target_id,after_values
  ) values(
    p_hotel_id,v_actor,'draft_room_created','hotel_room',v_room.room_id::text,
    jsonb_build_object('price_per_night',p_price_per_night,'total_rooms',p_total_rooms)
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
)
returns public.hotel_rooms
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_room public.hotel_rooms;
  v_hotel_status text;
  v_actor text:=public.current_profile_user_id();
  v_before jsonb;
begin
  select * into v_room from public.hotel_rooms where room_id=p_room_id for update;
  if v_room.room_id is null then raise exception 'Room type not found'; end if;
  if not public.hotel_actor_has_capability(v_room.hotel_id,'hotel.rate.manage') then
    raise exception 'Hotel rate capability required';
  end if;
  if nullif(btrim(p_room_type),'') is null or coalesce(p_price_per_night,0)<=0
     or coalesce(p_max_guests,0)<1 or coalesce(p_total_rooms,0)<1 then
    raise exception 'Valid room name, rate, capacity and inventory are required';
  end if;
  select status into v_hotel_status from public.hotels where hotel_id=v_room.hotel_id;
  if v_hotel_status='active' and (
    btrim(p_room_type) is distinct from v_room.room_type
    or nullif(btrim(coalesce(p_description,'')),'') is distinct from v_room.description
    or p_max_guests is distinct from v_room.max_guests
    or nullif(btrim(coalesce(p_bed_type,'')),'') is distinct from v_room.bed_type
    or p_total_rooms is distinct from v_room.total_rooms
    or coalesce(p_amenities,v_room.amenities) is distinct from v_room.amenities
    or coalesce(p_images,v_room.images) is distinct from v_room.images
  ) then
    raise exception 'Verified room facts and public media need WeHouse review before publication';
  end if;
  if v_hotel_status='draft'
     and not public.hotel_actor_has_capability(v_room.hotel_id,'hotel.inventory.manage') then
    raise exception 'Hotel inventory capability required for draft room facts';
  end if;
  v_before:=jsonb_build_object(
    'room_type',v_room.room_type,'description',v_room.description,
    'price_per_night',v_room.price_per_night,'max_guests',v_room.max_guests,
    'bed_type',v_room.bed_type,'total_rooms',v_room.total_rooms,
    'amenities',v_room.amenities,'images',v_room.images
  );
  update public.hotel_rooms set
    room_type=case when v_hotel_status='draft' then btrim(p_room_type) else room_type end,
    description=case when v_hotel_status='draft'
      then nullif(btrim(coalesce(p_description,'')),'') else description end,
    price_per_night=p_price_per_night,
    max_guests=case when v_hotel_status='draft' then p_max_guests else max_guests end,
    bed_type=case when v_hotel_status='draft'
      then nullif(btrim(coalesce(p_bed_type,'')),'') else bed_type end,
    total_rooms=case when v_hotel_status='draft' then p_total_rooms else total_rooms end,
    amenities=case when v_hotel_status='draft' then coalesce(p_amenities,amenities) else amenities end,
    images=case when v_hotel_status='draft' then coalesce(p_images,images) else images end,
    updated_at=now()
  where room_id=p_room_id returning * into v_room;
  update public.hotel_rate_plans
  set price_per_night=p_price_per_night,updated_at=now()
  where room_id=p_room_id and name='Room only' and source_system='wehouse';
  insert into public.hotel_commercial_change_audit(
    hotel_id,actor_user_id,action,target_type,target_id,before_values,after_values
  ) values(
    v_room.hotel_id,v_actor,
    case when v_hotel_status='draft' then 'draft_room_updated' else 'future_room_rate_updated' end,
    'hotel_room',v_room.room_id::text,v_before,
    jsonb_build_object(
      'room_type',v_room.room_type,'description',v_room.description,
      'price_per_night',v_room.price_per_night,'max_guests',v_room.max_guests,
      'bed_type',v_room.bed_type,'total_rooms',v_room.total_rooms,
      'amenities',v_room.amenities,'images',v_room.images
    )
  );
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
)
returns public.hotel_rate_plans
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_room public.hotel_rooms;
  v_plan public.hotel_rate_plans;
  v_before jsonb:='{}'::jsonb;
  v_actor text:=public.current_profile_user_id();
begin
  select * into v_room from public.hotel_rooms where room_id=p_room_id;
  if v_room.room_id is null then raise exception 'Room type not found'; end if;
  if not public.hotel_actor_has_capability(v_room.hotel_id,'hotel.rate.manage') then
    raise exception 'Hotel rate capability required';
  end if;
  if nullif(btrim(p_name),'') is null or coalesce(p_price_per_night,0)<=0 then
    raise exception 'Package name and nightly price are required';
  end if;
  if p_meal_plan not in ('room_only','breakfast','half_board','full_board','all_inclusive') then
    raise exception 'Choose a valid meal plan';
  end if;
  if p_payment_timing<>'pay_now' then
    raise exception 'Current hotel packages require WeHouse secure payment';
  end if;
  if coalesce(p_refundable,false) and coalesce(p_cancellation_hours,0)<1 then
    raise exception 'Refundable packages need a positive cancellation window';
  end if;
  if p_rate_plan_id is not null and not coalesce(p_active,true) and not exists(
    select 1 from public.hotel_rate_plans plan
    where plan.room_id=v_room.room_id and plan.active
      and plan.rate_plan_id<>p_rate_plan_id
  ) then raise exception 'A room must keep at least one visible package'; end if;
  if p_rate_plan_id is null then
    insert into public.hotel_rate_plans(
      hotel_id,room_id,name,description,meal_plan,payment_timing,refundable,
      cancellation_hours,price_per_night,included_features,active
    ) values(
      v_room.hotel_id,v_room.room_id,btrim(p_name),
      nullif(btrim(coalesce(p_description,'')),''),p_meal_plan,'pay_now',
      coalesce(p_refundable,false),case when coalesce(p_refundable,false)
        then p_cancellation_hours else null end,p_price_per_night,
      coalesce(p_included_features,array[]::text[]),coalesce(p_active,true)
    ) returning * into v_plan;
  else
    select to_jsonb(plan) into v_before from public.hotel_rate_plans plan
    where plan.rate_plan_id=p_rate_plan_id and plan.room_id=v_room.room_id;
    update public.hotel_rate_plans set
      name=btrim(p_name),description=nullif(btrim(coalesce(p_description,'')),''),
      meal_plan=p_meal_plan,payment_timing='pay_now',refundable=coalesce(p_refundable,false),
      cancellation_hours=case when coalesce(p_refundable,false)
        then p_cancellation_hours else null end,
      price_per_night=p_price_per_night,
      included_features=coalesce(p_included_features,array[]::text[]),
      active=coalesce(p_active,true),updated_at=now()
    where rate_plan_id=p_rate_plan_id and room_id=v_room.room_id
    returning * into v_plan;
    if v_plan.rate_plan_id is null then raise exception 'Package not found for this room'; end if;
  end if;
  insert into public.hotel_commercial_change_audit(
    hotel_id,actor_user_id,action,target_type,target_id,before_values,after_values
  ) values(
    v_room.hotel_id,v_actor,
    case when p_rate_plan_id is null then 'future_rate_plan_created' else 'future_rate_plan_updated' end,
    'hotel_rate_plan',v_plan.rate_plan_id::text,coalesce(v_before,'{}'::jsonb),to_jsonb(v_plan)
  );
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
)
returns public.hotel_venues
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_venue public.hotel_venues;
  v_before public.hotel_venues;
  v_status text;
  v_actor text:=public.current_profile_user_id();
begin
  if not public.hotel_actor_has_capability(p_hotel_id,'hotel.policy.manage') then
    raise exception 'Hotel policy capability required';
  end if;
  if nullif(btrim(p_name),'') is null
     or p_kind not in ('restaurant','bar','cafe','spa','lounge','pool','gym','other') then
    raise exception 'Facility name and type are required';
  end if;
  select status into v_status from public.hotels where hotel_id=p_hotel_id;
  if v_status is null then raise exception 'Hotel not found'; end if;
  if p_venue_id is null then
    if v_status<>'draft' then
      raise exception 'A live hotel needs WeHouse review before a facility is added';
    end if;
    insert into public.hotel_venues(
      hotel_id,name,kind,description,opening_hours,package_notes,active
    ) values(
      p_hotel_id,btrim(p_name),p_kind,nullif(btrim(coalesce(p_description,'')),''),
      nullif(btrim(coalesce(p_opening_hours,'')),''),
      nullif(btrim(coalesce(p_package_notes,'')),''),coalesce(p_active,true)
    ) returning * into v_venue;
  else
    select * into v_before from public.hotel_venues
    where venue_id=p_venue_id and hotel_id=p_hotel_id for update;
    if v_before.venue_id is null then raise exception 'Hotel facility not found'; end if;
    if v_status='active' and (
      btrim(p_name) is distinct from v_before.name
      or p_kind is distinct from v_before.kind
      or nullif(btrim(coalesce(p_description,'')),'') is distinct from v_before.description
      or coalesce(p_active,true) is distinct from v_before.active
    ) then raise exception 'Verified facility facts need WeHouse review before publication'; end if;
    update public.hotel_venues set
      name=case when v_status='draft' then btrim(p_name) else name end,
      kind=case when v_status='draft' then p_kind else kind end,
      description=case when v_status='draft'
        then nullif(btrim(coalesce(p_description,'')),'') else description end,
      opening_hours=nullif(btrim(coalesce(p_opening_hours,'')),''),
      package_notes=nullif(btrim(coalesce(p_package_notes,'')),''),
      active=case when v_status='draft' then coalesce(p_active,true) else active end,
      updated_at=now()
    where venue_id=p_venue_id and hotel_id=p_hotel_id
    returning * into v_venue;
  end if;
  insert into public.hotel_commercial_change_audit(
    hotel_id,actor_user_id,action,target_type,target_id,before_values,after_values
  ) values(
    p_hotel_id,v_actor,
    case when p_venue_id is null then 'draft_facility_created' else 'facility_operations_updated' end,
    'hotel_venue',v_venue.venue_id::text,
    case when p_venue_id is null then '{}'::jsonb else to_jsonb(v_before) end,
    to_jsonb(v_venue)
  );
  return v_venue;
end;
$$;

create or replace function public.partner_set_hotel_inventory_range(
  p_room_id integer,
  p_start_date date,
  p_end_date date,
  p_available_quantity integer,
  p_closed boolean default false,
  p_rate_override integer default null,
  p_note text default null
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_room public.hotel_rooms;
  v_count integer;
  v_actor text:=public.current_profile_user_id();
begin
  select * into v_room from public.hotel_rooms where room_id=p_room_id;
  if v_room.room_id is null then raise exception 'Room type not found'; end if;
  if not public.hotel_actor_has_capability(v_room.hotel_id,'hotel.inventory.manage') then
    raise exception 'Hotel inventory capability required';
  end if;
  if p_start_date<current_date or p_end_date<p_start_date
     or p_end_date>p_start_date+366 then
    raise exception 'Choose a valid date range up to one year';
  end if;
  if p_available_quantity<0 or p_available_quantity>v_room.total_rooms then
    raise exception 'Availability must stay within verified room capacity';
  end if;
  if p_rate_override is not null and p_rate_override<=0 then
    raise exception 'Rate override must be positive';
  end if;
  insert into public.hotel_inventory_daily(
    hotel_id,room_id,inventory_date,available_quantity,rate_override,
    closed,note,updated_by,updated_at
  )
  select v_room.hotel_id,v_room.room_id,day_value::date,p_available_quantity,
    p_rate_override,coalesce(p_closed,false),nullif(btrim(coalesce(p_note,'')),''),
    v_actor,now()
  from generate_series(p_start_date,p_end_date,interval '1 day') day_value
  on conflict(room_id,inventory_date) do update set
    available_quantity=excluded.available_quantity,
    rate_override=excluded.rate_override,closed=excluded.closed,
    note=excluded.note,updated_by=excluded.updated_by,updated_at=now();
  get diagnostics v_count=row_count;
  insert into public.hotel_commercial_change_audit(
    hotel_id,actor_user_id,action,target_type,target_id,after_values
  ) values(
    v_room.hotel_id,v_actor,'dated_inventory_updated','hotel_room',v_room.room_id::text,
    jsonb_build_object('start_date',p_start_date,'end_date',p_end_date,
      'available_quantity',p_available_quantity,'closed',coalesce(p_closed,false),
      'rate_override',p_rate_override)
  );
  return v_count;
end;
$$;

create or replace function public.partner_update_hotel_stay_policy(
  p_hotel_id integer,
  p_check_in_time time,
  p_check_out_time time
)
returns public.hotels
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_result public.hotels;
  v_before public.hotels;
  v_actor text:=public.current_profile_user_id();
begin
  if not public.hotel_actor_has_capability(p_hotel_id,'hotel.policy.manage') then
    raise exception 'Hotel policy capability required';
  end if;
  if p_check_in_time is null or p_check_out_time is null then
    raise exception 'Check-in and checkout times are required';
  end if;
  select * into v_before from public.hotels where hotel_id=p_hotel_id for update;
  if v_before.hotel_id is null then raise exception 'Hotel not found'; end if;
  update public.hotels set
    check_in_time=p_check_in_time,check_out_time=p_check_out_time,updated_at=now()
  where hotel_id=p_hotel_id returning * into v_result;
  insert into public.hotel_commercial_change_audit(
    hotel_id,actor_user_id,action,target_type,target_id,before_values,after_values
  ) values(
    p_hotel_id,v_actor,'stay_policy_updated','hotel',p_hotel_id::text,
    jsonb_build_object('check_in_time',v_before.check_in_time,
      'check_out_time',v_before.check_out_time),
    jsonb_build_object('check_in_time',v_result.check_in_time,
      'check_out_time',v_result.check_out_time)
  );
  return v_result;
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
set search_path to 'pg_catalog','public'
as $$
declare
  v_unit public.hotel_room_units;
  v_hotel_status text;
  v_actor text:=public.current_profile_user_id();
begin
  select * into v_unit from public.hotel_room_units where unit_id=p_unit_id for update;
  if v_unit.unit_id is null then raise exception 'Hotel room not found'; end if;
  if not public.hotel_actor_has_capability(v_unit.hotel_id,'room.mark_ready') then
    raise exception 'Room readiness capability required';
  end if;
  if nullif(btrim(coalesce(p_unit_label,'')),'') is null then
    raise exception 'Room number or label is required';
  end if;
  if p_status not in ('ready','cleaning','maintenance','out_of_service') then
    raise exception 'Choose ready, cleaning, maintenance or out of service';
  end if;
  if v_unit.current_booking_id is not null then
    raise exception 'An occupied room cannot be changed until checkout';
  end if;
  select status into v_hotel_status from public.hotels where hotel_id=v_unit.hotel_id;
  if v_hotel_status='active' and (
    btrim(p_unit_label) is distinct from v_unit.unit_label
    or nullif(btrim(coalesce(p_floor_label,'')),'') is distinct from v_unit.floor_label
  ) then raise exception 'Verified room identity needs WeHouse review before it changes'; end if;
  update public.hotel_room_units set
    unit_label=case when v_hotel_status='draft' then btrim(p_unit_label) else unit_label end,
    floor_label=case when v_hotel_status='draft'
      then nullif(btrim(coalesce(p_floor_label,'')),'') else floor_label end,
    status=p_status,updated_at=now()
  where unit_id=p_unit_id returning * into v_unit;
  insert into public.hotel_commercial_change_audit(
    hotel_id,actor_user_id,action,target_type,target_id,after_values
  ) values(
    v_unit.hotel_id,v_actor,'room_readiness_updated','hotel_room_unit',v_unit.unit_id::text,
    jsonb_build_object('status',v_unit.status)
  );
  return v_unit;
end;
$$;

alter table public.hotel_bookings
  add column if not exists canonical_state text,
  add column if not exists payment_protection_id uuid;

do $$
begin
  if not exists(
    select 1 from pg_constraint
    where conrelid='public.hotel_bookings'::regclass
      and conname='hotel_bookings_payment_protection_id_fkey'
  ) then
    alter table public.hotel_bookings
      add constraint hotel_bookings_payment_protection_id_fkey
      foreign key(payment_protection_id)
      references public.payment_protection_transactions(id) on delete set null;
  end if;
end;
$$;

update public.hotel_bookings
set canonical_state=status
where canonical_state is null;

create table if not exists public.hotel_stay_transitions (
  transition_id uuid primary key default gen_random_uuid(),
  hotel_booking_id integer not null references public.hotel_bookings(booking_id) on delete restrict,
  from_state text,
  to_state text not null,
  event_type text not null,
  event_key text not null unique,
  actor_user_id text references public.profiles(user_id) on delete set null,
  actor_type text not null,
  policy_version_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists hotel_stay_transitions_booking_time_idx
  on public.hotel_stay_transitions(hotel_booking_id,created_at);
alter table public.hotel_stay_transitions enable row level security;
revoke all on table public.hotel_stay_transitions from public,anon,authenticated;
grant select,insert on table public.hotel_stay_transitions to service_role;

create or replace function public.hotel_payment_protection_is_current(p_protection_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_result boolean:=false;
begin
  if p_protection_id is null then return false; end if;
  if exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='payment_protection_transactions'
      and column_name='protection_state'
  ) then
    execute 'select exists(select 1 from public.payment_protection_transactions
      where id=$1 and protection_state in (''protected'',''release_eligible''))'
      into v_result using p_protection_id;
  else
    execute 'select exists(select 1 from public.payment_protection_transactions
      where id=$1 and status=''protected'')'
      into v_result using p_protection_id;
  end if;
  return coalesce(v_result,false);
end;
$$;

create or replace function public.partner_transition_hotel_booking(
  p_booking_id integer,
  p_status text
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
  v_from_state text;
  v_actor text:=public.current_profile_user_id();
begin
  select * into v_booking from public.hotel_bookings
  where booking_id=p_booking_id for update;
  if v_booking.booking_id is null then raise exception 'Hotel booking not found'; end if;
  select * into v_hotel from public.hotels where hotel_id=v_booking.hotel_id;
  v_local_now:=timezone(v_hotel.timezone,now());
  v_arrival:=v_booking.check_in::timestamp+v_hotel.check_in_time;
  v_departure:=v_booking.check_out::timestamp+v_hotel.check_out_time;
  v_from_state:=coalesce(v_booking.canonical_state,v_booking.status);
  if p_status='checked_in' then
    if not public.hotel_actor_has_capability(v_booking.hotel_id,'stay.check_in')
       or not public.hotel_actor_has_capability(v_booking.hotel_id,'stay.assign_unit') then
      raise exception 'Hotel check-in and room-assignment capabilities required';
    end if;
    if v_from_state not in ('confirmed','check_in_ready')
       or v_booking.payment_status<>'paid'
       or v_local_now<v_arrival or v_local_now>=v_departure then
      raise exception 'This protected stay is not ready for check-in';
    end if;
    if not public.hotel_payment_protection_is_current(v_booking.payment_protection_id) then
      raise exception 'Verified Hotel Payment Protection is required';
    end if;
    select * into v_unit from public.hotel_room_units
    where hotel_id=v_booking.hotel_id and room_id=v_booking.room_id
      and status='ready' and current_booking_id is null
    order by unit_label for update skip locked limit 1;
    if v_unit.unit_id is null then raise exception 'No ready room is available'; end if;
    update public.hotel_room_units
    set status='occupied',current_booking_id=v_booking.booking_id,updated_at=now()
    where unit_id=v_unit.unit_id;
    update public.hotel_bookings
    set status='checked_in',canonical_state='checked_in',
      assigned_room_unit_id=v_unit.unit_id,checked_in_at=now(),updated_at=now()
    where booking_id=v_booking.booking_id returning * into v_booking;
    insert into public.hotel_stay_transitions(
      hotel_booking_id,from_state,to_state,event_type,event_key,
      actor_user_id,actor_type,metadata
    ) values(
      v_booking.booking_id,v_from_state,'checked_in','hotel_checked_in',
      'hotel_checked_in:'||v_booking.booking_id,v_actor,'hotel_team',
      jsonb_build_object('assigned_room_unit_id',v_unit.unit_id,'timezone',v_hotel.timezone)
    ) on conflict(event_key) do nothing;
  elsif p_status='checked_out' then
    if not public.hotel_actor_has_capability(v_booking.hotel_id,'stay.check_out') then
      raise exception 'Hotel checkout capability required';
    end if;
    if v_from_state<>'checked_in' or v_booking.payment_status<>'paid' then
      raise exception 'Only a paid checked-in stay can check out';
    end if;
    update public.hotel_room_units
    set status='cleaning',current_booking_id=null,updated_at=now()
    where unit_id=v_booking.assigned_room_unit_id
      and hotel_id=v_booking.hotel_id;
    update public.hotel_bookings
    set status='checked_out',canonical_state='checked_out',
      checked_out_at=now(),updated_at=now()
    where booking_id=v_booking.booking_id returning * into v_booking;
    insert into public.hotel_stay_transitions(
      hotel_booking_id,from_state,to_state,event_type,event_key,
      actor_user_id,actor_type,metadata
    ) values(
      v_booking.booking_id,'checked_in','checked_out','hotel_checked_out',
      'hotel_checked_out:'||v_booking.booking_id,v_actor,'hotel_team',
      jsonb_build_object('released_room_unit_id',v_booking.assigned_room_unit_id,
        'timezone',v_hotel.timezone)
    ) on conflict(event_key) do nothing;
  else
    raise exception 'Unsupported hotel booking transition';
  end if;
  return v_booking;
end;
$$;

create or replace function public.can_access_hotel_booking_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  with actor as (select public.current_profile_user_id() as user_id)
  select exists(
    select 1 from public.hotel_booking_conversations conversation
    cross join actor
    where conversation.id=p_conversation_id
      and actor.user_id is not null
      and (conversation.guest_user_id=actor.user_id
        or public.hotel_actor_has_capability(conversation.hotel_id,'stay.message'))
  )
$$;

create or replace function public.open_my_hotel_booking_conversation(p_booking_id integer)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_booking public.hotel_bookings;
  v_conversation_id uuid;
begin
  if v_actor is null then raise exception 'Active Personal account required'; end if;
  select * into v_booking from public.hotel_bookings
  where booking_id=p_booking_id for share;
  if v_booking.booking_id is null then raise exception 'Hotel booking not found'; end if;
  if v_booking.user_id<>v_actor
     and not public.hotel_actor_has_capability(v_booking.hotel_id,'stay.message') then
    raise exception 'Hotel booking conversation access denied';
  end if;
  if v_booking.payment_status<>'paid'
     or v_booking.status not in ('confirmed','checked_in') then
    raise exception 'Hotel chat is available from confirmation until checkout';
  end if;
  insert into public.hotel_booking_conversations(booking_id,hotel_id,guest_user_id)
  values(v_booking.booking_id,v_booking.hotel_id,v_booking.user_id)
  on conflict(booking_id) do update
  set updated_at=public.hotel_booking_conversations.updated_at
  returning id into v_conversation_id;
  return v_conversation_id;
end;
$$;

drop policy if exists hotel_bookings_front_desk_select on public.hotel_bookings;
drop policy if exists hotel_bookings_team_select on public.hotel_bookings;
drop policy if exists hotel_bookings_customer_insert_v2 on public.hotel_bookings;
drop policy if exists hotel_bookings_customer_update_v2 on public.hotel_bookings;

drop policy if exists hotel_room_units_operator_read on public.hotel_room_units;
create policy hotel_room_units_operator_read on public.hotel_room_units
for select to authenticated
using (
  public.hotel_actor_has_capability(hotel_id,'stay.read')
  or public.hotel_actor_has_capability(hotel_id,'room.mark_ready')
);

drop policy if exists hotel_inventory_team_read on public.hotel_inventory_daily;
create policy hotel_inventory_team_read on public.hotel_inventory_daily
for select to authenticated
using (
  public.hotel_actor_has_capability(hotel_id,'stay.read')
  or public.hotel_actor_has_capability(hotel_id,'hotel.inventory.manage')
);

drop policy if exists hotel_rate_plans_read on public.hotel_rate_plans;
create policy hotel_rate_plans_read on public.hotel_rate_plans
for select to authenticated
using (
  (active and exists(select 1 from public.hotels hotel
    where hotel.hotel_id=hotel_rate_plans.hotel_id and hotel.status='active'))
  or public.hotel_actor_has_any_capability(hotel_id)
  or public.current_profile_role()='creator'
  or exists(select 1 from public.hotels hotel
    where hotel.hotel_id=hotel_rate_plans.hotel_id
      and (public.current_profile_role()='admin'
        or (public.current_profile_role()='staff'
          and public.current_staff_has_permission('operations')))
      and public.current_actor_in_scope(hotel.state,hotel.city))
);

drop policy if exists hotel_venues_read on public.hotel_venues;
create policy hotel_venues_read on public.hotel_venues
for select to authenticated
using (
  (active and exists(select 1 from public.hotels hotel
    where hotel.hotel_id=hotel_venues.hotel_id and hotel.status='active'))
  or public.hotel_actor_has_any_capability(hotel_id)
  or public.current_profile_role()='creator'
  or exists(select 1 from public.hotels hotel
    where hotel.hotel_id=hotel_venues.hotel_id
      and (public.current_profile_role()='admin'
        or (public.current_profile_role()='staff'
          and public.current_staff_has_permission('operations')))
      and public.current_actor_in_scope(hotel.state,hotel.city))
);

-- The browser reads hotel records but all writes go through the narrow commands above.
revoke insert,update,delete,truncate,references,trigger on table public.hotels from anon,authenticated;
revoke insert,update,delete,truncate,references,trigger on table public.hotel_rooms from anon,authenticated;
revoke insert,update,delete,truncate,references,trigger on table public.hotel_bookings from anon,authenticated;
revoke insert,update,delete,truncate,references,trigger on table public.hotel_rate_plans from anon,authenticated;
revoke insert,update,delete,truncate,references,trigger on table public.hotel_venues from anon,authenticated;
revoke insert,update,delete,truncate,references,trigger on table public.hotel_inventory_daily from anon,authenticated;
revoke insert,update,delete,truncate,references,trigger on table public.hotel_room_units from anon,authenticated;
revoke insert,update,delete,truncate,references,trigger on table public.hotel_team_members from anon,authenticated;

revoke all on function public.validate_hotel_timezone() from public,anon,authenticated;
revoke all on function public.set_hotel_team_default_capabilities() from public,anon,authenticated;
revoke all on function public.hotel_allowed_capabilities() from public,anon;
revoke all on function public.hotel_default_capabilities(text) from public,anon;
revoke all on function public.hotel_capabilities_valid(text[]) from public,anon;
revoke all on function public.current_actor_hotel_capabilities(integer) from public,anon;
revoke all on function public.hotel_actor_has_capability(integer,text) from public,anon;
revoke all on function public.hotel_actor_has_any_capability(integer) from public,anon;
revoke all on function public.get_my_hotel_capabilities(integer) from public,anon;
revoke all on function public.current_actor_can_read_hotel_record(integer,text,text,text) from public,anon;
revoke all on function public.current_actor_can_read_hotel_booking_record(integer,text) from public,anon;
revoke all on function public.get_my_hotel_operations() from public,anon;
revoke all on function public.owner_set_hotel_team_capabilities(uuid,text[]) from public,anon;
revoke all on function public.get_my_hotel_team(integer) from public,anon;
revoke all on function public.owner_invite_hotel_team_member(integer,text,text) from public,anon;
revoke all on function public.owner_revoke_hotel_team_member(uuid) from public,anon;
revoke all on function public.respond_to_hotel_team_invitation(uuid,boolean) from public,anon;
revoke all on function public.partner_create_hotel_room(integer,text,text,integer,integer,text,integer,text[],text[]) from public,anon;
revoke all on function public.partner_update_hotel_room(integer,text,text,integer,integer,text,integer,text[],text[]) from public,anon;
revoke all on function public.partner_save_hotel_rate_plan(integer,integer,text,text,text,text,boolean,integer,integer,text[],boolean) from public,anon;
revoke all on function public.partner_save_hotel_venue(integer,integer,text,text,text,text,text,boolean) from public,anon;
revoke all on function public.partner_set_hotel_inventory_range(integer,date,date,integer,boolean,integer,text) from public,anon;
revoke all on function public.partner_update_hotel_stay_policy(integer,time,time) from public,anon;
revoke all on function public.partner_update_hotel_room_unit(bigint,text,text,text) from public,anon;
revoke all on function public.hotel_payment_protection_is_current(uuid) from public,anon;
revoke all on function public.partner_transition_hotel_booking(integer,text) from public,anon;
revoke all on function public.can_access_hotel_booking_conversation(uuid) from public,anon;
revoke all on function public.open_my_hotel_booking_conversation(integer) from public,anon;

grant execute on function public.hotel_allowed_capabilities() to authenticated,service_role;
grant execute on function public.hotel_default_capabilities(text) to authenticated,service_role;
grant execute on function public.hotel_capabilities_valid(text[]) to authenticated,service_role;
grant execute on function public.current_actor_hotel_capabilities(integer) to authenticated,service_role;
grant execute on function public.hotel_actor_has_capability(integer,text) to authenticated,service_role;
grant execute on function public.hotel_actor_has_any_capability(integer) to authenticated,service_role;
grant execute on function public.get_my_hotel_capabilities(integer) to authenticated,service_role;
grant execute on function public.current_actor_can_read_hotel_record(integer,text,text,text) to authenticated,service_role;
grant execute on function public.current_actor_can_read_hotel_booking_record(integer,text) to authenticated,service_role;
grant execute on function public.get_my_hotel_operations() to authenticated,service_role;
grant execute on function public.owner_set_hotel_team_capabilities(uuid,text[]) to authenticated,service_role;
grant execute on function public.get_my_hotel_team(integer) to authenticated,service_role;
grant execute on function public.owner_invite_hotel_team_member(integer,text,text) to authenticated,service_role;
grant execute on function public.owner_revoke_hotel_team_member(uuid) to authenticated,service_role;
grant execute on function public.respond_to_hotel_team_invitation(uuid,boolean) to authenticated,service_role;
grant execute on function public.partner_create_hotel_room(integer,text,text,integer,integer,text,integer,text[],text[]) to authenticated,service_role;
grant execute on function public.partner_update_hotel_room(integer,text,text,integer,integer,text,integer,text[],text[]) to authenticated,service_role;
grant execute on function public.partner_save_hotel_rate_plan(integer,integer,text,text,text,text,boolean,integer,integer,text[],boolean) to authenticated,service_role;
grant execute on function public.partner_save_hotel_venue(integer,integer,text,text,text,text,text,boolean) to authenticated,service_role;
grant execute on function public.partner_set_hotel_inventory_range(integer,date,date,integer,boolean,integer,text) to authenticated,service_role;
grant execute on function public.partner_update_hotel_stay_policy(integer,time,time) to authenticated,service_role;
grant execute on function public.partner_update_hotel_room_unit(bigint,text,text,text) to authenticated,service_role;
grant execute on function public.hotel_payment_protection_is_current(uuid) to authenticated,service_role;
grant execute on function public.partner_transition_hotel_booking(integer,text) to authenticated,service_role;
grant execute on function public.can_access_hotel_booking_conversation(uuid) to authenticated,service_role;
grant execute on function public.open_my_hotel_booking_conversation(integer) to authenticated,service_role;

comment on column public.hotels.timezone is
  'IANA timezone used for this hotel arrival/departure policy; Africa/Lagos is the Nigerian default.';
comment on table public.hotel_commercial_change_audit is
  'Immutable audit of authorized future-facing hotel commercial and operational changes.';
comment on table public.hotel_stay_transitions is
  'Append-only hotel stay lifecycle evidence. Money release is deliberately handled by the canonical ledger, not this table.';
