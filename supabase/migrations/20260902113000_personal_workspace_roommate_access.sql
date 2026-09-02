-- Roommate discovery is a Personal workspace capability. Privileged workspace
-- assignments must not remove it from a consumer identity.
create or replace function public.current_actor_has_personal_workspace()
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select exists(
    select 1
    from public.profiles p
    where p.auth_id=auth.uid()::text
      and p.account_kind='consumer'
      and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false)
      and not coalesce(p.banned,false)
  );
$$;

revoke all on function public.current_actor_has_personal_workspace() from public,anon;
grant execute on function public.current_actor_has_personal_workspace() to authenticated;

-- Compatibility repair for the existing roommate RPC family. These functions
-- pre-date additive workspaces and used profiles.role as an exclusive identity.
-- Preserve each function's canonical lifecycle logic while replacing only the
-- obsolete Personal-workspace gates and candidate filters.
do $$
declare
  fn record;
  definition text;
  original_definition text;
begin
  for fn in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like '%roommate%'
  loop
    original_definition:=pg_get_functiondef(fn.oid);
    definition:=original_definition;
    definition:=replace(definition, 'v_actor.role <> ''user''', 'not public.current_actor_has_personal_workspace()');
    definition:=replace(definition, 'v_actor.role<>''user''', 'not public.current_actor_has_personal_workspace()');
    definition:=replace(definition, 'actor.role <> ''user''', 'not public.current_actor_has_personal_workspace()');
    definition:=replace(definition, 'actor.role<>''user''', 'not public.current_actor_has_personal_workspace()');
    definition:=replace(definition, 'a.role <> ''user''', 'not public.current_actor_has_personal_workspace()');
    definition:=replace(definition, 'a.role<>''user''', 'not public.current_actor_has_personal_workspace()');
    definition:=replace(definition, 'p.role = ''user''', 'p.account_kind = ''consumer''');
    definition:=replace(definition, 'p.role=''user''', 'p.account_kind=''consumer''');
    definition:=replace(definition, 'c.role = ''user''', 'c.account_kind = ''consumer''');
    definition:=replace(definition, 'c.role=''user''', 'c.account_kind=''consumer''');
    definition:=replace(definition, 'AND role=''user''', 'AND account_kind=''consumer''');
    definition:=replace(definition, 'and role=''user''', 'and account_kind=''consumer''');
    if definition is distinct from original_definition then
      execute definition;
    end if;
  end loop;
end;
$$;
