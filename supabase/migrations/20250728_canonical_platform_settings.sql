-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION: Canonical Platform Settings (Phase A)
-- Date: 2025-07-28
-- 
-- Goals:
-- 1. Rename mismatched keys (hotel settings)
-- 2. Add missing canonical settings
-- 3. Mark obsolete settings inactive (never delete)
-- 4. Preserve all audit history
-- ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
-- STEP 1: RENAME mismatched keys
-- ═══════════════════════════════════════════════════════════════════

UPDATE platform_settings SET key = 'hotel_reservation_enabled' WHERE key = 'allow_hotel_reservation';
UPDATE platform_settings SET key = 'hotel_reservation_amount' WHERE key = 'hotel_reservation_fee';

-- ═══════════════════════════════════════════════════════════════════
-- STEP 2: ADD missing canonical settings (with defaults per Constitution)
-- ═══════════════════════════════════════════════════════════════════

INSERT INTO platform_settings (key, value, label, category, data_type, is_active) VALUES
  -- Company (new)
  ('tiktok_url', '', 'TikTok URL', 'company', 'url', true),

  -- Apartment (new)
  ('apartment_reservation_hold_days', '3', 'Reservation Hold (days)', 'apartment', 'number', true),
  ('rent_plan_start_after_months', '4', 'Rent Plan Start After (months)', 'apartment', 'number', true),
  ('rent_plan_cancellation_fee_percent', '10', 'Rent Plan Cancellation Fee (%)', 'apartment', 'number', true),
  ('post_inspection_refund_percent', '50', 'Post-Inspection Refund (%)', 'apartment', 'number', true),

  -- Hotel (new technical settings)
  ('hotel_reservation_fee_type', 'fixed_amount', 'Reservation Fee Type', 'hotel', 'text', true),
  ('hotel_reservation_expiry_hours', '48', 'Reservation Expiry (hours)', 'hotel', 'number', true),

  -- Withdrawals (new)
  ('payout_mode', 'manual', 'Payout Mode', 'withdrawals', 'text', true),

  -- Platform Controls (new — registration_open exists as orphaned default)
  ('registration_open', 'true', 'Registration Open', 'platform_controls', 'toggle', true)

ON CONFLICT (key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- STEP 3: MARK obsolete settings INACTIVE (not deleted)
-- ═══════════════════════════════════════════════════════════════════

UPDATE platform_settings SET is_active = false WHERE key IN (
  -- Company: removed channels
  'support_whatsapp',
  'support_telegram',

  -- Apartment: not part of canonical business rules
  'security_deposit_rules',
  'min_rent_duration',
  'max_rent_duration',
  'grace_period_days',
  'late_payment_rules',

  -- Worker: unstructured free-text replaced by structured config
  'worker_required_documents',
  'worker_verification_video_length',

  -- Withdrawals: max_withdrawal retired, automatic_paystack_transfer replaced by payout_mode
  'max_withdrawal',
  'automatic_paystack_transfer'
);

-- ═══════════════════════════════════════════════════════════════════
-- STEP 4: MARK orphaned default keys INACTIVE
-- ═══════════════════════════════════════════════════════════════════

UPDATE platform_settings SET is_active = false WHERE key IN (
  'platform_name',
  'listing_approval_required',
  'default_user_role',
  'max_listings_per_user'
);

-- ═══════════════════════════════════════════════════════════════════
-- STEP 5: Remove openai_api_key reference if present
-- ═══════════════════════════════════════════════════════════════════

UPDATE platform_settings SET is_active = false WHERE key = 'openai_api_key';

-- ═══════════════════════════════════════════════════════════════════
-- VERIFY: list all active canonical settings
-- ═══════════════════════════════════════════════════════════════════
-- SELECT key, value, category, label FROM platform_settings WHERE is_active = true ORDER BY category, key;
