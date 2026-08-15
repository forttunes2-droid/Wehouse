BEGIN;

ALTER TABLE public.staff_trust_profiles
  ADD COLUMN IF NOT EXISTS supervisor_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS orientation_completed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS role_training_completed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS code_of_conduct_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS probation_observation_completed boolean NOT NULL DEFAULT false;

-- Existing actively assigned Staff were already operating before this trust
-- model was introduced. Grandfather their onboarding checks so Phase 4 does not
-- unexpectedly lock out the two currently active branch Staff accounts.
UPDATE public.staff_trust_profiles
SET supervisor_confirmed=true,
    orientation_completed=true,
    role_training_completed=true,
    code_of_conduct_confirmed=true,
    probation_observation_completed=true,
    notes=COALESCE(notes,'') || CASE WHEN COALESCE(notes,'')='' THEN '' ELSE ' · ' END || 'Existing active Staff onboarding grandfathered during internal trust rollout',
    updated_at=now()
WHERE status='trusted';

CREATE OR REPLACE FUNCTION public.update_staff_trust_checklist(
  p_staff_id text,
  p_supervisor_confirmed boolean,
  p_orientation_completed boolean,
  p_role_training_completed boolean,
  p_code_of_conduct_confirmed boolean,
  p_probation_observation_completed boolean,
  p_notes text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $function$
DECLARE
  v_actor public.profiles;
  v_target public.profiles;
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND role IN ('admin','creator')
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Admin or Creator access required'; END IF;

  SELECT * INTO v_target
  FROM public.profiles
  WHERE user_id=p_staff_id AND role='staff' AND COALESCE(deleted,false)=false
  LIMIT 1;
  IF v_target IS NULL THEN RAISE EXCEPTION 'Staff profile not found'; END IF;

  IF v_actor.role='admin' AND (
    v_actor.assigned_state IS DISTINCT FROM v_target.assigned_state
    OR v_actor.assigned_lga IS DISTINCT FROM v_target.assigned_lga
  ) THEN
    RAISE EXCEPTION 'Admin can review only Staff in the same assigned branch';
  END IF;

  INSERT INTO public.staff_trust_profiles(
    staff_id,status,appointed_by,appointed_at,
    supervisor_confirmed,orientation_completed,role_training_completed,
    code_of_conduct_confirmed,probation_observation_completed,
    notes,updated_at
  ) VALUES(
    p_staff_id,'probation',v_actor.user_id,now(),
    p_supervisor_confirmed,p_orientation_completed,p_role_training_completed,
    p_code_of_conduct_confirmed,p_probation_observation_completed,
    NULLIF(BTRIM(COALESCE(p_notes,'')),''),now()
  )
  ON CONFLICT(staff_id) DO UPDATE SET
    supervisor_confirmed=EXCLUDED.supervisor_confirmed,
    orientation_completed=EXCLUDED.orientation_completed,
    role_training_completed=EXCLUDED.role_training_completed,
    code_of_conduct_confirmed=EXCLUDED.code_of_conduct_confirmed,
    probation_observation_completed=EXCLUDED.probation_observation_completed,
    notes=EXCLUDED.notes,
    updated_at=now();

  INSERT INTO public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
  VALUES(
    'STAFF_TRUST_CHECKLIST','profiles',p_staff_id,
    jsonb_build_object(
      'supervisor_confirmed',p_supervisor_confirmed,
      'orientation_completed',p_orientation_completed,
      'role_training_completed',p_role_training_completed,
      'code_of_conduct_confirmed',p_code_of_conduct_confirmed,
      'probation_observation_completed',p_probation_observation_completed,
      'state',v_target.assigned_state,
      'lga',v_target.assigned_lga
    )::text,
    v_actor.user_id,v_actor.email
  );

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_staff_trust_status(
  p_staff_id text,
  p_status text,
  p_notes text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $function$
DECLARE
  v_actor public.profiles;
  v_target public.profiles;
  v_trust public.staff_trust_profiles;
  v_previous text;
BEGIN
  IF p_status NOT IN ('probation','trusted','restricted','revoked') THEN
    RAISE EXCEPTION 'Invalid Staff trust status';
  END IF;

  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND role IN ('admin','creator')
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Admin or Creator access required'; END IF;

  SELECT * INTO v_target
  FROM public.profiles
  WHERE user_id=p_staff_id AND role='staff' AND COALESCE(deleted,false)=false
  LIMIT 1;
  IF v_target IS NULL THEN RAISE EXCEPTION 'Staff profile not found'; END IF;

  IF v_actor.role='admin' AND (
    v_actor.assigned_state IS DISTINCT FROM v_target.assigned_state
    OR v_actor.assigned_lga IS DISTINCT FROM v_target.assigned_lga
  ) THEN
    RAISE EXCEPTION 'Admin can review only Staff in the same assigned branch';
  END IF;

  SELECT * INTO v_trust FROM public.staff_trust_profiles WHERE staff_id=p_staff_id;
  v_previous:=v_trust.status;

  IF p_status='trusted' THEN
    IF v_trust IS NULL THEN RAISE EXCEPTION 'Complete the Staff trust checklist first'; END IF;
    IF NOT (
      v_trust.supervisor_confirmed
      AND v_trust.orientation_completed
      AND v_trust.role_training_completed
      AND v_trust.code_of_conduct_confirmed
      AND v_trust.probation_observation_completed
    ) THEN
      RAISE EXCEPTION 'Complete every WeHouse Staff trust check before marking this Staff member trusted';
    END IF;
  END IF;

  UPDATE public.staff_trust_profiles
  SET status=p_status,
      trusted_by=CASE WHEN p_status='trusted' THEN v_actor.user_id ELSE trusted_by END,
      trusted_at=CASE WHEN p_status='trusted' THEN now() ELSE trusted_at END,
      notes=COALESCE(NULLIF(BTRIM(COALESCE(p_notes,'')),''),notes),
      updated_at=now()
  WHERE staff_id=p_staff_id;

  IF NOT FOUND THEN
    INSERT INTO public.staff_trust_profiles(staff_id,status,appointed_by,appointed_at,notes,updated_at)
    VALUES(p_staff_id,p_status,v_actor.user_id,now(),NULLIF(BTRIM(COALESCE(p_notes,'')),''),now());
  END IF;

  INSERT INTO public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
  VALUES(
    'STAFF_TRUST_CHANGE','profiles',p_staff_id,
    jsonb_build_object(
      'previous_status',COALESCE(v_previous,'none'),
      'new_status',p_status,
      'notes',NULLIF(BTRIM(COALESCE(p_notes,'')),''),
      'state',v_target.assigned_state,
      'lga',v_target.assigned_lga
    )::text,
    v_actor.user_id,v_actor.email
  );

  RETURN true;
END;
$function$;

-- A new role/branch assignment invalidates prior checklist completion and sends
-- Staff back through probation. Replacing the trigger function keeps the same
-- trigger created by the previous migration.
CREATE OR REPLACE FUNCTION public.sync_staff_trust_on_role_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path='public'
AS $function$
DECLARE
  v_actor text;
  v_needs_review boolean:=false;
BEGIN
  IF TG_OP='INSERT' THEN
    v_actor:=NEW.updated_by;
    v_needs_review:=(NEW.role='staff');
  ELSE
    v_actor:=COALESCE(NEW.updated_by,OLD.updated_by);
    v_needs_review:=(
      NEW.role='staff'
      AND (
        OLD.role IS DISTINCT FROM 'staff'
        OR OLD.assigned_state IS DISTINCT FROM NEW.assigned_state
        OR OLD.assigned_lga IS DISTINCT FROM NEW.assigned_lga
      )
    );
  END IF;

  IF v_needs_review THEN
    INSERT INTO public.staff_trust_profiles(
      staff_id,status,appointed_by,appointed_at,trusted_by,trusted_at,
      supervisor_confirmed,orientation_completed,role_training_completed,
      code_of_conduct_confirmed,probation_observation_completed,
      notes,updated_at
    ) VALUES(
      NEW.user_id,'probation',v_actor,now(),NULL,NULL,
      false,false,false,false,false,
      'Staff role or branch assignment changed; WeHouse trust review required',now()
    )
    ON CONFLICT(staff_id) DO UPDATE SET
      status='probation',
      appointed_by=COALESCE(v_actor,staff_trust_profiles.appointed_by),
      appointed_at=now(),
      trusted_by=NULL,
      trusted_at=NULL,
      supervisor_confirmed=false,
      orientation_completed=false,
      role_training_completed=false,
      code_of_conduct_confirmed=false,
      probation_observation_completed=false,
      notes='Staff role or branch assignment changed; WeHouse trust review required',
      updated_at=now();
  ELSIF TG_OP='UPDATE' AND OLD.role='staff' AND NEW.role<>'staff' THEN
    UPDATE public.staff_trust_profiles
    SET status='revoked',notes='Staff role removed',updated_at=now()
    WHERE staff_id=NEW.user_id;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_staff_trust_checklist(text,boolean,boolean,boolean,boolean,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_staff_trust_checklist(text,boolean,boolean,boolean,boolean,boolean,text) TO authenticated;

COMMIT;
