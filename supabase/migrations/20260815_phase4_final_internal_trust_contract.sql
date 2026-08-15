-- Phase 4 final production contract.
-- WeHouse uses internal professional/operational trust only. No government ID
-- or external identity provider is part of Worker or Staff verification.

CREATE TABLE IF NOT EXISTS public.staff_trust_profiles (
  staff_id text PRIMARY KEY REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'probation' CHECK (status IN ('probation','trusted','restricted','revoked')),
  appointed_by text,
  appointed_at timestamptz NOT NULL DEFAULT now(),
  trusted_by text,
  trusted_at timestamptz,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  supervisor_confirmed boolean NOT NULL DEFAULT false,
  orientation_completed boolean NOT NULL DEFAULT false,
  role_training_completed boolean NOT NULL DEFAULT false,
  code_of_conduct_confirmed boolean NOT NULL DEFAULT false,
  probation_observation_completed boolean NOT NULL DEFAULT false
);

ALTER TABLE public.staff_trust_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_trust_profiles FROM PUBLIC, anon;
GRANT SELECT ON public.staff_trust_profiles TO authenticated;

DROP POLICY IF EXISTS staff_trust_select ON public.staff_trust_profiles;
CREATE POLICY staff_trust_select ON public.staff_trust_profiles
FOR SELECT TO authenticated
USING (
  staff_id=(SELECT p.user_id FROM public.profiles p WHERE p.auth_id=auth.uid()::text LIMIT 1)
  OR EXISTS(
    SELECT 1 FROM public.profiles actor
    WHERE actor.auth_id=auth.uid()::text
      AND actor.role='creator'
      AND COALESCE(actor.deleted,false)=false
      AND COALESCE(actor.suspended,false)=false
      AND COALESCE(actor.banned,false)=false
  )
  OR EXISTS(
    SELECT 1
    FROM public.profiles actor
    JOIN public.profiles target ON target.user_id=staff_trust_profiles.staff_id
    WHERE actor.auth_id=auth.uid()::text
      AND actor.role='admin'
      AND COALESCE(actor.deleted,false)=false
      AND COALESCE(actor.suspended,false)=false
      AND COALESCE(actor.banned,false)=false
      AND actor.assigned_state IS NOT DISTINCT FROM target.assigned_state
      AND actor.assigned_lga IS NOT DISTINCT FROM target.assigned_lga
  )
);

INSERT INTO public.staff_trust_profiles(
  staff_id,status,appointed_by,appointed_at,trusted_at,notes,
  supervisor_confirmed,orientation_completed,role_training_completed,
  code_of_conduct_confirmed,probation_observation_completed
)
SELECT
  p.user_id,
  CASE WHEN p.assigned_state IS NOT NULL AND p.assigned_lga IS NOT NULL AND EXISTS(
    SELECT 1 FROM public.staff_permissions sp WHERE sp.staff_id=p.user_id AND sp.is_active=true
  ) THEN 'trusted' ELSE 'probation' END,
  (SELECT sp.granted_by FROM public.staff_permissions sp WHERE sp.staff_id=p.user_id ORDER BY sp.granted_at DESC NULLS LAST LIMIT 1),
  now(),
  CASE WHEN p.assigned_state IS NOT NULL AND p.assigned_lga IS NOT NULL AND EXISTS(
    SELECT 1 FROM public.staff_permissions sp WHERE sp.staff_id=p.user_id AND sp.is_active=true
  ) THEN now() ELSE NULL END,
  'Existing Staff migrated into WeHouse internal trust',
  CASE WHEN p.assigned_state IS NOT NULL AND p.assigned_lga IS NOT NULL AND EXISTS(SELECT 1 FROM public.staff_permissions sp WHERE sp.staff_id=p.user_id AND sp.is_active=true) THEN true ELSE false END,
  CASE WHEN p.assigned_state IS NOT NULL AND p.assigned_lga IS NOT NULL AND EXISTS(SELECT 1 FROM public.staff_permissions sp WHERE sp.staff_id=p.user_id AND sp.is_active=true) THEN true ELSE false END,
  CASE WHEN p.assigned_state IS NOT NULL AND p.assigned_lga IS NOT NULL AND EXISTS(SELECT 1 FROM public.staff_permissions sp WHERE sp.staff_id=p.user_id AND sp.is_active=true) THEN true ELSE false END,
  CASE WHEN p.assigned_state IS NOT NULL AND p.assigned_lga IS NOT NULL AND EXISTS(SELECT 1 FROM public.staff_permissions sp WHERE sp.staff_id=p.user_id AND sp.is_active=true) THEN true ELSE false END,
  CASE WHEN p.assigned_state IS NOT NULL AND p.assigned_lga IS NOT NULL AND EXISTS(SELECT 1 FROM public.staff_permissions sp WHERE sp.staff_id=p.user_id AND sp.is_active=true) THEN true ELSE false END
