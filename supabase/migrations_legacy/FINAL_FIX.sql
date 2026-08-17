-- ═══════════════════════════════════════════════════════════════
-- FINAL FIX: Dynamically drop ALL function versions, then create v2
-- This uses a DO block to bypass the "not unique" error
-- ═══════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════
-- PART 1: KILL ALL EXISTING FUNCTIONS (dynamic drop)
-- ═══════════════════════════════════════════════════════════

DO $$
DECLARE
  r RECORD;
BEGIN
  -- Drop ALL versions of get_platform_settings
  FOR r IN SELECT oid::regprocedure AS sig FROM pg_proc WHERE proname = 'get_platform_settings' LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;

  -- Drop ALL versions of get_platform_setting
  FOR r IN SELECT oid::regprocedure AS sig FROM pg_proc WHERE proname = 'get_platform_setting' LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;

  -- Drop ALL versions of update_platform_setting
  FOR r IN SELECT oid::regprocedure AS sig FROM pg_proc WHERE proname = 'update_platform_setting' LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;

  -- Drop ALL versions of set_creator_auth
  FOR r IN SELECT oid::regprocedure AS sig FROM pg_proc WHERE proname = 'set_creator_auth' LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;

  -- Drop ALL versions of verify_creator_auth
  FOR r IN SELECT oid::regprocedure AS sig FROM pg_proc WHERE proname = 'verify_creator_auth' LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;

  -- Drop ALL versions of get_creator_auth_status
  FOR r IN SELECT oid::regprocedure AS sig FROM pg_proc WHERE proname = 'get_creator_auth_status' LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════
-- PART 2: ENABLE pgcrypto
-- ═══════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ═══════════════════════════════════════════════════════════
-- PART 3: Ensure password columns exist
-- ═══════════════════════════════════════════════════════════

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS creator_auth_password TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS creator_auth_enabled BOOLEAN DEFAULT FALSE;

