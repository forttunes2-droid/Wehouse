-- WeHouse Phase 1 Foundation cleanup
-- Removes obsolete roles/policies, scopes sessions/audits, and prevents raw KYC exposure.

-- A. Remove broad/obsolete policies ------------------------------------------------
DROP POLICY IF EXISTS audit_insert_trigger ON public.audit_logs;
DROP POLICY IF EXISTS audit_select ON public.audit_logs;
DROP POLICY IF EXISTS audit_select_admin ON public.audit_logs;
CREATE POLICY audit_logs_admin_read
ON public.audit_logs
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles actor
    WHERE actor.auth_id=auth.uid()::text
      AND actor.role IN ('admin','creator')
      AND NOT COALESCE(actor.deleted,false)
      AND NOT COALESCE(actor.suspended,false)
      AND NOT COALESCE(actor.banned,false)
      AND (actor.role='creator' OR audit_logs.admin_id=actor.user_id)
  )
);

DROP POLICY IF EXISTS photo_usage_admin ON public.chat_photo_usage;
DROP POLICY IF EXISTS photo_usage_insert_own ON public.chat_photo_usage;
DROP POLICY IF EXISTS photo_usage_select_own ON public.chat_photo_usage;
CREATE POLICY chat_photo_usage_owner_insert
ON public.chat_photo_usage
FOR INSERT TO authenticated
WITH CHECK (user_id=public.current_profile_user_id());
CREATE POLICY chat_photo_usage_owner_read
ON public.chat_photo_usage
FOR SELECT TO authenticated
USING (user_id=public.current_profile_user_id());
CREATE POLICY chat_photo_usage_creator_read
ON public.chat_photo_usage
FOR SELECT TO authenticated
USING (public.is_current_creator());

-- Old hotel-booking policies compared custom profile IDs to auth UUIDs.
DROP POLICY IF EXISTS bookings_insert ON public.hotel_bookings;
DROP POLICY IF EXISTS bookings_select ON public.hotel_bookings;
DROP POLICY IF EXISTS hotel_bookings_admin_select_v2 ON public.hotel_bookings;
CREATE POLICY hotel_bookings_admin_select_v2
ON public.hotel_bookings
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles actor
    JOIN public.hotels h ON h.hotel_id=hotel_bookings.hotel_id
    WHERE actor.auth_id=auth.uid()::text
      AND actor.role IN ('admin','creator')
      AND NOT COALESCE(actor.deleted,false)
      AND NOT COALESCE(actor.suspended,false)
      AND NOT COALESCE(actor.banned,false)
      AND (
        actor.role='creator'
        OR (
          lower(trim(COALESCE(h.state,'')))=lower(trim(COALESCE(actor.assigned_state,'')))
          AND lower(trim(COALESCE(h.city,'')))=lower(trim(COALESCE(actor.assigned_lga,'')))
        )
      )
  )
);

-- Legacy integer-ID payment/review tables are empty and incompatible with current profile IDs.
-- Deny browser access until their later workflow phase replaces/migrates them.
DROP POLICY IF EXISTS payments_owner ON public.payments;
DROP POLICY IF EXISTS reviews_owner ON public.reviews;
REVOKE ALL ON TABLE public.payments FROM anon, authenticated;
REVOKE ALL ON TABLE public.reviews FROM anon, authenticated;

-- Sessions are real operational data: owner access + scoped admin visibility only.
DROP POLICY IF EXISTS sessions_admin ON public.user_sessions;
DROP POLICY IF EXISTS sessions_insert_own ON public.user_sessions;
DROP POLICY IF EXISTS sessions_select_own ON public.user_sessions;
DROP POLICY IF EXISTS sessions_update_own ON public.user_sessions;
DROP POLICY IF EXISTS user_sessions_owner ON public.user_sessions;

