-- A property has one public gallery. A hotel has a hotel-level gallery plus a
-- separate gallery for every submitted room type. Final publication review
-- must persist in the database and routine Activity must not grow forever.

alter table public.inspection_requests
  add column if not exists final_media_reviewed_at timestamptz,
  add column if not exists final_media_reviewed_by text;

create or replace function public.get_my_property_pipeline_v2(p_stage text default 'all')
returns jsonb
language sql
security invoker
set search_path = 'pg_catalog', 'public'
as $$
  select coalesce(
    jsonb_agg(
      item || jsonb_build_object(
        'submission_schema_version', ir.submission_schema_version,
        'submission_batch_id', ir.submission_batch_id,
        'hotel_program', coalesce(ir.hotel_program, '{}'::jsonb),
        'lifecycle_stage', ir.lifecycle_stage,
        'final_media_reviewed_at', ir.final_media_reviewed_at,
        'final_media_reviewed_by', ir.final_media_reviewed_by
      ) order by (item->>'created_at')::timestamptz desc
    ), '[]'::jsonb
  )
  from jsonb_array_elements(public.get_my_property_pipeline('all')) item
  join public.inspection_requests ir on ir.id = (item->>'id')::uuid
  where p_stage = 'all'
     or (p_stage = 'new' and ir.lifecycle_stage in ('access_required','access_review','inspection_ready'))
     or (p_stage = 'inspection' and ir.lifecycle_stage = 'inspection')
     or (p_stage = 'ready' and ir.lifecycle_stage = 'visit_reviewed')
     or (p_stage = 'preparing' and ir.lifecycle_stage = 'listing_prepared')
     or (p_stage = 'published' and ir.lifecycle_stage = 'live')
     or (p_stage = 'rejected' and ir.lifecycle_stage in ('changes_requested','rejected'));
$$;

revoke all on function public.get_my_property_pipeline_v2(text) from public, anon;
grant execute on function public.get_my_property_pipeline_v2(text) to authenticated;

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
  if cardinality(p_images) > 24 then raise exception 'A public gallery can contain at most 24 images'; end if;
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
  if cardinality(p_hotel_images) > 24 then raise exception 'A hotel gallery can contain at most 24 images'; end if;
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
    if cardinality(v_chosen) > 12 then raise exception 'A room gallery can contain at most 12 images'; end if;
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

create or replace function public.invalidate_inspection_media_review()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $function$
declare
  v_inspection_id uuid;
begin
  if tg_table_name = 'listings' then
    v_inspection_id := case when tg_op = 'DELETE' then old.inspection_request_id else new.inspection_request_id end;
  elsif tg_table_name = 'hotels' then
    v_inspection_id := case when tg_op = 'DELETE' then old.inspection_request_id else new.inspection_request_id end;
  else
    select inspection_request_id into v_inspection_id from public.hotels
    where hotel_id = case when tg_op = 'DELETE' then old.hotel_id else new.hotel_id end;
  end if;
  if v_inspection_id is not null then
    update public.inspection_requests
    set final_media_reviewed_at = null, final_media_reviewed_by = null, updated_at = now()
    where id = v_inspection_id;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

revoke all on function public.invalidate_inspection_media_review() from public, anon, authenticated;

drop trigger if exists listings_invalidate_media_review on public.listings;
create trigger listings_invalidate_media_review after update of images on public.listings
for each row when (new.images is distinct from old.images) execute function public.invalidate_inspection_media_review();

drop trigger if exists hotels_invalidate_media_review on public.hotels;
create trigger hotels_invalidate_media_review after update of images on public.hotels
for each row when (new.images is distinct from old.images) execute function public.invalidate_inspection_media_review();

drop trigger if exists hotel_rooms_invalidate_media_review on public.hotel_rooms;
create trigger hotel_rooms_invalidate_media_review after insert or update or delete on public.hotel_rooms
for each row execute function public.invalidate_inspection_media_review();

create or replace function public.admin_publish_inspected_hotel(p_hotel_id integer)
returns void
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $function$
declare
  v_actor public.profiles;
  v_h public.hotels;
  v_ir public.inspection_requests;
  v_rooms integer;
