BEGIN;

CREATE OR REPLACE FUNCTION public.review_my_staff_worker_v2(
  p_worker_id text,
  p_status text,
  p_reason text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE
  v_actor public.profiles;
  v_worker public.profiles;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor IS NULL OR COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN
    RAISE EXCEPTION 'Active Staff account required';
  END IF;
  IF v_actor.role='staff' AND NOT public.current_staff_has_permission('verification') THEN
    RAISE EXCEPTION 'Security and Verification permission required';
  END IF;
  IF v_actor.role NOT IN ('staff','admin','creator') THEN RAISE EXCEPTION 'Staff access required'; END IF;
  IF p_status NOT IN ('profile_under_review','verified','rejected','suspended') THEN RAISE EXCEPTION 'Invalid review outcome'; END IF;
  IF v_actor.role='staff' AND p_status='suspended' THEN RAISE EXCEPTION 'Suspension requires Admin or Creator authority'; END IF;
  IF p_status='rejected' AND NULLIF(BTRIM(COALESCE(p_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'Rejection reason is required'; END IF;

  SELECT * INTO v_worker FROM public.profiles WHERE user_id=p_worker_id AND role='worker' FOR UPDATE;
  IF v_worker IS NULL THEN RAISE EXCEPTION 'Worker not found'; END IF;
  IF v_actor.role='staff' AND NOT (
    v_actor.assigned_state IS NOT NULL AND lower(COALESCE(v_worker.state,''))=lower(v_actor.assigned_state)
    AND (v_actor.assigned_lga IS NULL OR lower(COALESCE(v_worker.local_government,v_worker.city,''))=lower(v_actor.assigned_lga))
  ) THEN RAISE EXCEPTION 'Worker is outside your assigned branch'; END IF;

  UPDATE public.profiles
  SET worker_status=p_status,worker_verified=(p_status='verified'),updated_at=now(),updated_by=v_actor.user_id
  WHERE user_id=p_worker_id;

  UPDATE public.worker_verifications
  SET status=p_status,
      reviewed_by=v_actor.user_id,
      review_notes=COALESCE(NULLIF(BTRIM(p_notes),''),NULLIF(BTRIM(p_reason),'')),
      reviewed_at=now(),
      updated_at=now()
  WHERE id=(SELECT id FROM public.worker_verifications WHERE worker_id=p_worker_id ORDER BY created_at DESC LIMIT 1);

  INSERT INTO public.worker_verification_reviews(worker_id,reviewer_id,reviewer_role,action,rejection_reason,notes,created_at)
  VALUES(
    p_worker_id,
    v_actor.user_id,
    v_actor.role,
    p_status,
    CASE WHEN p_status='rejected' THEN BTRIM(p_reason) ELSE NULL END,
    NULLIF(BTRIM(COALESCE(p_notes,'')),''),
    now()
  );
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.review_my_staff_worker_v2(text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_my_staff_worker_v2(text,text,text,text) TO authenticated;

COMMIT;
