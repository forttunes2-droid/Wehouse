BEGIN;

-- Ensure every path that turns an account into Staff enters the same WeHouse
-- trust lifecycle. This catches Admin appointment, Creator team assignment and
-- any future controlled role mutation that updates profiles.role.
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
      staff_id,status,appointed_by,appointed_at,trusted_by,trusted_at,notes,updated_at
    ) VALUES(
      NEW.user_id,'probation',v_actor,now(),NULL,NULL,
      'Staff role or branch assignment changed; WeHouse trust review required',now()
    )
    ON CONFLICT(staff_id) DO UPDATE SET
      status='probation',
      appointed_by=COALESCE(v_actor,staff_trust_profiles.appointed_by),
      appointed_at=now(),
      trusted_by=NULL,
      trusted_at=NULL,
      notes='Staff role or branch assignment changed; WeHouse trust review required',
      updated_at=now();
  ELSIF TG_OP='UPDATE' AND OLD.role='staff' AND NEW.role<>'staff' THEN
    UPDATE public.staff_trust_profiles
    SET status='revoked',
        notes='Staff role removed',
        updated_at=now()
    WHERE staff_id=NEW.user_id;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_staff_trust_on_role_change ON public.profiles;
CREATE TRIGGER trg_sync_staff_trust_on_role_change
AFTER INSERT OR UPDATE OF role,assigned_state,assigned_lga
ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_staff_trust_on_role_change();

-- Trust decisions are sensitive operational actions, so every change is
-- recorded in the existing audit trail.
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

  SELECT status INTO v_previous
  FROM public.staff_trust_profiles
  WHERE staff_id=p_staff_id;

  INSERT INTO public.staff_trust_profiles(
    staff_id,status,appointed_by,appointed_at,trusted_by,trusted_at,notes,updated_at
  ) VALUES(
    p_staff_id,p_status,v_actor.user_id,now(),
    CASE WHEN p_status='trusted' THEN v_actor.user_id ELSE NULL END,
    CASE WHEN p_status='trusted' THEN now() ELSE NULL END,
    NULLIF(BTRIM(COALESCE(p_notes,'')),''),now()
  )
  ON CONFLICT(staff_id) DO UPDATE SET
    status=EXCLUDED.status,
    trusted_by=CASE WHEN EXCLUDED.status='trusted' THEN v_actor.user_id ELSE staff_trust_profiles.trusted_by END,
    trusted_at=CASE WHEN EXCLUDED.status='trusted' THEN now() ELSE staff_trust_profiles.trusted_at END,
    notes=EXCLUDED.notes,
    updated_at=now();

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

COMMIT;
