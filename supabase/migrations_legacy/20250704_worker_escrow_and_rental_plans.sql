-- ═══════════════════════════════════════════════════════════════
-- WORKER ESCROW SYSTEM + RENTAL PLAN ENHANCEMENTS
-- ═══════════════════════════════════════════════════════════════

-- ─── WORKER BOOKINGS (Escrow System) ─────────────────────────
CREATE TABLE IF NOT EXISTS worker_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_code TEXT UNIQUE NOT NULL,           -- e.g. "WHWB-00001"
  user_id TEXT NOT NULL REFERENCES profiles(user_id),
  worker_id TEXT NOT NULL REFERENCES profiles(user_id),
  service_type TEXT NOT NULL,                  -- e.g. "plumbing", "electrical"
  description TEXT NOT NULL,                   -- what the user needs done
  address TEXT NOT NULL,                       -- where the work happens
  scheduled_date DATE,
  
  -- Financial breakdown (transparent)
  agreed_amount DECIMAL(12,2) NOT NULL,        -- what user pays for the work
  wehouse_fee DECIMAL(12,2) NOT NULL DEFAULT 300,  -- N300 booking fee
  worker_commission DECIMAL(12,2) NOT NULL,    -- 12.5% of agreed_amount
  worker_receives DECIMAL(12,2) NOT NULL,      -- agreed_amount - commission
  
  -- Payment / Escrow
  paystack_reference TEXT,
  paystack_transaction_id TEXT,
  status TEXT DEFAULT 'pending_payment' CHECK (status IN (
    'pending_payment', 'paid_escrow', 'worker_assigned', 'in_progress',
    'completed_pending_approval', 'approved_released', 'disputed', 'cancelled', 'refunded'
  )),
  
  -- Approval flow
  user_approved BOOLEAN DEFAULT FALSE,
  worker_approved BOOLEAN DEFAULT FALSE,
  user_rating INTEGER CHECK (user_rating >= 1 AND user_rating <= 5),
  user_review TEXT,
  worker_rating INTEGER CHECK (worker_rating >= 1 AND worker_rating <= 5),
  worker_review TEXT,
  
  -- Dispute
  dispute_reason TEXT,
  dispute_resolved_by TEXT REFERENCES profiles(user_id),
  dispute_resolution TEXT,
  
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_worker_bookings_user ON worker_bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_worker_bookings_worker ON worker_bookings(worker_id);
CREATE INDEX IF NOT EXISTS idx_worker_bookings_status ON worker_bookings(status);

-- RLS
ALTER TABLE worker_bookings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "worker_bookings_user" ON worker_bookings;
DROP POLICY IF EXISTS "worker_bookings_worker" ON worker_bookings;
DROP POLICY IF EXISTS "worker_bookings_staff" ON worker_bookings;
CREATE POLICY "worker_bookings_user" ON worker_bookings FOR ALL TO authenticated USING (user_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1));
CREATE POLICY "worker_bookings_worker" ON worker_bookings FOR ALL TO authenticated USING (worker_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1));
CREATE POLICY "worker_bookings_staff" ON worker_bookings FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin')));

-- ─── RENTAL AGREEMENTS (Tracks multi-year rental plans) ───────
CREATE TABLE IF NOT EXISTS rental_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_code TEXT UNIQUE NOT NULL,         -- e.g. "WHRA-00001"
  reservation_id UUID REFERENCES reservations(id),
  listing_id TEXT NOT NULL REFERENCES listings(listing_id),
  user_id TEXT NOT NULL REFERENCES profiles(user_id),
  partner_id UUID REFERENCES property_partners(id),
  
  -- Rental plan details
  duration_years INTEGER NOT NULL CHECK (duration_years IN (1, 2, 3)),
  annual_rent DECIMAL(12,2) NOT NULL,
  total_rent DECIMAL(12,2) NOT NULL,
  wehouse_commission_total DECIMAL(12,2) NOT NULL,
  landlord_receives_total DECIMAL(12,2) NOT NULL,
  
  -- Year 1 (upfront)
  year1_paid BOOLEAN DEFAULT FALSE,
  year1_amount DECIMAL(12,2) NOT NULL,
  year1_paid_at TIMESTAMPTZ,
  year1_paystack_ref TEXT,
  
  -- Installments (Year 2+)
  monthly_installment DECIMAL(12,2),
  total_installments INTEGER DEFAULT 0,
  installments_paid INTEGER DEFAULT 0,
  next_payment_date DATE,
  
  -- Status
  status TEXT DEFAULT 'pending_year1' CHECK (status IN (
    'pending_year1', 'active', 'overdue', 'completed', 'terminated'
  )),
  
  -- Auto-deduct setup
  paystack_authorization_code TEXT,            -- for recurring charges
  auto_deduct_enabled BOOLEAN DEFAULT FALSE,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rental_agreements_user ON rental_agreements(user_id);
CREATE INDEX IF NOT EXISTS idx_rental_agreements_listing ON rental_agreements(listing_id);
CREATE INDEX IF NOT EXISTS idx_rental_agreements_status ON rental_agreements(status);

-- RLS
ALTER TABLE rental_agreements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rental_agreements_user" ON rental_agreements;
DROP POLICY IF EXISTS "rental_agreements_partner" ON rental_agreements;
DROP POLICY IF EXISTS "rental_agreements_staff" ON rental_agreements;
CREATE POLICY "rental_agreements_user" ON rental_agreements FOR ALL TO authenticated USING (user_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1));
CREATE POLICY "rental_agreements_partner" ON rental_agreements FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM property_partners WHERE property_partners.id = rental_agreements.partner_id AND property_partners.profile_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)));
CREATE POLICY "rental_agreements_staff" ON rental_agreements FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin')));

-- ─── INSPECTION REQUESTS: ADD AMENITIES + PHOTOS ─────────────
ALTER TABLE inspection_requests ADD COLUMN IF NOT EXISTS amenities TEXT[] DEFAULT '{}';

-- ─── UPDATE ALL STAFF RLS POLICIES TO USE SIMPLIFIED ROLES ───
-- (These are already done in previous migration, but belt-and-suspenders)
DROP POLICY IF EXISTS "inspections_staff" ON inspection_requests;
CREATE POLICY "inspections_staff" ON inspection_requests FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin')));
