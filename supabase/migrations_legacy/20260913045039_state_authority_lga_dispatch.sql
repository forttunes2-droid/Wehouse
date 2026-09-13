-- Platform authority is State-scoped. LGA remains dispatch and presentation
-- metadata; it must not silently remove otherwise authorised State work.

create or replace function public._admin_dashboard_actor()
returns public.profiles
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor public.profiles;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null or v_actor.role not in('admin','creator') then
    raise exception 'Admin or Creator account required';
  end if;
  if v_actor.role='admin'
     and nullif(public.wehouse_state_key(v_actor.assigned_state),'') is null then
    raise exception 'Admin State assignment is incomplete. Contact Creator.';
  end if;
  return v_actor;
end
$$;

create or replace function public.current_actor_in_scope(p_state text,p_lga text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor public.profiles;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null then return false; end if;
  if v_actor.role='creator' then return true; end if;
  if v_actor.role not in('admin','staff') then return false; end if;
  -- p_lga is retained for migration/RPC compatibility and dispatch UIs only.
  return nullif(public.wehouse_state_key(v_actor.assigned_state),'') is not null
    and public.wehouse_state_key(v_actor.assigned_state)
      =public.wehouse_state_key(p_state);
end
$$;

create or replace function public._assert_admin_lga_scope(p_target_user_id text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor public.profiles; v_target public.profiles; v_target_state text;
begin
  v_actor:=public._admin_dashboard_actor();
  if v_actor.role='creator' then return; end if;
  select * into v_target from public.profiles where user_id=p_target_user_id;
  if v_target.user_id is null then raise exception 'Target user not found'; end if;
  v_target_state:=case when v_target.role in('admin','staff')
    then nullif(btrim(v_target.assigned_state),'')
    else nullif(btrim(v_target.state),'') end;
  if v_target_state is null then raise exception 'Target user has no State location'; end if;
  if public.wehouse_state_key(v_target_state)
     <>public.wehouse_state_key(v_actor.assigned_state) then
    raise exception 'Admin scope violation: target is outside the assigned State';
  end if;
end
$$;

create or replace function public.current_oversight_can_review_worker(p_worker_id text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor public.profiles; v_worker public.profiles;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text and role in('creator','admin')
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if v_actor.user_id is null then return false; end if;
  select * into v_worker from public.profiles
  where user_id=p_worker_id and role='worker' limit 1;
  if v_worker.user_id is null then return false; end if;
  return v_actor.role='creator' or public.wehouse_state_key(v_worker.state)
    =public.wehouse_state_key(v_actor.assigned_state);
end
$$;

create or replace function public.current_staff_can_review_worker(p_worker_id text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor public.profiles; v_worker public.profiles;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text and role='staff'
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if v_actor.user_id is null
     or not public.current_staff_has_permission('worker_operations') then
    return false;
  end if;
  select * into v_worker from public.profiles
  where user_id=p_worker_id and role='worker' limit 1;
  return v_worker.user_id is not null
    and public.wehouse_state_key(v_worker.state)
      =public.wehouse_state_key(v_actor.assigned_state);
end
$$;

create or replace function public.admin_get_all_users()
returns setof public.profiles
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor public.profiles;
begin
  v_actor:=public._admin_dashboard_actor();
  return query
  select (jsonb_populate_record(
    null::public.profiles,
    to_jsonb(p)-array['auth_id','creator_auth_password','creator_auth_enabled',
      'worker_gov_id_url','maintenance_exempt','created_by','updated_by']::text[]
  )).*
  from public.profiles p
  where p.deleted_at is null and p.role<>'creator'
    and (v_actor.role='creator' or public.wehouse_state_key(
      case when p.role in('admin','staff') then p.assigned_state else p.state end
    )=public.wehouse_state_key(v_actor.assigned_state))
  order by p.created_at desc;
end
$$;

create or replace function public.admin_get_all_workers()
returns setof public.profiles
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor public.profiles;
begin
  v_actor:=public._admin_dashboard_actor();
  return query
  select jsonb_populate_record(null::public.profiles,
    to_jsonb(p)-array['auth_id','creator_auth_password','creator_auth_enabled',
      'worker_gov_id_url','maintenance_exempt','created_by','updated_by']::text[])
  from public.profiles p
  where p.role='worker' and p.deleted_at is null
    and (v_actor.role='creator' or public.wehouse_state_key(p.state)
      =public.wehouse_state_key(v_actor.assigned_state))
  order by p.created_at desc;
end
$$;

create or replace function public.admin_get_my_branch_profiles(p_role text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor public.profiles; v_result jsonb;
begin
  v_actor:=public._admin_dashboard_actor();
  if p_role is not null and p_role not in(
    'user','worker','property_partner','staff','admin'
  ) then raise exception 'Invalid role filter'; end if;
  select coalesce(jsonb_agg(
    to_jsonb(p)-array['auth_id','creator_auth_password','creator_auth_enabled',
      'worker_gov_id_url','maintenance_exempt','created_by','updated_by']::text[]
    order by p.created_at desc
  ),'[]'::jsonb) into v_result
  from public.profiles p
  where not coalesce(p.deleted,false) and p.role<>'creator'
    and (p_role is null or p.role=p_role)
    and (v_actor.role='creator' or public.wehouse_state_key(
      case when p.role in('admin','staff') then p.assigned_state else p.state end
    )=public.wehouse_state_key(v_actor.assigned_state));
  return v_result;
end
$$;

create or replace function public.admin_get_my_branch_stats()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor public.profiles;
begin
  v_actor:=public._admin_dashboard_actor();
  return jsonb_build_object(
    'users',(select count(*) from public.profiles p where p.role='user'
      and p.deleted_at is null and not coalesce(p.deleted,false)
      and (v_actor.role='creator' or public.wehouse_state_key(p.state)=public.wehouse_state_key(v_actor.assigned_state))),
    'workers',(select count(*) from public.profiles p where p.role='worker'
      and p.deleted_at is null and not coalesce(p.deleted,false)
      and (v_actor.role='creator' or public.wehouse_state_key(p.state)=public.wehouse_state_key(v_actor.assigned_state))),
    'partners',(select count(*) from public.profiles p where p.role='property_partner'
      and p.deleted_at is null and not coalesce(p.deleted,false)
      and (v_actor.role='creator' or public.wehouse_state_key(p.state)=public.wehouse_state_key(v_actor.assigned_state))),
    'staff',(select count(*) from public.profiles p where p.role='staff'
      and p.deleted_at is null and not coalesce(p.deleted,false)
      and (v_actor.role='creator' or public.wehouse_state_key(p.assigned_state)=public.wehouse_state_key(v_actor.assigned_state))),
    'admins',(select count(*) from public.profiles p where p.role='admin'
      and p.deleted_at is null and not coalesce(p.deleted,false)
      and (v_actor.role='creator' or public.wehouse_state_key(p.assigned_state)=public.wehouse_state_key(v_actor.assigned_state))),
    'listings',(select count(*) from public.listings l where l.deleted_at is null
      and l.status='available' and (v_actor.role='creator' or public.wehouse_state_key(l.state)=public.wehouse_state_key(v_actor.assigned_state))),
    'pending_verifications',(select count(*) from public.profiles p
      where p.role='worker' and p.worker_status in('verification_paid','profile_under_review')
      and p.deleted_at is null and not coalesce(p.deleted,false)
      and (v_actor.role='creator' or public.wehouse_state_key(p.state)=public.wehouse_state_key(v_actor.assigned_state)))
  );
end
$$;

create or replace function public.admin_get_my_branch_worker_booking_summaries()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor public.profiles; v_result jsonb;
begin
  v_actor:=public._admin_dashboard_actor();
  select coalesce(jsonb_agg(jsonb_build_object(
    'booking_code',wb.booking_code,'service_type',wb.service_type,
    'status',wb.status,'negotiated_amount',coalesce(wb.negotiated_amount,wb.agreed_amount,0),
    'scheduled_date',wb.scheduled_date,'created_at',wb.created_at,
    'updated_at',wb.updated_at,'worker_name',coalesce(w.full_name,w.username,'Worker'),
    'customer_name',coalesce(c.full_name,c.username,'Customer'),
    'needs_attention',(wb.status in('booking_requested','waiting_payment','completed_pending_approval','disputed')
      or exists(select 1 from public.booking_payments bp where bp.worker_booking_id=wb.id and bp.status='review_required')),
    'has_dispute',wb.status='disputed',
    'payment_review_required',exists(select 1 from public.booking_payments bp where bp.worker_booking_id=wb.id and bp.status='review_required')
  ) order by wb.updated_at desc),'[]'::jsonb) into v_result
  from public.worker_bookings wb
  join public.profiles w on w.user_id=wb.worker_id
  join public.profiles c on c.user_id=wb.user_id
  where v_actor.role='creator' or public.wehouse_state_key(w.state)
    =public.wehouse_state_key(v_actor.assigned_state);
  return v_result;
end
$$;

create or replace function public.admin_get_my_branch_worker_bookings()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor public.profiles; v_result jsonb;
begin
  v_actor:=public._admin_dashboard_actor();
  select coalesce(jsonb_agg(to_jsonb(wb) order by wb.created_at desc),'[]'::jsonb)
  into v_result from public.worker_bookings wb
  join public.profiles w on w.user_id=wb.worker_id
  where v_actor.role='creator' or public.wehouse_state_key(w.state)
    =public.wehouse_state_key(v_actor.assigned_state);
  return v_result;
end
$$;

create or replace function public.admin_count_branch_announcement_recipients(
  p_target_roles text[]
)
returns bigint
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor public.profiles; v_count bigint;
begin
  v_actor:=public._admin_dashboard_actor();
  if v_actor.role<>'admin' then raise exception 'Admin account required'; end if;
  select count(*) into v_count from public.profiles p
  where p.user_id<>v_actor.user_id and p.role=any(p_target_roles)
    and not coalesce(p.deleted,false) and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
    and public.wehouse_state_key(case when p.role in('admin','staff')
      then p.assigned_state else p.state end)
      =public.wehouse_state_key(v_actor.assigned_state);
  return v_count;
end
$$;

create or replace function public.admin_get_field_officers_for_inspection(
  p_inspection_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor public.profiles; v_ir public.inspection_requests; v_result jsonb;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text and role in('staff','admin','creator')
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if v_actor.user_id is null or (v_actor.role='staff'
    and not public.current_staff_has_permission('property_operations')) then
    raise exception 'Property Operations, Admin or Creator access required';
  end if;
  select * into v_ir from public.inspection_requests where id=p_inspection_id;
  if v_ir.id is null then raise exception 'Inspection request not found'; end if;
  if v_actor.role<>'creator'
     and not public.current_actor_in_scope(v_ir.property_state,v_ir.property_city) then
    raise exception 'Inspection is outside your assigned State';
  end if;
  select coalesce(jsonb_agg(x order by (x->>'distance_km')::numeric nulls last,
    (x->>'active_inspections')::int,coalesce(x->>'name','')),'[]'::jsonb)
  into v_result from (
    select jsonb_build_object(
      'user_id',p.user_id,'name',coalesce(p.full_name,p.username,p.email),
      'email',p.email,'assigned_state',p.assigned_state,'assigned_lga',p.assigned_lga,
      'active_inspections',(select count(*) from public.inspection_requests q
        where coalesce(q.assigned_field_officer_id,q.field_officer_id,q.assigned_to)=p.user_id
          and q.status in('scheduled','in_progress')),
      'location_captured_at',loc.captured_at,
      'distance_km',case when v_ir.gps_latitude is not null and v_ir.gps_longitude is not null
        and loc.latitude is not null and loc.longitude is not null
        and loc.captured_at>now()-interval '24 hours'
        then round((6371*2*asin(sqrt(
          power(sin(radians((loc.latitude-v_ir.gps_latitude)/2)),2)
          +cos(radians(v_ir.gps_latitude))*cos(radians(loc.latitude))
          *power(sin(radians((loc.longitude-v_ir.gps_longitude)/2)),2)
        )))::numeric,2) else null end
    ) x
    from public.profiles p
    join public.staff_permissions sp on sp.staff_id=p.user_id
      and public.canonical_staff_domain(sp.permission)='field_operations'
      and sp.is_active=true
    left join public.staff_location_presence loc on loc.staff_id=p.user_id
    where p.role='staff' and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false) and not coalesce(p.banned,false)
      and public.wehouse_state_key(p.assigned_state)=public.wehouse_state_key(v_ir.property_state)
  ) ranked;
  return v_result;
end
$$;

create or replace function public.admin_assign_field_officer(
  p_inspection_id uuid,p_field_officer_id text,p_scheduled_date date default null
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor public.profiles; v_ir public.inspection_requests; v_officer public.profiles;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text and role in('staff','admin','creator')
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
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
$$;

create or replace function public.admin_review_my_branch_worker(
  p_worker_id text,p_decision text,p_reason text default null
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor public.profiles; v_worker public.profiles; v_ver public.worker_verifications;
begin
  v_actor:=public._admin_dashboard_actor();
  select * into v_worker from public.profiles
  where user_id=p_worker_id and role='worker' and not coalesce(deleted,false)
  for update;
  if v_worker.user_id is null then raise exception 'Worker not found'; end if;
  if v_actor.role='admin' and public.wehouse_state_key(v_worker.state)
     <>public.wehouse_state_key(v_actor.assigned_state) then
    raise exception 'Worker is outside your assigned State';
  end if;
  if v_worker.worker_status<>'profile_under_review' then
    raise exception 'Worker is not in the review queue';
  end if;
  select * into v_ver from public.worker_verifications where worker_id=p_worker_id limit 1;
  if p_decision='approve' then
    if not public.worker_identity_is_current(p_worker_id) then
      raise exception 'The current private face check has not passed'; end if;
    if v_ver.id is null or nullif(btrim(coalesce(v_ver.verification_video_url,'')),'') is null then
      raise exception 'Professional work evidence is incomplete'; end if;
    update public.profiles set worker_status='verified',worker_verified=true,
      available=true,updated_at=now(),updated_by=v_actor.user_id where user_id=p_worker_id;
    update public.worker_verifications set status='verified',reviewed_by=v_actor.user_id,
      reviewed_at=now(),updated_at=now() where id=v_ver.id;
  elsif p_decision='reject' then
    if nullif(btrim(coalesce(p_reason,'')),'') is null then
      raise exception 'Rejection reason is required'; end if;
    update public.profiles set worker_status='rejected',worker_verified=false,
      available=false,updated_at=now(),updated_by=v_actor.user_id where user_id=p_worker_id;
    update public.worker_verifications set status='rejected',reviewed_by=v_actor.user_id,
      review_notes=btrim(p_reason),reviewed_at=now(),updated_at=now() where id=v_ver.id;
  else raise exception 'Decision must be approve or reject'; end if;
  insert into public.worker_verification_reviews(
    worker_id,reviewer_id,reviewer_role,action,rejection_reason
  ) values(p_worker_id,v_actor.user_id,v_actor.role,
    case when p_decision='approve' then 'approved' else 'rejected' end,
    case when p_decision='reject' then btrim(p_reason) end);
end
$$;

-- Keep the execution registry aligned after CREATE OR REPLACE.
update public.function_execution_registry r set
  rationale=case when r.function_name in(
    'current_actor_in_scope','current_oversight_can_review_worker',
    'current_staff_can_review_worker'
  ) then 'State-scoped actor predicate; LGA is dispatch metadata only.'
  else 'State-scoped Admin/operations API; LGA may rank dispatch but never defines authority.' end,
  captured_at=now()
where r.function_name in(
  '_admin_dashboard_actor','_assert_admin_lga_scope','current_actor_in_scope',
  'current_oversight_can_review_worker','current_staff_can_review_worker',
  'admin_get_all_users','admin_get_all_workers','admin_get_my_branch_profiles',
  'admin_get_my_branch_stats','admin_get_my_branch_worker_booking_summaries',
  'admin_get_my_branch_worker_bookings','admin_count_branch_announcement_recipients',
  'admin_get_field_officers_for_inspection','admin_assign_field_officer',
  'admin_review_my_branch_worker'
);
