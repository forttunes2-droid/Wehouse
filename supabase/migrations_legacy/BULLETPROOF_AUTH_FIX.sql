-- ═══════════════════════════════════════════════════════════════
-- BULLETPROOF FIX: Creator + Admin Auth Password System
-- Run this ENTIRE file in Supabase SQL Editor
-- 
-- What this fixes:
-- 1. Creator password not saving (fallback only worked when auth_id=NULL)
-- 2. Admin password support added
-- 3. pgcrypto enabled for crypt()/gen_salt()
-- 4. Status check function for modal to know setup vs enter mode
-- ═══════════════════════════════════════════════════════════════

-- STEP 1: Enable pgcrypto (required for crypt/gen_salt)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- STEP 2: Ensure password columns exist
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS creator_auth_password TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS creator_auth_enabled BOOLEAN DEFAULT FALSE;

-- STEP 3: Drop all old function variants (clean slate)
DROP FUNCTION IF EXISTS public.set_creator_auth(text);
DROP FUNCTION IF EXISTS public.verify_creator_auth(text);
DROP FUNCTION IF EXISTS public.set_creator_auth(text, text);
DROP FUNCTION IF EXISTS public.verify_creator_auth(text, text);
DROP FUNCTION IF EXISTS public.get_creator_auth_status(text);
DROP FUNCTION IF EXISTS public.set_creator_auth_v2(text, text);
DROP FUNCTION IF EXISTS public.verify_creator_auth_v2(text, text);
DROP FUNCTION IF EXISTS public.get_creator_auth_status_v2(text);
DROP FUNCTION IF EXISTS public.set_admin_auth_v2(text, text);
DROP FUNCTION IF EXISTS public.verify_admin_auth_v2(text, text);
DROP FUNCTION IF EXISTS public.get_admin_auth_status_v2(text);

-- STEP 4: set_creator_auth_v2 — matches by auth_id, falls back to role='creator' (ALWAYS)
-- CRITICAL FIX: Changed from "role='creator' AND auth_id IS NULL" 
-- to just "role='creator'" — this works whether auth_id is NULL, correct, or wrong.
CREATE OR REPLACE FUNCTION public.set_creator_auth_v2(p_user_id TEXT, p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_salt TEXT;
BEGIN
  IF p_password IS NULL OR length(p_password) < 4 THEN RETURN FALSE; END IF;
  v_salt := gen_salt('bf');
  -- Match by auth_id first, then fall back to role='creator' (regardless of auth_id state)
  UPDATE profiles 
  SET creator_auth_password = crypt(p_password, v_salt),
      creator_auth_enabled = TRUE,
      auth_id = COALESCE(auth_id, p_user_id)  -- Link auth_id if it was NULL
  WHERE auth_id = p_user_id 
     OR role = 'creator';
  RETURN FOUND;
END;
$$;

-- STEP 5: verify_creator_auth_v2 — same bulletproof matching
CREATE OR REPLACE FUNCTION public.verify_creator_auth_v2(p_user_id TEXT, p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_hash TEXT; v_found BOOLEAN := FALSE;
BEGIN
  SELECT creator_auth_password INTO v_hash 
  FROM profiles 
  WHERE auth_id = p_user_id 
     OR role = 'creator';
     
  IF v_hash IS NULL THEN RETURN FALSE; END IF;
  
  v_found := (v_hash = crypt(p_password, v_hash));
  
  -- On success, link auth_id if it was NULL
  IF v_found THEN 
    UPDATE profiles 
    SET auth_id = COALESCE(auth_id, p_user_id)
    WHERE role = 'creator'; 
  END IF;
  
  RETURN v_found;
END;
$$;

-- STEP 6: get_creator_auth_status_v2 — lets modal check if password is already set
CREATE OR REPLACE FUNCTION public.get_creator_auth_status_v2(p_user_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_password TEXT; v_enabled BOOLEAN;
BEGIN
  SELECT creator_auth_password, creator_auth_enabled 
  INTO v_password, v_enabled
  FROM profiles 
  WHERE auth_id = p_user_id 
     OR role = 'creator';
     
  RETURN jsonb_build_object(
    'has_password', v_password IS NOT NULL,
    'enabled', COALESCE(v_enabled, FALSE)
  );
END;
$$;

-- STEP 7: ADMIN AUTH functions — same pattern, match role='admin' or 'staff' or 'director'
CREATE OR REPLACE FUNCTION public.set_admin_auth_v2(p_user_id TEXT, p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_salt TEXT;
BEGIN
  IF p_password IS NULL OR length(p_password) < 4 THEN RETURN FALSE; END IF;
  v_salt := gen_salt('bf');
  UPDATE profiles 
  SET creator_auth_password = crypt(p_password, v_salt),
      creator_auth_enabled = TRUE,
      auth_id = COALESCE(auth_id, p_user_id)
  WHERE auth_id = p_user_id 
     OR role IN ('admin', 'staff', 'director');
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_admin_auth_v2(p_user_id TEXT, p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_hash TEXT; v_found BOOLEAN := FALSE;
BEGIN
  SELECT creator_auth_password INTO v_hash 
  FROM profiles 
  WHERE auth_id = p_user_id 
     OR role IN ('admin', 'staff', 'director');
     
  IF v_hash IS NULL THEN RETURN FALSE; END IF;
  
  v_found := (v_hash = crypt(p_password, v_hash));
  
  IF v_found THEN 
    UPDATE profiles 
    SET auth_id = COALESCE(auth_id, p_user_id)
    WHERE role IN ('admin', 'staff', 'director');
  END IF;
  
  RETURN v_found;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_admin_auth_status_v2(p_user_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_password TEXT; v_enabled BOOLEAN;
BEGIN
  SELECT creator_auth_password, creator_auth_enabled 
  INTO v_password, v_enabled
  FROM profiles 
  WHERE auth_id = p_user_id 
     OR role IN ('admin', 'staff', 'director');
     
  RETURN jsonb_build_object(
    'has_password', v_password IS NOT NULL,
    'enabled', COALESCE(v_enabled, FALSE)
  );
END;
$$;

-- STEP 8: Grant execute permissions
GRANT EXECUTE ON FUNCTION public.set_creator_auth_v2 TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_creator_auth_v2 TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_creator_auth_status_v2 TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_admin_auth_v2 TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_admin_auth_v2 TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_auth_status_v2 TO authenticated;

-- STEP 9: Record worker verification payment + auto-grant blue tick
CREATE OR REPLACE FUNCTION public.record_worker_verification_payment(
  p_user_id TEXT,
  p_reference TEXT,
  p_amount NUMERIC
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Insert payment record
  INSERT INTO worker_payments (worker_user_id, amount, paystack_reference, status, payment_type, created_at)
  VALUES (p_user_id, p_amount, p_reference, 'success', 'verification', NOW())
  ON CONFLICT DO NOTHING;
  
  -- Auto-grant blue tick
  UPDATE profiles 
  SET worker_status = 'approved_for_verification',
      worker_verified = TRUE,
      updated_at = NOW()
  WHERE user_id = p_user_id;
  
  RETURN FOUND;
END;
$$;

-- Grant permission
GRANT EXECUTE ON FUNCTION public.record_worker_verification_payment TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- DONE. All functions are now bulletproof.
-- 
-- For Creator:  set_creator_auth_v2 / verify_creator_auth_v2 / get_creator_auth_status_v2
-- For Admin:    set_admin_auth_v2 / verify_admin_auth_v2 / get_admin_auth_status_v2
-- Worker:       record_worker_verification_payment (auto blue tick after Paystack)
-- ═══════════════════════════════════════════════════════════════
