-- ═══════════════════════════════════════════════════════════════════
-- WEHOUSE FINAL SETUP SQL — Copy and paste ALL of this into Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════
-- STEP 1: Enable pgcrypto (fixes password)
-- ═══════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Test it works
SELECT crypt('test', gen_salt('bf')) AS pgcrypto_test;

-- ═══════════════════════════════════════════════════════════
-- STEP 2: Add missing columns to profiles
-- ═══════════════════════════════════════════════════════════
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS creator_auth_password TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS creator_auth_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS staff_permission TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS paystack_subaccount_code TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS paystack_transfer_recipient TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bank_account_number TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bank_code TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bank_name TEXT DEFAULT NULL;

-- Make user_id UNIQUE so other tables can reference it
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_user_id_unique;
ALTER TABLE profiles ADD CONSTRAINT profiles_user_id_unique UNIQUE (user_id);

-- ═══════════════════════════════════════════════════════════
-- STEP 3: Creator Auth functions (password fix)
-- ═══════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.set_creator_auth_v2(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.verify_creator_auth_v2(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.get_creator_auth_status_v2(TEXT);

CREATE OR REPLACE FUNCTION public.set_creator_auth_v2(p_user_id TEXT, p_password TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_salt TEXT;
BEGIN
  IF p_password IS NULL OR length(p_password) < 4 THEN RETURN FALSE; END IF;
  v_salt := gen_salt('bf');
  UPDATE profiles SET creator_auth_password = crypt(p_password, v_salt), creator_auth_enabled = TRUE, auth_id = COALESCE(auth_id, p_user_id)
  WHERE auth_id = p_user_id OR (role = 'creator' AND auth_id IS NULL);
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_creator_auth_v2(p_user_id TEXT, p_password TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_hash TEXT; v_found BOOLEAN := FALSE;
BEGIN
  SELECT creator_auth_password INTO v_hash FROM profiles
  WHERE auth_id = p_user_id OR (role = 'creator' AND auth_id IS NULL);
  IF v_hash IS NULL THEN RETURN FALSE; END IF;
  v_found := (v_hash = crypt(p_password, v_hash));
  IF v_found THEN UPDATE profiles SET auth_id = COALESCE(auth_id, p_user_id) WHERE role = 'creator'; END IF;
  RETURN v_found;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_creator_auth_status_v2(p_user_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_password TEXT; v_enabled BOOLEAN;
BEGIN
  SELECT creator_auth_password, creator_auth_enabled INTO v_password, v_enabled FROM profiles
  WHERE auth_id = p_user_id OR (role = 'creator' AND auth_id IS NULL);
  RETURN jsonb_build_object('has_password', v_password IS NOT NULL, 'enabled', COALESCE(v_enabled, FALSE));
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_creator_auth_v2 TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_creator_auth_v2 TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_creator_auth_status_v2 TO authenticated;

-- ═══════════════════════════════════════════════════════════
-- STEP 4: Settings table
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

-- Settings functions
DROP FUNCTION IF EXISTS public.get_all_settings_v2();
CREATE OR REPLACE FUNCTION public.get_all_settings_v2()
RETURNS TABLE(id INTEGER, key TEXT, value TEXT, category TEXT, label TEXT, description TEXT, data_type TEXT, is_active BOOLEAN, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN RETURN QUERY SELECT ps.id, ps.key, ps.value, ps.category, ps.label, ps.description, ps.data_type, ps.is_active, ps.created_at, ps.updated_at FROM platform_settings ps WHERE ps.is_active = TRUE ORDER BY ps.category, ps.label; END; $$;

DROP FUNCTION IF EXISTS public.get_setting_v2(TEXT);
CREATE OR REPLACE FUNCTION public.get_setting_v2(p_key TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_value TEXT; BEGIN SELECT ps.value INTO v_value FROM platform_settings ps WHERE ps.key = p_key; RETURN v_value; END; $$;

DROP FUNCTION IF EXISTS public.set_setting_v2(TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.set_setting_v2(p_key TEXT, p_value TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN INSERT INTO platform_settings (key, value, updated_at) VALUES (p_key, p_value, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW(); RETURN TRUE; EXCEPTION WHEN OTHERS THEN RETURN FALSE; END; $$;

GRANT EXECUTE ON FUNCTION public.get_all_settings_v2 TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_setting_v2 TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.set_setting_v2 TO authenticated;

-- ═══════════════════════════════════════════════════════════
-- STEP 5: Clean and seed ONLY correct settings
-- ═══════════════════════════════════════════════════════════
DELETE FROM platform_settings WHERE key IN (
  'withdrawal_fee', 'inspection_fee', 'blue_badge_price',
  'commission_rate_partner', 'commission_rate_hotel', 'commission_rate_worker',
  'auto_payout', 'paystack_commission_bearer', 'auto_confirm_webhook',
  'max_listings_partner', 'min_photos', 'max_photos', 'max_skills_worker',
  'worker_video_required', 'listing_approval', 'worker_approval',
  'feature_negotiation', 'registration_open', 'refund_policy',
  'company_short_name', 'company_slogan', 'company_email', 'company_phone',
  'company_whatsapp', 'company_website', 'company_cac', 'cookie_notice',
  'minimum_age', 'currency_symbol'
);

INSERT INTO platform_settings (key, value, category, label, description, data_type, is_active) VALUES
  ('worker_commission', '10', 'commissions', 'Worker Commission (%)', 'Percentage WeHouse earns from completed worker jobs. Example: 10% of N20,000 = N2,000 to WeHouse, N18,000 to worker.', 'number', true),
  ('property_commission', '5', 'commissions', 'Property Commission (%)', 'Percentage WeHouse earns from Long Stay and Short Let bookings. Example: 5% of N500,000 = N25,000 to WeHouse.', 'number', true),
  ('hotel_commission', '12', 'commissions', 'Hotel Commission (%)', 'Percentage WeHouse earns from hotel bookings. Example: 12% of N40,000 = N4,800 to WeHouse.', 'number', true),
  ('vat_percent', '0', 'commissions', 'VAT (%)', 'VAT percentage if VAT registered. Set to 0 to disable.', 'number', true),
  ('company_name', 'WeHouse Nigeria', 'company', 'Company Name', 'Legal business name displayed on the platform', 'text', true),
  ('company_logo', '', 'company', 'Company Logo URL', 'URL to company logo image', 'url', true),
  ('currency', 'NGN', 'company', 'Currency', 'Platform currency code', 'text', true),
  ('support_email', 'support@wehouse.ng', 'contact', 'Support Email', 'Primary support email address', 'email', true),
  ('support_phone', '', 'contact', 'Support Phone', 'Customer support phone number', 'text', true),
  ('whatsapp_number', '', 'contact', 'WhatsApp Number', 'Business WhatsApp for support', 'text', true),
  ('telegram_link', '', 'contact', 'Telegram Link', 'Telegram support group link', 'url', true),
  ('company_address', '', 'contact', 'Company Address', 'Physical office address', 'textarea', true),
  ('paystack_public_key', '', 'payment', 'Paystack Public Key', 'Paystack public key for client-side payments', 'text', true),
  ('paystack_secret_key', '', 'payment', 'Paystack Secret Key', 'Paystack secret key for server transfers', 'text', true),
  ('payment_test_mode', 'true', 'payment', 'Test Mode', 'Enable Paystack sandbox mode', 'toggle', true),
  ('google_oauth_client_id', '', 'auth', 'Google OAuth Client ID', 'Google OAuth client ID for login', 'text', true),
  ('terms_conditions', '', 'legal', 'Terms & Conditions', 'Full terms displayed to users', 'textarea', true),
  ('privacy_policy', '', 'legal', 'Privacy Policy', 'Full privacy policy displayed to users', 'textarea', true),
  ('cancellation_policy', '', 'legal', 'Cancellation Policy', 'Booking cancellation policy', 'textarea', true),
  ('booking_rules', '', 'rules', 'Booking Rules', 'Rules for property bookings', 'textarea', true),
  ('roommate_rules', '', 'rules', 'Roommate Rules', 'Rules for roommate matching', 'textarea', true),
  ('worker_verification_rules', '', 'rules', 'Worker Verification Rules', 'Requirements for worker verification', 'textarea', true),
  ('property_inspection_rules', '', 'rules', 'Property Inspection Rules', 'Rules for property inspections', 'textarea', true),
  ('hotel_approval_rules', '', 'rules', 'Hotel Approval Rules', 'Requirements for hotel approval', 'textarea', true),
  ('maintenance_mode', 'false', 'platform', 'Maintenance Mode', 'Put entire platform in maintenance mode', 'toggle', true),
  ('wallet_minimum_withdrawal', '1000', 'platform', 'Min Withdrawal (N)', 'Minimum amount workers/partners can withdraw', 'number', true),
  ('escrow_auto_release_days', '7', 'platform', 'Escrow Auto-Release (Days)', 'Days before escrow auto-releases after job completion', 'number', true),
  ('dispute_period_days', '3', 'platform', 'Dispute Period (Days)', 'Days after completion to open a dispute', 'number', true),
  ('feature_hotels', 'true', 'features', 'Hotels Module', 'Enable hotel bookings module', 'toggle', true),
  ('feature_workers', 'true', 'features', 'Workers Module', 'Enable worker services module', 'toggle', true),
  ('feature_roommate', 'true', 'features', 'Roommate Matching', 'Enable roommate matching module', 'toggle', true)
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value, category = EXCLUDED.category, label = EXCLUDED.label,
  description = EXCLUDED.description, data_type = EXCLUDED.data_type,
  is_active = TRUE, updated_at = NOW();

-- ═══════════════════════════════════════════════════════════
-- STEP 6: Worker status constraint
-- ═══════════════════════════════════════════════════════════
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_worker_status_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_worker_status_check
  CHECK (worker_status IN ('pending','approved_for_verification','profile_under_review','verified','suspended','rejected'));
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS worker_verified BOOLEAN DEFAULT FALSE;

-- ═══════════════════════════════════════════════════════════
-- STEP 7: Wallet balances table
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS wallet_balances (
  user_id TEXT PRIMARY KEY,
  available_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  pending_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_earned NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_withdrawn NUMERIC(12,2) NOT NULL DEFAULT 0,
  frozen BOOLEAN NOT NULL DEFAULT FALSE,
  frozen_reason TEXT DEFAULT NULL,
  frozen_by TEXT DEFAULT NULL,
  frozen_at TIMESTAMPTZ DEFAULT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE wallet_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wallet_all" ON wallet_balances FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- ═══════════════════════════════════════════════════════════
-- STEP 8: Wallet transactions
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  transaction_type TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  balance_after NUMERIC(12,2) NOT NULL,
  reference_id TEXT,
  reference_type TEXT,
  description TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wallet_tx_all" ON wallet_transactions FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE INDEX IF NOT EXISTS idx_wt_user ON wallet_transactions(user_id);

-- ═══════════════════════════════════════════════════════════
-- STEP 9: Escrow transactions
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS escrow_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL,
  booking_type TEXT NOT NULL DEFAULT 'worker',
  payer_user_id TEXT NOT NULL,
  payee_user_id TEXT NOT NULL,
  amount_total NUMERIC(12,2) NOT NULL,
  amount_commission NUMERIC(12,2) NOT NULL,
  amount_payee NUMERIC(12,2) NOT NULL,
  commission_rate NUMERIC(5,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'holding',
  released_at TIMESTAMPTZ,
  released_by TEXT,
  paystack_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE escrow_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "escrow_all" ON escrow_transactions FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- ═══════════════════════════════════════════════════════════
-- STEP 10: Withdrawal requests
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  user_role TEXT NOT NULL,
  amount_requested NUMERIC(12,2) NOT NULL,
  withdrawal_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount_paid NUMERIC(12,2),
  status TEXT NOT NULL DEFAULT 'pending',
  bank_name TEXT NOT NULL,
  bank_code TEXT NOT NULL,
  bank_account_number TEXT NOT NULL,
  paystack_transfer_code TEXT,
  failure_reason TEXT,
  processed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE withdrawal_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "withdrawal_all" ON withdrawal_requests FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE INDEX IF NOT EXISTS idx_wr_user ON withdrawal_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_wr_status ON withdrawal_requests(status);

-- ═══════════════════════════════════════════════════════════
-- STEP 11: Financial audit log
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS financial_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  actor_id TEXT,
  actor_role TEXT,
  target_user_id TEXT,
  target_type TEXT,
  target_id TEXT,
  amount NUMERIC(12,2),
  balance_before NUMERIC(12,2),
  balance_after NUMERIC(12,2),
  commission_amount NUMERIC(12,2),
  description TEXT NOT NULL,
  paystack_reference TEXT,
  paystack_transfer_code TEXT,
  bank_details JSONB,
  status_before TEXT,
  status_after TEXT,
  failure_reason TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE financial_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_all" ON financial_audit_log FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- ═══════════════════════════════════════════════════════════
-- STEP 12: Finance functions (no withdrawal fee)
-- ═══════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.get_commission_rate(TEXT);
CREATE OR REPLACE FUNCTION public.get_commission_rate(p_booking_type TEXT DEFAULT 'worker')
RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rate TEXT; v_num NUMERIC; BEGIN
  IF p_booking_type = 'worker' THEN SELECT value INTO v_rate FROM platform_settings WHERE key = 'worker_commission';
  ELSIF p_booking_type IN ('partner','property') THEN SELECT value INTO v_rate FROM platform_settings WHERE key = 'property_commission';
  ELSIF p_booking_type = 'hotel' THEN SELECT value INTO v_rate FROM platform_settings WHERE key = 'hotel_commission';
  ELSE SELECT value INTO v_rate FROM platform_settings WHERE key = 'worker_commission'; END IF;
  v_num := NULLIF(trim(v_rate),''); IF v_num IS NULL THEN RETURN 10.00; END IF;
  RETURN GREATEST(0,LEAST(100,v_num::NUMERIC)); END; $$;

DROP FUNCTION IF EXISTS public.create_withdrawal_request(TEXT, NUMERIC);
CREATE OR REPLACE FUNCTION public.create_withdrawal_request(p_user_id TEXT, p_amount NUMERIC)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_balance NUMERIC; v_frozen BOOLEAN; v_min NUMERIC;
  v_bank_name TEXT; v_bank_code TEXT; v_acct TEXT; v_req_id UUID;
BEGIN
  SELECT available_balance, frozen INTO v_balance, v_frozen FROM wallet_balances WHERE user_id = p_user_id;
  IF v_balance IS NULL THEN RETURN jsonb_build_object('success',FALSE,'error','No wallet found'); END IF;
  IF v_frozen THEN RETURN jsonb_build_object('success',FALSE,'error','Wallet is frozen'); END IF;
  SELECT COALESCE(NULLIF(value,''),'1000')::NUMERIC INTO v_min FROM platform_settings WHERE key = 'wallet_minimum_withdrawal';
  IF p_amount < v_min THEN RETURN jsonb_build_object('success',FALSE,'error',format('Minimum withdrawal is N%s',v_min)); END IF;
  IF p_amount > v_balance THEN RETURN jsonb_build_object('success',FALSE,'error',format('Insufficient balance. Available: N%s',v_balance)); END IF;
  SELECT bank_name, bank_code, bank_account_number INTO v_bank_name, v_bank_code, v_acct FROM profiles WHERE user_id = p_user_id;
  IF COALESCE(v_bank_code,'') = '' OR COALESCE(v_acct,'') = '' THEN
    RETURN jsonb_build_object('success',FALSE,'error','Bank details not set. Add in profile settings.'); END IF;
  UPDATE wallet_balances SET available_balance = available_balance - p_amount, pending_balance = pending_balance + p_amount, updated_at = NOW() WHERE user_id = p_user_id;
  INSERT INTO withdrawal_requests (user_id, user_role, amount_requested, withdrawal_fee, amount_paid, bank_name, bank_code, bank_account_number, status, metadata)
  SELECT p_user_id, role, p_amount, 0, p_amount, v_bank_name, v_bank_code, v_acct, 'pending', jsonb_build_object('net_amount',p_amount,'fee',0)
  FROM profiles WHERE user_id = p_user_id RETURNING id INTO v_req_id;
  INSERT INTO wallet_transactions (user_id, transaction_type, amount, balance_after, reference_id, reference_type, description)
  VALUES (p_user_id, 'withdrawal_request', -p_amount, v_balance - p_amount, v_req_id::text, 'withdrawal', format('Withdrawal request: N%s',p_amount));
  INSERT INTO financial_audit_log (action, actor_id, actor_role, target_user_id, target_type, target_id, amount, balance_before, balance_after, description, bank_details)
  VALUES ('withdrawal_created', p_user_id, (SELECT role FROM profiles WHERE user_id = p_user_id), p_user_id, 'withdrawal', v_req_id::text, p_amount, v_balance, v_balance - p_amount, format('Withdrawal request: N%s (no fee)',p_amount), jsonb_build_object('bank_name',v_bank_name,'account',v_acct));
  RETURN jsonb_build_object('success',TRUE,'request_id',v_req_id,'amount',p_amount,'fee',0,'net_amount',p_amount);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_commission_rate TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_withdrawal_request TO authenticated;

-- ═══════════════════════════════════════════════════════════
-- DONE: All tables and functions created successfully
-- ═══════════════════════════════════════════════════════════
SELECT 'Setup complete! All tables and functions created.' AS status;
