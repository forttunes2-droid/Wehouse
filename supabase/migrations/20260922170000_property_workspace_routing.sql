begin;
-- One authoritative property/hotel read model. Navigation IDs are never grants.
-- No booking, money, inspection, approval or account records are removed.


CREATE OR REPLACE FUNCTION public.current_actor_hotel_capabilities(p_hotel_id integer) RETURNS text[]
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  with actor as (select public.current_profile_user_id() as user_id)
  select case
    when hotel.owner_id=actor.user_id and exists(select 1 from public.workspace_role_assignments w where w.user_id=actor.user_id and w.workspace_role='property_partner' and w.status='active' and w.revoked_at is null) then public.hotel_default_capabilities('owner')
    else coalesce(member.capabilities,array[]::text[])
  end
  from public.hotels hotel
  cross join actor
  left join public.hotel_team_members member
    on member.hotel_id=hotel.hotel_id
   and member.member_user_id=actor.user_id
   and member.status='active' and member.revoked_at is null
  where hotel.hotel_id=p_hotel_id
    and actor.user_id is not null
    and ((hotel.owner_id=actor.user_id and exists(select 1 from public.workspace_role_assignments w where w.user_id=actor.user_id and w.workspace_role='property_partner' and w.status='active' and w.revoked_at is null)) or (hotel.owner_id is distinct from actor.user_id and member.id is not null))
  limit 1
$$;

CREATE OR REPLACE FUNCTION public.current_actor_hotel_role(p_hotel_id integer) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  select case when h.owner_id=p.user_id then 'owner' else tm.hotel_role end
  from public.profiles p join public.hotels h on h.hotel_id=p_hotel_id
  left join public.hotel_team_members tm on tm.hotel_id=h.hotel_id and tm.member_user_id=p.user_id and tm.status='active' and tm.revoked_at is null
  where p.auth_id=auth.uid()::text and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)
    and ((h.owner_id=p.user_id and exists(select 1 from public.workspace_role_assignments w where w.user_id=p.user_id and w.workspace_role='property_partner' and w.status='active' and w.revoked_at is null)) or (h.owner_id is distinct from p.user_id and tm.id is not null)) limit 1
$$;

CREATE OR REPLACE FUNCTION public.get_my_hotel_operations() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'hotel_id',hotel.hotel_id,'name',hotel.name,'description',hotel.description,
    'state',hotel.state,'city',hotel.city,'area',hotel.area,'address',hotel.address,
    'images',hotel.images,'amenities',hotel.amenities,'owner_id',hotel.owner_id,
    'status',hotel.status,'rating',hotel.rating,'review_count',hotel.review_count,
    'featured',hotel.featured,'check_in_time',hotel.check_in_time,
    'check_out_time',hotel.check_out_time,'timezone',hotel.timezone,
    'created_at',hotel.created_at,'updated_at',hotel.updated_at,
    'room_type_count',(select count(*) from public.hotel_rooms r where r.hotel_id=hotel.hotel_id),
    'total_room_count',(select coalesce(sum(r.total_rooms),0) from public.hotel_rooms r where r.hotel_id=hotel.hotel_id),
    'starting_rate',(select min(r.price_per_night) filter(where r.price_per_night>0) from public.hotel_rooms r where r.hotel_id=hotel.hotel_id),
    'access_role',case when hotel.owner_id=profile.user_id then 'owner' else member.hotel_role end,
    'capabilities',case when hotel.owner_id=profile.user_id
      then to_jsonb(public.hotel_default_capabilities('owner'))
      else to_jsonb(coalesce(member.capabilities,array[]::text[])) end
  ) order by hotel.updated_at desc),'[]'::jsonb)
  from public.profiles profile
  join public.hotels hotel on hotel.owner_id=profile.user_id or exists(
    select 1 from public.hotel_team_members assigned
    where assigned.hotel_id=hotel.hotel_id
      and assigned.member_user_id=profile.user_id and assigned.status='active' and assigned.revoked_at is null
  )
  left join public.hotel_team_members member
    on member.hotel_id=hotel.hotel_id and member.member_user_id=profile.user_id
   and member.status='active' and member.revoked_at is null
  where profile.auth_id=(select auth.uid())::text
    and public.current_actor_hotel_role(hotel.hotel_id) is not null
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
$$;


