create table if not exists public.hotel_team_members(
  id uuid primary key default gen_random_uuid(),
  hotel_id integer not null references public.hotels(hotel_id) on delete cascade,
  member_user_id text not null references public.profiles(user_id) on delete cascade,
  hotel_role text not null check(hotel_role in('manager','staff')),
  status text not null default 'active' check(status in('active','revoked')),
  invited_by text not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique(hotel_id,member_user_id)
);
create index if not exists hotel_team_member_active_idx on public.hotel_team_members(member_user_id,hotel_id) where status='active';
alter table public.hotel_team_members enable row level security;
revoke all on public.hotel_team_members from public,anon,authenticated;
grant select on public.hotel_team_members to authenticated;

drop policy if exists hotel_team_member_read on public.hotel_team_members;
create policy hotel_team_member_read on public.hotel_team_members for select to authenticated using(
  member_user_id=public.current_profile_user_id() or exists(select 1 from public.hotels h where h.hotel_id=hotel_team_members.hotel_id and h.owner_id=public.current_profile_user_id())
);

create or replace function public.current_actor_hotel_role(p_hotel_id integer)
returns text language sql stable security definer set search_path='pg_catalog','public' as $$
  select case when h.owner_id=p.user_id then 'owner' else tm.hotel_role end
  from public.profiles p join public.hotels h on h.hotel_id=p_hotel_id
  left join public.hotel_team_members tm on tm.hotel_id=h.hotel_id and tm.member_user_id=p.user_id and tm.status='active'
  where p.auth_id=auth.uid()::text and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)
    and (h.owner_id=p.user_id or tm.id is not null) limit 1
$$;
revoke all on function public.current_actor_hotel_role(integer) from public,anon;
grant execute on function public.current_actor_hotel_role(integer) to authenticated;

create or replace function public.get_my_hotel_operations()
returns jsonb language sql stable security definer set search_path='pg_catalog','public' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'hotel_id',h.hotel_id,'name',h.name,'description',h.description,'state',h.state,'city',h.city,'area',h.area,'address',h.address,
    'images',h.images,'amenities',h.amenities,'owner_id',h.owner_id,'status',h.status,'rating',h.rating,'review_count',h.review_count,
    'featured',h.featured,'created_at',h.created_at,'updated_at',h.updated_at,'access_role',case when h.owner_id=p.user_id then 'owner' else tm.hotel_role end
  ) order by h.updated_at desc),'[]'::jsonb)
  from public.profiles p join public.hotels h on h.owner_id=p.user_id
    or exists(select 1 from public.hotel_team_members x where x.hotel_id=h.hotel_id and x.member_user_id=p.user_id and x.status='active')
  left join public.hotel_team_members tm on tm.hotel_id=h.hotel_id and tm.member_user_id=p.user_id and tm.status='active'
  where p.auth_id=auth.uid()::text and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)
$$;
revoke all on function public.get_my_hotel_operations() from public,anon;
grant execute on function public.get_my_hotel_operations() to authenticated;

create or replace function public.get_my_hotel_team(p_hotel_id integer)
returns jsonb language plpgsql stable security definer set search_path='pg_catalog','public' as $$
declare v_user text; v_result jsonb;
begin
  select user_id into v_user from public.profiles where auth_id=auth.uid()::text and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false);
  if not exists(select 1 from public.hotels where hotel_id=p_hotel_id and owner_id=v_user) then raise exception 'Hotel owner access required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',tm.id,'member_user_id',tm.member_user_id,'hotel_role',tm.hotel_role,'status',tm.status,'name',coalesce(p.full_name,p.username,'Team member'),'email',p.email) order by tm.created_at),'[]'::jsonb)
    into v_result from public.hotel_team_members tm join public.profiles p on p.user_id=tm.member_user_id where tm.hotel_id=p_hotel_id and tm.status='active';
  return v_result;
end $$;
revoke all on function public.get_my_hotel_team(integer) from public,anon;
grant execute on function public.get_my_hotel_team(integer) to authenticated;

