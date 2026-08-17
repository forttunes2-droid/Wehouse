BEGIN;

INSERT INTO public.platform_settings(
  key,value,category,label,description,data_type,editable,is_active,created_at,updated_at
)
VALUES(
  'admin_staff_limit','0','team','Maximum Staff per Admin',
  'Maximum active Staff an Admin can appoint. 0 means unlimited.',
  'number',true,true,now(),now()
)
ON CONFLICT(key) DO UPDATE SET
  label=EXCLUDED.label,
  description=EXCLUDED.description,
  category='team',
  data_type='number',
  editable=true,
  is_active=true,
  updated_at=now();

CREATE OR REPLACE FUNCTION public.get_admin_staff_limit_v2()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path='public'
AS $function$
  SELECT GREATEST(
    0,
    COALESCE(
      CASE WHEN value ~ '^\d+$' THEN value::integer ELSE 0 END,
      0
    )
  )
  FROM public.platform_settings
  WHERE key='admin_staff_limit' AND is_active=true
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_admin_staff_capacity()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path='public'
AS $function$
DECLARE
  v_actor public.profiles;
  v_limit integer:=0;
  v_used integer:=0;
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND role IN('admin','creator')
    AND NOT COALESCE(deleted,false)
    AND NOT COALESCE(suspended,false)
    AND NOT COALESCE(banned,false)
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Admin or Creator access required'; END IF;

  v_limit:=COALESCE(public.get_admin_staff_limit_v2(),0);

  IF v_actor.role='admin' THEN
    SELECT count(*)::integer INTO v_used
    FROM public.profiles p
    JOIN public.staff_trust_profiles st ON st.staff_id=p.user_id
    WHERE p.role='staff'
      AND NOT COALESCE(p.deleted,false)
      AND st.appointed_by=v_actor.user_id;
  END IF;

  RETURN jsonb_build_object(
    'limit',v_limit,
    'used',v_used,
    'remaining',CASE WHEN v_limit=0 THEN NULL ELSE GREATEST(0,v_limit-v_used) END,
    'unlimited',(v_limit=0)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_appoint_staff(p_target_user_id text,p_module text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $function$
DECLARE
  v_actor public.profiles;
  v_target public.profiles;
  v_limit integer:=0;
  v_used integer:=0;
BEGIN
  IF p_module NOT IN('operations','finance','support','verification','field_officer') THEN
    RAISE EXCEPTION 'A valid Staff module is required';
  END IF;

  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND role IN('admin','creator')
    AND NOT COALESCE(deleted,false)
    AND NOT COALESCE(suspended,false)
    AND NOT COALESCE(banned,false)
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Admin or Creator access required'; END IF;

  SELECT * INTO v_target
  FROM public.profiles
  WHERE user_id=p_target_user_id
    AND NOT COALESCE(deleted,false)
  FOR UPDATE;
  IF v_target IS NULL THEN RAISE EXCEPTION 'Target account not found'; END IF;
  IF v_target.role NOT IN('user','staff') THEN RAISE EXCEPTION 'Only a User or existing Staff account can be appointed'; END IF;

  IF v_actor.role='admin' THEN
    IF v_actor.assigned_state IS NULL OR v_actor.assigned_lga IS NULL THEN
      RAISE EXCEPTION 'Admin branch assignment is required';
    END IF;
    IF lower(COALESCE(v_target.state,''))<>lower(v_actor.assigned_state)
      OR lower(COALESCE(NULLIF(v_target.local_government,''),NULLIF(v_target.city,''),''))<>lower(v_actor.assigned_lga)
    THEN
      RAISE EXCEPTION 'Admin can appoint only Users in the assigned branch';
    END IF;

    IF v_target.role<>'staff' THEN
      v_limit:=COALESCE(public.get_admin_staff_limit_v2(),0);
      IF v_limit>0 THEN
        SELECT count(*)::integer INTO v_used
        FROM public.profiles p
        JOIN public.staff_trust_profiles st ON st.staff_id=p.user_id
        WHERE p.role='staff'
          AND NOT COALESCE(p.deleted,false)
          AND st.appointed_by=v_actor.user_id;

        IF v_used>=v_limit THEN
          RAISE EXCEPTION 'Staff appointment limit reached (% of %). Creator must increase the Admin Staff limit or appoint the Staff directly.',v_used,v_limit;
        END IF;
      END IF;
    END IF;
  END IF;

  IF v_target.role='user' THEN
    PERFORM public.admin_update_role(p_target_user_id,'staff');
  END IF;
  PERFORM public.manage_staff_permission(p_target_user_id,p_module,true);

  INSERT INTO public.staff_trust_profiles(
    staff_id,status,appointed_by,appointed_at,trusted_by,trusted_at,
    supervisor_confirmed,orientation_completed,role_training_completed,
    code_of_conduct_confirmed,probation_observation_completed,notes,updated_at
  )
  VALUES(
    p_target_user_id,'probation',v_actor.user_id,now(),NULL,NULL,
    false,false,false,false,false,
    'Staff appointment awaiting WeHouse trust review',now()
  )
  ON CONFLICT(staff_id) DO UPDATE SET
    status='probation',
    appointed_by=v_actor.user_id,
    appointed_at=now(),
    trusted_by=NULL,
    trusted_at=NULL,
    supervisor_confirmed=false,
    orientation_completed=false,
    role_training_completed=false,
    code_of_conduct_confirmed=false,
    probation_observation_completed=false,
    notes='Staff appointment awaiting WeHouse trust review',
    updated_at=now();

  INSERT INTO public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
  VALUES(
    'STAFF_APPOINTMENT','profiles',p_target_user_id,
    jsonb_build_object(
      'module',p_module,
      'appointed_by_role',v_actor.role,
      'admin_staff_limit',CASE WHEN v_actor.role='admin' THEN COALESCE(public.get_admin_staff_limit_v2(),0) ELSE NULL END,
      'state',COALESCE(v_target.state,v_actor.assigned_state),
      'lga',COALESCE(NULLIF(v_target.local_government,''),NULLIF(v_target.city,''),v_actor.assigned_lga)
    )::text,
    v_actor.user_id,v_actor.email
  );

  RETURN true;
END;
$function$;

-- Retire the incomplete legacy promotion path. Staff appointment must always
-- carry an operational module and pass capacity/branch checks.
CREATE OR REPLACE FUNCTION public.admin_promote_to_staff(p_target_user_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $function$
BEGIN
  RAISE EXCEPTION 'Choose a Staff operational module and use the Staff appointment flow';
END;
$function$;

REVOKE ALL ON FUNCTION public.get_admin_staff_limit_v2() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_my_admin_staff_capacity() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_admin_staff_limit_v2() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_admin_staff_capacity() TO authenticated;

COMMIT;
