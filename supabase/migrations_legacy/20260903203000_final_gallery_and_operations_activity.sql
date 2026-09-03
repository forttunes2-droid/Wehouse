-- Keep publication media traceable to people who actually supplied or captured it,
-- and make Property Operations Activity reflect real lifecycle changes.

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
  select * into v_actor
  from public.profiles
  where auth_id = auth.uid()::text
    and role in ('admin', 'creator')
    and not coalesce(deleted, false)
    and not coalesce(suspended, false)
    and not coalesce(banned, false)
  limit 1;

  if v_actor is null then
    raise exception 'Final Admin or Creator review required';
  end if;

  select * into v_request
  from public.inspection_requests
  where id = p_inspection_id
  for update;

  if v_request is null then raise exception 'Inspection not found'; end if;
  if v_request.lifecycle_stage not in ('listing_prepared', 'live') then
    raise exception 'The listing must be prepared before its public gallery is selected';
  end if;
  if v_actor.role = 'admin' and not public.current_actor_in_scope(v_request.property_state, v_request.property_city) then
    raise exception 'Property is outside your assigned branch';
  end if;

  v_allowed := array(
    select distinct image_url
    from unnest(
      coalesce(v_request.photo_urls, array[]::text[])
      || coalesce(v_request.field_photo_urls, array[]::text[])
    ) image_url
    where nullif(btrim(image_url), '') is not null
  );

  if cardinality(coalesce(p_images, array[]::text[])) < 1 then
    raise exception 'Choose at least one submitted property image';
  end if;
  if cardinality(p_images) > 24 then
    raise exception 'A public gallery can contain at most 24 images';
  end if;
  if exists (
    select 1 from unnest(p_images) chosen
    where nullif(btrim(chosen), '') is null or not (chosen = any(v_allowed))
  ) then
    raise exception 'Public gallery images must come from the Property Partner or Field Operations submission';
  end if;

  if v_request.draft_listing_id is not null then
    update public.listings
    set images = array(select distinct image_url from unnest(p_images) image_url),
        updated_at = now()
    where id = v_request.draft_listing_id and deleted_at is null;
    if not found then raise exception 'Prepared listing not found'; end if;
  elsif v_request.draft_hotel_id is not null then
    update public.hotels
    set images = array(select distinct image_url from unnest(p_images) image_url),
        updated_at = now()
    where hotel_id = v_request.draft_hotel_id;
    if not found then raise exception 'Prepared hotel not found'; end if;
  else
    raise exception 'No prepared property exists for this inspection';
  end if;

  return true;
end;
$function$;

revoke all on function public.admin_set_inspected_public_gallery(uuid, text[]) from public, anon;
grant execute on function public.admin_set_inspected_public_gallery(uuid, text[]) to authenticated;

create or replace function public.notify_property_operations_activity()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $function$
declare
  v_title text;
  v_message text;
  v_recipient text;
begin
  if tg_op = 'UPDATE' and new.lifecycle_stage is not distinct from old.lifecycle_stage then
    return new;
  end if;

  v_title := case new.lifecycle_stage
    when 'access_required' then 'Property access evidence required'
    when 'access_review' then 'Property access evidence ready'
    when 'inspection_ready' then 'Property ready for Field Operations'
    when 'inspection' then 'Field visit in progress'
    when 'visit_reviewed' then 'Field visit submitted'
    when 'listing_prepared' then 'Listing prepared for final review'
    when 'live' then 'Property published'
    when 'changes_requested' then 'Property changes requested'
    when 'rejected' then 'Property submission rejected'
    else 'Property lifecycle updated'
  end;
  v_message := concat_ws(' · ', nullif(new.property_address, ''), nullif(new.request_code, ''), replace(new.lifecycle_stage, '_', ' '));

  for v_recipient in
    select distinct p.user_id
    from public.profiles p
    where not coalesce(p.deleted, false)
      and not coalesce(p.suspended, false)
      and not coalesce(p.banned, false)
      and (
        p.role = 'creator'
        or (p.role = 'admin'
          and lower(btrim(coalesce(p.assigned_state, ''))) = lower(btrim(coalesce(new.property_state, '')))
          and lower(btrim(coalesce(p.assigned_lga, ''))) = lower(btrim(coalesce(new.property_city, ''))))
        or (p.role = 'staff'
          and lower(btrim(coalesce(p.assigned_state, ''))) = lower(btrim(coalesce(new.property_state, '')))
          and lower(btrim(coalesce(p.assigned_lga, ''))) = lower(btrim(coalesce(new.property_city, '')))
          and exists (
            select 1 from public.staff_permissions sp
            where sp.staff_id = p.user_id and sp.permission = 'operations' and sp.is_active
          ))
      )
  loop
    insert into public.notifications(
      recipient_id, type, title, message, read, related_id, source_type, source_id,
      destination_route, destination_params, event_key, created_at
    ) values (
      v_recipient, 'property_' || new.lifecycle_stage, v_title, v_message, false,
      new.id::text, 'inspection_request', new.id::text, 'operations_properties',
      jsonb_build_object('inspection_id', new.id, 'request_code', new.request_code, 'lifecycle_stage', new.lifecycle_stage),
      'operations_property:' || new.id::text || ':' || new.lifecycle_stage, now()
    ) on conflict (recipient_id, event_key) where event_key is not null do nothing;
  end loop;
  return new;
end;
$function$;

