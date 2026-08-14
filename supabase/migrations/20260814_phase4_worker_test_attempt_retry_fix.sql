BEGIN;

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

  UPDATE public.worker_test_attempts
  SET submitted_at=now(),score=0,percent=0,passed=false,answers='{}'::jsonb
  WHERE worker_id=v_profile.user_id
    AND submitted_at IS NULL
    AND started_at < now()-interval '45 minutes';

  SELECT count(*) INTO v_recent_failed
  FROM public.worker_test_attempts
  WHERE worker_id=v_profile.user_id
    AND submitted_at IS NOT NULL
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

COMMIT;
