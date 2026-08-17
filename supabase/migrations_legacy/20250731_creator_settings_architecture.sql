-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION: Creator Settings Architecture Implementation
-- Date: 2025-07-31
-- Phases: 1 (Foundation) + 2 (Notification prefs) + 5 (Cleanup)
-- ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 1A: CANONICALIZE reservation_fee
-- apartment_reservation_fee → reservation_fee
-- ═══════════════════════════════════════════════════════════════════

-- Copy value from apartment_reservation_fee to reservation_fee if reservation_fee is empty/unset
DO $$
DECLARE
  v_apartment_fee TEXT;
  v_reservation_fee TEXT;
BEGIN
  SELECT value INTO v_apartment_fee FROM platform_settings WHERE key = 'apartment_reservation_fee';
  SELECT value INTO v_reservation_fee FROM platform_settings WHERE key = 'reservation_fee';
  
  -- Only copy if apartment_reservation_fee has a meaningful value and reservation_fee is empty
  IF v_apartment_fee IS NOT NULL AND v_apartment_fee != '' AND v_apartment_fee != '0' 
     AND (v_reservation_fee IS NULL OR v_reservation_fee = '' OR v_reservation_fee = '0') THEN
    -- Upsert reservation_fee with the value from apartment_reservation_fee
    INSERT INTO platform_settings (key, value, label, category, data_type, is_active, description)
    VALUES ('reservation_fee', v_apartment_fee, 'Reservation Fee', 'apartment', 'number', true, 'Fee to reserve a property')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
  ELSIF v_reservation_fee IS NULL THEN
    -- No value anywhere — insert with default
    INSERT INTO platform_settings (key, value, label, category, data_type, is_active, description)
    VALUES ('reservation_fee', '5000', 'Reservation Fee', 'apartment', 'number', true, 'Fee to reserve a property')
    ON CONFLICT (key) DO UPDATE SET value = '5000', updated_at = NOW();
  END IF;
END $$;

-- Mark apartment_reservation_fee as inactive (broken key)
UPDATE platform_settings SET is_active = false, updated_at = NOW() WHERE key = 'apartment_reservation_fee';

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 1B: REVOKE set_setting_v2 (unused, unauthenticated)
-- ═══════════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION set_setting_v2(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 1C: MARK DEAD SETTINGS AS INACTIVE
-- Zero consumers in entire codebase
-- ═══════════════════════════════════════════════════════════════════

UPDATE platform_settings SET is_active = false, updated_at = NOW() WHERE key IN (
  'company_logo',        -- No consumer
  'office_address',      -- No consumer
  'tiktok_url',          -- No consumer
  'commission_hotel',    -- No consumer (backend or frontend)
  'apartment_reservation_hold_days',  -- No consumer
  'post_inspection_refund_percent'    -- No consumer
);

-- NOTE: Domain settings are NOT marked inactive.
-- They remain active in the database and are simply displayed
-- in their respective domain tabs instead of Global Settings.
-- get_all_settings_v2() filters by is_active, so marking them
-- inactive would break cache consumers (usePlatformSettings).
-- Only TRULY DEAD settings (Phase 1C) are marked inactive.

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 1D: REMOVE OLD NOTIFICATION GLOBALS FROM ACTIVE SETTINGS
-- Per-user preferences will replace these
-- ═══════════════════════════════════════════════════════════════════

UPDATE platform_settings SET is_active = false, updated_at = NOW() WHERE key IN (
  'email_notifications',
  'push_notifications'
);

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 1E: REMOVE ENVIRONMENT CONFIGURATION FROM ACTIVE SETTINGS
-- paystack_public_key consumers use get_setting_v2 (no is_active filter)
-- so this only removes it from get_all_settings_v2() / usePlatformSettings cache
-- ═══════════════════════════════════════════════════════════════════

UPDATE platform_settings SET is_active = false, updated_at = NOW() WHERE key IN (
  'paystack_public_key',
  'payment_test_mode',
  'paystack_commission_bearer'
);

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 1F: REMOVE REFUND_POLICY FROM ACTIVE SETTINGS
-- Too vague — domain-specific refund policies should be per-module
-- ═══════════════════════════════════════════════════════════════════

UPDATE platform_settings SET is_active = false, updated_at = NOW() WHERE key = 'refund_policy';

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 2A: ADD PERSONAL NOTIFICATION PREFERENCE COLUMNS TO profiles
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pref_email_notif BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pref_push_notif BOOLEAN NOT NULL DEFAULT true;

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 2B: ADD RLS POLICY FOR NOTIFICATION PREFERENCES
-- Users can update their own; staff/creator can read all
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Users can update own notification prefs" ON profiles;
CREATE POLICY "Users can update own notification prefs"
  ON profiles
  FOR UPDATE
  TO authenticated
  USING (auth_id = auth.uid())
  WITH CHECK (auth_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 5A: VERIFY ONLY 7 ACTIVE GLOBAL SETTINGS REMAIN
-- ═══════════════════════════════════════════════════════════════════

-- After all updates, exactly these 7 should be active:
-- company_name, support_email, support_phone
-- maintenance_mode, registration_open
-- privacy_policy, terms_of_service

-- Verify count
SELECT 'Active global settings count' AS check_name, COUNT(*) AS count
FROM platform_settings WHERE is_active = true;
