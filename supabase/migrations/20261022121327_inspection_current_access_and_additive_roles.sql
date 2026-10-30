begin;
-- Current property access approval and explicit additive Field Operations grants.
CREATE OR REPLACE FUNCTION private.lock_assigned_field_inspection(p_id uuid, p_source text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor public.profiles; target jsonb; assignee text; target_state text; target_city text; owner_id text;
begin
 if not public._property_document_session_active() then raise exception 'Active trusted session required'; end if;
 select * into actor from public.profiles where auth_id=auth.uid()::text
   and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false);
 if actor.user_id is null then raise exception 'Active Field Operations Staff access required'; end if;
 if p_source='partner' then
   select to_jsonb(ir) into target from public.inspection_requests ir where id=p_id for update;
   if target->>'access_evidence_status' is distinct from 'verified' then raise exception 'Current property access approval is required for inspection work'; end if;
   assignee:=coalesce(target->>'assigned_field_officer_id',target->>'field_officer_id',target->>'assigned_to');
   target_state:=target->>'property_state'; target_city:=target->>'property_city'; owner_id:=target->>'owner_id';
 elsif p_source='user' then
   select to_jsonb(ur) into target from public.user_inspection_requests ur where id=p_id for update;
   assignee:=target->>'field_officer_id'; owner_id:=target->>'user_id';
   select l.state,l.city into target_state,target_city from public.listings l
     where l.listing_id=target->>'listing_id' or l.id::text=target->>'listing_id' limit 1;
 else raise exception 'Invalid inspection source';
 end if;
 if target is null or assignee is distinct from actor.user_id or owner_id=actor.user_id
   or not public.user_workspace_covers(actor.user_id,'staff',target_state,target_city)
   or not public.user_workspace_covers(actor.user_id,'field_operations',target_state,target_city)
 then raise exception 'Inspection is not assigned within your active Field Operations coverage'; end if;
 return target;
end $function$;
CREATE OR REPLACE FUNCTION public.field_officer_add_inspection_media(p_inspection_id uuid, p_photo_urls text[] DEFAULT ARRAY[]::text[], p_video_urls text[] DEFAULT ARRAY[]::text[])
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
  v_updated integer := 0;
  target jsonb; source text; path text; photos text[]; videos text[];
begin
  v_actor:=public._current_team_actor();

  if not public.user_has_active_workspace(v_actor.user_id,'staff') or not public.user_has_active_workspace(v_actor.user_id,'field_operations') then
    raise exception 'Active Field Operations access required';
  end if;

  if cardinality(coalesce(p_photo_urls, array[]::text[]))
     + cardinality(coalesce(p_video_urls, array[]::text[])) > 12 then
    raise exception 'A maximum of 12 evidence files is allowed per upload';
  end if;


  source:=case when exists(select 1 from public.inspection_requests where id=p_inspection_id) then 'partner' else 'user' end;
  target:=private.lock_assigned_field_inspection(p_inspection_id,source);
  photos:=array(select jsonb_array_elements_text(coalesce(nullif(target->case when source='partner' then 'field_photo_urls' else 'photo_urls' end,'null'::jsonb),'[]'::jsonb)));
  videos:=array(select jsonb_array_elements_text(coalesce(nullif(target->case when source='partner' then 'field_video_urls' else 'video_urls' end,'null'::jsonb),'[]'::jsonb)));
  -- An exact registration retry is a receipt, never an edit to reviewed evidence.
  if coalesce(p_photo_urls,'{}') <@ photos and coalesce(p_video_urls,'{}') <@ videos then return true; end if;
  if target->>'status' is distinct from 'in_progress' or target->>'published_at' is not null then
    raise exception 'Evidence can only be added to an inspection in progress';
  end if;
  foreach path in array coalesce(p_photo_urls,'{}') loop
    if path is null or path !~ ('^field/'||p_inspection_id::text||'/[A-Za-z0-9_-]+[.](jpg|jpeg|png|webp)$')
      or not exists(select 1 from storage.objects where bucket_id='listing-candidates' and name=path)
    then raise exception 'Upload each photo to this inspection before registering evidence'; end if;
  end loop;
  foreach path in array coalesce(p_video_urls,'{}') loop
    if path is null or path !~ ('^field/'||p_inspection_id::text||'/[A-Za-z0-9_-]+[.](mp4|mov|webm)$')
      or not exists(select 1 from storage.objects where bucket_id='listing-candidates' and name=path)
    then raise exception 'Upload each video to this inspection before registering evidence'; end if;
  end loop;

  update public.inspection_requests
  set field_photo_urls = array(
        select distinct unnest(
          coalesce(field_photo_urls, array[]::text[])
          || coalesce(p_photo_urls, array[]::text[])
        )
      ),
      field_video_urls = array(
        select distinct unnest(
          coalesce(field_video_urls, array[]::text[])
          || coalesce(p_video_urls, array[]::text[])
        )
      ),
      updated_at = now()
  where id = p_inspection_id
    and coalesce(assigned_field_officer_id, field_officer_id, assigned_to) = v_actor.user_id;
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    update public.user_inspection_requests
    set photo_urls = array(
          select distinct unnest(
            coalesce(photo_urls, array[]::text[])
            || coalesce(p_photo_urls, array[]::text[])
          )
        ),
        video_urls = array(
          select distinct unnest(
            coalesce(video_urls, array[]::text[])
            || coalesce(p_video_urls, array[]::text[])
          )
        ),
        updated_at = now()
    where id = p_inspection_id
      and field_officer_id = v_actor.user_id;
    get diagnostics v_updated = row_count;
  end if;

  if v_updated = 0 then
    raise exception 'Inspection is not assigned to this Field Operations account';
  end if;

  return true;
