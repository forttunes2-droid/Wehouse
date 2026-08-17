-- ============================================================
-- CTO MASTER SCHEMA — Complete Architecture Rebuild
-- ============================================================
-- This migration creates the database foundation for the
-- WeHouse permission-driven architecture as specified by CTO.
--
-- Tables created:
--   1. staff_permissions      — Permission groups per staff member
--   2. property_owners        — Private property owner records
--   3. owner_properties       — Junction: owners ↔ listings
--   4. owner_contracts        — Contracts between WeHouse and owners
--   4. support_tickets        — Customer support tickets
--   5. inspections            — Field officer inspection reports
--   6. commission_rules       — Commission/payout rules
--   7. payouts                — Landlord payout tracking
--   8. booking_payments       — Payment records for bookings
--   9. staff_activity_log     — Staff activity tracking
-- ============================================================

-- ─── 1. STAFF PERMISSIONS ───────────────────────────────────
-- Each staff member can have multiple permissions.
-- Creator assigns these. Staff dashboard modules appear based on this.

CREATE TABLE IF NOT EXISTS staff_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission IN (
    'operations',      -- Create/edit listings, inspections, property management
    'finance',         -- Payments, revenue, commission, payouts, refunds
    'support',         -- Support tickets, customer chat, complaints
    'verification',    -- Worker verification (review docs, approve/reject)
    'field_officer',   -- Property inspections, photo/document upload
    'admin'            -- User management, staff management, announcements
  )),
  granted_by TEXT NOT NULL REFERENCES profiles(user_id),
  granted_at TIMESTAMPTZ DEFAULT now(),
  revoked_at TIMESTAMPTZ DEFAULT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  UNIQUE(staff_id, permission)
);

-- Index for fast permission lookups
CREATE INDEX IF NOT EXISTS idx_staff_permissions_staff ON staff_permissions(staff_id, is_active);
CREATE INDEX IF NOT EXISTS idx_staff_permissions_perm ON staff_permissions(permission, is_active);

-- ─── 2. PROPERTY OWNERS ─────────────────────────────────────
-- PRIVATE. Separate from profiles. Property owners never log into the main app.
-- WeHouse manages all owner relationships internally.

