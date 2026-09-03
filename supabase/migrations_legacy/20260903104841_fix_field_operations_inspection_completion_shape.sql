create or replace function public.get_my_inspections(
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
    null::timestamptz,
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

revoke all on function public.get_my_inspections(text)
  from public, anon;
grant execute on function public.get_my_inspections(text)
  to authenticated, service_role;
