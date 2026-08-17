-- ═══════════════════════════════════════════════════════════════
-- SETTINGS SYSTEM — Complete setup
-- Creates table + RPC functions so Creator can edit ALL settings from dashboard
-- ═══════════════════════════════════════════════════════════════

-- Step 1: Create the settings table
CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 2: Enable RLS
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

-- Step 3: Anyone can read settings, only authenticated can update
CREATE POLICY IF NOT EXISTS "Settings readable by all" ON platform_settings
  FOR SELECT USING (true);

CREATE POLICY IF NOT EXISTS "Settings updatable by authenticated" ON platform_settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Step 4: Create get_platform_settings — returns all settings
CREATE OR REPLACE FUNCTION public.get_platform_settings()
RETURNS TABLE(key TEXT, value TEXT, updated_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY SELECT ps.key, ps.value, ps.updated_at FROM platform_settings ps;
END;
$$;

-- Step 5: Create get_platform_setting — returns one setting
CREATE OR REPLACE FUNCTION public.get_platform_setting(p_key TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_value TEXT;
BEGIN
  SELECT ps.value INTO v_value FROM platform_settings ps WHERE ps.key = p_key;
  RETURN v_value;
END;
$$;

-- Step 6: Create update_platform_setting — inserts or updates
CREATE OR REPLACE FUNCTION public.update_platform_setting(p_key TEXT, p_value TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO platform_settings (key, value, updated_at)
  VALUES (p_key, p_value, NOW())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

-- Step 7: Grant execute permissions
GRANT EXECUTE ON FUNCTION public.get_platform_settings TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_platform_setting TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_platform_setting TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_platform_settings TO anon;
GRANT EXECUTE ON FUNCTION public.get_platform_setting TO anon;

-- Step 8: Seed default settings so everything works immediately
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
