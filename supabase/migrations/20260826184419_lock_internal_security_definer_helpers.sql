do $$
declare
  v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.prosecdef
      and (p.proname like '\_%' escape '\' or p.prorettype='trigger'::regtype)
  loop
    execute format('revoke execute on function %s from public, anon, authenticated',v_function);
  end loop;
end;
$$;

alter default privileges for role postgres in schema public revoke execute on functions from public;