CREATE POLICY user_sessions_owner_insert
ON public.user_sessions
FOR INSERT TO authenticated
WITH CHECK (
  auth_id=auth.uid()::text
  AND user_id=public.current_profile_user_id()
);
CREATE POLICY user_sessions_owner_read
ON public.user_sessions
FOR SELECT TO authenticated
USING (
  auth_id=auth.uid()::text
  AND user_id=public.current_profile_user_id()
);
CREATE POLICY user_sessions_owner_update
ON public.user_sessions
FOR UPDATE TO authenticated
USING (
  auth_id=auth.uid()::text
  AND user_id=public.current_profile_user_id()
)
WITH CHECK (
  auth_id=auth.uid()::text
  AND user_id=public.current_profile_user_id()
);
CREATE POLICY user_sessions_admin_read
ON public.user_sessions
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles actor
    WHERE actor.auth_id=auth.uid()::text
      AND actor.role IN ('admin','creator')
      AND NOT COALESCE(actor.deleted,false)
      AND NOT COALESCE(actor.suspended,false)
      AND NOT COALESCE(actor.banned,false)
      AND (actor.role='creator' OR public.can_current_actor_read_profile(user_sessions.user_id))
  )
);

-- B. Canonical State + LGA admin boundary -------------------------------------------
CREATE OR REPLACE FUNCTION public._assert_admin_lga_scope(p_target_user_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_actor public.profiles;
  v_target public.profiles;
  v_target_state text;
  v_target_lga text;
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND NOT COALESCE(deleted,false)
    AND NOT COALESCE(suspended,false)
    AND NOT COALESCE(banned,false)
  LIMIT 1;

  IF v_actor IS NULL OR v_actor.role NOT IN ('admin','creator') THEN
    RAISE EXCEPTION 'Admin/Creator access required';
  END IF;
  IF v_actor.role='creator' THEN RETURN; END IF;
  IF NULLIF(btrim(v_actor.assigned_state),'') IS NULL OR NULLIF(btrim(v_actor.assigned_lga),'') IS NULL THEN
    RAISE EXCEPTION 'Admin branch assignment is incomplete. Contact Creator.';
  END IF;

  SELECT * INTO v_target FROM public.profiles WHERE user_id=p_target_user_id LIMIT 1;
  IF v_target IS NULL THEN RAISE EXCEPTION 'Target user not found'; END IF;

  IF v_target.role IN ('admin','staff') THEN
    v_target_state:=NULLIF(btrim(v_target.assigned_state),'');
    v_target_lga:=NULLIF(btrim(v_target.assigned_lga),'');
  ELSE
    v_target_state:=NULLIF(btrim(v_target.state),'');
    v_target_lga:=COALESCE(NULLIF(btrim(v_target.local_government),''),NULLIF(btrim(v_target.city),''));
  END IF;

  IF v_target_state IS NULL OR v_target_lga IS NULL THEN
    RAISE EXCEPTION 'Target user has no complete State/LGA location';
  END IF;
  IF lower(v_target_state)<>lower(v_actor.assigned_state) OR lower(v_target_lga)<>lower(v_actor.assigned_lga) THEN
    RAISE EXCEPTION 'Admin scope violation: target is outside assigned State/LGA';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._assert_admin_lga_scope(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._assert_admin_lga_scope(text) TO authenticated;

-- C. Remove ambiguous legacy admin RPC overloads ------------------------------------
DROP FUNCTION IF EXISTS public.admin_suspend_user(text);
DROP FUNCTION IF EXISTS public.admin_ban_user(text);
DROP FUNCTION IF EXISTS public.admin_get_user_count();
DROP FUNCTION IF EXISTS public.admin_get_user_count(text);

CREATE FUNCTION public.admin_get_user_count()
RETURNS TABLE(total bigint,today bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE v_actor public.profiles;
BEGIN
  v_actor:=public._admin_dashboard_actor();
  RETURN QUERY
  SELECT
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE p.created_at>=date_trunc('day',now()))::bigint
  FROM public.profiles p
  WHERE p.deleted_at IS NULL
    AND p.role<>'creator'
    AND (
      v_actor.role='creator'
      OR CASE
        WHEN p.role IN ('admin','staff') THEN
          lower(trim(COALESCE(p.assigned_state,'')))=lower(trim(COALESCE(v_actor.assigned_state,'')))
          AND lower(trim(COALESCE(p.assigned_lga,'')))=lower(trim(COALESCE(v_actor.assigned_lga,'')))
        ELSE
          lower(trim(COALESCE(p.state,'')))=lower(trim(COALESCE(v_actor.assigned_state,'')))
          AND lower(trim(COALESCE(NULLIF(p.local_government,''),NULLIF(p.city,''),'')))=lower(trim(COALESCE(v_actor.assigned_lga,'')))
      END
    );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_user_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_user_count() TO authenticated;

-- D. Generic admin role RPC may only manage User <-> Staff.
-- Creator uses creator_set_team_role because Creator must supply State/LGA/module.
CREATE OR REPLACE FUNCTION public.admin_update_role(p_target_user_id text,p_new_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_actor public.profiles;
  v_target public.profiles;
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND NOT COALESCE(deleted,false)
    AND NOT COALESCE(suspended,false)
    AND NOT COALESCE(banned,false)
  LIMIT 1;
  IF v_actor IS NULL OR v_actor.role<>'admin' THEN
    RAISE EXCEPTION 'Admin access required. Creator must use Team management.';
  END IF;

  SELECT * INTO v_target FROM public.profiles WHERE user_id=p_target_user_id FOR UPDATE;
  IF v_target IS NULL THEN RAISE EXCEPTION 'Target user not found'; END IF;
  IF v_target.auth_id=auth.uid()::text THEN RAISE EXCEPTION 'Cannot modify your own role'; END IF;
  IF v_target.role NOT IN ('user','staff') OR p_new_role NOT IN ('user','staff') THEN
    RAISE EXCEPTION 'Admin can manage only User and Staff roles';
  END IF;

  PERFORM public._assert_admin_lga_scope(p_target_user_id);

  IF p_new_role='staff' THEN
    UPDATE public.profiles
    SET role='staff',assigned_state=v_actor.assigned_state,assigned_lga=v_actor.assigned_lga,scope='local',updated_by=v_actor.user_id,updated_at=now()
    WHERE user_id=p_target_user_id;
  ELSE
    UPDATE public.profiles
    SET role='user',assigned_state=NULL,assigned_lga=NULL,scope=NULL,updated_by=v_actor.user_id,updated_at=now()
    WHERE user_id=p_target_user_id;
    UPDATE public.staff_permissions SET is_active=false,revoked_at=now() WHERE staff_id=p_target_user_id AND is_active=true;
  END IF;

  INSERT INTO public.role_change_history(user_id,user_email,old_role,new_role,changed_by,changed_by_email)
  VALUES(p_target_user_id,v_target.email,v_target.role,p_new_role,v_actor.user_id,v_actor.email);
  INSERT INTO public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
  VALUES('ROLE_CHANGE','profiles',p_target_user_id,jsonb_build_object('old_role',v_target.role,'new_role',p_new_role,'state',v_actor.assigned_state,'lga',v_actor.assigned_lga)::text,v_actor.user_id,v_actor.email);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_update_role(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_role(text,text) TO authenticated;

-- E. Admin branch profile RPC must not leak authentication/KYC secrets ----------------
CREATE OR REPLACE FUNCTION public.admin_get_my_branch_profiles(p_role text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE v_actor public.profiles; v_result jsonb;
BEGIN
  v_actor:=public._admin_dashboard_actor();
  IF p_role IS NOT NULL AND p_role NOT IN ('user','worker','property_partner','staff','admin') THEN
    RAISE EXCEPTION 'Invalid role filter';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      to_jsonb(p)
      - ARRAY[
        'auth_id','creator_auth_password','creator_auth_enabled','worker_gov_id_url',
        'maintenance_exempt','created_by','updated_by'
      ]::text[]
      ORDER BY p.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM public.profiles p
  WHERE NOT COALESCE(p.deleted,false)
    AND p.role<>'creator'
    AND (p_role IS NULL OR p.role=p_role)
    AND (
      v_actor.role='creator'
      OR CASE
        WHEN p.role IN ('admin','staff') THEN
          lower(trim(COALESCE(p.assigned_state,'')))=lower(trim(COALESCE(v_actor.assigned_state,'')))
          AND lower(trim(COALESCE(p.assigned_lga,'')))=lower(trim(COALESCE(v_actor.assigned_lga,'')))
        ELSE
          lower(trim(COALESCE(p.state,'')))=lower(trim(COALESCE(v_actor.assigned_state,'')))
          AND lower(trim(COALESCE(NULLIF(p.local_government,''),NULLIF(p.city,''),'')))=lower(trim(COALESCE(v_actor.assigned_lga,'')))
      END
    );
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_my_branch_profiles(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_my_branch_profiles(text) TO authenticated;
