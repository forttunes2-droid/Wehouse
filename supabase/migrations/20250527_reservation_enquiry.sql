-- RESERVATION + ENQUIRY SYSTEM
-- WeHouse Phase 4

-- 1. Add status + reservation fields to listings
ALTER TABLE listings ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'available';
ALTER TABLE listings ADD COLUMN IF NOT EXISTS reserved_by TEXT DEFAULT NULL;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS reservation_expiry TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS reservation_fee_paid BOOLEAN DEFAULT FALSE;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS chat_unlocked BOOLEAN DEFAULT FALSE;

-- Update existing listings to 'available'
UPDATE listings SET status = 'available' WHERE status IS NULL;

-- RLS for listing status updates (staff can update their own, admin/creator can update any)
DROP POLICY IF EXISTS "listings_update_owner" ON listings;
DROP POLICY IF EXISTS "listings_update_admin" ON listings;

CREATE POLICY "listings_update_owner" ON listings FOR UPDATE USING (
  auth.uid()::text = owner_id
);

CREATE POLICY "listings_update_admin" ON listings FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.auth_id = auth.uid()::text AND p.role IN ('creator','admin'))
);

-- 2. Create enquiries table (pre-reservation limited chat)
CREATE TABLE IF NOT EXISTS enquiries (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  listing_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  staff_id TEXT,
  message TEXT NOT NULL,
  reply TEXT DEFAULT NULL,
  replied_at TIMESTAMPTZ DEFAULT NULL,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE enquiries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "enquiries_select_user" ON enquiries;
DROP POLICY IF EXISTS "enquiries_select_staff" ON enquiries;
DROP POLICY IF EXISTS "enquiries_insert_user" ON enquiries;
DROP POLICY IF EXISTS "enquiries_update_staff" ON enquiries;

-- Users can see their own enquiries
CREATE POLICY "enquiries_select_user" ON enquiries FOR SELECT USING (
  auth.uid()::text = user_id OR
  EXISTS (SELECT 1 FROM profiles p WHERE p.auth_id = auth.uid()::text AND p.role IN ('creator','admin','staff'))
);

-- Anyone can create an enquiry
CREATE POLICY "enquiries_insert_user" ON enquiries FOR INSERT WITH CHECK (true);

-- Staff/admin can update (reply to) enquiries
CREATE POLICY "enquiries_update_staff" ON enquiries FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.auth_id = auth.uid()::text AND p.role IN ('creator','admin','staff'))
);

-- 3. Create reservations table
CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  listing_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  staff_id TEXT,
  status TEXT DEFAULT 'pending',
  fee_paid BOOLEAN DEFAULT FALSE,
  amount NUMERIC DEFAULT 10000,
  currency TEXT DEFAULT 'NGN',
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT NULL,
  paid_at TIMESTAMPTZ DEFAULT NULL
);

ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reservations_select_user" ON reservations;
DROP POLICY IF EXISTS "reservations_insert_user" ON reservations;

CREATE POLICY "reservations_select_user" ON reservations FOR SELECT USING (
  auth.uid()::text = user_id OR
  EXISTS (SELECT 1 FROM profiles p WHERE p.auth_id = auth.uid()::text AND p.role IN ('creator','admin','staff'))
);

CREATE POLICY "reservations_insert_user" ON reservations FOR INSERT WITH CHECK (true);
