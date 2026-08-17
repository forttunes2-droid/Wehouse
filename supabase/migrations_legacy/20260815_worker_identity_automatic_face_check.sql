-- WeHouse automatic Worker face assurance.
-- Private live selfie + on-device live face matching/head movement.
-- No government ID. No external identity provider. No liveness video storage.

CREATE TABLE IF NOT EXISTS public.worker_identity_checks (
  worker_id text PRIMARY KEY REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','passed','failed')),
  enrollment_photo_path text,
  challenge_version text NOT NULL DEFAULT 'human-3.3.6-head-turn-v1',
  face_match_score numeric,
  liveness_score numeric,
  anti_spoof_score numeric,
  challenge_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  consent_at timestamptz,
  captured_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Compatibility if an earlier unreleased branch version created the table.
DROP FUNCTION IF EXISTS public.save_my_worker_identity_capture(text,text,boolean);
DROP FUNCTION IF EXISTS public.review_my_staff_worker_identity_check(text,text,text);
DROP FUNCTION IF EXISTS public.get_staff_worker_identity_check(text);
DROP FUNCTION IF EXISTS public.get_my_worker_identity_check();
ALTER TABLE public.worker_identity_checks DROP COLUMN IF EXISTS liveness_video_path;
ALTER TABLE public.worker_identity_checks ADD COLUMN IF NOT EXISTS face_match_score numeric;
ALTER TABLE public.worker_identity_checks ADD COLUMN IF NOT EXISTS liveness_score numeric;
ALTER TABLE public.worker_identity_checks ADD COLUMN IF NOT EXISTS anti_spoof_score numeric;
ALTER TABLE public.worker_identity_checks ADD COLUMN IF NOT EXISTS challenge_result jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.worker_identity_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.worker_identity_checks FROM anon, authenticated;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES(
  'worker-identity-private',
  'worker-identity-private',
  false,
  10485760,
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT(id) DO UPDATE
SET public=false,
    file_size_limit=EXCLUDED.file_size_limit,
    allowed_mime_types=EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS worker_identity_insert_own ON storage.objects;
DROP POLICY IF EXISTS worker_identity_read_own ON storage.objects;
DROP POLICY IF EXISTS worker_identity_delete_own ON storage.objects;
DROP POLICY IF EXISTS worker_identity_verification_staff_read ON storage.objects;
DROP POLICY IF EXISTS worker_identity_verification_staff_delete ON storage.objects;

CREATE POLICY worker_identity_insert_own ON storage.objects
FOR INSERT TO authenticated
WITH CHECK(
  bucket_id='worker-identity-private'
  AND public.current_profile_role()='worker'
  AND (storage.foldername(name))[1]=public.current_profile_user_id()
);

CREATE POLICY worker_identity_read_own ON storage.objects
FOR SELECT TO authenticated
USING(
  bucket_id='worker-identity-private'
  AND public.current_profile_role()='worker'
  AND (storage.foldername(name))[1]=public.current_profile_user_id()
);

CREATE POLICY worker_identity_delete_own ON storage.objects
FOR DELETE TO authenticated
USING(
  bucket_id='worker-identity-private'
  AND public.current_profile_role()='worker'
  AND (storage.foldername(name))[1]=public.current_profile_user_id()
);

-- Foundational identity assurance is not a Creator on/off preference.
INSERT INTO public.platform_settings(key,value,category,label,description,data_type,editable,is_active,updated_at)
VALUES(
  'worker_identity_check_required','true','worker','Private Worker face check',
  'System requirement: a Worker must pass the private live-selfie and automatic head-movement face check before professional review.',
  'boolean',false,true,now()
)
ON CONFLICT(key) DO UPDATE
SET value='true', editable=false, is_active=true,
    description=EXCLUDED.description, updated_at=now();

UPDATE public.platform_settings
SET is_active=false, editable=false,
    description='Retired. WeHouse does not collect government identity documents for Worker verification.',
    updated_at=now()
WHERE key IN('worker_id_verification_required','worker_required_documents');

INSERT INTO public.platform_settings(key,value,category,label,description,data_type,editable,is_active,updated_at)
VALUES
 ('worker_trust_enabled','false','worker_trust','Enable WeHouse Trusted','Enable earned marketplace trust when Worker-booking reputation data is ready.','boolean',true,true,now()),
 ('worker_trusted_min_completed_jobs','5','worker_trust','Minimum completed WeHouse jobs','Completed WeHouse Worker jobs required for Trusted.','number',true,true,now()),
 ('worker_trusted_min_rating','4.5','worker_trust','Minimum rating','Minimum Worker marketplace rating required for Trusted.','number',true,true,now()),
 ('worker_trusted_max_cancel_rate','20','worker_trust','Maximum Worker cancellation rate (%)','Maximum Worker-caused cancellation percentage allowed for Trusted.','number',true,true,now()),
 ('worker_trusted_block_open_disputes','true','worker_trust','Block Trusted with unresolved disputes','Prevent Trusted while a Worker has unresolved booking disputes.','boolean',true,true,now())
ON CONFLICT(key) DO NOTHING;

ALTER TABLE public.worker_bookings ADD COLUMN IF NOT EXISTS cancelled_by text;

CREATE OR REPLACE FUNCTION public.get_my_worker_identity_check()
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
  WHERE auth_id=auth.uid()::text AND role='worker'
    AND NOT COALESCE(deleted,false) AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false)
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Active Worker account required'; END IF;

  SELECT * INTO v_check FROM public.worker_identity_checks WHERE worker_id=v_actor.user_id;
  RETURN jsonb_build_object(
    'status',COALESCE(v_check.status,'not_started'),
    'has_private_selfie',COALESCE(NULLIF(BTRIM(COALESCE(v_check.enrollment_photo_path,'')),'') IS NOT NULL,false),
    'face_match_score',v_check.face_match_score,
    'liveness_score',v_check.liveness_score,
    'anti_spoof_score',v_check.anti_spoof_score,
    'challenge_version',v_check.challenge_version,
    'captured_at',v_check.captured_at,
    'attempt_count',COALESCE(v_check.attempt_count,0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_my_worker_identity_check(
  p_photo_path text,
  p_face_match_score numeric,
  p_liveness_score numeric,
  p_anti_spoof_score numeric,
  p_challenge_result jsonb,
  p_consent boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE
  v_actor public.profiles;
  v_attempts integer;
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role='worker'
    AND NOT COALESCE(deleted,false) AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false)
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Active Worker account required'; END IF;
  IF COALESCE(p_consent,false)=false THEN RAISE EXCEPTION 'Private face-check consent is required'; END IF;
  IF NULLIF(BTRIM(COALESCE(p_photo_path,'')),'') IS NULL OR p_photo_path NOT LIKE v_actor.user_id || '/%'
  THEN RAISE EXCEPTION 'Invalid private selfie path'; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM storage.objects
    WHERE bucket_id='worker-identity-private' AND name=p_photo_path
  ) THEN RAISE EXCEPTION 'Private live selfie was not uploaded'; END IF;

  IF p_face_match_score IS NULL OR p_face_match_score<0 OR p_face_match_score>1
     OR p_liveness_score IS NULL OR p_liveness_score<0 OR p_liveness_score>1
     OR p_anti_spoof_score IS NULL OR p_anti_spoof_score<0 OR p_anti_spoof_score>1
  THEN RAISE EXCEPTION 'Invalid automatic face-check score'; END IF;

  IF p_face_match_score < 0.55 THEN RAISE EXCEPTION 'Live face did not match the private selfie closely enough'; END IF;
  IF p_liveness_score < 0.50 THEN RAISE EXCEPTION 'Automatic liveness check did not pass'; END IF;
  IF p_anti_spoof_score < 0.50 THEN RAISE EXCEPTION 'Automatic anti-spoof check did not pass'; END IF;

  IF COALESCE((p_challenge_result->>'automatic')::boolean,false)=false
     OR COALESCE((p_challenge_result->>'center_start')::boolean,false)=false
     OR COALESCE((p_challenge_result->>'side_one')::boolean,false)=false
     OR COALESCE((p_challenge_result->>'side_two')::boolean,false)=false
     OR COALESCE((p_challenge_result->>'center_end')::boolean,false)=false
     OR COALESCE((p_challenge_result->>'recorded_video')::boolean,true)=true
  THEN RAISE EXCEPTION 'Automatic head-movement challenge is incomplete'; END IF;

  SELECT COALESCE(attempt_count,0)+1 INTO v_attempts
  FROM public.worker_identity_checks WHERE worker_id=v_actor.user_id;
  v_attempts:=COALESCE(v_attempts,1);

  INSERT INTO public.worker_identity_checks(
    worker_id,status,enrollment_photo_path,challenge_version,
    face_match_score,liveness_score,anti_spoof_score,challenge_result,
    consent_at,captured_at,attempt_count,updated_at
  ) VALUES(
    v_actor.user_id,'passed',p_photo_path,'human-3.3.6-head-turn-v1',
    p_face_match_score,p_liveness_score,p_anti_spoof_score,p_challenge_result,
    now(),now(),v_attempts,now()
  )
  ON CONFLICT(worker_id) DO UPDATE SET
    status='passed',
    enrollment_photo_path=EXCLUDED.enrollment_photo_path,
    challenge_version=EXCLUDED.challenge_version,
    face_match_score=EXCLUDED.face_match_score,
    liveness_score=EXCLUDED.liveness_score,
    anti_spoof_score=EXCLUDED.anti_spoof_score,
    challenge_result=EXCLUDED.challenge_result,
    consent_at=EXCLUDED.consent_at,
    captured_at=EXCLUDED.captured_at,
    attempt_count=v_attempts,
    updated_at=now();

  INSERT INTO public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
  VALUES(
    'WORKER_AUTOMATIC_FACE_CHECK_PASSED','profiles',v_actor.user_id,
    jsonb_build_object(
      'challenge_version','human-3.3.6-head-turn-v1',
      'face_match_score',p_face_match_score,
      'liveness_score',p_liveness_score,
      'anti_spoof_score',p_anti_spoof_score,
      'liveness_video_recorded',false,
      'private_selfie',true
    )::text,
    v_actor.user_id,v_actor.email
  );

  RETURN jsonb_build_object('status','passed','captured_at',now(),'attempt_count',v_attempts);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_staff_worker_identity_check(p_worker_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE
  v_check public.worker_identity_checks;
BEGIN
  IF NOT public.current_staff_can_review_worker(p_worker_id)
  THEN RAISE EXCEPTION 'Worker is outside your verification scope'; END IF;
  SELECT * INTO v_check FROM public.worker_identity_checks WHERE worker_id=p_worker_id;
  RETURN jsonb_build_object(
    'status',COALESCE(v_check.status,'not_started'),
    'face_match_score',v_check.face_match_score,
    'liveness_score',v_check.liveness_score,
    'anti_spoof_score',v_check.anti_spoof_score,
    'challenge_version',v_check.challenge_version,
    'captured_at',v_check.captured_at,
    'attempt_count',COALESCE(v_check.attempt_count,0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_worker_marketplace_trust(p_worker_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE
  v_worker public.profiles;
  v_identity public.worker_identity_checks;
  v_enabled boolean:=false;
  v_min_jobs integer:=5;
  v_min_rating numeric:=4.5;
  v_max_cancel numeric:=20;
  v_block_disputes boolean:=true;
  v_completed integer:=0;
  v_worker_cancelled integer:=0;
  v_open_disputes integer:=0;
  v_cancel_rate numeric:=0;
  v_trusted boolean:=false;
BEGIN
  SELECT * INTO v_worker FROM public.profiles
  WHERE user_id=p_worker_id AND role='worker'
    AND worker_status='verified' AND worker_verified=true
    AND available=true AND NOT COALESCE(deleted,false)
    AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false)
  LIMIT 1;
  IF v_worker IS NULL THEN RETURN jsonb_build_object('reviewed',false,'trusted',false); END IF;

  SELECT * INTO v_identity FROM public.worker_identity_checks WHERE worker_id=p_worker_id;
  SELECT COALESCE(lower(value) IN('true','1','yes','on'),false) INTO v_enabled FROM public.platform_settings WHERE key='worker_trust_enabled' AND is_active=true LIMIT 1;
  SELECT COALESCE(NULLIF(value,''),'5')::integer INTO v_min_jobs FROM public.platform_settings WHERE key='worker_trusted_min_completed_jobs' AND is_active=true LIMIT 1;
  SELECT COALESCE(NULLIF(value,''),'4.5')::numeric INTO v_min_rating FROM public.platform_settings WHERE key='worker_trusted_min_rating' AND is_active=true LIMIT 1;
  SELECT COALESCE(NULLIF(value,''),'20')::numeric INTO v_max_cancel FROM public.platform_settings WHERE key='worker_trusted_max_cancel_rate' AND is_active=true LIMIT 1;
  SELECT COALESCE(lower(value) IN('true','1','yes','on'),true) INTO v_block_disputes FROM public.platform_settings WHERE key='worker_trusted_block_open_disputes' AND is_active=true LIMIT 1;

  SELECT count(*) INTO v_completed FROM public.worker_bookings WHERE worker_id=p_worker_id AND status='approved_released';
  SELECT count(*) INTO v_worker_cancelled FROM public.worker_bookings WHERE worker_id=p_worker_id AND status='cancelled' AND cancelled_by=p_worker_id;
  SELECT count(*) INTO v_open_disputes FROM public.worker_bookings WHERE worker_id=p_worker_id AND status='disputed';
  IF v_completed+v_worker_cancelled>0 THEN
    v_cancel_rate:=round((v_worker_cancelled::numeric*100)/(v_completed+v_worker_cancelled),2);
  END IF;

  v_trusted:=COALESCE(v_enabled,false)
    AND COALESCE(v_identity.status='passed',false)
    AND v_completed>=COALESCE(v_min_jobs,5)
    AND COALESCE(v_worker.rating,0)>=COALESCE(v_min_rating,4.5)
    AND v_cancel_rate<=COALESCE(v_max_cancel,20)
    AND (NOT COALESCE(v_block_disputes,true) OR v_open_disputes=0);

  RETURN jsonb_build_object(
    'reviewed',true,
    'face_check_passed',COALESCE(v_identity.status='passed',false),
    'trusted',v_trusted,
    'trusted_enabled',COALESCE(v_enabled,false),
    'completed_jobs',v_completed,
    'rating',COALESCE(v_worker.rating,0),
    'review_count',COALESCE(v_worker.review_count,0),
    'worker_cancel_rate',v_cancel_rate,
    'open_disputes',v_open_disputes,
    'label',CASE WHEN v_trusted THEN 'WeHouse Trusted' ELSE 'WeHouse Reviewed' END
  );
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
  v_identity public.worker_identity_checks;
  v_payment boolean:=false;
  v_test public.worker_test_attempts;
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role IN('staff','admin','creator')
    AND NOT COALESCE(deleted,false) AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false)
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Worker oversight access required'; END IF;
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
  SELECT EXISTS(SELECT 1 FROM public.booking_payments WHERE user_id=p_worker_id AND purpose='worker_verification' AND status IN('paid','completed')) INTO v_payment;
  SELECT * INTO v_test FROM public.worker_test_attempts WHERE worker_id=p_worker_id AND passed=true AND submitted_at IS NOT NULL ORDER BY submitted_at DESC LIMIT 1;

  RETURN jsonb_build_object(
    'payment_confirmed',v_payment,
    'identity_status',COALESCE(v_identity.status,'not_started'),
    'identity_captured',COALESCE(v_identity.status='passed',false),
    'identity_passed',COALESCE(v_identity.status='passed',false),
    'face_match_score',v_identity.face_match_score,
    'liveness_score',v_identity.liveness_score,
    'anti_spoof_score',v_identity.anti_spoof_score,
    'readiness_passed',v_test.id IS NOT NULL,
    'readiness_percent',v_test.percent,
    'evidence_saved',COALESCE(NULLIF(BTRIM(COALESCE(v_ver.verification_video_url,'')),'') IS NOT NULL,false),
    'submitted',COALESCE(v_ver.submitted_at IS NOT NULL,false),
    'review_status',v_ver.status
  );
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
  v_attempts_24h integer:=0;
  v_profile_ready boolean:=false;
  v_paid boolean:=false;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE auth_id=auth.uid()::text AND role='worker' LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Worker profile not found'; END IF;
  v_profile_ready:=public.worker_professional_profile_ready(v_profile.user_id);
  SELECT * INTO v_ver FROM public.worker_verifications WHERE worker_id=v_profile.user_id LIMIT 1;
  SELECT * INTO v_payment FROM public.booking_payments WHERE user_id=v_profile.user_id AND purpose='worker_verification' ORDER BY created_at DESC LIMIT 1;
  SELECT * INTO v_test FROM public.worker_test_attempts WHERE worker_id=v_profile.user_id ORDER BY started_at DESC LIMIT 1;
  SELECT * INTO v_identity FROM public.worker_identity_checks WHERE worker_id=v_profile.user_id;
  SELECT count(*) INTO v_attempts_24h FROM public.worker_test_attempts WHERE worker_id=v_profile.user_id AND started_at>=now()-interval '24 hours';
  v_paid:=COALESCE(v_payment.status IN('paid','completed'),false);

  RETURN jsonb_build_object(
    'worker_status',COALESCE(v_profile.worker_status,'pending'),
    'live',COALESCE(v_profile.worker_status='verified' AND v_profile.worker_verified,false),
    'profile_complete',v_profile_ready,
    'payment_status',v_payment.status,
    'payment_confirmed',v_paid,
    'gold_badge',v_paid,
    'identity_required',true,
    'identity_status',COALESCE(v_identity.status,'not_started'),
    'identity_captured',COALESCE(v_identity.status='passed',false),
    'identity_passed',COALESCE(v_identity.status='passed',false),
    'test_passed',public.worker_test_passed(v_profile.user_id),
    'test_percent',v_test.percent,
    'test_attempts_24h',v_attempts_24h,
    'evidence_saved',COALESCE(NULLIF(BTRIM(COALESCE(v_ver.verification_video_url,'')),'') IS NOT NULL,false),
    'submitted',COALESCE(v_ver.submitted_at IS NOT NULL,false),
    'review_status',v_ver.status,
    'rejection_reason',(SELECT rejection_reason FROM public.worker_verification_reviews WHERE worker_id=v_profile.user_id ORDER BY created_at DESC LIMIT 1)
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
  v_identity public.worker_identity_checks;
  v_paid boolean:=false;
BEGIN
  SELECT * INTO v_profile FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role='worker'
    AND NOT COALESCE(deleted,false) AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false)
  LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Active Worker account required'; END IF;
  IF NOT public.worker_professional_profile_ready(v_profile.user_id)
  THEN RAISE EXCEPTION 'Complete your professional profile and service coverage first'; END IF;

  SELECT * INTO v_identity FROM public.worker_identity_checks WHERE worker_id=v_profile.user_id;
  IF v_identity IS NULL OR v_identity.status<>'passed'
  THEN RAISE EXCEPTION 'Pass the automatic private WeHouse face check before submission'; END IF;

  SELECT EXISTS(SELECT 1 FROM public.booking_payments WHERE user_id=v_profile.user_id AND purpose='worker_verification' AND status IN('paid','completed')) INTO v_paid;
  IF NOT v_paid THEN RAISE EXCEPTION 'Confirmed Paystack payment is required before submission'; END IF;
  IF NOT public.worker_test_passed(v_profile.user_id)
  THEN RAISE EXCEPTION 'Pass the Worker readiness check before submission'; END IF;

  SELECT * INTO v_ver FROM public.worker_verifications WHERE worker_id=v_profile.user_id LIMIT 1;
  IF v_ver IS NULL OR NULLIF(BTRIM(COALESCE(v_ver.verification_video_url,'')),'') IS NULL
  THEN RAISE EXCEPTION 'A work demonstration video is required before review'; END IF;

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
  IF p_status NOT IN('verified','rejected') THEN RAISE EXCEPTION 'Invalid review outcome'; END IF;
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
    SELECT * INTO v_identity FROM public.worker_identity_checks WHERE worker_id=p_worker_id;
    IF v_identity IS NULL OR v_identity.status<>'passed' THEN RAISE EXCEPTION 'Automatic private face check has not passed'; END IF;
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
  IF v_booking.user_id<>v_canceller_id AND v_booking.worker_id<>v_canceller_id THEN RAISE EXCEPTION 'Not authorized to cancel this booking'; END IF;
  IF v_booking.status NOT IN('booking_requested','negotiating','waiting_payment') THEN RAISE EXCEPTION 'Booking cannot be cancelled in current status: %',v_booking.status; END IF;
  UPDATE public.worker_bookings SET status='cancelled',cancellation_reason=p_reason,cancelled_by=v_canceller_id,updated_at=now() WHERE id=p_booking_id;
  RETURN true;
END;
$$;

-- Routine Worker approval belongs to trusted Verification Staff, not Admin/Creator browser actions.
DO $$
BEGIN
  IF to_regprocedure('public.admin_review_my_branch_worker(text,text,text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.admin_review_my_branch_worker(text,text,text) FROM PUBLIC,anon,authenticated;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.get_my_worker_identity_check() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.complete_my_worker_identity_check(text,numeric,numeric,numeric,jsonb,boolean) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_staff_worker_identity_check(text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_get_worker_review_trust_status(text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_my_worker_activation() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.submit_my_worker_verification() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.review_my_staff_worker_v2(text,text,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.cancel_booking(uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_worker_marketplace_trust(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_my_worker_identity_check() TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_my_worker_identity_check(text,numeric,numeric,numeric,jsonb,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_staff_worker_identity_check(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_worker_review_trust_status(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_worker_activation() TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_my_worker_verification() TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_my_staff_worker_v2(text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_booking(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_worker_marketplace_trust(text) TO anon,authenticated;

-- Stop new use of retired government/external identity fields while preserving old columns for compatibility.
CREATE OR REPLACE FUNCTION public.guard_retired_worker_identity_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path='public'
AS $$
BEGIN
  IF NULLIF(BTRIM(COALESCE(NEW.gov_id_type,'')),'') IS NOT NULL
     OR NULLIF(BTRIM(COALESCE(NEW.gov_id_number,'')),'') IS NOT NULL
     OR NULLIF(BTRIM(COALESCE(NEW.gov_id_photo_url,'')),'') IS NOT NULL
     OR NULLIF(BTRIM(COALESCE(NEW.selfie_photo_url,'')),'') IS NOT NULL
     OR NULLIF(BTRIM(COALESCE(NEW.identity_provider,'')),'') IS NOT NULL
     OR NULLIF(BTRIM(COALESCE(NEW.identity_reference,'')),'') IS NOT NULL
  THEN RAISE EXCEPTION 'Government/external identity fields are retired. Use the private WeHouse automatic face check.'; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS worker_verifications_retired_identity_guard ON public.worker_verifications;
CREATE TRIGGER worker_verifications_retired_identity_guard
BEFORE INSERT OR UPDATE ON public.worker_verifications
FOR EACH ROW EXECUTE FUNCTION public.guard_retired_worker_identity_fields();
