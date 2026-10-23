-- Close expiry tasks only after all current requirements are approved again.
create or replace function private.invalidate_property_document_publication()
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
 else
  perform private.resolve_subject_activity('inspection_request',request_id::text,'property.document.expired','property_partner');
  perform private.resolve_subject_activity('inspection_request',request_id::text,'property.document.expiry_review','property_operations');
 end if;
 return new;
end $$;
revoke all on function private.invalidate_property_document_publication() from public,anon,authenticated;
