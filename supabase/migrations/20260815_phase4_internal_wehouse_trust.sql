BEGIN;

-- Phase 4 correction: WeHouse verification is an internal professional trust
-- process. Government ID / external identity providers are not part of Worker
-- or Staff verification.

CREATE TABLE IF NOT EXISTS public.staff_trust_profiles (
  staff_id text PRIMARY KEY REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'probation' CHECK (status IN ('probation','trusted','restricted','revoked')),
  appointed_by text,
  appointed_at timestamptz NOT NULL DEFAULT now(),
  trusted_by text,
  trusted_at timestamptz,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.staff_trust_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_trust_profiles FROM PUBLIC, anon;
GRANT SELECT ON public.staff_trust_profiles TO authenticated;

DROP POLICY IF EXISTS staff_trust_select ON public.staff_trust_profiles;
CREATE POLICY staff_trust_select
ON public.staff_trust_profiles
FOR SELECT TO authenticated
USING (
  staff_id = (SELECT p.user_id FROM public.profiles p WHERE p.auth_id=auth.uid()::text LIMIT 1)
  OR EXISTS (
    SELECT 1
    FROM public.profiles actor
    JOIN public.profiles target ON target.user_id=staff_trust_profiles.staff_id
    WHERE actor.auth_id=auth.uid()::text
      AND actor.role='creator'
      AND COALESCE(actor.deleted,false)=false
      AND COALESCE(actor.suspended,false)=false
      AND COALESCE(actor.banned,false)=false
  )
  OR EXISTS (
    SELECT 1
    FROM public.profiles actor
    JOIN public.profiles target ON target.user_id=staff_trust_profiles.staff_id
    WHERE actor.auth_id=auth.uid()::text
      AND actor.role='admin'
      AND COALESCE(actor.deleted,false)=false
      AND COALESCE(actor.suspended,false)=false
      AND COALESCE(actor.banned,false)=false
      AND actor.assigned_state IS NOT DISTINCT FROM target.assigned_state
      AND actor.assigned_lga IS NOT DISTINCT FROM target.assigned_lga
  )
);

-- Preserve current operations: Staff who already have one active module and a
-- branch assignment are treated as trusted. Unassigned/new Staff begin in probation.
INSERT INTO public.staff_trust_profiles(staff_id,status,appointed_by,appointed_at,trusted_at,notes)
SELECT
  p.user_id,
  CASE
    WHEN p.assigned_state IS NOT NULL
      AND p.assigned_lga IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.staff_permissions sp
        WHERE sp.staff_id=p.user_id AND sp.is_active=true
      )
    THEN 'trusted'
    ELSE 'probation'
  END,
  (
    SELECT sp.granted_by
    FROM public.staff_permissions sp
    WHERE sp.staff_id=p.user_id
    ORDER BY sp.granted_at DESC NULLS LAST
    LIMIT 1
  ),
  now(),
  CASE
    WHEN p.assigned_state IS NOT NULL
      AND p.assigned_lga IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.staff_permissions sp
        WHERE sp.staff_id=p.user_id AND sp.is_active=true
      )
    THEN now()
    ELSE NULL
  END,
  'Phase 4 internal WeHouse trust migration'
