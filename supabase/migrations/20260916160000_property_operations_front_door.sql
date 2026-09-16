-- Property concerns enter WeHouse through Property Operations first.
-- Field Operations is an assigned specialist on the same customer conversation;
-- it is not a separate customer-facing front door.

update public.case_reason_registry
set owning_domain='property_operations'
where reason_code='field_visit';

create or replace function public.create_user_inspection_request(
  p_reservation_id text,
  p_notes text default null
)
returns public.user_inspection_requests
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_actor public.profiles;
  v_res public.reservations;
  v_listing public.listings;
  v_request public.user_inspection_requests;
  v_conversation_id uuid;
begin
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;

  select * into v_res
  from public.reservations
  where id=p_reservation_id and user_id=v_actor.user_id
  for update;
  if v_res.id is null then raise exception 'Reservation not found'; end if;
  if v_res.stay_type='short_let' then
    raise exception 'Customer inspection applies to Long Let reservations';
  end if;
  if coalesce(v_res.reservation_fee_status,'') not in ('paid','completed')
     and v_res.paid_at is null then
    raise exception 'Complete the reservation payment before requesting inspection';
  end if;

  select * into v_listing
  from public.listings
  where id::text=v_res.listing_id or listing_id=v_res.listing_id
  limit 1;
  if v_listing.id is null then raise exception 'Property not found'; end if;

  select * into v_request
  from public.user_inspection_requests
  where reservation_id=v_res.id
    and status not in ('completed','cancelled','failed','customer_declined')
  order by created_at desc
  limit 1;

  if v_request.id is null then
    insert into public.user_inspection_requests(
      reservation_id,listing_id,user_id,field_officer_id,status,notes,
      created_at,updated_at
    ) values(
      v_res.id,v_res.listing_id,v_actor.user_id,null,'pending',
      nullif(btrim(coalesce(p_notes,'')),''),now(),now()
    ) returning * into v_request;
  end if;

  -- Reuse/upgrade the canonical Property Operations conversation. The request
  -- deliberately remains unassigned until Property Operations chooses a Field officer.
  v_conversation_id:=public.open_my_reservation_conversation(
    'apartment_reservation',v_res.id
  );

  update public.partner_support_conversations
  set channel_kind='property_operations',
      context_snapshot=coalesce(context_snapshot,'{}'::jsonb)||jsonb_build_object(
        'inspection_request_id',v_request.id,
        'inspection_status',v_request.status
      ),
      updated_at=now()
  where id=v_conversation_id;

  insert into public.partner_support_messages(
    conversation_id,sender_id,sender_role,content,attachments,attachment_types,
    action_type,action_metadata,is_read,visibility,created_at
  ) select
    v_conversation_id,v_actor.user_id,'system',
    'Inspection requested. Property Operations will assign Field Operations for this property in this conversation.',
    array[]::text[],array[]::text[],'inspection_requested',
    jsonb_build_object(
      'inspection_request_id',v_request.id,
      'reservation_id',v_res.id,
      'listing_id',v_res.listing_id,
      'customer_front_door','property_operations'
    ),false,'customer',now()
  where not exists(
    select 1 from public.partner_support_messages m
    where m.conversation_id=v_conversation_id
      and m.action_type='inspection_requested'
      and m.action_metadata->>'inspection_request_id'=v_request.id::text
  );

  update public.reservations
  set status=case when status in('reserved','reservation_paid') then 'inspection_pending' else status end,
      updated_at=now()
  where id=v_res.id;

  return v_request;
end
$function$;

