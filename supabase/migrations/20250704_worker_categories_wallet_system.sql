-- ═══════════════════════════════════════════════════════════════
-- WEHOUSE WORKER SYSTEM: Categories, Verification, Wallet, Payouts
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. SERVICE CATEGORIES ───────────────────────────────────
CREATE TABLE IF NOT EXISTS service_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                    -- e.g. "Beauty", "Home Services"
  icon TEXT DEFAULT '',                  -- emoji or icon name
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_by TEXT REFERENCES profiles(user_id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_categories_active ON service_categories(is_active);

-- ─── 2. SERVICE SUBCATEGORIES ────────────────────────────────
CREATE TABLE IF NOT EXISTS service_subcategories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES service_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                    -- e.g. "Barber", "Electrician"
  icon TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_subcategories_category ON service_subcategories(category_id);
CREATE INDEX IF NOT EXISTS idx_service_subcategories_active ON service_subcategories(is_active);

-- ─── 3. WORKER VERIFICATION SUBMISSIONS ──────────────────────
CREATE TABLE IF NOT EXISTS worker_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id TEXT NOT NULL REFERENCES profiles(user_id),
  
  -- Documents
  gov_id_type TEXT,                      -- "nin", "drivers_license", "passport", "voters_card"
  gov_id_number TEXT,
  gov_id_photo_url TEXT,
  selfie_photo_url TEXT,
  verification_video_url TEXT,
  
  -- Work info
  years_of_experience INTEGER DEFAULT 0,
  service_category_id UUID REFERENCES service_categories(id),
  service_subcategory_id UUID REFERENCES service_subcategories(id),
  
  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'under_review', 'approved', 'rejected')),
  reviewed_by TEXT REFERENCES profiles(user_id),
  review_notes TEXT,
  reviewed_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_worker_verifications_worker ON worker_verifications(worker_id);
CREATE INDEX IF NOT EXISTS idx_worker_verifications_status ON worker_verifications(status);

-- ─── 4. BLUE BADGE SUBSCRIPTIONS ─────────────────────────────
CREATE TABLE IF NOT EXISTS blue_badge_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id TEXT NOT NULL REFERENCES profiles(user_id),
  
  status TEXT DEFAULT 'inactive' CHECK (status IN ('active', 'inactive', 'expired', 'cancelled')),
  
  started_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  
  paystack_reference TEXT,
  paystack_subscription_code TEXT,
  
  amount_paid DECIMAL(12,2) DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blue_badge_worker ON blue_badge_subscriptions(worker_id);
CREATE INDEX IF NOT EXISTS idx_blue_badge_status ON blue_badge_subscriptions(status);

-- ─── 5. WALLETS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL REFERENCES profiles(user_id),
  owner_type TEXT NOT NULL CHECK (owner_type IN ('worker', 'property_partner')),
  
  -- Balances (in kobo/ smallest currency unit to avoid float issues)
  available_balance DECIMAL(12,2) DEFAULT 0,    -- can withdraw
  pending_balance DECIMAL(12,2) DEFAULT 0,      -- in escrow
  frozen_balance DECIMAL(12,2) DEFAULT 0,       -- held/disputed
  total_withdrawn DECIMAL(12,2) DEFAULT 0,
  
  -- Bank details for payouts
  bank_name TEXT,
  bank_account_number TEXT,
  bank_account_name TEXT,
  paystack_recipient_code TEXT,
  
  is_frozen BOOLEAN DEFAULT FALSE,
  frozen_reason TEXT,
  frozen_by TEXT REFERENCES profiles(user_id),
  frozen_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(owner_id, owner_type)
);

CREATE INDEX IF NOT EXISTS idx_wallets_owner ON wallets(owner_id);
CREATE INDEX IF NOT EXISTS idx_wallets_frozen ON wallets(is_frozen);

