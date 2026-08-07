-- WEHOUSE WORKER PROFILE SEPARATION
-- Public professional data, service coverage and private verification evidence
-- are managed separately from the worker's personal location/profile.

BEGIN;

CREATE TABLE IF NOT EXISTS public.worker_service_coverage (
  worker_id text PRIMARY KEY REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  state text NOT NULL,
  lga text NOT NULL,
  areas text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.worker_service_coverage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS worker_coverage_owner_read ON public.worker_service_coverage;
DROP POLICY IF EXISTS worker_coverage_public_read ON public.worker_service_coverage;
CREATE POLICY worker_coverage_owner_read ON public.worker_service_coverage
FOR SELECT TO authenticated
USING (worker_id=(SELECT p.user_id FROM public.profiles p WHERE p.auth_id=auth.uid()::text LIMIT 1));
CREATE POLICY worker_coverage_public_read ON public.worker_service_coverage
FOR SELECT TO anon, authenticated
USING (EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.user_id=worker_service_coverage.worker_id
  AND p.worker_status='verified' AND p.deleted=false AND p.suspended=false AND p.banned=false
));

ALTER TABLE public.worker_verifications
  ADD COLUMN IF NOT EXISTS certificate_path text,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
ALTER TABLE public.worker_verifications ENABLE ROW LEVEL SECURITY;

-- Remove any broad owner mutation policies. Workers submit through audited RPCs.
DROP POLICY IF EXISTS worker_verifications_insert_own ON public.worker_verifications;
DROP POLICY IF EXISTS worker_verifications_update_own ON public.worker_verifications;

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

  INSERT INTO public.worker_verifications(
    worker_id,gov_id_photo_url,certificate_path,verification_video_url,
    years_of_experience,status,updated_at
  ) VALUES(
    v_profile.user_id,p_gov_id_path,nullif(p_certificate_path,''),p_video_path,
    v_years,'pending',now()
  )
  ON CONFLICT(worker_id) DO UPDATE SET
    gov_id_photo_url=EXCLUDED.gov_id_photo_url,
    certificate_path=EXCLUDED.certificate_path,
    verification_video_url=EXCLUDED.verification_video_url,
    years_of_experience=EXCLUDED.years_of_experience,
    status=CASE WHEN worker_verifications.status IN ('approved','verified') THEN 'pending' ELSE worker_verifications.status END,
    updated_at=now()
  RETURNING * INTO v_verification;

  RETURN v_verification;
END;
$$;
REVOKE ALL ON FUNCTION public.save_my_worker_verification(text,text,text,text[],text,text,text,text[],text,integer,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_my_worker_verification(text,text,text,text[],text,text,text,text[],text,integer,text,text,text) TO authenticated;

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
  SELECT * INTO v_verification FROM public.worker_verifications WHERE worker_id=v_profile.user_id;
  IF v_verification IS NULL OR v_verification.gov_id_photo_url IS NULL OR v_verification.verification_video_url IS NULL THEN
    RAISE EXCEPTION 'Complete verification evidence before submission';
  END IF;

  UPDATE public.worker_verifications SET status='submitted',submitted_at=now(),updated_at=now()
  WHERE worker_id=v_profile.user_id;
  UPDATE public.profiles SET worker_status='profile_under_review',updated_at=now()
  WHERE user_id=v_profile.user_id;

  INSERT INTO public.audit_logs(action,target_type,target_id,details,admin_id)
  VALUES('WORKER_VERIFICATION_SUBMIT','worker_verifications',v_profile.user_id,'{}',auth.uid()::text);
END;
$$;
REVOKE ALL ON FUNCTION public.submit_my_worker_verification() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_my_worker_verification() TO authenticated;

COMMIT;
