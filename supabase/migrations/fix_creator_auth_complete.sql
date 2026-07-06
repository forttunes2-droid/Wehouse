-- ═══════════════════════════════════════════════════════════════
-- COMPLETE FIX: Creator Auth System
-- Handles auth_id=NULL for manually seeded creator accounts
-- Run this ENTIRE file in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- STEP 1: Enable pgcrypto (required for crypt/gen_salt)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- STEP 2: Drop ALL old function variants
DROP FUNCTION IF EXISTS public.set_creator_auth(text);
DROP FUNCTION IF EXISTS public.verify_creator_auth(text);
DROP FUNCTION IF EXISTS public.set_creator_auth(text, text);
DROP FUNCTION IF EXISTS public.verify_creator_auth(text, text);
DROP FUNCTION IF EXISTS public.get_creator_auth_status(text);

-- STEP 3: Ensure password columns exist
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS creator_auth_password TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS creator_auth_enabled BOOLEAN DEFAULT false;

-- STEP 4: set_creator_auth — matches by auth_id, falls back to role='creator' with NULL auth_id
-- Also links auth_id when it's NULL (fixes the root cause)
CREATE OR REPLACE FUNCTION public.set_creator_auth(p_user_id TEXT, p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_password IS NULL OR length(p_password) < 4 THEN RETURN false; END IF;
  
  -- Try auth_id match first (normal case), then fall back to role='creator' with NULL auth_id
  UPDATE profiles 
  SET creator_auth_password = crypt(p_password, gen_salt('bf')),
      creator_auth_enabled = true,
      auth_id = COALESCE(auth_id, p_user_id)  -- Link auth_id if it was NULL
  WHERE auth_id = p_user_id 
     OR (role = 'creator' AND auth_id IS NULL);
     
  RETURN FOUND;
END;
$$;

-- STEP 5: verify_creator_auth — matches by auth_id, falls back to role='creator' with NULL auth_id
-- Also links auth_id on successful verification (fixes root cause for future logins)
CREATE OR REPLACE FUNCTION public.verify_creator_auth(p_user_id TEXT, p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_hash TEXT;
DECLARE v_found BOOLEAN := false;
BEGIN
  -- Try auth_id match first, then fall back to role='creator' with NULL auth_id
  SELECT creator_auth_password INTO v_hash 
  FROM profiles 
  WHERE auth_id = p_user_id 
     OR (role = 'creator' AND auth_id IS NULL);
     
  IF v_hash IS NULL THEN RETURN false; END IF;
  
  v_found := (v_hash = crypt(p_password, v_hash));
  
  -- If verification succeeded and auth_id was NULL, link it now
  IF v_found THEN
    UPDATE profiles 
    SET auth_id = COALESCE(auth_id, p_user_id)
    WHERE auth_id = p_user_id 
       OR (role = 'creator' AND auth_id IS NULL);
  END IF;
  
  RETURN v_found;
END;
$$;

-- STEP 6: get_creator_auth_status — lets frontend check if password is set (bypasses RLS)
CREATE OR REPLACE FUNCTION public.get_creator_auth_status(p_user_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_password TEXT;
  v_enabled BOOLEAN;
BEGIN
  -- Try auth_id match first, then fall back to role='creator' with NULL auth_id
  SELECT creator_auth_password, creator_auth_enabled 
  INTO v_password, v_enabled
  FROM profiles 
  WHERE auth_id = p_user_id 
     OR (role = 'creator' AND auth_id IS NULL);
     
  RETURN jsonb_build_object(
    'has_password', v_password IS NOT NULL,
    'enabled', COALESCE(v_enabled, false)
  );
END;
$$;

-- STEP 7: Grant execute permissions
GRANT EXECUTE ON FUNCTION public.set_creator_auth TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_creator_auth TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_creator_auth_status TO authenticated;