create or replace function public.owner_set_hotel_team_member(p_hotel_id integer,p_email text,p_role text,p_enabled boolean default true)
returns boolean language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_owner public.profiles; v_member public.profiles;
begin
  select * into v_owner from public.profiles where auth_id=auth.uid()::text and role='property_partner' and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false);
  if v_owner is null or not exists(select 1 from public.hotels where hotel_id=p_hotel_id and owner_id=v_owner.user_id) then raise exception 'Hotel owner access required'; end if;
  if p_role not in('manager','staff') then raise exception 'Choose Manager or Hotel Staff'; end if;
  select * into v_member from public.profiles where lower(email)=lower(btrim(p_email)) and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_member is null then raise exception 'No active WeHouse account uses that email'; end if;
  if v_member.user_id=v_owner.user_id then raise exception 'The hotel owner already has full access'; end if;
  insert into public.hotel_team_members(hotel_id,member_user_id,hotel_role,status,invited_by,updated_at,revoked_at)
  values(p_hotel_id,v_member.user_id,p_role,case when p_enabled then 'active' else 'revoked' end,v_owner.user_id,now(),case when p_enabled then null else now() end)
  on conflict(hotel_id,member_user_id) do update set hotel_role=excluded.hotel_role,status=excluded.status,invited_by=excluded.invited_by,updated_at=now(),revoked_at=excluded.revoked_at;
  return true;
end $$;
revoke all on function public.owner_set_hotel_team_member(integer,text,text,boolean) from public,anon;
grant execute on function public.owner_set_hotel_team_member(integer,text,text,boolean) to authenticated;

drop policy if exists hotel_bookings_team_select on public.hotel_bookings;
create policy hotel_bookings_team_select on public.hotel_bookings for select to authenticated using(public.current_actor_hotel_role(hotel_id) in('manager','staff'));
drop policy if exists hotel_inventory_team_read on public.hotel_inventory_daily;
create policy hotel_inventory_team_read on public.hotel_inventory_daily for select to authenticated using(public.current_actor_hotel_role(hotel_id) in('manager','staff'));

create or replace function public.partner_update_hotel_room(p_room_id integer,p_room_type text,p_description text,p_price_per_night integer,p_max_guests integer,p_bed_type text,p_total_rooms integer,p_amenities text[] default null,p_images text[] default null)
returns public.hotel_rooms language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_room public.hotel_rooms; v_role text;
begin
  select * into v_room from public.hotel_rooms where room_id=p_room_id for update;
  if v_room is null then raise exception 'Room type not found'; end if;
  v_role:=public.current_actor_hotel_role(v_room.hotel_id);
  if v_role not in('owner','manager') then raise exception 'Hotel owner or Manager access required'; end if;
  if nullif(btrim(p_room_type),'') is null or coalesce(p_price_per_night,0)<=0 or coalesce(p_max_guests,0)<1 or coalesce(p_total_rooms,0)<0 then raise exception 'Valid room name, rate, capacity and quantity are required'; end if;
  update public.hotel_rooms set room_type=btrim(p_room_type),description=nullif(btrim(coalesce(p_description,'')),''),price_per_night=p_price_per_night,max_guests=p_max_guests,bed_type=nullif(btrim(coalesce(p_bed_type,'')),''),total_rooms=p_total_rooms,amenities=coalesce(p_amenities,amenities),images=coalesce(p_images,images),updated_at=now() where room_id=p_room_id returning * into v_room;
  return v_room;
end $$;