end;
$function$;
CREATE OR REPLACE FUNCTION public.field_officer_update_inspection_location(p_inspection_id uuid, p_latitude numeric, p_longitude numeric, p_accuracy_m numeric DEFAULT NULL::numeric)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_actor public.profiles; v_ir public.inspection_requests;
BEGIN
  v_actor:=public._current_team_actor();
  IF v_actor.user_id IS NULL OR NOT public.user_has_active_workspace(v_actor.user_id,'staff') OR NOT public.user_has_active_workspace(v_actor.user_id,'field_operations') THEN
    RAISE EXCEPTION 'Active Field Operations Staff access required';
  END IF;
  IF p_latitude IS NULL OR p_longitude IS NULL OR p_latitude::text in ('NaN','Infinity','-Infinity') OR p_longitude::text in ('NaN','Infinity','-Infinity') OR p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180 THEN RAISE EXCEPTION 'Invalid coordinates'; END IF;
  IF p_accuracy_m IS NOT NULL AND (p_accuracy_m<0 OR p_accuracy_m::text in ('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'Invalid location accuracy'; END IF;

  PERFORM private.lock_assigned_field_inspection(p_inspection_id,'partner');
  SELECT * INTO v_ir FROM public.inspection_requests WHERE id=p_inspection_id FOR UPDATE;
  IF v_ir.id IS NULL THEN RAISE EXCEPTION 'Property inspection not found'; END IF;
  IF COALESCE(v_ir.assigned_field_officer_id,v_ir.field_officer_id,v_ir.assigned_to) IS DISTINCT FROM v_actor.user_id THEN
    RAISE EXCEPTION 'This inspection is not assigned to you';
  END IF;
  IF v_ir.published_at IS NOT NULL THEN RAISE EXCEPTION 'Published property location must be corrected by Property Operations'; END IF;

  IF v_ir.gps_latitude IS NOT DISTINCT FROM p_latitude AND v_ir.gps_longitude IS NOT DISTINCT FROM p_longitude AND v_ir.location_accuracy_m IS NOT DISTINCT FROM p_accuracy_m THEN RETURN true; END IF;
  IF v_ir.status IS DISTINCT FROM 'in_progress' THEN RAISE EXCEPTION 'Location can only be changed during an inspection in progress'; END IF;
  UPDATE public.inspection_requests
  SET gps_latitude=p_latitude,gps_longitude=p_longitude,location_accuracy_m=p_accuracy_m,updated_at=NOW()
  WHERE id=p_inspection_id;

  IF v_ir.draft_listing_id IS NOT NULL THEN
    UPDATE public.listings
    SET gps_latitude=p_latitude,gps_longitude=p_longitude,updated_at=NOW()
    WHERE id=v_ir.draft_listing_id AND deleted_at IS NULL;
  END IF;
  RETURN true;
END $function$;
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
$function$;
commit;