revoke all on function public.notify_property_operations_activity() from public, anon, authenticated;

drop trigger if exists inspection_requests_operations_activity on public.inspection_requests;
create trigger inspection_requests_operations_activity
after insert or update of lifecycle_stage on public.inspection_requests
for each row execute function public.notify_property_operations_activity();

create or replace function public.notify_reservation_operations_activity()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $function$
declare
  v_listing public.listings;
  v_title text;
  v_recipient text;
  v_state_key text;
begin
  if tg_op = 'UPDATE'
     and new.status is not distinct from old.status
     and new.rent_payment_status is not distinct from old.rent_payment_status then
    return new;
  end if;

  select * into v_listing from public.listings where id::text = new.listing_id::text;
  if v_listing is null then return new; end if;

  v_title := case
    when new.status = 'ready_for_move_in' then 'Booking ready for handover'
    when new.status = 'occupied' then 'Move-in recorded'
    when new.rent_payment_status in ('paid', 'upfront_paid') then 'Rent payment verified'
    when tg_op = 'INSERT' then 'New property reservation'
    else 'Reservation status updated'
  end;
  v_state_key := coalesce(new.status, 'unknown') || ':' || coalesce(new.rent_payment_status, 'unknown');

  for v_recipient in
    select distinct p.user_id
    from public.profiles p
    where not coalesce(p.deleted, false)
      and not coalesce(p.suspended, false)
      and not coalesce(p.banned, false)
      and (
        p.role = 'creator'
        or (p.role = 'admin'
          and lower(btrim(coalesce(p.assigned_state, ''))) = lower(btrim(coalesce(v_listing.state, '')))
          and lower(btrim(coalesce(p.assigned_lga, ''))) = lower(btrim(coalesce(v_listing.city, ''))))
        or (p.role = 'staff'
          and lower(btrim(coalesce(p.assigned_state, ''))) = lower(btrim(coalesce(v_listing.state, '')))
          and lower(btrim(coalesce(p.assigned_lga, ''))) = lower(btrim(coalesce(v_listing.city, '')))
          and exists (
            select 1 from public.staff_permissions sp
            where sp.staff_id = p.user_id and sp.permission = 'operations' and sp.is_active
          ))
      )
  loop
    insert into public.notifications(
      recipient_id, type, title, message, read, related_id, source_type, source_id,
      destination_route, destination_params, event_key, created_at
    ) values (
      v_recipient, 'reservation_' || coalesce(new.status, 'updated'), v_title,
      concat_ws(' · ', nullif(v_listing.title, ''), nullif(new.booking_code, ''), replace(coalesce(new.status, 'updated'), '_', ' ')),
      false, new.id::text, 'reservation', new.id::text, 'operations_inbox',
      jsonb_build_object('reservation_id', new.id, 'booking_code', new.booking_code, 'status', new.status),
      'operations_reservation:' || new.id::text || ':' || v_state_key, now()
    ) on conflict (recipient_id, event_key) where event_key is not null do nothing;
  end loop;
  return new;
end;
$function$;

revoke all on function public.notify_reservation_operations_activity() from public, anon, authenticated;

drop trigger if exists reservations_operations_activity on public.reservations;
create trigger reservations_operations_activity
after insert or update of status, rent_payment_status on public.reservations
for each row execute function public.notify_reservation_operations_activity();

-- Seed the current lifecycle state so Activity is immediately useful after rollout.
insert into public.notifications(
  recipient_id, type, title, message, read, related_id, source_type, source_id,
  destination_route, destination_params, event_key, created_at
)
select distinct
  p.user_id,
  'property_' || ir.lifecycle_stage,
  case ir.lifecycle_stage
    when 'listing_prepared' then 'Listing prepared for final review'
    when 'live' then 'Property published'
    when 'visit_reviewed' then 'Field visit submitted'
    else 'Property lifecycle updated'
  end,
  concat_ws(' · ', nullif(ir.property_address, ''), nullif(ir.request_code, ''), replace(ir.lifecycle_stage, '_', ' ')),
  false, ir.id::text, 'inspection_request', ir.id::text, 'operations_properties',
  jsonb_build_object('inspection_id', ir.id, 'request_code', ir.request_code, 'lifecycle_stage', ir.lifecycle_stage),
  'operations_property:' || ir.id::text || ':' || ir.lifecycle_stage,
  now()
from public.inspection_requests ir
join public.profiles p on
  not coalesce(p.deleted, false)
  and not coalesce(p.suspended, false)
  and not coalesce(p.banned, false)
  and (
    p.role = 'creator'
    or (p.role = 'admin'
      and lower(btrim(coalesce(p.assigned_state, ''))) = lower(btrim(coalesce(ir.property_state, '')))
      and lower(btrim(coalesce(p.assigned_lga, ''))) = lower(btrim(coalesce(ir.property_city, ''))))
    or (p.role = 'staff'
      and lower(btrim(coalesce(p.assigned_state, ''))) = lower(btrim(coalesce(ir.property_state, '')))
      and lower(btrim(coalesce(p.assigned_lga, ''))) = lower(btrim(coalesce(ir.property_city, '')))
      and exists (
        select 1 from public.staff_permissions sp
        where sp.staff_id = p.user_id and sp.permission = 'operations' and sp.is_active
      ))
  )
where ir.lifecycle_stage is not null
on conflict (recipient_id, event_key) where event_key is not null do nothing;
