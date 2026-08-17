-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: Add worker verification fields (FIXED - no FK type conflicts)
-- Date: 2025-07-08
-- ═══════════════════════════════════════════════════════════════

-- Step 1: Add missing columns to profiles (if not exist)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS worker_experience TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS worker_gov_id_url TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS worker_cert_url TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS worker_video_url TEXT;

-- Step 2: Create worker_verification_reviews table (NO foreign keys to avoid type conflicts)
CREATE TABLE IF NOT EXISTS worker_verification_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  reviewer_role TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('approved', 'rejected')),
  rejection_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Step 3: Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_worker_verification_reviews_worker ON worker_verification_reviews(worker_id);

-- Step 4: RLS for worker_verification_reviews
ALTER TABLE worker_verification_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "worker_reviews_staff" ON worker_verification_reviews;
CREATE POLICY "worker_reviews_staff" ON worker_verification_reviews
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid() AND role IN ('staff','admin','creator')));

-- Step 5: Ensure worker_verification_fee setting exists (default N5000)
INSERT INTO platform_settings (key, value, category, data_type, label, description)
VALUES ('worker_verification_fee', '5000', 'payment', 'number', 'Worker Verification Fee', 'One-time fee workers pay for verification (in NGN)')
ON CONFLICT (key) DO NOTHING;

-- Step 6: Ensure partner_commission_rate setting exists (default 10%)
INSERT INTO platform_settings (key, value, category, data_type, label, description)
VALUES ('partner_commission_rate', '10', 'payment', 'number', 'Partner Commission Rate', 'Percentage commission deducted from partner bookings')
ON CONFLICT (key) DO NOTHING;
