-- Create property_partners table
CREATE TABLE IF NOT EXISTS property_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id TEXT NOT NULL,
  partner_code TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_verification',
  verification_notes TEXT,
  commission_rate DECIMAL(5,2) DEFAULT 0,
  total_earnings DECIMAL(12,2) DEFAULT 0,
  total_paid_out DECIMAL(12,2) DEFAULT 0,
  properties_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_property_partners_profile_id ON property_partners(profile_id);

ALTER TABLE property_partners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS partners_admin_all ON property_partners;
CREATE POLICY partners_admin_all ON property_partners FOR ALL TO authenticated USING (true) WITH CHECK (true);
