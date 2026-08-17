-- Remove unapproved Staff probation and Worker quiz gates while preserving
-- explicit branch/module permissions, Worker identity/payment/evidence review,
-- and private conversation authorization.

-- Authenticated-safe wrapper for RLS. Keep the low-level helper private.
CREATE OR REPLACE FUNCTION public.can_access_my_conversation(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
  SELECT public._can_access_conversation(p_conversation_id);
$function$;
REVOKE ALL ON FUNCTION public.can_access_my_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_my_conversation(uuid) TO authenticated;

DROP POLICY IF EXISTS conversations_select ON public.conversations;
CREATE POLICY conversations_select ON public.conversations
FOR SELECT TO authenticated
USING (public.can_access_my_conversation(id));

DROP POLICY IF EXISTS conversations_update ON public.conversations;
CREATE POLICY conversations_update ON public.conversations
FOR UPDATE TO authenticated
USING (public.can_access_my_conversation(id))
WITH CHECK (public.can_access_my_conversation(id));

DROP POLICY IF EXISTS messages_select ON public.messages;
CREATE POLICY messages_select ON public.messages
FOR SELECT TO authenticated
USING (public.can_access_my_conversation(conversation_id));

DROP POLICY IF EXISTS messages_insert ON public.messages;
CREATE POLICY messages_insert ON public.messages
FOR INSERT TO authenticated
WITH CHECK (
  sender_id = (
    SELECT p.user_id FROM public.profiles p
    WHERE p.auth_id = auth.uid()::text
    LIMIT 1
  )
  AND public.can_access_my_conversation(conversation_id)
);

DROP POLICY IF EXISTS messages_update ON public.messages;
CREATE POLICY messages_update ON public.messages
FOR UPDATE TO authenticated
USING (public.can_access_my_conversation(conversation_id));

-- Staff access is role + branch + explicit active module permission.
-- The implementation-added probation/trust checklist is no longer an access gate.
CREATE OR REPLACE FUNCTION public.current_staff_has_permission(p_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
  SELECT EXISTS(
    SELECT 1
    FROM public.profiles p
    JOIN public.staff_permissions sp
      ON sp.staff_id=p.user_id
     AND sp.permission=p_permission
     AND sp.is_active=true
    WHERE p.auth_id=auth.uid()::text
      AND p.role='staff'
      AND NULLIF(BTRIM(COALESCE(p.assigned_state,'')),'') IS NOT NULL
      AND NULLIF(BTRIM(COALESCE(p.assigned_lga,'')),'') IS NOT NULL
      AND NOT COALESCE(p.deleted,false)
      AND NOT COALESCE(p.suspended,false)
      AND NOT COALESCE(p.banned,false)
  ) OR EXISTS(
    SELECT 1
    FROM public.profiles p
    WHERE p.auth_id=auth.uid()::text
      AND p.role IN ('admin','creator')
      AND NOT COALESCE(p.deleted,false)
      AND NOT COALESCE(p.suspended,false)
      AND NOT COALESCE(p.banned,false)
  );
$function$;

CREATE OR REPLACE FUNCTION public.admin_appoint_staff(p_target_user_id text, p_module text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_actor public.profiles;
  v_target public.profiles;
  v_limit integer:=0;
  v_used integer:=0;
  v_state text;
  v_lga text;
BEGIN
  IF p_module NOT IN ('operations','finance','support','verification','field_officer') THEN
    RAISE EXCEPTION 'A valid Staff module is required';
  END IF;

  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND role IN ('admin','creator')
    AND NOT COALESCE(deleted,false)
    AND NOT COALESCE(suspended,false)
    AND NOT COALESCE(banned,false)
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Admin or Creator access required'; END IF;

  SELECT * INTO v_target
  FROM public.profiles
  WHERE user_id=p_target_user_id AND NOT COALESCE(deleted,false)
  FOR UPDATE;
  IF v_target IS NULL THEN RAISE EXCEPTION 'Target account not found'; END IF;
  IF v_target.role NOT IN ('user','staff') THEN RAISE EXCEPTION 'Only a User or existing Staff account can be appointed'; END IF;

  IF v_actor.role='admin' THEN
    IF v_actor.assigned_state IS NULL OR v_actor.assigned_lga IS NULL THEN
      RAISE EXCEPTION 'Admin branch assignment is required';
    END IF;
    IF lower(COALESCE(v_target.state,''))<>lower(v_actor.assigned_state)
       OR lower(COALESCE(NULLIF(v_target.local_government,''),NULLIF(v_target.city,''),''))<>lower(v_actor.assigned_lga) THEN
      RAISE EXCEPTION 'Admin can appoint only Users in the assigned branch';
    END IF;
    v_state:=v_actor.assigned_state;
    v_lga:=v_actor.assigned_lga;

    IF v_target.role<>'staff' THEN
      v_limit:=COALESCE(public.get_admin_staff_limit_v2(),0);
      IF v_limit>0 THEN
        SELECT count(*)::integer INTO v_used
        FROM public.profiles p
        WHERE p.role='staff'
          AND NOT COALESCE(p.deleted,false)
          AND lower(COALESCE(p.assigned_state,''))=lower(v_actor.assigned_state)
          AND lower(COALESCE(p.assigned_lga,''))=lower(v_actor.assigned_lga);
        IF v_used>=v_limit THEN
          RAISE EXCEPTION 'Staff appointment limit reached (% of %). Creator must increase the Admin Staff limit or appoint the Staff directly.',v_used,v_limit;
        END IF;
      END IF;
    END IF;
  ELSE
    v_state:=COALESCE(NULLIF(v_target.assigned_state,''),NULLIF(v_target.state,''));
    v_lga:=COALESCE(NULLIF(v_target.assigned_lga,''),NULLIF(v_target.local_government,''),NULLIF(v_target.city,''));
    IF v_state IS NULL OR v_lga IS NULL THEN
      RAISE EXCEPTION 'Assign the Staff member to a State and LGA before appointment';
    END IF;
  END IF;

  IF v_target.role='user' THEN
    PERFORM public.admin_update_role(p_target_user_id,'staff');
  END IF;

  UPDATE public.profiles
  SET assigned_state=v_state,
      assigned_lga=v_lga,
      updated_at=now(),
      updated_by=v_actor.user_id
  WHERE user_id=p_target_user_id;

  PERFORM public.manage_staff_permission(p_target_user_id,p_module,true);

  INSERT INTO public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
  VALUES(
    'STAFF_APPOINTMENT','profiles',p_target_user_id,
    jsonb_build_object(
      'module',p_module,
      'appointed_by_role',v_actor.role,
      'admin_staff_limit',CASE WHEN v_actor.role='admin' THEN COALESCE(public.get_admin_staff_limit_v2(),0) ELSE NULL END,
      'state',v_state,
      'lga',v_lga,
      'access_model','branch_and_module_permission'
    )::text,
    v_actor.user_id,v_actor.email
  );
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_admin_staff_capacity()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_actor public.profiles;
  v_limit integer:=0;
  v_used integer:=0;
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND role IN ('admin','creator')
    AND NOT COALESCE(deleted,false)
    AND NOT COALESCE(suspended,false)
    AND NOT COALESCE(banned,false)
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Admin or Creator access required'; END IF;

  v_limit:=COALESCE(public.get_admin_staff_limit_v2(),0);
  IF v_actor.role='admin' THEN
    SELECT count(*)::integer INTO v_used
    FROM public.profiles p
    WHERE p.role='staff'
      AND NOT COALESCE(p.deleted,false)
      AND lower(COALESCE(p.assigned_state,''))=lower(COALESCE(v_actor.assigned_state,''))
      AND lower(COALESCE(p.assigned_lga,''))=lower(COALESCE(v_actor.assigned_lga,''));
  END IF;

  RETURN jsonb_build_object(
    'limit',v_limit,
    'used',v_used,
    'remaining',CASE WHEN v_limit=0 THEN NULL ELSE GREATEST(0,v_limit-v_used) END,
    'unlimited',(v_limit=0)
  );
END;
$function$;

-- Worker activation no longer contains an implementation-added quiz gate.
-- Keep deprecated test fields as true/100 temporarily so an older cached client
-- safely advances to skill evidence during rollout.
CREATE OR REPLACE FUNCTION public.get_my_worker_activation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_profile public.profiles;
  v_ver public.worker_verifications;
  v_payment public.booking_payments;
  v_identity public.worker_identity_checks;
  v_profile_ready boolean:=false;
  v_paid boolean:=false;
  v_days integer:=public.worker_identity_recheck_days();
  v_identity_current boolean:=false;
  v_due_at timestamptz;
  v_days_remaining integer;
BEGIN
  SELECT * INTO v_profile
  FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role='worker'
  LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Worker profile not found'; END IF;

  v_profile_ready:=public.worker_professional_profile_ready(v_profile.user_id);
  SELECT * INTO v_ver FROM public.worker_verifications WHERE worker_id=v_profile.user_id LIMIT 1;
  SELECT * INTO v_payment FROM public.booking_payments
    WHERE user_id=v_profile.user_id AND purpose='worker_verification'
    ORDER BY created_at DESC LIMIT 1;
  SELECT * INTO v_identity FROM public.worker_identity_checks WHERE worker_id=v_profile.user_id;
  v_paid:=COALESCE(v_payment.status IN ('paid','completed'),false);

  IF v_identity.status='passed' AND v_identity.captured_at IS NOT NULL THEN
    v_due_at:=v_identity.captured_at+make_interval(days=>v_days);
    v_identity_current:=v_due_at>now();
    v_days_remaining:=GREATEST(0,CEIL(EXTRACT(epoch FROM (v_due_at-now()))/86400.0)::integer);
  END IF;

  RETURN jsonb_build_object(
    'worker_status',COALESCE(v_profile.worker_status,'pending'),
    'live',COALESCE(v_profile.worker_status='verified' AND v_profile.worker_verified AND v_identity_current,false),
    'profile_complete',v_profile_ready,
    'payment_status',v_payment.status,
    'payment_confirmed',v_paid,
    'gold_badge',v_paid,
    'identity_required',true,
    'identity_status',CASE WHEN v_identity.status='passed' AND NOT v_identity_current THEN 'expired' ELSE COALESCE(v_identity.status,'not_started') END,
    'identity_captured',COALESCE(v_identity.status='passed',false),
    'identity_passed',v_identity_current,
    'identity_current',v_identity_current,
    'identity_captured_at',v_identity.captured_at,
    'identity_due_at',v_due_at,
    'identity_recheck_days',v_days,
    'identity_days_remaining',v_days_remaining,
    'test_passed',true,
    'test_percent',100,
    'test_attempts_24h',0,
    'evidence_saved',COALESCE(NULLIF(BTRIM(COALESCE(v_ver.verification_video_url,'')),'') IS NOT NULL,false),
    'submitted',COALESCE(v_ver.submitted_at IS NOT NULL,false),
    'review_status',v_ver.status,
    'rejection_reason',(SELECT rejection_reason FROM public.worker_verification_reviews WHERE worker_id=v_profile.user_id ORDER BY created_at DESC LIMIT 1)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_my_worker_professional_evidence(p_certificate_path text, p_video_path text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_profile public.profiles;
  v_paid boolean;
  v_id uuid;
BEGIN
  SELECT * INTO v_profile
  FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role='worker'
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Active Worker account required'; END IF;
  IF v_profile.worker_status='verified' THEN RAISE EXCEPTION 'Live Worker evidence changes require a new review process'; END IF;
  IF NOT public.worker_professional_profile_ready(v_profile.user_id) THEN RAISE EXCEPTION 'Complete your professional profile and service coverage first'; END IF;
  IF NOT public.worker_identity_is_current(v_profile.user_id) THEN RAISE EXCEPTION 'Complete the current private WeHouse face check first'; END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.booking_payments
    WHERE user_id=v_profile.user_id AND purpose='worker_verification' AND status IN ('paid','completed')
  ) INTO v_paid;
  IF NOT v_paid THEN RAISE EXCEPTION 'Verified Paystack payment is required first'; END IF;
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
    'evidence_ready','wehouse_private_face','verified',NULL,now(),now(),NULL,NULL,NULL,NULL
  )
  ON CONFLICT(worker_id) DO UPDATE SET
    certificate_path=EXCLUDED.certificate_path,
    verification_video_url=EXCLUDED.verification_video_url,
    status='evidence_ready',
    identity_provider='wehouse_private_face',
    identity_status='verified',
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
$function$;

CREATE OR REPLACE FUNCTION public.submit_my_worker_verification()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_profile public.profiles;
  v_ver public.worker_verifications;
  v_paid boolean:=false;
BEGIN
  SELECT * INTO v_profile
  FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role='worker'
    AND NOT COALESCE(deleted,false)
    AND NOT COALESCE(suspended,false)
    AND NOT COALESCE(banned,false)
  LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Active Worker account required'; END IF;
  IF NOT public.worker_professional_profile_ready(v_profile.user_id) THEN
    RAISE EXCEPTION 'Complete your professional profile and service coverage first';
  END IF;
  IF NOT public.worker_identity_is_current(v_profile.user_id) THEN
    RAISE EXCEPTION 'Complete the current private WeHouse face check before submission';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.booking_payments
    WHERE user_id=v_profile.user_id AND purpose='worker_verification' AND status IN ('paid','completed')
  ) INTO v_paid;
  IF NOT v_paid THEN RAISE EXCEPTION 'Confirmed Paystack payment is required before submission'; END IF;

  SELECT * INTO v_ver FROM public.worker_verifications WHERE worker_id=v_profile.user_id LIMIT 1;
  IF v_ver IS NULL OR NULLIF(BTRIM(COALESCE(v_ver.verification_video_url,'')),'') IS NULL THEN
    RAISE EXCEPTION 'A work demonstration video is required before review';
  END IF;

  UPDATE public.worker_verifications
  SET status='profile_under_review',submitted_at=now(),updated_at=now()
  WHERE id=v_ver.id;
  UPDATE public.profiles
  SET worker_status='profile_under_review',worker_verified=false,available=false,updated_at=now()
  WHERE user_id=v_profile.user_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.review_my_staff_worker_v2(p_worker_id text, p_status text, p_reason text DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_actor public.profiles;
  v_worker public.profiles;
  v_ver public.worker_verifications;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor IS NULL OR v_actor.role<>'staff' OR COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN
    RAISE EXCEPTION 'Active Staff account required';
  END IF;
  IF NOT public.current_staff_has_permission('verification') THEN RAISE EXCEPTION 'Verification Staff permission required'; END IF;
  IF p_status NOT IN ('verified','rejected') THEN RAISE EXCEPTION 'Invalid review outcome'; END IF;
  IF p_status='rejected' AND NULLIF(BTRIM(COALESCE(p_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'Rejection reason is required'; END IF;

  SELECT * INTO v_worker FROM public.profiles WHERE user_id=p_worker_id AND role='worker' FOR UPDATE;
  IF v_worker IS NULL THEN RAISE EXCEPTION 'Worker not found'; END IF;
  IF v_actor.assigned_state IS NULL
     OR lower(COALESCE(v_worker.state,''))<>lower(v_actor.assigned_state)
     OR v_actor.assigned_lga IS NULL
     OR lower(COALESCE(v_worker.local_government,v_worker.city,''))<>lower(v_actor.assigned_lga) THEN
    RAISE EXCEPTION 'Worker is outside your assigned branch';
  END IF;

  SELECT * INTO v_ver FROM public.worker_verifications WHERE worker_id=p_worker_id LIMIT 1;
  IF p_status='verified' THEN
    IF v_worker.worker_status<>'profile_under_review' THEN RAISE EXCEPTION 'Worker is not in the review queue'; END IF;
    IF NOT public.worker_identity_is_current(p_worker_id) THEN RAISE EXCEPTION 'The current private face check has not passed'; END IF;
    IF v_ver IS NULL OR NULLIF(BTRIM(COALESCE(v_ver.verification_video_url,'')),'') IS NULL THEN
      RAISE EXCEPTION 'Professional work evidence is incomplete';
    END IF;
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
  VALUES(p_worker_id,v_actor.user_id,v_actor.role,p_status,
    CASE WHEN p_status='rejected' THEN BTRIM(p_reason) ELSE NULL END,
    NULLIF(BTRIM(COALESCE(p_notes,'')),''),now());
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_review_my_branch_worker(p_worker_id text, p_decision text, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
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
  IF v_actor.role='admin'
     AND (v_worker.state IS DISTINCT FROM v_actor.assigned_state
       OR COALESCE(NULLIF(v_worker.local_government,''),NULLIF(v_worker.city,'')) IS DISTINCT FROM v_actor.assigned_lga) THEN
    RAISE EXCEPTION 'Worker is outside your assigned branch';
  END IF;
  IF v_worker.worker_status<>'profile_under_review' THEN RAISE EXCEPTION 'Worker is not in the review queue'; END IF;
  SELECT * INTO v_ver FROM public.worker_verifications WHERE worker_id=p_worker_id LIMIT 1;

  IF p_decision='approve' THEN
    IF NOT public.worker_identity_is_current(p_worker_id) THEN RAISE EXCEPTION 'The current private face check has not passed'; END IF;
    IF v_ver IS NULL OR NULLIF(BTRIM(COALESCE(v_ver.verification_video_url,'')),'') IS NULL THEN
      RAISE EXCEPTION 'Professional work evidence is incomplete';
    END IF;
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
  VALUES(p_worker_id,v_actor.user_id,v_actor.role,
    CASE WHEN p_decision='approve' THEN 'approved' ELSE 'rejected' END,
    CASE WHEN p_decision='reject' THEN BTRIM(p_reason) ELSE NULL END);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_worker_review_trust_status(p_worker_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_actor public.profiles;
  v_worker public.profiles;
  v_ver public.worker_verifications;
  v_identity public.worker_identity_checks;
  v_payment boolean:=false;
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role IN ('staff','admin','creator')
    AND NOT COALESCE(deleted,false) AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false)
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Worker oversight access required'; END IF;
  IF v_actor.role='staff' AND NOT public.current_staff_has_permission('verification') THEN
    RAISE EXCEPTION 'Verification Staff permission required';
  END IF;
  SELECT * INTO v_worker FROM public.profiles WHERE user_id=p_worker_id AND role='worker' LIMIT 1;
  IF v_worker IS NULL THEN RAISE EXCEPTION 'Worker not found'; END IF;
  IF v_actor.role IN ('staff','admin')
     AND (v_actor.assigned_state IS DISTINCT FROM v_worker.state
       OR v_actor.assigned_lga IS DISTINCT FROM COALESCE(v_worker.local_government,v_worker.city)) THEN
    RAISE EXCEPTION 'Worker is outside your assigned branch';
  END IF;
  SELECT * INTO v_ver FROM public.worker_verifications WHERE worker_id=p_worker_id LIMIT 1;
  SELECT * INTO v_identity FROM public.worker_identity_checks WHERE worker_id=p_worker_id;
  SELECT EXISTS(
    SELECT 1 FROM public.booking_payments
    WHERE user_id=p_worker_id AND purpose='worker_verification' AND status IN ('paid','completed')
  ) INTO v_payment;

  RETURN jsonb_build_object(
    'payment_confirmed',v_payment,
    'identity_status',CASE WHEN public.worker_identity_is_current(p_worker_id) THEN 'passed' ELSE COALESCE(v_identity.status,'not_started') END,
    'identity_captured',COALESCE(v_identity.status='passed',false),
    'identity_passed',public.worker_identity_is_current(p_worker_id),
    'face_match_score',v_identity.face_match_score,
    'liveness_score',v_identity.liveness_score,
    'anti_spoof_score',v_identity.anti_spoof_score,
    'readiness_passed',true,
    'readiness_percent',100,
    'evidence_saved',COALESCE(NULLIF(BTRIM(COALESCE(v_ver.verification_video_url,'')),'') IS NOT NULL,false),
    'submitted',COALESCE(v_ver.submitted_at IS NOT NULL,false),
    'review_status',v_ver.status
  );
END;
$function$;

-- Existing historical trust/test records are intentionally retained for audit
-- until the legacy-source consolidation pass proves no production dependency.
