-- Preserve scoped, trusted Field Operations access while exposing the submitted home type.
DROP FUNCTION public.get_my_inspections(text);
CREATE OR REPLACE FUNCTION public.get_my_inspections(p_field_officer_id text)
 RETURNS TABLE(id uuid, inspection_code text, property_address text, property_city text, property_state text, property_type text, status text, owner_id text, owner_name text, owner_email text, owner_phone text, notes text, field_officer_id text, partner_id text, scheduled_date timestamp with time zone, completed_at timestamp with time zone, created_at timestamp with time zone, photo_urls text[], document_urls text[], video_urls text[], _source text, gps_latitude numeric, gps_longitude numeric, location_accuracy_m numeric, review_status text, review_note text, space_scope text, space_label text, shared_areas text[], home_style text)
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
     or not public.user_has_active_workspace(v_actor.user_id,'staff')
     or v_actor.user_id <> p_field_officer_id
     or not public.user_has_active_workspace(v_actor.user_id,'field_operations') then
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
    ir.field_evidence_review_note,
    ir.space_scope,ir.space_label,ir.shared_areas,ir.home_style
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
    null::text,
    l.space_scope,l.space_label,l.shared_areas,l.home_style
  from public.user_inspection_requests ur
  left join public.listings l
    on l.listing_id = ur.listing_id
    or l.id::text = ur.listing_id
  left join public.profiles u on u.user_id = ur.user_id
  where ur.field_officer_id = v_actor.user_id
    and ur.user_id<>v_actor.user_id
    and public.user_workspace_covers(v_actor.user_id,'staff',l.state,l.city)
    and public.user_workspace_covers(v_actor.user_id,'field_operations',l.state,l.city)
  order by 17 desc,1;

end;
$function$
;
REVOKE ALL ON FUNCTION public.get_my_inspections(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_inspections(text) TO authenticated;