-- Resolve a stay using hotel capability checks, not direct cross-hotel table reads.
create or replace function public.get_my_hotel_booking_target(p_booking_id integer)
returns jsonb language plpgsql stable security definer
set search_path to 'pg_catalog','public' as $$
declare result jsonb;
begin
  select jsonb_build_object('hotel_id',b.hotel_id,'booking_id',b.booking_id) into result
  from public.hotel_bookings b
  where b.booking_id=p_booking_id and public.hotel_actor_has_capability(b.hotel_id,'stay.read');
  if result is null then raise exception 'Hotel stay unavailable'; end if;
  return result;
end $$;
revoke all on function public.get_my_hotel_booking_target(integer) from public,anon;
grant execute on function public.get_my_hotel_booking_target(integer) to authenticated,service_role;

-- Keep the existing snapshot API compatible; a deep link includes its exact
-- authorized stay even when more than 200 newer bookings exist.
create or replace function public.get_my_hotel_operation_snapshot_v2(p_hotel_id integer,p_booking_id integer default null)
returns jsonb language plpgsql stable security definer
set search_path to 'pg_catalog','public' as $$
declare snapshot jsonb; target jsonb;
begin
  snapshot:=public.get_my_hotel_operation_snapshot(p_hotel_id);
  if p_booking_id is null then return snapshot; end if;
  if not public.hotel_actor_has_capability(p_hotel_id,'stay.read') then raise exception 'Hotel stay unavailable'; end if;
  select jsonb_build_object(
    'booking_id',b.booking_id,'room_id',b.room_id,'rate_plan_id',b.rate_plan_id,
    'rate_plan_name',b.rate_plan_name,'check_in',b.check_in,'check_out',b.check_out,
    'guest_count',b.guest_count,'guest_name',b.guest_name,'booking_code',b.booking_code,
    'status',b.status,'payment_status',b.payment_status,'payment_expires_at',b.payment_expires_at,
    'total_price',b.total_price,'special_requests',b.special_requests,
    'assigned_room_unit_id',b.assigned_room_unit_id,
    'profiles',jsonb_build_object('username',p.username),
    'hotel_rooms',jsonb_build_object('room_type',r.room_type)
  ) into target from public.hotel_bookings b
  left join public.profiles p on p.user_id=b.user_id
  left join public.hotel_rooms r on r.room_id=b.room_id
  where b.hotel_id=p_hotel_id and b.booking_id=p_booking_id;
  if target is null then raise exception 'Hotel stay unavailable'; end if;
  return snapshot||jsonb_build_object('bookings',jsonb_build_array(target)||coalesce((
    select jsonb_agg(item) from jsonb_array_elements(snapshot->'bookings') item
    where item->>'booking_id'<>p_booking_id::text
  ),'[]'::jsonb));
end $$;
revoke all on function public.get_my_hotel_operation_snapshot_v2(integer,integer) from public,anon;
grant execute on function public.get_my_hotel_operation_snapshot_v2(integer,integer) to authenticated,service_role;


CREATE OR REPLACE FUNCTION public.infer_notification_workspace_scope(p_recipient_id text, p_type text, p_source_type text, p_destination_route text, p_title text) RETURNS text
    LANGUAGE plpgsql STABLE
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
  v_value text := lower(concat_ws(' ',p_type,p_source_type,p_destination_route));

