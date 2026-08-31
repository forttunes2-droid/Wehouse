-- Preserve the complete partner hotel submission through operations preparation.

create or replace function public.get_my_property_pipeline_v2(p_stage text default 'all')
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      item || jsonb_build_object(
        'submission_schema_version', ir.submission_schema_version,
        'submission_batch_id', ir.submission_batch_id,
        'hotel_program', coalesce(ir.hotel_program, '{}'::jsonb)
      )
      order by (item->>'created_at')::timestamptz desc
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(public.get_my_property_pipeline(p_stage)) item
  join public.inspection_requests ir on ir.id = (item->>'id')::uuid;
$$;

revoke all on function public.get_my_property_pipeline_v2(text) from public, anon;
grant execute on function public.get_my_property_pipeline_v2(text) to authenticated;

create or replace function public.admin_prepare_hotel_from_submission_v2(
  p_inspection_id uuid,
  p_name text default null,
  p_description text default null,
  p_images text[] default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles;
  v_ir public.inspection_requests;
  v_program jsonb;
  v_rooms jsonb;
  v_room jsonb;
  v_hotel_id integer;
  v_name text;
  v_images text[];
  v_amenities text[];
begin
  select * into v_actor from public.profiles where auth_id = auth.uid()::text limit 1;
  if v_actor is null or v_actor.role not in ('admin', 'creator', 'staff') then
    raise exception 'WeHouse operations access required';
  end if;
  if v_actor.role = 'staff' and not public.current_staff_has_permission('operations') then
    raise exception 'Operations permission required';
  end if;

  select * into v_ir from public.inspection_requests where id = p_inspection_id for update;
  if v_ir is null or v_ir.property_type <> 'hotel' or v_ir.status not in ('completed', 'approved') then
    raise exception 'Completed hotel inspection required';
  end if;
  if v_actor.role in ('admin', 'staff') and
     (v_ir.property_state is distinct from v_actor.assigned_state or v_ir.property_city is distinct from v_actor.assigned_lga) then
    raise exception 'Hotel is outside your assigned branch';
  end if;
  if v_ir.draft_hotel_id is not null then
    raise exception 'A hotel has already been prepared from this inspection';
  end if;

  v_program := coalesce(v_ir.hotel_program, '{}'::jsonb);
  v_rooms := coalesce(v_program->'room_types', '[]'::jsonb);
  v_name := coalesce(nullif(btrim(p_name), ''), nullif(btrim(v_program->>'name'), ''));
  if v_name is null then raise exception 'Hotel name is required'; end if;
  if jsonb_typeof(v_rooms) <> 'array' or jsonb_array_length(v_rooms) = 0 then
    raise exception 'At least one submitted room type is required';
  end if;

  select coalesce(array_agg(value), array[]::text[]) into v_amenities
  from jsonb_array_elements_text(coalesce(v_program->'amenities', '[]'::jsonb));
  v_images := coalesce(p_images, v_ir.photo_urls, array[]::text[]);

  insert into public.hotels(
    name, description, state, city, address, images, amenities, owner_id, status,
    featured, gps_latitude, gps_longitude, inspection_request_id, created_at, updated_at
  ) values (
    v_name, coalesce(nullif(btrim(p_description), ''), nullif(btrim(v_ir.description), '')),
    v_ir.property_state, v_ir.property_city, v_ir.property_address, v_images, v_amenities,
    v_ir.owner_id, 'draft', false, v_ir.gps_latitude, v_ir.gps_longitude, v_ir.id, now(), now()
  ) returning hotel_id into v_hotel_id;

  for v_room in select value from jsonb_array_elements(v_rooms)
  loop
    if nullif(btrim(v_room->>'name'), '') is null or coalesce((v_room->>'nightly_rate')::integer, 0) <= 0 then
      raise exception 'Every room needs a name and valid nightly rate';
    end if;
    insert into public.hotel_rooms(
      hotel_id, room_type, description, price_per_night, max_guests, bed_type,
      images, amenities, total_rooms, created_at, updated_at
    ) values (
      v_hotel_id,
      btrim(v_room->>'name'),
      nullif(btrim(v_room->>'description'), ''),
      (v_room->>'nightly_rate')::integer,
      greatest(coalesce((v_room->>'guest_capacity')::integer, 2), 1),
      nullif(btrim(v_room->>'bed_type'), ''),
      coalesce(array(select jsonb_array_elements_text(coalesce(v_room->'media', '[]'::jsonb))), array[]::text[]),
      coalesce(array(select jsonb_array_elements_text(coalesce(v_room->'amenities', '[]'::jsonb))), array[]::text[]),
      greatest(coalesce((v_room->>'inventory')::integer, 1), 1),
      now(), now()
    );
  end loop;

  update public.inspection_requests set draft_hotel_id = v_hotel_id, updated_at = now() where id = v_ir.id;
  return v_hotel_id;
end;
$$;

revoke all on function public.admin_prepare_hotel_from_submission_v2(uuid, text, text, text[]) from public, anon;
grant execute on function public.admin_prepare_hotel_from_submission_v2(uuid, text, text, text[]) to authenticated;
