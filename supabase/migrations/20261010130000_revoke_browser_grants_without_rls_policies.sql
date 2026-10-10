-- Close inherited browser-role table grants on RLS-protected tables that intentionally
-- have no row policies, and prevent future postgres-owned public tables from inheriting
-- broad API grants. Existing tables with deliberate policies and service_role are unchanged.

alter default privileges for role postgres in schema public
  revoke all privileges on tables from public, anon, authenticated;

do $$
declare
  target record;
begin
  for target in
    select n.nspname, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p')
      and n.nspname in ('public', 'private')
      and c.relrowsecurity
      and not exists (
        select 1
        from pg_policies policy
        where policy.schemaname = n.nspname
          and policy.tablename = c.relname
      )
  loop
    execute format(
      'revoke all privileges on table %I.%I from public, anon, authenticated',
      target.nspname,
      target.relname
    );
  end loop;
end;
$$;

