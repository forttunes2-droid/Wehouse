alter table public.inspection_requests
  add column if not exists field_photo_urls text[] not null default array[]::text[],
  add column if not exists field_video_urls text[] not null default array[]::text[];

comment on column public.inspection_requests.field_photo_urls is
  'Independent photos submitted by Field Operations during the assigned visit.';
comment on column public.inspection_requests.field_video_urls is
  'Independent videos submitted by Field Operations during the assigned visit.';

create or replace function public.field_officer_add_inspection_media(
  p_inspection_id uuid,
  p_photo_urls text[] default array[]::text[],
  p_video_urls text[] default array[]::text[]
)
returns boolean
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $function$
declare
  v_actor public.profiles;
  v_updated integer := 0;
begin
  select *
  into v_actor
  from public.profiles
  where auth_id = auth.uid()::text
    and role = 'staff'
    and not coalesce(deleted, false)
    and not coalesce(suspended, false)
    and not coalesce(banned, false)
    and exists (
      select 1
      from public.staff_permissions sp
      where sp.staff_id = profiles.user_id
        and sp.permission = 'field_officer'
        and sp.is_active
    )
  limit 1;

  if v_actor is null then
    raise exception 'Active Field Operations access required';
  end if;

  if cardinality(coalesce(p_photo_urls, array[]::text[]))
     + cardinality(coalesce(p_video_urls, array[]::text[])) > 12 then
    raise exception 'A maximum of 12 evidence files is allowed per upload';
  end if;

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

create or replace function public.get_inspection_media_for_review(
  p_inspection_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $function$
declare
  v_actor public.profiles;
  v_request public.inspection_requests;
begin
  select *
  into v_actor
  from public.profiles
  where auth_id = auth.uid()::text
    and role in ('creator', 'admin', 'staff')
    and not coalesce(deleted, false)
    and not coalesce(suspended, false)
    and not coalesce(banned, false)
  limit 1;

  if v_actor is null then
    raise exception 'Operations review access required';
  end if;

  if v_actor.role = 'staff' and not exists (
    select 1
    from public.staff_permissions sp
    where sp.staff_id = v_actor.user_id
      and sp.permission = 'operations'
      and sp.is_active
  ) then
    raise exception 'Property Operations access required';
  end if;

  select *
  into v_request
  from public.inspection_requests
  where id = p_inspection_id;

  if v_request is null then
    raise exception 'Inspection not found';
  end if;

  if v_actor.role <> 'creator'
     and not public.current_actor_in_scope(
       v_request.property_state,
       v_request.property_city
     ) then
    raise exception 'Inspection is outside your assigned branch';
  end if;

  return jsonb_build_object(
    'photos', coalesce(to_jsonb(v_request.field_photo_urls), '[]'::jsonb),
    'videos', coalesce(to_jsonb(v_request.field_video_urls), '[]'::jsonb),
    'report', v_request.notes,
    'status', v_request.status
  );
end;
$function$;

drop function public.get_my_inspections(text);

create function public.get_my_inspections(
  p_field_officer_id text
)
returns table(
  id uuid,
  inspection_code text,
  property_address text,
  property_city text,
  property_state text,
  property_type text,
  status text,
  owner_id text,
  owner_name text,
  owner_email text,
  owner_phone text,
  notes text,
  field_officer_id text,
  partner_id text,
  scheduled_date timestamptz,
  completed_at timestamptz,
  created_at timestamptz,
  photo_urls text[],
  document_urls text[],
  video_urls text[],
  _source text,
  gps_latitude numeric,
  gps_longitude numeric,
  location_accuracy_m numeric
)
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $function$
declare
  v_actor public.profiles;
begin
  select *
  into v_actor
  from public.profiles
  where auth_id = auth.uid()::text
  limit 1;

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
    ur.notes,
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
  order by created_at desc;
end;
$function$;

revoke all on function public.field_officer_add_inspection_media(uuid, text[], text[])
  from public, anon;
grant execute on function public.field_officer_add_inspection_media(uuid, text[], text[])
  to authenticated, service_role;

revoke all on function public.get_inspection_media_for_review(uuid)
  from public, anon;
grant execute on function public.get_inspection_media_for_review(uuid)
  to authenticated, service_role;

revoke all on function public.get_my_inspections(text)
  from public, anon;
grant execute on function public.get_my_inspections(text)
  to authenticated, service_role;
