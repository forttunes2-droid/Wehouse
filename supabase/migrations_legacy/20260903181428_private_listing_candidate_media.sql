-- Submitted Partner and Field Operations media is review material, not public
-- listing media. Keep new candidates private and copy only the exact final
-- Admin/Creator selection into the existing public listing-images bucket.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'listing-candidates',
  'listing-candidates',
  false,
  52428800,
  array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists listing_candidates_insert_source on storage.objects;
create policy listing_candidates_insert_source
on storage.objects for insert to authenticated
with check (
  bucket_id = 'listing-candidates'
  and exists (
    select 1 from public.profiles actor
    where actor.auth_id = auth.uid()::text
      and not coalesce(actor.deleted,false)
      and not coalesce(actor.suspended,false)
      and not coalesce(actor.banned,false)
      and (
        (
          actor.role = 'property_partner'
          and (storage.foldername(name))[1] = 'partner'
          and (storage.foldername(name))[2] = actor.user_id
        )
        or (
          actor.role = 'staff'
          and public.current_staff_has_permission('field_officer')
          and (storage.foldername(name))[1] = 'field'
          and exists (
            select 1 from public.inspection_requests request
            where request.id::text = (storage.foldername(name))[2]
              and coalesce(request.assigned_field_officer_id,request.field_officer_id,request.assigned_to) = actor.user_id
              and request.lifecycle_stage = 'inspection'
              and request.status in ('scheduled','in_progress')
          )
        )
      )
  )
);

drop policy if exists listing_candidates_read_authorized on storage.objects;
create policy listing_candidates_read_authorized
on storage.objects for select to authenticated
using (
  bucket_id = 'listing-candidates'
  and exists (
    select 1 from public.profiles actor
    where actor.auth_id = auth.uid()::text
      and not coalesce(actor.deleted,false)
      and not coalesce(actor.suspended,false)
      and not coalesce(actor.banned,false)
      and (
        actor.role = 'creator'
        or owner_id = auth.uid()::text
        or exists (
          select 1
          from public.inspection_requests request
          where (
            name = any(coalesce(request.photo_urls,array[]::text[]))
            or name = any(coalesce(request.field_photo_urls,array[]::text[]))
            or name = any(coalesce(request.field_video_urls,array[]::text[]))
            or exists (
              select 1
              from jsonb_array_elements(coalesce(request.hotel_program->'room_types','[]'::jsonb)) room
              cross join lateral jsonb_array_elements_text(coalesce(room->'media','[]'::jsonb)) media(value)
              where media.value = name
            )
          )
          and (
            (actor.role = 'admin' and public.current_actor_in_scope(request.property_state,request.property_city))
            or (
              actor.role = 'staff'
              and (
                (public.current_staff_has_permission('operations') and public.current_actor_in_scope(request.property_state,request.property_city))
                or (
                  public.current_staff_has_permission('field_officer')
                  and coalesce(request.assigned_field_officer_id,request.field_officer_id,request.assigned_to) = actor.user_id
                )
              )
            )
          )
        )
      )
  )
);

drop policy if exists listing_candidates_delete_unsubmitted on storage.objects;
create policy listing_candidates_delete_unsubmitted
on storage.objects for delete to authenticated
using (
  bucket_id = 'listing-candidates'
  and (
    public.current_profile_role() = 'creator'
    or (
      owner_id = auth.uid()::text
      and not exists (
        select 1 from public.inspection_requests request
        where name = any(coalesce(request.photo_urls,array[]::text[]))
           or name = any(coalesce(request.field_photo_urls,array[]::text[]))
           or name = any(coalesce(request.field_video_urls,array[]::text[]))
           or exists (
             select 1
             from jsonb_array_elements(coalesce(request.hotel_program->'room_types','[]'::jsonb)) room
             cross join lateral jsonb_array_elements_text(coalesce(room->'media','[]'::jsonb)) media(value)
             where media.value = name
           )
      )
    )
  )
);

alter table public.inspection_requests
  add column if not exists final_media_sources text[],
  add column if not exists final_hotel_media_sources text[],
  add column if not exists final_room_media_sources jsonb;