begin
  select * into v_actor from public.profiles where auth_id = auth.uid()::text limit 1;
  if v_actor is null or v_actor.role not in ('admin','creator') then raise exception 'Admin or Creator access required'; end if;
  select * into v_h from public.hotels where hotel_id = p_hotel_id for update;
  if v_h is null or v_h.inspection_request_id is null then raise exception 'Inspection-linked hotel required'; end if;
  select * into v_ir from public.inspection_requests where id = v_h.inspection_request_id for update;
  if v_actor.role = 'admin' and not public.current_actor_in_scope(v_ir.property_state, v_ir.property_city) then raise exception 'Hotel is outside your assigned branch'; end if;
  if v_ir.final_media_reviewed_at is null then raise exception 'Confirm the hotel and every room gallery before publication'; end if;
  select count(*) into v_rooms from public.hotel_rooms where hotel_id = p_hotel_id;
  if cardinality(coalesce(v_h.images, array[]::text[])) < 1 or v_rooms < 1 then raise exception 'At least one hotel image and one room type are required before publication'; end if;
  if exists (
    select 1 from public.hotel_rooms hr
    where hr.hotel_id = p_hotel_id
      and exists (
        select 1 from jsonb_array_elements(coalesce(v_ir.hotel_program->'room_types', '[]'::jsonb)) submitted_room
        where lower(btrim(submitted_room->>'name')) = lower(btrim(hr.room_type))
          and jsonb_array_length(coalesce(submitted_room->'media', '[]'::jsonb)) > 0
      )
      and cardinality(coalesce(hr.images, array[]::text[])) < 1
  ) then raise exception 'Every submitted room type needs a confirmed public gallery'; end if;
  update public.hotels set status = 'active', approved_by = v_actor.user_id, approved_at = now(), published_at = now(), updated_at = now() where hotel_id = p_hotel_id;
  update public.inspection_requests set status = 'approved', approved_by = v_actor.user_id, approved_at = now(), published_at = now(), updated_at = now() where id = v_ir.id;
end;
$function$;

create or replace function public.admin_publish_inspected_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $function$
declare
  v_actor public.profiles;
  v_listing public.listings;
  v_ir public.inspection_requests;
begin
  select * into v_actor from public.profiles where auth_id = auth.uid()::text limit 1;
  if v_actor is null or v_actor.role not in ('admin','creator') then raise exception 'Admin or Creator access required'; end if;
  select * into v_listing from public.listings where id = p_listing_id and deleted_at is null for update;
  if v_listing is null or v_listing.inspection_request_id is null then raise exception 'Inspection-linked listing required'; end if;
  select * into v_ir from public.inspection_requests where id = v_listing.inspection_request_id for update;
  if v_ir.status not in ('completed','approved') then raise exception 'Inspection is not complete'; end if;
  if v_actor.role = 'admin' and not public.current_actor_in_scope(v_ir.property_state, v_ir.property_city) then raise exception 'Property is outside your assigned branch'; end if;
  if v_ir.final_media_reviewed_at is null then raise exception 'Confirm the final property gallery before publication'; end if;
  if nullif(btrim(v_listing.title),'') is null or coalesce(v_listing.price,0) <= 0 or cardinality(coalesce(v_listing.images,array[]::text[])) < 1 then
    raise exception 'Title, valid price and at least one image are required before publication';
  end if;
  if coalesce(v_listing.property_type,'apartment') = 'apartment' then
    if v_listing.sub_type not in ('short_let','long_stay') then raise exception 'Apartment must be classified as Short Stay or Long Stay before publication'; end if;
    if v_listing.sub_type = 'short_let' and coalesce(v_listing.security_deposit_amount,0) <= 0 then raise exception 'Short Stay requires a refundable security deposit'; end if;
    if v_listing.sub_type = 'short_let' and not ('Furnished' = any(coalesce(v_listing.amenities,array[]::text[]))) then raise exception 'Short Stay apartment must be furnished'; end if;
  end if;
  update public.listings set status = 'available', availability_status = 'available', approved_by = v_actor.user_id, approved_at = now(), rejection_reason = null, updated_at = now() where id = p_listing_id;
  update public.inspection_requests set status = 'approved', approved_by = v_actor.user_id, approved_at = now(), published_at = now(), updated_at = now() where id = v_ir.id;
end;
$function$;

revoke all on function public.admin_publish_inspected_hotel(integer), public.admin_publish_inspected_listing(uuid) from public, anon;
grant execute on function public.admin_publish_inspected_hotel(integer), public.admin_publish_inspected_listing(uuid) to authenticated;

create or replace function public.require_independent_field_evidence()
returns trigger
language plpgsql
set search_path = 'pg_catalog', 'public'
as $function$
begin
  if new.status in ('completed', 'approved')
     and old.status is distinct from new.status
     and cardinality(coalesce(new.field_photo_urls, array[]::text[])) < 4 then
    raise exception 'At least 4 independent Field Operations photos are required';
  end if;
  return new;
end;
$function$;

revoke all on function public.require_independent_field_evidence() from public, anon, authenticated;
grant execute on function public.require_independent_field_evidence() to service_role;

