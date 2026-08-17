BEGIN;

ALTER TABLE public.worker_verifications
  ADD COLUMN IF NOT EXISTS identity_provider text,
  ADD COLUMN IF NOT EXISTS identity_status text NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS identity_reference text,
  ADD COLUMN IF NOT EXISTS identity_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS identity_failure_reason text;

CREATE OR REPLACE FUNCTION public._guard_worker_profile_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path='public'
AS $$
BEGIN
  IF NEW.role='worker' THEN
    IF NEW.worker_status='approved_for_verification' THEN
      NEW.worker_status:='verification_paid';
    ELSIF NEW.worker_status='approved' THEN
      NEW.worker_status:='pending';
    ELSIF NEW.worker_status='declined' THEN
      NEW.worker_status:='rejected';
    END IF;
    NEW.worker_verified := (NEW.worker_status='verified');
    IF NEW.worker_status<>'verified' OR COALESCE(NEW.deleted,false) OR COALESCE(NEW.suspended,false) OR COALESCE(NEW.banned,false) THEN
      NEW.available:=false;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

UPDATE public.profiles SET worker_status='verification_paid' WHERE role='worker' AND worker_status='approved_for_verification';
UPDATE public.profiles SET worker_status='pending' WHERE role='worker' AND worker_status='approved';
UPDATE public.profiles SET worker_status='rejected' WHERE role='worker' AND worker_status='declined';

