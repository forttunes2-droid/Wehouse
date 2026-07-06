-- ═══════════════════════════════════════════════════════════════
-- FINAL AUTH FIX: Uses STABLE user_id (WHU-XXXXX) not Supabase UUID
-- This makes passwords survive across devices, sessions, and deployments
-- ═══════════════════════════════════════════════════════════════

-- Step 1: Enable pgcrypto
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Step 2: Ensure columns exist
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS creator_auth_password TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS creator_auth_enabled BOOLEAN DEFAULT FALSE;

-- Step 3: Drop ALL old function variants
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
DROP FUNCTION IF EXISTS public.record_worker_verification_payment(text, text, numeric);

-- ═══════════════════════════════════════════════════════════════
-- CREATOR AUTH — uses STABLE user_id (WHU-XXXXX)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_creator_auth_v2(p_user_id TEXT, p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_salt TEXT;
BEGIN
  IF p_password IS NULL OR length(p_password) < 4 THEN RETURN FALSE; END IF;
  v_salt := gen_salt('bf');
  -- CRITICAL: Match by user_id (WHU-XXXXX) which NEVER changes
  -- Fallback to role='creator' for initial setup
  UPDATE profiles 
  SET creator_auth_password = crypt(p_password, v_salt),
      creator_auth_enabled = TRUE
  WHERE user_id = p_user_id 
     OR role = 'creator';
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_creator_auth_v2(p_user_id TEXT, p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_hash TEXT; v_found BOOLEAN := FALSE;
BEGIN
  -- Match by stable user_id (WHU-XXXXX) first, then role='creator' fallback
  SELECT creator_auth_password INTO v_hash 
  FROM profiles 
  WHERE user_id = p_user_id 
     OR role = 'creator';
     
  IF v_hash IS NULL THEN RETURN FALSE; END IF;
  v_found := (v_hash = crypt(p_password, v_hash));
  RETURN v_found;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_creator_auth_status_v2(p_user_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_password TEXT; v_enabled BOOLEAN;
BEGIN
  SELECT creator_auth_password, creator_auth_enabled 
  INTO v_password, v_enabled
  FROM profiles 
  WHERE user_id = p_user_id 
     OR role = 'creator';
     
  RETURN jsonb_build_object(
    'has_password', v_password IS NOT NULL,
    'enabled', COALESCE(v_enabled, FALSE)
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- ADMIN AUTH — same pattern, uses stable user_id
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_admin_auth_v2(p_user_id TEXT, p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_salt TEXT;
BEGIN
  IF p_password IS NULL OR length(p_password) < 4 THEN RETURN FALSE; END IF;
  v_salt := gen_salt('bf');
  UPDATE profiles 
  SET creator_auth_password = crypt(p_password, v_salt),
      creator_auth_enabled = TRUE
  WHERE user_id = p_user_id 
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
  WHERE user_id = p_user_id 
     OR role IN ('admin', 'staff', 'director');
     
  IF v_hash IS NULL THEN RETURN FALSE; END IF;
  v_found := (v_hash = crypt(p_password, v_hash));
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
  WHERE user_id = p_user_id 
     OR role IN ('admin', 'staff', 'director');
     
  RETURN jsonb_build_object(
    'has_password', v_password IS NOT NULL,
    'enabled', COALESCE(v_enabled, FALSE)
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- WORKER VERIFICATION PAYMENT — auto blue tick after Paystack
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.record_worker_verification_payment(
  p_user_id TEXT,
  p_reference TEXT,
  p_amount NUMERIC
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO worker_payments (worker_user_id, amount, paystack_reference, status, payment_type, created_at)
  VALUES (p_user_id, p_amount, p_reference, 'success', 'verification', NOW())
  ON CONFLICT DO NOTHING;
  
  UPDATE profiles 
  SET worker_status = 'approved_for_verification',
      worker_verified = TRUE,
      updated_at = NOW()
  WHERE user_id = p_user_id;
  
  RETURN FOUND;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- GRANT PERMISSIONS
-- ═══════════════════════════════════════════════════════════════

GRANT EXECUTE ON FUNCTION public.set_creator_auth_v2 TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_creator_auth_v2 TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_creator_auth_status_v2 TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_admin_auth_v2 TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_admin_auth_v2 TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_auth_status_v2 TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_worker_verification_payment TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- DONE. Passwords now use stable user_id (WHU-XXXXX).
-- They survive: new devices, cleared cookies, new browsers,
-- page refreshes, logout/login, and deployments.
-- ═══════════════════════════════════════════════════════════════
