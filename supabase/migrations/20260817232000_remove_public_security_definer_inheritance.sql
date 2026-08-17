DO $$
DECLARE fn record;
BEGIN
  FOR fn IN SELECT p.oid,p.oid::regprocedure AS signature,EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgfoid=p.oid AND NOT t.tgisinternal) AS is_trigger_function FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon',fn.signature);
    IF NOT fn.is_trigger_function THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',fn.signature); END IF;
  END LOOP;
END
$$;
