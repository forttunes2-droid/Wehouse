-- ═══════════════════════════════════════════════════════════════
-- ULTIMATE FIX — Run this ENTIRE file in Supabase SQL Editor
-- This fixes: Creator Auth password, Settings system, Worker flow
-- ═══════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════
-- PART 1: CREATOR AUTH PASSWORD (gen_salt fix)
-- ═══════════════════════════════════════════════════════════

-- Enable pgcrypto (REQUIRED for crypt/gen_salt to work)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Verify pgcrypto is installed (should return a hash, not an error)
-- SELECT crypt('test', gen_salt('bf')); -- Uncomment to test

-- Drop EVERY possible variant of these functions
DROP FUNCTION IF EXISTS public.set_creator_auth(TEXT);
DROP FUNCTION IF EXISTS public.set_creator_auth(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.verify_creator_auth(TEXT);
DROP FUNCTION IF EXISTS public.verify_creator_auth(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.get_creator_auth_status(TEXT);

-- Ensure columns exist
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS creator_auth_password TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS creator_auth_enabled BOOLEAN DEFAULT FALSE;

-- Fix: Also ensure the creator account has a valid auth_id
-- This links the creator's Supabase auth UUID to their profile
UPDATE profiles 
SET auth_id = (
  SELECT id::text FROM auth.users 
  WHERE email = (SELECT email FROM profiles WHERE role = 'creator' LIMIT 1)
  LIMIT 1
)
WHERE role = 'creator' AND auth_id IS NULL;

-- set_creator_auth: Creates/updates the bcrypt password
CREATE OR REPLACE FUNCTION public.set_creator_auth(p_user_id TEXT, p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_salt TEXT;
BEGIN
  -- Validate input
  IF p_password IS NULL OR length(p_password) < 4 THEN 
    RETURN FALSE; 
  END IF;
  
  -- Generate salt using pgcrypto
  v_salt := gen_salt('bf');
  
  -- Try matching by auth_id first (normal login), fall back to role='creator'
  UPDATE profiles 
  SET creator_auth_password = crypt(p_password, v_salt),
      creator_auth_enabled = TRUE,
      auth_id = COALESCE(auth_id, p_user_id)
  WHERE auth_id = p_user_id 
     OR (role = 'creator' AND auth_id IS NULL);
     
  -- Return TRUE if a row was updated
  RETURN FOUND;
END;
$$;

-- verify_creator_auth: Checks password and links auth_id on success
CREATE OR REPLACE FUNCTION public.verify_creator_auth(p_user_id TEXT, p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE 
  v_hash TEXT;
  v_found BOOLEAN := FALSE;
BEGIN
  -- Find the creator's password hash
  SELECT creator_auth_password INTO v_hash 
  FROM profiles 
  WHERE auth_id = p_user_id 
     OR (role = 'creator' AND auth_id IS NULL);
     
  -- No password set yet
  IF v_hash IS NULL THEN 
    RETURN FALSE; 
  END IF;
  
  -- Verify using bcrypt compare
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

-- get_creator_auth_status: Lets frontend check if password is already set
CREATE OR REPLACE FUNCTION public.get_creator_auth_status(p_user_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_password TEXT;
  v_enabled BOOLEAN;
BEGIN
  SELECT creator_auth_password, creator_auth_enabled 
  INTO v_password, v_enabled
  FROM profiles 
  WHERE auth_id = p_user_id 
     OR (role = 'creator' AND auth_id IS NULL);
     
  RETURN jsonb_build_object(
    'has_password', v_password IS NOT NULL,
    'enabled', COALESCE(v_enabled, FALSE)
  );
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.set_creator_auth TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_creator_auth TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_creator_auth_status TO authenticated;

-- ═══════════════════════════════════════════════════════════
-- PART 2: SETTINGS SYSTEM
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Settings readable by all" ON platform_settings;
CREATE POLICY "Settings readable by all" ON platform_settings
  FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "Settings updatable by authenticated" ON platform_settings;
CREATE POLICY "Settings updatable by authenticated" ON platform_settings
  FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);

-- Settings RPC functions
DROP FUNCTION IF EXISTS public.get_platform_settings();
DROP FUNCTION IF EXISTS public.get_platform_setting(TEXT);
DROP FUNCTION IF EXISTS public.update_platform_setting(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.get_platform_settings()
RETURNS TABLE(key TEXT, value TEXT, updated_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY SELECT ps.key, ps.value, ps.updated_at FROM platform_settings ps;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_platform_setting(p_key TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_value TEXT;
BEGIN
  SELECT ps.value INTO v_value FROM platform_settings ps WHERE ps.key = p_key;
  RETURN v_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_platform_setting(p_key TEXT, p_value TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO platform_settings (key, value, updated_at)
  VALUES (p_key, p_value, NOW())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
  RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_platform_settings TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_platform_setting TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_platform_setting TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_platform_settings TO anon;
GRANT EXECUTE ON FUNCTION public.get_platform_setting TO anon;

-- Seed ALL default settings
INSERT INTO platform_settings (key, value) VALUES
  -- Company
  ('company_name', 'WeHouse Nigeria'),
  ('company_short_name', 'WeHouse'),
  ('company_slogan', 'Find Your Perfect Home'),
  ('company_email', 'support@wehouse.ng'),
  ('company_phone', ''),
  ('company_address', ''),
  ('company_whatsapp', ''),
  ('company_website', 'https://wehouse.ng'),
  ('company_cac', ''),
  -- Legal
  ('privacy_policy', ''),
  ('terms_of_service', ''),
  ('refund_policy', ''),
  ('cookie_notice', 'We use cookies to improve your experience on WeHouse.'),
  ('minimum_age', '18'),
  -- Financial
  ('commission_rate_worker', '10'),
  ('commission_rate_partner', '8'),
  ('commission_rate_hotel', '12'),
  ('minimum_withdrawal', '1000'),
  ('withdrawal_fee', '50'),
  ('inspection_fee', '3000'),
  ('blue_badge_price', '5000'),
  ('currency_symbol', 'N'),
  -- Payment
  ('paystack_public_key', ''),
  ('payment_test_mode', 'true'),
  ('auto_payout', 'false'),
  -- Property
  ('listing_approval', 'manual'),
  ('max_listings_partner', '50'),
  ('min_photos', '3'),
  ('max_photos', '20'),
  -- Workers
  ('worker_approval', 'manual'),
  ('worker_video_required', 'true'),
  ('max_skills_worker', '5'),
  -- Features
  ('feature_hotels', 'true'),
  ('feature_workers', 'true'),
  ('feature_roommate', 'true'),
  ('feature_negotiation', 'true'),
  ('maintenance_mode', 'false'),
  ('registration_open', 'true')
ON CONFLICT (key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════
-- PART 3: WORKER STATUS FLOW
-- ═══════════════════════════════════════════════════════════

-- Drop old constraint, add new one with profile_under_review
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_worker_status_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_worker_status_check 
  CHECK (worker_status IN ('pending', 'approved_for_verification', 'profile_under_review', 'verified', 'suspended', 'rejected'));

-- Ensure worker_verified column exists
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS worker_verified BOOLEAN DEFAULT FALSE;

-- ═══════════════════════════════════════════════════════════
-- VERIFICATION: Test that pgcrypto works
-- ═══════════════════════════════════════════════════════════
-- Run this test query separately to confirm:
-- SELECT crypt('test_password', gen_salt('bf')) AS test_hash;
-- If it returns a hash starting with $2a$, pgcrypto is working.
