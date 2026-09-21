-- Field Operations candidates are selected by active workspace coverage, not profile.role.
-- A State Field Operations grant covers any LGA in that State; a branch grant covers only its LGA.

begin;

CREATE OR REPLACE FUNCTION public.admin_get_field_officers_for_inspection(p_inspection_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor public.profiles; v_ir public.inspection_requests; v_result jsonb;
begin
  v_actor:=public._current_team_actor();
  if v_actor.user_id is null or (v_actor.role='staff'
    and not public.current_staff_has_permission('property_operations')) then
    raise exception 'Property Operations, Admin or Creator access required';
  end if;
  select * into v_ir from public.inspection_requests where id=p_inspection_id;
  if v_ir.id is null then raise exception 'Inspection request not found'; end if;
  if v_actor.role<>'creator'
     and not public.current_actor_in_scope(v_ir.property_state,v_ir.property_city) then
    raise exception 'Inspection is outside your assigned State';
  end if;
  select coalesce(jsonb_agg(x order by (x->>'distance_km')::numeric nulls last,
    (x->>'active_inspections')::int,coalesce(x->>'name','')),'[]'::jsonb)
  into v_result from (
    select jsonb_build_object(
      'user_id',p.user_id,'name',coalesce(p.full_name,p.username,p.email),
      'email',p.email,'assigned_state',p.assigned_state,'assigned_lga',p.assigned_lga,
      'active_inspections',(select count(*) from public.inspection_requests q
        where coalesce(q.assigned_field_officer_id,q.field_officer_id,q.assigned_to)=p.user_id
          and q.status in('scheduled','in_progress')),
      'location_captured_at',loc.captured_at,
      'distance_km',case when v_ir.gps_latitude is not null and v_ir.gps_longitude is not null
        and loc.latitude is not null and loc.longitude is not null
        and loc.captured_at>now()-interval '24 hours'
        then round((6371*2*asin(sqrt(
          power(sin(radians((loc.latitude-v_ir.gps_latitude)/2)),2)
          +cos(radians(v_ir.gps_latitude))*cos(radians(loc.latitude))
          *power(sin(radians((loc.longitude-v_ir.gps_longitude)/2)),2)
        )))::numeric,2) else null end
    ) x
    from public.profiles p
    left join public.staff_location_presence loc on loc.staff_id=p.user_id
    where not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false)
      and not coalesce(p.banned,false)
      and public.user_has_active_workspace(p.user_id,'staff')
      and public.user_workspace_covers(
        p.user_id,'field_operations',v_ir.property_state,v_ir.property_city
      )
  ) ranked;
  return v_result;
end
$function$
;

CREATE OR REPLACE FUNCTION public.assign_reservation_field_officer(p_reservation_id text, p_field_officer_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
  v_res public.reservations;
  v_listing public.listings;
  v_officer public.profiles;
  v_case public.partner_support_conversations;
begin
  v_actor:=public._current_team_actor();
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

  select * into v_officer
  from public.profiles p
  where p.user_id=p_field_officer_id
    and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
    and public.user_has_active_workspace(p.user_id,'staff')
    and public.user_workspace_covers(
      p.user_id,'field_operations',v_listing.state,v_listing.city
    )
  limit 1;
  if v_officer.user_id is null then raise exception 'Choose an active Field Operations member whose coverage includes this property'; end if;

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
$function$
;

CREATE OR REPLACE FUNCTION public.get_reservation_handover_assignment(p_reservation_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
  v_res public.reservations;
  v_listing public.listings;
  v_case public.partner_support_conversations;
  v_candidates jsonb;
begin
  v_actor:=public._current_team_actor();
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
  where not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
    and public.user_has_active_workspace(p.user_id,'staff')
    and public.user_workspace_covers(
      p.user_id,'field_operations',v_listing.state,v_listing.city
    );

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
$function$
;

commit;
