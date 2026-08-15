-- WeHouse-owned Worker identity/liveness + earned marketplace trust.
-- No government ID, no external identity provider, no biometric template storage.

CREATE TABLE IF NOT EXISTS public.worker_identity_checks (
  worker_id text PRIMARY KEY REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','pending_review','passed','failed')),
  enrollment_photo_path text,
  liveness_video_path text,
  challenge_version text NOT NULL DEFAULT 'center_left_right_center_v1',
  consent_at timestamptz,
  captured_at timestamptz,
  reviewed_by text,
  reviewed_at timestamptz,
  rejection_reason text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.worker_identity_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.worker_identity_checks FROM anon, authenticated;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES(
  'worker-identity-private','worker-identity-private',false,26214400,
  ARRAY['image/jpeg','image/png','image/webp','video/webm','video/mp4','video/quicktime']::text[]
)
ON CONFLICT(id) DO UPDATE SET
  public=false,
  file_size_limit=EXCLUDED.file_size_limit,
  allowed_mime_types=EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS worker_identity_insert_own ON storage.objects;
CREATE POLICY worker_identity_insert_own ON storage.objects
FOR INSERT TO authenticated
WITH CHECK(
  bucket_id='worker-identity-private'
  AND public.current_profile_role()='worker'
  AND (storage.foldername(name))[1]=public.current_profile_user_id()
);

DROP POLICY IF EXISTS worker_identity_read_own ON storage.objects;
CREATE POLICY worker_identity_read_own ON storage.objects
FOR SELECT TO authenticated
USING(
  bucket_id='worker-identity-private'
  AND public.current_profile_role()='worker'
  AND (storage.foldername(name))[1]=public.current_profile_user_id()
);

DROP POLICY IF EXISTS worker_identity_delete_own ON storage.objects;
CREATE POLICY worker_identity_delete_own ON storage.objects
FOR DELETE TO authenticated
USING(
  bucket_id='worker-identity-private'
  AND public.current_profile_role()='worker'
  AND (storage.foldername(name))[1]=public.current_profile_user_id()
);

DROP POLICY IF EXISTS worker_identity_verification_staff_read ON storage.objects;
CREATE POLICY worker_identity_verification_staff_read ON storage.objects
FOR SELECT TO authenticated
USING(
  bucket_id='worker-identity-private'
  AND public.current_staff_can_review_worker((storage.foldername(name))[1])
);

INSERT INTO public.platform_settings(
  key,value,category,label,description,data_type,editable,is_active,created_at,updated_at
)
VALUES
('worker_identity_check_required','true','worker','Private Worker identity check required','Require a private WeHouse selfie and liveness challenge before Worker approval. This does not use government ID.','boolean',true,true,now(),now()),
('worker_identity_retention_days','90','worker','Identity evidence retention (days)','How long private identity-check media should be retained after review before cleanup.','number',true,true,now(),now()),
('worker_trust_enabled','false','worker_trust','WeHouse Trusted enabled','Enable the earned marketplace trust label after Creator configures the thresholds.','boolean',true,true,now(),now()),
('worker_trusted_min_completed_jobs','5','worker_trust','Trusted: minimum completed jobs','Minimum completed WeHouse Worker jobs required for WeHouse Trusted.','number',true,true,now(),now()),
('worker_trusted_min_rating','4.5','worker_trust','Trusted: minimum rating','Minimum Worker rating required for WeHouse Trusted.','number',true,true,now(),now()),
('worker_trusted_max_cancel_rate','20','worker_trust','Trusted: maximum Worker cancellation rate (%)','Maximum percentage of terminal Worker jobs cancelled by the Worker while retaining WeHouse Trusted.','number',true,true,now(),now()),
('worker_trusted_block_open_disputes','true','worker_trust','Trusted: block unresolved disputes','Prevent WeHouse Trusted while the Worker has an unresolved Worker-booking dispute.','boolean',true,true,now(),now())
ON CONFLICT(key) DO UPDATE SET
  label=EXCLUDED.label,
  description=EXCLUDED.description,
  category=EXCLUDED.category,
  data_type=EXCLUDED.data_type,
  editable=true,
  is_active=true,
  updated_at=now();

-- Retire stale policy settings that could accidentally reintroduce government-document flows.
UPDATE public.platform_settings
SET is_active=false, updated_at=now()
WHERE key IN ('worker_id_verification_required','worker_required_documents');

ALTER TABLE public.worker_bookings ADD COLUMN IF NOT EXISTS cancelled_by text;

CREATE OR REPLACE FUNCTION public.get_my_worker_identity_check()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public','storage'
AS $$
DECLARE
  v_worker public.profiles;
  v_check public.worker_identity_checks;
BEGIN
  SELECT * INTO v_worker
  FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role='worker' AND NOT COALESCE(deleted,false)
  LIMIT 1;
  IF v_worker IS NULL THEN RAISE EXCEPTION 'Worker account required'; END IF;

  SELECT * INTO v_check FROM public.worker_identity_checks WHERE worker_id=v_worker.user_id;
  RETURN jsonb_build_object(
    'status',COALESCE(v_check.status,'not_started'),
    'has_photo',COALESCE(NULLIF(BTRIM(COALESCE(v_check.enrollment_photo_path,'')),'') IS NOT NULL,false),
    'has_liveness',COALESCE(NULLIF(BTRIM(COALESCE(v_check.liveness_video_path,'')),'') IS NOT NULL,false),
    'consent_at',v_check.consent_at,
    'captured_at',v_check.captured_at,
    'reviewed_at',v_check.reviewed_at,
    'rejection_reason',v_check.rejection_reason,
    'attempt_count',COALESCE(v_check.attempt_count,0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.save_my_worker_identity_capture(
  p_photo_path text,
  p_liveness_path text,
  p_consent boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public','storage'
AS $$
DECLARE
  v_worker public.profiles;
BEGIN
  SELECT * INTO v_worker
  FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role='worker'
    AND NOT COALESCE(deleted,false) AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false)
  LIMIT 1;
  IF v_worker IS NULL THEN RAISE EXCEPTION 'Active Worker account required'; END IF;
  IF p_consent IS NOT TRUE THEN RAISE EXCEPTION 'Consent is required for the private WeHouse identity check'; END IF;
  IF v_worker.worker_status='verified' THEN RAISE EXCEPTION 'A live Worker must contact WeHouse Support before redoing the identity check'; END IF;
  IF split_part(COALESCE(p_photo_path,''),'/',1)<>v_worker.user_id
     OR split_part(COALESCE(p_liveness_path,''),'/',1)<>v_worker.user_id
  THEN RAISE EXCEPTION 'Identity media path is invalid'; END IF;
  IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='worker-identity-private' AND name=p_photo_path)
  THEN RAISE EXCEPTION 'Private enrollment photo was not uploaded'; END IF;
  IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='worker-identity-private' AND name=p_liveness_path)
  THEN RAISE EXCEPTION 'Private liveness capture was not uploaded'; END IF;

  INSERT INTO public.worker_identity_checks(
    worker_id,status,enrollment_photo_path,liveness_video_path,consent_at,captured_at,
    reviewed_by,reviewed_at,rejection_reason,attempt_count,updated_at
  )
  VALUES(v_worker.user_id,'pending_review',p_photo_path,p_liveness_path,now(),now(),NULL,NULL,NULL,1,now())
  ON CONFLICT(worker_id) DO UPDATE SET
    status='pending_review',
    enrollment_photo_path=EXCLUDED.enrollment_photo_path,
    liveness_video_path=EXCLUDED.liveness_video_path,
    consent_at=now(),
    captured_at=now(),
    reviewed_by=NULL,
    reviewed_at=NULL,
    rejection_reason=NULL,
    attempt_count=public.worker_identity_checks.attempt_count+1,
    updated_at=now();
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_staff_worker_identity_check(p_worker_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE
  v_actor public.profiles;
  v_check public.worker_identity_checks;
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role='staff'
    AND NOT COALESCE(deleted,false) AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false)
  LIMIT 1;
  IF v_actor IS NULL OR NOT public.current_staff_has_permission('verification')
     OR NOT public.current_staff_can_review_worker(p_worker_id)
  THEN RAISE EXCEPTION 'Trusted Verification Staff access required'; END IF;

  SELECT * INTO v_check FROM public.worker_identity_checks WHERE worker_id=p_worker_id;
  RETURN jsonb_build_object(
    'status',COALESCE(v_check.status,'not_started'),
    'photo_path',v_check.enrollment_photo_path,
    'liveness_path',v_check.liveness_video_path,
    'challenge_version',v_check.challenge_version,
    'captured_at',v_check.captured_at,
    'reviewed_at',v_check.reviewed_at,
    'rejection_reason',v_check.rejection_reason,
    'attempt_count',COALESCE(v_check.attempt_count,0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.review_my_staff_worker_identity_check(
  p_worker_id text,
  p_decision text,
  p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE
  v_actor public.profiles;
  v_check public.worker_identity_checks;
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role='staff'
    AND NOT COALESCE(deleted,false) AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false)
  LIMIT 1;
  IF v_actor IS NULL OR NOT public.current_staff_has_permission('verification')
     OR NOT public.current_staff_can_review_worker(p_worker_id)
  THEN RAISE EXCEPTION 'Trusted Verification Staff access required'; END IF;
  IF p_decision NOT IN('pass','fail') THEN RAISE EXCEPTION 'Decision must be pass or fail'; END IF;
  IF p_decision='fail' AND NULLIF(BTRIM(COALESCE(p_reason,'')),'') IS NULL
  THEN RAISE EXCEPTION 'Reason is required when the identity check fails'; END IF;

  SELECT * INTO v_check FROM public.worker_identity_checks WHERE worker_id=p_worker_id FOR UPDATE;
  IF v_check IS NULL OR v_check.status<>'pending_review'
  THEN RAISE EXCEPTION 'No identity check is waiting for review'; END IF;

  IF p_decision='pass' THEN
    UPDATE public.worker_identity_checks
    SET status='passed',reviewed_by=v_actor.user_id,reviewed_at=now(),rejection_reason=NULL,updated_at=now()
    WHERE worker_id=p_worker_id;
  ELSE
    UPDATE public.worker_identity_checks
    SET status='failed',reviewed_by=v_actor.user_id,reviewed_at=now(),rejection_reason=BTRIM(p_reason),updated_at=now()
    WHERE worker_id=p_worker_id;

    UPDATE public.profiles
    SET worker_status=CASE WHEN EXISTS(
      SELECT 1 FROM public.booking_payments
      WHERE user_id=p_worker_id AND purpose='worker_verification' AND status IN('paid','completed')
    ) THEN 'verification_paid' ELSE 'pending' END,
    worker_verified=false,available=false,updated_at=now()
    WHERE user_id=p_worker_id;

    UPDATE public.worker_verifications
    SET status=CASE WHEN EXISTS(
      SELECT 1 FROM public.booking_payments
      WHERE user_id=p_worker_id AND purpose='worker_verification' AND status IN('paid','completed')
    ) THEN 'verification_paid' ELSE 'pending' END,
    submitted_at=NULL,updated_at=now()
    WHERE worker_id=p_worker_id;
  END IF;

  INSERT INTO public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
  VALUES(
    CASE WHEN p_decision='pass' THEN 'WORKER_IDENTITY_CHECK_PASSED' ELSE 'WORKER_IDENTITY_CHECK_FAILED' END,
    'profiles',p_worker_id,
    jsonb_build_object('challenge',v_check.challenge_version,'reason',CASE WHEN p_decision='fail' THEN BTRIM(p_reason) ELSE NULL END)::text,
    v_actor.user_id,v_actor.email
  );
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_worker_marketplace_trust(p_worker_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE
  v_worker public.profiles;
  v_identity boolean:=false;
  v_enabled boolean:=false;
  v_min_jobs integer:=5;
  v_min_rating numeric:=4.5;
  v_max_cancel numeric:=20;
  v_block_disputes boolean:=true;
  v_completed integer:=0;
  v_worker_cancelled integer:=0;
  v_unresolved integer:=0;
  v_terminal integer:=0;
  v_cancel_rate numeric:=0;
  v_trusted boolean:=false;
BEGIN
  SELECT * INTO v_worker FROM public.profiles WHERE user_id=p_worker_id AND role='worker' LIMIT 1;
  IF v_worker IS NULL THEN RETURN jsonb_build_object('level','unavailable'); END IF;
  IF NOT (
    v_worker.worker_status='verified' AND v_worker.worker_verified=true
    AND NOT COALESCE(v_worker.deleted,false) AND NOT COALESCE(v_worker.suspended,false) AND NOT COALESCE(v_worker.banned,false)
  ) THEN RETURN jsonb_build_object('level','unavailable'); END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.worker_identity_checks WHERE worker_id=p_worker_id AND status='passed'
  ) INTO v_identity;

  SELECT COALESCE(lower(value) IN('true','1','yes','on'),false)
  INTO v_enabled FROM public.platform_settings WHERE key='worker_trust_enabled' AND is_active=true LIMIT 1;
  SELECT COALESCE(NULLIF(value,'')::integer,5)
  INTO v_min_jobs FROM public.platform_settings WHERE key='worker_trusted_min_completed_jobs' AND is_active=true LIMIT 1;
  SELECT COALESCE(NULLIF(value,'')::numeric,4.5)
  INTO v_min_rating FROM public.platform_settings WHERE key='worker_trusted_min_rating' AND is_active=true LIMIT 1;
  SELECT COALESCE(NULLIF(value,'')::numeric,20)
  INTO v_max_cancel FROM public.platform_settings WHERE key='worker_trusted_max_cancel_rate' AND is_active=true LIMIT 1;
  SELECT COALESCE(lower(value) IN('true','1','yes','on'),true)
  INTO v_block_disputes FROM public.platform_settings WHERE key='worker_trusted_block_open_disputes' AND is_active=true LIMIT 1;

  SELECT count(*)::integer INTO v_completed
  FROM public.worker_bookings
  WHERE worker_id=p_worker_id AND (completed_at IS NOT NULL OR status IN('completed','approved_released'));

  SELECT count(*)::integer INTO v_worker_cancelled
  FROM public.worker_bookings
  WHERE worker_id=p_worker_id AND status='cancelled' AND cancelled_by=p_worker_id;

  SELECT count(*)::integer INTO v_unresolved
  FROM public.worker_bookings
  WHERE worker_id=p_worker_id AND (status='disputed' OR (dispute_reason IS NOT NULL AND dispute_resolution IS NULL));

  v_terminal:=v_completed+v_worker_cancelled;
  v_cancel_rate:=CASE WHEN v_terminal=0 THEN 0 ELSE round((v_worker_cancelled::numeric/v_terminal::numeric)*100,1) END;
  v_trusted:=v_enabled AND v_identity
    AND v_completed>=v_min_jobs
    AND COALESCE(v_worker.rating,0)>=v_min_rating
    AND v_cancel_rate<=v_max_cancel
    AND (NOT v_block_disputes OR v_unresolved=0);

  RETURN jsonb_build_object(
    'level',CASE WHEN v_trusted THEN 'trusted' ELSE 'reviewed' END,
    'identity_check_completed',v_identity,
    'completed_jobs',v_completed,
    'rating',COALESCE(v_worker.rating,0),
    'review_count',COALESCE(v_worker.review_count,0),
    'worker_cancel_rate',v_cancel_rate,
    'clean_record',(v_unresolved=0),
    'trusted_enabled',v_enabled
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_booking(p_booking_id uuid,p_reason text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE
  v_canceller_id text;
  v_booking record;
BEGIN
  SELECT user_id INTO v_canceller_id FROM public.profiles WHERE auth_id=auth.uid()::text;
  SELECT id,user_id,worker_id,status INTO v_booking FROM public.worker_bookings WHERE id=p_booking_id FOR UPDATE;
  IF v_booking IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF v_booking.user_id!=v_canceller_id AND v_booking.worker_id!=v_canceller_id
  THEN RAISE EXCEPTION 'Not authorized to cancel this booking'; END IF;
  IF v_booking.status NOT IN('booking_requested','negotiating','waiting_payment')
  THEN RAISE EXCEPTION 'Booking cannot be cancelled in current status: %',v_booking.status; END IF;
  UPDATE public.worker_bookings
  SET status='cancelled',cancellation_reason=p_reason,cancelled_by=v_canceller_id,updated_at=now()
  WHERE id=p_booking_id;
  RETURN true;
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
  v_test public.worker_test_attempts;
  v_identity public.worker_identity_checks;
  v_attempts_24h integer;
  v_profile_ready boolean;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE auth_id=auth.uid()::text AND role='worker' LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Worker profile not found'; END IF;
  v_profile_ready:=public.worker_professional_profile_ready(v_profile.user_id);
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

  SELECT * INTO v_identity FROM public.worker_identity_checks WHERE worker_id=v_profile.user_id;
  IF v_identity IS NULL OR v_identity.status NOT IN('pending_review','passed')
  THEN RAISE EXCEPTION 'Complete the private WeHouse face and liveness check before submission'; END IF;

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

CREATE OR REPLACE FUNCTION public.admin_get_worker_review_trust_status(p_worker_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE
  v_actor public.profiles;
  v_worker public.profiles;
  v_ver public.worker_verifications;
  v_payment boolean;
  v_test public.worker_test_attempts;
  v_identity public.worker_identity_checks;
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role IN('staff','admin','creator')
    AND NOT COALESCE(deleted,false) AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false)
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Verification review access required'; END IF;
  IF v_actor.role='staff' AND NOT public.current_staff_has_permission('verification')
  THEN RAISE EXCEPTION 'Trusted Verification Staff permission required'; END IF;

  SELECT * INTO v_worker FROM public.profiles WHERE user_id=p_worker_id AND role='worker' LIMIT 1;
  IF v_worker IS NULL THEN RAISE EXCEPTION 'Worker not found'; END IF;
  IF v_actor.role IN('staff','admin') AND(
    v_actor.assigned_state IS DISTINCT FROM v_worker.state
    OR(v_actor.assigned_lga IS NOT NULL AND v_actor.assigned_lga IS DISTINCT FROM COALESCE(v_worker.local_government,v_worker.city))
  ) THEN RAISE EXCEPTION 'Worker is outside your assigned branch'; END IF;

  SELECT * INTO v_ver FROM public.worker_verifications WHERE worker_id=p_worker_id LIMIT 1;
  SELECT * INTO v_identity FROM public.worker_identity_checks WHERE worker_id=p_worker_id;
  SELECT EXISTS(
    SELECT 1 FROM public.booking_payments
    WHERE user_id=p_worker_id AND purpose='worker_verification' AND status IN('paid','completed')
  ) INTO v_payment;
  SELECT * INTO v_test FROM public.worker_test_attempts
  WHERE worker_id=p_worker_id AND passed=true AND submitted_at IS NOT NULL
  ORDER BY submitted_at DESC LIMIT 1;

  RETURN jsonb_build_object(
    'payment_confirmed',v_payment,
    'identity_status',COALESCE(v_identity.status,'not_started'),
    'identity_captured',COALESCE(v_identity.status IN('pending_review','passed'),false),
    'identity_passed',COALESCE(v_identity.status='passed',false),
    'readiness_passed',v_test.id IS NOT NULL,
    'readiness_percent',v_test.percent,
    'evidence_saved',COALESCE(NULLIF(BTRIM(COALESCE(v_ver.verification_video_url,'')),'') IS NOT NULL,false),
    'submitted',COALESCE(v_ver.submitted_at IS NOT NULL,false),
    'review_status',v_ver.status
  );
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
  SELECT * INTO v_identity FROM public.worker_identity_checks WHERE worker_id=p_worker_id;

  IF p_status='verified' THEN
    IF v_worker.worker_status<>'profile_under_review' THEN RAISE EXCEPTION 'Worker is not in the review queue'; END IF;
    IF v_identity IS NULL OR v_identity.status<>'passed' THEN RAISE EXCEPTION 'Private WeHouse face and liveness check has not passed'; END IF;
    IF NOT public.worker_test_passed(p_worker_id) THEN RAISE EXCEPTION 'Worker readiness check has not been passed'; END IF;
    IF v_ver IS NULL OR NULLIF(BTRIM(COALESCE(v_ver.verification_video_url,'')),'') IS NULL
    THEN RAISE EXCEPTION 'Professional work evidence is incomplete'; END IF;
  END IF;

  UPDATE public.profiles
  SET worker_status=p_status,worker_verified=(p_status='verified'),available=(p_status='verified'),updated_at=now(),updated_by=v_actor.user_id
  WHERE user_id=p_worker_id;
  UPDATE public.worker_verifications
  SET status=p_status,reviewed_by=v_actor.user_id,
      review_notes=COALESCE(NULLIF(BTRIM(p_notes),''),NULLIF(BTRIM(p_reason),'')),
      reviewed_at=now(),updated_at=now()
  WHERE id=v_ver.id;
  INSERT INTO public.worker_verification_reviews(worker_id,reviewer_id,reviewer_role,action,rejection_reason,notes,created_at)
  VALUES(p_worker_id,v_actor.user_id,v_actor.role,p_status,CASE WHEN p_status='rejected' THEN BTRIM(p_reason) ELSE NULL END,NULLIF(BTRIM(COALESCE(p_notes,'')),''),now());
  RETURN true;
END;
$$;

-- Keep the old Admin/Creator RPC safe even though routine approval is removed from those dashboards.
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
  SELECT * INTO v_identity FROM public.worker_identity_checks WHERE worker_id=p_worker_id;

  IF p_decision='approve' THEN
    IF v_identity IS NULL OR v_identity.status<>'passed' THEN RAISE EXCEPTION 'Private WeHouse face and liveness check has not passed'; END IF;
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

REVOKE ALL ON FUNCTION public.get_my_worker_identity_check() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.save_my_worker_identity_capture(text,text,boolean) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_staff_worker_identity_check(text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.review_my_staff_worker_identity_check(text,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_worker_marketplace_trust(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_worker_identity_check() TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_my_worker_identity_capture(text,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_staff_worker_identity_check(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_my_staff_worker_identity_check(text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_worker_marketplace_trust(text) TO authenticated,anon;
