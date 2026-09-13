-- Keep social work posts, housing handover and hotel inventory attached to
-- authoritative records instead of inventing separate UI-only state.

create table if not exists public.worker_showcase_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.worker_showcase_posts(id) on delete cascade,
  user_id text not null references public.profiles(user_id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists worker_showcase_comments_post_created_idx
  on public.worker_showcase_comments(post_id, created_at)
  where deleted_at is null;

alter table public.worker_showcase_comments enable row level security;
revoke all on table public.worker_showcase_comments from public, anon, authenticated;
grant all on table public.worker_showcase_comments to service_role;

create or replace function public.get_worker_showcase_post_comments(p_post_id uuid)
returns table(
  id uuid,
  user_id text,
  body text,
  created_at timestamptz,
  display_name text,
  avatar_url text
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor public.profiles;
begin
  select * into v_actor
  from public.profiles
  where auth_id=auth.uid()::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null then raise exception 'Sign in to view comments'; end if;

  if not exists (
    select 1 from public.worker_showcase_posts p
    where p.id=p_post_id
      and p.deleted_at is null
      and (
        p.worker_id=v_actor.user_id
        or (p.hidden_at is null and (p.expires_at is null or p.expires_at>now()))
      )
  ) then raise exception 'Work post is not available'; end if;

  return query
  select c.id,c.user_id,c.body,c.created_at,
    coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.username),''),'WeHouse member'),
    p.avatar_url
  from public.worker_showcase_comments c
  join public.profiles p on p.user_id=c.user_id
  where c.post_id=p_post_id and c.deleted_at is null
  order by c.created_at;
end;
$$;

create or replace function public.add_my_worker_showcase_comment(p_post_id uuid,p_body text)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor public.profiles;
  v_post public.worker_showcase_posts;
  v_id uuid;
  v_body text:=btrim(coalesce(p_body,''));
begin
  select * into v_actor
  from public.profiles
  where auth_id=auth.uid()::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null then raise exception 'Sign in to comment'; end if;
  if char_length(v_body) not between 1 and 500 then
    raise exception 'Comment must be between 1 and 500 characters';
  end if;

  select * into v_post
  from public.worker_showcase_posts
  where id=p_post_id and deleted_at is null
    and hidden_at is null and (expires_at is null or expires_at>now());
  if v_post.id is null then raise exception 'Work post is not available'; end if;

  insert into public.worker_showcase_comments(post_id,user_id,body)
  values (p_post_id,v_actor.user_id,v_body)
  returning id into v_id;

  if v_post.worker_id is distinct from v_actor.user_id then
    insert into public.notifications(
      recipient_id,type,title,message,read,related_id,source_type,source_id,
      destination_route,destination_params,event_key,workspace_scope
    ) values (
      v_post.worker_id,'work_post_comment','New showcase comment',
      coalesce(nullif(btrim(v_actor.full_name),''),nullif(btrim(v_actor.username),''),'A WeHouse member')||' commented on your work.',
      false,p_post_id::text,'worker_showcase_comment',v_id::text,'worker_showcase',
      jsonb_build_object('work_post_id',p_post_id,'comment_id',v_id),
      'showcase-comment:'||v_id::text,'worker'
    );
  end if;
  return v_id;
end;
$$;

revoke all on function public.get_worker_showcase_post_comments(uuid) from public;
revoke all on function public.add_my_worker_showcase_comment(uuid,text) from public;
grant execute on function public.get_worker_showcase_post_comments(uuid) to authenticated,service_role;
grant execute on function public.add_my_worker_showcase_comment(uuid,text) to authenticated,service_role;

alter table public.reservations
  add column if not exists handover_field_officer_id text,
  add column if not exists handover_conversation_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='reservations_handover_field_officer_fk') then
    alter table public.reservations add constraint reservations_handover_field_officer_fk
      foreign key (handover_field_officer_id) references public.profiles(user_id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname='reservations_handover_conversation_fk') then
    alter table public.reservations add constraint reservations_handover_conversation_fk
      foreign key (handover_conversation_id) references public.partner_support_conversations(id) on delete set null;
  end if;
end $$;