FROM public.profiles p
WHERE p.role='staff' AND COALESCE(p.deleted,false)=false
ON CONFLICT(staff_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_my_staff_trust_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $function$
DECLARE
  v_staff public.profiles;
  v_trust public.staff_trust_profiles;
BEGIN
  SELECT * INTO v_staff
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND role='staff'
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;

  IF v_staff IS NULL THEN RAISE EXCEPTION 'Active Staff account required'; END IF;

  SELECT * INTO v_trust FROM public.staff_trust_profiles WHERE staff_id=v_staff.user_id;
  IF v_trust IS NULL THEN
    INSERT INTO public.staff_trust_profiles(staff_id,status,appointed_at,notes)
    VALUES(v_staff.user_id,'probation',now(),'Staff trust record created automatically')
    RETURNING * INTO v_trust;
  END IF;

  RETURN jsonb_build_object(
    'status',v_trust.status,
    'notes',v_trust.notes,
    'appointed_at',v_trust.appointed_at,
    'trusted_at',v_trust.trusted_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_staff_trust_status(
  p_staff_id text,
  p_status text,
  p_notes text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $function$
DECLARE
  v_actor public.profiles;
  v_target public.profiles;
BEGIN
  IF p_status NOT IN ('probation','trusted','restricted','revoked') THEN
    RAISE EXCEPTION 'Invalid Staff trust status';
  END IF;

  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND role IN ('admin','creator')
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Admin or Creator access required'; END IF;

  SELECT * INTO v_target
  FROM public.profiles
  WHERE user_id=p_staff_id AND role='staff' AND COALESCE(deleted,false)=false
  LIMIT 1;
  IF v_target IS NULL THEN RAISE EXCEPTION 'Staff profile not found'; END IF;

  IF v_actor.role='admin' AND (
    v_actor.assigned_state IS DISTINCT FROM v_target.assigned_state
    OR v_actor.assigned_lga IS DISTINCT FROM v_target.assigned_lga
  ) THEN
    RAISE EXCEPTION 'Admin can review only Staff in the same assigned branch';
  END IF;

  INSERT INTO public.staff_trust_profiles(
    staff_id,status,appointed_by,appointed_at,trusted_by,trusted_at,notes,updated_at
  ) VALUES(
    p_staff_id,p_status,v_actor.user_id,now(),
    CASE WHEN p_status='trusted' THEN v_actor.user_id ELSE NULL END,
    CASE WHEN p_status='trusted' THEN now() ELSE NULL END,
    NULLIF(BTRIM(COALESCE(p_notes,'')),''),now()
  )
  ON CONFLICT(staff_id) DO UPDATE SET
    status=EXCLUDED.status,
    trusted_by=CASE WHEN EXCLUDED.status='trusted' THEN v_actor.user_id ELSE staff_trust_profiles.trusted_by END,
    trusted_at=CASE WHEN EXCLUDED.status='trusted' THEN now() ELSE staff_trust_profiles.trusted_at END,
    notes=EXCLUDED.notes,
    updated_at=now();

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.current_staff_has_permission(p_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path='public'
AS $function$
  SELECT EXISTS(
    SELECT 1
    FROM public.profiles p
    JOIN public.staff_permissions sp
      ON sp.staff_id=p.user_id
     AND sp.permission=p_permission
     AND sp.is_active=true
    JOIN public.staff_trust_profiles st
      ON st.staff_id=p.user_id
     AND st.status='trusted'
    WHERE p.auth_id=auth.uid()::text
      AND p.role='staff'
      AND NOT COALESCE(p.deleted,false)
      AND NOT COALESCE(p.suspended,false)
      AND NOT COALESCE(p.banned,false)
  )
  OR EXISTS(
    SELECT 1
    FROM public.profiles p
    WHERE p.auth_id=auth.uid()::text
      AND p.role IN('admin','creator')
      AND NOT COALESCE(p.deleted,false)
      AND NOT COALESCE(p.suspended,false)
      AND NOT COALESCE(p.banned,false)
  );
$function$;

CREATE OR REPLACE FUNCTION public.admin_appoint_staff(p_target_user_id text, p_module text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $function$
DECLARE
  v_actor public.profiles;
BEGIN
  IF p_module NOT IN ('operations','finance','support','verification','field_officer') THEN
    RAISE EXCEPTION 'A valid Staff module is required';
  END IF;

  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND role IN ('admin','creator')
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Admin or Creator access required'; END IF;

  PERFORM public.admin_update_role(p_target_user_id, 'staff');
  PERFORM public.manage_staff_permission(p_target_user_id, p_module, true);

  INSERT INTO public.staff_trust_profiles(staff_id,status,appointed_by,appointed_at,notes,updated_at)
  VALUES(p_target_user_id,'probation',v_actor.user_id,now(),'New Staff appointment awaiting WeHouse trust review',now())
  ON CONFLICT(staff_id) DO UPDATE SET
    status='probation',
    appointed_by=v_actor.user_id,
    appointed_at=now(),
    notes='Staff appointment changed; trust review required',
    updated_at=now();

  RETURN true;
END;
$function$;

-- Worker professional verification: payment is a badge only; internal checks
-- and review determine whether the Worker becomes public.
CREATE OR REPLACE FUNCTION public.get_my_worker_activation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $function$
DECLARE
  v_profile public.profiles;
  v_ver public.worker_verifications;
  v_payment public.booking_payments;
  v_test public.worker_test_attempts;
  v_attempts_24h integer;
  v_profile_ready boolean;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE auth_id=auth.uid()::text AND role='worker' LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Worker profile not found'; END IF;

  v_profile_ready:=public.worker_professional_profile_ready(v_profile.user_id);
  SELECT * INTO v_ver FROM public.worker_verifications WHERE worker_id=v_profile.user_id LIMIT 1;
  SELECT * INTO v_payment FROM public.booking_payments WHERE user_id=v_profile.user_id AND purpose='worker_verification' ORDER BY created_at DESC LIMIT 1;
  SELECT * INTO v_test FROM public.worker_test_attempts WHERE worker_id=v_profile.user_id ORDER BY started_at DESC LIMIT 1;
  SELECT count(*) INTO v_attempts_24h FROM public.worker_test_attempts WHERE worker_id=v_profile.user_id AND started_at>=now()-interval '24 hours';

  RETURN jsonb_build_object(
    'worker_status',COALESCE(v_profile.worker_status,'pending'),
    'live',COALESCE(v_profile.worker_status='verified' AND v_profile.worker_verified,false),
    'profile_complete',v_profile_ready,
    'payment_status',v_payment.status,
    'gold_badge',COALESCE(v_payment.status IN ('paid','completed'),false),
    'test_passed',public.worker_test_passed(v_profile.user_id),
    'test_percent',v_test.percent,
    'test_attempts_24h',v_attempts_24h,
    'evidence_saved',COALESCE(NULLIF(BTRIM(COALESCE(v_ver.verification_video_url,'')),'') IS NOT NULL,false),
    'submitted',COALESCE(v_ver.submitted_at IS NOT NULL,false),
    'review_status',v_ver.status,
    'rejection_reason',(SELECT rejection_reason FROM public.worker_verification_reviews WHERE worker_id=v_profile.user_id ORDER BY created_at DESC LIMIT 1),
    -- Temporary compatibility for the older production frontend. The new
    -- frontend does not read these fields and no government check is performed.
    'identity_status','verified',
    'identity_provider',NULL,
    'identity_checked_at',NULL
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_my_worker_verification()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $function$
DECLARE
  v_profile public.profiles;
  v_ver public.worker_verifications;
  v_paid boolean;
BEGIN
  SELECT * INTO v_profile
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND role='worker'
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Active Worker account required'; END IF;

  IF NOT public.worker_professional_profile_ready(v_profile.user_id) THEN
    RAISE EXCEPTION 'Complete your professional profile and service coverage first';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.booking_payments
    WHERE user_id=v_profile.user_id
      AND purpose='worker_verification'
      AND status IN ('paid','completed')
  ) INTO v_paid;
  IF NOT v_paid THEN RAISE EXCEPTION 'Verified Paystack payment is required before submission'; END IF;

  IF NOT public.worker_test_passed(v_profile.user_id) THEN
    RAISE EXCEPTION 'Pass the Worker readiness check before submission';
  END IF;

  SELECT * INTO v_ver FROM public.worker_verifications WHERE worker_id=v_profile.user_id LIMIT 1;
  IF v_ver IS NULL OR NULLIF(BTRIM(COALESCE(v_ver.verification_video_url,'')),'') IS NULL THEN
    RAISE EXCEPTION 'A skill demonstration video is required before review';
  END IF;

  UPDATE public.worker_verifications
  SET status='profile_under_review',submitted_at=now(),updated_at=now()
  WHERE id=v_ver.id;

  UPDATE public.profiles
  SET worker_status='profile_under_review',worker_verified=false,available=false,updated_at=now()
  WHERE user_id=v_profile.user_id;
END;
$function$;

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
AS $function$
DECLARE
  v_actor public.profiles;
  v_worker public.profiles;
  v_ver public.worker_verifications;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor IS NULL OR v_actor.role<>'staff' OR COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN
    RAISE EXCEPTION 'Active Staff account required';
  END IF;
  IF NOT public.current_staff_has_permission('verification') THEN RAISE EXCEPTION 'Trusted Verification Staff permission required'; END IF;
  IF p_status NOT IN ('profile_under_review','verified','rejected') THEN RAISE EXCEPTION 'Invalid review outcome'; END IF;
  IF p_status='rejected' AND NULLIF(BTRIM(COALESCE(p_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'Rejection reason is required'; END IF;

  SELECT * INTO v_worker FROM public.profiles WHERE user_id=p_worker_id AND role='worker' FOR UPDATE;
  IF v_worker IS NULL THEN RAISE EXCEPTION 'Worker not found'; END IF;
  IF v_actor.assigned_state IS NULL
    OR lower(COALESCE(v_worker.state,''))<>lower(v_actor.assigned_state)
    OR (v_actor.assigned_lga IS NOT NULL AND lower(COALESCE(v_worker.local_government,v_worker.city,''))<>lower(v_actor.assigned_lga))
  THEN RAISE EXCEPTION 'Worker is outside your assigned branch'; END IF;

  SELECT * INTO v_ver FROM public.worker_verifications WHERE worker_id=p_worker_id LIMIT 1;

  IF p_status='verified' THEN
    IF v_worker.worker_status<>'profile_under_review' THEN RAISE EXCEPTION 'Worker is not in the review queue'; END IF;
    IF NOT public.worker_test_passed(p_worker_id) THEN RAISE EXCEPTION 'Worker readiness check has not been passed'; END IF;
    IF v_ver IS NULL OR NULLIF(BTRIM(COALESCE(v_ver.verification_video_url,'')),'') IS NULL THEN RAISE EXCEPTION 'Professional work evidence is incomplete'; END IF;
  END IF;

  UPDATE public.profiles
  SET worker_status=p_status,
      worker_verified=(p_status='verified'),
      available=(p_status='verified'),
      updated_at=now(),
      updated_by=v_actor.user_id
  WHERE user_id=p_worker_id;

  UPDATE public.worker_verifications
  SET status=p_status,
      reviewed_by=v_actor.user_id,
      review_notes=COALESCE(NULLIF(BTRIM(p_notes),''),NULLIF(BTRIM(p_reason),'')),
      reviewed_at=now(),
      updated_at=now()
  WHERE id=v_ver.id;

  INSERT INTO public.worker_verification_reviews(worker_id,reviewer_id,reviewer_role,action,rejection_reason,notes,created_at)
  VALUES(
    p_worker_id,v_actor.user_id,v_actor.role,p_status,
    CASE WHEN p_status='rejected' THEN BTRIM(p_reason) ELSE NULL END,
    NULLIF(BTRIM(COALESCE(p_notes,'')),''),now()
  );

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_review_my_branch_worker(
  p_worker_id text,
  p_decision text,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $function$
DECLARE
  v_actor public.profiles;
  v_worker public.profiles;
  v_ver public.worker_verifications;
BEGIN
  v_actor:=public._admin_dashboard_actor();
  SELECT * INTO v_worker
  FROM public.profiles
  WHERE user_id=p_worker_id AND role='worker' AND COALESCE(deleted,false)=false
  FOR UPDATE;
  IF v_worker IS NULL THEN RAISE EXCEPTION 'Worker not found'; END IF;

  IF v_actor.role='admin' AND (
    v_worker.state IS DISTINCT FROM v_actor.assigned_state
    OR COALESCE(NULLIF(v_worker.local_government,''),NULLIF(v_worker.city,'')) IS DISTINCT FROM v_actor.assigned_lga
  ) THEN RAISE EXCEPTION 'Worker is outside your assigned branch'; END IF;

  IF v_worker.worker_status<>'profile_under_review' THEN RAISE EXCEPTION 'Worker is not in the review queue'; END IF;
  SELECT * INTO v_ver FROM public.worker_verifications WHERE worker_id=p_worker_id LIMIT 1;

  IF p_decision='approve' THEN
    IF NOT public.worker_test_passed(p_worker_id) THEN RAISE EXCEPTION 'Worker readiness check has not been passed'; END IF;
    IF v_ver IS NULL OR NULLIF(BTRIM(COALESCE(v_ver.verification_video_url,'')),'') IS NULL THEN RAISE EXCEPTION 'Professional work evidence is incomplete'; END IF;

    UPDATE public.profiles
    SET worker_status='verified',worker_verified=true,available=true,updated_at=now(),updated_by=v_actor.user_id
    WHERE user_id=p_worker_id;
    UPDATE public.worker_verifications
    SET status='verified',reviewed_by=v_actor.user_id,reviewed_at=now(),updated_at=now()
    WHERE id=v_ver.id;
  ELSIF p_decision='reject' THEN
    IF NULLIF(BTRIM(COALESCE(p_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'Rejection reason is required'; END IF;
    UPDATE public.profiles
    SET worker_status='rejected',worker_verified=false,available=false,updated_at=now(),updated_by=v_actor.user_id
    WHERE user_id=p_worker_id;
    UPDATE public.worker_verifications
    SET status='rejected',reviewed_by=v_actor.user_id,review_notes=BTRIM(p_reason),reviewed_at=now(),updated_at=now()
    WHERE id=v_ver.id;
  ELSE
    RAISE EXCEPTION 'Decision must be approve or reject';
  END IF;

  INSERT INTO public.worker_verification_reviews(worker_id,reviewer_id,reviewer_role,action,rejection_reason)
  VALUES(
    p_worker_id,v_actor.user_id,v_actor.role,
    CASE WHEN p_decision='approve' THEN 'approved' ELSE 'rejected' END,
    CASE WHEN p_decision='reject' THEN BTRIM(p_reason) ELSE NULL END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_worker_review_trust_status(p_worker_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $function$
DECLARE
  v_actor public.profiles;
  v_worker public.profiles;
  v_ver public.worker_verifications;
  v_payment boolean;
  v_test public.worker_test_attempts;
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND role IN ('staff','admin','creator')
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Verification review access required'; END IF;
  IF v_actor.role='staff' AND NOT public.current_staff_has_permission('verification') THEN RAISE EXCEPTION 'Trusted Verification Staff permission required'; END IF;

  SELECT * INTO v_worker FROM public.profiles WHERE user_id=p_worker_id AND role='worker' LIMIT 1;
  IF v_worker IS NULL THEN RAISE EXCEPTION 'Worker not found'; END IF;

  IF v_actor.role IN ('staff','admin') AND (
    v_actor.assigned_state IS DISTINCT FROM v_worker.state
    OR (v_actor.assigned_lga IS NOT NULL AND v_actor.assigned_lga IS DISTINCT FROM COALESCE(v_worker.local_government,v_worker.city))
  ) THEN RAISE EXCEPTION 'Worker is outside your assigned branch'; END IF;

  SELECT * INTO v_ver FROM public.worker_verifications WHERE worker_id=p_worker_id LIMIT 1;
  SELECT EXISTS(
    SELECT 1 FROM public.booking_payments
    WHERE user_id=p_worker_id AND purpose='worker_verification' AND status IN ('paid','completed')
  ) INTO v_payment;
  SELECT * INTO v_test
  FROM public.worker_test_attempts
  WHERE worker_id=p_worker_id AND passed=true AND submitted_at IS NOT NULL
  ORDER BY submitted_at DESC LIMIT 1;

  RETURN jsonb_build_object(
    'payment_confirmed',v_payment,
    'readiness_passed',v_test.id IS NOT NULL,
    'readiness_percent',v_test.percent,
    'evidence_saved',COALESCE(NULLIF(BTRIM(COALESCE(v_ver.verification_video_url,'')),'') IS NOT NULL,false),
    'submitted',COALESCE(v_ver.submitted_at IS NOT NULL,false),
    'review_status',v_ver.status
  );
END;
$function$;

-- Keep the old RPC name temporarily for old deployed bundles, but it no longer
-- represents or performs government identity verification.
CREATE OR REPLACE FUNCTION public.admin_get_worker_review_identity_status(p_worker_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $function$
BEGIN
  RETURN jsonb_build_object(
    'identity_status','verified',
    'identity_provider',NULL,
    'identity_checked_at',NULL,
    'identity_failure_reason',NULL
  );
END;
$function$;

-- External identity callbacks are retired from the database surface.
DROP FUNCTION IF EXISTS public.record_external_worker_identity_result(text,text,text,text,text);
DROP FUNCTION IF EXISTS public.record_external_worker_identity_result_by_reference(text,text,text,text);

COMMENT ON COLUMN public.worker_verifications.gov_id_type IS 'RETIRED: WeHouse does not use government ID for Worker verification.';
COMMENT ON COLUMN public.worker_verifications.gov_id_number IS 'RETIRED: WeHouse does not use government ID for Worker verification.';
COMMENT ON COLUMN public.worker_verifications.gov_id_photo_url IS 'RETIRED: WeHouse does not use government ID for Worker verification.';
COMMENT ON COLUMN public.worker_verifications.selfie_photo_url IS 'RETIRED: WeHouse does not use identity selfie verification.';
COMMENT ON COLUMN public.worker_verifications.identity_provider IS 'RETIRED: external identity providers are not used.';
COMMENT ON COLUMN public.worker_verifications.identity_status IS 'RETIRED compatibility field; not part of WeHouse verification.';

REVOKE ALL ON FUNCTION public.get_my_staff_trust_status() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_staff_trust_status(text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_worker_review_trust_status(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_staff_trust_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_staff_trust_status(text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_worker_review_trust_status(text) TO authenticated;

COMMIT;
