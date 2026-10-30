begin;
-- The existing customer-visit writer already requires this completion column.
alter table public.user_inspection_requests add column if not exists completed_at timestamptz;
CREATE OR REPLACE FUNCTION public.get_my_inspections(p_field_officer_id text)
 RETURNS TABLE(id uuid, inspection_code text, property_address text, property_city text, property_state text, property_type text, status text, owner_id text, owner_name text, owner_email text, owner_phone text, notes text, field_officer_id text, partner_id text, scheduled_date timestamp with time zone, completed_at timestamp with time zone, created_at timestamp with time zone, photo_urls text[], document_urls text[], video_urls text[], _source text, gps_latitude numeric, gps_longitude numeric, location_accuracy_m numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
begin
  if not public._property_document_session_active() then raise exception 'Active trusted session required'; end if;
  v_actor:=public._current_team_actor();

  if v_actor is null
     or v_actor.role <> 'staff'
     or v_actor.user_id <> p_field_officer_id
     or not public.current_staff_has_permission('field_officer') then
    raise exception 'Field Operations access required';
  end if;

  return query
  select
    ir.id,
    ir.request_code,
    ir.property_address,
    ir.property_city,
    ir.property_state,
    ir.property_type,
    ir.status,
    ir.owner_id,
    coalesce(p.full_name, p.username, p.email),
    ir.owner_email,
    ir.owner_phone,
    ir.notes,
    coalesce(ir.assigned_field_officer_id, ir.field_officer_id, ir.assigned_to),
    ir.partner_id::text,
    ir.scheduled_date::timestamptz,
    ir.completed_at,
    ir.created_at,
    ir.field_photo_urls,
    ir.document_urls,
    ir.field_video_urls,
    'partner'::text,
    ir.gps_latitude,
    ir.gps_longitude,
    ir.location_accuracy_m
  from public.inspection_requests ir
  left join public.profiles p on p.user_id = ir.owner_id
  where coalesce(ir.assigned_field_officer_id, ir.field_officer_id, ir.assigned_to)
        = v_actor.user_id
    and ir.owner_id<>v_actor.user_id
    and public.user_workspace_covers(v_actor.user_id,'staff',ir.property_state,ir.property_city)
    and public.user_workspace_covers(v_actor.user_id,'field_operations',ir.property_state,ir.property_city)

  union all

  select
    ur.id,
    coalesce(ur.reservation_id, ur.id::text),
    coalesce(l.address, l.title, 'Reserved property'),
    l.city,
    l.state,
    l.property_type::text,
    ur.status,
    ur.user_id,
    coalesce(u.full_name, u.username, u.email),
    u.email,
    u.phone,
    coalesce(ur.report,ur.notes),
    ur.field_officer_id,
    null::text,
    ur.scheduled_date,
    ur.completed_at,
    ur.created_at,
    ur.photo_urls,
    array[]::text[],
    ur.video_urls,
    'user'::text,
    l.gps_latitude,
    l.gps_longitude,
    null::numeric
  from public.user_inspection_requests ur
  left join public.listings l
    on l.listing_id = ur.listing_id
    or l.id::text = ur.listing_id
  left join public.profiles u on u.user_id = ur.user_id
  where ur.field_officer_id = v_actor.user_id
    and ur.user_id<>v_actor.user_id
    and public.user_workspace_covers(v_actor.user_id,'staff',l.state,l.city)
    and public.user_workspace_covers(v_actor.user_id,'field_operations',l.state,l.city)
  order by created_at desc;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.review_field_inspection_evidence(p_inspection_id uuid, p_decision text, p_note text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
  v_request public.inspection_requests;
  v_note text:=nullif(btrim(coalesce(p_note,'')),'');
begin
  if not public._property_document_session_active() then raise exception 'Active trusted session required'; end if;
  v_actor:=public._current_team_actor();
  if v_actor.user_id is null then raise exception 'Property review access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then
    raise exception 'Property Operations permission required';
  end if;
  select * into v_request from public.inspection_requests
  where id=p_inspection_id for update;
  if v_request.id is null then raise exception 'Inspection not found'; end if;
  if v_actor.user_id=v_request.owner_id or v_actor.user_id=coalesce(v_request.assigned_field_officer_id,v_request.field_officer_id,v_request.assigned_to) then
    raise exception 'The Field Officer who submitted evidence cannot approve it';
  end if;

  if (v_actor.role='creator' and not public.user_workspace_covers(v_actor.user_id,'creator',v_request.property_state,v_request.property_city))
    or (v_actor.role='admin' and not public.user_workspace_covers(v_actor.user_id,'admin',v_request.property_state,v_request.property_city))
    or (v_actor.role='staff' and (
      not public.user_workspace_covers(v_actor.user_id,'staff',v_request.property_state,v_request.property_city)
      or not public.user_workspace_covers(v_actor.user_id,'property_operations',v_request.property_state,v_request.property_city)))
  then raise exception 'Property is outside your active Property Operations coverage'; end if;
  if v_request.field_evidence_reviewed_by=v_actor.user_id
    and v_request.field_evidence_review_note is not distinct from v_note
    and ((p_decision='accept' and v_request.field_evidence_review_status='accepted')
      or (p_decision='request_changes' and v_request.field_evidence_review_status='changes_requested'))
  then return true; end if;

  if v_request.field_evidence_review_status<>'pending' then
    raise exception 'This Field Operations evidence is not awaiting review';
  end if;
  if p_decision='accept' then
    if cardinality(coalesce(v_request.field_photo_urls,'{}'))<4 then
      raise exception 'Four Field Operations photos are required before acceptance';
    end if;
    if nullif(btrim(coalesce(v_request.notes,'')),'') is null then
      raise exception 'A Field Operations report is required before acceptance';
    end if;
    update public.inspection_requests
    set field_evidence_review_status='accepted',field_evidence_reviewed_by=v_actor.user_id,
        field_evidence_reviewed_at=now(),field_evidence_review_note=v_note,
        rejection_reason=null,updated_at=now()
    where id=p_inspection_id;
  elsif p_decision='request_changes' then
    if v_note is null then raise exception 'Explain exactly what Field Operations must correct'; end if;
    update public.inspection_requests
    set status='in_progress',field_evidence_review_status='changes_requested',
        field_evidence_reviewed_by=v_actor.user_id,field_evidence_reviewed_at=now(),
        field_evidence_review_note=v_note,rejection_reason=v_note,updated_at=now()
    where id=p_inspection_id;
    if v_request.assigned_field_officer_id is not null then
      insert into public.notifications(
        recipient_id,type,title,message,related_id,source_type,source_id,
        destination_route,destination_params,event_key
      ) values(
        v_request.assigned_field_officer_id,'field_evidence_changes_requested',
        'Field evidence needs correction',v_note,v_request.id::text,
        'inspection_request',v_request.id::text,'field_inspections',
        jsonb_build_object('inspection_id',v_request.id),
        'field-evidence-correction:'||v_request.id::text||':'||extract(epoch from now())::bigint::text
      ) on conflict do nothing;
    end if;
  else
    raise exception 'Decision must be accept or request_changes';
  end if;
  return true;
end;
$function$
;
revoke all on function public.review_field_inspection_evidence(uuid,text,text) from public,anon;
grant execute on function public.review_field_inspection_evidence(uuid,text,text) to authenticated;
commit;
