begin;
-- Reuse the publication authority. A document upload is not approval, and an
-- expired approval must not authorize another reservation after publication.
create function private.property_documents_current(p_request_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 perform public._assert_property_documents_ready(p_request_id);
 return true;
exception when raise_exception then return false;
end $$;
revoke all on function private.property_documents_current(uuid) from public,anon,authenticated;

create function private.guard_new_property_booking_documents()
returns trigger language plpgsql security definer set search_path='' as $$
declare request_id uuid;
begin
 if tg_table_name='reservations' then
  if tg_op='UPDATE' and new.listing_id is not distinct from old.listing_id then return new;end if;
  select l.inspection_request_id into request_id from public.listings l
   where l.id::text=new.listing_id or l.listing_id=new.listing_id
   order by (l.id::text=new.listing_id) desc limit 1;
 else
  if tg_op='UPDATE' and new.hotel_id is not distinct from old.hotel_id then return new;end if;
  select h.inspection_request_id into request_id from public.hotels h where h.hotel_id=new.hotel_id;
 end if;
 if request_id is null or not private.property_documents_current(request_id) then
  raise exception 'This property needs current document approval before accepting a new booking';
 end if;
 return new;
end $$;
revoke all on function private.guard_new_property_booking_documents() from public,anon,authenticated;
create trigger aa_reservation_document_eligibility before insert or update of listing_id on public.reservations
 for each row execute function private.guard_new_property_booking_documents();
create trigger aa_hotel_document_eligibility before insert or update of hotel_id on public.hotel_bookings
 for each row execute function private.guard_new_property_booking_documents();

create function private.pause_property_for_document_review(p_request_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare changed_listings integer;changed_hotels integer;
begin
 update public.listings set
  status=case when status='available' then 'pending_approval' else status end,
  availability_status=case when availability_status='available' then 'pending_approval' else availability_status end,
  updated_at=now()
 where inspection_request_id=p_request_id and (status='available' or availability_status='available');
 get diagnostics changed_listings=row_count;
 update public.hotels set status='inactive',updated_at=now()
 where inspection_request_id=p_request_id and status='active';
 get diagnostics changed_hotels=row_count;
 return changed_listings+changed_hotels>0;
end $$;
revoke all on function private.pause_property_for_document_review(uuid) from public,anon,authenticated;

create function private.invalidate_property_document_publication()
returns trigger language plpgsql security definer set search_path='' as $$
declare request_id uuid;
begin
 if tg_table_name='inspection_requests' then
  if new.document_requirements_revision=old.document_requirements_revision then return new;end if;
  request_id:=new.id;
 else request_id:=new.request_id;
 end if;
 if not private.property_documents_current(request_id) then
  perform private.pause_property_for_document_review(request_id);
 end if;
 return new;
end $$;
revoke all on function private.invalidate_property_document_publication() from public,anon,authenticated;
create trigger property_document_publication_invalidation after insert or update of status on public.property_submission_documents
 for each row execute function private.invalidate_property_document_publication();
create trigger property_requirement_publication_invalidation after update of document_requirements_revision on public.inspection_requests
 for each row execute function private.invalidate_property_document_publication();

create function private.expire_property_documents()
returns integer language plpgsql security definer set search_path='' as $$
declare r public.inspection_requests;event_id uuid;changed integer:=0;
begin
 for r in select request.* from public.inspection_requests request
  where exists(select 1 from public.property_submission_documents d
   where d.request_id=request.id and d.requirements_revision=request.document_requirements_revision
    and d.status='approved' and d.expires_at<=now()
    and not exists(select 1 from public.property_submission_documents newer
     where newer.request_id=d.request_id and newer.requirements_revision=d.requirements_revision
      and newer.requirement_code=d.requirement_code and newer.version>d.version and newer.status<>'abandoned'))
  and (exists(select 1 from public.listings l where l.inspection_request_id=request.id and (l.status='available' or l.availability_status='available'))
   or exists(select 1 from public.hotels h where h.inspection_request_id=request.id and h.status='active'))
  order by request.id for update of request skip locked limit 100
 loop
  if not private.property_documents_current(r.id) and private.pause_property_for_document_review(r.id) then
   event_id:=private.upsert_activity_event('property_document_expired:'||r.id::text||':'||r.document_requirements_revision,
    'property.document.expired','inspection_request',r.id::text,null,
    'Property document approval expired','New bookings are paused. Submit current evidence for review.',
    'property_partner',jsonb_build_object('inspection_id',r.id),now());
   perform private.add_activity_audience(event_id,r.owner_id,'property_partner','housing',r.property_state,true);
   event_id:=private.upsert_activity_event('property_document_expiry_review:'||r.id::text||':'||r.document_requirements_revision,
    'property.document.expiry_review','inspection_request',r.id::text,null,
    'Expired property evidence needs review',r.request_code,
    'operations_properties',jsonb_build_object('inspection_id',r.id),now());
   perform private.fanout_team_activity(event_id,'property_operations',r.property_state,r.property_city,true);
   changed:=changed+1;
  end if;
 end loop;
 return changed;
end $$;
revoke all on function private.expire_property_documents() from public,anon,authenticated;
grant execute on function private.expire_property_documents() to service_role;
create index property_documents_expiry_idx on public.property_submission_documents(expires_at,request_id)
 where status='approved' and expires_at is not null;
select cron.schedule('wehouse-property-document-expiry','* * * * *','select private.expire_property_documents()');
commit;
