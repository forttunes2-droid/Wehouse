-- ============================================================
-- UNIFIED PROPERTY PARTNER SYSTEM
-- Replaces: listings + hotels + property_owners
-- One system for all accommodation types
-- ============================================================

-- ─── PROPERTY PARTNERS ──────────────────────────────────────
-- Replaces property_owners. Same auth system as customers/workers.

CREATE TABLE IF NOT EXISTS property_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  partner_code TEXT UNIQUE NOT NULL,        -- e.g. "WHP-0001"
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'pending_verification')),
  commission_rate DECIMAL(5,2) DEFAULT 10.00,
  bank_name TEXT,
  bank_account_number TEXT,
  bank_account_name TEXT,
  tax_id TEXT,
  verification_notes TEXT,
  verified_by TEXT REFERENCES profiles(user_id),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(profile_id)
);

CREATE INDEX IF NOT EXISTS idx_property_partners_profile ON property_partners(profile_id);
CREATE INDEX IF NOT EXISTS idx_property_partners_status ON property_partners(status);

-- ─── PROPERTIES ─────────────────────────────────────────────
-- ONE table for ALL accommodation types: house, apartment, hotel, resort, etc.
-- Replaces both 'listings' and 'hotels' tables.

CREATE TABLE IF NOT EXISTS properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_code TEXT UNIQUE NOT NULL,       -- e.g. "WHPR-00001"
  partner_id UUID NOT NULL REFERENCES property_partners(id),
  title TEXT NOT NULL,
  description TEXT,
  property_type TEXT NOT NULL CHECK (property_type IN (
    'house', 'apartment', 'hotel', 'resort', 'short_let', 'hostel', 'lodge'
  )),
  -- Location
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  -- Media
  images TEXT[] DEFAULT '{}',
  videos TEXT[] DEFAULT '{}',
  documents TEXT[] DEFAULT '{}',
  -- Status
  status TEXT DEFAULT 'pending_inspection' CHECK (status IN (
    'pending_inspection', 'under_inspection', 'pending_agreement',
    'pending_approval', 'approved', 'rejected', 'active', 'inactive', 'suspended'
  )),
  -- Features
  amenities TEXT[] DEFAULT '{}',
  house_rules TEXT,
  cancellation_policy TEXT,
  check_in_time TEXT DEFAULT '14:00',
  check_out_time TEXT DEFAULT '12:00',
  -- Ratings
  rating DECIMAL(3,2) DEFAULT 0.00,
  review_count INTEGER DEFAULT 0,
  -- Management
  created_by TEXT REFERENCES profiles(user_id),   -- WeHouse staff who created
  approved_by TEXT REFERENCES profiles(user_id),
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  -- Soft delete
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_properties_partner ON properties(partner_id);
CREATE INDEX IF NOT EXISTS idx_properties_type ON properties(property_type);
CREATE INDEX IF NOT EXISTS idx_properties_status ON properties(status);
CREATE INDEX IF NOT EXISTS idx_properties_city ON properties(city);
CREATE INDEX IF NOT EXISTS idx_properties_location ON properties(state, city);

-- ─── PROPERTY UNITS ─────────────────────────────────────────
-- Every property has at least 1 unit.
-- Hotel → many rooms. House → 1 unit. Apartment → many unit types.

CREATE TABLE IF NOT EXISTS property_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_code TEXT UNIQUE NOT NULL,           -- e.g. "WHU-00001"
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_name TEXT NOT NULL,                  -- e.g. "Standard Room", "1 Bedroom", "Master Suite"
  unit_type TEXT,                           -- e.g. "room", "suite", "apartment", "villa"
  description TEXT,
  -- Capacity
  max_guests INTEGER DEFAULT 1,
  bedrooms INTEGER DEFAULT 1,
  bathrooms INTEGER DEFAULT 1,
  -- Pricing
  base_price DECIMAL(12,2) NOT NULL,       -- per night/unit
  cleaning_fee DECIMAL(12,2) DEFAULT 0,
  service_fee DECIMAL(12,2) DEFAULT 0,
  -- Availability
  total_quantity INTEGER DEFAULT 1,          -- how many of this unit type (hotel rooms)
  available_quantity INTEGER DEFAULT 1,
  -- Media
  images TEXT[] DEFAULT '{}',
  -- Amenities specific to this unit
  amenities TEXT[] DEFAULT '{}',
  bed_types TEXT[] DEFAULT '{}',            -- ['King', 'Queen', 'Twin']
  -- Status
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'maintenance', 'inactive')),
  maintenance_note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_property_units_property ON property_units(property_id);