create or replace function public.partner_set_hotel_inventory_range(p_room_id integer,p_start_date date,p_end_date date,p_available_quantity integer,p_closed boolean default false,p_rate_override integer default null,p_note text default null)
returns integer language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_room public.hotel_rooms; v_count integer; v_role text; v_user text;
begin
  select * into v_room from public.hotel_rooms where room_id=p_room_id;
  if v_room is null then raise exception 'Room type not found'; end if;
  v_role:=public.current_actor_hotel_role(v_room.hotel_id);
  if v_role not in('owner','manager') then raise exception 'Hotel owner or Manager access required'; end if;
  select user_id into v_user from public.profiles where auth_id=auth.uid()::text;
  if p_start_date<current_date or p_end_date<p_start_date or p_end_date>p_start_date+366 then raise exception 'Choose a valid date range up to one year'; end if;
  if p_available_quantity<0 or p_available_quantity>v_room.total_rooms then raise exception 'Availability must be within this room type quantity'; end if;
  if p_rate_override is not null and p_rate_override<=0 then raise exception 'Rate override must be positive'; end if;
  insert into public.hotel_inventory_daily(hotel_id,room_id,inventory_date,available_quantity,rate_override,closed,note,updated_by,updated_at)
  select v_room.hotel_id,v_room.room_id,d,p_available_quantity,p_rate_override,coalesce(p_closed,false),nullif(btrim(coalesce(p_note,'')),''),v_user,now() from generate_series(p_start_date,p_end_date,interval '1 day') d
  on conflict(room_id,inventory_date) do update set available_quantity=excluded.available_quantity,rate_override=excluded.rate_override,closed=excluded.closed,note=excluded.note,updated_by=excluded.updated_by,updated_at=now();
  get diagnostics v_count=row_count; return v_count;
end $$;

create or replace function public.partner_transition_hotel_booking(p_booking_id integer,p_status text)
returns public.hotel_bookings language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_booking public.hotel_bookings; v_role text;
begin
  select * into v_booking from public.hotel_bookings where booking_id=p_booking_id for update;
  if v_booking is null then raise exception 'Hotel reservation not found'; end if;
  v_role:=public.current_actor_hotel_role(v_booking.hotel_id);
  if v_role not in('owner','manager','staff') then raise exception 'Hotel operations access required'; end if;
  if p_status='checked_in' and not(v_booking.status='confirmed' and v_booking.payment_status='paid' and v_booking.check_in<=current_date) then raise exception 'Only a paid confirmed arrival can be checked in';
  elsif p_status='checked_out' and not(v_booking.status='checked_in' and v_booking.check_out<=current_date) then raise exception 'Only a current stay reaching departure can be checked out';
  elsif p_status not in('checked_in','checked_out') then raise exception 'Unsupported hotel reservation transition'; end if;
  update public.hotel_bookings set status=p_status,updated_at=now() where booking_id=p_booking_id returning * into v_booking; return v_booking;
end $$;

create or replace function public.get_my_workspace_access()
returns jsonb language sql stable security definer set search_path='pg_catalog','public' as $$
  select jsonb_build_object(
    'identity',jsonb_build_object('user_id',p.user_id,'account_kind',p.account_kind),
    'personal_workspace',p.account_kind='consumer',
    'privileged_workspaces',coalesce((select jsonb_agg(x order by x->>'role') from (
      select jsonb_build_object('role',a.workspace_role,'scope_type',a.scope_type,'state',a.scope_state,'lga',a.scope_lga) x from public.workspace_role_assignments a where a.user_id=p.user_id and a.status='active'
      union all select jsonb_build_object('role','hotel','scope_type','hotel','state',null,'lga',null) where exists(select 1 from public.hotel_team_members tm where tm.member_user_id=p.user_id and tm.status='active')
    ) roles),'[]'::jsonb)
  ) from public.profiles p where p.auth_id=auth.uid()::text
$$;

revoke all on function public.partner_update_hotel_room(integer,text,text,integer,integer,text,integer,text[],text[]) from public,anon;
revoke all on function public.partner_set_hotel_inventory_range(integer,date,date,integer,boolean,integer,text) from public,anon;
revoke all on function public.partner_transition_hotel_booking(integer,text) from public,anon;
grant execute on function public.partner_update_hotel_room(integer,text,text,integer,integer,text,integer,text[],text[]) to authenticated;
grant execute on function public.partner_set_hotel_inventory_range(integer,date,date,integer,boolean,integer,text) to authenticated;
grant execute on function public.partner_transition_hotel_booking(integer,text) to authenticated;
