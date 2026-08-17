DO $$
DECLARE fn record;
BEGIN
  FOR fn IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'EXECUTE')
  LOOP EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon',fn.signature); END LOOP;
END
$$;
