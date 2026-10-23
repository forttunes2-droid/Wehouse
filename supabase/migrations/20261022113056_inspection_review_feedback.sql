begin;
-- No dependent database objects found; extend the existing getter rather than add a second path.
drop function public.get_my_inspections(text);
CREATE OR REPLACE FUNCTION public.get_my_inspections(p_field_officer_id text)
 RETURNS TABLE(id uuid, inspection_code text, property_address text, property_city text, property_state text, property_type text, status text, owner_id text, owner_name text, owner_email text, owner_phone text, notes text, field_officer_id text, partner_id text, scheduled_date timestamp with time zone, completed_at timestamp with time zone, created_at timestamp with time zone, photo_urls text[], document_urls text[], video_urls text[], _source text, gps_latitude numeric, gps_longitude numeric, location_accuracy_m numeric, review_status text, review_note text)
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
    ir.location_accuracy_m,
    ir.field_evidence_review_status,
    ir.field_evidence_review_note
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
    null::numeric,
    null::text,
    null::text
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
revoke all on function public.get_my_inspections(text) from public,anon;
grant execute on function public.get_my_inspections(text) to authenticated,service_role;
commit;