create or replace function public.get_my_operations_inbox_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = 'pg_catalog', 'public'
as $function$
declare
  v_actor public.profiles;
  v_message_unread bigint := 0;
  v_event_unread bigint := 0;
  v_announcement_unread bigint := 0;
  v_latest_title text;
  v_latest_created_at timestamptz;
begin
  select * into v_actor from public.profiles
  where auth_id = auth.uid()::text
    and not coalesce(deleted, false)
    and not coalesce(suspended, false)
    and not coalesce(banned, false)
  limit 1;
  if v_actor is null or not (
    v_actor.role in ('creator', 'admin')
    or (v_actor.role = 'staff' and public.current_staff_has_permission('operations'))
  ) then raise exception 'Property Operations access required'; end if;

  select coalesce(sum(inbox.unread_count), 0) into v_message_unread
  from public.support_inbox('reservation_operations') inbox;

  select count(*) into v_event_unread
  from public.notifications n
  where n.recipient_id = v_actor.user_id and not n.read
    and n.created_at >= now() - case when n.type ~* '(security|device_login|payment|payout|earning|dispute|refund)' then interval '90 days' else interval '30 days' end
    and not (
      n.type = 'missed_call'
      or (
        n.type !~* '(price|payment|accepted|declined|cancel|complete|scheduled|security|verification|match|invite|reservation|booking|payout|earning|status)'
        and (
          n.type ~* '(^|_)(message|reply|replied|chat)(_|$)'
          or (n.destination_route = 'conversation' and coalesce(n.source_type, '') ~* '(conversation|message|chat)')
        )
      )
    );

  select count(*) into v_announcement_unread
  from public.announcement_recipients ar
  where ar.user_id = v_actor.user_id and not coalesce(ar.read_status, false)
    and ar.delivered_at >= now() - interval '90 days';

  select recent.title, recent.created_at into v_latest_title, v_latest_created_at
  from (
    select n.title, n.created_at
    from public.notifications n
    where n.recipient_id = v_actor.user_id
      and n.created_at >= now() - case when n.type ~* '(security|device_login|payment|payout|earning|dispute|refund)' then interval '90 days' else interval '30 days' end
      and not (
        n.type = 'missed_call'
        or (
          n.type !~* '(price|payment|accepted|declined|cancel|complete|scheduled|security|verification|match|invite|reservation|booking|payout|earning|status)'
          and (
            n.type ~* '(^|_)(message|reply|replied|chat)(_|$)'
            or (n.destination_route = 'conversation' and coalesce(n.source_type, '') ~* '(conversation|message|chat)')
          )
        )
      )
    union all
    select a.title, ar.delivered_at
    from public.announcement_recipients ar
    join public.announcements a on a.id = ar.announcement_id
    where ar.user_id = v_actor.user_id and ar.delivered_at >= now() - interval '90 days'
  ) recent
  order by recent.created_at desc
  limit 1;

  return jsonb_build_object(
    'message_unread', v_message_unread,
    'activity_unread', v_event_unread + v_announcement_unread,
    'latest_title', v_latest_title,
    'latest_created_at', v_latest_created_at
  );
end;
$function$;

revoke all on function public.get_my_operations_inbox_summary() from public, anon;
grant execute on function public.get_my_operations_inbox_summary() to authenticated;

create or replace function public.prune_my_activity()
returns integer
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $function$
declare
  v_recipient text := public.current_profile_user_id();
  v_deleted integer := 0;
begin
  if v_recipient is null then raise exception 'Authenticated profile required'; end if;
  delete from public.notifications
  where recipient_id = v_recipient
    and (
      created_at < now() - interval '90 days'
      or (
        type !~* '(security|device_login|payment|payout|earning|dispute|refund)'
        and (created_at < now() - interval '30 days' or (read and created_at < now() - interval '7 days'))
      )
    );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$;

revoke all on function public.prune_my_activity() from public, anon;
grant execute on function public.prune_my_activity() to authenticated;

create or replace function public.get_my_announcement_inbox()
returns table(id bigint, announcement_id bigint, read_status boolean, delivered_at timestamptz, announcement jsonb)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select ar.id, ar.announcement_id, coalesce(ar.read_status, false), ar.delivered_at,
    jsonb_build_object('id', a.id, 'title', a.title, 'content', a.content, 'sender_id', a.sender_id,
      'sender_role', a.sender_role, 'target_type', a.target_type, 'created_at', a.created_at)
  from public.announcement_recipients ar
  join public.announcements a on a.id = ar.announcement_id
  where ar.user_id = public.current_profile_user_id()
    and ar.delivered_at >= now() - interval '90 days'
  order by ar.delivered_at desc, ar.id desc
  limit 100;
$$;

revoke all on function public.get_my_announcement_inbox() from public, anon;
grant execute on function public.get_my_announcement_inbox() to authenticated, service_role;