create or replace function public.get_customer_inspection_assignment(
  p_reservation_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_actor public.profiles;
  v_res public.reservations;
  v_listing public.listings;
  v_request public.user_inspection_requests;
  v_conversation public.partner_support_conversations;
  v_candidates jsonb;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and role in('staff','admin','creator')
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null then raise exception 'Property Operations access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then
    raise exception 'Property Operations permission required';
  end if;

  select * into v_res from public.reservations where id=p_reservation_id;
  if v_res.id is null then raise exception 'Reservation not found'; end if;
  select * into v_listing from public.listings
  where id::text=v_res.listing_id or listing_id=v_res.listing_id limit 1;
  if v_listing.id is null then raise exception 'Property not found'; end if;
  if v_actor.role<>'creator' and not public.current_actor_in_scope(v_listing.state,v_listing.city) then
    raise exception 'Reservation is outside your assigned State/LGA';
  end if;

  select * into v_request from public.user_inspection_requests
  where reservation_id=v_res.id
  order by created_at desc limit 1;

  select * into v_conversation from public.partner_support_conversations
  where context_type='apartment_reservation' and context_id=v_res.id
  order by updated_at desc limit 1;

  select coalesce(jsonb_agg(candidate order by workload,display_name),'[]'::jsonb)
  into v_candidates
  from (
    select jsonb_build_object(
      'user_id',p.user_id,
      'name',coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.username),''),p.user_id),
      'username',p.username,
      'active_assignments',(
        select count(*) from public.user_inspection_requests i
        where i.field_officer_id=p.user_id and i.status in('scheduled','in_progress')
      )
    ) candidate,
    (select count(*) from public.user_inspection_requests i
      where i.field_officer_id=p.user_id and i.status in('scheduled','in_progress')) workload,
    coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.username),''),p.user_id) display_name
    from public.profiles p
    where p.role='staff'
      and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false)
      and not coalesce(p.banned,false)
      and exists(
        select 1 from public.staff_permissions sp
        where sp.staff_id=p.user_id and sp.is_active=true
          and sp.permission='field_officer'
      )
      and lower(btrim(coalesce(p.assigned_state,'')))=lower(btrim(coalesce(v_listing.state,'')))
      and lower(btrim(coalesce(p.assigned_lga,'')))=lower(btrim(coalesce(v_listing.city,'')))
  ) ranked;

  return jsonb_build_object(
    'inspection_id',v_request.id,
    'inspection_status',v_request.status,
    'conversation_id',v_conversation.id,
    'assigned_property_operations_id',v_conversation.assigned_staff_id,
    'assigned_field_officer_id',v_request.field_officer_id,
    'assigned_field_officer_name',(
      select coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.username),''),p.user_id)
      from public.profiles p where p.user_id=v_request.field_officer_id
    ),
    'candidates',v_candidates
  );
end
$function$;

