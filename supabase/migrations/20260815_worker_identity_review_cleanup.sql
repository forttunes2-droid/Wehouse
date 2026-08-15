-- Private identity media is needed only until Verification Staff make a decision.
-- Keep the review result/audit record; remove raw photo/video through the Storage API after review.

UPDATE public.platform_settings
SET is_active=false,
    description='Retired: raw identity media is removed after Verification Staff review instead of being retained for a configured period.',
    updated_at=now()
WHERE key='worker_identity_retention_days';

DROP POLICY IF EXISTS worker_identity_verification_staff_delete ON storage.objects;
CREATE POLICY worker_identity_verification_staff_delete ON storage.objects
FOR DELETE TO authenticated
USING(
  bucket_id='worker-identity-private'
  AND public.current_staff_can_review_worker((storage.foldername(name))[1])
);

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
  IF NULLIF(BTRIM(COALESCE(v_check.enrollment_photo_path,'')),'') IS NULL
     OR NULLIF(BTRIM(COALESCE(v_check.liveness_video_path,'')),'') IS NULL
  THEN RAISE EXCEPTION 'Private identity evidence is incomplete'; END IF;

  IF p_decision='pass' THEN
    UPDATE public.worker_identity_checks
    SET status='passed',reviewed_by=v_actor.user_id,reviewed_at=now(),rejection_reason=NULL,
        enrollment_photo_path=NULL,liveness_video_path=NULL,updated_at=now()
    WHERE worker_id=p_worker_id;
  ELSE
    UPDATE public.worker_identity_checks
    SET status='failed',reviewed_by=v_actor.user_id,reviewed_at=now(),rejection_reason=BTRIM(p_reason),
        enrollment_photo_path=NULL,liveness_video_path=NULL,updated_at=now()
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
    jsonb_build_object(
      'challenge',v_check.challenge_version,
      'reason',CASE WHEN p_decision='fail' THEN BTRIM(p_reason) ELSE NULL END,
      'raw_media_retained',false
    )::text,
    v_actor.user_id,v_actor.email
  );
  RETURN true;
END;
$$;
