begin;
alter table public.notifications drop constraint notifications_workspace_scope_check;
alter table public.notifications add constraint notifications_workspace_scope_check check(workspace_scope in(
'personal','account','worker','partner','property_partner','hosting','hotel','staff','admin','creator',
'property_operations','field_operations','worker_operations','finance_operations','security_operations','support'));
CREATE OR REPLACE FUNCTION public.set_notification_workspace_scope()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
    'personal','account','worker','partner','hosting','hotel','staff','admin','creator',
    'property_operations','field_operations','worker_operations',
    'finance_operations','security_operations','support'
  ) then raise exception 'Unsupported notification workspace scope'; end if;
  return new;
end
$function$;
CREATE OR REPLACE FUNCTION public.get_my_canonical_activity_summary(p_workspace text DEFAULT 'personal'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_user text:=public.current_profile_user_id();
  v_result jsonb;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_workspace not in(
    'personal','account','worker','partner','property_partner','hosting','hotel',
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
$function$;
CREATE OR REPLACE FUNCTION public.get_my_canonical_activity_v2(p_workspace text DEFAULT 'personal'::text, p_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, type text, title text, message text, read boolean, created_at timestamp with time zone, source_type text, source_id text, destination_route text, destination_params jsonb, workspace text, action_required boolean, resolved_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare v_user text:=public.current_profile_user_id();
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_workspace not in(
    'personal','account','worker','partner','property_partner','hosting','hotel',
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
$function$;
CREATE OR REPLACE FUNCTION private.can_read_property_activity(p_event_id uuid, p_workspace text, p_recipient text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare e public.activity_events; hotel_key integer;
begin
  if p_recipient is distinct from public.current_profile_user_id() or p_recipient is null then return false; end if;
  if p_workspace='hosting' then
    select * into e from public.activity_events where activity_event_id=p_event_id;
    return public.current_actor_can_host_reservation(coalesce(e.route_params->>'reservation_id',
      case when e.subject_type in('reservation','apartment_reservation') then e.subject_id end));
  end if;
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
end $function$;
CREATE OR REPLACE FUNCTION public.request_my_apartment_move_in(p_reservation_id text, p_requested_at timestamp with time zone)
 RETURNS reservations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
  v_res public.reservations;
  v_listing public.listings;
  v_result public.reservations;
  decision jsonb;
begin
  if not public._property_document_session_active() then raise exception 'Active trusted session required'; end if;
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  select * into v_res from public.reservations
  where id=p_reservation_id and user_id=v_actor.user_id for update;
  if v_res is null then raise exception 'Apartment reservation not found'; end if;
  if coalesce(v_res.stay_type,'long_stay')<>'long_stay' then
    raise exception 'Use the reserved check-in time for a Short Let';
  end if;
  if v_res.status<>'ready_for_move_in'
     or v_res.rent_payment_status not in ('paid','upfront_paid')
     or v_res.rent_paid_at is null then
    raise exception 'Verified Year 1 rent is required before choosing move-in';
  end if;
  if p_requested_at is null
     or p_requested_at<now()-interval '15 minutes'
     or p_requested_at>now()+interval '3 days' then
    raise exception 'Choose a move-in time within the next 3 days';
  end if;
  select * into v_listing from public.listings
  where id::text=v_res.listing_id or listing_id=v_res.listing_id limit 1;
  if v_listing is null then raise exception 'Apartment listing not found'; end if;
  decision:=public.accommodation_access_authorization(
    v_res.id,v_res.listing_id,v_res.user_id,v_res.stay_type,v_res.status,v_res.manual_payment_status,v_res.paid_at,
    v_res.rent_payment_status,v_res.rent_paid_at,v_res.rent_payment_reference,v_res.stay_payment_protection_id,
    v_res.year_one_rent_protection_id,v_res.shared_payment_group_id,coalesce(v_res.upfront_rent_required,v_res.annual_rent_snapshot),'handover');
  if not coalesce((decision->>'authorized')::boolean,false) then raise exception 'Verified protected rent is required before choosing move-in'; end if;
  if v_res.requested_move_in_at is not distinct from p_requested_at then return v_res; end if;
  update public.reservations
  set requested_move_in_at=p_requested_at,move_in_requested_at=now(),
      updated_at=now()
  where id=v_res.id returning * into v_result;
  insert into public.notifications(
    recipient_id,type,title,message,read,source_type,source_id,
    destination_route,destination_params,workspace_scope
  ) values(
    v_actor.user_id,'move_in_request_saved','Move-in time sent',
    case when v_res.management_mode_snapshot='host' then 'Your property host received your preferred arrival time. Your tenancy has not started yet.' else 'Property Operations received your preferred arrival time. Your tenancy has not started yet.' end,
    false,'apartment_reservation',v_res.id,'my_reservations',
    jsonb_build_object('reservation_id',v_res.id),'personal'
  );

  -- Scoped Team Activity is already produced by the reservation trigger.
  -- The authorised host receives the task in Hosting, not a Staff workspace.
  if v_res.management_mode_snapshot='host' then
    insert into public.notifications(recipient_id,type,title,message,read,source_type,source_id,destination_route,destination_params,workspace_scope)
    select p.user_id,'property_move_in_requested','Move-in time requested',
      'The guest chose a move-in time for '||coalesce(v_listing.title,'your property')||'.',false,
      'apartment_reservation',v_res.id,'hosting',jsonb_build_object('reservation_id',v_res.id),case when public.user_has_active_workspace(p.user_id,'property_partner') then 'partner' else 'hosting' end
    from public.profiles p join public.property_host_assignments a on a.user_id=p.user_id
      and a.listing_id=v_listing.id and a.status='active'
    where p.user_id=v_res.responsible_host_user_id and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false) and not coalesce(p.banned,false);
  end if;
  return v_result;
end
$function$;
CREATE OR REPLACE FUNCTION public.get_my_canonical_activity(p_workspace text DEFAULT 'personal'::text, p_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, type text, title text, message text, read boolean, created_at timestamp with time zone, source_type text, source_id text, destination_route text, destination_params jsonb, workspace text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
 return query select e.id,e.type,e.title,e.message,e.read,e.created_at,e.source_type,e.source_id,e.destination_route,e.destination_params,e.workspace
 from public.get_my_canonical_activity_v2(p_workspace,p_limit) e;
end;
$function$;
commit;
