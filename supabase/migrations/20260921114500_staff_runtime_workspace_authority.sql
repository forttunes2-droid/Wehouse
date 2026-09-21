-- Replace legacy profile.role actor reads in current Staff work entry points.
-- The synthesized role/scope below is derived only from active workspace grants.

begin;

create or replace function public._current_team_actor()
returns public.profiles
language plpgsql
stable security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_grant public.workspace_role_assignments;
begin
  select * into v_actor
  from public.profiles p
  where p.auth_id=(select auth.uid())::text
    and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
  limit 1;
  if v_actor.user_id is null then
    raise exception 'Active WeHouse Team account required';
  end if;

  if public.user_has_active_workspace(v_actor.user_id,'creator') then
    v_actor.role:='creator';
    v_actor.assigned_state:=null;
    v_actor.assigned_lga:=null;
    return v_actor;
  end if;

  if public.user_has_active_workspace(v_actor.user_id,'admin') then
    select * into v_grant
    from public.workspace_role_assignments
    where user_id=v_actor.user_id and workspace_role='admin'
      and status='active' and revoked_at is null
    limit 1;
    v_actor.role:='admin';
    v_actor.assigned_state:=v_grant.scope_state;
    v_actor.assigned_lga:=case when v_grant.scope_type='branch' then v_grant.scope_lga else null end;
    return v_actor;
  end if;

  if public.user_has_active_workspace(v_actor.user_id,'staff') then
    select * into v_grant
    from public.workspace_role_assignments
    where user_id=v_actor.user_id and workspace_role='staff'
      and status='active' and revoked_at is null
    limit 1;
    v_actor.role:='staff';
    v_actor.assigned_state:=v_grant.scope_state;
    v_actor.assigned_lga:=case when v_grant.scope_type='branch' then v_grant.scope_lga else null end;
    return v_actor;
  end if;

  raise exception 'Active WeHouse Team account required';
end
$$;

