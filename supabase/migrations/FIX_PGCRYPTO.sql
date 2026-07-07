-- Fix: pgcrypto extension must be enabled BEFORE functions that use gen_salt()
-- Run this in Supabase SQL Editor

-- Step 1: Enable pgcrypto in the public schema (required for gen_salt and crypt)
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

-- Step 2: Drop the broken functions (they were created when pgcrypto was missing)
DROP FUNCTION IF EXISTS public.creator_auth_set_v3(text, text);
DROP FUNCTION IF EXISTS public.creator_auth_verify_v3(text, text);
DROP FUNCTION IF EXISTS public.creator_auth_status_v3(text);
DROP FUNCTION IF EXISTS public.admin_auth_set_v3(text, text);
DROP FUNCTION IF EXISTS public.admin_auth_verify_v3(text, text);
DROP FUNCTION IF EXISTS public.admin_auth_status_v3(text);

-- Step 3: Recreate the functions NOW that pgcrypto is available
CREATE OR REPLACE FUNCTION public.creator_auth_set_v3(p_auth_id TEXT, p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_salt TEXT;
  v_creator RECORD;
BEGIN
  IF p_password IS NULL OR length(p_password) < 4 THEN
    RETURN FALSE;
  END IF;

  -- Find creator by auth_id
  SELECT * INTO v_creator FROM profiles WHERE auth_id = p_auth_id AND role = 'creator';

  -- Fallback: any creator profile
  IF v_creator.user_id IS NULL THEN
    SELECT * INTO v_creator FROM profiles WHERE role = 'creator' ORDER BY created_at LIMIT 1;
  END IF;

  IF v_creator.user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  v_salt := public.gen_salt('bf');

  UPDATE profiles
  SET creator_auth_password = public.crypt(p_password, v_salt),
      creator_auth_enabled = TRUE,
      auth_id = COALESCE(auth_id, p_auth_id)
  WHERE user_id = v_creator.user_id;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.creator_auth_verify_v3(p_auth_id TEXT, p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hash TEXT;
BEGIN
  SELECT creator_auth_password INTO v_hash
  FROM profiles
  WHERE (auth_id = p_auth_id AND role = 'creator') OR role = 'creator'
  ORDER BY CASE WHEN auth_id = p_auth_id THEN 0 ELSE 1 END
  LIMIT 1;

  IF v_hash IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN (v_hash = public.crypt(p_password, v_hash));
END;
$$;

CREATE OR REPLACE FUNCTION public.creator_auth_status_v3(p_auth_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_password TEXT;
  v_enabled BOOLEAN;
BEGIN
  SELECT creator_auth_password, creator_auth_enabled
  INTO v_password, v_enabled
  FROM profiles
  WHERE (auth_id = p_auth_id AND role = 'creator') OR role = 'creator'
  ORDER BY CASE WHEN auth_id = p_auth_id THEN 0 ELSE 1 END
  LIMIT 1;

  RETURN jsonb_build_object(
    'has_password', v_password IS NOT NULL,
    'enabled', COALESCE(v_enabled, FALSE)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_auth_set_v3(p_auth_id TEXT, p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_salt TEXT;
  v_admin RECORD;
BEGIN
  IF p_password IS NULL OR length(p_password) < 4 THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO v_admin FROM profiles WHERE auth_id = p_auth_id AND role IN ('admin', 'staff', 'director');

  IF v_admin.user_id IS NULL THEN
    SELECT * INTO v_admin FROM profiles WHERE role IN ('admin', 'staff', 'director') ORDER BY created_at LIMIT 1;
  END IF;

  IF v_admin.user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  v_salt := public.gen_salt('bf');

  UPDATE profiles
  SET creator_auth_password = public.crypt(p_password, v_salt),
      creator_auth_enabled = TRUE,
      auth_id = COALESCE(auth_id, p_auth_id)
  WHERE user_id = v_admin.user_id;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_auth_verify_v3(p_auth_id TEXT, p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hash TEXT;
BEGIN
  SELECT creator_auth_password INTO v_hash
  FROM profiles
  WHERE (auth_id = p_auth_id AND role IN ('admin', 'staff', 'director')) OR role IN ('admin', 'staff', 'director')
  ORDER BY CASE WHEN auth_id = p_auth_id THEN 0 ELSE 1 END
  LIMIT 1;

  IF v_hash IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN (v_hash = public.crypt(p_password, v_hash));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_auth_status_v3(p_auth_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_password TEXT;
  v_enabled BOOLEAN;
BEGIN
  SELECT creator_auth_password, creator_auth_enabled
  INTO v_password, v_enabled
  FROM profiles
  WHERE (auth_id = p_auth_id AND role IN ('admin', 'staff', 'director')) OR role IN ('admin', 'staff', 'director')
  ORDER BY CASE WHEN auth_id = p_auth_id THEN 0 ELSE 1 END
  LIMIT 1;

  RETURN jsonb_build_object(
    'has_password', v_password IS NOT NULL,
    'enabled', COALESCE(v_enabled, FALSE)
  );
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.creator_auth_set_v3 TO authenticated;
GRANT EXECUTE ON FUNCTION public.creator_auth_verify_v3 TO authenticated;
GRANT EXECUTE ON FUNCTION public.creator_auth_status_v3 TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_auth_set_v3 TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_auth_verify_v3 TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_auth_status_v3 TO authenticated;
