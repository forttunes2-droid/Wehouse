-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: Add worker verification fields per Constitution
-- Date: 2025-07-08
-- ═══════════════════════════════════════════════════════════════

-- Add worker_experience column
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS worker_experience TEXT;

-- Add worker_gov_id_url column (government ID document)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS worker_gov_id_url TEXT;

-- Add worker_cert_url column (additional certificates/docs)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS worker_cert_url TEXT;

-- Add worker_video_url column (2-3 min skill demonstration video)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS worker_video_url TEXT;

-- Create table for worker verification reviews (admin/creator reviews)
CREATE TABLE IF NOT EXISTS worker_verification_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id TEXT NOT NULL REFERENCES profiles(user_id),
  reviewer_id TEXT NOT NULL REFERENCES profiles(user_id),
  reviewer_role TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('approved', 'rejected')),
  rejection_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_worker_verification_reviews_worker ON worker_verification_reviews(worker_id);

-- RLS for worker_verification_reviews
ALTER TABLE worker_verification_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "worker_reviews_staff" ON worker_verification_reviews;
CREATE POLICY "worker_reviews_staff" ON worker_verification_reviews
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid() AND role IN ('staff','admin','creator')));

-- Ensure worker_verification_fee setting exists (default N5000)
INSERT INTO platform_settings (key, value, category, data_type, label, description)
VALUES ('worker_verification_fee', '5000', 'payment', 'number', 'Worker Verification Fee', 'One-time fee workers pay for verification (in NGN)')
ON CONFLICT (key) DO NOTHING;
