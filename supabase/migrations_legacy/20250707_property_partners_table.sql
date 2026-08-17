-- Step 1: Create property_partners table (simple, no fancy defaults)
CREATE TABLE IF NOT EXISTS property_partners (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id TEXT NOT NULL,
  partner_code TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_verification',
  verification_notes TEXT,
  commission_rate DECIMAL DEFAULT 0,
  total_earnings DECIMAL DEFAULT 0,
  total_paid_out DECIMAL DEFAULT 0,
  properties_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Step 2: Index
CREATE INDEX IF NOT EXISTS idx_property_partners_profile_id ON property_partners(profile_id);

-- Step 3: Enable RLS
ALTER TABLE property_partners ENABLE ROW LEVEL SECURITY;

-- Step 4: Simple select policy
CREATE POLICY partners_select ON property_partners FOR SELECT USING (true);

-- Step 5: Simple insert policy
CREATE POLICY partners_insert ON property_partners FOR INSERT WITH CHECK (true);

-- Step 6: Simple update policy
CREATE POLICY partners_update ON property_partners FOR UPDATE USING (true);
