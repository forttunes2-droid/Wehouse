-- ═══════════════════════════════════════════════════════════════
-- FINAL FIX: Creator Auth + pgcrypto + ALL issues
-- Run this entire file in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- STEP 1: Enable pgcrypto (required for crypt/gen_salt)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- STEP 2: Drop ALL old functions (both 1-param and 2-param versions)
DROP FUNCTION IF EXISTS public.set_creator_auth(text);
DROP FUNCTION IF EXISTS public.verify_creator_auth(text);
DROP FUNCTION IF EXISTS public.set_creator_auth(text, text);
DROP FUNCTION IF EXISTS public.verify_creator_auth(text, text);

-- STEP 3: Add password column
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS creator_auth_password TEXT DEFAULT NULL;

-- STEP 4: Create set_creator_auth — updates by auth_id (Supabase UUID), NOT user_id (WHU-XXXXX)
CREATE OR REPLACE FUNCTION public.set_creator_auth(p_user_id TEXT, p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_password IS NULL OR length(p_password) < 4 THEN RETURN false; END IF;
  -- CRITICAL: auth_id stores the Supabase UUID, user_id stores WHU-XXXXX
  UPDATE profiles 
  SET creator_auth_password = crypt(p_password, gen_salt('bf')),
      creator_auth_enabled = true 
  WHERE auth_id = p_user_id;
  RETURN FOUND;
END;
$$;

-- STEP 5: Create verify_creator_auth — checks by auth_id (Supabase UUID), NOT user_id (WHU-XXXXX)
CREATE OR REPLACE FUNCTION public.verify_creator_auth(p_user_id TEXT, p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_hash TEXT;
BEGIN
  SELECT creator_auth_password INTO v_hash FROM profiles WHERE auth_id = p_user_id;
  IF v_hash IS NULL THEN RETURN false; END IF;
  RETURN v_hash = crypt(p_password, v_hash);
END;
$$;

-- STEP 6: Grant execute permissions
GRANT EXECUTE ON FUNCTION set_creator_auth TO authenticated;
GRANT EXECUTE ON FUNCTION verify_creator_auth TO authenticated;