create or replace function public.get_reservation_handover_assignment(p_reservation_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor public.profiles;
  v_res public.reservations;
  v_listing public.listings;
  v_case public.partner_support_conversations;
  v_candidates jsonb;
begin
  select * into v_actor from public.profiles
  where auth_id=auth.uid()::text and role in ('staff','admin','creator')
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null then raise exception 'Property Operations access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then
    raise exception 'Property Operations permission required';
  end if;

  select * into v_res from public.reservations where id=p_reservation_id;
  if v_res.id is null then raise exception 'Reservation not found'; end if;
  select * into v_listing from public.listings where id::text=v_res.listing_id or listing_id=v_res.listing_id limit 1;
  if v_listing.id is null then raise exception 'Property not found'; end if;
  if v_actor.role<>'creator' and not public.current_actor_in_scope(v_listing.state,v_listing.city) then
    raise exception 'Reservation is outside your assigned State/LGA';
  end if;

  select * into v_case from public.partner_support_conversations c
  where c.context_type='apartment_reservation' and c.context_id=v_res.id
  order by c.updated_at desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id',p.user_id,
    'name',coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.username),''),p.user_id),
    'username',p.username
  ) order by coalesce(p.full_name,p.username,p.user_id)),'[]'::jsonb)
  into v_candidates
  from public.profiles p
  where p.role='staff'
    and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)
    and exists(select 1 from public.staff_permissions sp where sp.staff_id=p.user_id and sp.permission='field_officer' and sp.is_active=true)
    and lower(btrim(coalesce(p.assigned_state,'')))=lower(btrim(coalesce(v_listing.state,'')))
    and lower(btrim(coalesce(p.assigned_lga,'')))=lower(btrim(coalesce(v_listing.city,'')));

  return jsonb_build_object(
    'conversation_id',v_case.id,
    'assigned_field_officer_id',coalesce(v_res.handover_field_officer_id,v_case.assigned_field_officer_id),
    'assigned_field_officer_name',(
      select coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.username),''),p.user_id)
      from public.profiles p
      where p.user_id=coalesce(v_res.handover_field_officer_id,v_case.assigned_field_officer_id)
    ),
    'candidates',v_candidates
  );
end;
$$;

create or replace function public.assign_reservation_field_officer(p_reservation_id text,p_field_officer_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor public.profiles;
  v_res public.reservations;
  v_listing public.listings;
  v_officer public.profiles;
  v_case public.partner_support_conversations;
begin
  select * into v_actor from public.profiles
  where auth_id=auth.uid()::text and role in ('staff','admin','creator')
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null then raise exception 'Property Operations access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then
    raise exception 'Property Operations permission required';
  end if;

  select * into v_res from public.reservations where id=p_reservation_id for update;
  if v_res.id is null then raise exception 'Reservation not found'; end if;
  select * into v_listing from public.listings where id::text=v_res.listing_id or listing_id=v_res.listing_id limit 1;
  if v_listing.id is null then raise exception 'Property not found'; end if;
  if v_actor.role<>'creator' and not public.current_actor_in_scope(v_listing.state,v_listing.city) then
    raise exception 'Reservation is outside your assigned State/LGA';
  end if;

  select * into v_officer from public.profiles p
  where p.user_id=p_field_officer_id and p.role='staff'
    and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)
    and lower(btrim(coalesce(p.assigned_state,'')))=lower(btrim(coalesce(v_listing.state,'')))
    and lower(btrim(coalesce(p.assigned_lga,'')))=lower(btrim(coalesce(v_listing.city,'')))
    and exists(select 1 from public.staff_permissions sp where sp.staff_id=p.user_id and sp.permission='field_officer' and sp.is_active=true)
  limit 1;
  if v_officer.user_id is null then raise exception 'Choose an active Field Operations officer for this branch'; end if;

  select * into v_case from public.partner_support_conversations c
  where c.context_type='apartment_reservation' and c.context_id=v_res.id
  order by c.updated_at desc limit 1 for update;
  if v_case.id is null then
    raise exception 'The Property Operations conversation is missing for this reservation';
  end if;

  update public.partner_support_conversations
  set assigned_field_officer_id=v_officer.user_id,
      assigned_staff_id=coalesce(assigned_staff_id,v_actor.user_id),
      status=case when status='open' then 'assigned' else status end,
      channel_kind='property_operations',updated_at=now()
  where id=v_case.id;

  update public.reservations
  set handover_field_officer_id=v_officer.user_id,
      handover_conversation_id=v_case.id,updated_at=now()
  where id=v_res.id;

  insert into public.partner_support_messages(
    conversation_id,sender_id,sender_role,content,action_type,action_metadata,created_at,is_read,visibility
  ) values (
    v_case.id,v_actor.user_id,'system',
    coalesce(nullif(btrim(v_officer.full_name),''),nullif(btrim(v_officer.username),''),v_officer.user_id)||
      ' joined as Field Operations for the move-in handover. Property Operations remains responsible for this case.',
    'field_officer_assigned',jsonb_build_object('officer_id',v_officer.user_id,'reservation_id',v_res.id),now(),false,'customer'
  );

  insert into public.notifications(
    recipient_id,type,title,message,read,related_id,source_type,source_id,
    destination_route,destination_params,event_key,workspace_scope
  ) values (
    v_officer.user_id,'reservation_handover_assigned','Move-in handover assigned',
    coalesce(v_listing.title,'Apartment')||' · '||coalesce(nullif(btrim(v_actor.full_name),''),'Property Operations')||' assigned you to the existing reservation conversation.',
    false,v_res.id,'apartment_reservation',v_res.id,'conversation',
    jsonb_build_object('conversation_id',v_case.id,'reservation_id',v_res.id,'listing_id',v_listing.id),
    'handover-assignment:'||v_res.id||':'||v_officer.user_id||':'||extract(epoch from now())::bigint,'staff'
  );

  return jsonb_build_object(
    'conversation_id',v_case.id,
    'assigned_field_officer_id',v_officer.user_id,
    'assigned_field_officer_name',coalesce(nullif(btrim(v_officer.full_name),''),nullif(btrim(v_officer.username),''),v_officer.user_id)
  );
