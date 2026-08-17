-- ═══════════════════════════════════════════════════════════════
-- FIX: Add missing columns to platform_settings, then seed data
-- ═══════════════════════════════════════════════════════════════

-- Step 1: Add any missing columns (safe to run even if they exist)
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'general';
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT '';
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS data_type TEXT NOT NULL DEFAULT 'text';
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- Step 2: Update existing rows that have empty/default category
UPDATE platform_settings SET category = 'general' WHERE category IS NULL OR category = '';
UPDATE platform_settings SET label = key WHERE label IS NULL OR label = '';
UPDATE platform_settings SET data_type = 'text' WHERE data_type IS NULL OR data_type = '';
UPDATE platform_settings SET is_active = TRUE WHERE is_active IS NULL;

-- Step 3: Now insert all settings with complete columns
INSERT INTO platform_settings (key, value, category, label, description, data_type, is_active) VALUES
  -- COMPANY
  ('company_name','WeHouse Nigeria','company','Company Name','Legal company name displayed across the platform','text',true),
  ('company_short_name','WeHouse','company','Short Name','Short display name','text',true),
  ('company_slogan','Find Your Perfect Home','company','Slogan','Brand slogan/tagline','text',true),
  ('company_email','support@wehouse.ng','company','Support Email','Primary support email address','email',true),
  ('company_phone','','company','Support Phone','Customer support phone number','text',true),
  ('company_address','','company','Office Address','Physical office address','textarea',true),
  ('company_whatsapp','','company','WhatsApp Number','WhatsApp business number','text',true),
  ('company_website','https://wehouse.ng','company','Website URL','Official website URL','url',true),
  ('company_cac','','company','CAC Number','Corporate Affairs Commission number','text',true),
  -- LEGAL
  ('privacy_policy','','legal','Privacy Policy','Full privacy policy text shown to all users','textarea',true),
  ('terms_of_service','','legal','Terms of Service','Full terms of service text shown to all users','textarea',true),
  ('refund_policy','','legal','Refund Policy','Refund policy text shown to users','textarea',true),
  ('cookie_notice','We use cookies to improve your experience on WeHouse.','legal','Cookie Notice','Cookie consent banner text','textarea',true),
  ('minimum_age','18','legal','Minimum Age','Minimum age requirement for users','number',true),
  -- FINANCIAL
  ('commission_rate_worker','10','finance','Worker Commission (%)','Percentage WeHouse takes from worker bookings','number',true),
  ('commission_rate_partner','8','finance','Partner Commission (%)','Percentage from property partner earnings','number',true),
  ('commission_rate_hotel','12','finance','Hotel Commission (%)','Percentage from hotel bookings','number',true),
  ('minimum_withdrawal','1000','finance','Min Withdrawal (N)','Minimum amount for withdrawal','number',true),
  ('withdrawal_fee','50','finance','Withdrawal Fee (N)','Flat fee per withdrawal','number',true),
  ('inspection_fee','3000','finance','Inspection Fee (N)','Fee for property inspection','number',true),
  ('blue_badge_price','5000','finance','Blue Badge Price (N)','Monthly cost for worker blue badge','number',true),
  ('currency_symbol','N','finance','Currency Symbol','Displayed currency symbol','text',true),
  -- PAYMENT
  ('paystack_public_key','','payment','Paystack Public Key','Paystack public API key for client-side payments','text',true),
  ('paystack_secret_key','','payment','Paystack Secret Key','Secret key for server-side verification and webhooks','text',true),
  ('payment_test_mode','true','payment','Test Mode','Use Paystack sandbox for all transactions','toggle',true),
  ('auto_payout','false','payment','Auto Payout','Automatically transfer worker earnings to their bank','toggle',true),
  ('paystack_commission_bearer','subaccount','payment','Commission Bearer','subaccount=worker pays fee, account=WeHouse pays fee','text',true),
  ('auto_confirm_webhook','true','payment','Auto-Confirm via Webhook','Trust Paystack webhook for payment confirmation','toggle',true),
  -- PROPERTY
  ('listing_approval','manual','property','Listing Approval','manual or auto approval of new listings','text',true),
  ('max_listings_partner','50','property','Max Listings Per Partner','Maximum properties a partner can list','number',true),
  ('min_photos','3','property','Min Photos Required','Minimum photos per listing','number',true),
  ('max_photos','20','property','Max Photos Allowed','Maximum photos per listing','number',true),
  -- WORKERS
  ('worker_approval','manual','worker','Worker Approval','manual or auto approval of workers','text',true),
  ('worker_video_required','true','worker','Video Intro Required','Require workers to submit a video introduction','toggle',true),
  ('max_skills_worker','5','worker','Max Skills Per Worker','Maximum services a worker can offer','number',true),
  -- FEATURES
  ('feature_hotels','true','features','Hotels Module','Enable hotel bookings','toggle',true),
  ('feature_workers','true','features','Workers Module','Enable worker services','toggle',true),
  ('feature_roommate','true','features','Roommate Matching','Enable roommate matching','toggle',true),
  ('feature_negotiation','true','features','Price Negotiation','Allow price negotiation on bookings','toggle',true),
  ('maintenance_mode','false','features','Maintenance Mode','Put site in maintenance mode','toggle',true),
  ('registration_open','true','features','Open Registration','Allow new user signups','toggle',true)
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  category = EXCLUDED.category,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  data_type = EXCLUDED.data_type,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();
