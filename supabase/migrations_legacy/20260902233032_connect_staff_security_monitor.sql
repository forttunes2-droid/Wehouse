-- Security is a distinct Staff responsibility. It can observe branch-scoped
-- authentication/session evidence, but it cannot sanction accounts or manage roles.

CREATE OR REPLACE FUNCTION public.manage_staff_permission(p_staff_id text, p_permission text, p_enabled boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_actor public.profiles; v_target public.profiles;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND NOT COALESCE(deleted,false) AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false) LIMIT 1;
  SELECT * INTO v_target FROM public.profiles WHERE user_id=p_staff_id AND role='staff' AND NOT COALESCE(deleted,false) LIMIT 1;
  IF v_actor.role NOT IN('creator','admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF v_target IS NULL THEN RAISE EXCEPTION 'Staff profile not found'; END IF;
  IF p_permission NOT IN('operations','finance','support','security','verification','field_officer') THEN RAISE EXCEPTION 'Invalid Staff module'; END IF;
  IF v_actor.role='admin' AND (v_actor.assigned_state IS DISTINCT FROM v_target.assigned_state OR v_actor.assigned_lga IS DISTINCT FROM v_target.assigned_lga) THEN RAISE EXCEPTION 'Admin can manage only Staff in the same assigned LGA'; END IF;
  IF p_enabled THEN UPDATE public.staff_permissions SET is_active=false,revoked_at=now() WHERE staff_id=p_staff_id AND is_active=true AND permission<>p_permission; END IF;
  INSERT INTO public.staff_permissions(staff_id,permission,granted_by,granted_at,revoked_at,is_active)
  VALUES(p_staff_id,p_permission,v_actor.user_id,CASE WHEN p_enabled THEN now() ELSE NULL END,CASE WHEN p_enabled THEN NULL ELSE now() END,p_enabled)
  ON CONFLICT(staff_id,permission) DO UPDATE SET granted_by=EXCLUDED.granted_by,granted_at=CASE WHEN EXCLUDED.is_active THEN now() ELSE staff_permissions.granted_at END,revoked_at=CASE WHEN EXCLUDED.is_active THEN NULL ELSE now() END,is_active=EXCLUDED.is_active;
END;
$function$;

CREATE OR REPLACE FUNCTION public.creator_set_team_role(p_target_user_id text, p_new_role text, p_state text DEFAULT NULL, p_lga text DEFAULT NULL, p_module text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_actor public.profiles; v_target public.profiles; v_state text:=NULLIF(btrim(p_state),''); v_lga text:=NULLIF(btrim(p_lga),''); v_module text:=NULLIF(btrim(p_module),'');
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role='creator' AND NOT COALESCE(deleted,false) AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false) LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Creator access required'; END IF;
  SELECT * INTO v_target FROM public.profiles WHERE user_id=p_target_user_id FOR UPDATE;
  IF v_target IS NULL THEN RAISE EXCEPTION 'Target account not found'; END IF;
  IF v_target.user_id=v_actor.user_id OR v_target.role='creator' THEN RAISE EXCEPTION 'Creator role cannot be modified'; END IF;
  IF p_new_role NOT IN('admin','staff','user') THEN RAISE EXCEPTION 'Invalid team role'; END IF;
  IF p_new_role IN('admin','staff') THEN
    IF v_target.role NOT IN('user','admin','staff') THEN RAISE EXCEPTION 'Only User, Admin or Staff accounts can enter Team management'; END IF;
    IF v_state IS NULL OR v_lga IS NULL THEN RAISE EXCEPTION 'State and LGA are required'; END IF;
    IF p_new_role='staff' AND (v_module IS NULL OR v_module NOT IN('operations','finance','support','security','verification','field_officer')) THEN RAISE EXCEPTION 'A valid Staff module is required'; END IF;
    UPDATE public.profiles SET role=p_new_role,assigned_state=v_state,assigned_lga=v_lga,scope='local',updated_by=v_actor.user_id,updated_at=now() WHERE user_id=p_target_user_id;
    UPDATE public.staff_permissions SET is_active=false,revoked_at=now() WHERE staff_id=p_target_user_id AND is_active=true;
    IF p_new_role='staff' THEN
      INSERT INTO public.staff_permissions(staff_id,permission,granted_by,granted_at,revoked_at,is_active) VALUES(p_target_user_id,v_module,v_actor.user_id,now(),NULL,true)
      ON CONFLICT(staff_id,permission) DO UPDATE SET granted_by=EXCLUDED.granted_by,granted_at=now(),revoked_at=NULL,is_active=true;
    END IF;
  ELSE
    IF v_target.role NOT IN('admin','staff') THEN RAISE EXCEPTION 'Only Admin or Staff can be returned to User'; END IF;
    UPDATE public.profiles SET role='user',assigned_state=NULL,assigned_lga=NULL,scope=NULL,updated_by=v_actor.user_id,updated_at=now() WHERE user_id=p_target_user_id;
    UPDATE public.staff_permissions SET is_active=false,revoked_at=now() WHERE staff_id=p_target_user_id AND is_active=true;
  END IF;
  INSERT INTO public.audit_logs(action,target_type,target_id,details,admin_id) VALUES('ROLE_CHANGE','profiles',p_target_user_id,jsonb_build_object('old_role',v_target.role,'new_role',p_new_role,'assigned_state',v_state,'assigned_lga',v_lga,'staff_module',CASE WHEN p_new_role='staff' THEN v_module ELSE NULL END)::text,v_actor.user_id);
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_appoint_staff(p_target_user_id text, p_module text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_actor public.profiles; v_target public.profiles; v_limit integer:=0; v_used integer:=0; v_state text; v_lga text;
BEGIN
  IF p_module NOT IN('operations','finance','support','security','verification','field_officer') THEN RAISE EXCEPTION 'A valid Staff module is required'; END IF;
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role IN('admin','creator') AND NOT COALESCE(deleted,false) AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false) LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Admin or Creator access required'; END IF;
  SELECT * INTO v_target FROM public.profiles WHERE user_id=p_target_user_id AND NOT COALESCE(deleted,false) FOR UPDATE;
  IF v_target IS NULL THEN RAISE EXCEPTION 'Target account not found'; END IF;
  IF v_target.role NOT IN('user','staff') THEN RAISE EXCEPTION 'Only a User or existing Staff account can be appointed'; END IF;
  IF v_actor.role='admin' THEN
    IF v_actor.assigned_state IS NULL OR v_actor.assigned_lga IS NULL THEN RAISE EXCEPTION 'Admin branch assignment is required'; END IF;
    IF lower(COALESCE(v_target.state,''))<>lower(v_actor.assigned_state) OR lower(COALESCE(NULLIF(v_target.local_government,''),NULLIF(v_target.city,''),''))<>lower(v_actor.assigned_lga) THEN RAISE EXCEPTION 'Admin can appoint only Users in the assigned branch'; END IF;
    v_state:=v_actor.assigned_state; v_lga:=v_actor.assigned_lga;
    IF v_target.role<>'staff' THEN
      v_limit:=COALESCE(public.get_admin_staff_limit_v2(),0);
      IF v_limit>0 THEN
        SELECT count(*)::integer INTO v_used FROM public.profiles p WHERE p.role='staff' AND NOT COALESCE(p.deleted,false) AND lower(COALESCE(p.assigned_state,''))=lower(v_actor.assigned_state) AND lower(COALESCE(p.assigned_lga,''))=lower(v_actor.assigned_lga);
        IF v_used>=v_limit THEN RAISE EXCEPTION 'Staff appointment limit reached (% of %). Creator must increase the Admin Staff limit or appoint the Staff directly.',v_used,v_limit; END IF;
      END IF;
    END IF;
  ELSE
    v_state:=COALESCE(NULLIF(v_target.assigned_state,''),NULLIF(v_target.state,''));
    v_lga:=COALESCE(NULLIF(v_target.assigned_lga,''),NULLIF(v_target.local_government,''),NULLIF(v_target.city,''));
    IF v_state IS NULL OR v_lga IS NULL THEN RAISE EXCEPTION 'Assign the Staff member to a State and LGA before appointment'; END IF;
  END IF;
  IF v_target.role='user' THEN PERFORM public.admin_update_role(p_target_user_id,'staff'); END IF;
  UPDATE public.profiles SET assigned_state=v_state,assigned_lga=v_lga,updated_at=now(),updated_by=v_actor.user_id WHERE user_id=p_target_user_id;
  PERFORM public.manage_staff_permission(p_target_user_id,p_module,true);
  INSERT INTO public.audit_logs(action,target_type,target_id,details,admin_id,admin_email) VALUES('STAFF_APPOINTMENT','profiles',p_target_user_id,jsonb_build_object('module',p_module,'appointed_by_role',v_actor.role,'admin_staff_limit',CASE WHEN v_actor.role='admin' THEN COALESCE(public.get_admin_staff_limit_v2(),0) ELSE NULL END,'state',v_state,'lga',v_lga,'access_model','branch_and_module_permission')::text,v_actor.user_id,v_actor.email);
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_staff_security_monitor()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public','auth'
AS $function$
DECLARE v_actor public.profiles; v_result jsonb;
BEGIN
  SELECT * INTO v_actor FROM public.profiles p
  WHERE p.auth_id=auth.uid()::text AND p.role='staff' AND NOT COALESCE(p.deleted,false) AND NOT COALESCE(p.suspended,false) AND NOT COALESCE(p.banned,false) LIMIT 1;
  IF v_actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.staff_permissions sp WHERE sp.staff_id=v_actor.user_id AND sp.permission='security' AND sp.is_active=true AND sp.revoked_at IS NULL) THEN RAISE EXCEPTION 'Security Staff permission required'; END IF;
  IF NULLIF(btrim(v_actor.assigned_state),'') IS NULL OR NULLIF(btrim(v_actor.assigned_lga),'') IS NULL THEN RAISE EXCEPTION 'Security Staff branch assignment is incomplete'; END IF;

  WITH scoped_profiles AS (
    SELECT p.* FROM public.profiles p WHERE lower(COALESCE(NULLIF(p.assigned_state,''),NULLIF(p.state,''),''))=lower(v_actor.assigned_state)
      AND lower(COALESCE(NULLIF(p.assigned_lga,''),NULLIF(p.local_government,''),NULLIF(p.city,''),''))=lower(v_actor.assigned_lga)
  ), recent_sessions AS (
    SELECT s.*,p.full_name,p.username,p.role FROM public.user_sessions s JOIN scoped_profiles p ON p.user_id=s.user_id WHERE s.login_time>=now()-interval '30 days'
  ), multi_ip AS (
    SELECT user_id,COALESCE(max(full_name),max(username),'Account') name,count(DISTINCT ip_address) locations FROM recent_sessions WHERE is_active=true AND NULLIF(ip_address,'') IS NOT NULL GROUP BY user_id HAVING count(DISTINCT ip_address)>=2
  ), bursts AS (
    SELECT user_id,COALESCE(max(full_name),max(username),'Account') name,count(*) attempts FROM recent_sessions WHERE login_time>=now()-interval '60 minutes' GROUP BY user_id HAVING count(*)>=5
  ), restricted AS (
    SELECT count(*)::integer total FROM scoped_profiles WHERE COALESCE(banned,false) OR COALESCE(suspended,false) OR COALESCE(deleted,false)
  ), alerts AS (
    SELECT jsonb_build_object('kind','multiple_locations','severity','high','title','Concurrent location pattern','detail',name||' has '||locations||' active network locations. Review the session trail and escalate if the user does not recognise them.') item FROM multi_ip
    UNION ALL
    SELECT jsonb_build_object('kind','login_burst','severity','high','title','Rapid sign-in pattern','detail',name||' recorded '||attempts||' session starts within the last hour. Confirm context before escalation.') FROM bursts
  ), auth_events AS (
    SELECT a.id,a.created_at,COALESCE(a.payload->>'action','authentication_event') action,COALESCE(p.full_name,p.username,'Branch account') name
    FROM auth.audit_log_entries a JOIN scoped_profiles p ON p.auth_id=COALESCE(a.payload->>'user_id',a.payload->>'actor_id')
    WHERE a.created_at>=now()-interval '30 days' ORDER BY a.created_at DESC LIMIT 50
  )
  SELECT jsonb_build_object(
    'stats',jsonb_build_object('active_sessions',(SELECT count(*) FROM recent_sessions WHERE is_active=true),'multi_ip_accounts',(SELECT count(*) FROM multi_ip),'login_bursts',(SELECT count(*) FROM bursts),'restricted_accounts',(SELECT total FROM restricted)),
    'alerts',COALESCE((SELECT jsonb_agg(item) FROM alerts),'[]'::jsonb),
    'sessions',COALESCE((SELECT jsonb_agg(x ORDER BY x.last_seen DESC) FROM (SELECT id session_id,COALESCE(full_name,username,'Branch account') name,role,device,browser,os,is_active,last_seen,login_time FROM recent_sessions ORDER BY last_seen DESC NULLS LAST LIMIT 50) x),'[]'::jsonb),
    'admin_actions',COALESCE((SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (SELECT a.id,a.action,a.target_type,a.target_id,a.details,a.admin_id actor_id,a.admin_email actor_email,a.created_at FROM public.admin_audit_log a LEFT JOIN public.profiles actor ON actor.user_id=a.admin_id WHERE a.created_at>=now()-interval '30 days' AND lower(COALESCE(NULLIF(actor.assigned_state,''),v_actor.assigned_state))=lower(v_actor.assigned_state) AND lower(COALESCE(NULLIF(actor.assigned_lga,''),v_actor.assigned_lga))=lower(v_actor.assigned_lga) ORDER BY a.created_at DESC LIMIT 50) x),'[]'::jsonb),
    'auth_events',COALESCE((SELECT jsonb_agg(auth_events ORDER BY created_at DESC) FROM auth_events),'[]'::jsonb),
    'auth_audit_available',true
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_staff_security_monitor() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_staff_security_monitor() TO authenticated,service_role;
