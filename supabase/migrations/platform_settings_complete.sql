-- ═══════════════════════════════════════════════════════════════
-- PLATFORM SETTINGS — Complete configuration table
-- No hardcoded values anywhere in the app — everything editable
-- ═══════════════════════════════════════════════════════════════

-- Drop existing if recreating
DROP TABLE IF EXISTS platform_settings CASCADE;

CREATE TABLE platform_settings (
  id SERIAL PRIMARY KEY,
  key VARCHAR(255) UNIQUE NOT NULL,
  value TEXT,
  category VARCHAR(50) NOT NULL,
  label VARCHAR(255) NOT NULL,
  description TEXT,
  data_type VARCHAR(20) NOT NULL DEFAULT 'string',
  editable BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

-- Everyone can read settings
CREATE POLICY platform_settings_select ON platform_settings FOR SELECT USING (true);

-- Only creator/admin can modify (auth_id is TEXT, auth.uid() is UUID, cast needed)
CREATE POLICY platform_settings_modify ON platform_settings FOR ALL
  USING (EXISTS (
    SELECT 1 FROM profiles
    WHERE auth_id = auth.uid()::text
    AND role IN ('creator', 'admin')
    AND deleted_at IS NULL
  ));

-- ═══════════════════════════════════════════════════════════════
-- DEFAULT SETTINGS — 70+ configuration values
-- ═══════════════════════════════════════════════════════════════

-- COMPANY INFO
INSERT INTO platform_settings (key, value, category, label, description, data_type) VALUES
('company_name', 'WeHouse Nigeria', 'company', 'Company Name', 'Legal company name', 'string'),
('company_short_name', 'WeHouse', 'company', 'Short Name', 'Display name', 'string'),
('company_slogan', 'Find Your Perfect Home', 'company', 'Slogan', 'Brand slogan', 'string'),
('company_website', 'https://wehouse.ng', 'company', 'Website URL', 'Official website', 'string'),
('company_email', 'support@wehouse.ng', 'company', 'Support Email', 'Primary support email', 'string'),
('company_phone', '', 'company', 'Support Phone', 'Primary support phone', 'string'),
('company_address', '', 'company', 'Office Address', 'Physical office address', 'string'),
('company_cac_number', '', 'company', 'CAC Registration', 'Corporate Affairs Commission number', 'string'),
('company_logo_url', '', 'company', 'Logo URL', 'Company logo image URL', 'string'),
('company_favicon_url', '', 'company', 'Favicon URL', 'Browser favicon URL', 'string');

-- FINANCIAL SETTINGS
INSERT INTO platform_settings (key, value, category, label, description, data_type) VALUES
('commission_rate_worker', '10', 'finance', 'Worker Commission (%)', 'Percentage taken from worker bookings', 'number'),
('commission_rate_partner', '8', 'finance', 'Partner Commission (%)', 'Percentage taken from property partner earnings', 'number'),
('commission_rate_hotel', '12', 'finance', 'Hotel Commission (%)', 'Percentage taken from hotel bookings', 'number'),
('commission_rate_listing', '5', 'finance', 'Listing Commission (%)', 'Percentage taken from property listings', 'number'),
('booking_fee_fixed', '500', 'finance', 'Fixed Booking Fee (N)', 'Flat fee added to every booking', 'number'),
('booking_fee_percentage', '2', 'finance', 'Booking Fee (%)', 'Percentage fee on bookings', 'number'),
('escrow_hold_days', '3', 'finance', 'Escrow Hold (Days)', 'Days to hold payment in escrow before release', 'number'),
('minimum_withdrawal', '1000', 'finance', 'Minimum Withdrawal (N)', 'Minimum amount for withdrawal requests', 'number'),
('withdrawal_fee', '50', 'finance', 'Withdrawal Fee (N)', 'Flat fee per withdrawal', 'number'),
('withdrawal_processing_days', '1-3', 'finance', 'Withdrawal Processing', 'Business days to process withdrawals', 'string'),
('refund_policy_days', '7', 'finance', 'Refund Policy (Days)', 'Days within which refunds are allowed', 'number'),
('late_cancellation_fee', '1000', 'finance', 'Late Cancellation Fee (N)', 'Fee for late booking cancellations', 'number'),
('currency_symbol', 'N', 'finance', 'Currency Symbol', 'Displayed currency symbol', 'string'),
('currency_code', 'NGN', 'finance', 'Currency Code', 'ISO currency code', 'string');

-- PAYMENT GATEWAY
INSERT INTO platform_settings (key, value, category, label, description, data_type) VALUES
('paystack_enabled', 'true', 'payment', 'Paystack Enabled', 'Enable Paystack payments', 'boolean'),
('paystack_public_key', '', 'payment', 'Paystack Public Key', 'Paystack public API key', 'string'),
('paystack_secret_key', '', 'payment', 'Paystack Secret Key', 'Paystack secret API key (encrypted)', 'string'),
('flutterwave_enabled', 'false', 'payment', 'Flutterwave Enabled', 'Enable Flutterwave payments', 'boolean'),
('flutterwave_public_key', '', 'payment', 'Flutterwave Public Key', 'Flutterwave public API key', 'string'),
('flutterwave_secret_key', '', 'payment', 'Flutterwave Secret Key', 'Flutterwave secret API key (encrypted)', 'string'),
('payment_test_mode', 'true', 'payment', 'Test Mode', 'Use test/sandbox mode for payments', 'boolean'),
('auto_payout_enabled', 'false', 'payment', 'Auto Payout', 'Automatically process payouts', 'boolean');

-- PROPERTY SETTINGS
INSERT INTO platform_settings (key, value, category, label, description, data_type) VALUES
('property_verification_required', 'true', 'property', 'Verification Required', 'Require verification before listing properties', 'boolean'),
('property_inspection_required', 'true', 'property', 'Inspection Required', 'Require inspection before approving listings', 'boolean'),
('max_listings_per_partner', '50', 'property', 'Max Listings Per Partner', 'Maximum properties a partner can list', 'number'),
('listing_approval_mode', 'manual', 'property', 'Listing Approval', 'manual or auto approval of listings', 'string'),
('property_photos_min', '3', 'property', 'Min Photos Required', 'Minimum photos per listing', 'number'),
('property_photos_max', '20', 'property', 'Max Photos Allowed', 'Maximum photos per listing', 'number'),
('featured_listing_price', '5000', 'property', 'Featured Listing Price (N)', 'Cost to feature a listing', 'number'),
('property_types_allowed', '["apartment","house","duplex","studio","self_contain","office","warehouse","land"]', 'property', 'Allowed Property Types', 'JSON array of allowed property types', 'json');

-- WORKER SETTINGS
INSERT INTO platform_settings (key, value, category, label, description, data_type) VALUES
('worker_verification_required', 'true', 'worker', 'Verification Required', 'Workers must be verified before booking', 'boolean'),
('worker_id_verification_required', 'true', 'worker', 'ID Verification Required', 'Government ID required for workers', 'boolean'),
('worker_video_intro_required', 'false', 'worker', 'Video Intro Required', 'Require video introduction', 'boolean'),
('worker_approval_mode', 'manual', 'worker', 'Worker Approval', 'manual or auto approval of workers', 'string'),
('blue_badge_price', '5000', 'worker', 'Blue Badge Price (N)', 'Monthly cost for blue badge', 'number'),
('max_skills_per_worker', '5', 'worker', 'Max Skills', 'Maximum services a worker can offer', 'number'),
('worker_search_radius_default', '25', 'worker', 'Default Search Radius (km)', 'Default radius for worker search', 'number'),
('worker_categories', '["cleaning","plumbing","electrical","carpentry","painting","hvac","security","gardening","moving","appliance_repair"]', 'worker', 'Worker Categories', 'JSON array of service categories', 'json'),
('worker_status_flow', 'pending,approved,public', 'worker', 'Status Flow', 'Comma-separated worker status progression', 'string');

-- BOOKING SETTINGS
INSERT INTO platform_settings (key, value, category, label, description, data_type) VALUES
('booking_advance_hours', '24', 'booking', 'Min Advance Booking (hrs)', 'Minimum hours before booking start', 'number'),
('booking_max_duration_days', '365', 'booking', 'Max Booking Duration (days)', 'Maximum length of a booking', 'number'),
('booking_cancellation_hours', '48', 'booking', 'Cancellation Window (hrs)', 'Hours before booking when cancellation is free', 'number'),
('booking_reschedule_allowed', 'true', 'booking', 'Allow Reschedule', 'Users can reschedule bookings', 'boolean'),
('booking_max_reschedules', '2', 'booking', 'Max Reschedules', 'Maximum times a booking can be rescheduled', 'number'),
('negotiation_enabled', 'true', 'booking', 'Price Negotiation', 'Allow price negotiation on bookings', 'boolean'),
('instant_booking_enabled', 'true', 'booking', 'Instant Booking', 'Allow instant booking without approval', 'boolean'),
('booking_reminder_hours', '24', 'booking', 'Reminder (hrs before)', 'Send reminder before booking', 'number');

-- SUPPORT SETTINGS
INSERT INTO platform_settings (key, value, category, label, description, data_type) VALUES
('support_chat_enabled', 'true', 'support', 'Live Chat', 'Enable live chat support', 'boolean'),
('support_email_enabled', 'true', 'support', 'Email Support', 'Enable email support tickets', 'boolean'),
('support_phone_enabled', 'false', 'support', 'Phone Support', 'Enable phone support', 'boolean'),
('support_hours', 'Mon-Fri 9AM-6PM WAT', 'support', 'Support Hours', 'Customer support operating hours', 'string'),
('support_response_time_hours', '24', 'support', 'Response Time (hrs)', 'Maximum response time', 'number'),
('ticket_auto_close_days', '7', 'support', 'Auto Close Tickets (days)', 'Days before auto-closing resolved tickets', 'number'),
('escalation_enabled', 'true', 'support', 'Auto Escalation', 'Automatically escalate unresolved tickets', 'boolean');

-- NOTIFICATION SETTINGS
INSERT INTO platform_settings (key, value, category, label, description, data_type) VALUES
('email_notifications_enabled', 'true', 'notification', 'Email Notifications', 'Send email notifications', 'boolean'),
('push_notifications_enabled', 'true', 'notification', 'Push Notifications', 'Send push notifications', 'boolean'),
('sms_notifications_enabled', 'false', 'notification', 'SMS Notifications', 'Send SMS notifications', 'boolean'),
('notification_booking_confirm', 'true', 'notification', 'Booking Confirmations', 'Notify on booking confirmation', 'boolean'),
('notification_payment', 'true', 'notification', 'Payment Updates', 'Notify on payment events', 'boolean'),
('notification_messages', 'true', 'notification', 'New Messages', 'Notify on new messages', 'boolean'),
('notification_reviews', 'true', 'notification', 'Reviews', 'Notify on new reviews', 'boolean'),
('notification_promotions', 'false', 'notification', 'Promotions', 'Send promotional notifications', 'boolean'),
('digest_email_frequency', 'never', 'notification', 'Digest Email', 'never, daily, or weekly digest', 'string');

-- LEGAL SETTINGS
INSERT INTO platform_settings (key, value, category, label, description, data_type) VALUES
('terms_version', '1.0', 'legal', 'Terms Version', 'Current terms of service version', 'string'),
('privacy_version', '1.0', 'legal', 'Privacy Version', 'Current privacy policy version', 'string'),
('terms_last_updated', '', 'legal', 'Terms Last Updated', 'Date terms were last updated', 'string'),
('privacy_last_updated', '', 'legal', 'Privacy Last Updated', 'Date privacy policy was updated', 'string'),
('cookie_consent_required', 'true', 'legal', 'Cookie Consent', 'Require cookie consent banner', 'boolean'),
('gdpr_compliance_enabled', 'false', 'legal', 'GDPR Compliance', 'Enable GDPR compliance features', 'boolean'),
('minimum_age', '18', 'legal', 'Minimum Age', 'Minimum user age requirement', 'number'),
('dispute_resolution', 'arbitration', 'legal', 'Dispute Resolution', 'arbitration, mediation, or court', 'string');

-- FEATURE TOGGLES
INSERT INTO platform_settings (key, value, category, label, description, data_type) VALUES
('feature_hotels_enabled', 'true', 'features', 'Hotels Module', 'Enable hotel bookings', 'boolean'),
('feature_workers_enabled', 'true', 'features', 'Workers Module', 'Enable worker services', 'boolean'),
('feature_roommate_enabled', 'true', 'features', 'Roommate Module', 'Enable roommate matching', 'boolean'),
('feature_property_partners_enabled', 'true', 'features', 'Property Partners', 'Enable property partner program', 'boolean'),
('feature_blue_badge_enabled', 'true', 'features', 'Blue Badge', 'Enable blue badge subscription', 'boolean'),
('feature_negotiation_enabled', 'true', 'features', 'Price Negotiation', 'Enable price negotiation', 'boolean'),
('feature_inspections_enabled', 'true', 'features', 'Inspections', 'Enable property inspections', 'boolean'),
('feature_analytics_enabled', 'true', 'features', 'Analytics', 'Enable analytics dashboard', 'boolean'),
('feature_referral_enabled', 'false', 'features', 'Referral Program', 'Enable referral system', 'boolean'),
('feature_loyalty_enabled', 'false', 'features', 'Loyalty Program', 'Enable loyalty points', 'boolean'),
('maintenance_mode', 'false', 'features', 'Maintenance Mode', 'Put site in maintenance mode', 'boolean'),
('registration_open', 'true', 'features', 'Open Registration', 'Allow new user registration', 'boolean');

-- APPEARANCE SETTINGS
INSERT INTO platform_settings (key, value, category, label, description, data_type) VALUES
('theme_primary_color', '#3B82F6', 'appearance', 'Primary Color', 'Main brand color', 'string'),
('theme_secondary_color', '#8B5CF6', 'appearance', 'Secondary Color', 'Accent color', 'string'),
('theme_dark_mode_default', 'true', 'appearance', 'Dark Mode Default', 'Default to dark mode', 'boolean'),
('app_name', 'WeHouse', 'appearance', 'App Name', 'Displayed app name', 'string'),
('meta_description', 'Find your perfect home in Nigeria. Rent apartments, book hotels, hire verified workers.', 'appearance', 'Meta Description', 'SEO meta description', 'string');

-- SECURITY SETTINGS
INSERT INTO platform_settings (key, value, category, label, description, data_type) VALUES
('max_login_attempts', '5', 'security', 'Max Login Attempts', 'Failed attempts before lockout', 'number'),
('login_lockout_minutes', '30', 'security', 'Lockout Duration (min)', 'Minutes to lock account', 'number'),
('session_timeout_hours', '24', 'security', 'Session Timeout (hrs)', 'Hours before session expires', 'number'),
('password_min_length', '8', 'security', 'Min Password Length', 'Minimum password characters', 'number'),
('mfa_required_for_staff', 'false', 'security', 'MFA for Staff', 'Require MFA for staff accounts', 'boolean'),
('audit_log_retention_days', '90', 'security', 'Audit Log Retention', 'Days to keep audit logs', 'number'),
('data_backup_frequency', 'daily', 'security', 'Backup Frequency', 'How often to backup data', 'string');

-- ═══════════════════════════════════════════════════════════════
-- RPC FUNCTIONS
-- ═══════════════════════════════════════════════════════════════

-- Get all settings for a category
CREATE OR REPLACE FUNCTION get_platform_settings(p_category TEXT DEFAULT NULL)
RETURNS TABLE (key TEXT, value TEXT, category TEXT, label TEXT, description TEXT, data_type TEXT, editable BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_category IS NOT NULL THEN
    RETURN QUERY SELECT ps.key::TEXT, ps.value::TEXT, ps.category::TEXT, ps.label::TEXT, ps.description::TEXT, ps.data_type::TEXT, ps.editable
    FROM platform_settings ps WHERE ps.category = p_category ORDER BY ps.category, ps.key;
  ELSE
    RETURN QUERY SELECT ps.key::TEXT, ps.value::TEXT, ps.category::TEXT, ps.label::TEXT, ps.description::TEXT, ps.data_type::TEXT, ps.editable
    FROM platform_settings ps ORDER BY ps.category, ps.key;
  END IF;
END;
$$;

-- Get single setting
CREATE OR REPLACE FUNCTION get_platform_setting(p_key TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_value TEXT;
BEGIN
  SELECT ps.value INTO v_value FROM platform_settings ps WHERE ps.key = p_key;
  RETURN v_value;
END;
$$;

-- Update setting (creator/admin only)
CREATE OR REPLACE FUNCTION update_platform_setting(p_key TEXT, p_value TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_role TEXT;
BEGIN
  SELECT role INTO v_user_role FROM profiles WHERE auth_id = auth.uid()::text AND deleted_at IS NULL;

  IF v_user_role NOT IN ('creator', 'admin') THEN
    RAISE EXCEPTION 'Only creator or admin can update platform settings';
  END IF;

  UPDATE platform_settings
  SET value = p_value, updated_at = NOW()
  WHERE key = p_key AND editable = true;

  RETURN FOUND;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION get_platform_settings TO authenticated;
GRANT EXECUTE ON FUNCTION get_platform_setting TO authenticated;
GRANT EXECUTE ON FUNCTION update_platform_setting TO authenticated;
GRANT EXECUTE ON FUNCTION get_platform_settings TO anon;
GRANT EXECUTE ON FUNCTION get_platform_setting TO anon;
