BEGIN;

-- Phase 4 canonical Worker activation:
-- professional profile -> verified Paystack payment -> readiness test ->
-- professional evidence -> external identity -> WeHouse review -> live.

CREATE TABLE IF NOT EXISTS public.worker_test_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  category text,
  question text NOT NULL,
  options jsonb NOT NULL,
  correct_index integer NOT NULL,
  explanation text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT worker_test_question_options_array CHECK (jsonb_typeof(options)='array'),
  CONSTRAINT worker_test_correct_index_nonnegative CHECK (correct_index>=0)
);

CREATE TABLE IF NOT EXISTS public.worker_test_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id text NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  question_ids uuid[] NOT NULL,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  score integer,
  total_questions integer NOT NULL,
  percent integer,
  passed boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_worker_test_attempts_worker_started
  ON public.worker_test_attempts(worker_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_worker_test_attempts_passed
  ON public.worker_test_attempts(worker_id, passed) WHERE passed=true;

ALTER TABLE public.worker_test_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_test_attempts ENABLE ROW LEVEL SECURITY;

-- Questions are intentionally not directly readable by the browser because the
-- row also contains the correct answer. The start RPC returns only safe fields.
REVOKE ALL ON public.worker_test_questions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.worker_test_attempts FROM PUBLIC, anon;
GRANT SELECT ON public.worker_test_attempts TO authenticated;

DROP POLICY IF EXISTS worker_test_attempts_select_own ON public.worker_test_attempts;
CREATE POLICY worker_test_attempts_select_own
ON public.worker_test_attempts
FOR SELECT TO authenticated
USING (
  worker_id=(
    SELECT p.user_id FROM public.profiles p
    WHERE p.auth_id=auth.uid()::text
    LIMIT 1
  )
);

INSERT INTO public.worker_test_questions(code,category,question,options,correct_index,explanation)
VALUES
('conduct_scope_change',NULL,'A customer asks for extra work that was not part of the agreed job. What should you do?',
 '["Do it first and discuss money later","Stop and agree the new scope, price and schedule before continuing","Ignore the request","Leave without telling the customer"]'::jsonb,1,
 'Changes to scope should be agreed before additional work begins.'),
('conduct_unsafe_request',NULL,'A customer asks you to use a shortcut that you believe is unsafe. What is the best response?',
 '["Follow the customer instruction because they are paying","Refuse the unsafe shortcut and explain a safer option","Do it only if nobody is watching","Ask the customer to accept responsibility and continue"]'::jsonb,1,
 'A professional must not knowingly perform unsafe work.'),
('conduct_property_care',NULL,'Before starting work inside a customer home, what is the best first step?',
 '["Start immediately","Confirm the job area and protect nearby property where needed","Move the customer belongings without permission","Record the whole house for social media"]'::jsonb,1,
 'Confirming the work area and protecting property reduces damage and disputes.'),
('conduct_skill_limit',NULL,'You discover the job requires a skill or licence you do not have. What should you do?',
 '["Try it anyway","Tell the customer and decline or refer the specialist part","Hide the issue and continue","Ask another unverified person to finish it secretly"]'::jsonb,1,
 'Workers should only accept work they can perform safely and competently.'),
('conduct_customer_privacy',NULL,'When may you post a customer work video or photo on your Worker profile?',
 '["Any time because you did the work","Only when you have permission and the media does not expose sensitive customer information","Only after midnight","Whenever the address is visible"]'::jsonb,1,
 'Work media must respect customer privacy and consent.'),
('conduct_completion',NULL,'What should happen before you mark a job complete?',
 '["Leave immediately after doing the main task","Check the work, clean the work area where appropriate and explain the result to the customer","Ask for a five-star review first","Delete the booking conversation"]'::jsonb,1,
 'Completion should include a basic quality check and clear handover.'),
('conduct_account_security',NULL,'Someone offers to use your verified Worker account and split the earnings with you. What should you do?',
 '["Accept if they are your friend","Refuse; your verified Worker identity and account must not be shared","Give them the password for one day","Create jobs for them under your name"]'::jsonb,1,
 'Verification belongs to the approved Worker and cannot be transferred.'),
('conduct_dispute_record',NULL,'A disagreement begins about the agreed price or job scope. What is the best action?',
 '["Threaten the customer","Keep the discussion in the WeHouse booking/chat record and use support if needed","Delete all messages","Change the price after completing the job"]'::jsonb,1,
 'Keeping the booking record intact helps resolve disputes fairly.'),
('conduct_emergency_risk',NULL,'You notice an immediate safety risk while working. What should you do first?',
 '["Ignore it and finish quickly","Stop the unsafe activity, make the area safe if you can do so safely, and inform the customer","Post it as a Work Story","Charge more before mentioning it"]'::jsonb,1,
 'Immediate safety risks should be controlled before normal work continues.'),
('conduct_platform_truth',NULL,'Which statement about the WeHouse verified badge is correct?',
 '["It can be sold to another Worker","It proves every future job will be perfect","It belongs to the approved account and does not replace honest job-by-job conduct","It allows the Worker to bypass booking rules"]'::jsonb,2,
 'Verification establishes the approved identity/account; professional conduct is still required on every job.')
ON CONFLICT(code) DO UPDATE SET
  category=EXCLUDED.category,
  question=EXCLUDED.question,
  options=EXCLUDED.options,
  correct_index=EXCLUDED.correct_index,
  explanation=EXCLUDED.explanation,
  is_active=true,
  updated_at=now();

CREATE OR REPLACE FUNCTION public.worker_test_passed(p_worker_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path='public'
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.worker_test_attempts
    WHERE worker_id=p_worker_id AND passed=true AND submitted_at IS NOT NULL
  );
$$;
REVOKE ALL ON FUNCTION public.worker_test_passed(text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.start_my_worker_test()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE
  v_profile public.profiles;
  v_paid boolean;
  v_attempt public.worker_test_attempts;
  v_ids uuid[];
  v_questions jsonb;
  v_recent_failed integer;
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

  SELECT EXISTS(
    SELECT 1 FROM public.booking_payments
    WHERE user_id=v_profile.user_id
      AND purpose='worker_verification'
      AND status IN ('paid','completed')
  ) INTO v_paid;
  IF NOT v_paid THEN RAISE EXCEPTION 'Verified Paystack payment is required before the Worker test'; END IF;

  IF public.worker_test_passed(v_profile.user_id) THEN
    SELECT * INTO v_attempt
    FROM public.worker_test_attempts
    WHERE worker_id=v_profile.user_id AND passed=true
    ORDER BY submitted_at DESC LIMIT 1;
    RETURN jsonb_build_object(
      'already_passed',true,
      'passed',true,
      'score',v_attempt.score,
      'total',v_attempt.total_questions,
      'percent',v_attempt.percent,
      'pass_percent',80
    );
  END IF;

  -- Close abandoned attempts after 45 minutes.
  UPDATE public.worker_test_attempts
  SET submitted_at=now(),score=0,percent=0,passed=false,answers='{}'::jsonb
  WHERE worker_id=v_profile.user_id
    AND submitted_at IS NULL
    AND started_at < now()-interval '45 minutes';

  SELECT count(*) INTO v_recent_failed
  FROM public.worker_test_attempts
  WHERE worker_id=v_profile.user_id
    AND submitted_at >= now()-interval '24 hours'
    AND passed=false;
  IF v_recent_failed>=5 THEN
    RAISE EXCEPTION 'Daily Worker test attempt limit reached. Try again after 24 hours';
  END IF;

  SELECT * INTO v_attempt
  FROM public.worker_test_attempts
  WHERE worker_id=v_profile.user_id AND submitted_at IS NULL
  ORDER BY started_at DESC LIMIT 1;

  IF v_attempt IS NULL THEN
    SELECT array_agg(id) INTO v_ids
    FROM (
      SELECT id
      FROM public.worker_test_questions
      WHERE is_active=true
        AND (category IS NULL OR lower(category)=lower(COALESCE(v_profile.worker_occupation,'')))
      ORDER BY CASE WHEN category IS NULL THEN 1 ELSE 0 END, random()
      LIMIT 8
    ) q;

    IF COALESCE(array_length(v_ids,1),0)<5 THEN
      RAISE EXCEPTION 'Worker test question bank is not configured';
    END IF;

    INSERT INTO public.worker_test_attempts(worker_id,question_ids,total_questions)
    VALUES(v_profile.user_id,v_ids,array_length(v_ids,1))
    RETURNING * INTO v_attempt;
  ELSE
    v_ids:=v_attempt.question_ids;
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object('id',q.id,'question',q.question,'options',q.options)
    ORDER BY u.ord
  ) INTO v_questions
  FROM unnest(v_ids) WITH ORDINALITY AS u(id,ord)
  JOIN public.worker_test_questions q ON q.id=u.id;

  RETURN jsonb_build_object(
    'already_passed',false,
    'attempt_id',v_attempt.id,
    'questions',COALESCE(v_questions,'[]'::jsonb),
    'pass_percent',80,
    'expires_at',v_attempt.started_at+interval '45 minutes'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_my_worker_test(p_attempt_id uuid,p_answers jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE
  v_profile public.profiles;
  v_attempt public.worker_test_attempts;
  v_total integer;
  v_answered integer;
  v_score integer;
  v_percent integer;
  v_passed boolean;
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
  IF jsonb_typeof(COALESCE(p_answers,'{}'::jsonb))<>'object' THEN RAISE EXCEPTION 'Invalid answers'; END IF;

  SELECT * INTO v_attempt
  FROM public.worker_test_attempts
  WHERE id=p_attempt_id AND worker_id=v_profile.user_id
  FOR UPDATE;
  IF v_attempt IS NULL THEN RAISE EXCEPTION 'Worker test attempt not found'; END IF;

  IF v_attempt.submitted_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'score',v_attempt.score,'total',v_attempt.total_questions,
      'percent',v_attempt.percent,'passed',v_attempt.passed,'already_submitted',true
    );
  END IF;
  IF v_attempt.started_at < now()-interval '45 minutes' THEN RAISE EXCEPTION 'Worker test attempt expired'; END IF;

  SELECT count(*),
         count(*) FILTER (WHERE p_answers ? q.id::text),
         count(*) FILTER (
           WHERE p_answers ? q.id::text
             AND (p_answers->>q.id::text) ~ '^[0-9]+$'
             AND (p_answers->>q.id::text)::integer=q.correct_index
         )
  INTO v_total,v_answered,v_score
  FROM unnest(v_attempt.question_ids) AS ids(id)
  JOIN public.worker_test_questions q ON q.id=ids.id;

  IF v_answered<>v_total THEN RAISE EXCEPTION 'Answer every Worker test question before submitting'; END IF;

  v_percent:=CASE WHEN v_total>0 THEN floor((v_score::numeric*100)/v_total)::integer ELSE 0 END;
  v_passed:=v_percent>=80;

  UPDATE public.worker_test_attempts
  SET answers=p_answers,score=v_score,total_questions=v_total,percent=v_percent,passed=v_passed,submitted_at=now()
  WHERE id=v_attempt.id;

  RETURN jsonb_build_object(
    'score',v_score,'total',v_total,'percent',v_percent,'passed',v_passed,
    'pass_percent',80,'already_submitted',false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.start_my_worker_test() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.submit_my_worker_test(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.start_my_worker_test() TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_my_worker_test(uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_my_worker_professional_evidence(
  p_certificate_path text,
  p_video_path text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE
  v_profile public.profiles;
  v_paid boolean;
  v_id uuid;
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
  IF v_profile.worker_status='verified' THEN RAISE EXCEPTION 'Live Worker evidence changes require a new review process'; END IF;
  IF NOT COALESCE(v_profile.profile_complete,false) THEN RAISE EXCEPTION 'Complete your professional profile first'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.worker_service_coverage WHERE worker_id=v_profile.user_id) THEN
    RAISE EXCEPTION 'Complete your service coverage first';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.booking_payments
    WHERE user_id=v_profile.user_id AND purpose='worker_verification' AND status IN ('paid','completed')
  ) INTO v_paid;
  IF NOT v_paid THEN RAISE EXCEPTION 'Verified Paystack payment is required first'; END IF;
  IF NOT public.worker_test_passed(v_profile.user_id) THEN RAISE EXCEPTION 'Pass the Worker readiness test first'; END IF;
  IF NULLIF(BTRIM(COALESCE(p_video_path,'')),'') IS NULL THEN RAISE EXCEPTION 'Skill demonstration video is required'; END IF;
  IF split_part(p_video_path,'/',1)<>v_profile.user_id THEN RAISE EXCEPTION 'Invalid Worker video path'; END IF;
  IF NULLIF(BTRIM(COALESCE(p_certificate_path,'')),'') IS NOT NULL
     AND split_part(p_certificate_path,'/',1)<>v_profile.user_id THEN
    RAISE EXCEPTION 'Invalid Worker certificate path';
  END IF;

  INSERT INTO public.worker_verifications(
    worker_id,certificate_path,verification_video_url,status,identity_provider,identity_status,
    submitted_at,created_at,updated_at,gov_id_type,gov_id_number,gov_id_photo_url,selfie_photo_url
  ) VALUES(
    v_profile.user_id,NULLIF(BTRIM(COALESCE(p_certificate_path,'')),''),BTRIM(p_video_path),
    'evidence_ready','youverify','ready_for_external',NULL,now(),now(),NULL,NULL,NULL,NULL
  )
  ON CONFLICT(worker_id) DO UPDATE SET
    certificate_path=EXCLUDED.certificate_path,
    verification_video_url=EXCLUDED.verification_video_url,
    status='evidence_ready',
    identity_provider=CASE WHEN worker_verifications.identity_status='verified' THEN worker_verifications.identity_provider ELSE 'youverify' END,
    identity_status=CASE WHEN worker_verifications.identity_status='verified' THEN 'verified' ELSE 'ready_for_external' END,
    identity_reference=CASE WHEN worker_verifications.identity_status='verified' THEN worker_verifications.identity_reference ELSE NULL END,
    identity_checked_at=CASE WHEN worker_verifications.identity_status='verified' THEN worker_verifications.identity_checked_at ELSE NULL END,
    identity_failure_reason=NULL,
    submitted_at=NULL,
    reviewed_by=NULL,
    review_notes=NULL,
    reviewed_at=NULL,
    gov_id_type=NULL,
    gov_id_number=NULL,
    gov_id_photo_url=NULL,
    selfie_photo_url=NULL,
    updated_at=now()
  RETURNING id INTO v_id;

  UPDATE public.profiles
  SET worker_status='verification_paid',worker_verified=false,available=false,
      worker_cert_url=NULLIF(BTRIM(COALESCE(p_certificate_path,'')),''),
      worker_video_url=BTRIM(p_video_path),updated_at=now()
  WHERE user_id=v_profile.user_id;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.save_my_worker_professional_evidence(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_my_worker_professional_evidence(text,text) TO authenticated;

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
  IF NOT COALESCE(v_profile.profile_complete,false) THEN RAISE EXCEPTION 'Complete your professional profile first'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.worker_service_coverage WHERE worker_id=v_profile.user_id) THEN
    RAISE EXCEPTION 'Complete your service coverage first';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.booking_payments
    WHERE user_id=v_profile.user_id AND purpose='worker_verification' AND status IN ('paid','completed')
  ) INTO v_paid;
  IF NOT v_paid THEN RAISE EXCEPTION 'Verified Paystack payment is required before submission'; END IF;
  IF NOT public.worker_test_passed(v_profile.user_id) THEN RAISE EXCEPTION 'Pass the Worker readiness test before submission'; END IF;

  SELECT * INTO v_ver
  FROM public.worker_verifications
  WHERE worker_id=v_profile.user_id
  LIMIT 1;
  IF v_ver IS NULL OR NULLIF(BTRIM(COALESCE(v_ver.verification_video_url,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Professional evidence and skill video are required';
  END IF;
  IF COALESCE(v_ver.identity_status,'not_started')<>'verified' THEN
    RAISE EXCEPTION 'External government identity verification must pass before WeHouse review';
  END IF;

  UPDATE public.worker_verifications
  SET status='profile_under_review',submitted_at=now(),updated_at=now()
  WHERE id=v_ver.id;

  UPDATE public.profiles
  SET worker_status='profile_under_review',worker_verified=false,available=false,updated_at=now()
  WHERE user_id=v_profile.user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_my_worker_verification() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_my_worker_verification() TO authenticated;

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
  v_attempts_24h integer;
BEGIN
  SELECT * INTO v_profile FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role='worker' LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Worker profile not found'; END IF;

  SELECT * INTO v_ver FROM public.worker_verifications
  WHERE worker_id=v_profile.user_id LIMIT 1;
  SELECT * INTO v_payment FROM public.booking_payments
  WHERE user_id=v_profile.user_id AND purpose='worker_verification'
  ORDER BY created_at DESC LIMIT 1;
  SELECT * INTO v_test FROM public.worker_test_attempts
  WHERE worker_id=v_profile.user_id
  ORDER BY started_at DESC LIMIT 1;
  SELECT count(*) INTO v_attempts_24h FROM public.worker_test_attempts
  WHERE worker_id=v_profile.user_id AND started_at>=now()-interval '24 hours';

  RETURN jsonb_build_object(
    'worker_status',COALESCE(v_profile.worker_status,'pending'),
    'live',COALESCE(v_profile.worker_status='verified' AND v_profile.worker_verified,false),
    'profile_complete',COALESCE(v_profile.profile_complete,false),
    'payment_status',v_payment.status,
    'gold_badge',COALESCE(v_payment.status IN ('paid','completed'),false),
    'test_passed',public.worker_test_passed(v_profile.user_id),
    'test_percent',v_test.percent,
    'test_attempts_24h',v_attempts_24h,
    'evidence_saved',COALESCE(NULLIF(BTRIM(COALESCE(v_ver.verification_video_url,'')),'') IS NOT NULL,false),
    'submitted',COALESCE(v_ver.submitted_at IS NOT NULL,false),
    'review_status',v_ver.status,
    'identity_status',COALESCE(v_ver.identity_status,'not_started'),
    'identity_provider',v_ver.identity_provider,
    'identity_checked_at',v_ver.identity_checked_at,
    'rejection_reason',(
      SELECT rejection_reason FROM public.worker_verification_reviews
      WHERE worker_id=v_profile.user_id ORDER BY created_at DESC LIMIT 1
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_worker_activation() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_worker_activation() TO authenticated;

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
  IF v_actor IS NULL OR v_actor.role<>'staff' OR COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN
    RAISE EXCEPTION 'Active Staff account required';
  END IF;
  IF NOT public.current_staff_has_permission('verification') THEN RAISE EXCEPTION 'Verification permission required'; END IF;
  IF p_status NOT IN ('profile_under_review','verified','rejected') THEN RAISE EXCEPTION 'Invalid review outcome'; END IF;
  IF p_status='rejected' AND NULLIF(BTRIM(COALESCE(p_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'Rejection reason is required'; END IF;

  SELECT * INTO v_worker FROM public.profiles WHERE user_id=p_worker_id AND role='worker' FOR UPDATE;
  IF v_worker IS NULL THEN RAISE EXCEPTION 'Worker not found'; END IF;
  IF v_actor.assigned_state IS NULL
     OR lower(COALESCE(v_worker.state,''))<>lower(v_actor.assigned_state)
     OR (v_actor.assigned_lga IS NOT NULL AND lower(COALESCE(v_worker.local_government,v_worker.city,''))<>lower(v_actor.assigned_lga)) THEN
    RAISE EXCEPTION 'Worker is outside your assigned branch';
  END IF;
  SELECT * INTO v_ver FROM public.worker_verifications WHERE worker_id=p_worker_id LIMIT 1;

  IF p_status='verified' THEN
    IF v_worker.worker_status<>'profile_under_review' THEN RAISE EXCEPTION 'Worker is not in the review queue'; END IF;
    IF NOT public.worker_test_passed(p_worker_id) THEN RAISE EXCEPTION 'Worker readiness test has not been passed'; END IF;
    IF v_ver IS NULL OR NULLIF(BTRIM(COALESCE(v_ver.verification_video_url,'')),'') IS NULL THEN RAISE EXCEPTION 'Professional evidence is incomplete'; END IF;
    IF COALESCE(v_ver.identity_status,'not_started')<>'verified' THEN RAISE EXCEPTION 'External government identity verification must pass before approval'; END IF;
  END IF;

  UPDATE public.profiles
  SET worker_status=p_status,
      worker_verified=(p_status='verified'),
      available=(p_status='verified'),
      updated_at=now(),updated_by=v_actor.user_id
  WHERE user_id=p_worker_id;

  UPDATE public.worker_verifications
  SET status=p_status,reviewed_by=v_actor.user_id,
      review_notes=COALESCE(NULLIF(BTRIM(p_notes),''),NULLIF(BTRIM(p_reason),'')),
      reviewed_at=now(),updated_at=now()
  WHERE id=v_ver.id;

  INSERT INTO public.worker_verification_reviews(worker_id,reviewer_id,reviewer_role,action,rejection_reason,notes,created_at)
  VALUES(p_worker_id,v_actor.user_id,v_actor.role,p_status,
    CASE WHEN p_status='rejected' THEN BTRIM(p_reason) ELSE NULL END,
    NULLIF(BTRIM(COALESCE(p_notes,'')),''),now());
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
BEGIN
  v_actor:=public._admin_dashboard_actor();
  SELECT * INTO v_worker FROM public.profiles
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
    IF NOT public.worker_test_passed(p_worker_id) THEN RAISE EXCEPTION 'Worker readiness test has not been passed'; END IF;
    IF v_ver IS NULL OR NULLIF(BTRIM(COALESCE(v_ver.verification_video_url,'')),'') IS NULL THEN RAISE EXCEPTION 'Professional evidence is incomplete'; END IF;
    IF COALESCE(v_ver.identity_status,'not_started')<>'verified' THEN RAISE EXCEPTION 'External government identity verification must pass before approval'; END IF;

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
  VALUES(p_worker_id,v_actor.user_id,v_actor.role,
    CASE WHEN p_decision='approve' THEN 'approved' ELSE 'rejected' END,
    CASE WHEN p_decision='reject' THEN BTRIM(p_reason) ELSE NULL END);
END;
$$;

-- Retire browser-callable legacy verification paths. Historical migrations stay
-- in Git history; active clients have one canonical activation contract.
DROP FUNCTION IF EXISTS public.save_my_worker_verification(text,text,text,text,text,text,text[],text,text,text,text,text,integer,uuid,uuid);
DROP FUNCTION IF EXISTS public.save_my_worker_verification(text,text,text,text[],text,text,text,text[],text,numeric,text,text,text);
DROP FUNCTION IF EXISTS public.save_my_worker_verification(text,text,text,text,text,text[],text,text,text,text,text,text,integer,uuid,uuid);
DROP FUNCTION IF EXISTS public.save_my_worker_verification_evidence(text,text,text,text,text,text);
DROP FUNCTION IF EXISTS public.submit_my_worker_verification_v2();
DROP FUNCTION IF EXISTS public.review_my_staff_worker(text,text);

COMMIT;
