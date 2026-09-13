-- Publication keeps a minimum so an empty gallery cannot go live, but there is
-- no arbitrary maximum. Every selected image must still come from the partner
-- submission or the Field Operations visit, and hotel room media stays scoped
-- to its submitted room type.

create or replace function public.admin_set_inspected_public_gallery(
  p_inspection_id uuid,
  p_images text[]
)
returns boolean
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $function$
declare
  v_actor public.profiles;
  v_request public.inspection_requests;
  v_allowed text[];
begin
  select * into v_actor from public.profiles
  where auth_id = auth.uid()::text and role in ('admin', 'creator')
    and not coalesce(deleted, false) and not coalesce(suspended, false)
    and not coalesce(banned, false) limit 1;
  if v_actor is null then raise exception 'Final Admin or Creator review required'; end if;

  select * into v_request from public.inspection_requests where id = p_inspection_id for update;
  if v_request is null then raise exception 'Inspection not found'; end if;
  if v_request.property_type = 'hotel' then raise exception 'Use the hotel and room media review for a hotel'; end if;
  if v_request.lifecycle_stage not in ('listing_prepared', 'live') then
    raise exception 'The listing must be prepared before its public gallery is selected';
  end if;
  if v_actor.role = 'admin' and not public.current_actor_in_scope(v_request.property_state, v_request.property_city) then
    raise exception 'Property is outside your assigned branch';
  end if;

  v_allowed := array(
    select distinct image_url from unnest(
      coalesce(v_request.photo_urls, array[]::text[]) || coalesce(v_request.field_photo_urls, array[]::text[])
    ) image_url where nullif(btrim(image_url), '') is not null
  );
  if cardinality(coalesce(p_images, array[]::text[])) < 1 then raise exception 'Choose at least one submitted property image'; end if;
  if exists (select 1 from unnest(p_images) chosen where nullif(btrim(chosen), '') is null or not (chosen = any(v_allowed))) then
    raise exception 'Public gallery images must come from the Property Partner or Field Operations submission';
  end if;
  if v_request.draft_listing_id is null then raise exception 'Prepared listing not found'; end if;

  update public.listings set images = array(select distinct image_url from unnest(p_images) image_url), updated_at = now()
  where id = v_request.draft_listing_id and deleted_at is null;
  if not found then raise exception 'Prepared listing not found'; end if;

  update public.inspection_requests
  set final_media_reviewed_at = now(), final_media_reviewed_by = v_actor.user_id, updated_at = now()
  where id = v_request.id;
  return true;
end;
$function$;

revoke all on function public.admin_set_inspected_public_gallery(uuid, text[]) from public, anon;
grant execute on function public.admin_set_inspected_public_gallery(uuid, text[]) to authenticated;

create or replace function public.admin_set_inspected_hotel_media(
  p_inspection_id uuid,
  p_hotel_images text[],
  p_room_galleries jsonb
)
returns boolean
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $function$
declare
  v_actor public.profiles;
  v_request public.inspection_requests;
  v_room public.hotel_rooms;
  v_hotel_allowed text[];
  v_room_allowed text[];
  v_chosen text[];
  v_value jsonb;
begin
  select * into v_actor from public.profiles
  where auth_id = auth.uid()::text and role in ('admin', 'creator')
    and not coalesce(deleted, false) and not coalesce(suspended, false)
    and not coalesce(banned, false) limit 1;
  if v_actor is null then raise exception 'Final Admin or Creator review required'; end if;

  select * into v_request from public.inspection_requests where id = p_inspection_id for update;
  if v_request is null or v_request.property_type <> 'hotel' or v_request.draft_hotel_id is null then
    raise exception 'Prepared hotel inspection required';
  end if;
  if v_request.lifecycle_stage not in ('listing_prepared', 'live') then
    raise exception 'The hotel must be prepared before its media is selected';
  end if;
  if v_actor.role = 'admin' and not public.current_actor_in_scope(v_request.property_state, v_request.property_city) then
    raise exception 'Hotel is outside your assigned branch';
  end if;
  if jsonb_typeof(coalesce(p_room_galleries, '{}'::jsonb)) <> 'object' then
    raise exception 'Room galleries must be supplied by room';
  end if;

  v_hotel_allowed := array(
    select distinct image_url from unnest(
      coalesce(v_request.photo_urls, array[]::text[]) || coalesce(v_request.field_photo_urls, array[]::text[])
    ) image_url where nullif(btrim(image_url), '') is not null
  );
  if cardinality(coalesce(p_hotel_images, array[]::text[])) < 1 then raise exception 'Choose at least one hotel or field-visit image'; end if;
  if exists (select 1 from unnest(p_hotel_images) chosen where nullif(btrim(chosen), '') is null or not (chosen = any(v_hotel_allowed))) then
    raise exception 'Hotel gallery images must come from the hotel-level or Field Operations submission';
  end if;

  update public.hotels
  set images = array(select distinct image_url from unnest(p_hotel_images) image_url), updated_at = now()
  where hotel_id = v_request.draft_hotel_id;
  if not found then raise exception 'Prepared hotel not found'; end if;

  for v_room in select * from public.hotel_rooms where hotel_id = v_request.draft_hotel_id order by room_id
  loop
    v_value := p_room_galleries -> v_room.room_id::text;
    if v_value is null or jsonb_typeof(v_value) <> 'array' then
      raise exception 'Choose the final gallery for room type %', v_room.room_type;
    end if;
    select coalesce(array_agg(value), array[]::text[]) into v_chosen from jsonb_array_elements_text(v_value);
    select coalesce(array_agg(distinct media_url), array[]::text[]) into v_room_allowed
    from jsonb_array_elements(coalesce(v_request.hotel_program->'room_types', '[]'::jsonb)) submitted_room
    cross join lateral jsonb_array_elements_text(coalesce(submitted_room->'media', '[]'::jsonb)) media_url
    where lower(btrim(submitted_room->>'name')) = lower(btrim(v_room.room_type));

    if cardinality(v_room_allowed) > 0 and cardinality(v_chosen) < 1 then
      raise exception 'Choose at least one submitted image for room type %', v_room.room_type;
    end if;
    if exists (select 1 from unnest(v_chosen) chosen where nullif(btrim(chosen), '') is null or not (chosen = any(v_room_allowed))) then
      raise exception 'Room images for % must come from that submitted room type', v_room.room_type;
    end if;
    update public.hotel_rooms set images = v_chosen, updated_at = now() where room_id = v_room.room_id;
  end loop;

  update public.inspection_requests
  set final_media_reviewed_at = now(), final_media_reviewed_by = v_actor.user_id, updated_at = now()
  where id = v_request.id;
  return true;
end;
$function$;

revoke all on function public.admin_set_inspected_hotel_media(uuid, text[], jsonb) from public, anon;
grant execute on function public.admin_set_inspected_hotel_media(uuid, text[], jsonb) to authenticated;