CREATE TABLE IF NOT EXISTS property_owners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_code TEXT UNIQUE NOT NULL,           -- e.g. "WHO-0001"
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT NOT NULL,
  address TEXT,
  state TEXT,
  city TEXT,
  bank_name TEXT,
  bank_account_number TEXT,
  bank_account_name TEXT,
  tax_id TEXT,                                -- For tax reporting
  commission_rate DECIMAL(5,2) DEFAULT 10.00, -- % WeHouse takes (default 10%)
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  notes TEXT,
  created_by TEXT NOT NULL REFERENCES profiles(user_id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_property_owners_code ON property_owners(owner_code);
CREATE INDEX IF NOT EXISTS idx_property_owners_status ON property_owners(status);

-- ─── 3. OWNER PROPERTIES ────────────────────────────────────
-- Junction table linking property owners to their listings.
-- One owner can have multiple properties.

CREATE TABLE IF NOT EXISTS owner_properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES property_owners(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL REFERENCES listings(listing_id) ON DELETE CASCADE,
  contract_start_date DATE,
  contract_end_date DATE,
  monthly_rent DECIMAL(12,2),
  payout_day INTEGER DEFAULT 1 CHECK (payout_day BETWEEN 1 AND 31),
  is_primary_owner BOOLEAN DEFAULT TRUE,
  ownership_percentage DECIMAL(5,2) DEFAULT 100.00,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(owner_id, listing_id)
);

CREATE INDEX IF NOT EXISTS idx_owner_properties_owner ON owner_properties(owner_id);
CREATE INDEX IF NOT EXISTS idx_owner_properties_listing ON owner_properties(listing_id);

-- ─── 4. OWNER CONTRACTS ─────────────────────────────────────
-- Contracts between WeHouse and property owners.

CREATE TABLE IF NOT EXISTS owner_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES property_owners(id) ON DELETE CASCADE,
  contract_code TEXT UNIQUE NOT NULL,         -- e.g. "WHC-2026-0001"
  contract_type TEXT NOT NULL CHECK (contract_type IN ('rental', 'management', 'partnership')),
  start_date DATE NOT NULL,
  end_date DATE,
  commission_rate DECIMAL(5,2) NOT NULL DEFAULT 10.00,
  terms TEXT,                                 -- Contract terms/notes
  document_url TEXT,                          -- Uploaded contract document
  status TEXT DEFAULT 'active' CHECK (status IN ('draft', 'active', 'expired', 'terminated')),
  terminated_by TEXT REFERENCES profiles(user_id),
  terminated_at TIMESTAMPTZ,
  created_by TEXT NOT NULL REFERENCES profiles(user_id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_owner_contracts_owner ON owner_contracts(owner_id);
CREATE INDEX IF NOT EXISTS idx_owner_contracts_status ON owner_contracts(status);

-- ─── 5. SUPPORT TICKETS ─────────────────────────────────────
-- Customer support tickets for the Customer Support module.

CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_code TEXT UNIQUE NOT NULL,           -- e.g. "WHT-00001"
  customer_id TEXT NOT NULL REFERENCES profiles(user_id),
  customer_email TEXT NOT NULL,
  customer_phone TEXT,
  type TEXT NOT NULL CHECK (type IN (
    'booking_issue', 'refund_request', 'complaint',
    'account_help', 'payment_issue', 'general'
  )),
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed', 'escalated')),
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  assigned_to TEXT REFERENCES profiles(user_id),
  resolution_notes TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT REFERENCES profiles(user_id),
  listing_id TEXT REFERENCES listings(listing_id),
  reservation_id TEXT REFERENCES reservations(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_customer ON support_tickets(customer_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_assigned ON support_tickets(assigned_to);
CREATE INDEX IF NOT EXISTS idx_support_tickets_priority ON support_tickets(priority);

-- ─── 6. INSPECTIONS ─────────────────────────────────────────
-- Field officer inspection reports with photo/document support.

CREATE TABLE IF NOT EXISTS inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_code TEXT UNIQUE NOT NULL,       -- e.g. "WHI-00001"
  listing_id TEXT NOT NULL REFERENCES listings(listing_id),
  field_officer_id TEXT NOT NULL REFERENCES profiles(user_id),
  status TEXT DEFAULT 'scheduled' CHECK (status IN (
    'scheduled', 'in_progress', 'completed', 'cancelled', 're_inspection_required'
  )),
  scheduled_date DATE,
  completed_at TIMESTAMPTZ,
  overall_condition TEXT CHECK (overall_condition IN ('excellent', 'good', 'fair', 'poor')),
  property_cleanliness TEXT CHECK (property_cleanliness IN ('excellent', 'good', 'fair', 'poor')),
  security_level TEXT CHECK (security_level IN ('high', 'medium', 'low')),
  amenities_verified BOOLEAN DEFAULT FALSE,
  photos_match_listing BOOLEAN DEFAULT FALSE,
  price_verified BOOLEAN DEFAULT FALSE,
  landlord_present BOOLEAN DEFAULT FALSE,
  notes TEXT,
  report TEXT,                                -- Full inspection report
  photo_urls TEXT[] DEFAULT '{}',             -- Array of inspection photo URLs
  document_urls TEXT[] DEFAULT '{}',          -- Array of uploaded documents
  gps_latitude DECIMAL(10, 8),
  gps_longitude DECIMAL(11, 8),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inspections_listing ON inspections(listing_id);
CREATE INDEX IF NOT EXISTS idx_inspections_officer ON inspections(field_officer_id);
CREATE INDEX IF NOT EXISTS idx_inspections_status ON inspections(status);

-- ─── 7. COMMISSION RULES ────────────────────────────────────
-- Configurable commission and fee rules.

CREATE TABLE IF NOT EXISTS commission_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  rule_type TEXT NOT NULL CHECK (rule_type IN (
    'reservation_fee', 'listing_commission', 'hotel_booking_fee',
    'worker_subscription', 'owner_commission', 'late_fee', 'cancellation_fee'
  )),
  percentage DECIMAL(5,2),                    -- Percentage-based fee (e.g. 10%)
  flat_amount DECIMAL(12,2),                  -- Flat fee in Naira
  min_amount DECIMAL(12,2),                   -- Minimum fee
  max_amount DECIMAL(12,2),                   -- Maximum fee
  currency TEXT DEFAULT 'NGN',
  is_active BOOLEAN DEFAULT TRUE,
  applies_to TEXT CHECK (applies_to IN ('all', 'new', 'existing')), -- Customer category
  description TEXT,
  created_by TEXT REFERENCES profiles(user_id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commission_rules_type ON commission_rules(rule_type, is_active);

-- ─── 8. PAYOUTS ─────────────────────────────────────────────
-- Landlord payout tracking. Records every payment made to property owners.

CREATE TABLE IF NOT EXISTS payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_code TEXT UNIQUE NOT NULL,           -- e.g. "WHP-2026-07-0001"
  owner_id UUID NOT NULL REFERENCES property_owners(id),
  owner_property_id UUID REFERENCES owner_properties(id),
  amount DECIMAL(12,2) NOT NULL,              -- Amount paid to owner
  commission_amount DECIMAL(12,2) NOT NULL,   -- WeHouse commission deducted
  gross_amount DECIMAL(12,2) NOT NULL,        -- Total before commission
  period_start DATE NOT NULL,                 -- Payout period
  period_end DATE NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'paid', 'failed', 'cancelled')),
  payment_method TEXT CHECK (payment_method IN ('bank_transfer', 'cash', 'check')),
  paid_at TIMESTAMPTZ,
  paid_by TEXT REFERENCES profiles(user_id),
  transaction_reference TEXT,                 -- Bank transfer reference
  notes TEXT,
  created_by TEXT NOT NULL REFERENCES profiles(user_id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payouts_owner ON payouts(owner_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status);
CREATE INDEX IF NOT EXISTS idx_payouts_period ON payouts(period_start, period_end);

-- ─── 9. BOOKING PAYMENTS ────────────────────────────────────
-- Every payment made by customers is recorded here.

CREATE TABLE IF NOT EXISTS booking_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_reference TEXT UNIQUE NOT NULL,     -- e.g. "WHPAY-00001"
  user_id TEXT NOT NULL REFERENCES profiles(user_id),
  type TEXT NOT NULL CHECK (type IN ('reservation', 'hotel_booking', 'worker_subscription')),
  listing_id TEXT REFERENCES listings(listing_id),
  hotel_booking_id INTEGER REFERENCES hotel_bookings(booking_id),
  amount DECIMAL(12,2) NOT NULL,
  commission_amount DECIMAL(12,2) DEFAULT 0,
  net_amount DECIMAL(12,2) NOT NULL,          -- Amount after commission
  currency TEXT DEFAULT 'NGN',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'refunded', 'partially_refunded')),
  payment_method TEXT CHECK (payment_method IN ('paystack', 'transfer', 'cash', 'card')),
  paystack_reference TEXT,
  refund_amount DECIMAL(12,2) DEFAULT 0,
  refund_reason TEXT,
  refund_processed_at TIMESTAMPTZ,
  refund_processed_by TEXT REFERENCES profiles(user_id),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_payments_user ON booking_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_booking_payments_status ON booking_payments(status);
CREATE INDEX IF NOT EXISTS idx_booking_payments_type ON booking_payments(type);

-- ─── 10. STAFF ACTIVITY LOG ─────────────────────────────────
-- Track everything staff members do (for audit and accountability).

CREATE TABLE IF NOT EXISTS staff_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id TEXT NOT NULL REFERENCES profiles(user_id),
  action TEXT NOT NULL,                       -- e.g. "listing_created", "worker_verified"
  module TEXT NOT NULL CHECK (module IN (
    'operations', 'finance', 'support',
    'verification', 'field_officer', 'admin', 'general'
  )),
  target_type TEXT,                           -- e.g. "listing", "worker", "ticket"
  target_id TEXT,                             -- ID of the affected record
  details JSONB DEFAULT '{}',
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_activity_staff ON staff_activity_log(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_activity_module ON staff_activity_log(module);
CREATE INDEX IF NOT EXISTS idx_staff_activity_action ON staff_activity_log(action);
CREATE INDEX IF NOT EXISTS idx_staff_activity_created ON staff_activity_log(created_at);

-- ─── ADD PERMISSIONS COLUMN TO PROFILES ─────────────────────
-- For backward compatibility: staff users get their permissions
-- from staff_permissions table, but we add a quick-check column too.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS staff_permissions TEXT[] DEFAULT '{}';

COMMENT ON TABLE staff_permissions IS 'Permission groups assigned to staff members by Creator';
COMMENT ON TABLE property_owners IS 'Private property owner records — NOT user profiles';
COMMENT ON TABLE owner_properties IS 'Junction: which owner owns which property';
COMMENT ON TABLE owner_contracts IS 'Contracts between WeHouse and property owners';
COMMENT ON TABLE support_tickets IS 'Customer support tickets for the support module';
COMMENT ON TABLE inspections IS 'Field officer property inspection reports';
COMMENT ON TABLE commission_rules IS 'Configurable commission and fee rules';
COMMENT ON TABLE payouts IS 'Landlord payout tracking — every payment recorded';
COMMENT ON TABLE booking_payments IS 'Every customer payment recorded here';
COMMENT ON TABLE staff_activity_log IS 'Audit log of all staff actions';
