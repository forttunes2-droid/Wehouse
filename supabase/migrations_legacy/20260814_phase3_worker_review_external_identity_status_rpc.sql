CREATE OR REPLACE FUNCTION public.admin_get_worker_review_identity_status(p_worker_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor public.profiles;
  v_worker public.profiles;
  v_ver public.worker_verifications;
BEGIN
  v_actor := public._admin_dashboard_actor();

  SELECT * INTO v_worker
  FROM public.profiles
  WHERE user_id=p_worker_id
    AND role='worker'
    AND COALESCE(deleted,false)=false
  LIMIT 1;

  IF v_worker IS NULL THEN
    RAISE EXCEPTION 'Worker not found';
  END IF;

  IF v_actor.role='admin' AND (
    v_worker.state IS DISTINCT FROM v_actor.assigned_state
    OR COALESCE(NULLIF(v_worker.local_government,''),NULLIF(v_worker.city,'')) IS DISTINCT FROM v_actor.assigned_lga
  ) THEN
    RAISE EXCEPTION 'Worker is outside your assigned branch';
  END IF;

  SELECT * INTO v_ver
  FROM public.worker_verifications
  WHERE worker_id=p_worker_id
  ORDER BY created_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'identity_status', COALESCE(v_ver.identity_status,'not_started'),
    'identity_provider', v_ver.identity_provider,
    'identity_checked_at', v_ver.identity_checked_at,
    'identity_failure_reason', v_ver.identity_failure_reason
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_worker_review_identity_status(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_worker_review_identity_status(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_get_worker_review_identity_status(text) TO authenticated;
