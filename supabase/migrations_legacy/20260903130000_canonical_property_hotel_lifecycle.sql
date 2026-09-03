-- One authoritative lifecycle for partner property and hotel submissions.
-- Operations Admin reviews access evidence; Creator retains oversight/override.
-- Field Officers only receive independently inspected work after that review.

alter table public.inspection_requests
  add column if not exists lifecycle_stage text not null default 'access_required';

alter table public.inspection_requests
  drop constraint if exists inspection_requests_lifecycle_stage_check;
alter table public.inspection_requests
  add constraint inspection_requests_lifecycle_stage_check check (lifecycle_stage in (
    'access_required','access_review','inspection_ready','inspection','visit_reviewed',
    'listing_prepared','live','changes_requested','rejected'
  ));

create or replace function public.sync_property_submission_lifecycle()
returns trigger
language plpgsql
security invoker
set search_path='pg_catalog','public'
as $$
begin
  -- Publication is the terminal successful state. Before publication, evidence
  -- state takes precedence so assigned legacy rows cannot look approved.
  new.lifecycle_stage := case
    when new.published_at is not null then 'live'
    when lower(coalesce(new.status,''))='rejected' then 'rejected'
    when new.access_evidence_status='rejected' then 'changes_requested'
    when new.access_evidence_status is null or new.access_evidence_status='required' then 'access_required'
    when new.access_evidence_status='submitted' then 'access_review'
    when new.draft_listing_id is not null or new.draft_hotel_id is not null then 'listing_prepared'
    when new.completed_at is not null or lower(coalesce(new.status,'')) in ('completed','approved') then 'visit_reviewed'
    when coalesce(new.assigned_field_officer_id,new.field_officer_id,new.assigned_to) is not null
      or new.scheduled_date is not null or lower(coalesce(new.status,'')) in ('scheduled','in_progress') then 'inspection'
    when new.access_evidence_status='verified' then 'inspection_ready'
    else 'access_required'
  end;

  -- A recording code belongs to the private challenge record. A submitted
  -- inspection request must never expose it again to the Property Partner.
  new.access_challenge_code := null;
  new.access_challenge_expires_at := null;
  return new;
end;
$$;

drop trigger if exists sync_property_submission_lifecycle on public.inspection_requests;
create trigger sync_property_submission_lifecycle
before insert or update of status,access_evidence_status,access_evidence_video_path,
  assigned_field_officer_id,field_officer_id,assigned_to,scheduled_date,completed_at,
  draft_listing_id,draft_hotel_id,published_at
on public.inspection_requests
for each row execute function public.sync_property_submission_lifecycle();

revoke all on function public.sync_property_submission_lifecycle() from public,anon,authenticated;

-- Reconcile every existing test row without pretending missing evidence was
-- accepted. The lifecycle trigger intentionally lets evidence truth outrank an
-- old assignment or scheduled date.
update public.inspection_requests set
  access_challenge_code=null,
  access_challenge_expires_at=null,
  lifecycle_stage=case
    when published_at is not null then 'live'
    when lower(coalesce(status,''))='rejected' then 'rejected'
    when access_evidence_status='rejected' then 'changes_requested'
    when access_evidence_status is null or access_evidence_status='required' then 'access_required'
    when access_evidence_status='submitted' then 'access_review'
    when draft_listing_id is not null or draft_hotel_id is not null then 'listing_prepared'
    when completed_at is not null or lower(coalesce(status,'')) in ('completed','approved') then 'visit_reviewed'
    when coalesce(assigned_field_officer_id,field_officer_id,assigned_to) is not null
      or scheduled_date is not null or lower(coalesce(status,'')) in ('scheduled','in_progress') then 'inspection'
    when access_evidence_status='verified' then 'inspection_ready'
    else 'access_required'
  end,
  updated_at=now();

-- A pre-launch test assignment made before evidence enforcement must return to
-- review instead of remaining in a Field Officer queue.
update public.inspection_requests set
  assigned_to=null,
  field_officer_id=null,
  assigned_field_officer_id=null,
  assigned_at=null,
  scheduled_date=null,
  status='pending',
  notes=concat_ws(E'\n',nullif(notes,''),'Returned to access review: no approved partner access evidence.'),
  updated_at=now()
where access_evidence_status<>'verified'
  and lower(coalesce(status,'')) in ('pending','scheduled','in_progress')
  and completed_at is null and draft_listing_id is null and draft_hotel_id is null and published_at is null
  and coalesce(assigned_field_officer_id,field_officer_id,assigned_to) is not null;

-- Enforce the separation of duties regardless of legacy nullable fields.
create or replace function public.enforce_property_access_before_assignment()
returns trigger
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
begin
  if coalesce(new.assigned_field_officer_id,new.field_officer_id,new.assigned_to) is not null
  and (
    coalesce(new.assigned_field_officer_id,new.field_officer_id,new.assigned_to)
      is distinct from coalesce(old.assigned_field_officer_id,old.field_officer_id,old.assigned_to)
    or lower(coalesce(new.status,'')) in ('scheduled','in_progress')
       and lower(coalesce(old.status,'')) not in ('scheduled','in_progress')
  ) and new.access_evidence_status <> 'verified' then
    raise exception 'Operations Admin must approve the private access recording before assigning a Field Officer';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_property_access_before_assignment() from public,anon,authenticated;

