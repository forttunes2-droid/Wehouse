CREATE OR REPLACE FUNCTION public.worker_identity_check_required_v2()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path='public'
AS $$
  SELECT COALESCE(
    (
      SELECT lower(value) IN ('true','1','yes','on')
      FROM public.platform_settings
      WHERE key='worker_identity_check_required' AND is_active=true
      LIMIT 1
    ),
    true
  );
$$;

CREATE OR REPLACE FUNCTION public.get_my_worker_activation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE
  v_profile public.profiles;
  v_ver public.worker_verifications;
  v_payment public.booking_payments;
  v_test public.worker_test_attempts;
  v_identity public.worker_identity_checks;
  v_attempts_24h integer;
  v_profile_ready boolean;
  v_identity_required boolean;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE auth_id=auth.uid()::text AND role='worker' LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Worker profile not found'; END IF;
  v_profile_ready:=public.worker_professional_profile_ready(v_profile.user_id);
  v_identity_required:=public.worker_identity_check_required_v2();
  SELECT * INTO v_ver FROM public.worker_verifications WHERE worker_id=v_profile.user_id LIMIT 1;
  SELECT * INTO v_payment FROM public.booking_payments WHERE user_id=v_profile.user_id AND purpose='worker_verification' ORDER BY created_at DESC LIMIT 1;
  SELECT * INTO v_test FROM public.worker_test_attempts WHERE worker_id=v_profile.user_id ORDER BY started_at DESC LIMIT 1;
  SELECT * INTO v_identity FROM public.worker_identity_checks WHERE worker_id=v_profile.user_id;
  SELECT count(*) INTO v_attempts_24h FROM public.worker_test_attempts WHERE worker_id=v_profile.user_id AND started_at>=now()-interval '24 hours';

  RETURN jsonb_build_object(
    'worker_status',COALESCE(v_profile.worker_status,'pending'),
    'live',COALESCE(v_profile.worker_status='verified' AND v_profile.worker_verified,false),
    'profile_complete',v_profile_ready,
    'payment_status',v_payment.status,
    'gold_badge',COALESCE(v_payment.status IN('paid','completed'),false),
    'test_passed',public.worker_test_passed(v_profile.user_id),
    'test_percent',v_test.percent,
    'test_attempts_24h',v_attempts_24h,
    'identity_required',v_identity_required,
    'identity_status',COALESCE(v_identity.status,'not_started'),
    'identity_captured',COALESCE(v_identity.status IN('pending_review','passed'),false),
    'identity_passed',COALESCE(v_identity.status='passed',false),
    'evidence_saved',COALESCE(NULLIF(BTRIM(COALESCE(v_ver.verification_video_url,'')),'') IS NOT NULL,false),
    'submitted',COALESCE(v_ver.submitted_at IS NOT NULL,false),
    'review_status',v_ver.status,
    'rejection_reason',COALESCE(v_identity.rejection_reason,(SELECT rejection_reason FROM public.worker_verification_reviews WHERE worker_id=v_profile.user_id ORDER BY created_at DESC LIMIT 1))
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_my_worker_verification()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE
  v_profile public.profiles;
  v_ver public.worker_verifications;
  v_paid boolean;
  v_identity public.worker_identity_checks;
BEGIN
  SELECT * INTO v_profile FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role='worker'
    AND NOT COALESCE(deleted,false) AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false)
  LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Active Worker account required'; END IF;
  IF NOT public.worker_professional_profile_ready(v_profile.user_id)
  THEN RAISE EXCEPTION 'Complete your professional profile and service coverage first'; END IF;

  IF public.worker_identity_check_required_v2() THEN
    SELECT * INTO v_identity FROM public.worker_identity_checks WHERE worker_id=v_profile.user_id;
    IF v_identity IS NULL OR v_identity.status NOT IN('pending_review','passed')
    THEN RAISE EXCEPTION 'Complete the private WeHouse face and liveness check before submission'; END IF;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.booking_payments
    WHERE user_id=v_profile.user_id AND purpose='worker_verification' AND status IN('paid','completed')
  ) INTO v_paid;
  IF NOT v_paid THEN RAISE EXCEPTION 'Confirmed Paystack payment is required before submission'; END IF;
  IF NOT public.worker_test_passed(v_profile.user_id)
  THEN RAISE EXCEPTION 'Pass the Worker readiness check before submission'; END IF;

  SELECT * INTO v_ver FROM public.worker_verifications WHERE worker_id=v_profile.user_id LIMIT 1;
  IF v_ver IS NULL OR NULLIF(BTRIM(COALESCE(v_ver.verification_video_url,'')),'') IS NULL
  THEN RAISE EXCEPTION 'A skill demonstration video is required before review'; END IF;

  UPDATE public.worker_verifications SET status='profile_under_review',submitted_at=now(),updated_at=now() WHERE id=v_ver.id;
  UPDATE public.profiles SET worker_status='profile_under_review',worker_verified=false,available=false,updated_at=now() WHERE user_id=v_profile.user_id;