create or replace function public.user_workspace_covers(
  p_user_id text,
  p_workspace text,
  p_state text,
  p_lga text
)
returns boolean
language sql
stable security definer
set search_path to 'pg_catalog','public'
as $$
  select exists(
    select 1
    from public.workspace_role_assignments w
    join public.profiles p on p.user_id=w.user_id
    where w.user_id=p_user_id
      and w.workspace_role=p_workspace
      and w.status='active'
      and w.revoked_at is null
      and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false)
      and not coalesce(p.banned,false)
      and (
        w.scope_type='global'
        or (
          w.scope_type in('state','branch')
          and public.wehouse_state_key(w.scope_state)=public.wehouse_state_key(p_state)
          and (
            w.scope_type='state'
            or lower(btrim(coalesce(w.scope_lga,'')))=lower(btrim(coalesce(p_lga,'')))
          )
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.admin_assign_field_officer(p_inspection_id uuid, p_field_officer_id text, p_scheduled_date date DEFAULT NULL::date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor public.profiles; v_ir public.inspection_requests; v_officer public.profiles;
begin
  v_actor:=public._current_team_actor();
  if v_actor.user_id is null or (v_actor.role='staff'
    and not public.current_staff_has_permission('property_operations')) then
    raise exception 'Property Operations, Admin or Creator access required';
  end if;
  select * into v_ir from public.inspection_requests where id=p_inspection_id for update;
  if v_ir.id is null then raise exception 'Inspection request not found'; end if;
  if v_ir.access_evidence_status<>'verified' then
    raise exception 'Access evidence must be approved before assigning Field Operations';
  end if;
  if v_actor.role<>'creator'
     and not public.current_actor_in_scope(v_ir.property_state,v_ir.property_city) then
    raise exception 'Inspection is outside your assigned State';
  end if;
  select * into v_officer from public.profiles
  where user_id=p_field_officer_id and role='staff'
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false);
  if v_officer.user_id is null
    or public.wehouse_state_key(v_officer.assigned_state)
      <>public.wehouse_state_key(v_ir.property_state)
    or not exists(select 1 from public.staff_permissions sp
      where sp.staff_id=v_officer.user_id and sp.is_active=true
        and public.canonical_staff_domain(sp.permission)='field_operations') then
    raise exception 'Field Operations member must be active and assigned to the property State';
  end if;
  update public.inspection_requests set assigned_to=v_officer.user_id,
    field_officer_id=v_officer.user_id,assigned_field_officer_id=v_officer.user_id,
    assigned_at=now(),scheduled_date=p_scheduled_date,status='scheduled',updated_at=now()
  where id=p_inspection_id;
end
$function$
;

CREATE OR REPLACE FUNCTION public.field_officer_add_inspection_media(p_inspection_id uuid, p_photo_urls text[] DEFAULT ARRAY[]::text[], p_video_urls text[] DEFAULT ARRAY[]::text[])
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
  v_updated integer := 0;
begin
  v_actor:=public._current_team_actor();

  if v_actor.role<>'staff' or not public.current_staff_has_permission('field_officer') then
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
$function$
;

CREATE OR REPLACE FUNCTION public.field_officer_update_inspection_location(p_inspection_id uuid, p_latitude numeric, p_longitude numeric, p_accuracy_m numeric DEFAULT NULL::numeric)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_actor public.profiles; v_ir public.inspection_requests;
BEGIN
  v_actor:=public._current_team_actor();
  IF v_actor.user_id IS NULL OR v_actor.role<>'staff' OR NOT public.current_staff_has_permission('field_officer') THEN
    RAISE EXCEPTION 'Field Officer permission required';
  END IF;
  IF p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180 THEN RAISE EXCEPTION 'Invalid coordinates'; END IF;
  IF p_accuracy_m IS NOT NULL AND p_accuracy_m<0 THEN RAISE EXCEPTION 'Invalid location accuracy'; END IF;

  SELECT * INTO v_ir FROM public.inspection_requests WHERE id=p_inspection_id FOR UPDATE;
  IF v_ir.id IS NULL THEN RAISE EXCEPTION 'Property inspection not found'; END IF;
  IF COALESCE(v_ir.assigned_field_officer_id,v_ir.field_officer_id,v_ir.assigned_to) IS DISTINCT FROM v_actor.user_id THEN
    RAISE EXCEPTION 'This inspection is not assigned to you';
  END IF;
  IF v_ir.published_at IS NOT NULL THEN RAISE EXCEPTION 'Published property location must be corrected by Property Operations'; END IF;

  UPDATE public.inspection_requests
  SET gps_latitude=p_latitude,gps_longitude=p_longitude,location_accuracy_m=p_accuracy_m,updated_at=NOW()
  WHERE id=p_inspection_id;

  IF v_ir.draft_listing_id IS NOT NULL THEN
    UPDATE public.listings
    SET gps_latitude=p_latitude,gps_longitude=p_longitude,updated_at=NOW()
    WHERE id=v_ir.draft_listing_id AND deleted_at IS NULL;
  END IF;
  RETURN true;
END $function$
;

CREATE OR REPLACE FUNCTION public.get_inspection_media_for_review(p_inspection_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
  v_request public.inspection_requests;
begin
  v_actor:=public._current_team_actor();
  if v_actor is null then raise exception 'Operations review access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then
    raise exception 'Property Operations access required';
  end if;

  select * into v_request
  from public.inspection_requests
  where id=p_inspection_id;
  if v_request is null then raise exception 'Inspection not found'; end if;
  if v_actor.role<>'creator'
     and not public.current_actor_in_scope(v_request.property_state,v_request.property_city) then
    raise exception 'Inspection is outside your assigned branch';
  end if;

  return jsonb_build_object(
    'partner_photos',coalesce(to_jsonb(v_request.photo_urls),'[]'::jsonb),
    'partner_videos',coalesce(to_jsonb(v_request.video_urls),'[]'::jsonb),
    'field_photos',coalesce(to_jsonb(v_request.field_photo_urls),'[]'::jsonb),
    'field_videos',coalesce(to_jsonb(v_request.field_video_urls),'[]'::jsonb),
    -- Compatibility aliases are deliberately Field Operations evidence only.
    'photos',coalesce(to_jsonb(v_request.field_photo_urls),'[]'::jsonb),
    'videos',coalesce(to_jsonb(v_request.field_video_urls),'[]'::jsonb),
    'report',v_request.notes,
    'status',v_request.status
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_housing_operations()
 RETURNS TABLE(listing_id text, listing_title text, listing_status text, property_type text, sub_type text, state text, lga text, address text, annual_rent numeric, current_reservation_id text, reservation_status text, customer_user_id text, customer_name text, customer_username text, reservation_fee_paid boolean, payment_status text, rental_plan_years integer, contract_rent_total numeric, upfront_rent_required numeric, installment_balance numeric, installment_count integer, rent_payment_status text, rent_paid_at timestamp with time zone, hold_expires_at timestamp with time zone, requested_move_in_at timestamp with time zone, move_in_requested_at timestamp with time zone, tenancy_start_date date, tenancy_end_date date, move_out_grace_until date, occupied_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor public.profiles;
begin
  v_actor:=public._current_team_actor();
  if v_actor is null then raise exception 'Housing operations access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then
    raise exception 'Operations permission required';
  end if;

  return query
  select
    l.id::text,l.title,l.status,l.property_type,l.sub_type,l.state,l.city,l.address,l.price,
    r.id,r.status,r.user_id,coalesce(p.full_name,p.username,p.email),p.username,
    (coalesce(r.manual_payment_status,'unpaid') in ('paid','completed') and r.paid_at is not null),
    r.manual_payment_status,r.rental_plan_years,r.contract_rent_total,r.upfront_rent_required,
    r.installment_balance,r.installment_count,r.rent_payment_status,r.rent_paid_at,
    r.hold_expires_at,r.requested_move_in_at,r.move_in_requested_at,
    r.tenancy_start_date,r.tenancy_end_date,r.move_out_grace_until,l.occupied_at
  from public.reservations r
  join public.listings l on l.id::text=r.listing_id or l.listing_id=r.listing_id
  left join public.profiles p on p.user_id=r.user_id
  where coalesce(r.stay_type,'long_stay')='long_stay'
    and r.status not in ('cancelled','expired')
    and (v_actor.role='creator' or public.current_actor_in_scope(l.state,l.city))
  order by
    case r.status
      when 'payment_conflict' then 1 when 'ready_for_move_in' then 2
      when 'inspection_pending' then 3 when 'reserved' then 4
      when 'payment_pending' then 5 when 'occupied' then 6 else 7
    end,
    r.updated_at desc;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_inspections(p_field_officer_id text)
 RETURNS TABLE(id uuid, inspection_code text, property_address text, property_city text, property_state text, property_type text, status text, owner_id text, owner_name text, owner_email text, owner_phone text, notes text, field_officer_id text, partner_id text, scheduled_date timestamp with time zone, completed_at timestamp with time zone, created_at timestamp with time zone, photo_urls text[], document_urls text[], video_urls text[], _source text, gps_latitude numeric, gps_longitude numeric, location_accuracy_m numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
begin
  v_actor:=public._current_team_actor();

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
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_short_stay_operations_v2()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
  v_result jsonb;
begin
  v_actor:=public._current_team_actor();
  if v_actor is null then raise exception 'Housing operations access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then raise exception 'Operations permission required'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'reservation_id',r.id,
    'booking_code',r.booking_code,
    'status',r.status,
    'payment_status',r.rent_payment_status,
    'reservation_fee_paid',(r.manual_payment_status in ('paid','completed') and r.paid_at is not null),
    'check_in',r.stay_check_in,
    'check_out',r.stay_check_out,
    'nights',r.stay_nights,
    'guest_count',coalesce(r.guest_count,1),
    'nightly_rate',r.nightly_rate_snapshot,
    'stay_rent_total',r.stay_rent_total,
    'security_deposit',r.security_deposit_snapshot,
    'security_deposit_status',r.security_deposit_status,
    'customer_user_id',r.user_id,
    'customer_name',coalesce(p.full_name,p.username,p.email),
    'customer_phone',p.phone,
    'listing_id',l.id,
    'listing_title',l.title,
    'state',l.state,
    'lga',l.city,
    'address',l.address,
    'listing_status',case when r.status='occupied' then 'occupied' else l.status end,
    'publication_status',l.status
  ) order by r.stay_check_in asc,r.created_at asc),'[]'::jsonb)
  into v_result
  from public.reservations r
  join public.listings l on l.id::text=r.listing_id
  left join public.profiles p on p.user_id=r.user_id
  where r.stay_type='short_let'
    and r.status in ('payment_pending','reserved','inspection_pending','ready_for_move_in','occupied')
    and (v_actor.role='creator' or public.current_actor_in_scope(l.state,l.city));
  return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_staff_worker_reviews(p_status text DEFAULT 'pending'::text)
 RETURNS SETOF profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor public.profiles;
begin
  v_actor:=public._current_team_actor();

  if v_actor.user_id is null
     or coalesce(v_actor.deleted,false)
     or coalesce(v_actor.suspended,false)
     or coalesce(v_actor.banned,false) then
    raise exception 'Active WeHouse Team account required';
  end if;

  if v_actor.role='staff'
     and not public.current_staff_has_permission('worker_operations') then
    raise exception 'Worker Operations access required';
  end if;

  if v_actor.role not in('staff','admin','creator') then
    raise exception 'WeHouse Team access required';
  end if;

  return query
  select worker.*
  from public.profiles worker
  where public.user_has_active_workspace(worker.user_id,'worker')
    and not coalesce(worker.deleted,false)
    and not coalesce(worker.suspended,false)
    and not coalesce(worker.banned,false)
    and (p_status is null or p_status='all' or worker.worker_status=p_status)
    and (
      v_actor.role='creator'
      or public.current_actor_in_scope(
        worker.state,coalesce(nullif(worker.local_government,''),worker.city)
      )
    )
  order by worker.created_at desc;
end
$function$
;

CREATE OR REPLACE FUNCTION public.get_property_access_review_details(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
  v_request public.inspection_requests;
  v_code text;
  v_review public.audit_logs;
  v_reviewer public.profiles;
begin
  v_actor:=public._current_team_actor();

  if v_actor is null or (v_actor.role='staff' and not public.current_staff_has_permission('operations')) then
    raise exception 'Operations Staff, Admin or Creator access required';
  end if;

  select * into v_request from public.inspection_requests where id=p_request_id;
  if v_request.id is null then raise exception 'Property request not found'; end if;
  if v_actor.role<>'creator' and not public.current_actor_in_scope(v_request.property_state,v_request.property_city) then
    raise exception 'Property is outside your assigned area';
  end if;

  select c.code into v_code
  from public.property_access_challenges c
  where c.request_id=v_request.id and c.status='consumed'
  order by c.consumed_at desc nulls last
  limit 1;

  if v_request.access_evidence_status='verified' then
    select a.* into v_review
    from public.audit_logs a
    where a.target_type='inspection_requests'
      and a.target_id=v_request.id::text
      and a.admin_id=v_request.access_evidence_verified_by
      and a.action in ('PROPERTY_ACCESS_EVIDENCE_ACCEPTED','PROPERTY_ACCESS_EVIDENCE_OVERRIDDEN')
      and coalesce((a.details::jsonb)->>'decision','accept')='accept'
    order by a.created_at desc
    limit 1;
    if v_review.id is not null then
      select * into v_reviewer from public.profiles where user_id=v_review.admin_id limit 1;
    end if;
  end if;

  return jsonb_build_object(
    'status',v_request.access_evidence_status,
    'video_path',v_request.access_evidence_video_path,
    'submitted_at',v_request.access_evidence_submitted_at,
    'code',v_code,
    'reviewed_at',v_request.access_evidence_verified_at,
    'reviewed_by',v_request.access_evidence_verified_by,
    'reviewer_role',coalesce(v_reviewer.role,(v_review.details::jsonb)->>'reviewer_role'),
    'reviewer_name',coalesce(nullif(v_reviewer.full_name,''),nullif(v_reviewer.username,''),v_reviewer.email),
    'audit_event_id',v_review.id,
    'audit_backed',v_request.access_evidence_status<>'verified' or (
      v_review.id is not null
      and v_request.access_evidence_verified_at is not null
      and v_request.access_evidence_verified_by is not null
    )
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.prepare_hotel_listing(p_inspection_id uuid, p_editorial_description text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
  v_request public.inspection_requests;
  v_program jsonb;
  v_rooms jsonb;
  v_room jsonb;
  v_hotel_id integer;
  v_name text;
  v_amenities text[];
begin
  v_actor:=public._current_team_actor();
  if v_actor.user_id is null then raise exception 'Property Operations access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then
    raise exception 'Property Operations permission required';
  end if;
  select * into v_request from public.inspection_requests
  where id=p_inspection_id for update;
  if v_request.id is null or v_request.property_type<>'hotel' then raise exception 'Accepted hotel inspection required'; end if;
  if v_actor.role in ('staff','admin') and not public.current_actor_in_scope(v_request.property_state,v_request.property_city) then
    raise exception 'Hotel is outside your assigned branch';
  end if;
  if v_request.draft_hotel_id is not null then return v_request.draft_hotel_id; end if;
  if v_request.lifecycle_stage<>'ready_to_prepare' or v_request.field_evidence_review_status<>'accepted' then
    raise exception 'Field evidence must be independently accepted before preparation';
  end if;
  v_program:=coalesce(v_request.hotel_program,'{}'::jsonb);
  v_rooms:=coalesce(v_program->'room_types','[]'::jsonb);
  v_name:=nullif(btrim(v_program->>'name'),'');
  if v_name is null then raise exception 'The Property Partner must supply the hotel name'; end if;
  if jsonb_typeof(v_rooms)<>'array' or jsonb_array_length(v_rooms)=0 then
    raise exception 'The Property Partner must submit at least one room type';
  end if;
  select coalesce(array_agg(value),array[]::text[]) into v_amenities
  from jsonb_array_elements_text(coalesce(v_program->'amenities','[]'::jsonb));
  insert into public.hotels(
    name,description,state,city,address,images,amenities,owner_id,status,featured,
    gps_latitude,gps_longitude,inspection_request_id,created_at,updated_at
  ) values(
    v_name,coalesce(nullif(btrim(coalesce(p_editorial_description,'')),''),v_request.description),
    v_request.property_state,v_request.property_city,v_request.property_address,
    array[]::text[],v_amenities,v_request.owner_id,'draft',false,
    v_request.gps_latitude,v_request.gps_longitude,v_request.id,now(),now()
  ) returning hotel_id into v_hotel_id;
  for v_room in select value from jsonb_array_elements(v_rooms) loop
    if nullif(btrim(v_room->>'name'),'') is null
       or coalesce((v_room->>'nightly_rate')::integer,0)<=0 then
      raise exception 'Every submitted room needs a name and nightly rate';
    end if;
    insert into public.hotel_rooms(
      hotel_id,room_type,description,price_per_night,max_guests,bed_type,
      images,amenities,total_rooms,created_at,updated_at
    ) values(
      v_hotel_id,btrim(v_room->>'name'),nullif(btrim(v_room->>'description'),''),
      (v_room->>'nightly_rate')::integer,greatest(coalesce((v_room->>'guest_capacity')::integer,2),1),
      nullif(btrim(v_room->>'bed_type'),''),array[]::text[],
      coalesce(array(select jsonb_array_elements_text(coalesce(v_room->'amenities','[]'::jsonb))),array[]::text[]),
      greatest(coalesce((v_room->>'inventory')::integer,1),1),now(),now()
    );
  end loop;
  update public.inspection_requests set draft_hotel_id=v_hotel_id,updated_at=now()
  where id=v_request.id;
  return v_hotel_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.prepare_property_listing(p_inspection_id uuid, p_public_title text, p_editorial_description text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
  v_request public.inspection_requests;
  v_partner public.profiles;
  v_listing_id uuid;
  v_code text;
begin
  v_actor:=public._current_team_actor();
  if v_actor.user_id is null then raise exception 'Property Operations access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then
    raise exception 'Property Operations permission required';
  end if;
  select * into v_request from public.inspection_requests
  where id=p_inspection_id for update;
  if v_request.id is null or v_request.property_type='hotel' then raise exception 'Accepted apartment inspection required'; end if;
  if v_actor.role in ('staff','admin') and not public.current_actor_in_scope(v_request.property_state,v_request.property_city) then
    raise exception 'Property is outside your assigned branch';
  end if;
  if v_request.draft_listing_id is not null then return v_request.draft_listing_id; end if;
  if v_request.lifecycle_stage<>'ready_to_prepare' or v_request.field_evidence_review_status<>'accepted' then
    raise exception 'Field evidence must be independently accepted before preparation';
  end if;
  if nullif(btrim(coalesce(p_public_title,'')),'') is null then raise exception 'Public title is required'; end if;
  if coalesce(v_request.expected_rent,0)<=0 then raise exception 'The Property Partner must supply a valid rent'; end if;
  if v_request.sub_type not in ('short_let','long_stay') then raise exception 'The Property Partner must choose Short Let or Long Let'; end if;
  if v_request.sub_type='short_let' and coalesce(v_request.security_deposit_amount,0)<=0 then
    raise exception 'The Property Partner must supply the Short Let refundable security deposit';
  end if;
  if v_request.sub_type='short_let' and not ('Furnished'=any(coalesce(v_request.amenities,'{}'))) then
    raise exception 'A Short Let must be submitted as furnished';
  end if;
  select * into v_partner from public.profiles
  where user_id=v_request.owner_id and public.user_has_active_workspace(user_id,'property_partner')
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if v_partner.user_id is null then raise exception 'Active Property Partner required'; end if;

  v_code:='WHL-'||upper(substring(replace(gen_random_uuid()::text,'-','') from 1 for 12));
  insert into public.listings(
    listing_id,title,description,price,currency,state,city,address,images,videos,
    bedrooms,bathrooms,property_type,sub_type,security_deposit_amount,amenities,
    availability_status,owner_id,partner_id,chat_agent_id,status,submitted_by_role,
    reservation_fee_paid,chat_unlocked,gps_latitude,gps_longitude,
    inspection_request_id,created_at,updated_at
  ) values(
    v_code,btrim(p_public_title),coalesce(nullif(btrim(coalesce(p_editorial_description,'')),''),v_request.description),
    v_request.expected_rent,'NGN',v_request.property_state,v_request.property_city,
    v_request.property_address,array[]::text[],array[]::text[],
    coalesce(v_request.bedrooms,1),coalesce(v_request.bathrooms,1),
    v_request.property_type,v_request.sub_type,
    case when v_request.sub_type='short_let' then v_request.security_deposit_amount else null end,
    coalesce(v_request.amenities,array[]::text[]),'pending_approval',
    v_partner.user_id,v_partner.user_id,v_actor.user_id,'pending_approval',
    'property_partner',false,false,v_request.gps_latitude,v_request.gps_longitude,
    v_request.id,now(),now()
  ) returning id into v_listing_id;
  update public.inspection_requests set draft_listing_id=v_listing_id,updated_at=now()
  where id=v_request.id;
  return v_listing_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.review_field_inspection_evidence(p_inspection_id uuid, p_decision text, p_note text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
  v_request public.inspection_requests;
  v_note text:=nullif(btrim(coalesce(p_note,'')),'');
begin
  v_actor:=public._current_team_actor();
  if v_actor.user_id is null then raise exception 'Property review access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then
    raise exception 'Property Operations permission required';
  end if;
  select * into v_request from public.inspection_requests
  where id=p_inspection_id for update;
  if v_request.id is null then raise exception 'Inspection not found'; end if;
  if v_actor.user_id=coalesce(v_request.assigned_field_officer_id,v_request.field_officer_id,v_request.assigned_to) then
    raise exception 'The Field Officer who submitted evidence cannot approve it';
  end if;
  if v_actor.role in ('staff','admin') and not public.current_actor_in_scope(v_request.property_state,v_request.property_city) then
    raise exception 'Property is outside your assigned branch';
  end if;
  if v_request.field_evidence_review_status<>'pending' then
    raise exception 'This Field Operations evidence is not awaiting review';
  end if;
  if p_decision='accept' then
    if cardinality(coalesce(v_request.field_photo_urls,'{}'))<4 then
      raise exception 'Four Field Operations photos are required before acceptance';
    end if;
    if nullif(btrim(coalesce(v_request.notes,'')),'') is null then
      raise exception 'A Field Operations report is required before acceptance';
    end if;
    update public.inspection_requests
    set field_evidence_review_status='accepted',field_evidence_reviewed_by=v_actor.user_id,
        field_evidence_reviewed_at=now(),field_evidence_review_note=v_note,
        rejection_reason=null,updated_at=now()
    where id=p_inspection_id;
  elsif p_decision='request_changes' then
    if v_note is null then raise exception 'Explain exactly what Field Operations must correct'; end if;
    update public.inspection_requests
    set status='in_progress',field_evidence_review_status='changes_requested',
        field_evidence_reviewed_by=v_actor.user_id,field_evidence_reviewed_at=now(),
        field_evidence_review_note=v_note,rejection_reason=v_note,updated_at=now()
    where id=p_inspection_id;
    if v_request.assigned_field_officer_id is not null then
      insert into public.notifications(
        recipient_id,type,title,message,related_id,source_type,source_id,
        destination_route,destination_params,event_key
      ) values(
        v_request.assigned_field_officer_id,'field_evidence_changes_requested',
        'Field evidence needs correction',v_note,v_request.id::text,
        'inspection_request',v_request.id::text,'field_inspections',
        jsonb_build_object('inspection_id',v_request.id),
        'field-evidence-correction:'||v_request.id::text||':'||extract(epoch from now())::bigint::text
      ) on conflict do nothing;
    end if;
  else
    raise exception 'Decision must be accept or request_changes';
  end if;
  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.review_my_staff_worker_v2(p_worker_id text, p_status text, p_reason text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
  v_worker public.profiles;
  v_ver public.worker_verifications;
begin
  v_actor:=public._current_team_actor();

  if v_actor.user_id is null
     or v_actor.role<>'staff'
     or not public.current_actor_has_workspace('staff',null)
     or coalesce(v_actor.deleted,false)
     or coalesce(v_actor.suspended,false)
     or coalesce(v_actor.banned,false) then
    raise exception 'Active WeHouse Team account required';
  end if;

  if not public.current_staff_has_permission('worker_operations') then
    raise exception 'Worker Operations access required';
  end if;
  if p_status not in ('verified','rejected') then
    raise exception 'Invalid review outcome';
  end if;
  if p_status='rejected'
     and nullif(btrim(coalesce(p_reason,'')),'') is null then
    raise exception 'Rejection reason is required';
  end if;

  select * into v_worker
  from public.profiles
  where user_id=p_worker_id
    and public.user_has_active_workspace(user_id,'worker')
  for update;
  if v_worker.user_id is null then raise exception 'Worker not found'; end if;

  if not public.current_actor_in_scope(
    v_worker.state,coalesce(nullif(v_worker.local_government,''),v_worker.city)
  ) then
    raise exception 'Worker is outside your assigned branch';
  end if;

  select * into v_ver
  from public.worker_verifications
  where worker_id=p_worker_id
  order by created_at desc
  limit 1;

  if p_status='verified' then
    if v_worker.worker_status<>'profile_under_review' then
      raise exception 'Worker is not in the review queue';
    end if;
    if not public.worker_identity_is_current(p_worker_id) then
      raise exception 'The required private identity check has not passed';
    end if;
    if v_ver.id is null
       or nullif(btrim(coalesce(v_ver.verification_video_url,'')),'') is null then
      raise exception 'Professional work evidence is incomplete';
    end if;
  end if;

  update public.profiles
  set worker_status=p_status,
      worker_verified=(p_status='verified'),
      available=(p_status='verified'),
      updated_at=now(),updated_by=v_actor.user_id
  where user_id=p_worker_id;

  update public.worker_verifications
  set status=p_status,reviewed_by=v_actor.user_id,
      review_notes=coalesce(nullif(btrim(p_notes),''),nullif(btrim(p_reason),'')),
      reviewed_at=now(),updated_at=now()
  where id=v_ver.id;

  insert into public.worker_verification_reviews(
    worker_id,reviewer_id,reviewer_role,action,rejection_reason,notes,created_at
  ) values(
    p_worker_id,v_actor.user_id,'staff',p_status,
    case when p_status='rejected' then btrim(p_reason) else null end,
    nullif(btrim(coalesce(p_notes,'')),''),now()
  );
  return true;
end
$function$
;

CREATE OR REPLACE FUNCTION public.review_property_access_evidence(p_request_id uuid, p_decision text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
  v_request public.inspection_requests;
  v_status text;
  v_override boolean;
begin
  v_actor:=public._current_team_actor();

  if v_actor is null or (v_actor.role='staff' and not public.current_staff_has_permission('operations')) then
    raise exception 'Operations Staff, Admin or Creator access required';
  end if;

  select * into v_request from public.inspection_requests where id=p_request_id for update;
  if v_request.id is null then raise exception 'Property request not found'; end if;
  if v_actor.role<>'creator' and not public.current_actor_in_scope(v_request.property_state,v_request.property_city) then
    raise exception 'Property is outside your assigned area';
  end if;
  if v_request.access_evidence_video_path is null then raise exception 'No private access recording to review'; end if;
  if p_decision not in ('accept','reject') then raise exception 'Choose accept or reject'; end if;
  if p_decision='reject' and nullif(btrim(coalesce(p_note,'')),'') is null then
    raise exception 'Explain what the Property Partner must record again';
  end if;

  v_override := v_request.access_evidence_status in ('verified','rejected');
  if v_override and coalesce(v_request.assigned_field_officer_id,v_request.field_officer_id,v_request.assigned_to) is not null then
    raise exception 'Access evidence cannot be overridden after a Field Officer has been assigned';
  end if;
  if v_actor.role='staff' and v_request.access_evidence_status<>'submitted' then
    raise exception 'Admin or Creator authority is required to override an evidence decision';
  end if;
  if v_actor.role in ('admin','creator') and v_request.access_evidence_status not in ('submitted','verified','rejected') then
    raise exception 'No submitted evidence decision is available';
  end if;

  v_status:=case when p_decision='accept' then 'verified' else 'rejected' end;
  update public.inspection_requests
  set access_evidence_status=v_status,
      access_evidence_verified_at=case when v_status='verified' then now() else null end,
      access_evidence_verified_by=case when v_status='verified' then v_actor.user_id else null end,
      rejection_reason=case when v_status='rejected' then btrim(p_note) else null end,
      updated_at=now()
  where id=p_request_id;

  insert into public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
  values(
    case when v_override then 'PROPERTY_ACCESS_EVIDENCE_OVERRIDDEN'
         when v_status='verified' then 'PROPERTY_ACCESS_EVIDENCE_ACCEPTED'
         else 'PROPERTY_ACCESS_EVIDENCE_REJECTED' end,
    'inspection_requests',p_request_id::text,
    jsonb_build_object(
      'decision',p_decision,
      'note',nullif(btrim(coalesce(p_note,'')),''),
      'previous_status',v_request.access_evidence_status,
      'reviewer_role',v_actor.role
    )::text,
    v_actor.user_id,v_actor.email
  );
  return jsonb_build_object('success',true,'status',v_status,'override',v_override);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_inspection_status(p_inspection_id uuid, p_new_status text, p_source text DEFAULT 'user'::text, p_report text DEFAULT NULL::text, p_condition text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
  v_updated boolean:=false;
begin
  v_actor:=public._current_team_actor();
  if v_actor.user_id is null then raise exception 'Active WeHouse account required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('field_officer') then
    raise exception 'Field Officer permission required';
  end if;
  if v_actor.role not in ('staff','admin','creator') then raise exception 'Field Officer access required'; end if;
  if p_source not in ('user','partner') then raise exception 'Invalid inspection source'; end if;
  if p_new_status not in ('in_progress','completed') then raise exception 'Field Officer can only start or submit an inspection'; end if;
  if p_new_status='completed' and nullif(btrim(coalesce(p_report,'')),'') is null then
    raise exception 'Inspection report is required before submission';
  end if;

  if p_source='partner' then
    update public.inspection_requests
    set status=p_new_status,
        completed_at=case when p_new_status='completed' then now() else completed_at end,
        inspection_completed_at=case when p_new_status='completed' then now() else inspection_completed_at end,
        notes=case when p_new_status='completed' then btrim(p_report) else notes end,
        field_evidence_review_status=case when p_new_status='completed' then 'pending' else field_evidence_review_status end,
        field_evidence_reviewed_by=case when p_new_status='completed' then null else field_evidence_reviewed_by end,
        field_evidence_reviewed_at=case when p_new_status='completed' then null else field_evidence_reviewed_at end,
        field_evidence_review_note=case when p_new_status='completed' then null else field_evidence_review_note end,
        rejection_reason=case when p_new_status='completed' then null else rejection_reason end,
        updated_at=now()
    where id=p_inspection_id and (
      v_actor.role in ('admin','creator')
      or coalesce(assigned_field_officer_id,field_officer_id,assigned_to)=v_actor.user_id
    );
    v_updated:=found;
  else
    update public.user_inspection_requests
    set status=p_new_status,
        completed_at=case when p_new_status='completed' then now() else completed_at end,
        report=case when p_new_status='completed' then btrim(p_report) else report end,
        condition=case when p_new_status='completed' then nullif(btrim(coalesce(p_condition,'')),'') else condition end,
        updated_at=now()
    where id=p_inspection_id and (
      v_actor.role in ('admin','creator') or field_officer_id=v_actor.user_id
    );
    v_updated:=found;
  end if;
  if not v_updated then raise exception 'Inspection not found or not assigned to this account'; end if;
  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.verify_branch_booking_code(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
  v_code text:=upper(btrim(coalesce(p_code,'')));
  v_result jsonb;
  v_state text;
  v_lga text;
begin
  if v_code !~ '^[A-Z]{3}WH[0-9]{5}$' then raise exception 'Enter a valid WeHouse booking code'; end if;
  v_actor:=public._current_team_actor();
  if v_actor is null or not public.user_has_active_workspace(v_actor.user_id,v_actor.role) then raise exception 'Operations access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then
    raise exception 'Operations module required';
  end if;

  select jsonb_build_object(
    'kind','housing','code',r.booking_code,'status',r.status,'payment_status',r.rent_payment_status,
    'reservation_fee_status',r.manual_payment_status,'stay_type',coalesce(r.stay_type,'long_stay'),
    'customer_name',coalesce(p.full_name,p.username,r.user_email),'customer_phone',coalesce(p.phone,r.user_phone),
    'property_name',coalesce(l.title,r.listing_title),'state',l.state,'lga',l.city,'reservation_id',r.id,
    'listing_id',r.listing_id,'check_in',r.stay_check_in,'check_out',r.stay_check_out,
    'guest_count',coalesce(r.guest_count,1),'requested_move_in_at',r.requested_move_in_at,
    'tenancy_start_date',r.tenancy_start_date,'tenancy_end_date',r.tenancy_end_date,
    'valid',((r.stay_type='short_let' or (r.manual_payment_status in ('paid','completed') and r.paid_at is not null))
      and r.rent_payment_status in ('paid','upfront_paid') and r.rent_paid_at is not null),
    'can_handover',(coalesce(r.stay_type,'long_stay')='long_stay' and r.status='ready_for_move_in'
      and r.manual_payment_status in ('paid','completed') and r.paid_at is not null
      and r.rent_payment_status in ('paid','upfront_paid') and r.rent_paid_at is not null
      and public.property_arrival_allowed('long_stay',null,null,r.requested_move_in_at,timezone('Africa/Lagos',now())::date)),
    'can_check_in',(r.stay_type='short_let' and r.status='ready_for_move_in'
      and r.rent_payment_status='paid' and r.rent_paid_at is not null
      and public.property_arrival_allowed('short_let',r.stay_check_in,r.stay_check_out,null,timezone('Africa/Lagos',now())::date))
  ),l.state,l.city
  into v_result,v_state,v_lga
  from public.reservations r
  join public.listings l on l.id::text=r.listing_id or l.listing_id=r.listing_id
  left join public.profiles p on p.user_id=r.user_id
  where r.booking_code=v_code
  limit 1;

  if v_result is null then
    select jsonb_build_object(
      'kind','hotel','code',hb.booking_code,'status',hb.status,'payment_status',hb.payment_status,
      'customer_name',coalesce(p.full_name,p.username,hb.guest_name),'customer_phone',coalesce(p.phone,hb.guest_phone),
      'property_name',h.name,'state',h.state,'lga',h.city,'booking_id',hb.booking_id,'hotel_id',hb.hotel_id,
      'check_in',hb.check_in,'check_out',hb.check_out,'guest_count',hb.guest_count,
      'valid',(hb.payment_status='paid' and hb.status not in ('cancelled','refunded')),
      'can_check_in',(hb.payment_status='paid' and hb.status in ('confirmed','paid')
        and timezone(h.timezone,now()) >= hb.check_in + h.check_in_time
        and timezone(h.timezone,now()) < hb.check_out + h.check_out_time)
    ),h.state,h.city
    into v_result,v_state,v_lga
    from public.hotel_bookings hb
    join public.hotels h on h.hotel_id=hb.hotel_id
    left join public.profiles p on p.user_id=hb.user_id
    where hb.booking_code=v_code
    limit 1;
  end if;
  if v_result is null then return null; end if;
  if not public.current_actor_in_scope(v_state,v_lga) then
    raise exception 'This booking belongs to another WeHouse branch';
  end if;
  return v_result;
end;
$function$
;


revoke all on function public._current_team_actor() from public,anon,authenticated;
grant execute on function public._current_team_actor() to service_role;
revoke all on function public.user_workspace_covers(text,text,text,text) from public,anon,authenticated;
grant execute on function public.user_workspace_covers(text,text,text,text) to service_role;

commit;
