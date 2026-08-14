BEGIN;

-- Phase 1 API-surface cleanup.
-- Internal helpers stay callable by SECURITY DEFINER server functions, but are
-- not exposed as browser RPC endpoints. Trigger functions are trigger-only.
REVOKE ALL ON FUNCTION public._assert_admin_lga_scope(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._can_access_conversation(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._conversation_route_allowed(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._current_comm_actor() FROM PUBLIC, anon, authenticated;

-- Retired legacy inspection state machine. It trusted caller-supplied actor
-- identity/role and is superseded by scoped inspection RPCs.
REVOKE ALL ON FUNCTION public.transition_inspection_status(uuid,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_inspection_status(uuid,text,text,text,text) TO service_role;

-- SECURITY DEFINER trigger functions must never be direct API endpoints.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS fn
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.prosecdef=true
      AND p.prorettype='trigger'::regtype
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.fn);
  END LOOP;
END $$;

COMMIT;
