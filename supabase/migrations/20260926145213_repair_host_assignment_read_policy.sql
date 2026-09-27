-- A policy that SELECTs property_host_assignments directly calls itself.
-- Keep the owner predicate in an unexposed schema; it accepts no actor ID.
create or replace function private.current_actor_owns_host_property(p_listing_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog'
as $$
  select exists (
    select 1 from public.property_host_assignments a
    where a.listing_id=p_listing_id
      and a.user_id=public.current_profile_user_id()
      and a.assignment_role='owner'
      and a.status='active'
  )
$$;
revoke all on function private.current_actor_owns_host_property(uuid) from public,anon;
grant execute on function private.current_actor_owns_host_property(uuid) to authenticated;

drop policy if exists property_host_assignments_read_own on public.property_host_assignments;
create policy property_host_assignments_read_own
on public.property_host_assignments for select to authenticated
using (
  user_id=public.current_profile_user_id()
  or private.current_actor_owns_host_property(listing_id)
);