-- Old browser-callable paths created competing submission and assignment
-- contracts. Keep them for migration history/service recovery, not app use.
revoke execute on function public.create_my_property_inspection_request(text,text,text,text,integer,integer,numeric,text,text,text[],numeric,numeric) from authenticated;
revoke execute on function public.create_my_property_inspection_request_v2(text,text,text,text,integer,integer,numeric,text,text,text[],numeric,numeric,numeric) from authenticated;
revoke execute on function public.create_my_property_inspection_batch(jsonb) from authenticated;
revoke execute on function public.create_my_property_inspection_batch_v2(jsonb) from authenticated;
revoke execute on function public.create_my_property_inspection_batch_v3(jsonb) from authenticated;
revoke execute on function public.assign_partner_inspection(uuid,text,date) from authenticated;
revoke execute on function public.admin_create_hotel_from_inspection(uuid,text,text,text[]) from authenticated;

-- Hotel preparation deliberately creates a non-public draft. The existing
-- hotels_one_per_inspection_idx already prevents duplicate preparation.
alter table public.hotels drop constraint if exists hotels_status_check;
alter table public.hotels add constraint hotels_status_check
  check(status in ('draft','active','inactive'));

create or replace function public.get_my_property_pipeline_v2(p_stage text default 'all')
returns jsonb
language sql
security invoker
set search_path='pg_catalog','public'
as $$
  select coalesce(
    jsonb_agg(
      item || jsonb_build_object(
        'submission_schema_version',ir.submission_schema_version,
        'submission_batch_id',ir.submission_batch_id,
        'hotel_program',coalesce(ir.hotel_program,'{}'::jsonb),
        'lifecycle_stage',ir.lifecycle_stage
      ) order by (item->>'created_at')::timestamptz desc
    ),'[]'::jsonb
  )
  from jsonb_array_elements(public.get_my_property_pipeline('all')) item
  join public.inspection_requests ir on ir.id=(item->>'id')::uuid
  where p_stage='all'
     or (p_stage='new' and ir.lifecycle_stage in ('access_required','access_review','inspection_ready'))
     or (p_stage='inspection' and ir.lifecycle_stage='inspection')
     or (p_stage='ready' and ir.lifecycle_stage='visit_reviewed')
     or (p_stage='preparing' and ir.lifecycle_stage='listing_prepared')
     or (p_stage='published' and ir.lifecycle_stage='live')
     or (p_stage='rejected' and ir.lifecycle_stage in ('changes_requested','rejected'));
$$;
revoke all on function public.get_my_property_pipeline_v2(text) from public,anon;
grant execute on function public.get_my_property_pipeline_v2(text) to authenticated;

-- Only scoped Operations Admin and Creator may decide access evidence. Creator
-- can override a previous evidence decision; Admin handles the normal review.
create or replace function public.review_property_access_evidence(
  p_request_id uuid,p_decision text,p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare v_actor public.profiles; v_request public.inspection_requests; v_status text; v_override boolean;
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text
    and role in ('creator','admin') and not coalesce(deleted,false)
    and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor is null then raise exception 'Operations Admin or Creator access required'; end if;
  select * into v_request from public.inspection_requests where id=p_request_id for update;
  if v_request.id is null then raise exception 'Property request not found'; end if;
  if v_actor.role='admin' and not public.current_actor_in_scope(v_request.property_state,v_request.property_city)
    then raise exception 'Property is outside your assigned area'; end if;
  if v_request.access_evidence_video_path is null then raise exception 'No private access recording to review'; end if;
  if p_decision not in ('accept','reject') then raise exception 'Choose accept or reject'; end if;
  if p_decision='reject' and nullif(btrim(coalesce(p_note,'')),'') is null
    then raise exception 'Explain what the Property Partner must record again'; end if;
  v_override := v_request.access_evidence_status in ('verified','rejected');
  if v_override and coalesce(v_request.assigned_field_officer_id,v_request.field_officer_id,v_request.assigned_to) is not null
    then raise exception 'Access evidence cannot be overridden after a Field Officer has been assigned'; end if;
  if v_actor.role='admin' and v_request.access_evidence_status<>'submitted'
    then raise exception 'Creator review is required to override an existing evidence decision'; end if;
  if v_actor.role='creator' and v_request.access_evidence_status not in ('submitted','verified','rejected')
    then raise exception 'No submitted evidence decision is available'; end if;
  v_status:=case when p_decision='accept' then 'verified' else 'rejected' end;
  update public.inspection_requests set access_evidence_status=v_status,
    access_evidence_verified_at=case when v_status='verified' then now() else null end,
    access_evidence_verified_by=case when v_status='verified' then v_actor.user_id else null end,
    rejection_reason=case when v_status='rejected' then btrim(p_note) else null end,
    updated_at=now() where id=p_request_id;
  insert into public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
  values(case when v_override then 'PROPERTY_ACCESS_EVIDENCE_OVERRIDDEN'
              when v_status='verified' then 'PROPERTY_ACCESS_EVIDENCE_ACCEPTED'
              else 'PROPERTY_ACCESS_EVIDENCE_REJECTED' end,
    'inspection_requests',p_request_id::text,
    jsonb_build_object('decision',p_decision,'note',nullif(btrim(coalesce(p_note,'')),''),'previous_status',v_request.access_evidence_status)::text,
    v_actor.user_id,v_actor.email);
  return jsonb_build_object('success',true,'status',v_status,'override',v_override);
end;
$$;
revoke all on function public.review_property_access_evidence(uuid,text,text) from public,anon;
grant execute on function public.review_property_access_evidence(uuid,text,text) to authenticated;