-- ─── 6. ESCROW TRANSACTIONS ──────────────────────────────────
CREATE TABLE IF NOT EXISTS escrow_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference TEXT UNIQUE NOT NULL,           -- e.g. "WHESC-123456"
  
  -- What was paid for
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('worker_booking', 'property_rental', 'hotel_booking', 'reservation')),
  booking_id UUID,
  
  -- Who paid
  customer_id TEXT NOT NULL REFERENCES profiles(user_id),
  
  -- Who receives (after WeHouse commission)
  worker_id TEXT REFERENCES profiles(user_id),
  partner_id UUID REFERENCES property_partners(id),
  
  -- Money
  gross_amount DECIMAL(12,2) NOT NULL,     -- what customer paid
  wehouse_commission DECIMAL(12,2) DEFAULT 0,
  net_amount DECIMAL(12,2) NOT NULL,       -- what goes to worker/partner
  security_deposit DECIMAL(12,2) DEFAULT 0, -- held separately
  
  -- Status
  status TEXT DEFAULT 'held' CHECK (status IN ('held', 'released', 'refunded', 'disputed', 'partially_refunded')),
  
  -- Paystack
  paystack_reference TEXT,
  paystack_transaction_id TEXT,
  
  released_at TIMESTAMPTZ,
  released_to_wallet_id UUID REFERENCES wallets(id),
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_escrow_customer ON escrow_transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_escrow_worker ON escrow_transactions(worker_id);
CREATE INDEX IF NOT EXISTS idx_escrow_partner ON escrow_transactions(partner_id);
CREATE INDEX IF NOT EXISTS idx_escrow_status ON escrow_transactions(status);

-- ─── 7. WALLET TRANSACTIONS (history) ────────────────────────
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  
  type TEXT NOT NULL CHECK (type IN ('credit', 'debit', 'escrow_release', 'withdrawal', 'refund', 'commission', 'freeze', 'unfreeze')),
  amount DECIMAL(12,2) NOT NULL,
  
  description TEXT,
  reference TEXT,                          -- links to escrow, withdrawal, etc.
  
  balance_after DECIMAL(12,2) NOT NULL,
  
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_wallet ON wallet_transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_type ON wallet_transactions(type);

-- ─── 8. WITHDRAWALS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  
  amount DECIMAL(12,2) NOT NULL,
  
  -- Paystack Transfer
  paystack_transfer_reference TEXT,
  paystack_transfer_code TEXT,
  
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'successful', 'failed', 'reversed')),
  
  -- Bank details used
  bank_name TEXT,
  bank_account_number TEXT,
  bank_account_name TEXT,
  
  -- Timestamps
  processed_at TIMESTAMPTZ,
  failed_reason TEXT,
  reversed_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_wallet ON withdrawals(wallet_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);

-- ─── 9. FINANCIAL AUDIT LOGS ─────────────────────────────────
CREATE TABLE IF NOT EXISTS financial_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  event_type TEXT NOT NULL CHECK (event_type IN (
    'customer_payment', 'escrow_created', 'escrow_released', 'escrow_refunded',
    'withdrawal_requested', 'withdrawal_processing', 'withdrawal_successful', 
    'withdrawal_failed', 'withdrawal_reversed', 'wallet_frozen', 'wallet_unfrozen',
    'commission_deducted', 'security_deposit_held', 'security_deposit_released',
    'security_deposit_claimed', 'blue_badge_purchased', 'blue_badge_renewed',
    'dispute_opened', 'dispute_resolved', 'manual_adjustment'
  )),
  
  user_id TEXT REFERENCES profiles(user_id),
  target_user_id TEXT REFERENCES profiles(user_id),
  
  amount DECIMAL(12,2),
  reference_id TEXT,                       -- links to escrow/withdrawal/wallet
  reference_type TEXT,
  
  description TEXT,
  metadata JSONB DEFAULT '{}',
  
  ip_address TEXT,
  user_agent TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_event_type ON financial_audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_user ON financial_audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON financial_audit_logs(created_at);

-- ─── 10. RLS POLICIES ────────────────────────────────────────

-- Service categories: staff can read, creator can manage
ALTER TABLE service_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_categories_public" ON service_categories;
CREATE POLICY "service_categories_public" ON service_categories FOR SELECT TO authenticated USING (true);