create or replace function public.post_property_from_inspection_v2(p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = 'pg_catalog','public'
as $function$
begin
  return public.post_property_from_inspection(
    coalesce(p_data,'{}'::jsonb) || jsonb_build_object('images','[]'::jsonb,'videos','[]'::jsonb)
  );
end;
$function$;

revoke all on function public.post_property_from_inspection_v2(jsonb) from public,anon;
grant execute on function public.post_property_from_inspection_v2(jsonb) to authenticated;

create or replace function public.admin_prepare_hotel_from_submission_v3(
  p_inspection_id uuid,
  p_name text default null,
  p_description text default null
)
returns integer
language plpgsql
security definer
set search_path = 'pg_catalog','public'
as $function$
declare v_hotel_id integer;
begin
  v_hotel_id := public.admin_prepare_hotel_from_submission_v2(p_inspection_id,p_name,p_description,array[]::text[]);
  update public.hotels set images=array[]::text[] where hotel_id=v_hotel_id;
  update public.hotel_rooms set images=array[]::text[] where hotel_id=v_hotel_id;
  return v_hotel_id;
end;
$function$;

revoke all on function public.admin_prepare_hotel_from_submission_v3(uuid,text,text) from public,anon;
grant execute on function public.admin_prepare_hotel_from_submission_v3(uuid,text,text) to authenticated;

update public.inspection_requests request
set final_media_sources = (
  select coalesce(array_agg(image_url order by position),array[]::text[])
  from unnest(coalesce(listing.images,array[]::text[])) with ordinality selected(image_url,position)
  where image_url = any(coalesce(request.photo_urls,array[]::text[]) || coalesce(request.field_photo_urls,array[]::text[]))
)
from public.listings listing
where listing.id = request.draft_listing_id
  and request.final_media_reviewed_at is not null
  and request.property_type <> 'hotel'
  and request.final_media_sources is null;

create or replace function public.is_valid_inspection_public_image(
  p_inspection_id uuid,
  p_public_url text
)
returns boolean
language sql
stable
security definer
set search_path = 'pg_catalog','public','storage'
as $function$
  select position('/storage/v1/object/public/listing-images/' in coalesce(p_public_url,'')) > 0
     and exists (
       select 1 from storage.objects object
       where object.bucket_id = 'listing-images'
         and object.name = split_part(p_public_url,'/storage/v1/object/public/listing-images/',2)
         and (storage.foldername(object.name))[1] = 'listings'
         and (storage.foldername(object.name))[2] = 'final-' || p_inspection_id::text
     );
$function$;

revoke all on function public.is_valid_inspection_public_image(uuid,text) from public,anon,authenticated;

create or replace function public.admin_set_inspected_public_gallery_v2(
  p_inspection_id uuid,
  p_source_images text[],
  p_public_images text[]
)
returns boolean
language plpgsql
security definer
set search_path = 'pg_catalog','public'
as $function$
declare
  v_actor public.profiles;
  v_request public.inspection_requests;
  v_allowed text[];
  v_index integer;
begin
  select * into v_actor from public.profiles
  where auth_id=auth.uid()::text and role in ('admin','creator')
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)
  limit 1;
  if v_actor is null then raise exception 'Final Admin or Creator review required'; end if;

  select * into v_request from public.inspection_requests where id=p_inspection_id for update;
  if v_request is null then raise exception 'Inspection not found'; end if;
  if v_request.property_type='hotel' then raise exception 'Use the hotel and room media review for a hotel'; end if;
  if v_request.lifecycle_stage not in ('listing_prepared','live') then raise exception 'The listing must be prepared before its public gallery is selected'; end if;
  if v_actor.role='admin' and not public.current_actor_in_scope(v_request.property_state,v_request.property_city) then raise exception 'Property is outside your assigned branch'; end if;
  if v_request.draft_listing_id is null then raise exception 'Prepared listing not found'; end if;

  v_allowed := array(
    select distinct image_url from unnest(coalesce(v_request.photo_urls,array[]::text[]) || coalesce(v_request.field_photo_urls,array[]::text[])) image_url
    where nullif(btrim(image_url),'') is not null
  );
  if cardinality(coalesce(p_source_images,array[]::text[])) < 1 then raise exception 'Choose at least one submitted property image'; end if;
  if cardinality(p_source_images) <> cardinality(coalesce(p_public_images,array[]::text[])) then raise exception 'Every selected source image needs one public copy'; end if;
  if exists(select 1 from unnest(p_source_images) source where nullif(btrim(source),'') is null or not(source=any(v_allowed))) then raise exception 'Public gallery images must come from the Property Partner or Field Operations submission'; end if;

  for v_index in 1..cardinality(p_source_images) loop
    if p_source_images[v_index] ~* '^https?://' then
      if p_public_images[v_index] is distinct from p_source_images[v_index] then raise exception 'Legacy public source mapping is invalid'; end if;
    elsif not public.is_valid_inspection_public_image(p_inspection_id,p_public_images[v_index]) then
      raise exception 'A selected private image was not copied into this inspection public gallery';
    end if;
  end loop;

  update public.listings set images=array(select distinct image_url from unnest(p_public_images) image_url),updated_at=now()
  where id=v_request.draft_listing_id and deleted_at is null;
  if not found then raise exception 'Prepared listing not found'; end if;
  update public.inspection_requests set final_media_sources=array(select distinct source from unnest(p_source_images) source),final_media_reviewed_at=now(),final_media_reviewed_by=v_actor.user_id,updated_at=now() where id=v_request.id;
  return true;
