CREATE OR REPLACE FUNCTION public.admin_appoint_staff(
  p_target_user_id text,
  p_module text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_module NOT IN ('operations','finance','support','verification','field_officer') THEN
    RAISE EXCEPTION 'A valid Staff module is required';
  END IF;

  -- admin_update_role enforces that the actor is an active Admin, that the
  -- target is a User in the Admin's assigned State/LGA, and writes role/audit history.
  PERFORM public.admin_update_role(p_target_user_id, 'staff');

  -- manage_staff_permission enforces the same branch boundary and keeps one
  -- active operational module for the Staff account.
  PERFORM public.manage_staff_permission(p_target_user_id, p_module, true);

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_appoint_staff(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_appoint_staff(text,text) TO authenticated;