ALTER TABLE service_subcategories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_subcategories_public" ON service_subcategories;
CREATE POLICY "service_subcategories_public" ON service_subcategories FOR SELECT TO authenticated USING (true);

-- Worker verifications: worker sees own, staff sees all
ALTER TABLE worker_verifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "worker_verifications_own" ON worker_verifications;
DROP POLICY IF EXISTS "worker_verifications_staff" ON worker_verifications;
CREATE POLICY "worker_verifications_own" ON worker_verifications FOR SELECT TO authenticated USING (worker_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1));
CREATE POLICY "worker_verifications_staff" ON worker_verifications FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin')));

-- Wallets: owner sees own, staff sees all
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wallets_own" ON wallets;
DROP POLICY IF EXISTS "wallets_staff" ON wallets;
CREATE POLICY "wallets_own" ON wallets FOR SELECT TO authenticated USING (owner_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1));
CREATE POLICY "wallets_staff" ON wallets FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin')));

-- Escrow: involved parties see own, staff see all
ALTER TABLE escrow_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "escrow_involved" ON escrow_transactions;
DROP POLICY IF EXISTS "escrow_staff" ON escrow_transactions;
CREATE POLICY "escrow_involved" ON escrow_transactions FOR SELECT TO authenticated USING (
  customer_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
  OR worker_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
);
CREATE POLICY "escrow_staff" ON escrow_transactions FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin')));

-- Wallet transactions: wallet owner sees own, staff sees all
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wallet_tx_owner" ON wallet_transactions;
DROP POLICY IF EXISTS "wallet_tx_staff" ON wallet_transactions;
CREATE POLICY "wallet_tx_owner" ON wallet_transactions FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM wallets WHERE wallets.id = wallet_transactions.wallet_id AND wallets.owner_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1))
);
CREATE POLICY "wallet_tx_staff" ON wallet_transactions FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin')));

-- Withdrawals: wallet owner sees own, staff sees all
ALTER TABLE withdrawals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "withdrawals_owner" ON withdrawals;
DROP POLICY IF EXISTS "withdrawals_staff" ON withdrawals;
CREATE POLICY "withdrawals_owner" ON withdrawals FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM wallets WHERE wallets.id = withdrawals.wallet_id AND wallets.owner_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1))
);
CREATE POLICY "withdrawals_staff" ON withdrawals FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin')));

-- Audit logs: staff only
ALTER TABLE financial_audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_staff" ON financial_audit_logs;
CREATE POLICY "audit_staff" ON financial_audit_logs FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin')));

-- Blue badge: worker sees own, staff sees all
ALTER TABLE blue_badge_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "blue_badge_own" ON blue_badge_subscriptions;
DROP POLICY IF EXISTS "blue_badge_staff" ON blue_badge_subscriptions;
CREATE POLICY "blue_badge_own" ON blue_badge_subscriptions FOR SELECT TO authenticated USING (worker_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1));
CREATE POLICY "blue_badge_staff" ON blue_badge_subscriptions FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin')));

-- ─── 11. SEED DEFAULT CATEGORIES ─────────────────────────────
INSERT INTO service_categories (name, icon, sort_order) VALUES
  ('Home Services', '🔧', 1),
  ('Cleaning', '🧹', 2),
  ('Beauty', '💇', 3),
  ('Events', '🎉', 4),
  ('Moving & Delivery', '🚚', 5),
  ('Auto Services', '🚗', 6),
  ('Technology', '💻', 7),
  ('Gardening', '🌱', 8),
  ('Security', '🛡️', 9),
  ('Health & Care', '🏥', 10),
  ('Education', '📚', 11),
  ('Tailoring & Fashion', '👗', 12),
  ('Agriculture', '🌾', 13),
  ('Other Services', '🔨', 14)
ON CONFLICT DO NOTHING;

-- Insert subcategories (will match to correct category_ids via the trigger below)
-- Note: We'll do this in app code since we need the category UUIDs