begin
  if p_type in ('saved_search_match','followed_search_match') then return 'personal'; end if;
  if v_value ~ '(security|new_device|device_confirmation|password|login)' then return 'account'; end if;
  if v_value ~ '(roommate|shared_home|reservation|work_post_confirmation|worker_replied)' then return 'personal'; end if;
  if v_value ~ '(system|audit|payment_conflict|escalat|rent_paid)' then return 'creator'; end if;
  if v_value ~ '(operations_issue|finance_issue|verification_issue|support_ticket|staff_)' then return 'staff'; end if;
  if v_value ~ '(worker_booking|worker_job|worker_profile|worker_verification|customer_message|new_booking|review_received)' then return 'worker'; end if;
  if v_value ~ '(property_partner|property_submission|listing_|inspection_assigned|booking_received|partner_)' then return 'partner'; end if;
  if v_value ~ '(booking_confirmed|payment_successful|refund_completed|hotel_booking)' then return 'personal'; end if;

  -- Personal discovery never inherits the account's professional role.
  return 'personal';
end;
$$;

CREATE OR REPLACE FUNCTION public.set_notification_workspace_scope() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
begin
  if new.type in ('saved_search_match','followed_search_match') then new.workspace_scope:='personal'; end if;
  new.workspace_scope:=coalesce(
    nullif(btrim(new.workspace_scope),''),
    public.infer_notification_workspace_scope(
      new.recipient_id,new.type,new.source_type,new.destination_route,new.title
    )
  );
  if new.workspace_scope='property_partner' then
    new.workspace_scope:='partner';
  end if;
  if new.workspace_scope not in(
    'personal','account','worker','partner','hotel','staff','admin','creator',
    'property_operations','field_operations','worker_operations',
    'finance_operations','security_operations','support'
  ) then raise exception 'Unsupported notification workspace scope'; end if;
  return new;
end
$$;


create or replace function private.can_read_property_activity(p_event_id uuid,p_workspace text,p_recipient text)
returns boolean language plpgsql stable security definer
set search_path to 'pg_catalog','public','private' as $$
declare e public.activity_events; hotel_key integer;
begin
  if p_recipient is distinct from public.current_profile_user_id() or p_recipient is null then return false; end if;
  if p_workspace in ('partner','property_partner') and not exists(
    select 1 from public.workspace_role_assignments w where w.user_id=p_recipient
      and w.workspace_role='property_partner' and w.status='active' and w.revoked_at is null
  ) then return false; end if;
  if p_workspace not in ('hotel','hotel_staff','partner','property_partner') then return true; end if;
  select * into e from public.activity_events where activity_event_id=p_event_id;
  if e.subject_type in ('hotel_booking','hotel_stay') then
    select b.hotel_id into hotel_key from public.hotel_bookings b where b.booking_id::text=e.subject_id;
  elsif e.route_params ? 'hotelId' or e.route_params ? 'hotel_id' then
    select h.hotel_id into hotel_key from public.hotels h where h.hotel_id::text=coalesce(e.route_params->>'hotelId',e.route_params->>'hotel_id');
  end if;
  if p_workspace in ('hotel','hotel_staff') then
    -- Hotel Activity currently carries stays. Never expose a guest's metadata
    -- to room-only staff or resurrect it from an old, revoked audience row.
    return hotel_key is not null and exists(select 1 from public.hotel_team_members m
      where m.hotel_id=hotel_key and m.member_user_id=p_recipient
        and m.status='active' and m.revoked_at is null and 'stay.read'=any(m.capabilities));
  end if;
  if hotel_key is not null then
    return exists(select 1 from public.hotels h where h.hotel_id=hotel_key and h.owner_id=p_recipient);
  end if;
  return true;
end $$;
revoke all on function private.can_read_property_activity(uuid,text,text) from public,anon;
grant execute on function private.can_read_property_activity(uuid,text,text) to authenticated,service_role;

drop policy if exists activity_audience_self_read on public.activity_event_audiences;
create policy activity_audience_self_read on public.activity_event_audiences for select to authenticated
using (recipient_user_id=public.current_profile_user_id()
  and private.can_read_property_activity(activity_event_id,workspace,recipient_user_id));