CREATE INDEX IF NOT EXISTS idx_property_units_status ON property_units(status);

-- ─── BOOKINGS (Unified) ─────────────────────────────────────
-- ONE booking engine for ALL accommodation types.
-- Replaces both reservations and hotel_bookings.

CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_code TEXT UNIQUE NOT NULL,         -- e.g. "WHB-20250703-00001"
  customer_id TEXT NOT NULL REFERENCES profiles(user_id),
  property_id UUID NOT NULL REFERENCES properties(id),
  unit_id UUID NOT NULL REFERENCES property_units(id),
  -- Dates
  check_in DATE NOT NULL,
  check_out DATE NOT NULL,
  nights INTEGER NOT NULL,
  -- Guest info
  guest_name TEXT,
  guest_email TEXT,
  guest_phone TEXT,
  guest_count INTEGER DEFAULT 1,
  special_requests TEXT,
  -- Pricing
  unit_price DECIMAL(12,2) NOT NULL,        -- price per night at time of booking
  subtotal DECIMAL(12,2) NOT NULL,          -- unit_price * nights
  cleaning_fee DECIMAL(12,2) DEFAULT 0,
  service_fee DECIMAL(12,2) DEFAULT 0,
  total_amount DECIMAL(12,2) NOT NULL,
  -- Payment
  payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN (
    'pending', 'completed', 'failed', 'refunded', 'partially_refunded'
  )),
  payment_method TEXT,                      -- paystack, transfer, cash
  payment_reference TEXT,
  paid_at TIMESTAMPTZ,
  -- Commission
  commission_rate DECIMAL(5,2) DEFAULT 10.00,
  commission_amount DECIMAL(12,2) DEFAULT 0,
  partner_payout DECIMAL(12,2) DEFAULT 0,   -- total_amount - commission
  -- Booking status
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show'
  )),
  -- Cancellation
  cancelled_at TIMESTAMPTZ,
  cancelled_by TEXT REFERENCES profiles(user_id),
  cancellation_reason TEXT,
  refund_amount DECIMAL(12,2) DEFAULT 0,
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_property ON bookings(property_id);
CREATE INDEX IF NOT EXISTS idx_bookings_unit ON bookings(unit_id);
CREATE INDEX IF NOT EXISTS idx_bookings_dates ON bookings(check_in, check_out);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_payment ON bookings(payment_status);

-- ─── PROPERTY PAYOUTS ───────────────────────────────────────
-- Track payouts to property partners.

CREATE TABLE IF NOT EXISTS property_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_code TEXT UNIQUE NOT NULL,          -- e.g. "WHPP-202507-00001"
  partner_id UUID NOT NULL REFERENCES property_partners(id),
  property_id UUID REFERENCES properties(id),
  amount DECIMAL(12,2) NOT NULL,
  commission_deducted DECIMAL(12,2) NOT NULL,
  gross_amount DECIMAL(12,2) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'paid', 'failed')),
  payment_method TEXT,
  transaction_reference TEXT,
  paid_at TIMESTAMPTZ,
  paid_by TEXT REFERENCES profiles(user_id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_property_payouts_partner ON property_payouts(partner_id);
CREATE INDEX IF NOT EXISTS idx_property_payouts_status ON property_payouts(status);

-- ─── PROPERTY CONTRACTS ─────────────────────────────────────
-- Agreements between WeHouse and Property Partners.

CREATE TABLE IF NOT EXISTS property_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_code TEXT UNIQUE NOT NULL,
  partner_id UUID NOT NULL REFERENCES property_partners(id),
  property_id UUID REFERENCES properties(id),
  contract_type TEXT NOT NULL CHECK (contract_type IN (
    'listing_agreement', 'management_agreement', 'partnership'
  )),
  start_date DATE NOT NULL,
  end_date DATE,
  commission_rate DECIMAL(5,2) NOT NULL DEFAULT 10.00,
  terms TEXT,
  document_url TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'expired', 'terminated')),
  created_by TEXT NOT NULL REFERENCES profiles(user_id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ─── INSPECTION REQUESTS ────────────────────────────────────
-- Property Partners request inspections for new properties.

CREATE TABLE IF NOT EXISTS inspection_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_code TEXT UNIQUE NOT NULL,        -- e.g. "WHIR-00001"
  partner_id UUID NOT NULL REFERENCES property_partners(id),
  property_type TEXT NOT NULL,
  property_address TEXT NOT NULL,
  property_city TEXT NOT NULL,
  property_state TEXT NOT NULL,
  bedrooms INTEGER,
  bathrooms INTEGER,
  expected_rent DECIMAL(12,2),
  description TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'scheduled', 'in_progress', 'approved', 'rejected', 'completed'
  )),
  assigned_to TEXT REFERENCES profiles(user_id),
  scheduled_date DATE,
  completed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  notes TEXT,
  photo_urls TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ─── RLS POLICIES ───────────────────────────────────────────

