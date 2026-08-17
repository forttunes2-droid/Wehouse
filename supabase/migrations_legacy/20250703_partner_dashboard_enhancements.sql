-- ─── PARTNER DASHBOARD ENHANCEMENTS ─────────────────────────
-- Adds amenities, improves inspection requests for full partner workflow

-- 1. Add amenities column to inspection_requests
ALTER TABLE inspection_requests ADD COLUMN IF NOT EXISTS amenities TEXT[] DEFAULT '{}';

-- 2. Ensure property_type has no restrictive check that blocks apartment_short_let etc.
-- (We use TEXT with no CHECK constraint on inspection_requests, so this is fine)

-- 3. Add index for partner_id on bookings if not exists
CREATE INDEX IF NOT EXISTS idx_bookings_partner ON bookings(partner_id);

-- 4. Ensure partner_id exists on bookings
DO $$ BEGIN
  ALTER TABLE bookings ADD COLUMN IF NOT EXISTS partner_id UUID REFERENCES property_partners(id);
EXCEPTION WHEN others THEN
  -- column may already exist
END $$;

-- 5. Ensure partner_id exists on property_payouts
DO $$ BEGIN
  ALTER TABLE property_payouts ADD COLUMN IF NOT EXISTS partner_id UUID REFERENCES property_partners(id);
EXCEPTION WHEN others THEN
  -- column may already exist
END $$;

-- 6. Add RLS policies for partners to see their own bookings and payouts
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bookings_partner" ON bookings;
CREATE POLICY "bookings_partner" ON bookings FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM property_partners WHERE property_partners.id = bookings.partner_id AND property_partners.profile_id = auth.uid()::text));

ALTER TABLE property_payouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payouts_partner" ON property_payouts;
CREATE POLICY "payouts_partner" ON property_payouts FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM property_partners WHERE property_partners.id = property_payouts.partner_id AND property_partners.profile_id = auth.uid()::text));

-- 7. Update existing RLS policies for simplified roles
DROP POLICY IF EXISTS "inspections_staff" ON inspection_requests;
CREATE POLICY "inspections_staff" ON inspection_requests FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin')));

DROP POLICY IF EXISTS "properties_staff" ON properties;
CREATE POLICY "properties_staff" ON properties FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin')));

DROP POLICY IF EXISTS "units_staff" ON property_units;
CREATE POLICY "units_staff" ON property_units FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin')));

DROP POLICY IF EXISTS "bookings_staff" ON bookings;
CREATE POLICY "bookings_staff" ON bookings FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin')));
