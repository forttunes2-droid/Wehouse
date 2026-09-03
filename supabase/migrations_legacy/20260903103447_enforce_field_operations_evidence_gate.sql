create or replace function public.require_independent_field_evidence()
returns trigger
language plpgsql
set search_path = 'pg_catalog', 'public'
as $function$
begin
  if new.status in ('completed', 'approved')
     and old.status is distinct from new.status
     and cardinality(coalesce(new.field_photo_urls, array[]::text[]))
         + cardinality(coalesce(new.field_video_urls, array[]::text[])) = 0 then
    raise exception 'Independent Field Operations photo or video evidence is required';
  end if;

  return new;
end;
$function$;

drop trigger if exists inspection_requests_require_field_evidence
  on public.inspection_requests;
create trigger inspection_requests_require_field_evidence
before update of status on public.inspection_requests
for each row
execute function public.require_independent_field_evidence();

revoke all on function public.require_independent_field_evidence()
  from public, anon, authenticated;
grant execute on function public.require_independent_field_evidence()
  to service_role;