-- Properties: public can read approved/active, partners see own, staff see all
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "properties_public_read" ON properties;
DROP POLICY IF EXISTS "properties_partner" ON properties;
DROP POLICY IF EXISTS "properties_staff" ON properties;
CREATE POLICY "properties_public_read" ON properties FOR SELECT TO authenticated USING (status IN ('approved', 'active'));
CREATE POLICY "properties_partner" ON properties FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM property_partners WHERE profile_id = auth.uid()::text AND id = properties.partner_id));
CREATE POLICY "properties_staff" ON properties FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','state_admin','assistant_state_admin','director','creator','creator_admin')));

-- Property Units: public can read active, partners see own properties' units, staff see all
ALTER TABLE property_units ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "units_public_read" ON property_units;
DROP POLICY IF EXISTS "units_partner" ON property_units;
DROP POLICY IF EXISTS "units_staff" ON property_units;
CREATE POLICY "units_public_read" ON property_units FOR SELECT TO authenticated USING (status = 'active' AND available_quantity > 0);
CREATE POLICY "units_partner" ON property_units FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM properties JOIN property_partners ON properties.partner_id = property_partners.id WHERE property_partners.profile_id = auth.uid()::text AND properties.id = property_units.property_id));
CREATE POLICY "units_staff" ON property_units FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','state_admin','assistant_state_admin','director','creator','creator_admin')));

-- Bookings: customer sees own, partner sees own properties' bookings, staff sees all
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bookings_customer" ON bookings;
DROP POLICY IF EXISTS "bookings_partner" ON bookings;
DROP POLICY IF EXISTS "bookings_staff" ON bookings;
CREATE POLICY "bookings_customer" ON bookings FOR ALL TO authenticated USING (customer_id = auth.uid()::text);
CREATE POLICY "bookings_partner" ON bookings FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM properties JOIN property_partners ON properties.partner_id = property_partners.id WHERE property_partners.profile_id = auth.uid()::text AND properties.id = bookings.property_id));
CREATE POLICY "bookings_staff" ON bookings FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','state_admin','assistant_state_admin','director','creator','creator_admin')));

-- Property Partners: partner sees own, staff sees all
ALTER TABLE property_partners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "partners_own" ON property_partners;
DROP POLICY IF EXISTS "partners_staff" ON property_partners;
CREATE POLICY "partners_own" ON property_partners FOR ALL TO authenticated USING (profile_id = auth.uid()::text);
CREATE POLICY "partners_staff" ON property_partners FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','state_admin','assistant_state_admin','director','creator','creator_admin')));

-- Property Payouts: partner sees own, staff sees all
ALTER TABLE property_payouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payouts_partner" ON property_payouts;
DROP POLICY IF EXISTS "payouts_staff" ON property_payouts;
CREATE POLICY "payouts_partner" ON property_payouts FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM property_partners WHERE property_partners.id = property_payouts.partner_id AND property_partners.profile_id = auth.uid()::text));
CREATE POLICY "payouts_staff" ON property_payouts FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','state_admin','assistant_state_admin','director','creator','creator_admin')));

-- Property Contracts: partner sees own, staff sees all
ALTER TABLE property_contracts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "contracts_partner" ON property_contracts;
DROP POLICY IF EXISTS "contracts_staff" ON property_contracts;
CREATE POLICY "contracts_partner" ON property_contracts FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM property_partners WHERE property_partners.id = property_contracts.partner_id AND property_partners.profile_id = auth.uid()::text));
CREATE POLICY "contracts_staff" ON property_contracts FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','state_admin','assistant_state_admin','director','creator','creator_admin')));

-- Inspection Requests: partner sees own, staff sees all
ALTER TABLE inspection_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inspections_partner" ON inspection_requests;
DROP POLICY IF EXISTS "inspections_staff" ON inspection_requests;
CREATE POLICY "inspections_partner" ON inspection_requests FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM property_partners WHERE property_partners.id = inspection_requests.partner_id AND property_partners.profile_id = auth.uid()::text));
CREATE POLICY "inspections_staff" ON inspection_requests FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','state_admin','assistant_state_admin','director','creator','creator_admin')));