END;
$$;

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
  v_ver public.worker_verifications;
  v_identity public.worker_identity_checks;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor IS NULL OR v_actor.role<>'staff' OR COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false)
  THEN RAISE EXCEPTION 'Active Staff account required'; END IF;
  IF NOT public.current_staff_has_permission('verification')
  THEN RAISE EXCEPTION 'Trusted Verification Staff permission required'; END IF;
  IF p_status NOT IN('profile_under_review','verified','rejected')
  THEN RAISE EXCEPTION 'Invalid review outcome'; END IF;
  IF p_status='rejected' AND NULLIF(BTRIM(COALESCE(p_reason,'')),'') IS NULL
  THEN RAISE EXCEPTION 'Rejection reason is required'; END IF;

  SELECT * INTO v_worker FROM public.profiles WHERE user_id=p_worker_id AND role='worker' FOR UPDATE;
  IF v_worker IS NULL THEN RAISE EXCEPTION 'Worker not found'; END IF;
  IF v_actor.assigned_state IS NULL OR lower(COALESCE(v_worker.state,''))<>lower(v_actor.assigned_state)
    OR(v_actor.assigned_lga IS NOT NULL AND lower(COALESCE(v_worker.local_government,v_worker.city,''))<>lower(v_actor.assigned_lga))
  THEN RAISE EXCEPTION 'Worker is outside your assigned branch'; END IF;

  SELECT * INTO v_ver FROM public.worker_verifications WHERE worker_id=p_worker_id LIMIT 1;
  IF p_status='verified' THEN
    IF v_worker.worker_status<>'profile_under_review' THEN RAISE EXCEPTION 'Worker is not in the review queue'; END IF;
    IF public.worker_identity_check_required_v2() THEN
      SELECT * INTO v_identity FROM public.worker_identity_checks WHERE worker_id=p_worker_id;
      IF v_identity IS NULL OR v_identity.status<>'passed' THEN RAISE EXCEPTION 'Private WeHouse face and liveness check has not passed'; END IF;
    END IF;
    IF NOT public.worker_test_passed(p_worker_id) THEN RAISE EXCEPTION 'Worker readiness check has not been passed'; END IF;
    IF v_ver IS NULL OR NULLIF(BTRIM(COALESCE(v_ver.verification_video_url,'')),'') IS NULL
    THEN RAISE EXCEPTION 'Professional work evidence is incomplete'; END IF;
  END IF;

  UPDATE public.profiles
  SET worker_status=p_status,worker_verified=(p_status='verified'),available=(p_status='verified'),updated_at=now(),updated_by=v_actor.user_id
  WHERE user_id=p_worker_id;
  UPDATE public.worker_verifications
  SET status=p_status,reviewed_by=v_actor.user_id,review_notes=COALESCE(NULLIF(BTRIM(p_notes),''),NULLIF(BTRIM(p_reason),'')),reviewed_at=now(),updated_at=now()
  WHERE id=v_ver.id;
  INSERT INTO public.worker_verification_reviews(worker_id,reviewer_id,reviewer_role,action,rejection_reason,notes,created_at)
  VALUES(p_worker_id,v_actor.user_id,v_actor.role,p_status,CASE WHEN p_status='rejected' THEN BTRIM(p_reason) ELSE NULL END,NULLIF(BTRIM(COALESCE(p_notes,'')),''),now());
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_review_my_branch_worker(
  p_worker_id text,
  p_decision text,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE
  v_actor public.profiles;
  v_worker public.profiles;
  v_ver public.worker_verifications;
  v_identity public.worker_identity_checks;
BEGIN
  v_actor:=public._admin_dashboard_actor();
  SELECT * INTO v_worker FROM public.profiles
  WHERE user_id=p_worker_id AND role='worker' AND NOT COALESCE(deleted,false)
  FOR UPDATE;
  IF v_worker IS NULL THEN RAISE EXCEPTION 'Worker not found'; END IF;
  IF v_actor.role='admin' AND(
    v_worker.state IS DISTINCT FROM v_actor.assigned_state
    OR COALESCE(NULLIF(v_worker.local_government,''),NULLIF(v_worker.city,'')) IS DISTINCT FROM v_actor.assigned_lga
  ) THEN RAISE EXCEPTION 'Worker is outside your assigned branch'; END IF;
  IF v_worker.worker_status<>'profile_under_review' THEN RAISE EXCEPTION 'Worker is not in the review queue'; END IF;
  SELECT * INTO v_ver FROM public.worker_verifications WHERE worker_id=p_worker_id LIMIT 1;

  IF p_decision='approve' THEN
    IF public.worker_identity_check_required_v2() THEN
      SELECT * INTO v_identity FROM public.worker_identity_checks WHERE worker_id=p_worker_id;
      IF v_identity IS NULL OR v_identity.status<>'passed' THEN RAISE EXCEPTION 'Private WeHouse face and liveness check has not passed'; END IF;
    END IF;
    IF NOT public.worker_test_passed(p_worker_id) THEN RAISE EXCEPTION 'Worker readiness check has not been passed'; END IF;
    IF v_ver IS NULL OR NULLIF(BTRIM(COALESCE(v_ver.verification_video_url,'')),'') IS NULL
    THEN RAISE EXCEPTION 'Professional work evidence is incomplete'; END IF;
    UPDATE public.profiles SET worker_status='verified',worker_verified=true,available=true,updated_at=now(),updated_by=v_actor.user_id WHERE user_id=p_worker_id;
    UPDATE public.worker_verifications SET status='verified',reviewed_by=v_actor.user_id,reviewed_at=now(),updated_at=now() WHERE id=v_ver.id;
  ELSIF p_decision='reject' THEN
    IF NULLIF(BTRIM(COALESCE(p_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'Rejection reason is required'; END IF;
    UPDATE public.profiles SET worker_status='rejected',worker_verified=false,available=false,updated_at=now(),updated_by=v_actor.user_id WHERE user_id=p_worker_id;
    UPDATE public.worker_verifications SET status='rejected',reviewed_by=v_actor.user_id,review_notes=BTRIM(p_reason),reviewed_at=now(),updated_at=now() WHERE id=v_ver.id;
  ELSE
    RAISE EXCEPTION 'Decision must be approve or reject';
  END IF;

  INSERT INTO public.worker_verification_reviews(worker_id,reviewer_id,reviewer_role,action,rejection_reason)
  VALUES(p_worker_id,v_actor.user_id,v_actor.role,CASE WHEN p_decision='approve' THEN 'approved' ELSE 'rejected' END,CASE WHEN p_decision='reject' THEN BTRIM(p_reason) ELSE NULL END);
END;
$$;

REVOKE ALL ON FUNCTION public.worker_identity_check_required_v2() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.worker_identity_check_required_v2() TO authenticated;