FROM public.profiles p
WHERE p.role='staff' AND COALESCE(p.deleted,false)=false
ON CONFLICT(staff_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_my_staff_trust_status()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public'
AS $function$
DECLARE v_staff public.profiles; v_trust public.staff_trust_profiles;
BEGIN
  SELECT * INTO v_staff FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role='staff'
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_staff IS NULL THEN RAISE EXCEPTION 'Active Staff account required'; END IF;
  SELECT * INTO v_trust FROM public.staff_trust_profiles WHERE staff_id=v_staff.user_id;
  IF v_trust IS NULL THEN
    INSERT INTO public.staff_trust_profiles(staff_id,status,appointed_at,notes)
    VALUES(v_staff.user_id,'probation',now(),'Staff trust record created automatically') RETURNING * INTO v_trust;
  END IF;
  RETURN jsonb_build_object('status',v_trust.status,'notes',v_trust.notes,'appointed_at',v_trust.appointed_at,'trusted_at',v_trust.trusted_at);
END;
$function$;

CREATE OR REPLACE FUNCTION public.current_staff_has_permission(p_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public'
AS $function$
  SELECT EXISTS(
    SELECT 1 FROM public.profiles p
    JOIN public.staff_permissions sp ON sp.staff_id=p.user_id AND sp.permission=p_permission AND sp.is_active=true
    JOIN public.staff_trust_profiles st ON st.staff_id=p.user_id AND st.status='trusted'
    WHERE p.auth_id=auth.uid()::text AND p.role='staff'
      AND NOT COALESCE(p.deleted,false) AND NOT COALESCE(p.suspended,false) AND NOT COALESCE(p.banned,false)
  ) OR EXISTS(
    SELECT 1 FROM public.profiles p
    WHERE p.auth_id=auth.uid()::text AND p.role IN('admin','creator')
      AND NOT COALESCE(p.deleted,false) AND NOT COALESCE(p.suspended,false) AND NOT COALESCE(p.banned,false)
  );
$function$;

CREATE OR REPLACE FUNCTION public.sync_staff_trust_on_role_change()
RETURNS trigger LANGUAGE plpgsql SET search_path='public'
AS $function$
DECLARE v_actor text; v_needs_review boolean:=false;
BEGIN
  IF TG_OP='INSERT' THEN
    v_actor:=NEW.updated_by;
    v_needs_review:=(NEW.role='staff');
  ELSE
    v_actor:=COALESCE(NEW.updated_by,OLD.updated_by);
    v_needs_review:=(NEW.role='staff' AND (OLD.role IS DISTINCT FROM 'staff' OR OLD.assigned_state IS DISTINCT FROM NEW.assigned_state OR OLD.assigned_lga IS DISTINCT FROM NEW.assigned_lga));
  END IF;
  IF v_needs_review THEN
    INSERT INTO public.staff_trust_profiles(
      staff_id,status,appointed_by,appointed_at,trusted_by,trusted_at,
      supervisor_confirmed,orientation_completed,role_training_completed,code_of_conduct_confirmed,probation_observation_completed,
      notes,updated_at
    ) VALUES(NEW.user_id,'probation',v_actor,now(),NULL,NULL,false,false,false,false,false,'Staff role or branch assignment changed; WeHouse trust review required',now())
    ON CONFLICT(staff_id) DO UPDATE SET
      status='probation',appointed_by=COALESCE(v_actor,staff_trust_profiles.appointed_by),appointed_at=now(),trusted_by=NULL,trusted_at=NULL,
      supervisor_confirmed=false,orientation_completed=false,role_training_completed=false,code_of_conduct_confirmed=false,probation_observation_completed=false,
      notes='Staff role or branch assignment changed; WeHouse trust review required',updated_at=now();
  ELSIF TG_OP='UPDATE' AND OLD.role='staff' AND NEW.role<>'staff' THEN
    UPDATE public.staff_trust_profiles SET status='revoked',notes='Staff role removed',updated_at=now() WHERE staff_id=NEW.user_id;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_staff_trust_on_role_change ON public.profiles;
CREATE TRIGGER trg_sync_staff_trust_on_role_change
AFTER INSERT OR UPDATE OF role,assigned_state,assigned_lga ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.sync_staff_trust_on_role_change();

CREATE OR REPLACE FUNCTION public.update_staff_trust_checklist(
  p_staff_id text,
  p_supervisor_confirmed boolean,
  p_orientation_completed boolean,
  p_role_training_completed boolean,
  p_code_of_conduct_confirmed boolean,
  p_probation_observation_completed boolean,
  p_notes text DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='public'
AS $function$
DECLARE v_actor public.profiles; v_target public.profiles;
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role IN('admin','creator')
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Admin or Creator access required'; END IF;
  SELECT * INTO v_target FROM public.profiles WHERE user_id=p_staff_id AND role='staff' AND COALESCE(deleted,false)=false LIMIT 1;
  IF v_target IS NULL THEN RAISE EXCEPTION 'Staff profile not found'; END IF;
  IF v_actor.role='admin' AND (v_actor.assigned_state IS DISTINCT FROM v_target.assigned_state OR v_actor.assigned_lga IS DISTINCT FROM v_target.assigned_lga) THEN
    RAISE EXCEPTION 'Admin can review only Staff in the same assigned branch';
  END IF;
  INSERT INTO public.staff_trust_profiles(
    staff_id,status,appointed_by,appointed_at,supervisor_confirmed,orientation_completed,role_training_completed,code_of_conduct_confirmed,probation_observation_completed,notes,updated_at
  ) VALUES(
    p_staff_id,'probation',v_actor.user_id,now(),p_supervisor_confirmed,p_orientation_completed,p_role_training_completed,p_code_of_conduct_confirmed,p_probation_observation_completed,NULLIF(BTRIM(COALESCE(p_notes,'')),''),now()
  ) ON CONFLICT(staff_id) DO UPDATE SET
    supervisor_confirmed=EXCLUDED.supervisor_confirmed,orientation_completed=EXCLUDED.orientation_completed,role_training_completed=EXCLUDED.role_training_completed,
    code_of_conduct_confirmed=EXCLUDED.code_of_conduct_confirmed,probation_observation_completed=EXCLUDED.probation_observation_completed,notes=EXCLUDED.notes,updated_at=now();
  INSERT INTO public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
  VALUES('STAFF_TRUST_CHECKLIST','profiles',p_staff_id,jsonb_build_object(
    'supervisor_confirmed',p_supervisor_confirmed,'orientation_completed',p_orientation_completed,'role_training_completed',p_role_training_completed,
    'code_of_conduct_confirmed',p_code_of_conduct_confirmed,'probation_observation_completed',p_probation_observation_completed,
    'state',v_target.assigned_state,'lga',v_target.assigned_lga
  )::text,v_actor.user_id,v_actor.email);
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_staff_trust_status(p_staff_id text,p_status text,p_notes text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='public'
AS $function$
DECLARE v_actor public.profiles; v_target public.profiles; v_trust public.staff_trust_profiles; v_previous text;
BEGIN
  IF p_status NOT IN('probation','trusted','restricted','revoked') THEN RAISE EXCEPTION 'Invalid Staff trust status'; END IF;
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role IN('admin','creator')
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Admin or Creator access required'; END IF;
  SELECT * INTO v_target FROM public.profiles WHERE user_id=p_staff_id AND role='staff' AND COALESCE(deleted,false)=false LIMIT 1;
  IF v_target IS NULL THEN RAISE EXCEPTION 'Staff profile not found'; END IF;
  IF v_actor.role='admin' AND (v_actor.assigned_state IS DISTINCT FROM v_target.assigned_state OR v_actor.assigned_lga IS DISTINCT FROM v_target.assigned_lga) THEN
    RAISE EXCEPTION 'Admin can review only Staff in the same assigned branch';
  END IF;
  SELECT * INTO v_trust FROM public.staff_trust_profiles WHERE staff_id=p_staff_id; v_previous:=v_trust.status;
  IF p_status='trusted' THEN
    IF v_trust IS NULL THEN RAISE EXCEPTION 'Complete the Staff trust checklist first'; END IF;
    IF NOT(v_trust.supervisor_confirmed AND v_trust.orientation_completed AND v_trust.role_training_completed AND v_trust.code_of_conduct_confirmed AND v_trust.probation_observation_completed) THEN
      RAISE EXCEPTION 'Complete every WeHouse Staff trust check before marking this Staff member trusted';
    END IF;
  END IF;
  UPDATE public.staff_trust_profiles SET
    status=p_status,
    trusted_by=CASE WHEN p_status='trusted' THEN v_actor.user_id ELSE trusted_by END,
    trusted_at=CASE WHEN p_status='trusted' THEN now() ELSE trusted_at END,
    notes=COALESCE(NULLIF(BTRIM(COALESCE(p_notes,'')),''),notes),updated_at=now()
  WHERE staff_id=p_staff_id;
  IF NOT FOUND THEN
    INSERT INTO public.staff_trust_profiles(staff_id,status,appointed_by,appointed_at,notes,updated_at)
    VALUES(p_staff_id,p_status,v_actor.user_id,now(),NULLIF(BTRIM(COALESCE(p_notes,'')),''),now());
  END IF;
  INSERT INTO public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
  VALUES('STAFF_TRUST_CHANGE','profiles',p_staff_id,jsonb_build_object('previous_status',COALESCE(v_previous,'none'),'new_status',p_status,'notes',NULLIF(BTRIM(COALESCE(p_notes,'')),''),'state',v_target.assigned_state,'lga',v_target.assigned_lga)::text,v_actor.user_id,v_actor.email);
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_appoint_staff(p_target_user_id text,p_module text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='public'
AS $function$
DECLARE v_actor public.profiles;
BEGIN
  IF p_module NOT IN('operations','finance','support','verification','field_officer') THEN RAISE EXCEPTION 'A valid Staff module is required'; END IF;
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role IN('admin','creator')
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Admin or Creator access required'; END IF;
  PERFORM public.admin_update_role(p_target_user_id,'staff');
  PERFORM public.manage_staff_permission(p_target_user_id,p_module,true);
  UPDATE public.staff_trust_profiles SET status='probation',appointed_by=v_actor.user_id,appointed_at=now(),trusted_by=NULL,trusted_at=NULL,
    supervisor_confirmed=false,orientation_completed=false,role_training_completed=false,code_of_conduct_confirmed=false,probation_observation_completed=false,
    notes='New Staff appointment awaiting WeHouse trust review',updated_at=now() WHERE staff_id=p_target_user_id;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_worker_activation()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public'
AS $function$
DECLARE v_profile public.profiles; v_ver public.worker_verifications; v_payment public.booking_payments; v_test public.worker_test_attempts; v_attempts_24h integer; v_profile_ready boolean;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE auth_id=auth.uid()::text AND role='worker' LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Worker profile not found'; END IF;
  v_profile_ready:=public.worker_professional_profile_ready(v_profile.user_id);
  SELECT * INTO v_ver FROM public.worker_verifications WHERE worker_id=v_profile.user_id LIMIT 1;
  SELECT * INTO v_payment FROM public.booking_payments WHERE user_id=v_profile.user_id AND purpose='worker_verification' ORDER BY created_at DESC LIMIT 1;
  SELECT * INTO v_test FROM public.worker_test_attempts WHERE worker_id=v_profile.user_id ORDER BY started_at DESC LIMIT 1;
  SELECT count(*) INTO v_attempts_24h FROM public.worker_test_attempts WHERE worker_id=v_profile.user_id AND started_at>=now()-interval '24 hours';
  RETURN jsonb_build_object(
    'worker_status',COALESCE(v_profile.worker_status,'pending'),'live',COALESCE(v_profile.worker_status='verified' AND v_profile.worker_verified,false),
    'profile_complete',v_profile_ready,'payment_status',v_payment.status,'gold_badge',COALESCE(v_payment.status IN('paid','completed'),false),
    'test_passed',public.worker_test_passed(v_profile.user_id),'test_percent',v_test.percent,'test_attempts_24h',v_attempts_24h,
    'evidence_saved',COALESCE(NULLIF(BTRIM(COALESCE(v_ver.verification_video_url,'')),'') IS NOT NULL,false),
    'submitted',COALESCE(v_ver.submitted_at IS NOT NULL,false),'review_status',v_ver.status,
    'rejection_reason',(SELECT rejection_reason FROM public.worker_verification_reviews WHERE worker_id=v_profile.user_id ORDER BY created_at DESC LIMIT 1),
    'identity_status','verified','identity_provider',NULL,'identity_checked_at',NULL
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_my_worker_verification()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public'
AS $function$
DECLARE v_profile public.profiles; v_ver public.worker_verifications; v_paid boolean;
BEGIN
  SELECT * INTO v_profile FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role='worker'
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Active Worker account required'; END IF;
  IF NOT public.worker_professional_profile_ready(v_profile.user_id) THEN RAISE EXCEPTION 'Complete your professional profile and service coverage first'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.booking_payments WHERE user_id=v_profile.user_id AND purpose='worker_verification' AND status IN('paid','completed')) INTO v_paid;
  IF NOT v_paid THEN RAISE EXCEPTION 'Verified Paystack payment is required before submission'; END IF;
  IF NOT public.worker_test_passed(v_profile.user_id) THEN RAISE EXCEPTION 'Pass the Worker readiness check before submission'; END IF;
  SELECT * INTO v_ver FROM public.worker_verifications WHERE worker_id=v_profile.user_id LIMIT 1;
  IF v_ver IS NULL OR NULLIF(BTRIM(COALESCE(v_ver.verification_video_url,'')),'') IS NULL THEN RAISE EXCEPTION 'A skill demonstration video is required before review'; END IF;
  UPDATE public.worker_verifications SET status='profile_under_review',submitted_at=now(),updated_at=now() WHERE id=v_ver.id;
  UPDATE public.profiles SET worker_status='profile_under_review',worker_verified=false,available=false,updated_at=now() WHERE user_id=v_profile.user_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.review_my_staff_worker_v2(p_worker_id text,p_status text,p_reason text DEFAULT NULL,p_notes text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='public'
AS $function$
DECLARE v_actor public.profiles; v_worker public.profiles; v_ver public.worker_verifications;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor IS NULL OR v_actor.role<>'staff' OR COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN RAISE EXCEPTION 'Active Staff account required'; END IF;
  IF NOT public.current_staff_has_permission('verification') THEN RAISE EXCEPTION 'Trusted Verification Staff permission required'; END IF;
  IF p_status NOT IN('profile_under_review','verified','rejected') THEN RAISE EXCEPTION 'Invalid review outcome'; END IF;
  IF p_status='rejected' AND NULLIF(BTRIM(COALESCE(p_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'Rejection reason is required'; END IF;
  SELECT * INTO v_worker FROM public.profiles WHERE user_id=p_worker_id AND role='worker' FOR UPDATE;
  IF v_worker IS NULL THEN RAISE EXCEPTION 'Worker not found'; END IF;
  IF v_actor.assigned_state IS NULL OR lower(COALESCE(v_worker.state,''))<>lower(v_actor.assigned_state)
    OR(v_actor.assigned_lga IS NOT NULL AND lower(COALESCE(v_worker.local_government,v_worker.city,''))<>lower(v_actor.assigned_lga)) THEN RAISE EXCEPTION 'Worker is outside your assigned branch'; END IF;
  SELECT * INTO v_ver FROM public.worker_verifications WHERE worker_id=p_worker_id LIMIT 1;
  IF p_status='verified' THEN
    IF v_worker.worker_status<>'profile_under_review' THEN RAISE EXCEPTION 'Worker is not in the review queue'; END IF;
    IF NOT public.worker_test_passed(p_worker_id) THEN RAISE EXCEPTION 'Worker readiness check has not been passed'; END IF;
    IF v_ver IS NULL OR NULLIF(BTRIM(COALESCE(v_ver.verification_video_url,'')),'') IS NULL THEN RAISE EXCEPTION 'Professional work evidence is incomplete'; END IF;
  END IF;
  UPDATE public.profiles SET worker_status=p_status,worker_verified=(p_status='verified'),available=(p_status='verified'),updated_at=now(),updated_by=v_actor.user_id WHERE user_id=p_worker_id;
  UPDATE public.worker_verifications SET status=p_status,reviewed_by=v_actor.user_id,review_notes=COALESCE(NULLIF(BTRIM(p_notes),''),NULLIF(BTRIM(p_reason),'')),reviewed_at=now(),updated_at=now() WHERE id=v_ver.id;
  INSERT INTO public.worker_verification_reviews(worker_id,reviewer_id,reviewer_role,action,rejection_reason,notes,created_at)
  VALUES(p_worker_id,v_actor.user_id,v_actor.role,p_status,CASE WHEN p_status='rejected' THEN BTRIM(p_reason) ELSE NULL END,NULLIF(BTRIM(COALESCE(p_notes,'')),''),now());
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_review_my_branch_worker(p_worker_id text,p_decision text,p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public'
AS $function$
DECLARE v_actor public.profiles; v_worker public.profiles; v_ver public.worker_verifications;
BEGIN
  v_actor:=public._admin_dashboard_actor();
  SELECT * INTO v_worker FROM public.profiles WHERE user_id=p_worker_id AND role='worker' AND COALESCE(deleted,false)=false FOR UPDATE;
  IF v_worker IS NULL THEN RAISE EXCEPTION 'Worker not found'; END IF;
  IF v_actor.role='admin' AND(v_worker.state IS DISTINCT FROM v_actor.assigned_state OR COALESCE(NULLIF(v_worker.local_government,''),NULLIF(v_worker.city,'')) IS DISTINCT FROM v_actor.assigned_lga) THEN RAISE EXCEPTION 'Worker is outside your assigned branch'; END IF;
  IF v_worker.worker_status<>'profile_under_review' THEN RAISE EXCEPTION 'Worker is not in the review queue'; END IF;
  SELECT * INTO v_ver FROM public.worker_verifications WHERE worker_id=p_worker_id LIMIT 1;
  IF p_decision='approve' THEN
    IF NOT public.worker_test_passed(p_worker_id) THEN RAISE EXCEPTION 'Worker readiness check has not been passed'; END IF;
    IF v_ver IS NULL OR NULLIF(BTRIM(COALESCE(v_ver.verification_video_url,'')),'') IS NULL THEN RAISE EXCEPTION 'Professional work evidence is incomplete'; END IF;
    UPDATE public.profiles SET worker_status='verified',worker_verified=true,available=true,updated_at=now(),updated_by=v_actor.user_id WHERE user_id=p_worker_id;
    UPDATE public.worker_verifications SET status='verified',reviewed_by=v_actor.user_id,reviewed_at=now(),updated_at=now() WHERE id=v_ver.id;
  ELSIF p_decision='reject' THEN
    IF NULLIF(BTRIM(COALESCE(p_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'Rejection reason is required'; END IF;
    UPDATE public.profiles SET worker_status='rejected',worker_verified=false,available=false,updated_at=now(),updated_by=v_actor.user_id WHERE user_id=p_worker_id;
    UPDATE public.worker_verifications SET status='rejected',reviewed_by=v_actor.user_id,review_notes=BTRIM(p_reason),reviewed_at=now(),updated_at=now() WHERE id=v_ver.id;
  ELSE RAISE EXCEPTION 'Decision must be approve or reject'; END IF;
  INSERT INTO public.worker_verification_reviews(worker_id,reviewer_id,reviewer_role,action,rejection_reason)
  VALUES(p_worker_id,v_actor.user_id,v_actor.role,CASE WHEN p_decision='approve' THEN 'approved' ELSE 'rejected' END,CASE WHEN p_decision='reject' THEN BTRIM(p_reason) ELSE NULL END);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_worker_review_trust_status(p_worker_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public'
AS $function$
DECLARE v_actor public.profiles; v_worker public.profiles; v_ver public.worker_verifications; v_payment boolean; v_test public.worker_test_attempts;
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role IN('staff','admin','creator')
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Verification review access required'; END IF;
  IF v_actor.role='staff' AND NOT public.current_staff_has_permission('verification') THEN RAISE EXCEPTION 'Trusted Verification Staff permission required'; END IF;
  SELECT * INTO v_worker FROM public.profiles WHERE user_id=p_worker_id AND role='worker' LIMIT 1;
  IF v_worker IS NULL THEN RAISE EXCEPTION 'Worker not found'; END IF;
  IF v_actor.role IN('staff','admin') AND(v_actor.assigned_state IS DISTINCT FROM v_worker.state OR(v_actor.assigned_lga IS NOT NULL AND v_actor.assigned_lga IS DISTINCT FROM COALESCE(v_worker.local_government,v_worker.city))) THEN RAISE EXCEPTION 'Worker is outside your assigned branch'; END IF;
  SELECT * INTO v_ver FROM public.worker_verifications WHERE worker_id=p_worker_id LIMIT 1;
  SELECT EXISTS(SELECT 1 FROM public.booking_payments WHERE user_id=p_worker_id AND purpose='worker_verification' AND status IN('paid','completed')) INTO v_payment;
  SELECT * INTO v_test FROM public.worker_test_attempts WHERE worker_id=p_worker_id AND passed=true AND submitted_at IS NOT NULL ORDER BY submitted_at DESC LIMIT 1;
  RETURN jsonb_build_object('payment_confirmed',v_payment,'readiness_passed',v_test.id IS NOT NULL,'readiness_percent',v_test.percent,
    'evidence_saved',COALESCE(NULLIF(BTRIM(COALESCE(v_ver.verification_video_url,'')),'') IS NOT NULL,false),'submitted',COALESCE(v_ver.submitted_at IS NOT NULL,false),'review_status',v_ver.status);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_worker_review_identity_status(p_worker_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public'
AS $function$
BEGIN
  RETURN jsonb_build_object('identity_status','verified','identity_provider',NULL,'identity_checked_at',NULL,'identity_failure_reason',NULL);
END;
$function$;

DROP FUNCTION IF EXISTS public.record_external_worker_identity_result(text,text,text,text,text);
DROP FUNCTION IF EXISTS public.record_external_worker_identity_result_by_reference(text,text,text,text);

UPDATE public.worker_verifications SET
  gov_id_type=NULL,gov_id_number=NULL,gov_id_photo_url=NULL,selfie_photo_url=NULL,
  identity_provider=NULL,identity_reference=NULL,identity_checked_at=NULL,identity_failure_reason=NULL,identity_status='not_started'
WHERE gov_id_type IS NOT NULL OR gov_id_number IS NOT NULL OR gov_id_photo_url IS NOT NULL OR selfie_photo_url IS NOT NULL OR identity_provider IS NOT NULL OR identity_reference IS NOT NULL OR identity_checked_at IS NOT NULL OR identity_failure_reason IS NOT NULL OR identity_status IS DISTINCT FROM 'not_started';

CREATE OR REPLACE FUNCTION public.block_retired_worker_identity_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path='public'
AS $function$
BEGIN
  IF NULLIF(BTRIM(COALESCE(NEW.gov_id_type,'')),'') IS NOT NULL
    OR NULLIF(BTRIM(COALESCE(NEW.gov_id_number,'')),'') IS NOT NULL
    OR NULLIF(BTRIM(COALESCE(NEW.gov_id_photo_url,'')),'') IS NOT NULL
    OR NULLIF(BTRIM(COALESCE(NEW.selfie_photo_url,'')),'') IS NOT NULL
    OR NULLIF(BTRIM(COALESCE(NEW.identity_provider,'')),'') IS NOT NULL
    OR NULLIF(BTRIM(COALESCE(NEW.identity_reference,'')),'') IS NOT NULL
    OR NEW.identity_checked_at IS NOT NULL
    OR NULLIF(BTRIM(COALESCE(NEW.identity_failure_reason,'')),'') IS NOT NULL
    OR COALESCE(NEW.identity_status,'not_started')<>'not_started'
  THEN RAISE EXCEPTION 'Government/external identity fields are retired from WeHouse Worker verification'; END IF;
  NEW.identity_status:='not_started';
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_block_retired_worker_identity_fields ON public.worker_verifications;
CREATE TRIGGER trg_block_retired_worker_identity_fields
BEFORE INSERT OR UPDATE OF gov_id_type,gov_id_number,gov_id_photo_url,selfie_photo_url,identity_provider,identity_reference,identity_checked_at,identity_failure_reason,identity_status
ON public.worker_verifications FOR EACH ROW EXECUTE FUNCTION public.block_retired_worker_identity_fields();

COMMENT ON COLUMN public.worker_verifications.gov_id_type IS 'RETIRED: WeHouse does not use government ID for Worker verification.';
COMMENT ON COLUMN public.worker_verifications.gov_id_number IS 'RETIRED: WeHouse does not use government ID for Worker verification.';
COMMENT ON COLUMN public.worker_verifications.gov_id_photo_url IS 'RETIRED: WeHouse does not use government ID for Worker verification.';
COMMENT ON COLUMN public.worker_verifications.selfie_photo_url IS 'RETIRED: WeHouse does not use identity selfie verification.';
COMMENT ON COLUMN public.worker_verifications.identity_provider IS 'RETIRED: external identity providers are not used.';
COMMENT ON COLUMN public.worker_verifications.identity_status IS 'RETIRED compatibility field; not part of WeHouse verification.';

REVOKE ALL ON FUNCTION public.get_my_staff_trust_status() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.current_staff_has_permission(text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.update_staff_trust_checklist(text,boolean,boolean,boolean,boolean,boolean,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.set_staff_trust_status(text,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_get_worker_review_trust_status(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_staff_trust_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_staff_has_permission(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_staff_trust_checklist(text,boolean,boolean,boolean,boolean,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_staff_trust_status(text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_worker_review_trust_status(text) TO authenticated;
