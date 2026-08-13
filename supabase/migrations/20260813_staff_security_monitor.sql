BEGIN;

CREATE OR REPLACE FUNCTION public.get_my_staff_security_monitor()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public','auth'
AS $$
DECLARE
  v_actor public.profiles;
  v_state text;
  v_lga text;
  v_alerts jsonb;
  v_sessions jsonb;
  v_actions jsonb;
  v_stats jsonb;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor IS NULL OR v_actor.role<>'staff' OR COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN
    RAISE EXCEPTION 'Active Staff account required';
  END IF;
  IF NOT public.current_staff_has_permission('verification') THEN
    RAISE EXCEPTION 'Security permission required';
  END IF;
  v_state:=v_actor.assigned_state;
  v_lga:=v_actor.assigned_lga;
  IF v_state IS NULL THEN RAISE EXCEPTION 'Security Staff branch assignment required'; END IF;

  WITH branch_profiles AS (
    SELECT p.user_id,p.full_name,p.username,p.email,p.role,p.suspended,p.banned
    FROM public.profiles p
    WHERE p.deleted_at IS NULL AND COALESCE(p.deleted,false)=false
      AND lower(COALESCE(p.state,''))=lower(v_state)
      AND (v_lga IS NULL OR lower(COALESCE(p.local_government,p.city,''))=lower(v_lga))
  ), session_groups AS (
    SELECT us.user_id,
      count(*) FILTER(WHERE us.is_active) active_sessions,
      count(DISTINCT NULLIF(us.ip_address,'')) FILTER(WHERE us.is_active) active_ips,
      count(*) FILTER(WHERE us.login_time>now()-interval '1 hour') logins_hour
    FROM public.user_sessions us JOIN branch_profiles bp ON bp.user_id=us.user_id
    GROUP BY us.user_id
  )
  SELECT jsonb_build_object(
    'active_sessions',COALESCE((SELECT count(*) FROM public.user_sessions us JOIN branch_profiles bp ON bp.user_id=us.user_id WHERE us.is_active),0),
    'multi_ip_accounts',COALESCE((SELECT count(*) FROM session_groups WHERE active_ips>=2),0),
    'login_bursts',COALESCE((SELECT count(*) FROM session_groups WHERE logins_hour>=4),0),
    'restricted_accounts',COALESCE((SELECT count(*) FROM branch_profiles WHERE suspended OR banned),0)
  ) INTO v_stats;

  WITH branch_profiles AS (
    SELECT p.user_id,p.full_name,p.username,p.email,p.role,p.suspended,p.banned
    FROM public.profiles p
    WHERE p.deleted_at IS NULL AND COALESCE(p.deleted,false)=false
      AND lower(COALESCE(p.state,''))=lower(v_state)
      AND (v_lga IS NULL OR lower(COALESCE(p.local_government,p.city,''))=lower(v_lga))
  ), session_groups AS (
    SELECT us.user_id,
      count(*) FILTER(WHERE us.is_active) active_sessions,
      count(DISTINCT NULLIF(us.ip_address,'')) FILTER(WHERE us.is_active) active_ips,
      count(*) FILTER(WHERE us.login_time>now()-interval '1 hour') logins_hour,
      max(us.last_seen) last_seen
    FROM public.user_sessions us JOIN branch_profiles bp ON bp.user_id=us.user_id
    GROUP BY us.user_id
  ), alerts AS (
    SELECT 'multi_ip'::text kind,CASE WHEN sg.active_ips>=3 THEN 'high' ELSE 'medium' END severity,bp.user_id subject_id,
      COALESCE(NULLIF(bp.full_name,''),NULLIF(bp.username,''),bp.email,'Account') title,
      format('%s active sessions are using %s different IP addresses.',sg.active_sessions,sg.active_ips) detail,sg.last_seen occurred_at
    FROM session_groups sg JOIN branch_profiles bp ON bp.user_id=sg.user_id WHERE sg.active_ips>=2
    UNION ALL
    SELECT 'login_burst','high',bp.user_id,COALESCE(NULLIF(bp.full_name,''),NULLIF(bp.username,''),bp.email,'Account'),
      format('%s session logins were recorded within the last hour.',sg.logins_hour),sg.last_seen
    FROM session_groups sg JOIN branch_profiles bp ON bp.user_id=sg.user_id WHERE sg.logins_hour>=4
    UNION ALL
    SELECT 'restricted_account',CASE WHEN bp.banned THEN 'high' ELSE 'medium' END,bp.user_id,
      COALESCE(NULLIF(bp.full_name,''),NULLIF(bp.username,''),bp.email,'Account'),
      CASE WHEN bp.banned THEN 'This account is banned and remains visible to Security for monitoring.' ELSE 'This account is suspended and remains visible to Security for monitoring.' END,
      now()
    FROM branch_profiles bp WHERE bp.suspended OR bp.banned
    UNION ALL
    SELECT 'financial_failure','high',fal.target_user_id,COALESCE(NULLIF(bp.full_name,''),NULLIF(bp.username,''),bp.email,'Financial event'),
      COALESCE(fal.failure_reason,fal.description,'Financial operation failed'),fal.created_at
    FROM public.financial_audit_log fal JOIN branch_profiles bp ON bp.user_id=fal.target_user_id
    WHERE fal.failure_reason IS NOT NULL OR lower(COALESCE(fal.status_after,'')) IN ('failed','reversed','blocked')
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind',kind,'severity',severity,'subject_id',subject_id,'title',title,'detail',detail,'occurred_at',occurred_at) ORDER BY occurred_at DESC),'[]'::jsonb)
  INTO v_alerts FROM (SELECT * FROM alerts ORDER BY occurred_at DESC LIMIT 50) q;

  WITH branch_profiles AS (
    SELECT p.user_id,p.full_name,p.username,p.email,p.role
    FROM public.profiles p
    WHERE p.deleted_at IS NULL AND COALESCE(p.deleted,false)=false
      AND lower(COALESCE(p.state,''))=lower(v_state)
      AND (v_lga IS NULL OR lower(COALESCE(p.local_government,p.city,''))=lower(v_lga))
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'session_id',q.id,'user_id',q.user_id,'name',COALESCE(NULLIF(q.full_name,''),NULLIF(q.username,''),q.email,'Account'),'role',q.role,
    'device',q.device,'browser',q.browser,'os',q.os,'ip_address',q.ip_address,'is_active',q.is_active,'login_time',q.login_time,'last_seen',q.last_seen
  ) ORDER BY q.last_seen DESC),'[]'::jsonb) INTO v_sessions
  FROM (SELECT us.*,bp.full_name,bp.username,bp.email,bp.role FROM public.user_sessions us JOIN branch_profiles bp ON bp.user_id=us.user_id ORDER BY us.last_seen DESC LIMIT 60) q;

  WITH branch_profiles AS (
    SELECT p.user_id FROM public.profiles p
    WHERE p.deleted_at IS NULL AND COALESCE(p.deleted,false)=false
      AND lower(COALESCE(p.state,''))=lower(v_state)
      AND (v_lga IS NULL OR lower(COALESCE(p.local_government,p.city,''))=lower(v_lga))
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',q.id,'actor_id',q.admin_id,'actor_email',q.admin_email,'action',q.action,'target_type',q.target_type,'target_id',q.target_id,'details',q.details,'created_at',q.created_at) ORDER BY q.created_at DESC),'[]'::jsonb)
  INTO v_actions
  FROM (
    SELECT aal.* FROM public.admin_audit_log aal
    WHERE aal.target_id IN (SELECT user_id FROM branch_profiles)
       OR aal.admin_id=v_actor.user_id
    ORDER BY aal.created_at DESC LIMIT 60
  ) q;

  RETURN jsonb_build_object('stats',v_stats,'alerts',v_alerts,'sessions',v_sessions,'admin_actions',v_actions,'auth_audit_available',(SELECT EXISTS(SELECT 1 FROM auth.audit_log_entries LIMIT 1)));
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_staff_security_monitor() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_staff_security_monitor() TO authenticated;

COMMIT;
