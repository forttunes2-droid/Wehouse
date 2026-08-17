BEGIN;
CREATE OR REPLACE FUNCTION public.manage_staff_permission(p_staff_id text,p_permission text,p_enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE v_actor public.profiles; v_target public.profiles;
BEGIN
 SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND deleted=false AND suspended=false AND banned=false;
 SELECT * INTO v_target FROM public.profiles WHERE user_id=p_staff_id AND role='staff' AND deleted=false;
 IF v_actor.role NOT IN ('creator','admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
 IF v_target IS NULL THEN RAISE EXCEPTION 'Staff profile not found'; END IF;
 IF p_permission NOT IN ('operations','finance','support','verification','field_officer') THEN RAISE EXCEPTION 'Invalid staff module'; END IF;
 IF v_actor.role='admin' AND (v_actor.assigned_state IS DISTINCT FROM v_target.assigned_state OR v_actor.assigned_lga IS DISTINCT FROM v_target.assigned_lga) THEN RAISE EXCEPTION 'Admin can manage only staff in the same assigned LGA'; END IF;
 IF p_enabled THEN
   UPDATE public.staff_permissions SET is_active=false,revoked_at=now() WHERE staff_id=p_staff_id AND is_active=true AND permission<>p_permission;
 END IF;
 INSERT INTO public.staff_permissions(staff_id,permission,granted_by,granted_at,revoked_at,is_active)
 VALUES(p_staff_id,p_permission,v_actor.user_id,CASE WHEN p_enabled THEN now() ELSE NULL END,CASE WHEN p_enabled THEN NULL ELSE now() END,p_enabled)
 ON CONFLICT(staff_id,permission) DO UPDATE SET granted_by=EXCLUDED.granted_by,granted_at=CASE WHEN EXCLUDED.is_active THEN now() ELSE staff_permissions.granted_at END,revoked_at=CASE WHEN EXCLUDED.is_active THEN NULL ELSE now() END,is_active=EXCLUDED.is_active;
END; $$;
REVOKE ALL ON FUNCTION public.manage_staff_permission(text,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.manage_staff_permission(text,text,boolean) TO authenticated;
COMMIT;
