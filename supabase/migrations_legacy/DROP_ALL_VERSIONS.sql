-- ═══════════════════════════════════════════════════════════════
-- STEP 1: DROP ALL FUNCTION VERSIONS (with explicit signatures)
-- This handles the "function name is not unique" error
-- ═══════════════════════════════════════════════════════════════

-- Drop all get_platform_settings variants
DROP FUNCTION IF EXISTS public.get_platform_settings();
DROP FUNCTION IF EXISTS public.get_platform_settings(text);
DROP FUNCTION IF EXISTS public.get_platform_settings(TEXT);
DROP FUNCTION IF EXISTS public.get_platform_settings(OUT key TEXT, OUT value TEXT, OUT updated_at TIMESTAMPTZ);

-- Drop all get_platform_setting variants
DROP FUNCTION IF EXISTS public.get_platform_setting(TEXT);
DROP FUNCTION IF EXISTS public.get_platform_setting(text);
DROP FUNCTION IF EXISTS public.get_platform_setting(p_key TEXT);

-- Drop all update_platform_setting variants
DROP FUNCTION IF EXISTS public.update_platform_setting(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.update_platform_setting(text, text);
DROP FUNCTION IF EXISTS public.update_platform_setting(p_key TEXT, p_value TEXT);

-- Drop all set_creator_auth variants
DROP FUNCTION IF EXISTS public.set_creator_auth(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.set_creator_auth(text, text);
DROP FUNCTION IF EXISTS public.set_creator_auth(p_user_id TEXT, p_password TEXT);

-- Drop all verify_creator_auth variants
DROP FUNCTION IF EXISTS public.verify_creator_auth(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.verify_creator_auth(text, text);
DROP FUNCTION IF EXISTS public.verify_creator_auth(p_user_id TEXT, p_password TEXT);

-- Drop all get_creator_auth_status variants
DROP FUNCTION IF EXISTS public.get_creator_auth_status(TEXT);
DROP FUNCTION IF EXISTS public.get_creator_auth_status(text);
DROP FUNCTION IF EXISTS public.get_creator_auth_status(p_user_id TEXT);

-- ═══════════════════════════════════════════════════════════
-- STEP 2: ENABLE pgcrypto
-- ═══════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ═══════════════════════════════════════════════════════════
-- STEP 3: Ensure password columns exist
-- ═══════════════════════════════════════════════════════════

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS creator_auth_password TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS creator_auth_enabled BOOLEAN DEFAULT FALSE;

-- ═══════════════════════════════════════════════════════════
-- STEP 4: Create Creator Auth functions
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_creator_auth(p_user_id TEXT, p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_salt TEXT;
BEGIN
  IF p_password IS NULL OR length(p_password) < 4 THEN 
    RETURN FALSE; 
  END IF;
  
  v_salt := gen_salt('bf');
  
  UPDATE profiles 
  SET creator_auth_password = crypt(p_password, v_salt),
      creator_auth_enabled = TRUE,
      auth_id = COALESCE(auth_id, p_user_id)
  WHERE auth_id = p_user_id 
     OR (role = 'creator' AND auth_id IS NULL);
     
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_creator_auth(p_user_id TEXT, p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE 
  v_hash TEXT;
  v_found BOOLEAN := FALSE;
BEGIN
  SELECT creator_auth_password INTO v_hash 
  FROM profiles 
  WHERE auth_id = p_user_id 
     OR (role = 'creator' AND auth_id IS NULL);
     
  IF v_hash IS NULL THEN 
    RETURN FALSE; 
  END IF;
  
  v_found := (v_hash = crypt(p_password, v_hash));
  
  IF v_found THEN
    UPDATE profiles 
    SET auth_id = COALESCE(auth_id, p_user_id)
    WHERE role = 'creator';
  END IF;
  
  RETURN v_found;
END;
$$;

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

GRANT EXECUTE ON FUNCTION public.set_creator_auth TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_creator_auth TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_creator_auth_status TO authenticated;

-- ═══════════════════════════════════════════════════════════
-- STEP 5: Create Settings table + functions
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Settings readable by all" ON platform_settings;
CREATE POLICY "Settings readable by all" ON platform_settings FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "Settings updatable by authenticated" ON platform_settings;
CREATE POLICY "Settings updatable by authenticated" ON platform_settings FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);

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
DECLARE
  v_value TEXT;
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

-- ═══════════════════════════════════════════════════════════
-- STEP 6: Seed ALL default settings
-- ═══════════════════════════════════════════════════════════

INSERT INTO platform_settings (key, value) VALUES
  ('company_name', 'WeHouse Nigeria'),
  ('company_short_name', 'WeHouse'),
  ('company_slogan', 'Find Your Perfect Home'),
  ('company_email', 'support@wehouse.ng'),
  ('company_phone', ''),
  ('company_address', ''),
  ('company_whatsapp', ''),
  ('company_website', 'https://wehouse.ng'),
  ('company_cac', ''),
  ('privacy_policy', ''),
  ('terms_of_service', ''),
  ('refund_policy', ''),
  ('cookie_notice', 'We use cookies to improve your experience on WeHouse.'),
  ('minimum_age', '18'),
  ('commission_rate_worker', '10'),
  ('commission_rate_partner', '8'),
  ('commission_rate_hotel', '12'),
  ('minimum_withdrawal', '1000'),
  ('withdrawal_fee', '50'),
  ('inspection_fee', '3000'),
  ('blue_badge_price', '5000'),
  ('currency_symbol', 'N'),
  ('paystack_public_key', ''),
  ('payment_test_mode', 'true'),
  ('auto_payout', 'false'),
  ('listing_approval', 'manual'),
  ('max_listings_partner', '50'),
  ('min_photos', '3'),
  ('max_photos', '20'),
  ('worker_approval', 'manual'),
  ('worker_video_required', 'true'),
  ('max_skills_worker', '5'),
  ('feature_hotels', 'true'),
  ('feature_workers', 'true'),
  ('feature_roommate', 'true'),
  ('feature_negotiation', 'true'),
  ('maintenance_mode', 'false'),
  ('registration_open', 'true')
ON CONFLICT (key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════
-- STEP 7: Fix worker status constraint
-- ═══════════════════════════════════════════════════════════

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_worker_status_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_worker_status_check 
  CHECK (worker_status IN ('pending', 'approved_for_verification', 'profile_under_review', 'verified', 'suspended', 'rejected'));

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS worker_verified BOOLEAN DEFAULT FALSE;