CREATE OR REPLACE FUNCTION public.save_my_worker_verification_evidence(
  p_gov_id_type text,
  p_gov_id_number text,
  p_gov_id_path text,
  p_selfie_path text,
  p_certificate_path text DEFAULT NULL,
  p_video_path text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE
  v_profile public.profiles;
  v_id uuid;
  v_paid boolean;
BEGIN
  SELECT * INTO v_profile FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role='worker' AND deleted=false AND suspended=false AND banned=false
  LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Active worker profile not found'; END IF;
  IF v_profile.worker_status='verified' THEN RAISE EXCEPTION 'Verified worker changes require a new review process'; END IF;
  IF p_gov_id_type NOT IN ('nin','drivers_license','passport','voters_card') THEN RAISE EXCEPTION 'Invalid government ID type'; END IF;
  IF NULLIF(BTRIM(COALESCE(p_gov_id_number,'')),'') IS NULL OR NULLIF(BTRIM(COALESCE(p_gov_id_path,'')),'') IS NULL OR NULLIF(BTRIM(COALESCE(p_selfie_path,'')),'') IS NULL OR NULLIF(BTRIM(COALESCE(p_video_path,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Government ID, selfie and skill video are required';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.booking_payments
    WHERE user_id=v_profile.user_id AND purpose='worker_verification' AND status IN ('paid','completed')
  ) INTO v_paid;

  SELECT id INTO v_id FROM public.worker_verifications WHERE worker_id=v_profile.user_id ORDER BY created_at DESC LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.worker_verifications(
      worker_id,gov_id_type,gov_id_number,gov_id_photo_url,selfie_photo_url,certificate_path,verification_video_url,
      status,identity_status,submitted_at,created_at,updated_at
    ) VALUES(
      v_profile.user_id,p_gov_id_type,BTRIM(p_gov_id_number),p_gov_id_path,p_selfie_path,p_certificate_path,p_video_path,
      'draft','not_started',NULL,now(),now()
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.worker_verifications SET
      gov_id_type=p_gov_id_type,
      gov_id_number=BTRIM(p_gov_id_number),
      gov_id_photo_url=p_gov_id_path,
      selfie_photo_url=p_selfie_path,
      certificate_path=p_certificate_path,
      verification_video_url=p_video_path,
      status='draft',
      identity_provider=NULL,
      identity_status='not_started',
      identity_reference=NULL,
      identity_checked_at=NULL,
      identity_failure_reason=NULL,
      submitted_at=NULL,
      reviewed_by=NULL,
      review_notes=NULL,
      reviewed_at=NULL,
      updated_at=now()
    WHERE id=v_id;
  END IF;

  UPDATE public.profiles SET worker_status=CASE WHEN v_paid THEN 'verification_paid' ELSE 'pending' END, updated_at=now()
  WHERE user_id=v_profile.user_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_my_worker_verification_v2()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE
  v_profile public.profiles;
  v_ver public.worker_verifications;
  v_paid boolean;
BEGIN
  SELECT * INTO v_profile FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role='worker' AND deleted=false AND suspended=false AND banned=false
  LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Active worker profile not found'; END IF;
  IF NOT COALESCE(v_profile.profile_complete,false) OR NULLIF(BTRIM(COALESCE(v_profile.full_name,'')),'') IS NULL OR NULLIF(BTRIM(COALESCE(v_profile.worker_occupation,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Complete your professional profile first';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.worker_service_coverage WHERE worker_id=v_profile.user_id) THEN
    RAISE EXCEPTION 'Complete your service location first';
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.booking_payments WHERE user_id=v_profile.user_id AND purpose='worker_verification' AND status IN ('paid','completed')) INTO v_paid;
  IF NOT v_paid THEN RAISE EXCEPTION 'Verification payment is required before submission'; END IF;
  SELECT * INTO v_ver FROM public.worker_verifications WHERE worker_id=v_profile.user_id ORDER BY created_at DESC LIMIT 1;
  IF v_ver IS NULL OR v_ver.gov_id_photo_url IS NULL OR v_ver.selfie_photo_url IS NULL OR v_ver.verification_video_url IS NULL OR v_ver.gov_id_type IS NULL OR v_ver.gov_id_number IS NULL THEN
    RAISE EXCEPTION 'Complete all required verification evidence before submitting';
  END IF;

  UPDATE public.worker_verifications SET
    status='profile_under_review',
    identity_status=CASE WHEN identity_status='verified' THEN 'verified' ELSE 'pending_external' END,
    submitted_at=now(),
    updated_at=now()
  WHERE id=v_ver.id;

  UPDATE public.profiles SET worker_status='profile_under_review',available=false,updated_at=now()
  WHERE user_id=v_profile.user_id;
END;
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
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE auth_id=auth.uid()::text AND role='worker' LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Worker profile not found'; END IF;
  SELECT * INTO v_ver FROM public.worker_verifications WHERE worker_id=v_profile.user_id ORDER BY created_at DESC LIMIT 1;
  SELECT * INTO v_payment FROM public.booking_payments WHERE user_id=v_profile.user_id AND purpose='worker_verification' ORDER BY created_at DESC LIMIT 1;
  RETURN jsonb_build_object(
    'worker_status',COALESCE(v_profile.worker_status,'pending'),
    'live',COALESCE(v_profile.worker_status='verified' AND v_profile.worker_verified,false),
    'profile_complete',COALESCE(v_profile.profile_complete,false),
    'payment_status',v_payment.status,
    'gold_badge',COALESCE(v_payment.status IN ('paid','completed'),false),
    'evidence_saved',COALESCE(v_ver.gov_id_photo_url IS NOT NULL AND v_ver.selfie_photo_url IS NOT NULL AND v_ver.verification_video_url IS NOT NULL,false),
    'submitted',COALESCE(v_ver.submitted_at IS NOT NULL,false),
    'review_status',v_ver.status,
    'identity_status',COALESCE(v_ver.identity_status,'not_started'),
    'identity_provider',v_ver.identity_provider,
    'identity_checked_at',v_ver.identity_checked_at,
    'rejection_reason',(SELECT rejection_reason FROM public.worker_verification_reviews WHERE worker_id=v_profile.user_id ORDER BY created_at DESC LIMIT 1)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_external_worker_identity_result(
  p_worker_id text,
  p_provider text,
  p_reference text,
  p_status text,
  p_failure_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'Service-only function'; END IF;
  IF p_status NOT IN ('verified','failed','needs_retry') THEN RAISE EXCEPTION 'Invalid identity result'; END IF;
  UPDATE public.worker_verifications SET
    identity_provider=NULLIF(BTRIM(p_provider),''),
    identity_reference=NULLIF(BTRIM(p_reference),''),
    identity_status=p_status,
    identity_checked_at=now(),
    identity_failure_reason=CASE WHEN p_status='verified' THEN NULL ELSE NULLIF(BTRIM(COALESCE(p_failure_reason,'')),'') END,
    updated_at=now()
  WHERE id=(SELECT id FROM public.worker_verifications WHERE worker_id=p_worker_id ORDER BY created_at DESC LIMIT 1);
  UPDATE public.profiles SET id_verified=(p_status='verified'),updated_at=now() WHERE user_id=p_worker_id AND role='worker';
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
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor IS NULL OR v_actor.role<>'staff' OR COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN RAISE EXCEPTION 'Active Staff account required'; END IF;
  IF NOT public.current_staff_has_permission('verification') THEN RAISE EXCEPTION 'Security permission required'; END IF;
  IF p_status NOT IN ('profile_under_review','verified','rejected') THEN RAISE EXCEPTION 'Invalid review outcome'; END IF;
  IF p_status='rejected' AND NULLIF(BTRIM(COALESCE(p_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'Rejection reason is required'; END IF;
  SELECT * INTO v_worker FROM public.profiles WHERE user_id=p_worker_id AND role='worker' FOR UPDATE;
  IF v_worker IS NULL THEN RAISE EXCEPTION 'Worker not found'; END IF;
  IF v_actor.assigned_state IS NULL OR lower(COALESCE(v_worker.state,''))<>lower(v_actor.assigned_state) OR (v_actor.assigned_lga IS NOT NULL AND lower(COALESCE(v_worker.local_government,v_worker.city,''))<>lower(v_actor.assigned_lga)) THEN RAISE EXCEPTION 'Worker is outside your assigned branch'; END IF;
  SELECT * INTO v_ver FROM public.worker_verifications WHERE worker_id=p_worker_id ORDER BY created_at DESC LIMIT 1;
  IF p_status='verified' AND COALESCE(v_ver.identity_status,'not_started')<>'verified' THEN RAISE EXCEPTION 'External government identity verification must pass before approval'; END IF;

  UPDATE public.profiles SET worker_status=p_status,worker_verified=(p_status='verified'),updated_at=now(),updated_by=v_actor.user_id WHERE user_id=p_worker_id;
  UPDATE public.worker_verifications SET status=p_status,reviewed_by=v_actor.user_id,review_notes=COALESCE(NULLIF(BTRIM(p_notes),''),NULLIF(BTRIM(p_reason),'')),reviewed_at=now(),updated_at=now() WHERE id=v_ver.id;
  INSERT INTO public.worker_verification_reviews(worker_id,reviewer_id,reviewer_role,action,rejection_reason,notes,created_at)
  VALUES(p_worker_id,v_actor.user_id,v_actor.role,p_status,CASE WHEN p_status='rejected' THEN BTRIM(p_reason) ELSE NULL END,NULLIF(BTRIM(COALESCE(p_notes,'')),''),now());
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.save_my_worker_verification_evidence(text,text,text,text,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.submit_my_worker_verification_v2() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_my_worker_activation() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.record_external_worker_identity_result(text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_my_worker_verification_evidence(text,text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_my_worker_verification_v2() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_worker_activation() TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_external_worker_identity_result(text,text,text,text,text) TO service_role;

COMMIT;
