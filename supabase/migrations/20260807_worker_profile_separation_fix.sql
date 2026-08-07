-- Compatibility correction for live worker_verifications schema:
-- worker_id is indexed but not unique, and valid review status is under_review.

BEGIN;

CREATE OR REPLACE FUNCTION public.save_my_worker_verification(
  p_full_name text,
  p_avatar_url text,
  p_occupation text,
  p_skills text[],
  p_experience text,
  p_service_state text,
  p_service_lga text,
  p_service_areas text[],
  p_bio text,
  p_price integer,
  p_gov_id_path text,
  p_certificate_path text,
  p_video_path text
)
RETURNS public.worker_verifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles;
  v_verification public.worker_verifications;
  v_years integer;
BEGIN
  SELECT * INTO v_profile FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role='worker'
    AND deleted=false AND suspended=false AND banned=false;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Active Worker profile required'; END IF;
  IF nullif(trim(p_full_name),'') IS NULL OR nullif(trim(p_occupation),'') IS NULL THEN
    RAISE EXCEPTION 'Full name and occupation are required';
  END IF;
  IF nullif(trim(p_service_state),'') IS NULL OR nullif(trim(p_service_lga),'') IS NULL THEN
    RAISE EXCEPTION 'Service State and LGA are required';
  END IF;
  IF nullif(trim(p_gov_id_path),'') IS NULL OR nullif(trim(p_video_path),'') IS NULL THEN
    RAISE EXCEPTION 'Government ID and skill demonstration video are required';
  END IF;

  v_years := COALESCE((regexp_match(COALESCE(p_experience,'0'),'([0-9]+)'))[1]::integer,0);

  UPDATE public.profiles SET
    full_name=trim(p_full_name), avatar_url=nullif(trim(p_avatar_url),''),
    worker_occupation=trim(p_occupation), worker_skills=to_jsonb(COALESCE(p_skills,'{}'::text[])),
    worker_experience=nullif(trim(p_experience),''), worker_bio=nullif(trim(p_bio),''),
    worker_price=GREATEST(COALESCE(p_price,0),0), updated_at=now()
  WHERE user_id=v_profile.user_id;

  INSERT INTO public.worker_service_coverage(worker_id,state,lga,areas,updated_at)
  VALUES(v_profile.user_id,trim(p_service_state),trim(p_service_lga),COALESCE(p_service_areas,'{}'::text[]),now())
  ON CONFLICT(worker_id) DO UPDATE SET
    state=EXCLUDED.state,lga=EXCLUDED.lga,areas=EXCLUDED.areas,updated_at=now();

  SELECT * INTO v_verification FROM public.worker_verifications
  WHERE worker_id=v_profile.user_id ORDER BY created_at DESC LIMIT 1;

  IF v_verification IS NULL THEN
    INSERT INTO public.worker_verifications(
      worker_id,gov_id_photo_url,certificate_path,verification_video_url,
      years_of_experience,status,updated_at
    ) VALUES(
      v_profile.user_id,p_gov_id_path,nullif(p_certificate_path,''),p_video_path,
      v_years,'pending',now()
    ) RETURNING * INTO v_verification;
  ELSE
    UPDATE public.worker_verifications SET
      gov_id_photo_url=p_gov_id_path,
      certificate_path=nullif(p_certificate_path,''),
      verification_video_url=p_video_path,
      years_of_experience=v_years,
      status=CASE WHEN status IN ('approved','rejected') THEN 'pending' ELSE status END,
      updated_at=now()
    WHERE id=v_verification.id RETURNING * INTO v_verification;
  END IF;

  RETURN v_verification;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_my_worker_verification()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles;
  v_verification public.worker_verifications;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE auth_id=auth.uid()::text AND role='worker';
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Worker profile required'; END IF;
  IF v_profile.worker_status <> 'approved_for_verification' THEN
    RAISE EXCEPTION 'Verification payment must be completed before submission';
  END IF;
  SELECT * INTO v_verification FROM public.worker_verifications
  WHERE worker_id=v_profile.user_id ORDER BY created_at DESC LIMIT 1;
  IF v_verification IS NULL OR v_verification.gov_id_photo_url IS NULL OR v_verification.verification_video_url IS NULL THEN
    RAISE EXCEPTION 'Complete verification evidence before submission';
  END IF;

  UPDATE public.worker_verifications SET status='under_review',submitted_at=now(),updated_at=now()
  WHERE id=v_verification.id;
  UPDATE public.profiles SET worker_status='profile_under_review',updated_at=now()
  WHERE user_id=v_profile.user_id;

  INSERT INTO public.audit_logs(action,target_type,target_id,details,admin_id)
  VALUES('WORKER_VERIFICATION_SUBMIT','worker_verifications',v_profile.user_id,'{}',auth.uid()::text);
END;
$$;

COMMIT;
