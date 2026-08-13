CREATE OR REPLACE FUNCTION public.creator_set_team_role(
  p_target_user_id text,
  p_new_role text,
  p_state text DEFAULT NULL,
  p_lga text DEFAULT NULL,
  p_module text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_actor public.profiles;
  v_target public.profiles;
  v_state text := NULLIF(btrim(p_state),'');
  v_lga text := NULLIF(btrim(p_lga),'');
  v_module text := NULLIF(btrim(p_module),'');
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND role='creator'
    AND NOT COALESCE(deleted,false)
    AND NOT COALESCE(suspended,false)
    AND NOT COALESCE(banned,false)
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Creator access required'; END IF;

  SELECT * INTO v_target FROM public.profiles WHERE user_id=p_target_user_id FOR UPDATE;
  IF v_target IS NULL THEN RAISE EXCEPTION 'Target account not found'; END IF;
  IF v_target.user_id=v_actor.user_id OR v_target.role='creator' THEN RAISE EXCEPTION 'Creator role cannot be modified'; END IF;
  IF p_new_role NOT IN ('admin','staff','user') THEN RAISE EXCEPTION 'Invalid team role'; END IF;

  IF p_new_role IN ('admin','staff') THEN
    IF v_target.role NOT IN ('user','admin','staff') THEN RAISE EXCEPTION 'Only User, Admin or Staff accounts can enter Team management'; END IF;
    IF v_state IS NULL OR v_lga IS NULL THEN RAISE EXCEPTION 'State and LGA are required'; END IF;
    IF p_new_role='staff' AND (v_module IS NULL OR v_module NOT IN ('operations','finance','support','verification','field_officer')) THEN
      RAISE EXCEPTION 'A valid Staff module is required';
    END IF;

    UPDATE public.profiles
    SET role=p_new_role,assigned_state=v_state,assigned_lga=v_lga,scope='local',updated_by=v_actor.user_id,updated_at=now()
    WHERE user_id=p_target_user_id;

    UPDATE public.staff_permissions SET is_active=false,revoked_at=now() WHERE staff_id=p_target_user_id AND is_active=true;

    IF p_new_role='staff' THEN
      INSERT INTO public.staff_permissions(staff_id,permission,granted_by,granted_at,revoked_at,is_active)
      VALUES(p_target_user_id,v_module,v_actor.user_id,now(),NULL,true)
      ON CONFLICT(staff_id,permission) DO UPDATE SET granted_by=EXCLUDED.granted_by,granted_at=now(),revoked_at=NULL,is_active=true;
    END IF;
  ELSE
    IF v_target.role NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Only Admin or Staff can be returned to User'; END IF;
    UPDATE public.profiles
    SET role='user',assigned_state=NULL,assigned_lga=NULL,scope=NULL,updated_by=v_actor.user_id,updated_at=now()
    WHERE user_id=p_target_user_id;
    UPDATE public.staff_permissions SET is_active=false,revoked_at=now() WHERE staff_id=p_target_user_id AND is_active=true;
  END IF;

  INSERT INTO public.audit_logs(action,target_type,target_id,details,admin_id)
  VALUES('ROLE_CHANGE','profiles',p_target_user_id,jsonb_build_object('old_role',v_target.role,'new_role',p_new_role,'assigned_state',v_state,'assigned_lga',v_lga,'staff_module',CASE WHEN p_new_role='staff' THEN v_module ELSE NULL END)::text,v_actor.user_id);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.creator_set_team_role(text,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.creator_set_team_role(text,text,text,text,text) TO authenticated;
