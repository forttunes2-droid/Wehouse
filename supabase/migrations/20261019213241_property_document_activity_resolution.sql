-- Resolve obsolete document tasks through the canonical audience records.
create function public.resolve_property_document_activity()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.inspection_requests;
begin
  if new.status is not distinct from old.status or new.status not in('submitted','approved') then return new; end if;
  select * into r from public.inspection_requests where id=new.request_id;
  if new.requirements_revision<>r.document_requirements_revision then return new; end if;
  update public.activity_event_audiences audience set resolved_at=coalesce(audience.resolved_at,now())
    from public.activity_events event,public.property_submission_documents prior
    where audience.activity_event_id=event.activity_event_id and audience.recipient_user_id=r.owner_id
      and audience.workspace='property_partner' and audience.domain='housing'
      and event.subject_type='inspection_request' and event.subject_id=r.id::text
      and event.event_type in('property.document.correction_required','property.document.rejected')
      and event.route_params->>'document_id'=prior.id::text and prior.request_id=r.id
      and prior.requirement_code=new.requirement_code;
  if not exists(
    select 1 from jsonb_array_elements(r.document_requirements) rule where not exists(
      select 1 from public.property_submission_documents doc where doc.request_id=r.id
        and doc.requirements_revision=r.document_requirements_revision and doc.requirement_code=rule->>'code'
        and doc.status in('submitted','approved','correction_required','rejected')
    )
  ) then
    update public.activity_event_audiences audience set resolved_at=coalesce(audience.resolved_at,now())
      from public.activity_events event where audience.activity_event_id=event.activity_event_id
        and audience.recipient_user_id=r.owner_id and audience.workspace='property_partner' and audience.domain='housing'
        and event.subject_type='inspection_request' and event.subject_id=r.id::text
        and event.event_type='property.document.requirements_ready';
  end if;
  -- An account cannot receive an actionable request to approve its own asset.
  update public.activity_event_audiences audience set resolved_at=coalesce(audience.resolved_at,now())
    from public.activity_events event where audience.activity_event_id=event.activity_event_id
      and audience.recipient_user_id=r.owner_id and audience.domain='property_operations'
      and event.subject_type='inspection_request' and event.subject_id=r.id::text
      and event.event_type like 'property.document.%.submitted';
  return new;
end $$;
revoke all on function public.resolve_property_document_activity() from public,anon,authenticated;
create trigger zz_property_document_activity_resolution after update of status on public.property_submission_documents
  for each row execute function public.resolve_property_document_activity();

create function public.resolve_revised_property_document_activity()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.document_requirements_revision=old.document_requirements_revision then return new; end if;
  update public.activity_event_audiences audience set resolved_at=coalesce(audience.resolved_at,now())
    from public.activity_events event where audience.activity_event_id=event.activity_event_id
      and event.subject_type='inspection_request' and event.subject_id=new.id::text
      and event.event_type like 'property.document.%'
      and (audience.domain='housing' and event.event_key<>('property_document_requirements:'||new.id::text||':'||new.document_requirements_revision)
        or audience.domain='property_operations' and exists(select 1 from public.property_submission_documents d
          where event.route_params->>'document_id'=d.id::text and d.request_id=new.id
            and d.requirements_revision<>new.document_requirements_revision));
  return new;
end $$;
revoke all on function public.resolve_revised_property_document_activity() from public,anon,authenticated;
create trigger zz_property_document_requirements_resolution after update of document_requirements_revision on public.inspection_requests
  for each row execute function public.resolve_revised_property_document_activity();
