-- Premium Payments Table
-- Tracks Paystack payments with 5-minute AI review before activation

CREATE TABLE IF NOT EXISTS premium_payments (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  reference TEXT NOT NULL UNIQUE,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'paid',
  plan_type TEXT NOT NULL DEFAULT 'user',
  review_status TEXT NOT NULL DEFAULT 'pending_review',
  review_deadline TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_premium_payments_user ON premium_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_premium_payments_review ON premium_payments(review_status);

-- Row Level Security
ALTER TABLE premium_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "premium_payments_select_own" ON premium_payments
  FOR SELECT USING (user_id = (auth.uid())::text);

CREATE POLICY "premium_payments_admin" ON premium_payments
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM profiles WHERE auth_id = (auth.uid())::text
    AND role IN ('creator', 'creator_admin', 'admin')
  ));

SELECT 'Premium payments table created!' as status;