create or replace function public.get_my_canonical_activity_v2(
  p_workspace text default 'personal',
  p_limit integer default 100
)
returns table(
  id uuid,
  type text,
  title text,
  message text,
  read boolean,
  created_at timestamptz,
  source_type text,
  source_id text,
  destination_route text,
  destination_params jsonb,
  workspace text,
  action_required boolean,
  resolved_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public','private'
as $$
declare v_user text:=public.current_profile_user_id();
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_workspace not in(
    'personal','account','worker','partner','property_partner','hotel',
    'staff','admin','creator','property_operations','field_operations',
    'worker_operations','finance_operations','security_operations','support'
  ) then raise exception 'Invalid Activity workspace'; end if;

  return query
  select e.activity_event_id,e.event_type,e.title,e.summary,
    a.read_at is not null,e.occurred_at,e.subject_type,e.subject_id,
    e.route,e.route_params,a.workspace,
    coalesce(a.action_required,false) and a.resolved_at is null,
    a.resolved_at
  from public.activity_event_audiences a
  join public.activity_events e on e.activity_event_id=a.activity_event_id
  where a.recipient_user_id=v_user
    and private.can_read_property_activity(a.activity_event_id,a.workspace,a.recipient_user_id)
    and private.activity_workspace_matches(p_workspace,a.workspace)
  order by e.occurred_at desc
  limit greatest(1,least(coalesce(p_limit,100),200));
end
$$;

create or replace function public.get_my_canonical_activity_summary(
  p_workspace text default 'personal'
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public','private'
as $$
declare
  v_user text:=public.current_profile_user_id();
  v_result jsonb;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_workspace not in(
    'personal','account','worker','partner','property_partner','hotel',
    'staff','admin','creator','property_operations','field_operations',
    'worker_operations','finance_operations','security_operations','support'
  ) then raise exception 'Invalid Activity workspace'; end if;

  select jsonb_build_object(
    'unread',count(*) filter(
      where a.read_at is null
        and e.occurred_at>=now()-interval '180 days'
    ),
    'needs_action',count(*) filter(
      where coalesce(a.action_required,false)
        and a.resolved_at is null
    ),
    'latest_at',max(e.occurred_at)
  )
  into v_result
  from public.activity_event_audiences a
  join public.activity_events e on e.activity_event_id=a.activity_event_id
  where a.recipient_user_id=v_user
    and private.can_read_property_activity(a.activity_event_id,a.workspace,a.recipient_user_id)
    and private.activity_workspace_matches(p_workspace,a.workspace);

  return coalesce(v_result,jsonb_build_object(
    'unread',0,'needs_action',0,'latest_at',null
  ));
end
$$;

create or replace function public.mark_my_canonical_activity_read(
  p_activity_event_id uuid,
  p_workspace text
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $$
declare v_user text:=public.current_profile_user_id();
begin
  update public.activity_event_audiences
  set read_at=coalesce(read_at,now())
  where activity_event_id=p_activity_event_id
    and recipient_user_id=v_user
    and private.can_read_property_activity(activity_event_id,workspace,recipient_user_id)
    and private.activity_workspace_matches(p_workspace,workspace);
  return found;
end
$$;

create or replace function public.mark_all_my_canonical_activity_read(
  p_workspace text
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $$
declare v_user text:=public.current_profile_user_id(); v_count integer;
begin
  update public.activity_event_audiences
  set read_at=coalesce(read_at,now())
  where recipient_user_id=v_user
    and read_at is null
    and private.can_read_property_activity(activity_event_id,workspace,recipient_user_id)
    and private.activity_workspace_matches(p_workspace,workspace);
  get diagnostics v_count=row_count;
  return v_count;
end
$$;

create or replace function private.fanout_hotel_activity(
  p_event_id uuid,
  p_hotel_id integer,
  p_action_required boolean default false
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $$
declare
  v_member record;
  v_count integer:=0;
begin
  for v_member in
    select distinct member.member_user_id
    from public.hotel_team_members member
    join public.profiles p on p.user_id=member.member_user_id
    where member.hotel_id=p_hotel_id
      and member.status='active'
      and member.revoked_at is null
      and 'stay.read'=any(member.capabilities)
      and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false)
      and not coalesce(p.banned,false)
  loop
    perform private.add_activity_audience(
      p_event_id,v_member.member_user_id,'hotel','hotel',null,p_action_required
    );
    v_count:=v_count+1;
  end loop;
  return v_count;
end
$$;

create or replace function public.notify_hotel_booking_lifecycle()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $$
declare
  v_hotel public.hotels;
  v_event_id uuid;
begin
  select * into v_hotel from public.hotels where hotel_id=new.hotel_id;
  if v_hotel.hotel_id is null then return new; end if;

  if new.status='confirmed' and new.payment_status='paid'
     and (tg_op='INSERT'
       or old.status is distinct from new.status
       or old.payment_status is distinct from new.payment_status) then
    v_event_id:=private.upsert_activity_event(
      'hotel_booking:'||new.booking_id||':confirmed',
      'hotel.stay_confirmed',
      'hotel_booking',new.booking_id::text,new.user_id,
      'Hotel stay confirmed',
      v_hotel.name||' · '||to_char(new.check_in,'Mon DD')||' to '||to_char(new.check_out,'Mon DD')||'.',
      'hotel_booking',
      jsonb_build_object('bookingId',new.booking_id,'hotelId',new.hotel_id),
      coalesce(new.updated_at,new.created_at,now())
    );
    perform private.add_activity_audience(
      v_event_id,new.user_id,'personal','hotel',v_hotel.state,false
    );
    if v_hotel.owner_id is not null then
      perform private.add_activity_audience(
        v_event_id,v_hotel.owner_id,'partner','hotel',v_hotel.state,false
      );
    end if;
    perform private.fanout_hotel_activity(v_event_id,new.hotel_id,true);
    return new;
  end if;

  if tg_op='UPDATE' and new.status is distinct from old.status
     and new.status in ('checked_in','checked_out') then
    v_event_id:=private.upsert_activity_event(
      'hotel_booking:'||new.booking_id||':'||new.status,
      case when new.status='checked_in'
        then 'hotel.checked_in' else 'hotel.checked_out' end,
      'hotel_booking',new.booking_id::text,new.user_id,
      case when new.status='checked_in'
        then 'Hotel check-in completed' else 'Hotel checkout completed' end,
      case when new.status='checked_in'
        then 'Guest checked in at '||v_hotel.name||'.'
        else 'Guest checked out of '||v_hotel.name||'.' end,
      'hotel_booking',
      jsonb_build_object('bookingId',new.booking_id,'hotelId',new.hotel_id),
      coalesce(new.updated_at,now())
    );
    perform private.add_activity_audience(
      v_event_id,new.user_id,'personal','hotel',v_hotel.state,false
    );
    if v_hotel.owner_id is not null then
      perform private.add_activity_audience(v_event_id,v_hotel.owner_id,'partner','hotel',v_hotel.state,false);
    end if;
    perform private.resolve_subject_activity('hotel_booking',new.booking_id::text,'hotel.stay_confirmed','hotel');
    perform private.fanout_hotel_activity(v_event_id,new.hotel_id,false);
  end if;
  if tg_op='UPDATE' and new.status is distinct from old.status and new.status in ('cancelled','expired','refunded','payment_conflict') then
    perform private.resolve_subject_activity('hotel_booking',new.booking_id::text,'hotel.stay_confirmed','hotel');
    v_event_id:=private.upsert_activity_event(
      'hotel_booking:'||new.booking_id||':'||new.status,'hotel.'||new.status,'hotel_booking',new.booking_id::text,new.user_id,
      case new.status when 'cancelled' then 'Hotel stay cancelled' when 'expired' then 'Hotel payment hold expired' when 'refunded' then 'Hotel payment refunded' else 'Hotel payment needs review' end,
      v_hotel.name||' · '||to_char(new.check_in,'Mon DD')||' to '||to_char(new.check_out,'Mon DD'),
      'hotel_booking',jsonb_build_object('bookingId',new.booking_id,'hotelId',new.hotel_id),coalesce(new.updated_at,now())
    );
    perform private.add_activity_audience(v_event_id,new.user_id,'personal','hotel',v_hotel.state,false);
    if v_hotel.owner_id is not null then perform private.add_activity_audience(v_event_id,v_hotel.owner_id,'partner','hotel',v_hotel.state,new.status='payment_conflict'); end if;
    perform private.fanout_hotel_activity(v_event_id,new.hotel_id,new.status='payment_conflict');
  end if;
  return new;
end
$$;

create or replace function public.get_my_workspace_inbox(p_workspace text, p_kind text)
returns jsonb language plpgsql stable security definer
set search_path to 'pg_catalog','public'
as $$
declare actor text; result jsonb; access jsonb;
begin
  select user_id into actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false);
  if actor is null then raise exception 'Authentication required'; end if;
  if p_workspace is null or p_workspace not in ('personal','worker','property_partner','hotel') then
    raise exception 'Unsupported workspace';
  end if;
  access:=public.get_my_workspace_access();
  if p_workspace<>'personal' and not exists (
    select 1 from jsonb_array_elements(access->'privileged_workspaces') item where item->>'role'=p_workspace
  ) then raise exception 'Workspace access required'; end if;

  if p_kind='service' and p_workspace in ('personal','worker') then
    select coalesce(jsonb_agg(to_jsonb(row) order by row.updated_at desc),'[]'::jsonb) into result
    from public.get_my_booking_conversations_v3(actor) row
    join public.booking_conversations thread on thread.id=row.conversation_id
    where (p_workspace='personal' and thread.user_id=actor)
       or (p_workspace='worker' and thread.worker_id=actor);
  elsif p_kind='hotel' and p_workspace in ('personal','property_partner','hotel') then
    select coalesce(jsonb_agg(to_jsonb(row) order by row.updated_at desc),'[]'::jsonb) into result
    from public.get_my_hotel_booking_conversations() row
    where (p_workspace='personal' and row.guest_user_id=actor)
       or (p_workspace<>'personal' and row.guest_user_id<>actor);
  elsif p_kind='wehouse' then
    select coalesce(jsonb_agg((to_jsonb(row)||jsonb_build_object('context_snapshot',coalesce(row.context_snapshot,'{}'::jsonb)||coalesce((
      select jsonb_build_object('property_display_name',coalesce(nullif(ir.property_display_name,''),nullif(ir.hotel_program->>'name',''),nullif(ir.property_address,''),'Property inspection'))
      from public.inspection_requests ir
      where ir.owner_id=actor and (ir.id::text=thread.context_id or ir.request_code=thread.context_id)
        and (thread.context_type='property_inspection' or thread.context_snapshot->>'reason_code'='property_submission_help')
      limit 1
    ),'{}'::jsonb))) order by coalesce(row.last_message_time,row.created_at) desc),'[]'::jsonb) into result
    from public.get_my_support_conversations() row
    join public.partner_support_conversations thread on thread.id=row.conversation_id
    where thread.partner_id=actor and (case
      when thread.context_type in ('apartment_reservation','reservation','apartment_payment','hotel_booking') then 'personal'
      when thread.context_type in ('worker_booking','worker_job')
        or thread.context_snapshot->>'subject_type'='worker_job'
        or thread.context_snapshot->>'source_type'='worker_job'
        or thread.context_snapshot->>'reason_code'='worker_job_issue' then
        case when exists(select 1 from public.worker_bookings booking
          where booking.id::text=coalesce(thread.context_snapshot->>'source_id',thread.context_id)
            and booking.worker_id=actor) then 'worker' else 'personal' end
      when thread.context_snapshot->>'requester_workspace' in ('personal','worker','property_partner','hotel') then thread.context_snapshot->>'requester_workspace'
      -- Public hotel/listing enquiries are customer work even when the legacy
      -- profile role is Worker. Explicit originating workspace above takes
      -- precedence; older records fall back to real ownership/capability.
      when thread.context_type='property_inspection' then 'property_partner'
      when thread.context_type in ('property_listing','listing') then
        case when exists(select 1 from public.listings listing
          where (listing.id::text=thread.context_id or listing.listing_id=thread.context_id)
            and actor in (listing.owner_id,listing.partner_id))
          then 'property_partner' else 'personal' end
      when thread.context_type in ('hotel_property','hotel_operations') then
        case when exists(select 1 from public.hotels hotel
          where hotel.hotel_id::text=thread.context_id and hotel.owner_id=actor)
          then 'property_partner'
        when exists(select 1 from public.hotels hotel
          where hotel.hotel_id::text=thread.context_id
            and public.hotel_actor_has_capability(hotel.hotel_id,'stay.read'))
          then 'hotel' else 'personal' end
      when coalesce(thread.requester_role,'user')='user' then 'personal'
      when thread.requester_role='hotel_staff' then 'hotel'
      else thread.requester_role end)=p_workspace;
  else raise exception 'Unsupported inbox';
  end if;
  return result;
end;
$$;


-- Repair only the saved-search projection, preserving read state. Not a test-data
-- wipe: the original notifications, properties, bookings and money remain intact.
update public.notifications set workspace_scope='personal'
where type in ('saved_search_match','followed_search_match') and workspace_scope is distinct from 'personal';
insert into public.activity_event_audiences(activity_event_id,recipient_user_id,workspace,domain,state_scope,read_at,resolved_at,action_required)
select a.activity_event_id,a.recipient_user_id,'personal',null,min(a.state_scope),min(a.read_at),min(a.resolved_at),false
from public.activity_event_audiences a join public.activity_events e using(activity_event_id)
where e.event_type in ('saved_search_match','followed_search_match') and a.workspace<>'personal'
group by a.activity_event_id,a.recipient_user_id
on conflict(activity_event_id,recipient_user_id,workspace) do update
set read_at=coalesce(activity_event_audiences.read_at,excluded.read_at),action_required=false;
delete from public.activity_event_audiences a using public.activity_events e
where e.activity_event_id=a.activity_event_id and e.event_type in ('saved_search_match','followed_search_match') and a.workspace<>'personal';

-- Creator/Admin/Property Operations inspect the same hotel without impersonating
-- its owner or relying on the public discovery API (which excludes paused hotels).
create or replace function public.get_my_property_hotel_record(p_hotel_id integer)
returns jsonb language plpgsql stable security definer
set search_path to 'pg_catalog','public' as $$
declare h public.hotels; actor text:=public.current_profile_user_id(); result jsonb;
begin
  select * into h from public.hotels where hotel_id=p_hotel_id;
  if h.hotel_id is null or actor is null or not exists(
    select 1 from public.workspace_role_assignments w where w.user_id=actor
      and w.status='active' and w.revoked_at is null
      and w.workspace_role in ('creator','admin','property_operations')
      and (w.scope_type='global' or (
        w.scope_type in ('state','branch') and nullif(public.wehouse_state_key(w.scope_state),'') is not null
        and public.wehouse_state_key(w.scope_state)=public.wehouse_state_key(h.state)
        and (w.scope_type='state' or (nullif(lower(btrim(w.scope_lga)),'') is not null and lower(btrim(w.scope_lga))=lower(btrim(h.city))))))
  ) then raise exception 'Hotel record unavailable in this workspace'; end if;
  result:=jsonb_build_object('hotel_id',h.hotel_id,'name',h.name,'description',h.description,
    'state',h.state,'city',h.city,'address',h.address,'status',h.status,'images',h.images,
    'amenities',h.amenities,'check_in_time',h.check_in_time,'check_out_time',h.check_out_time,
    'hotel_rooms',coalesce((select jsonb_agg(jsonb_build_object(
      'room_id',r.room_id,'hotel_id',r.hotel_id,'room_type',r.room_type,'description',r.description,
      'price_per_night',r.price_per_night,'total_rooms',r.total_rooms,'max_guests',r.max_guests,
      'images',r.images,'amenities',r.amenities,'bed_type',r.bed_type
    ) order by r.room_id) from public.hotel_rooms r where r.hotel_id=h.hotel_id),'[]'::jsonb));
  return result;
end $$;
revoke all on function public.get_my_property_hotel_record(integer) from public,anon;
grant execute on function public.get_my_property_hotel_record(integer) to authenticated,service_role;

commit;
