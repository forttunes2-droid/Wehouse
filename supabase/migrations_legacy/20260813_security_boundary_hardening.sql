-- WeHouse security boundary hardening — 2026-08-13
-- Keep canonical booking/withdrawal flows intact while closing legacy client-access paths.

BEGIN;

-- ═══════════════════════════════════════════════════════════════
-- 1) PROFILES: direct client writes are self-service only.
--    Privileged account changes must go through scoped SECURITY DEFINER RPCs.
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS profiles_insert ON public.profiles;
DROP POLICY IF EXISTS profiles_update ON public.profiles;
DROP POLICY IF EXISTS profiles_delete ON public.profiles;

-- Extend the existing self-write guard to all privilege / trust fields.
CREATE OR REPLACE FUNCTION public.protect_privileged_profile_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.auth_id = auth.uid()::text THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.auth_id IS DISTINCT FROM OLD.auth_id
      OR NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.email IS DISTINCT FROM OLD.email
      OR NEW.role IS DISTINCT FROM OLD.role
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.email_verified IS DISTINCT FROM OLD.email_verified
      OR NEW.phone_verified IS DISTINCT FROM OLD.phone_verified
      OR NEW.id_verified IS DISTINCT FROM OLD.id_verified
      OR NEW.assigned_state IS DISTINCT FROM OLD.assigned_state
      OR NEW.assigned_lga IS DISTINCT FROM OLD.assigned_lga
      OR NEW.scope IS DISTINCT FROM OLD.scope
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.updated_by IS DISTINCT FROM OLD.updated_by
      OR NEW.maintenance_exempt IS DISTINCT FROM OLD.maintenance_exempt
      OR NEW.is_premium IS DISTINCT FROM OLD.is_premium
      OR NEW.premium_expires_at IS DISTINCT FROM OLD.premium_expires_at
      OR NEW.worker_verified IS DISTINCT FROM OLD.worker_verified
      OR NEW.worker_status IS DISTINCT FROM OLD.worker_status
      OR NEW.deleted IS DISTINCT FROM OLD.deleted
      OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
      OR NEW.suspended IS DISTINCT FROM OLD.suspended
      OR NEW.suspended_at IS DISTINCT FROM OLD.suspended_at
      OR NEW.suspended_by IS DISTINCT FROM OLD.suspended_by
      OR NEW.suspended_reason IS DISTINCT FROM OLD.suspended_reason
      OR NEW.banned IS DISTINCT FROM OLD.banned
      OR NEW.banned_at IS DISTINCT FROM OLD.banned_at
      OR NEW.banned_by IS DISTINCT FROM OLD.banned_by
      OR NEW.banned_reason IS DISTINCT FROM OLD.banned_reason
      OR NEW.rating IS DISTINCT FROM OLD.rating
      OR NEW.review_count IS DISTINCT FROM OLD.review_count
      OR NEW.creator_auth_password IS DISTINCT FROM OLD.creator_auth_password
      OR NEW.creator_auth_enabled IS DISTINCT FROM OLD.creator_auth_enabled
      OR NEW.terms_accepted_at IS DISTINCT FROM OLD.terms_accepted_at
      OR NEW.privacy_accepted_at IS DISTINCT FROM OLD.privacy_accepted_at
      OR NEW.legal_accepted_version IS DISTINCT FROM OLD.legal_accepted_version
    THEN
      RAISE EXCEPTION 'This field cannot be changed from Profile.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Profile creation is canonical through create_my_profile().
-- Direct INSERT is intentionally unavailable to authenticated clients.

