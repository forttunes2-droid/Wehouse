-- Move current Creator settings, finance and audit access from legacy
-- profiles.role authority to active additive workspace grants.

create or replace function public.is_current_creator()
returns boolean
language sql
stable security definer
set search_path to 'pg_catalog','public'
as $$
  select public.current_actor_has_workspace('creator',null)
$$;

drop policy if exists commission_ledger_creator_select on public.commission_ledger;
create policy commission_ledger_creator_select
on public.commission_ledger
for select to authenticated
using (public.current_actor_has_workspace('creator',null));

drop policy if exists admin_audit_read_canonical on public.admin_audit_log;
create policy admin_audit_read_canonical
on public.admin_audit_log
for select to authenticated
using (
  public.current_actor_has_workspace('creator',null)
  or admin_id=public.current_profile_user_id()
);

drop policy if exists admin_audit_insert_canonical on public.admin_audit_log;
create policy admin_audit_insert_canonical
on public.admin_audit_log
for insert to authenticated
with check (
  admin_id=public.current_profile_user_id()
  and (
    public.current_actor_has_workspace('creator',null)
    or public.current_actor_has_workspace('admin',null)
    or public.current_actor_has_workspace('staff',null)
  )
);
