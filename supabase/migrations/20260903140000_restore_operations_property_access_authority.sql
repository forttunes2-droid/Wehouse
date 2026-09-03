-- Operations Staff owns the normal property-access review and Field Officer
-- assignment. Admin and Creator retain higher oversight and may override an
-- evidence decision before an inspection is assigned.

create or replace function public.get_property_access_review_details(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_request public.inspection_requests;
  v_code text;
begin
  select * into v_actor
  from public.profiles
  where auth_id=auth.uid()::text
    and role in ('staff','admin','creator')
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;

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

  return jsonb_build_object(
    'status',v_request.access_evidence_status,
    'video_path',v_request.access_evidence_video_path,
    'submitted_at',v_request.access_evidence_submitted_at,
    'code',v_code
  );
end;
$$;
revoke all on function public.get_property_access_review_details(uuid) from public,anon;
grant execute on function public.get_property_access_review_details(uuid) to authenticated;

create or replace function public.review_property_access_evidence(
  p_request_id uuid,p_decision text,p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_request public.inspection_requests;
  v_status text;
  v_override boolean;
begin
  select * into v_actor
  from public.profiles
  where auth_id=auth.uid()::text
    and role in ('staff','admin','creator')
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;

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
$$;
revoke all on function public.review_property_access_evidence(uuid,text,text) from public,anon;
grant execute on function public.review_property_access_evidence(uuid,text,text) to authenticated;

create or replace function public.admin_get_field_officers_for_inspection(p_inspection_id uuid)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_ir public.inspection_requests;
  v_result jsonb;
begin
  select * into v_actor
  from public.profiles
  where auth_id=auth.uid()::text
    and role in ('staff','admin','creator')
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor is null or (v_actor.role='staff' and not public.current_staff_has_permission('operations')) then
    raise exception 'Operations Staff, Admin or Creator access required';
  end if;

  select * into v_ir from public.inspection_requests where id=p_inspection_id;
  if v_ir.id is null then raise exception 'Inspection request not found'; end if;
  if v_actor.role<>'creator' and not public.current_actor_in_scope(v_ir.property_state,v_ir.property_city) then
    raise exception 'Inspection is outside your assigned branch';
  end if;

  select coalesce(
    jsonb_agg(x order by (x->>'distance_km')::numeric nulls last,(x->>'active_inspections')::int,coalesce(x->>'name','')),
    '[]'::jsonb
  ) into v_result
  from (
    select jsonb_build_object(
      'user_id',p.user_id,
      'name',coalesce(p.full_name,p.username,p.email),
      'email',p.email,
      'assigned_state',p.assigned_state,
      'assigned_lga',p.assigned_lga,
      'active_inspections',(
        select count(*) from public.inspection_requests q
        where coalesce(q.assigned_field_officer_id,q.field_officer_id,q.assigned_to)=p.user_id
          and q.status in ('scheduled','in_progress')
      ),
      'location_captured_at',loc.captured_at,
      'distance_km',case
        when v_ir.gps_latitude is not null and v_ir.gps_longitude is not null
          and loc.latitude is not null and loc.longitude is not null
          and loc.captured_at > now()-interval '24 hours'
        then round((6371*2*asin(sqrt(
          power(sin(radians((loc.latitude-v_ir.gps_latitude)/2)),2)
          +cos(radians(v_ir.gps_latitude))*cos(radians(loc.latitude))
          *power(sin(radians((loc.longitude-v_ir.gps_longitude)/2)),2)
        )))::numeric,2)
        else null
      end
    ) x
    from public.profiles p
    join public.staff_permissions sp
      on sp.staff_id=p.user_id and sp.permission='field_officer' and sp.is_active=true
    left join public.staff_location_presence loc on loc.staff_id=p.user_id
    where p.role='staff'
      and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false)
      and not coalesce(p.banned,false)
      and lower(coalesce(p.assigned_state,''))=lower(coalesce(v_ir.property_state,''))
      and lower(coalesce(p.assigned_lga,''))=lower(coalesce(v_ir.property_city,''))
  ) ranked;
  return v_result;
end;
$$;
revoke all on function public.admin_get_field_officers_for_inspection(uuid) from public,anon;
grant execute on function public.admin_get_field_officers_for_inspection(uuid) to authenticated;

create or replace function public.admin_assign_field_officer(
  p_inspection_id uuid,p_field_officer_id text,p_scheduled_date date default null
) returns void
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_ir public.inspection_requests;
  v_officer public.profiles;
begin
  select * into v_actor
  from public.profiles
  where auth_id=auth.uid()::text
    and role in ('staff','admin','creator')
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor is null or (v_actor.role='staff' and not public.current_staff_has_permission('operations')) then
    raise exception 'Operations Staff, Admin or Creator access required';
  end if;

  select * into v_ir from public.inspection_requests where id=p_inspection_id for update;
  if v_ir.id is null then raise exception 'Inspection request not found'; end if;
  if v_ir.access_evidence_status<>'verified' then
    raise exception 'Access evidence must be approved before assigning a Field Officer';
  end if;
  if v_actor.role<>'creator' and not public.current_actor_in_scope(v_ir.property_state,v_ir.property_city) then
    raise exception 'Inspection is outside your assigned branch';
  end if;

  select * into v_officer from public.profiles where user_id=p_field_officer_id;
  if v_officer.id is null or v_officer.role<>'staff'
    or lower(coalesce(v_officer.assigned_state,''))<>lower(coalesce(v_ir.property_state,''))
    or lower(coalesce(v_officer.assigned_lga,''))<>lower(coalesce(v_ir.property_city,''))
    or not exists(
      select 1 from public.staff_permissions sp
      where sp.staff_id=v_officer.user_id and sp.permission='field_officer' and sp.is_active=true
    ) then
    raise exception 'Field Officer must be active and assigned to the same LGA as the property';
  end if;

  update public.inspection_requests
  set assigned_to=v_officer.user_id,
      field_officer_id=v_officer.user_id,
      assigned_field_officer_id=v_officer.user_id,
      assigned_at=now(),
      scheduled_date=p_scheduled_date,
      status='scheduled',
      updated_at=now()
  where id=p_inspection_id;
end;
$$;
revoke all on function public.admin_assign_field_officer(uuid,text,date) from public,anon;
grant execute on function public.admin_assign_field_officer(uuid,text,date) to authenticated;