-- ═══════════════════════════════════════════════════════════
-- PART 4: Create Creator Auth functions (v2 names)
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_creator_auth_v2(p_user_id TEXT, p_password TEXT)
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
  WHERE auth_id = p_user_id OR (role = 'creator' AND auth_id IS NULL);
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_creator_auth_v2(p_user_id TEXT, p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_hash TEXT; v_found BOOLEAN := FALSE;
BEGIN
  SELECT creator_auth_password INTO v_hash FROM profiles 
  WHERE auth_id = p_user_id OR (role = 'creator' AND auth_id IS NULL);
  IF v_hash IS NULL THEN RETURN FALSE; END IF;
  v_found := (v_hash = crypt(p_password, v_hash));
  IF v_found THEN
    UPDATE profiles SET auth_id = COALESCE(auth_id, p_user_id) WHERE role = 'creator';
  END IF;
  RETURN v_found;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_creator_auth_status_v2(p_user_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_password TEXT; v_enabled BOOLEAN;
BEGIN
  SELECT creator_auth_password, creator_auth_enabled INTO v_password, v_enabled
  FROM profiles WHERE auth_id = p_user_id OR (role = 'creator' AND auth_id IS NULL);
  RETURN jsonb_build_object('has_password', v_password IS NOT NULL, 'enabled', COALESCE(v_enabled, FALSE));
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_creator_auth_v2 TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_creator_auth_v2 TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_creator_auth_status_v2 TO authenticated;

-- ═══════════════════════════════════════════════════════════
-- PART 5: Settings table (ensure exists)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS platform_settings (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'general',
  label TEXT NOT NULL DEFAULT '',
  description TEXT DEFAULT '',
  data_type TEXT NOT NULL DEFAULT 'text',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "settings_read" ON platform_settings;
CREATE POLICY "settings_read" ON platform_settings FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS "settings_write" ON platform_settings;
CREATE POLICY "settings_write" ON platform_settings FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);

-- ═══════════════════════════════════════════════════════════
-- PART 6: Create Settings functions (v2 names)
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_all_settings_v2()
RETURNS TABLE(
  id INTEGER, key TEXT, value TEXT, category TEXT,
  label TEXT, description TEXT, data_type TEXT,
  is_active BOOLEAN, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT ps.id, ps.key, ps.value, ps.category, ps.label, ps.description, ps.data_type, ps.is_active, ps.created_at, ps.updated_at
  FROM platform_settings ps
  WHERE ps.is_active = TRUE
  ORDER BY ps.category, ps.label;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_setting_v2(p_key TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_value TEXT;
BEGIN
  SELECT ps.value INTO v_value FROM platform_settings ps WHERE ps.key = p_key;
  RETURN v_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_setting_v2(p_key TEXT, p_value TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO platform_settings (key, value, updated_at)
  VALUES (p_key, p_value, NOW())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
  RETURN TRUE;
EXCEPTION WHEN OTHERS THEN RETURN FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_all_settings_v2 TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_all_settings_v2 TO anon;
GRANT EXECUTE ON FUNCTION public.get_setting_v2 TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_setting_v2 TO anon;
GRANT EXECUTE ON FUNCTION public.set_setting_v2 TO authenticated;

-- ═══════════════════════════════════════════════════════════
-- PART 7: Seed ALL settings
-- ═══════════════════════════════════════════════════════════

DELETE FROM platform_settings WHERE category IS NULL OR key IS NULL;

INSERT INTO platform_settings (key, value, category, label, description, data_type, is_active) VALUES
  -- COMPANY
  ('company_name', 'WeHouse Nigeria', 'company', 'Company Name', 'Legal company name displayed across the platform', 'text', true),
  ('company_short_name', 'WeHouse', 'company', 'Short Name', 'Short display name', 'text', true),
  ('company_slogan', 'Find Your Perfect Home', 'company', 'Slogan', 'Brand slogan/tagline', 'text', true),
  ('company_email', 'support@wehouse.ng', 'company', 'Support Email', 'Primary support email address', 'email', true),
  ('company_phone', '', 'company', 'Support Phone', 'Customer support phone number', 'text', true),
  ('company_address', '', 'company', 'Office Address', 'Physical office address', 'textarea', true),
  ('company_whatsapp', '', 'company', 'WhatsApp Number', 'WhatsApp business number', 'text', true),
  ('company_website', 'https://wehouse.ng', 'company', 'Website URL', 'Official website URL', 'url', true),
  ('company_cac', '', 'company', 'CAC Number', 'Corporate Affairs Commission number', 'text', true),
  -- LEGAL
  ('privacy_policy', '', 'legal', 'Privacy Policy', 'Full privacy policy text shown to all users', 'textarea', true),
  ('terms_of_service', '', 'legal', 'Terms of Service', 'Full terms of service text shown to all users', 'textarea', true),
  ('refund_policy', '', 'legal', 'Refund Policy', 'Refund policy text shown to users', 'textarea', true),
  ('cookie_notice', 'We use cookies to improve your experience on WeHouse.', 'legal', 'Cookie Notice', 'Cookie consent banner text', 'textarea', true),
  ('minimum_age', '18', 'legal', 'Minimum Age', 'Minimum age requirement for users', 'number', true),
  -- FINANCIAL
  ('commission_rate_worker', '10', 'finance', 'Worker Commission (%)', 'Percentage WeHouse takes from worker bookings', 'number', true),
  ('commission_rate_partner', '8', 'finance', 'Partner Commission (%)', 'Percentage from property partner earnings', 'number', true),
  ('commission_rate_hotel', '12', 'finance', 'Hotel Commission (%)', 'Percentage from hotel bookings', 'number', true),
  ('minimum_withdrawal', '1000', 'finance', 'Min Withdrawal (N)', 'Minimum amount for withdrawal', 'number', true),
  ('withdrawal_fee', '50', 'finance', 'Withdrawal Fee (N)', 'Flat fee per withdrawal', 'number', true),
  ('inspection_fee', '3000', 'finance', 'Inspection Fee (N)', 'Fee for property inspection', 'number', true),
  ('blue_badge_price', '5000', 'finance', 'Blue Badge Price (N)', 'Monthly cost for worker blue badge', 'number', true),
  ('currency_symbol', 'N', 'finance', 'Currency Symbol', 'Displayed currency symbol', 'text', true),
  -- PAYMENT
  ('paystack_public_key', '', 'payment', 'Paystack Public Key', 'Paystack public API key for payments', 'text', true),
  ('payment_test_mode', 'true', 'payment', 'Test Mode', 'Enable test/sandbox mode', 'toggle', true),
  ('auto_payout', 'false', 'payment', 'Auto Payout', 'Automatically process payouts', 'toggle', true),
  -- PROPERTY
  ('listing_approval', 'manual', 'property', 'Listing Approval', 'manual or auto approval of new listings', 'text', true),
  ('max_listings_partner', '50', 'property', 'Max Listings Per Partner', 'Maximum properties a partner can list', 'number', true),
  ('min_photos', '3', 'property', 'Min Photos Required', 'Minimum photos per listing', 'number', true),
  ('max_photos', '20', 'property', 'Max Photos Allowed', 'Maximum photos per listing', 'number', true),
  -- WORKERS
  ('worker_approval', 'manual', 'worker', 'Worker Approval', 'manual or auto approval', 'text', true),
  ('worker_video_required', 'true', 'worker', 'Video Intro Required', 'Require workers to submit a video', 'toggle', true),
  ('max_skills_worker', '5', 'worker', 'Max Skills Per Worker', 'Maximum services a worker can offer', 'number', true),
  -- FEATURES
  ('feature_hotels', 'true', 'features', 'Hotels Module', 'Enable hotel bookings', 'toggle', true),
  ('feature_workers', 'true', 'features', 'Workers Module', 'Enable worker services', 'toggle', true),
  ('feature_roommate', 'true', 'features', 'Roommate Matching', 'Enable roommate matching', 'toggle', true),
  ('feature_negotiation', 'true', 'features', 'Price Negotiation', 'Allow price negotiation', 'toggle', true),
  ('maintenance_mode', 'false', 'features', 'Maintenance Mode', 'Put site in maintenance mode', 'toggle', true),
  ('registration_open', 'true', 'features', 'Open Registration', 'Allow new signups', 'toggle', true)
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  category = EXCLUDED.category,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  data_type = EXCLUDED.data_type,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

-- ═══════════════════════════════════════════════════════════
-- PART 8: Fix worker status constraint
-- ═══════════════════════════════════════════════════════════

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_worker_status_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_worker_status_check 
  CHECK (worker_status IN ('pending', 'approved_for_verification', 'profile_under_review', 'verified', 'suspended', 'rejected'));
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS worker_verified BOOLEAN DEFAULT FALSE;
