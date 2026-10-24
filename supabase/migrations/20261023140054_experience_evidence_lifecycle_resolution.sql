create function private.resolve_inactive_experience_evidence() returns trigger
language plpgsql security definer set search_path='' as $$
declare document_id uuid;
begin
 if (new.status in ('draft','withdrawn','declined','archived') and old.status is distinct from new.status)
  or new.details is distinct from old.details then
  perform private.resolve_subject_activity('experience_evidence',new.id::text,null,null);
  for document_id in select id from public.experience_evidence_documents where activity_id=new.id loop
   perform private.resolve_subject_activity('experience_evidence',document_id::text,null,null);
  end loop;
 end if;
 return new;
end $$;
revoke all on function private.resolve_inactive_experience_evidence() from public,anon,authenticated;
create trigger experience_evidence_lifecycle_resolution after update of status,details on public.experience_activities for each row execute function private.resolve_inactive_experience_evidence();
