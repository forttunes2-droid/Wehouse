-- WEHOUSE PROFILE SECURITY FOUNDATION
-- Scope: safe self-profile updates and personal/operational location separation.
-- This migration is intentionally limited to fields already confirmed in the live schema.

BEGIN;

-- 1. Admin/Staff may edit personal profile data, but never their own operational assignment.
CREATE OR REPLACE FUNCTION public.lock_admin_staff_location()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.auth_id = auth.uid()::text AND OLD.role IN ('admin', 'staff') THEN
    IF NEW.assigned_state IS DISTINCT FROM OLD.assigned_state
       OR NEW.assigned_lga IS DISTINCT FROM OLD.assigned_lga
       OR NEW.scope IS DISTINCT FROM OLD.scope THEN
      RAISE EXCEPTION 'Operational assignment cannot be changed from Profile. Contact Creator for reassignment.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 2. Reject any self-service attempt to alter privileged profile fields.
CREATE OR REPLACE FUNCTION public.protect_privileged_profile_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.auth_id = auth.uid()::text THEN
    IF NEW.auth_id IS DISTINCT FROM OLD.auth_id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.role IS DISTINCT FROM OLD.role
       OR NEW.assigned_state IS DISTINCT FROM OLD.assigned_state
       OR NEW.assigned_lga IS DISTINCT FROM OLD.assigned_lga
       OR NEW.scope IS DISTINCT FROM OLD.scope
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.updated_by IS DISTINCT FROM OLD.updated_by
       OR NEW.maintenance_exempt IS DISTINCT FROM OLD.maintenance_exempt
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
       OR NEW.creator_auth_password IS DISTINCT FROM OLD.creator_auth_password
       OR NEW.creator_auth_enabled IS DISTINCT FROM OLD.creator_auth_enabled
       OR NEW.bank_name IS DISTINCT FROM OLD.bank_name
       OR NEW.bank_code IS DISTINCT FROM OLD.bank_code
       OR NEW.bank_account_number IS DISTINCT FROM OLD.bank_account_number
       OR NEW.paystack_subaccount_code IS DISTINCT FROM OLD.paystack_subaccount_code
       OR NEW.paystack_transfer_recipient IS DISTINCT FROM OLD.paystack_transfer_recipient THEN
      RAISE EXCEPTION 'This field cannot be changed from Profile.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_privileged_profile_fields_trigger ON public.profiles;
CREATE TRIGGER protect_privileged_profile_fields_trigger
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_privileged_profile_fields();

-- 3. Canonical safe self-update RPC for shared personal profile fields.
CREATE OR REPLACE FUNCTION public.update_my_profile(
  p_username text DEFAULT NULL,
  p_full_name text DEFAULT NULL,
  p_avatar_url text DEFAULT NULL,
  p_bio text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_gender text DEFAULT NULL,
  p_is_student boolean DEFAULT NULL,
  p_school text DEFAULT NULL,
  p_state text DEFAULT NULL,
  p_local_government text DEFAULT NULL,
  p_area text DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles;
  v_username text;
BEGIN
  SELECT * INTO v_profile
  FROM public.profiles
  WHERE auth_id = auth.uid()::text
    AND deleted = false
    AND suspended = false
    AND banned = false;

  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Active profile not found';
  END IF;

  v_username := lower(trim(COALESCE(p_username, v_profile.username)));

  IF v_username IS NULL OR length(v_username) < 3 OR length(v_username) > 20 THEN
    RAISE EXCEPTION 'Username must contain 3 to 20 characters';
  END IF;

  IF v_username !~ '^[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'Username may contain only letters, numbers and underscores';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE lower(p.username) = v_username
      AND p.user_id <> v_profile.user_id
  ) THEN
    RAISE EXCEPTION 'Username is already taken';
  END IF;

  UPDATE public.profiles
  SET username = v_username,
      full_name = COALESCE(p_full_name, full_name),
      avatar_url = COALESCE(p_avatar_url, avatar_url),
      bio = COALESCE(p_bio, bio),
      phone = COALESCE(p_phone, phone),
      gender = COALESCE(p_gender, gender),
      is_student = COALESCE(p_is_student, is_student),
      school = COALESCE(p_school, school),
      state = COALESCE(p_state, state),
      local_government = COALESCE(p_local_government, local_government),
      city = COALESCE(p_local_government, city),
      area = COALESCE(p_area, area),
      updated_at = now()
  WHERE user_id = v_profile.user_id
  RETURNING * INTO v_profile;

  RETURN v_profile;
END;
$$;

REVOKE ALL ON FUNCTION public.update_my_profile(text,text,text,text,text,text,boolean,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_my_profile(text,text,text,text,text,text,boolean,text,text,text,text) TO authenticated;

-- 4. Canonical safe privacy update RPC with one meaning per field.
CREATE OR REPLACE FUNCTION public.update_my_privacy(
  p_profile_visible boolean,
  p_search_visible boolean,
  p_activity_visible boolean
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles;
BEGIN
  UPDATE public.profiles
  SET privacy_profile_visible = p_profile_visible,
      privacy_search_visible = p_search_visible,
      privacy_activity_visible = p_activity_visible,
      updated_at = now()
  WHERE auth_id = auth.uid()::text
    AND deleted = false
    AND suspended = false
    AND banned = false
  RETURNING * INTO v_profile;

  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Active profile not found';
  END IF;

  RETURN v_profile;
END;
$$;

REVOKE ALL ON FUNCTION public.update_my_privacy(boolean,boolean,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_my_privacy(boolean,boolean,boolean) TO authenticated;

COMMIT;