create or replace function public.staff_assign_customer_inspection(
  p_inspection_id uuid,
  p_field_officer_id text,
  p_scheduled_date timestamptz default null
)
returns public.user_inspection_requests
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_actor public.profiles;
  v_request public.user_inspection_requests;
  v_res public.reservations;
  v_listing public.listings;
  v_field public.profiles;
  v_conversation public.partner_support_conversations;
  v_result public.user_inspection_requests;
  v_field_name text;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and role in('staff','admin','creator')
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null then raise exception 'Property Operations access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then
    raise exception 'Property Operations permission required';
  end if;

  select * into v_request from public.user_inspection_requests
  where id=p_inspection_id for update;
  if v_request.id is null then raise exception 'Inspection request not found'; end if;
  if v_request.status not in('pending','scheduled') then
    raise exception 'Inspection cannot be reassigned from its current state';
  end if;

  select * into v_res from public.reservations where id=v_request.reservation_id;
  if v_res.id is null then raise exception 'Reservation not found'; end if;
  select * into v_listing from public.listings
  where id::text=v_res.listing_id or listing_id=v_res.listing_id limit 1;
  if v_listing.id is null then raise exception 'Property not found'; end if;
  if v_actor.role<>'creator' and not public.current_actor_in_scope(v_listing.state,v_listing.city) then
    raise exception 'Inspection is outside your assigned State/LGA';
  end if;

  select * into v_field from public.profiles
  where user_id=p_field_officer_id and role='staff'
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
    and lower(btrim(coalesce(assigned_state,'')))=lower(btrim(coalesce(v_listing.state,'')))
    and lower(btrim(coalesce(assigned_lga,'')))=lower(btrim(coalesce(v_listing.city,'')))
    and exists(
      select 1 from public.staff_permissions sp
      where sp.staff_id=p_field_officer_id and sp.permission='field_officer' and sp.is_active=true
    )
  limit 1;
  if v_field.user_id is null then
    raise exception 'Choose an active Field Operations officer for this property branch';
  end if;
  v_field_name:=coalesce(nullif(btrim(v_field.full_name),''),nullif(btrim(v_field.username),''),'Field Operations');

  select * into v_conversation from public.partner_support_conversations
  where context_type='apartment_reservation' and context_id=v_res.id
  order by updated_at desc limit 1
  for update;
  if v_conversation.id is null then
    raise exception 'The reservation Property Operations conversation is missing';
  end if;

  update public.user_inspection_requests
  set field_officer_id=v_field.user_id,
      status='scheduled',
      scheduled_date=coalesce(p_scheduled_date,scheduled_date),
      updated_at=now()
  where id=v_request.id
  returning * into v_result;

  update public.partner_support_conversations
  set assigned_staff_id=coalesce(assigned_staff_id,v_actor.user_id),
      assigned_field_officer_id=v_field.user_id,
      channel_kind='property_operations',
      context_snapshot=coalesce(context_snapshot,'{}'::jsonb)||jsonb_build_object(
        'inspection_request_id',v_result.id,
        'inspection_status',v_result.status,
        'inspection_field_officer_id',v_field.user_id
      ),
      updated_at=now()
  where id=v_conversation.id;

  insert into public.partner_support_messages(
    conversation_id,sender_id,sender_role,content,attachments,attachment_types,
    action_type,action_metadata,is_read,visibility,created_at
  ) select
    v_conversation.id,v_actor.user_id,
    case when v_actor.role in('admin','creator') then v_actor.role else 'staff' end,
    v_field_name||' from Field Operations joined this property inspection. Property Operations remains responsible for your request.',
    array[]::text[],array[]::text[],'field_operations_assigned',
    jsonb_build_object(
      'inspection_request_id',v_result.id,
      'field_officer_id',v_field.user_id,
      'field_officer_name',v_field_name,
      'customer_front_door','property_operations'
    ),false,'customer',now()
  where not exists(
    select 1 from public.partner_support_messages m
    where m.conversation_id=v_conversation.id
      and m.action_type='field_operations_assigned'
      and m.action_metadata->>'inspection_request_id'=v_result.id::text
      and m.action_metadata->>'field_officer_id'=v_field.user_id
  );

  insert into public.notifications(
    recipient_id,type,title,message,read,related_id,source_type,source_id,
    destination_route,destination_params,event_key,workspace_scope
  ) values(
    v_field.user_id,'inspection_assigned','Property inspection assigned',
    'Property Operations assigned you to a customer inspection.',false,
    v_result.id::text,'user_inspection_request',v_result.id::text,
    'staff_inspections',jsonb_build_object(
      'inspection_id',v_result.id,'reservation_id',v_res.id,
      'conversation_id',v_conversation.id
    ),'customer-inspection-assigned:'||v_result.id::text||':'||v_field.user_id,
    'staff'
  ) on conflict(recipient_id,event_key) where event_key is not null do nothing;

  return v_result;
end
$function$;

revoke execute on function public.create_user_inspection_request(text,text) from public,anon;
revoke execute on function public.get_customer_inspection_assignment(text) from public,anon;
revoke execute on function public.staff_assign_customer_inspection(uuid,text,timestamptz) from public,anon;
grant execute on function public.create_user_inspection_request(text,text) to authenticated;
grant execute on function public.get_customer_inspection_assignment(text) to authenticated;
grant execute on function public.staff_assign_customer_inspection(uuid,text,timestamptz) to authenticated;

comment on function public.create_user_inspection_request(text,text)
is 'Customer inspection enters Property Operations unassigned; Property Operations selects Field Operations and keeps the same reservation conversation.';
comment on function public.staff_assign_customer_inspection(uuid,text,timestamptz)
is 'Property Operations assigns an eligible branch Field Operations officer to the customer inspection and the existing reservation conversation.';
