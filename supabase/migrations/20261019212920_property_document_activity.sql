-- Keep document work visible in the existing property queue and canonical Inbox.
create or replace function public.get_my_property_pipeline_v2(p_stage text default 'all')
returns jsonb language sql set search_path=pg_catalog,public as $$
  select coalesce(jsonb_agg(
    (item-'gps_latitude'-'gps_longitude'-'location_accuracy_m'-'latitude'-'longitude'-'accuracy') || jsonb_build_object(
      'property_display_name',ir.property_display_name,'submission_schema_version',ir.submission_schema_version,
      'submission_batch_id',ir.submission_batch_id,'hotel_program',coalesce(ir.hotel_program,'{}'::jsonb),
      'lifecycle_stage',ir.lifecycle_stage,'field_evidence_review_status',ir.field_evidence_review_status,
      'field_evidence_reviewed_by',ir.field_evidence_reviewed_by,'field_evidence_reviewed_at',ir.field_evidence_reviewed_at,
      'field_evidence_review_note',ir.field_evidence_review_note,'final_media_reviewed_at',ir.final_media_reviewed_at,
      'final_media_reviewed_by',ir.final_media_reviewed_by,'final_media_sources',ir.final_media_sources,
      'final_hotel_media_sources',ir.final_hotel_media_sources,'final_room_media_sources',ir.final_room_media_sources,
      'document_requirements_configured',ir.document_requirements is not null,
      'document_review_pending',(
        select count(*) from (
          select distinct on(requirement_code) status from public.property_submission_documents
          where request_id=ir.id and requirements_revision=ir.document_requirements_revision and status<>'abandoned'
          order by requirement_code,version desc
        ) latest where status='submitted'
      )
    ) order by (item->>'created_at')::timestamptz desc
  ),'[]'::jsonb)
  from jsonb_array_elements(public.get_my_property_pipeline('all')) item
  join public.inspection_requests ir on ir.id=(item->>'id')::uuid
  where p_stage='all'
    or(p_stage='new' and ir.lifecycle_stage in('access_required','access_review','inspection_ready'))
    or(p_stage='inspection' and ir.lifecycle_stage='inspection')
    or(p_stage='review' and ir.lifecycle_stage='awaiting_review')
    or(p_stage='ready' and ir.lifecycle_stage='ready_to_prepare')
    or(p_stage='preparing' and ir.lifecycle_stage='listing_prepared')
    or(p_stage='published' and ir.lifecycle_stage='live')
    or(p_stage='rejected' and ir.lifecycle_stage in('changes_requested','rejected'));
$$;

create function public.notify_property_document_activity()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare r public.inspection_requests; event_id uuid; label text;
begin
  if new.status is not distinct from old.status then return new; end if;
  select * into r from public.inspection_requests where id=new.request_id;
  if new.requirements_revision<>r.document_requirements_revision then return new; end if;
  select value->>'label' into label from jsonb_array_elements(r.document_requirements) where value->>'code'=new.requirement_code;
  update public.inspection_requests set updated_at=now() where id=r.id;
  if new.status='submitted' then
    event_id:=private.upsert_activity_event('property_document_review:'||r.id::text||':'||new.requirement_code,
      'property.document.'||new.requirement_code||'.submitted','inspection_request',r.id::text,new.submitted_by,
      'Property document needs review',concat_ws(' · ',r.request_code,label),'operations_properties',
      jsonb_build_object('inspection_id',r.id,'document_id',new.id),now());
    perform private.fanout_team_activity(event_id,'property_operations',r.property_state,r.property_city,true);
  elsif new.status in('approved','correction_required','rejected','abandoned') then
    perform private.resolve_subject_activity('inspection_request',r.id::text,'property.document.'||new.requirement_code||'.submitted','property_operations');
    if new.status<>'abandoned' then
      event_id:=private.upsert_activity_event('property_document_decision:'||new.id::text||':'||new.status,
        'property.document.'||new.status,'inspection_request',r.id::text,new.reviewed_by,
        case new.status when 'approved' then 'Property document approved' when 'correction_required' then 'Property document needs correction' else 'Property document rejected' end,
        concat_ws(' · ',r.request_code,label),'property_partner',jsonb_build_object('inspection_id',r.id,'document_id',new.id),now());
      perform private.add_activity_audience(event_id,r.owner_id,'property_partner','housing',r.property_state,new.status<>'approved');
    end if;
  end if;
  return new;
end $$;
revoke all on function public.notify_property_document_activity() from public,anon,authenticated;
create trigger property_document_activity after update of status on public.property_submission_documents
  for each row execute function public.notify_property_document_activity();

create function public.notify_property_document_requirements()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare event_id uuid;
begin
  if new.document_requirements_revision=old.document_requirements_revision then return new; end if;
  if new.document_requirements is null then
    event_id:=private.upsert_activity_event('property_document_setup:'||new.id::text,
      'property.document.requirements_needed','inspection_request',new.id::text,new.owner_id,
      'Property document requirements need review',new.request_code,'operations_properties',jsonb_build_object('inspection_id',new.id),now());
    perform private.fanout_team_activity(event_id,'property_operations',new.property_state,new.property_city,true);
  else
    perform private.resolve_subject_activity('inspection_request',new.id::text,'property.document.requirements_needed','property_operations');
    event_id:=private.upsert_activity_event('property_document_requirements:'||new.id::text||':'||new.document_requirements_revision,
      'property.document.requirements_ready','inspection_request',new.id::text,new.document_requirements_set_by,
      'WeHouse needs property documents',new.request_code,'property_partner',jsonb_build_object('inspection_id',new.id),now());
    perform private.add_activity_audience(event_id,new.owner_id,'property_partner','housing',new.property_state,true);
  end if;
  return new;
end $$;
revoke all on function public.notify_property_document_requirements() from public,anon,authenticated;
create trigger property_document_requirements_activity after update of document_requirements_revision on public.inspection_requests
  for each row execute function public.notify_property_document_requirements();
