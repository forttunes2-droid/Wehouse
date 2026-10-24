-- Preserve trusted assignment/Staff/geographic checks; expose the physical space actually being reviewed.
drop function public.get_my_inspections(text);
CREATE OR REPLACE FUNCTION public.get_my_inspections(p_field_officer_id text)
 RETURNS TABLE(id uuid, inspection_code text, property_address text, property_city text, property_state text, property_type text, status text, owner_id text, owner_name text, owner_email text, owner_phone text, notes text, field_officer_id text, partner_id text, scheduled_date timestamp with time zone, completed_at timestamp with time zone, created_at timestamp with time zone, photo_urls text[], document_urls text[], video_urls text[], _source text, gps_latitude numeric, gps_longitude numeric, location_accuracy_m numeric, review_status text, review_note text, space_scope text, space_label text, shared_areas text[])
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
    ir.space_scope,ir.space_label,ir.shared_areas
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
    l.space_scope,l.space_label,l.shared_areas
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
$function$;
revoke all on function public.get_my_inspections(text) from public,anon,service_role;
grant execute on function public.get_my_inspections(text) to authenticated;

CREATE OR REPLACE FUNCTION public.get_my_property_pipeline_v2(p_stage text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select coalesce(jsonb_agg(
    (item-'gps_latitude'-'gps_longitude'-'location_accuracy_m'-'latitude'-'longitude'-'accuracy') || jsonb_build_object(
      'property_display_name',ir.property_display_name,
      'space_scope',ir.space_scope,'space_label',ir.space_label,'shared_areas',ir.shared_areas,'submission_schema_version',ir.submission_schema_version,
      'submission_batch_id',ir.submission_batch_id,'hotel_program',coalesce(ir.hotel_program,'{}'::jsonb),
      'lifecycle_stage',case when ir.lifecycle_stage='live' and (item->'listing'->>'status'='pending_approval' or item->'hotel'->>'status'='inactive') then 'listing_prepared' else ir.lifecycle_stage end,'field_evidence_review_status',ir.field_evidence_review_status,
      'field_evidence_reviewed_by',ir.field_evidence_reviewed_by,'field_evidence_reviewed_at',ir.field_evidence_reviewed_at,
      'field_evidence_review_note',ir.field_evidence_review_note,'final_media_reviewed_at',ir.final_media_reviewed_at,
      'final_media_reviewed_by',ir.final_media_reviewed_by,'final_media_sources',ir.final_media_sources,
      'final_hotel_media_sources',ir.final_hotel_media_sources,'final_room_media_sources',ir.final_room_media_sources,
      'document_requirements_configured',ir.document_requirements is not null,
      'document_review_pending',(
        select count(*) from (
          select distinct on(requirement_code) status from public.property_submission_documents
          where request_id=ir.id and requirements_revision=ir.document_requirements_revision and status<>'abandoned'
          order by requirement_code,version desc
        ) latest where status='submitted'
      )
    ) order by (item->>'created_at')::timestamptz desc
  ),'[]'::jsonb)
  from jsonb_array_elements(public.get_my_property_pipeline('all')) item
  join public.inspection_requests ir on ir.id=(item->>'id')::uuid
  where p_stage='all'
    or(p_stage='new' and ir.lifecycle_stage in('access_required','access_review','inspection_ready'))
    or(p_stage='inspection' and ir.lifecycle_stage='inspection')
    or(p_stage='review' and ir.lifecycle_stage='awaiting_review')
    or(p_stage='ready' and ir.lifecycle_stage='ready_to_prepare')
    or(p_stage='preparing' and (case when ir.lifecycle_stage='live' and (item->'listing'->>'status'='pending_approval' or item->'hotel'->>'status'='inactive') then 'listing_prepared' else ir.lifecycle_stage end)='listing_prepared')
    or(p_stage='published' and (case when ir.lifecycle_stage='live' and (item->'listing'->>'status'='pending_approval' or item->'hotel'->>'status'='inactive') then 'listing_prepared' else ir.lifecycle_stage end)='live')
    or(p_stage='rejected' and ir.lifecycle_stage in('changes_requested','rejected'));
$function$;

