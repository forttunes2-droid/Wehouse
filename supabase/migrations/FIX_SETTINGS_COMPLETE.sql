-- ═══════════════════════════════════════════════════════════════
-- COMPLETE FIX: platform_settings with full schema
-- ═══════════════════════════════════════════════════════════════

-- STEP 1: Update get_platform_settings to return ALL columns
DROP FUNCTION IF EXISTS public.get_platform_settings();

CREATE OR REPLACE FUNCTION public.get_platform_settings()
RETURNS TABLE(
  id INTEGER,
  key TEXT,
  value TEXT,
  category TEXT,
  label TEXT,
  description TEXT,
  data_type TEXT,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
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

GRANT EXECUTE ON FUNCTION public.get_platform_settings TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_platform_settings TO anon;

-- STEP 2: Also update get_platform_setting to handle key lookups properly
DROP FUNCTION IF EXISTS public.get_platform_setting(TEXT);

CREATE OR REPLACE FUNCTION public.get_platform_setting(p_key TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_value TEXT;
BEGIN
  SELECT ps.value INTO v_value FROM platform_settings ps WHERE ps.key = p_key;
  RETURN v_value;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_platform_setting TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_platform_setting TO anon;

-- STEP 3: Ensure update_platform_setting exists
DROP FUNCTION IF EXISTS public.update_platform_setting(TEXT, TEXT);

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

GRANT EXECUTE ON FUNCTION public.update_platform_setting TO authenticated;

-- STEP 4: Seed ALL settings (with full columns)
DELETE FROM platform_settings WHERE category IS NULL;

INSERT INTO platform_settings (key, value, category, label, description, data_type, is_active) VALUES
  -- COMPANY
  ('company_name', 'WeHouse Nigeria', 'company', 'Company Name', 'Legal company name displayed across the platform', 'string', true),
  ('company_short_name', 'WeHouse', 'company', 'Short Name', 'Short display name', 'string', true),
  ('company_slogan', 'Find Your Perfect Home', 'company', 'Slogan', 'Brand slogan/tagline', 'string', true),
  ('company_email', 'support@wehouse.ng', 'company', 'Support Email', 'Primary support email address', 'email', true),
  ('company_phone', '', 'company', 'Support Phone', 'Customer support phone number', 'string', true),
  ('company_address', '', 'company', 'Office Address', 'Physical office address', 'textarea', true),
  ('company_whatsapp', '', 'company', 'WhatsApp Number', 'WhatsApp business number', 'string', true),
  ('company_website', 'https://wehouse.ng', 'company', 'Website URL', 'Official website URL', 'url', true),
  ('company_cac', '', 'company', 'CAC Number', 'Corporate Affairs Commission number', 'string', true),

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
  ('currency_symbol', 'N', 'finance', 'Currency Symbol', 'Displayed currency symbol', 'string', true),

  -- PAYMENT
  ('paystack_public_key', '', 'payment', 'Paystack Public Key', 'Paystack public API key for payments', 'string', true),
  ('payment_test_mode', 'true', 'payment', 'Test Mode', 'Enable test/sandbox mode', 'toggle', true),
  ('auto_payout', 'false', 'payment', 'Auto Payout', 'Automatically process payouts', 'toggle', true),

  -- PROPERTY
  ('listing_approval', 'manual', 'property', 'Listing Approval', 'manual or auto approval of new listings', 'string', true),
  ('max_listings_partner', '50', 'property', 'Max Listings Per Partner', 'Maximum properties a partner can list', 'number', true),
  ('min_photos', '3', 'property', 'Min Photos Required', 'Minimum photos per listing', 'number', true),
  ('max_photos', '20', 'property', 'Max Photos Allowed', 'Maximum photos per listing', 'number', true),

  -- WORKERS
  ('worker_approval', 'manual', 'worker', 'Worker Approval', 'manual or auto approval', 'string', true),
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