end;
$function$;

revoke all on function public.admin_set_inspected_public_gallery_v2(uuid,text[],text[]) from public,anon;
grant execute on function public.admin_set_inspected_public_gallery_v2(uuid,text[],text[]) to authenticated;

create or replace function public.admin_set_inspected_hotel_media_v2(
  p_inspection_id uuid,
  p_hotel_source_images text[],
  p_hotel_public_images text[],
  p_room_source_galleries jsonb,
  p_room_public_galleries jsonb
)
returns boolean
language plpgsql
security definer
set search_path = 'pg_catalog','public'
as $function$
declare
  v_actor public.profiles;
  v_request public.inspection_requests;
  v_room public.hotel_rooms;
  v_allowed text[];
  v_sources text[];
  v_public text[];
  v_value jsonb;
  v_index integer;
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text and role in ('admin','creator')
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor is null then raise exception 'Final Admin or Creator review required'; end if;
  select * into v_request from public.inspection_requests where id=p_inspection_id for update;
  if v_request is null or v_request.property_type<>'hotel' or v_request.draft_hotel_id is null then raise exception 'Prepared hotel inspection required'; end if;
  if v_request.lifecycle_stage not in ('listing_prepared','live') then raise exception 'The hotel must be prepared before its media is selected'; end if;
  if v_actor.role='admin' and not public.current_actor_in_scope(v_request.property_state,v_request.property_city) then raise exception 'Hotel is outside your assigned branch'; end if;
  if jsonb_typeof(coalesce(p_room_source_galleries,'{}'::jsonb))<>'object' or jsonb_typeof(coalesce(p_room_public_galleries,'{}'::jsonb))<>'object' then raise exception 'Room galleries must be supplied by room'; end if;

  v_allowed := array(select distinct image_url from unnest(coalesce(v_request.photo_urls,array[]::text[]) || coalesce(v_request.field_photo_urls,array[]::text[])) image_url where nullif(btrim(image_url),'') is not null);
  if cardinality(coalesce(p_hotel_source_images,array[]::text[]))<1 then raise exception 'Choose at least one hotel or field-visit image'; end if;
  if cardinality(p_hotel_source_images)<>cardinality(coalesce(p_hotel_public_images,array[]::text[])) then raise exception 'Every selected hotel image needs one public copy'; end if;
  if exists(select 1 from unnest(p_hotel_source_images) source where nullif(btrim(source),'') is null or not(source=any(v_allowed))) then raise exception 'Hotel gallery images must come from the hotel-level or Field Operations submission'; end if;
  for v_index in 1..cardinality(p_hotel_source_images) loop
    if p_hotel_source_images[v_index] ~* '^https?://' then
      if p_hotel_public_images[v_index] is distinct from p_hotel_source_images[v_index] then raise exception 'Legacy public hotel source mapping is invalid'; end if;
    elsif not public.is_valid_inspection_public_image(p_inspection_id,p_hotel_public_images[v_index]) then raise exception 'A selected private hotel image was not copied into this inspection public gallery'; end if;
  end loop;

  update public.hotels set images=array(select distinct image_url from unnest(p_hotel_public_images) image_url),updated_at=now() where hotel_id=v_request.draft_hotel_id;
  if not found then raise exception 'Prepared hotel not found'; end if;

  for v_room in select * from public.hotel_rooms where hotel_id=v_request.draft_hotel_id order by room_id loop
    v_value:=p_room_source_galleries->v_room.room_id::text;
    if v_value is null or jsonb_typeof(v_value)<>'array' then raise exception 'Choose the final gallery for room type %',v_room.room_type; end if;
    select coalesce(array_agg(value),array[]::text[]) into v_sources from jsonb_array_elements_text(v_value);
    v_value:=p_room_public_galleries->v_room.room_id::text;
    if v_value is null or jsonb_typeof(v_value)<>'array' then raise exception 'Public room gallery is missing for room type %',v_room.room_type; end if;
    select coalesce(array_agg(value),array[]::text[]) into v_public from jsonb_array_elements_text(v_value);
    select coalesce(array_agg(distinct media_url),array[]::text[]) into v_allowed
      from jsonb_array_elements(coalesce(v_request.hotel_program->'room_types','[]'::jsonb)) submitted_room
      cross join lateral jsonb_array_elements_text(coalesce(submitted_room->'media','[]'::jsonb)) media_url
      where lower(btrim(submitted_room->>'name'))=lower(btrim(v_room.room_type));
    if cardinality(v_allowed)>0 and cardinality(v_sources)<1 then raise exception 'Choose at least one submitted image for room type %',v_room.room_type; end if;
    if cardinality(v_sources)<>cardinality(v_public) then raise exception 'Every selected room image needs one public copy for %',v_room.room_type; end if;
    if exists(select 1 from unnest(v_sources) source where nullif(btrim(source),'') is null or not(source=any(v_allowed))) then raise exception 'Room images for % must come from that submitted room type',v_room.room_type; end if;
    if cardinality(v_sources)>0 then
      for v_index in 1..cardinality(v_sources) loop
        if v_sources[v_index] ~* '^https?://' then
          if v_public[v_index] is distinct from v_sources[v_index] then raise exception 'Legacy public room source mapping is invalid'; end if;
        elsif not public.is_valid_inspection_public_image(p_inspection_id,v_public[v_index]) then raise exception 'A selected private room image was not copied into this inspection public gallery'; end if;
      end loop;
    end if;
    update public.hotel_rooms set images=v_public,updated_at=now() where room_id=v_room.room_id;
  end loop;

  update public.inspection_requests set final_hotel_media_sources=array(select distinct source from unnest(p_hotel_source_images) source),final_room_media_sources=p_room_source_galleries,final_media_reviewed_at=now(),final_media_reviewed_by=v_actor.user_id,updated_at=now() where id=v_request.id;
  return true;
