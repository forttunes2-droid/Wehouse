-- ═══════════════════════════════════════════════════════════════════
-- WEHOUSE CORRECT SETTINGS — Clean up wrong fees, keep only what's needed
-- ═══════════════════════════════════════════════════════════════════

-- Step 1: Delete ALL wrong/duplicate settings
DELETE FROM platform_settings WHERE key IN (
  'withdrawal_fee',           -- REMOVED: No withdrawal fee
  'inspection_fee',           -- REMOVED: Not a platform fee
  'blue_badge_price',         -- REMOVED: Not a platform fee
  'commission_rate_partner',  -- RENAMED: Now 'property_commission'
  'commission_rate_hotel',    -- RENAMED: Now 'hotel_commission'
  'commission_rate_worker',   -- RENAMED: Now 'worker_commission'
  'auto_payout',              -- REMOVED: System handles automatically
  'paystack_commission_bearer', -- REMOVED: Always subaccount
  'auto_confirm_webhook',     -- REMOVED: Always auto-confirm
  'max_listings_partner',     -- REMOVED: Not needed
  'min_photos',               -- REMOVED: Not needed
  'max_photos',               -- REMOVED: Not needed
  'max_skills_worker',        -- REMOVED: Not needed
  'worker_video_required',    -- REMOVED: Not needed
  'listing_approval',         -- REMOVED: Always manual
  'worker_approval',          -- REMOVED: Always manual
  'feature_negotiation',      -- REMOVED: Always on
  'registration_open',        -- REMOVED: Always on unless maintenance
  'refund_policy'             -- REMOVED: Covered by platform policy
);

-- Step 2: Insert ONLY correct settings
INSERT INTO platform_settings (key, value, category, label, description, data_type, is_active) VALUES
  -- ═══ COMMISSIONS (The ONLY way WeHouse earns money) ═══
  ('worker_commission', '10', 'commissions', 'Worker Commission (%)', 'Percentage WeHouse earns from completed worker jobs. Example: 10% of N20,000 = N2,000 to WeHouse, N18,000 to worker.', 'number', true),
  ('property_commission', '5', 'commissions', 'Property Commission (%)', 'Percentage WeHouse earns from Long Stay and Short Let bookings. Example: 5% of N500,000 = N25,000 to WeHouse, N475,000 to partner.', 'number', true),
  ('hotel_commission', '12', 'commissions', 'Hotel Commission (%)', 'Percentage WeHouse earns from hotel bookings. Example: 12% of N40,000 = N4,800 to WeHouse, N35,200 to hotel.', 'number', true),
  ('vat_percent', '0', 'commissions', 'VAT (%)', 'VAT percentage if WeHouse becomes VAT registered. Set to 0 to disable.', 'number', true),

  -- ═══ COMPANY INFO ═══
  ('company_name', 'WeHouse Nigeria', 'company', 'Company Name', 'Legal business name displayed on the platform', 'text', true),
  ('company_logo', '', 'company', 'Company Logo URL', 'URL to company logo image', 'url', true),
  ('currency', 'NGN', 'company', 'Currency', 'Platform currency code', 'text', true),

  -- ═══ CONTACT ═══
  ('support_email', 'support@wehouse.ng', 'contact', 'Support Email', 'Primary support email address', 'email', true),
  ('support_phone', '', 'contact', 'Support Phone', 'Customer support phone number', 'text', true),
  ('whatsapp_number', '', 'contact', 'WhatsApp Number', 'Business WhatsApp number for support', 'text', true),
  ('telegram_link', '', 'contact', 'Telegram Link', 'Telegram support group or channel link', 'url', true),
  ('company_address', '', 'contact', 'Company Address', 'Physical office address', 'textarea', true),

  -- ═══ PAYMENT (Paystack) ═══
  ('paystack_public_key', '', 'payment', 'Paystack Public Key', 'Paystack public key for client-side payments', 'text', true),
  ('paystack_secret_key', '', 'payment', 'Paystack Secret Key', 'Paystack secret key for server-side transfers and webhooks', 'text', true),
  ('payment_test_mode', 'true', 'payment', 'Test Mode', 'Enable Paystack test/sandbox mode', 'toggle', true),

  -- ═══ GOOGLE AUTH ═══
  ('google_oauth_client_id', '', 'auth', 'Google OAuth Client ID', 'Google OAuth client ID for Google login', 'text', true),

  -- ═══ LEGAL ═══
  ('terms_conditions', '', 'legal', 'Terms & Conditions', 'Full terms and conditions text displayed to users', 'textarea', true),
  ('privacy_policy', '', 'legal', 'Privacy Policy', 'Full privacy policy text displayed to users', 'textarea', true),
  ('cancellation_policy', '', 'legal', 'Cancellation Policy', 'Booking cancellation policy', 'textarea', true),

  -- ═══ PLATFORM RULES ═══
  ('booking_rules', '', 'rules', 'Booking Rules', 'Rules and guidelines for property bookings', 'textarea', true),
  ('roommate_rules', '', 'rules', 'Roommate Rules', 'Rules for roommate matching and arrangements', 'textarea', true),
  ('worker_verification_rules', '', 'rules', 'Worker Verification Rules', 'Requirements and process for worker verification', 'textarea', true),
  ('property_inspection_rules', '', 'rules', 'Property Inspection Rules', 'Rules for property inspections by field officers', 'textarea', true),
  ('hotel_approval_rules', '', 'rules', 'Hotel Approval Rules', 'Requirements for hotel listings approval', 'textarea', true),

  -- ═══ PLATFORM CONFIG ═══
  ('maintenance_mode', 'false', 'platform', 'Maintenance Mode', 'Put the entire platform in maintenance mode', 'toggle', true),
  ('wallet_minimum_withdrawal', '1000', 'platform', 'Wallet Minimum Withdrawal', 'Minimum amount a worker or partner can withdraw', 'number', true),
  ('escrow_auto_release_days', '7', 'platform', 'Escrow Auto-Release Period (Days)', 'Days after job completion before escrow auto-releases to worker', 'number', true),
  ('dispute_period_days', '3', 'platform', 'Dispute Period (Days)', 'Days after job completion where user can open a dispute', 'number', true),

  -- ═══ FEATURE TOGGLES ═══
  ('feature_hotels', 'true', 'features', 'Hotels Module', 'Enable hotel bookings module', 'toggle', true),
  ('feature_workers', 'true', 'features', 'Workers Module', 'Enable worker services module', 'toggle', true),
  ('feature_roommate', 'true', 'features', 'Roommate Matching', 'Enable roommate matching module', 'toggle', true)

ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  category = EXCLUDED.category,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  data_type = EXCLUDED.data_type,
  is_active = TRUE,
  updated_at = NOW();