-- ═══════════════════════════════════════════════════════════════
-- 2) CREATOR ACTION PASSWORD: authenticated Creator only.
--    Existing legacy MD5 hashes remain verifiable once so they can
--    be migrated to bcrypt on password change.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.creator_auth_status_v3(p_auth_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE
  v_creator public.profiles;
BEGIN
  IF auth.uid() IS NULL OR p_auth_id IS DISTINCT FROM auth.uid()::text THEN
    RAISE EXCEPTION 'Creator authentication required';
  END IF;

  SELECT * INTO v_creator
  FROM public.profiles
  WHERE auth_id = auth.uid()::text
    AND role = 'creator'
    AND COALESCE(deleted,false) = false
    AND COALESCE(suspended,false) = false
    AND COALESCE(banned,false) = false
  LIMIT 1;

  IF v_creator IS NULL THEN
    RAISE EXCEPTION 'Creator account required';
  END IF;

  RETURN jsonb_build_object(
    'has_password', v_creator.creator_auth_password IS NOT NULL,
    'enabled', COALESCE(v_creator.creator_auth_enabled,false),
    'legacy', v_creator.creator_auth_password IS NOT NULL
              AND v_creator.creator_auth_password NOT LIKE '$2%'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.creator_auth_verify_v3(p_auth_id text, p_password text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE
  v_creator public.profiles;
BEGIN
  IF auth.uid() IS NULL OR p_auth_id IS DISTINCT FROM auth.uid()::text THEN
    RETURN false;
  END IF;

  SELECT * INTO v_creator
  FROM public.profiles
  WHERE auth_id = auth.uid()::text
    AND role = 'creator'
    AND COALESCE(deleted,false) = false
    AND COALESCE(suspended,false) = false
    AND COALESCE(banned,false) = false
  LIMIT 1;

  IF v_creator IS NULL
     OR COALESCE(v_creator.creator_auth_enabled,false) = false
     OR v_creator.creator_auth_password IS NULL
     OR p_password IS NULL THEN
    RETURN false;
  END IF;

  IF v_creator.creator_auth_password LIKE '$2%' THEN
    RETURN extensions.crypt(p_password, v_creator.creator_auth_password) = v_creator.creator_auth_password;
  END IF;

  -- One-way compatibility with the old format until the password is changed.
  RETURN v_creator.creator_auth_password = md5(v_creator.auth_id || p_password);
END;
$function$;

-- Legacy setup function kept only for an already-open old frontend bundle.
-- It can initialize a missing password but cannot overwrite an existing one.
CREATE OR REPLACE FUNCTION public.creator_auth_set_v3(p_auth_id text, p_password text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE
  v_creator public.profiles;
BEGIN
  IF auth.uid() IS NULL OR p_auth_id IS DISTINCT FROM auth.uid()::text THEN
    RETURN false;
  END IF;
  IF p_password IS NULL OR length(p_password) < 8 THEN
    RAISE EXCEPTION 'Authorization password must be at least 8 characters';
  END IF;

  SELECT * INTO v_creator
  FROM public.profiles
  WHERE auth_id = auth.uid()::text
    AND role = 'creator'
    AND COALESCE(deleted,false) = false
    AND COALESCE(suspended,false) = false
    AND COALESCE(banned,false) = false
  FOR UPDATE;

  IF v_creator IS NULL THEN
    RETURN false;
  END IF;
  IF v_creator.creator_auth_password IS NOT NULL THEN
    RAISE EXCEPTION 'Use the secure password-change flow';
  END IF;

  UPDATE public.profiles
  SET creator_auth_password = extensions.crypt(p_password, extensions.gen_salt('bf', 12)),
      creator_auth_enabled = true,
      updated_at = now()
  WHERE id = v_creator.id;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.creator_action_password_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.creator_auth_status_v3(auth.uid()::text);
END;
$function$;

CREATE OR REPLACE FUNCTION public.creator_action_password_verify(p_password text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.creator_auth_verify_v3(auth.uid()::text, p_password);
END;
$function$;

CREATE OR REPLACE FUNCTION public.creator_action_password_set(
  p_new_password text,
  p_current_password text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE
  v_creator public.profiles;
  v_current_ok boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_new_password IS NULL OR length(p_new_password) < 8 THEN
    RAISE EXCEPTION 'Authorization password must be at least 8 characters';
  END IF;

  SELECT * INTO v_creator
  FROM public.profiles
  WHERE auth_id = auth.uid()::text
    AND role = 'creator'
    AND COALESCE(deleted,false) = false
    AND COALESCE(suspended,false) = false
    AND COALESCE(banned,false) = false
  FOR UPDATE;

  IF v_creator IS NULL THEN
    RAISE EXCEPTION 'Creator account required';
  END IF;

  IF v_creator.creator_auth_password IS NOT NULL THEN
    IF p_current_password IS NULL THEN
      RAISE EXCEPTION 'Current authorization password is required';
    END IF;

    IF v_creator.creator_auth_password LIKE '$2%' THEN
      v_current_ok := extensions.crypt(p_current_password, v_creator.creator_auth_password) = v_creator.creator_auth_password;
    ELSE
      v_current_ok := v_creator.creator_auth_password = md5(v_creator.auth_id || p_current_password);
    END IF;

    IF NOT v_current_ok THEN
      RAISE EXCEPTION 'Current authorization password is incorrect';
    END IF;
  END IF;

  UPDATE public.profiles
  SET creator_auth_password = extensions.crypt(p_new_password, extensions.gen_salt('bf', 12)),
      creator_auth_enabled = true,
      updated_at = now()
  WHERE id = v_creator.id;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.creator_auth_status_v3(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.creator_auth_verify_v3(text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.creator_auth_set_v3(text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.creator_action_password_status() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.creator_action_password_verify(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.creator_action_password_set(text,text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.creator_auth_status_v3(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.creator_auth_verify_v3(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.creator_auth_set_v3(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.creator_action_password_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.creator_action_password_verify(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.creator_action_password_set(text,text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 3) RETIRE SUPERSEDED CLIENT-CALLABLE FINANCE / BOOKING RPCs.
--    Canonical replacements are request_worker_withdrawal,
--    create_booking_request, create_worker_booking_payment, etc.
-- ═══════════════════════════════════════════════════════════════

REVOKE ALL ON FUNCTION public.request_withdrawal(text,numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_withdrawal_v2(uuid,numeric,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_withdrawal_v2(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_withdrawal_v2(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_worker_booking_v2(text,text,numeric,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_booking_payment(uuid,text,numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_booking_details(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.request_withdrawal(text,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_withdrawal_v2(uuid,numeric,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_withdrawal_v2(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reject_withdrawal_v2(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_worker_booking_v2(text,text,numeric,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_booking_payment(uuid,text,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_booking_details(uuid) TO service_role;

COMMIT;
