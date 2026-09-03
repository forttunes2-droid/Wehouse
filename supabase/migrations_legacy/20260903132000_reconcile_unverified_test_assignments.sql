-- Reconcile assignments created through retired pre-launch paths.
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
