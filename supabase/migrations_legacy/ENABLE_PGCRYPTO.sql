-- ═══════════════════════════════════════════════════════════════
-- STANDALONE: Enable pgcrypto + Create password function
-- Run this ONE command first to test if pgcrypto works
-- ═══════════════════════════════════════════════════════════════

-- Step 1: Enable pgcrypto (this is what fixes gen_salt)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Step 2: Test it works (should return a hash, not an error)
-- Uncomment the line below to test:
-- SELECT crypt('test', gen_salt('bf')) AS test_hash;

-- Step 3: Ensure password columns exist
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS creator_auth_password TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS creator_auth_enabled BOOLEAN DEFAULT FALSE;

-- Step 4: Create the password function
CREATE OR REPLACE FUNCTION public.set_creator_auth_v2(p_user_id TEXT, p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_salt TEXT;
BEGIN
  IF p_password IS NULL OR length(p_password) < 4 THEN RETURN FALSE; END IF;
  v_salt := gen_salt('bf');
  UPDATE profiles SET creator_auth_password = crypt(p_password, v_salt), creator_auth_enabled = TRUE, auth_id = COALESCE(auth_id, p_user_id)
  WHERE auth_id = p_user_id OR (role = 'creator' AND auth_id IS NULL);
  RETURN FOUND;
END;
$$;

-- Step 5: Create verify function
CREATE OR REPLACE FUNCTION public.verify_creator_auth_v2(p_user_id TEXT, p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_hash TEXT; v_found BOOLEAN := FALSE;
BEGIN
  SELECT creator_auth_password INTO v_hash FROM profiles WHERE auth_id = p_user_id OR (role = 'creator' AND auth_id IS NULL);
  IF v_hash IS NULL THEN RETURN FALSE; END IF;
  v_found := (v_hash = crypt(p_password, v_hash));
  IF v_found THEN UPDATE profiles SET auth_id = COALESCE(auth_id, p_user_id) WHERE role = 'creator'; END IF;
  RETURN v_found;
END;
$$;

-- Step 6: Create status check function
CREATE OR REPLACE FUNCTION public.get_creator_auth_status_v2(p_user_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_password TEXT; v_enabled BOOLEAN;
BEGIN
  SELECT creator_auth_password, creator_auth_enabled INTO v_password, v_enabled FROM profiles
  WHERE auth_id = p_user_id OR (role = 'creator' AND auth_id IS NULL);
  RETURN jsonb_build_object('has_password', v_password IS NOT NULL, 'enabled', COALESCE(v_enabled, FALSE));
END;
$$;

-- Step 7: Grant permissions
GRANT EXECUTE ON FUNCTION public.set_creator_auth_v2 TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_creator_auth_v2 TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_creator_auth_status_v2 TO authenticated;
