-- Creator is an authorization workspace, not necessarily the identity's
-- exclusive profile.role.
create or replace function public.rename_service_subcategory(p_subcategory_id uuid,p_name text)
returns public.service_subcategories language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare actor public.profiles;old_name text;result public.service_subcategories;
begin
  select * into actor from public.profiles where auth_id=auth.uid()::text limit 1;
  if actor is null or not public.is_current_creator() then raise exception 'Creator authorization required';end if;
  if nullif(btrim(p_name),'') is null then raise exception 'Service name is required';end if;
  select name into old_name from public.service_subcategories where id=p_subcategory_id for update;
  if old_name is null then raise exception 'Service not found';end if;
  update public.service_subcategories set name=btrim(p_name),updated_at=now() where id=p_subcategory_id returning * into result;
  update public.worker_bookings set service_type=result.name where service_subcategory_id=p_subcategory_id or(service_subcategory_id is null and lower(btrim(coalesce(service_type,'')))=lower(btrim(old_name)));
  update public.profiles p set worker_skills=(select coalesce(jsonb_agg(case when lower(btrim(skill))=lower(btrim(old_name)) then result.name else skill end),'[]'::jsonb) from jsonb_array_elements_text(coalesce(p.worker_skills,'[]'::jsonb)) skill),updated_at=now()
  where exists(select 1 from jsonb_array_elements_text(coalesce(p.worker_skills,'[]'::jsonb)) skill where lower(btrim(skill))=lower(btrim(old_name)));
  return result;
end $$;
revoke all on function public.rename_service_subcategory(uuid,text) from public,anon;
grant execute on function public.rename_service_subcategory(uuid,text) to authenticated,service_role;
