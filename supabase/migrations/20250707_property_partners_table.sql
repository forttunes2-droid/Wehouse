-- ═══════════════════════════════════════════════════════════════
-- CREATE: property_partners table (missing from schema)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS property_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
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

-- Index for fast lookup by profile_id
CREATE INDEX IF NOT EXISTS idx_property_partners_profile_id ON property_partners(profile_id);

-- Enable RLS
ALTER TABLE property_partners ENABLE ROW LEVEL SECURITY;

-- RLS: Partners can see their own record
DROP POLICY IF EXISTS "partners_select_own" ON property_partners;
CREATE POLICY "partners_select_own" ON property_partners
  FOR SELECT TO authenticated
  USING (profile_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1));

-- RLS: Partners can update their own record
DROP POLICY IF EXISTS "partners_update_own" ON property_partners;
CREATE POLICY "partners_update_own" ON property_partners
  FOR UPDATE TO authenticated
  USING (profile_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1));

-- RLS: Staff/Admin/Creator can see all
DROP POLICY IF EXISTS "partners_select_admin" ON property_partners;
CREATE POLICY "partners_select_admin" ON property_partners
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin')));

-- RLS: Staff/Admin/Creator can insert
DROP POLICY IF EXISTS "partners_insert_admin" ON property_partners;
CREATE POLICY "partners_insert_admin" ON property_partners
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin')));

-- RLS: Staff/Admin/Creator can update all
DROP POLICY IF EXISTS "partners_update_admin" ON property_partners;
CREATE POLICY "partners_update_admin" ON property_partners
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin')));
