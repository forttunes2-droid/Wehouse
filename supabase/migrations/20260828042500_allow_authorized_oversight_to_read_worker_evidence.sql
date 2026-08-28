create or replace function public.current_oversight_can_review_worker(p_worker_id text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_worker public.profiles;
begin
  select * into v_actor
  from public.profiles
  where auth_id=auth.uid()::text
    and role in ('creator','admin')
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;

  if v_actor is null then return false; end if;

  select * into v_worker
  from public.profiles
  where user_id=p_worker_id and role='worker'
  limit 1;

  if v_worker is null then return false; end if;
  if v_actor.role='creator' then return true; end if;

  return lower(btrim(coalesce(v_worker.state,'')))=lower(btrim(coalesce(v_actor.assigned_state,'')))
    and lower(btrim(coalesce(v_worker.local_government,v_worker.city,'')))=lower(btrim(coalesce(v_actor.assigned_lga,'')));
end;
$$;

revoke execute on function public.current_oversight_can_review_worker(text) from public,anon;
grant execute on function public.current_oversight_can_review_worker(text) to authenticated,service_role;

drop policy if exists worker_professional_evidence_oversight_read on storage.objects;
create policy worker_professional_evidence_oversight_read
on storage.objects
for select
to authenticated
using (
  bucket_id in ('worker-certificates','worker-verification-videos')
  and public.current_oversight_can_review_worker((storage.foldername(name))[1])
);
