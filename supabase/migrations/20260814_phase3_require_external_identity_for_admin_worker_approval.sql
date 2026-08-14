CREATE OR REPLACE FUNCTION public.admin_review_my_branch_worker(
  p_worker_id text,
  p_decision text,
  p_reason text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor public.profiles;
  v_worker public.profiles;
  v_identity_status text;
BEGIN
  v_actor := public._admin_dashboard_actor();

  SELECT * INTO v_worker
  FROM public.profiles
  WHERE user_id=p_worker_id
    AND role='worker'
    AND COALESCE(deleted,false)=false
  FOR UPDATE;

  IF v_worker IS NULL THEN
    RAISE EXCEPTION 'Worker not found';
  END IF;

  IF v_actor.role='admin' AND (
    v_worker.state IS DISTINCT FROM v_actor.assigned_state
    OR COALESCE(NULLIF(v_worker.local_government,''),NULLIF(v_worker.city,'')) IS DISTINCT FROM v_actor.assigned_lga
  ) THEN
    RAISE EXCEPTION 'Worker is outside your assigned branch';
  END IF;

  IF v_worker.worker_status <> 'profile_under_review' THEN
    RAISE EXCEPTION 'Worker is not in the review queue';
  END IF;

  SELECT identity_status INTO v_identity_status
  FROM public.worker_verifications
  WHERE worker_id=p_worker_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF p_decision='approve' THEN
    IF COALESCE(v_identity_status,'not_started') <> 'verified' THEN
      RAISE EXCEPTION 'External government identity verification must pass before approval';
    END IF;
    UPDATE public.profiles
    SET worker_status='verified',worker_verified=true,updated_at=now(),updated_by=v_actor.user_id
    WHERE user_id=p_worker_id;
  ELSIF p_decision='reject' THEN
    IF NULLIF(BTRIM(COALESCE(p_reason,'')),'') IS NULL THEN
      RAISE EXCEPTION 'Rejection reason is required';
    END IF;
    UPDATE public.profiles
    SET worker_status='rejected',worker_verified=false,updated_at=now(),updated_by=v_actor.user_id
    WHERE user_id=p_worker_id;
  ELSE
    RAISE EXCEPTION 'Decision must be approve or reject';
  END IF;

  IF to_regclass('public.worker_verification_reviews') IS NOT NULL THEN
    INSERT INTO public.worker_verification_reviews(
      worker_id,reviewer_id,reviewer_role,action,rejection_reason
    ) VALUES(
      p_worker_id,
      v_actor.user_id,
      v_actor.role,
      CASE WHEN p_decision='approve' THEN 'approved' ELSE 'rejected' END,
      CASE WHEN p_decision='reject' THEN BTRIM(p_reason) ELSE NULL END
    );
  END IF;
END;
$function$;
