-- WEHOUSE PROFILE SECURITY FOUNDATION
-- Scope: canonical self-profile updates, privacy, identity generation,
-- and strict separation of personal profile data from operational authority.

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS privacy_profile_visible boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS privacy_search_visible boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS privacy_activity_visible boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS privacy_email_visible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS privacy_phone_visible boolean NOT NULL DEFAULT false;

CREATE SEQUENCE IF NOT EXISTS public.wehouse_user_id_seq START WITH 10000001;

-- Admin/Staff may edit personal profile data but never their own operational assignment.
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

-- Self-service profile edits must never alter identity, authorization,
-- verification, enforcement, or Creator-control fields.
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
       OR NEW.creator_auth_enabled IS DISTINCT FROM OLD.creator_auth_enabled THEN
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

-- Database-generated WeHouse identity. Public roles only.
CREATE OR REPLACE FUNCTION public.create_my_profile(
  p_email text,
  p_role text DEFAULT 'user'
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles;
  v_auth_id text := auth.uid()::text;
  v_email text := lower(trim(COALESCE(auth.jwt()->>'email', p_email)));
  v_user_id text;
  v_username text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_role NOT IN ('user', 'worker', 'property_partner') THEN
    RAISE EXCEPTION 'Invalid public account role';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE auth_id = v_auth_id;
  IF v_profile IS NOT NULL THEN
    RETURN v_profile;
  END IF;

  v_user_id := 'WHU-' || lpad(nextval('public.wehouse_user_id_seq')::text, 8, '0');
  v_username := regexp_replace(split_part(v_email, '@', 1), '[^a-z0-9_]', '', 'g');
  IF length(v_username) < 3 THEN v_username := 'member'; END IF;
  v_username := left(v_username, 15) || substr(v_user_id, length(v_user_id) - 4);

  INSERT INTO public.profiles (
    auth_id, email, username, role, user_id, profile_complete, worker_status
  ) VALUES (
    v_auth_id, v_email, v_username, p_role, v_user_id, false,
    CASE WHEN p_role = 'worker' THEN 'pending' ELSE NULL END
  ) RETURNING * INTO v_profile;

  RETURN v_profile;
END;
$$;

REVOKE ALL ON FUNCTION public.create_my_profile(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_my_profile(text,text) TO authenticated;

-- Canonical safe self-update. Unknown keys are rejected.
CREATE OR REPLACE FUNCTION public.update_my_profile(p_updates jsonb)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles;
  v_username text;
  v_state text;
  v_lga text;
  v_unknown text[];
BEGIN
  IF p_updates IS NULL OR jsonb_typeof(p_updates) <> 'object' THEN
    RAISE EXCEPTION 'Profile updates must be an object';
  END IF;

  SELECT array_agg(k) INTO v_unknown
  FROM jsonb_object_keys(p_updates) AS k
  WHERE k NOT IN (
    'username','full_name','avatar_url','bio','phone','occupation','gender',
    'is_student','school','state','local_government','city','area','profile_complete'
  );

  IF v_unknown IS NOT NULL THEN
    RAISE EXCEPTION 'Unsupported profile fields: %', array_to_string(v_unknown, ', ');
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE auth_id = auth.uid()::text
    AND deleted = false AND suspended = false AND banned = false;

  IF v_profile IS NULL THEN RAISE EXCEPTION 'Active profile not found'; END IF;

  v_username := lower(trim(CASE WHEN p_updates ? 'username' THEN p_updates->>'username' ELSE v_profile.username END));
  IF v_username IS NULL OR length(v_username) < 3 OR length(v_username) > 20 THEN
    RAISE EXCEPTION 'Username must contain 3 to 20 characters';
  END IF;
  IF v_username !~ '^[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'Username may contain only letters, numbers and underscores';
  END IF;
  IF v_username IN ('admin','creator','support','system','api','wehouse','mod','moderator','owner','staff','help','info','null','undefined') THEN
    RAISE EXCEPTION 'This username is reserved';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE lower(p.username)=v_username AND p.user_id<>v_profile.user_id) THEN
    RAISE EXCEPTION 'Username is already taken';
  END IF;

  v_state := CASE WHEN p_updates ? 'state' THEN nullif(trim(p_updates->>'state'),'') ELSE v_profile.state END;
  v_lga := CASE
    WHEN p_updates ? 'local_government' THEN nullif(trim(p_updates->>'local_government'),'')
    WHEN p_updates ? 'city' THEN nullif(trim(p_updates->>'city'),'')
    ELSE COALESCE(v_profile.local_government, v_profile.city)
  END;

  IF COALESCE((p_updates->>'profile_complete')::boolean, v_profile.profile_complete) THEN
    IF v_state IS NULL OR v_lga IS NULL THEN
      RAISE EXCEPTION 'State and Local Government are required';
    END IF;
  END IF;

  UPDATE public.profiles SET
    username = v_username,
    full_name = CASE WHEN p_updates ? 'full_name' THEN nullif(trim(p_updates->>'full_name'),'') ELSE full_name END,
    avatar_url = CASE WHEN p_updates ? 'avatar_url' THEN nullif(trim(p_updates->>'avatar_url'),'') ELSE avatar_url END,
    bio = CASE WHEN p_updates ? 'bio' THEN nullif(trim(p_updates->>'bio'),'') ELSE bio END,
    phone = CASE WHEN p_updates ? 'phone' THEN nullif(trim(p_updates->>'phone'),'') ELSE phone END,
    occupation = CASE WHEN p_updates ? 'occupation' THEN nullif(trim(p_updates->>'occupation'),'') ELSE occupation END,
    gender = CASE WHEN p_updates ? 'gender' THEN nullif(trim(p_updates->>'gender'),'') ELSE gender END,
    is_student = CASE WHEN p_updates ? 'is_student' THEN (p_updates->>'is_student')::boolean ELSE is_student END,
    school = CASE WHEN p_updates ? 'school' THEN nullif(trim(p_updates->>'school'),'') ELSE school END,
    state = v_state,
    local_government = v_lga,
    city = v_lga,
    area = CASE WHEN p_updates ? 'area' THEN nullif(trim(p_updates->>'area'),'') ELSE area END,
    profile_complete = CASE WHEN p_updates ? 'profile_complete' THEN (p_updates->>'profile_complete')::boolean ELSE profile_complete END,
    updated_at = now()
  WHERE user_id = v_profile.user_id
  RETURNING * INTO v_profile;

  RETURN v_profile;
END;
$$;

REVOKE ALL ON FUNCTION public.update_my_profile(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_my_profile(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_my_privacy(p_updates jsonb)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles;
  v_unknown text[];
BEGIN
  SELECT array_agg(k) INTO v_unknown
  FROM jsonb_object_keys(p_updates) AS k
  WHERE k NOT IN ('privacy_profile_visible','privacy_search_visible','privacy_activity_visible','privacy_email_visible','privacy_phone_visible');
  IF v_unknown IS NOT NULL THEN RAISE EXCEPTION 'Unsupported privacy fields'; END IF;

  UPDATE public.profiles SET
    privacy_profile_visible = CASE WHEN p_updates ? 'privacy_profile_visible' THEN (p_updates->>'privacy_profile_visible')::boolean ELSE privacy_profile_visible END,
    privacy_search_visible = CASE WHEN p_updates ? 'privacy_search_visible' THEN (p_updates->>'privacy_search_visible')::boolean ELSE privacy_search_visible END,
    privacy_activity_visible = CASE WHEN p_updates ? 'privacy_activity_visible' THEN (p_updates->>'privacy_activity_visible')::boolean ELSE privacy_activity_visible END,
    privacy_email_visible = CASE WHEN p_updates ? 'privacy_email_visible' THEN (p_updates->>'privacy_email_visible')::boolean ELSE privacy_email_visible END,
    privacy_phone_visible = CASE WHEN p_updates ? 'privacy_phone_visible' THEN (p_updates->>'privacy_phone_visible')::boolean ELSE privacy_phone_visible END,
    updated_at = now()
  WHERE auth_id = auth.uid()::text
    AND deleted = false AND suspended = false AND banned = false
  RETURNING * INTO v_profile;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Active profile not found'; END IF;
  RETURN v_profile;
END;
$$;

REVOKE ALL ON FUNCTION public.update_my_privacy(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_my_privacy(jsonb) TO authenticated;

COMMIT;