end;
$function$;

revoke all on function public.admin_set_inspected_hotel_media_v2(uuid,text[],text[],jsonb,jsonb) from public,anon;
grant execute on function public.admin_set_inspected_hotel_media_v2(uuid,text[],text[],jsonb,jsonb) to authenticated;

create or replace function public.get_my_property_pipeline_v2(p_stage text default 'all')
returns jsonb
language sql
set search_path = 'pg_catalog','public'
as $function$
  select coalesce(jsonb_agg(
    item || jsonb_build_object(
      'submission_schema_version',ir.submission_schema_version,
      'submission_batch_id',ir.submission_batch_id,
      'hotel_program',coalesce(ir.hotel_program,'{}'::jsonb),
      'lifecycle_stage',ir.lifecycle_stage,
      'final_media_reviewed_at',ir.final_media_reviewed_at,
      'final_media_reviewed_by',ir.final_media_reviewed_by,
      'final_media_sources',ir.final_media_sources,
      'final_hotel_media_sources',ir.final_hotel_media_sources,
      'final_room_media_sources',ir.final_room_media_sources
    ) order by (item->>'created_at')::timestamptz desc
  ),'[]'::jsonb)
  from jsonb_array_elements(public.get_my_property_pipeline('all')) item
  join public.inspection_requests ir on ir.id=(item->>'id')::uuid
  where p_stage='all'
     or (p_stage='new' and ir.lifecycle_stage in ('access_required','access_review','inspection_ready'))
     or (p_stage='inspection' and ir.lifecycle_stage='inspection')
     or (p_stage='ready' and ir.lifecycle_stage='visit_reviewed')
     or (p_stage='preparing' and ir.lifecycle_stage='listing_prepared')
     or (p_stage='published' and ir.lifecycle_stage='live')
     or (p_stage='rejected' and ir.lifecycle_stage in ('changes_requested','rejected'));
$function$;