end;
$$;

create or replace function public.confirm_apartment_handover(p_booking_code text,p_start_date date default current_date)
returns public.reservations
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_verified jsonb;
  v_result public.reservations;
  v_res public.reservations;
begin
  v_verified:=public.verify_branch_booking_code(p_booking_code);
  if v_verified is null or v_verified->>'kind'<>'housing' then
    raise exception 'Enter a valid housing move-in code';
  end if;
  if coalesce((v_verified->>'can_handover')::boolean,false) is not true then
    raise exception 'Verified rent and a customer move-in time are required before handover';
  end if;
  if p_start_date<>((v_verified->>'requested_move_in_at')::timestamptz)::date then
    raise exception 'The tenancy start date must match the customer move-in request';
  end if;
  select * into v_res from public.reservations where id=v_verified->>'reservation_id';
  if v_res.handover_field_officer_id is null or v_res.handover_conversation_id is null then
    raise exception 'Assign Field Operations to the reservation conversation before handover';
  end if;
  select * into v_result from public.activate_apartment_tenancy(v_res.id,p_start_date);
  return v_result;
end;
$$;

revoke all on function public.get_reservation_handover_assignment(text) from public;
revoke all on function public.assign_reservation_field_officer(text,text) from public;
grant execute on function public.get_reservation_handover_assignment(text) to authenticated,service_role;
grant execute on function public.assign_reservation_field_officer(text,text) to authenticated,service_role;

-- A hotel is one property record. Partners can finish room types before
-- publication; bookings only consume dated room inventory and never replace
-- or hide the hotel record.
create or replace function public.partner_create_hotel_room(
  p_hotel_id integer,p_room_type text,p_description text,p_price_per_night integer,
  p_max_guests integer,p_bed_type text,p_total_rooms integer,
  p_amenities text[] default '{}'::text[],p_images text[] default '{}'::text[]
)
returns public.hotel_rooms
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_room public.hotel_rooms;
  v_role text;
begin
  v_role:=public.current_actor_hotel_role(p_hotel_id);
  if v_role not in ('owner','manager') then raise exception 'Hotel owner or Manager access required'; end if;
  if not exists(select 1 from public.hotels h where h.hotel_id=p_hotel_id and h.status in ('draft','active')) then
    raise exception 'Rooms cannot be changed while this hotel is closed or rejected';
  end if;
  if nullif(btrim(p_room_type),'') is null or coalesce(p_price_per_night,0)<=0
     or coalesce(p_max_guests,0)<1 or coalesce(p_total_rooms,0)<1 then
    raise exception 'Valid room name, rate, capacity and inventory are required';
  end if;
  insert into public.hotel_rooms(
    hotel_id,room_type,description,price_per_night,max_guests,bed_type,total_rooms,amenities,images,source_system
  ) values (
    p_hotel_id,btrim(p_room_type),nullif(btrim(coalesce(p_description,'')),''),p_price_per_night,
    p_max_guests,nullif(btrim(coalesce(p_bed_type,'')),''),p_total_rooms,
    coalesce(p_amenities,'{}'),coalesce(p_images,'{}'),'wehouse'
  ) returning * into v_room;
  insert into public.hotel_rate_plans(
    hotel_id,room_id,name,description,meal_plan,payment_timing,refundable,price_per_night,included_features
  ) values (
    p_hotel_id,v_room.room_id,'Room only','Room without a meal package','room_only','pay_now',false,p_price_per_night,'{}'
  );
  return v_room;
end;
$$;

create or replace function public.get_public_hotel_detail(p_hotel_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
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
  if v_hotel.status<>'active' and not v_internal and not v_paid then return null; end if;
  select coalesce(jsonb_agg(
    to_jsonb(r)||jsonb_build_object('rate_plans',coalesce((
      select jsonb_agg(to_jsonb(rp) order by rp.price_per_night,rp.rate_plan_id)
      from public.hotel_rate_plans rp where rp.room_id=r.room_id and (rp.active or v_internal or v_paid)
    ),'[]'::jsonb)) order by r.price_per_night
  ),'[]'::jsonb) into v_rooms from public.hotel_rooms r where r.hotel_id=v_hotel.hotel_id;
  select coalesce(jsonb_agg(to_jsonb(v) order by v.kind,v.name),'[]'::jsonb)
  into v_venues from public.hotel_venues v where v.hotel_id=v_hotel.hotel_id and (v.active or v_internal or v_paid);
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

grant execute on function public.partner_create_hotel_room(integer,text,text,integer,integer,text,integer,text[],text[]) to authenticated,service_role;
grant execute on function public.get_public_hotel_detail(integer) to authenticated,service_role;
