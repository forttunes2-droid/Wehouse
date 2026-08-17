-- ═══════════════════════════════════════════════════════════════
-- FIX: platform_settings already exists with NOT NULL columns
-- We need to include category, label, description, data_type, is_active
-- ═══════════════════════════════════════════════════════════════

-- First, see what columns exist (this is a comment for you)
-- The existing table has: id, key, value, category, label, description, data_type, is_active, created_at, updated_at
-- category is NOT NULL, so we MUST provide it

-- Clear old partial inserts (they may have NULL category)
DELETE FROM platform_settings WHERE category IS NULL;

-- Upsert ALL settings with complete columns
INSERT INTO platform_settings (key, value, category, label, description, data_type, is_active, created_at, updated_at) VALUES
  -- COMPANY
  ('company_name', 'WeHouse Nigeria', 'company', 'Company Name', 'Legal company name displayed across the platform', 'string', true, NOW(), NOW()),
  ('company_short_name', 'WeHouse', 'company', 'Short Name', 'Short display name', 'string', true, NOW(), NOW()),
  ('company_slogan', 'Find Your Perfect Home', 'company', 'Slogan', 'Brand slogan/tagline', 'string', true, NOW(), NOW()),
  ('company_email', 'support@wehouse.ng', 'company', 'Support Email', 'Primary support email address', 'email', true, NOW(), NOW()),
  ('company_phone', '', 'company', 'Support Phone', 'Customer support phone number', 'string', true, NOW(), NOW()),
  ('company_address', '', 'company', 'Office Address', 'Physical office address', 'textarea', true, NOW(), NOW()),
  ('company_whatsapp', '', 'company', 'WhatsApp Number', 'WhatsApp business number', 'string', true, NOW(), NOW()),
  ('company_website', 'https://wehouse.ng', 'company', 'Website URL', 'Official website URL', 'url', true, NOW(), NOW()),
  ('company_cac', '', 'company', 'CAC Number', 'Corporate Affairs Commission number', 'string', true, NOW(), NOW()),

  -- LEGAL
  ('privacy_policy', '', 'legal', 'Privacy Policy', 'Full privacy policy text shown to all users', 'textarea', true, NOW(), NOW()),
  ('terms_of_service', '', 'legal', 'Terms of Service', 'Full terms of service text shown to all users', 'textarea', true, NOW(), NOW()),
  ('refund_policy', '', 'legal', 'Refund Policy', 'Refund policy text shown to users', 'textarea', true, NOW(), NOW()),
  ('cookie_notice', 'We use cookies to improve your experience on WeHouse.', 'legal', 'Cookie Notice', 'Cookie consent banner text', 'textarea', true, NOW(), NOW()),
  ('minimum_age', '18', 'legal', 'Minimum Age', 'Minimum age requirement for users', 'number', true, NOW(), NOW()),

  -- FINANCIAL
  ('commission_rate_worker', '10', 'finance', 'Worker Commission (%)', 'Percentage WeHouse takes from worker bookings', 'number', true, NOW(), NOW()),
  ('commission_rate_partner', '8', 'finance', 'Partner Commission (%)', 'Percentage from property partner earnings', 'number', true, NOW(), NOW()),
  ('commission_rate_hotel', '12', 'finance', 'Hotel Commission (%)', 'Percentage from hotel bookings', 'number', true, NOW(), NOW()),
  ('minimum_withdrawal', '1000', 'finance', 'Min Withdrawal (N)', 'Minimum amount for withdrawal', 'number', true, NOW(), NOW()),
  ('withdrawal_fee', '50', 'finance', 'Withdrawal Fee (N)', 'Flat fee per withdrawal', 'number', true, NOW(), NOW()),
  ('inspection_fee', '3000', 'finance', 'Inspection Fee (N)', 'Fee for property inspection', 'number', true, NOW(), NOW()),
  ('blue_badge_price', '5000', 'finance', 'Blue Badge Price (N)', 'Monthly cost for worker blue badge', 'number', true, NOW(), NOW()),
  ('currency_symbol', 'N', 'finance', 'Currency Symbol', 'Displayed currency symbol', 'string', true, NOW(), NOW()),

  -- PAYMENT
  ('paystack_public_key', '', 'payment', 'Paystack Public Key', 'Paystack public API key for payments', 'string', true, NOW(), NOW()),
  ('payment_test_mode', 'true', 'payment', 'Test Mode', 'Enable test/sandbox mode', 'toggle', true, NOW(), NOW()),
  ('auto_payout', 'false', 'payment', 'Auto Payout', 'Automatically process payouts', 'toggle', true, NOW(), NOW()),

  -- PROPERTY
  ('listing_approval', 'manual', 'property', 'Listing Approval', 'manual or auto approval of new listings', 'string', true, NOW(), NOW()),
  ('max_listings_partner', '50', 'property', 'Max Listings Per Partner', 'Maximum properties a partner can list', 'number', true, NOW(), NOW()),
  ('min_photos', '3', 'property', 'Min Photos Required', 'Minimum photos per listing', 'number', true, NOW(), NOW()),
  ('max_photos', '20', 'property', 'Max Photos Allowed', 'Maximum photos per listing', 'number', true, NOW(), NOW()),

  -- WORKERS
  ('worker_approval', 'manual', 'worker', 'Worker Approval', 'manual or auto approval', 'string', true, NOW(), NOW()),
  ('worker_video_required', 'true', 'worker', 'Video Intro Required', 'Require workers to submit a video', 'toggle', true, NOW(), NOW()),
  ('max_skills_worker', '5', 'worker', 'Max Skills Per Worker', 'Maximum services a worker can offer', 'number', true, NOW(), NOW()),

  -- FEATURES
  ('feature_hotels', 'true', 'features', 'Hotels Module', 'Enable hotel bookings', 'toggle', true, NOW(), NOW()),
  ('feature_workers', 'true', 'features', 'Workers Module', 'Enable worker services', 'toggle', true, NOW(), NOW()),
  ('feature_roommate', 'true', 'features', 'Roommate Matching', 'Enable roommate matching', 'toggle', true, NOW(), NOW()),
  ('feature_negotiation', 'true', 'features', 'Price Negotiation', 'Allow price negotiation', 'toggle', true, NOW(), NOW()),
  ('maintenance_mode', 'false', 'features', 'Maintenance Mode', 'Put site in maintenance mode', 'toggle', true, NOW(), NOW()),
  ('registration_open', 'true', 'features', 'Open Registration', 'Allow new signups', 'toggle', true, NOW(), NOW())

ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  category = EXCLUDED.category,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  data_type = EXCLUDED.data_type,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();
