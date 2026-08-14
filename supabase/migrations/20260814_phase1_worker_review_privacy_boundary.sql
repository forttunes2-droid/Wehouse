BEGIN;

CREATE OR REPLACE FUNCTION public.current_staff_can_review_worker(p_worker_id text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE v_actor public.profiles; v_worker public.profiles;
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role='staff'
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_actor IS NULL OR NOT public.current_staff_has_permission('verification') THEN RETURN false; END IF;
  IF NULLIF(BTRIM(COALESCE(v_actor.assigned_state,'')),'') IS NULL OR NULLIF(BTRIM(COALESCE(v_actor.assigned_lga,'')),'') IS NULL THEN RETURN false; END IF;
  SELECT * INTO v_worker FROM public.profiles WHERE user_id=p_worker_id AND role='worker' LIMIT 1;
  IF v_worker IS NULL THEN RETURN false; END IF;
  RETURN lower(BTRIM(COALESCE(v_worker.state,'')))=lower(BTRIM(v_actor.assigned_state))
     AND lower(BTRIM(COALESCE(v_worker.local_government,v_worker.city,'')))=lower(BTRIM(v_actor.assigned_lga));
END;
$$;
REVOKE ALL ON FUNCTION public.current_staff_can_review_worker(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.current_staff_can_review_worker(text) TO authenticated;

-- Raw verification rows contain government-ID data. They are Worker-self only.
DROP POLICY IF EXISTS worker_verification_staff_read ON public.worker_verifications;
DROP POLICY IF EXISTS worker_verifications_staff ON public.worker_verifications;
DROP POLICY IF EXISTS worker_verifications_own ON public.worker_verifications;
DROP POLICY IF EXISTS worker_verification_owner_read ON public.worker_verifications;
CREATE POLICY worker_verification_owner_read ON public.worker_verifications
FOR SELECT TO authenticated
USING(worker_id=public.current_profile_user_id());

-- Review history is visible to the Worker. Staff receive a safe subset through RPC.
DROP POLICY IF EXISTS worker_reviews_modify_staff ON public.worker_verification_reviews;
DROP POLICY IF EXISTS worker_reviews_select_own ON public.worker_verification_reviews;
CREATE POLICY worker_reviews_worker_read ON public.worker_verification_reviews
FOR SELECT TO authenticated
USING(worker_id=public.current_profile_user_id());

-- Retire legacy broad/bypass RPCs.
REVOKE ALL ON FUNCTION public.get_my_staff_worker_reviews(text) FROM authenticated,anon,PUBLIC;
REVOKE ALL ON FUNCTION public.review_my_staff_worker(text,text) FROM authenticated,anon,PUBLIC;
REVOKE ALL ON FUNCTION public.review_my_staff_worker_v2(text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_my_staff_worker_v2(text,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_staff_worker_review_queue(p_status text DEFAULT 'profile_under_review')
RETURNS TABLE(
  user_id text,
  username text,
  full_name text,
  worker_occupation text,
  worker_experience text,
  worker_cert_url text,
  worker_video_url text,
  state text,
  local_government text,
  city text,
  worker_status text,
  avatar_url text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE v_actor public.profiles;
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role='staff'
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_actor IS NULL OR NOT public.current_staff_has_permission('verification') THEN
    RAISE EXCEPTION 'Verification Staff access required';
  END IF;
  IF v_actor.assigned_state IS NULL OR v_actor.assigned_lga IS NULL THEN RAISE EXCEPTION 'Staff branch assignment required'; END IF;
  RETURN QUERY
  SELECT w.user_id,w.username,w.full_name,w.worker_occupation,w.worker_experience,w.worker_cert_url,w.worker_video_url,
         w.state,w.local_government,w.city,w.worker_status,w.avatar_url
  FROM public.profiles w
  WHERE w.role='worker'
    AND COALESCE(w.deleted,false)=false AND COALESCE(w.suspended,false)=false AND COALESCE(w.banned,false)=false
    AND (p_status IS NULL OR p_status='all' OR w.worker_status=p_status)
    AND lower(COALESCE(w.state,''))=lower(v_actor.assigned_state)
    AND lower(COALESCE(w.local_government,w.city,''))=lower(v_actor.assigned_lga)
  ORDER BY w.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_staff_worker_review_queue(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_staff_worker_review_queue(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_staff_worker_review_detail(p_worker_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE v_ver jsonb; v_history jsonb;
BEGIN
  IF NOT public.current_staff_can_review_worker(p_worker_id) THEN RAISE EXCEPTION 'Worker is outside your verification scope'; END IF;
  SELECT jsonb_build_object(
    'certificate_path',v.certificate_path,
    'verification_video_url',v.verification_video_url,
    'years_of_experience',v.years_of_experience,
    'identity_status',COALESCE(v.identity_status,'not_started'),
    'identity_provider',v.identity_provider,
    'identity_reference',v.identity_reference,
    'identity_checked_at',v.identity_checked_at,
    'identity_failure_reason',v.identity_failure_reason
  ) INTO v_ver
  FROM public.worker_verifications v
  WHERE v.worker_id=p_worker_id
  ORDER BY v.created_at DESC LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',r.id,'action',r.action,'rejection_reason',r.rejection_reason,'notes',r.notes,
    'reviewer_role',r.reviewer_role,'created_at',r.created_at
  ) ORDER BY r.created_at DESC),'[]'::jsonb)
  INTO v_history
  FROM (SELECT * FROM public.worker_verification_reviews WHERE worker_id=p_worker_id ORDER BY created_at DESC LIMIT 12) r;

  RETURN jsonb_build_object('verification',COALESCE(v_ver,'{}'::jsonb),'history',COALESCE(v_history,'[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_staff_worker_review_detail(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_staff_worker_review_detail(text) TO authenticated;

-- Staff may review professional evidence only. Government ID remains Worker/external-provider private.
DROP POLICY IF EXISTS worker_professional_evidence_staff_read ON storage.objects;
CREATE POLICY worker_professional_evidence_staff_read ON storage.objects
FOR SELECT TO authenticated
USING(
  bucket_id IN ('worker-certificates','worker-verification-videos')
  AND public.current_staff_can_review_worker((storage.foldername(name))[1])
);

COMMIT;
