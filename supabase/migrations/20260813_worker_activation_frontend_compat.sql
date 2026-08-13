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
  p_price numeric,
  p_gov_id_path text,
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
  v_id uuid;
BEGIN
  SELECT * INTO v_profile
  FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role='worker' AND deleted=false AND suspended=false AND banned=false
  LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Active worker profile not found'; END IF;
  IF v_profile.worker_status='verified' THEN RAISE EXCEPTION 'Verified Worker changes require a new review process'; END IF;
  IF NULLIF(BTRIM(COALESCE(p_full_name,'')),'') IS NULL OR NULLIF(BTRIM(COALESCE(p_occupation,'')),'') IS NULL THEN RAISE EXCEPTION 'Professional profile is required'; END IF;
  IF NULLIF(BTRIM(COALESCE(p_service_state,'')),'') IS NULL OR NULLIF(BTRIM(COALESCE(p_service_lga,'')),'') IS NULL THEN RAISE EXCEPTION 'Service State and LGA are required'; END IF;
  IF NULLIF(BTRIM(COALESCE(p_gov_id_path,'')),'') IS NULL OR NULLIF(BTRIM(COALESCE(p_video_path,'')),'') IS NULL THEN RAISE EXCEPTION 'Identity document and skill video are required'; END IF;

  UPDATE public.profiles SET
    full_name=BTRIM(p_full_name),
    avatar_url=NULLIF(BTRIM(COALESCE(p_avatar_url,'')),''),
    worker_occupation=BTRIM(p_occupation),
    occupation=BTRIM(p_occupation),
    worker_skills=COALESCE(p_skills,'{}'),
    worker_experience=NULLIF(BTRIM(COALESCE(p_experience,'')),''),
    worker_bio=NULLIF(BTRIM(COALESCE(p_bio,'')),''),
    bio=NULLIF(BTRIM(COALESCE(p_bio,'')),''),
    worker_price=GREATEST(COALESCE(p_price,0),0),
    updated_at=now()
  WHERE user_id=v_profile.user_id;

  INSERT INTO public.worker_service_coverage(worker_id,state,lga,areas,updated_at)
  VALUES(v_profile.user_id,BTRIM(p_service_state),BTRIM(p_service_lga),COALESCE(p_service_areas,'{}'),now())
  ON CONFLICT(worker_id) DO UPDATE SET state=EXCLUDED.state,lga=EXCLUDED.lga,areas=EXCLUDED.areas,updated_at=now();

  SELECT id INTO v_id FROM public.worker_verifications WHERE worker_id=v_profile.user_id ORDER BY created_at DESC LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.worker_verifications(worker_id,gov_id_photo_url,certificate_path,verification_video_url,status,identity_status,submitted_at,created_at,updated_at)
    VALUES(v_profile.user_id,p_gov_id_path,p_certificate_path,p_video_path,'draft','not_started',NULL,now(),now())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.worker_verifications SET
      gov_id_photo_url=p_gov_id_path,
      certificate_path=p_certificate_path,
      verification_video_url=p_video_path,
      status='draft',
      identity_status=CASE WHEN identity_status='verified' THEN 'verified' ELSE 'not_started' END,
      submitted_at=NULL,
      reviewed_by=NULL,
      review_notes=NULL,
      reviewed_at=NULL,
      updated_at=now()
    WHERE id=v_id;
  END IF;
  RETURN v_id;
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
BEGIN
  SELECT * INTO v_profile FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role='worker' AND deleted=false AND suspended=false AND banned=false
  LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Active worker profile not found'; END IF;
  IF v_profile.worker_status NOT IN ('verification_paid','approved_for_verification') THEN RAISE EXCEPTION 'Verified Paystack payment is required before submission'; END IF;
  SELECT * INTO v_ver FROM public.worker_verifications WHERE worker_id=v_profile.user_id ORDER BY created_at DESC LIMIT 1;
  IF v_ver IS NULL OR v_ver.gov_id_photo_url IS NULL OR v_ver.verification_video_url IS NULL THEN RAISE EXCEPTION 'Complete all required verification information before submitting'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.worker_service_coverage WHERE worker_id=v_profile.user_id) THEN RAISE EXCEPTION 'Service coverage is required'; END IF;

  UPDATE public.worker_verifications SET status='profile_under_review',identity_status=CASE WHEN identity_status='verified' THEN 'verified' ELSE 'pending_external' END,submitted_at=now(),updated_at=now() WHERE id=v_ver.id;
  UPDATE public.profiles SET worker_status='profile_under_review',available=false,updated_at=now() WHERE user_id=v_profile.user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_my_worker_verification(text,text,text,text[],text,text,text,text[],text,numeric,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_my_worker_verification(text,text,text,text[],text,text,text,text[],text,numeric,text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.submit_my_worker_verification() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_my_worker_verification() TO authenticated;

COMMIT;
