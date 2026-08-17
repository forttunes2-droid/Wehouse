-- MANUAL RESERVATION WORKFLOW (MVP)
-- No Paystack. Users contact support via WhatsApp.

-- Drop old reservations table if exists (clean slate for new workflow)
DROP TABLE IF EXISTS reservations CASCADE;

-- Create new reservations table with manual workflow
CREATE TABLE reservations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  -- Core
  listing_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_email TEXT,
  user_phone TEXT,
  -- Listing info (snapshot at time of reservation)
  listing_title TEXT,
  listing_price NUMERIC,
  listing_location TEXT,
  -- Status
  status TEXT DEFAULT 'pending',
  -- Status options: pending, paid, inspection_scheduled, completed, cancelled, declined
  -- Support tracking
  support_contacted BOOLEAN DEFAULT FALSE,
  support_contact_method TEXT DEFAULT 'whatsapp', -- whatsapp, phone, email
  support_phone TEXT DEFAULT '+2348000000000',
  -- Manual payment
  manual_payment_status TEXT DEFAULT 'unpaid',
  -- unpaid, pending_confirmation, confirmed
  payment_reference TEXT DEFAULT NULL,
  amount NUMERIC DEFAULT 10000,
  currency TEXT DEFAULT 'NGN',
  -- Inspection
  inspection_date TIMESTAMPTZ DEFAULT NULL,
  inspection_notes TEXT DEFAULT NULL,
  inspection_completed BOOLEAN DEFAULT FALSE,
  -- Staff
  staff_id TEXT DEFAULT NULL,
  staff_notes TEXT DEFAULT NULL,
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  paid_at TIMESTAMPTZ DEFAULT NULL,
  completed_at TIMESTAMPTZ DEFAULT NULL
);

-- Indexes
CREATE INDEX idx_reservations_user ON reservations(user_id);
CREATE INDEX idx_reservations_listing ON reservations(listing_id);
CREATE INDEX idx_reservations_status ON reservations(status);

-- RLS
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reservations_select_user" ON reservations;
DROP POLICY IF EXISTS "reservations_insert_user" ON reservations;
DROP POLICY IF EXISTS "reservations_update_user" ON reservations;
DROP POLICY IF EXISTS "reservations_select_staff" ON reservations;
DROP POLICY IF EXISTS "reservations_update_staff" ON reservations;

-- Users can see their own reservations
CREATE POLICY "reservations_select_user" ON reservations FOR SELECT USING (
  auth.uid()::text = user_id
);
-- Users can create reservations
CREATE POLICY "reservations_insert_user" ON reservations FOR INSERT WITH CHECK (true);
-- Users can update their own (e.g. cancel)
CREATE POLICY "reservations_update_user" ON reservations FOR UPDATE USING (
  auth.uid()::text = user_id
);
-- Staff/admin can see all
CREATE POLICY "reservations_select_staff" ON reservations FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.auth_id = auth.uid()::text AND p.role IN ('creator','admin','staff'))
);
-- Staff/admin can update (approve, schedule inspection, etc)
CREATE POLICY "reservations_update_staff" ON reservations FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.auth_id = auth.uid()::text AND p.role IN ('creator','admin','staff'))
);

-- Insert default support page content
INSERT INTO public_pages (slug, title, content) VALUES
  ('reservation_guide', 'How to Reserve', 
   '1. Click "Reserve House" on any listing\n2. Contact our support team via WhatsApp\n3. Pay the reservation fee (N10,000) manually\n4. Schedule an inspection\n5. If satisfied, complete the full rent payment directly to the landlord\n\nSupport: +234 800 000 0000')
ON CONFLICT (slug) DO NOTHING;
