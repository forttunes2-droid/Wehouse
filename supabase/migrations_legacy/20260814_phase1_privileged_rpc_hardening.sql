-- WeHouse Phase 1: privileged RPC execution and scope hardening

-- 1) SECURITY DEFINER functions must never inherit anonymous execution from PUBLIC.
-- Existing explicit authenticated/service_role grants are preserved exactly as-is.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
  END LOOP;
END $$;

-- 2) Maintenance exemption is Creator-only.
CREATE OR REPLACE FUNCTION public.admin_toggle_exempt(target_user_id text, exempt boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE v_actor public.profiles;
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND role='creator'
    AND NOT COALESCE(deleted,false)
    AND NOT COALESCE(suspended,false)
    AND NOT COALESCE(banned,false)
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Creator access required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE user_id=target_user_id AND role<>'creator') THEN
    RAISE EXCEPTION 'Target account not found or protected';
  END IF;
  UPDATE public.profiles
  SET maintenance_exempt=exempt,updated_by=v_actor.user_id,updated_at=now()
  WHERE user_id=target_user_id AND role<>'creator';
  INSERT INTO public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
  VALUES('MAINTENANCE_EXEMPT','profiles',target_user_id,jsonb_build_object('exempt',exempt)::text,v_actor.user_id,v_actor.email);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_toggle_exempt(text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_toggle_exempt(text,boolean) TO authenticated;

-- 3) Canonical account moderation: active Admin/Creator, State+LGA scope, self protection.
CREATE OR REPLACE FUNCTION public.admin_suspend_user(p_target_user_id text,p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE v_actor public.profiles; v_target public.profiles;
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role IN ('admin','creator')
    AND NOT COALESCE(deleted,false) AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false)
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Admin/Creator access required'; END IF;
  SELECT * INTO v_target FROM public.profiles WHERE user_id=p_target_user_id FOR UPDATE;
  IF v_target IS NULL THEN RAISE EXCEPTION 'Target account not found'; END IF;
  IF v_target.auth_id=auth.uid()::text THEN RAISE EXCEPTION 'Cannot suspend your own account'; END IF;
  IF v_target.role='creator' THEN RAISE EXCEPTION 'Cannot suspend Creator'; END IF;
  PERFORM public._assert_admin_lga_scope(p_target_user_id);
  UPDATE public.profiles SET suspended=true,suspended_at=now(),suspended_by=v_actor.user_id,
    suspended_reason=COALESCE(NULLIF(btrim(p_reason),''),'Administrative suspension'),updated_by=v_actor.user_id,updated_at=now()
  WHERE user_id=p_target_user_id;
  INSERT INTO public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
  VALUES('SUSPEND','profiles',p_target_user_id,jsonb_build_object('reason',COALESCE(NULLIF(btrim(p_reason),''),'Administrative suspension'))::text,v_actor.user_id,v_actor.email);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_ban_user(p_target_user_id text,p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE v_actor public.profiles; v_target public.profiles;
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role IN ('admin','creator')
    AND NOT COALESCE(deleted,false) AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false)
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Admin/Creator access required'; END IF;
  SELECT * INTO v_target FROM public.profiles WHERE user_id=p_target_user_id FOR UPDATE;
  IF v_target IS NULL THEN RAISE EXCEPTION 'Target account not found'; END IF;
  IF v_target.auth_id=auth.uid()::text THEN RAISE EXCEPTION 'Cannot ban your own account'; END IF;
  IF v_target.role='creator' THEN RAISE EXCEPTION 'Cannot ban Creator'; END IF;
  PERFORM public._assert_admin_lga_scope(p_target_user_id);
  UPDATE public.profiles SET banned=true,banned_at=now(),banned_by=v_actor.user_id,
    banned_reason=COALESCE(NULLIF(btrim(p_reason),''),'Account permanently banned'),
    deleted=true,deleted_at=now(),worker_status=CASE WHEN role='worker' THEN 'suspended' ELSE worker_status END,
    updated_by=v_actor.user_id,updated_at=now()
  WHERE user_id=p_target_user_id;
  INSERT INTO public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
  VALUES('BAN','profiles',p_target_user_id,jsonb_build_object('reason',COALESCE(NULLIF(btrim(p_reason),''),'Account permanently banned'))::text,v_actor.user_id,v_actor.email);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reactivate_user(p_target_user_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE v_actor public.profiles; v_target public.profiles;
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role IN ('admin','creator')
    AND NOT COALESCE(deleted,false) AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false)
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Admin/Creator access required'; END IF;
  SELECT * INTO v_target FROM public.profiles WHERE user_id=p_target_user_id FOR UPDATE;
  IF v_target IS NULL THEN RAISE EXCEPTION 'Target account not found'; END IF;
  IF v_target.auth_id=auth.uid()::text THEN RAISE EXCEPTION 'Cannot reactivate your own account'; END IF;
  IF v_target.role='creator' THEN RAISE EXCEPTION 'Cannot modify Creator'; END IF;
  PERFORM public._assert_admin_lga_scope(p_target_user_id);
  IF COALESCE(v_target.deleted,false) THEN RAISE EXCEPTION 'Deleted accounts cannot be reactivated'; END IF;
  IF COALESCE(v_target.banned,false) THEN RAISE EXCEPTION 'Banned accounts cannot be reactivated'; END IF;
  IF NOT COALESCE(v_target.suspended,false) THEN RAISE EXCEPTION 'Account is not suspended'; END IF;
  UPDATE public.profiles SET suspended=false,suspended_at=NULL,suspended_by=NULL,suspended_reason=NULL,
    worker_status=CASE WHEN role='worker' THEN 'pending' ELSE worker_status END,updated_by=v_actor.user_id,updated_at=now()
  WHERE user_id=p_target_user_id;
  INSERT INTO public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
  VALUES('REACTIVATE','profiles',p_target_user_id,'{}',v_actor.user_id,v_actor.email);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_suspend_user(text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_ban_user(text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_reactivate_user(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_suspend_user(text,text),public.admin_ban_user(text,text),public.admin_reactivate_user(text) TO authenticated;

-- Existing UI promotion now delegates to the canonical scoped role function.
CREATE OR REPLACE FUNCTION public.admin_promote_to_staff(p_target_user_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
BEGIN
  PERFORM public.admin_update_role(p_target_user_id,'staff');
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_promote_to_staff(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_promote_to_staff(text) TO authenticated;

-- 4) Staff listing operations are module + branch scoped; Admin branch scoped; Creator global.
CREATE OR REPLACE FUNCTION public.set_listing_status_internal(p_listing_id text,p_status text)
RETURNS public.listings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE v_actor public.profiles; v_listing public.listings;
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role IN ('staff','admin','creator')
    AND NOT COALESCE(deleted,false) AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false)
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Listing operations access required'; END IF;
  IF v_actor.role='staff' AND NOT EXISTS(
    SELECT 1 FROM public.staff_permissions sp
    WHERE sp.staff_id=v_actor.user_id AND sp.permission='operations' AND sp.is_active=true
  ) THEN RAISE EXCEPTION 'Operations Staff permission required'; END IF;
  IF p_status NOT IN ('available','reserved','closed') THEN RAISE EXCEPTION 'Invalid operational listing status'; END IF;
  SELECT * INTO v_listing FROM public.listings
  WHERE (listing_id=p_listing_id OR id::text=p_listing_id) AND deleted_at IS NULL FOR UPDATE;
  IF v_listing IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF;
  IF v_actor.role<>'creator' AND NOT public.current_actor_in_scope(v_listing.state,v_listing.city) THEN
    RAISE EXCEPTION 'Listing is outside your assigned State/LGA';
  END IF;
  IF v_listing.status IN ('pending_approval','rejected') THEN RAISE EXCEPTION 'Approval state must be resolved first'; END IF;
  UPDATE public.listings SET status=p_status WHERE id=v_listing.id RETURNING * INTO v_listing;
  RETURN v_listing;
END;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_listing_internal(p_listing_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE v_actor public.profiles; v_listing public.listings;
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role IN ('staff','admin','creator')
    AND NOT COALESCE(deleted,false) AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false)
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'WeHouse operations access required'; END IF;
  IF v_actor.role='staff' AND NOT EXISTS(
    SELECT 1 FROM public.staff_permissions sp
    WHERE sp.staff_id=v_actor.user_id AND sp.permission='operations' AND sp.is_active=true
  ) THEN RAISE EXCEPTION 'Operations Staff permission required'; END IF;
  SELECT * INTO v_listing FROM public.listings WHERE id=p_listing_id AND deleted_at IS NULL FOR UPDATE;
  IF v_listing IS NULL THEN RETURN false; END IF;
  IF v_actor.role<>'creator' AND NOT public.current_actor_in_scope(v_listing.state,v_listing.city) THEN
    RAISE EXCEPTION 'Listing is outside your assigned State/LGA';
  END IF;
  UPDATE public.listings SET status='closed',availability_status='closed',deleted_at=now() WHERE id=p_listing_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.set_listing_status_internal(text,text),public.soft_delete_listing_internal(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_listing_status_internal(text,text),public.soft_delete_listing_internal(uuid) TO authenticated;

-- 5) Scrub sensitive profile/KYC/auth fields from legacy admin list RPCs.
CREATE OR REPLACE FUNCTION public.admin_get_all_users()
RETURNS SETOF public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE v_actor public.profiles;
BEGIN
  v_actor:=public._admin_dashboard_actor();
  RETURN QUERY
  SELECT jsonb_populate_record(NULL::public.profiles,
    to_jsonb(p)-ARRAY['auth_id','creator_auth_password','creator_auth_enabled','worker_gov_id_url','maintenance_exempt','created_by','updated_by']::text[])
  FROM public.profiles p
  WHERE p.deleted_at IS NULL AND p.role<>'creator'
    AND (
      v_actor.role='creator'
      OR CASE WHEN p.role IN ('admin','staff')
        THEN p.assigned_state=v_actor.assigned_state AND p.assigned_lga=v_actor.assigned_lga
        ELSE p.state=v_actor.assigned_state AND COALESCE(NULLIF(p.local_government,''),NULLIF(p.city,''))=v_actor.assigned_lga
      END
    )
  ORDER BY p.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_all_workers()
RETURNS SETOF public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE v_actor public.profiles;
BEGIN
  v_actor:=public._admin_dashboard_actor();
  RETURN QUERY
  SELECT jsonb_populate_record(NULL::public.profiles,
    to_jsonb(p)-ARRAY['auth_id','creator_auth_password','creator_auth_enabled','worker_gov_id_url','maintenance_exempt','created_by','updated_by']::text[])
  FROM public.profiles p
  WHERE p.role='worker' AND p.deleted_at IS NULL
    AND (v_actor.role='creator' OR (p.state=v_actor.assigned_state AND COALESCE(NULLIF(p.local_government,''),NULLIF(p.city,''))=v_actor.assigned_lga))
  ORDER BY p.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_field_officers()
RETURNS SETOF public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE v_actor public.profiles;
BEGIN
  v_actor:=public._admin_dashboard_actor();
  RETURN QUERY
  SELECT jsonb_populate_record(NULL::public.profiles,
    to_jsonb(p)-ARRAY['auth_id','creator_auth_password','creator_auth_enabled','worker_gov_id_url','maintenance_exempt','created_by','updated_by']::text[])
  FROM public.profiles p
  WHERE p.role='staff' AND p.deleted_at IS NULL
    AND (v_actor.role='creator' OR (p.assigned_state=v_actor.assigned_state AND p.assigned_lga=v_actor.assigned_lga))
    AND EXISTS(SELECT 1 FROM public.staff_permissions sp WHERE sp.staff_id=p.user_id AND sp.permission='field_officer' AND sp.is_active=true)
  ORDER BY p.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_all_users(),public.admin_get_all_workers(),public.admin_get_field_officers() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_get_all_users(),public.admin_get_all_workers(),public.admin_get_field_officers() TO authenticated;
