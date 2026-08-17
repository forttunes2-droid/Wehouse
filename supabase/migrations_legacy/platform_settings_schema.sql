-- ═══════════════════════════════════════════════════════════════
-- PLATFORM SETTINGS — COMPREHENSIVE SCHEMA
-- Every setting is stored here. NO hardcoded values in code.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS platform_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value TEXT,
  label TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  data_type TEXT DEFAULT 'text' CHECK (data_type IN ('text', 'number', 'boolean', 'percentage', 'textarea', 'color', 'email', 'url')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_platform_settings_category ON platform_settings(category);
CREATE INDEX IF NOT EXISTS idx_platform_settings_key ON platform_settings(key);

-- ═══════════════════════════════════════════════════════════════
-- DEFAULT VALUES — Insert all settings with sensible defaults
-- ═══════════════════════════════════════════════════════════════

-- COMPANY INFORMATION
INSERT INTO platform_settings (key, value, label, description, category, data_type) VALUES
('company_name', 'WeHouse', 'Company Name', 'Platform display name', 'company', 'text'),
('company_email', 'info@wehouse.com.ng', 'Company Email', 'Official company email', 'company', 'email'),
('support_email', 'support@wehouse.com.ng', 'Support Email', 'Customer support email', 'company', 'email'),
('support_phone', '', 'Support Phone', 'Customer support phone', 'company', 'text'),
('whatsapp_number', '', 'WhatsApp Number', 'Support WhatsApp line', 'company', 'text'),
('telegram_link', '', 'Telegram Link', 'Support Telegram handle/link', 'company', 'url'),
('facebook_url', '', 'Facebook', 'Facebook page URL', 'company', 'url'),
('instagram_url', '', 'Instagram', 'Instagram page URL', 'company', 'url'),
('twitter_url', '', 'X (Twitter)', 'X/Twitter page URL', 'company', 'url'),
('tiktok_url', '', 'TikTok', 'TikTok page URL', 'company', 'url'),
('office_address', '', 'Office Address', 'Physical office address', 'company', 'textarea'),
('website_url', 'https://wehouse.com.ng', 'Website URL', 'Main website URL', 'company', 'url')
ON CONFLICT (key) DO NOTHING;

-- FINANCIAL SETTINGS
INSERT INTO platform_settings (key, value, label, description, category, data_type) VALUES
('worker_commission_rate', '10', 'Worker Commission (%)', 'Percentage WeHouse takes from worker bookings', 'finance', 'percentage'),
('property_commission_rate', '7', 'Property Commission (%)', 'Percentage WeHouse takes from property listings', 'finance', 'percentage'),
('hotel_commission_rate', '8', 'Hotel Commission (%)', 'Percentage WeHouse takes from hotel bookings', 'finance', 'percentage'),
('booking_fee_amount', '500', 'Booking Fee (N)', 'Fixed fee charged per booking', 'finance', 'number'),
('booking_fee_type', 'fixed', 'Booking Fee Type', 'fixed or percentage', 'finance', 'text'),
('inspection_fee_enabled', 'false', 'Inspection Fee Enabled', 'Charge fee for property inspections', 'finance', 'boolean'),
('inspection_fee_amount', '5000', 'Inspection Fee (N)', 'Amount charged for inspections', 'finance', 'number'),
('security_deposit_default', '0', 'Default Security Deposit (N)', 'Standard caution fee amount', 'finance', 'number'),
('security_deposit_refund_days', '7', 'Security Deposit Refund (days)', 'Days to refund security deposit', 'finance', 'number'),
('min_withdrawal', '5000', 'Minimum Withdrawal (N)', 'Lowest amount workers can withdraw', 'finance', 'number'),
('max_withdrawal', '500000', 'Maximum Withdrawal (N)', 'Highest amount per withdrawal', 'finance', 'number'),
('withdrawal_fee', '0', 'Withdrawal Fee (N)', 'Fee charged per withdrawal', 'finance', 'number'),
('auto_withdrawal_enabled', 'false', 'Automatic Withdrawals', 'Enable automatic withdrawal processing', 'finance', 'boolean'),
('escrow_auto_release_days', '7', 'Escrow Auto Release (days)', 'Days before escrow auto-releases', 'finance', 'number'),
('escrow_dispute_hold', 'true', 'Hold During Disputes', 'Hold escrow when dispute is raised', 'finance', 'boolean'),
('dispute_time_limit_days', '14', 'Dispute Time Limit (days)', 'Max days to resolve a dispute', 'finance', 'number')
ON CONFLICT (key) DO NOTHING;

-- PAYMENT GATEWAY
INSERT INTO platform_settings (key, value, label, description, category, data_type) VALUES
('paystack_public_key', '', 'Paystack Public Key', 'Paystack public key', 'payment', 'text'),
('paystack_secret_key', '', 'Paystack Secret Key', 'Paystack secret key (encrypted)', 'payment', 'text'),
('paystack_webhook_url', '', 'Webhook URL', 'Paystack webhook endpoint', 'payment', 'url'),
('paystack_test_mode', 'true', 'Test Mode', 'Use Paystack test environment', 'payment', 'boolean')
ON CONFLICT (key) DO NOTHING;

-- PROPERTY SETTINGS
INSERT INTO platform_settings (key, value, label, description, category, data_type) VALUES
('enable_property_partners', 'true', 'Enable Property Partners', 'Allow property partner registrations', 'property', 'boolean'),
('enable_hotels', 'true', 'Enable Hotels', 'Allow hotel listings', 'property', 'boolean'),
('enable_apartments', 'true', 'Enable Apartments', 'Allow apartment listings', 'property', 'boolean'),
('enable_houses', 'true', 'Enable Houses', 'Allow house listings', 'property', 'boolean'),
('enable_hostels', 'true', 'Enable Hostels', 'Allow hostel listings', 'property', 'boolean'),
('enable_short_let', 'true', 'Enable Short Lets', 'Allow short stay listings', 'property', 'boolean'),
('enable_long_stay', 'true', 'Enable Long Stay', 'Allow long stay listings', 'property', 'boolean'),
('property_approval_required', 'true', 'Property Approval Required', 'Creator/Admin must approve listings', 'property', 'boolean')
ON CONFLICT (key) DO NOTHING;

-- WORKER SETTINGS
INSERT INTO platform_settings (key, value, label, description, category, data_type) VALUES
('enable_worker_registration', 'true', 'Enable Worker Registration', 'Allow workers to sign up', 'worker', 'boolean'),
('enable_blue_badge', 'true', 'Enable Blue Badge', 'Allow verified worker badges', 'worker', 'boolean'),
('blue_badge_price', '5000', 'Blue Badge Price (N)', 'Fee for blue badge verification', 'worker', 'number'),
('worker_verification_required', 'true', 'Verification Required', 'Workers must submit ID for verification', 'worker', 'boolean'),
('worker_video_required', 'true', 'Video Verification Required', 'Workers must submit skill video', 'worker', 'boolean')
ON CONFLICT (key) DO NOTHING;

-- BOOKING SETTINGS
INSERT INTO platform_settings (key, value, label, description, category, data_type) VALUES
('booking_cancellation_hours', '24', 'Cancellation Window (hours)', 'Hours before booking when cancellation is allowed', 'booking', 'number'),
('auto_cancel_unpaid_hours', '48', 'Auto Cancel Unpaid (hours)', 'Hours before unpaid booking is auto-cancelled', 'booking', 'number'),
('booking_expiry_hours', '72', 'Booking Expiry (hours)', 'Hours before booking request expires', 'booking', 'number'),
('refund_processing_days', '7', 'Refund Processing (days)', 'Days to process refunds', 'booking', 'number')
ON CONFLICT (key) DO NOTHING;

-- SUPPORT SETTINGS
INSERT INTO platform_settings (key, value, label, description, category, data_type) VALUES
('support_office_hours', 'Mon-Fri 9AM-5PM', 'Office Hours', 'Support operating hours', 'support', 'text'),
('support_emergency_contact', '', 'Emergency Contact', 'Emergency phone number', 'support', 'text')
ON CONFLICT (key) DO NOTHING;

-- NOTIFICATION SETTINGS
INSERT INTO platform_settings (key, value, label, description, category, data_type) VALUES
('enable_email_notifications', 'true', 'Email Notifications', 'Send email notifications to users', 'notification', 'boolean'),
('enable_sms_notifications', 'false', 'SMS Notifications', 'Send SMS notifications', 'notification', 'boolean'),
('enable_push_notifications', 'true', 'Push Notifications', 'Send push notifications', 'notification', 'boolean')
ON CONFLICT (key) DO NOTHING;

-- LEGAL
INSERT INTO platform_settings (key, value, label, description, category, data_type) VALUES
('privacy_policy', '', 'Privacy Policy', 'Full privacy policy text', 'legal', 'textarea'),
('terms_conditions', '', 'Terms & Conditions', 'Full terms and conditions', 'legal', 'textarea'),
('refund_policy', '', 'Refund Policy', 'Refund policy text', 'legal', 'textarea'),
('worker_agreement', '', 'Worker Agreement', 'Worker terms of service', 'legal', 'textarea'),
('partner_agreement', '', 'Property Partner Agreement', 'Property partner terms', 'legal', 'textarea')
ON CONFLICT (key) DO NOTHING;

-- FEATURE TOGGLES
INSERT INTO platform_settings (key, value, label, description, category, data_type) VALUES
('feature_maintenance_mode', 'false', 'Maintenance Mode', 'Block all non-creator access', 'toggle', 'boolean'),
('feature_open_registration', 'true', 'Open Registration', 'Allow new user signups', 'toggle', 'boolean'),
('max_listings_per_user', '5', 'Max Listings Per User', 'Maximum listings one user can create', 'toggle', 'number')
ON CONFLICT (key) DO NOTHING;

-- APPEARANCE
INSERT INTO platform_settings (key, value, label, description, category, data_type) VALUES
('primary_color', '#3B82F6', 'Primary Color', 'Main brand color', 'appearance', 'color'),
('secondary_color', '#8B5CF6', 'Secondary Color', 'Accent color', 'appearance', 'color'),
('dark_mode_default', 'true', 'Dark Mode Default', 'Use dark mode by default', 'appearance', 'boolean')
ON CONFLICT (key) DO NOTHING;

-- SECURITY
INSERT INTO platform_settings (key, value, label, description, category, data_type) VALUES
('enable_google_login', 'true', 'Google Login', 'Allow Google authentication', 'security', 'boolean'),
('enable_email_login', 'true', 'Email Login', 'Allow email/password authentication', 'security', 'boolean'),
('require_email_verification', 'false', 'Require Email Verification', 'Users must verify email', 'security', 'boolean'),
('require_phone_verification', 'false', 'Require Phone Verification', 'Users must verify phone', 'security', 'boolean'),
('enable_2fa', 'false', 'Two-Factor Authentication', 'Require 2FA for sensitive actions', 'security', 'boolean')
ON CONFLICT (key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- RPC FUNCTIONS FOR SETTINGS
-- ═══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.get_platform_settings(TEXT);
CREATE OR REPLACE FUNCTION public.get_platform_settings(p_category TEXT DEFAULT NULL)
RETURNS TABLE(id UUID, key TEXT, value TEXT, label TEXT, description TEXT, category TEXT, data_type TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, key, value, label, description, category, data_type
  FROM platform_settings
  WHERE (p_category IS NULL OR category = p_category)
  ORDER BY category, label;
$$;

DROP FUNCTION IF EXISTS public.get_platform_setting(TEXT);
CREATE OR REPLACE FUNCTION public.get_platform_setting(p_key TEXT)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT value FROM platform_settings WHERE key = p_key LIMIT 1;
$$;

DROP FUNCTION IF EXISTS public.update_platform_setting(TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.update_platform_setting(p_key TEXT, p_value TEXT, p_updated_by TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO platform_settings (key, value, updated_by, updated_at)
  VALUES (p_key, p_value, p_updated_by, NOW())
  ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    updated_by = EXCLUDED.updated_by,
    updated_at = NOW();
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- DONE
-- ═══════════════════════════════════════════════════════════════
