-- ═══════════════════════════════════════════════════════════════
-- PART 3: Bookings, Payments, Wallets & Escrow
-- Money flow architecture for WeHouse
-- ═══════════════════════════════════════════════════════════════

-- Step 1: Booking statuses reference table (nothing hardcoded)
CREATE TABLE IF NOT EXISTS booking_status_labels (
  status_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  color TEXT DEFAULT '#5C5E72',
  description TEXT,
  sort_order INT DEFAULT 0
);

INSERT INTO booking_status_labels (status_key, label, color, description, sort_order) VALUES
  ('pending', 'Pending', '#F59E0B', 'Booking request sent, awaiting worker response', 1),
  ('accepted', 'Accepted', '#3B82F6', 'Worker accepted, awaiting payment', 2),
  ('awaiting_payment', 'Awaiting Payment', '#8B5CF6', 'Payment required to proceed', 3),
  ('paid', 'Paid', '#22C55E', 'Payment received, held in escrow', 4),
  ('in_progress', 'In Progress', '#06B6D4', 'Worker performing the job', 5),
  ('completed', 'Completed', '#14B8A6', 'Job done, awaiting confirmation', 6),
  ('confirmed', 'Confirmed', '#10B981', 'User confirmed completion', 7),
  ('cancelled', 'Cancelled', '#EF4444', 'Booking cancelled', 8),
  ('disputed', 'Disputed', '#EC4899', 'Under dispute resolution', 9),
  ('refunded', 'Refunded', '#6B7280', 'Payment refunded', 10)
ON CONFLICT (status_key) DO NOTHING;

ALTER TABLE booking_status_labels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "booking_labels_read" ON booking_status_labels;
CREATE POLICY "booking_labels_read" ON booking_status_labels FOR SELECT TO authenticated USING (true);

-- Step 2: Worker bookings table (escrow-based)
CREATE TABLE IF NOT EXISTS worker_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES profiles(user_id),
  worker_id TEXT NOT NULL REFERENCES profiles(user_id),
  service_type TEXT,
  agreed_price NUMERIC NOT NULL DEFAULT 0,
  wehouse_fee NUMERIC NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  commission_percent NUMERIC NOT NULL DEFAULT 10,
  status TEXT DEFAULT 'pending',
  scheduled_date DATE,
  scheduled_time TEXT,
  address TEXT,
  notes TEXT,
  -- Payment tracking
  paystack_reference TEXT,
  paystack_status TEXT,
  paid_at TIMESTAMPTZ,
  -- Completion tracking
  worker_completed_at TIMESTAMPTZ,
  user_confirmed_at TIMESTAMPTZ,
  dispute_period_ends_at TIMESTAMPTZ,
  -- Escrow release
  escrow_released_at TIMESTAMPTZ,
  released_amount NUMERIC DEFAULT 0,
  -- Cancellation
  cancelled_by TEXT,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  -- Meta
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 3: Booking status history (permanent audit)
CREATE TABLE IF NOT EXISTS booking_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES worker_bookings(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT,
  changed_by TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 4: Wallets (Workers and Property Partners only)
CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id TEXT NOT NULL UNIQUE REFERENCES profiles(user_id),
  owner_type TEXT NOT NULL CHECK (owner_type IN ('worker', 'property_partner', 'hotel_partner')),
  available_balance NUMERIC NOT NULL DEFAULT 0,
  pending_balance NUMERIC NOT NULL DEFAULT 0,
  total_earned NUMERIC NOT NULL DEFAULT 0,
  total_withdrawn NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 5: Wallet transactions (permanent audit log)
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('earning', 'withdrawal', 'refund', 'fee', 'commission', 'deposit_release')),
  amount NUMERIC NOT NULL,
  commission_amount NUMERIC DEFAULT 0,
  net_amount NUMERIC,
  currency TEXT DEFAULT 'NGN',
  -- References
  booking_id UUID REFERENCES worker_bookings(id),
  listing_id UUID,
  hotel_booking_id UUID,
  -- Paystack
  paystack_reference TEXT,
  paystack_transfer_code TEXT,
  paystack_status TEXT,
  -- Status
  status TEXT DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed', 'reversed')),
  -- Description
  description TEXT,
  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Step 6: Withdrawal requests
CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  user_id TEXT NOT NULL REFERENCES profiles(user_id),
  amount NUMERIC NOT NULL,
  bank_account_number TEXT,
  bank_code TEXT,
  bank_name TEXT,
  account_name TEXT,
  -- Paystack
  paystack_transfer_code TEXT,
  paystack_status TEXT,
  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  processed_at TIMESTAMPTZ,
  failed_reason TEXT,
  -- Meta
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 7: Bank accounts (saved once, verified through Paystack)
CREATE TABLE IF NOT EXISTS bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES profiles(user_id),
  account_number TEXT NOT NULL,
  bank_code TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  account_name TEXT,
  paystack_recipient_code TEXT,
  is_default BOOLEAN DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, account_number, bank_code)
);

-- Step 8: RLS Policies
ALTER TABLE worker_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;

-- Worker bookings: user or worker can see their own bookings
DROP POLICY IF EXISTS "bookings_user_select" ON worker_bookings;
DROP POLICY IF EXISTS "bookings_worker_select" ON worker_bookings;
DROP POLICY IF EXISTS "bookings_insert" ON worker_bookings;
DROP POLICY IF EXISTS "bookings_update" ON worker_bookings;

CREATE POLICY "bookings_user_select" ON worker_bookings FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.auth_id = auth.uid()::text AND profiles.user_id = worker_bookings.user_id));
CREATE POLICY "bookings_worker_select" ON worker_bookings FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.auth_id = auth.uid()::text AND profiles.user_id = worker_bookings.worker_id));
CREATE POLICY "bookings_creator_select" ON worker_bookings FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.auth_id = auth.uid()::text AND profiles.role IN ('creator', 'admin')));
CREATE POLICY "bookings_insert" ON worker_bookings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "bookings_update" ON worker_bookings FOR UPDATE TO authenticated USING (true);

-- Booking status history
DROP POLICY IF EXISTS "booking_history_select" ON booking_status_history;
CREATE POLICY "booking_history_select" ON booking_status_history FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM worker_bookings wb WHERE wb.id = booking_status_history.booking_id AND (wb.user_id IN (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text) OR wb.worker_id IN (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text))));
CREATE POLICY "booking_history_insert" ON booking_status_history FOR INSERT TO authenticated WITH CHECK (true);

-- Wallets: owner only (unless creator/admin)
DROP POLICY IF EXISTS "wallet_owner" ON wallets;
DROP POLICY IF EXISTS "wallet_creator" ON wallets;
CREATE POLICY "wallet_owner" ON wallets FOR ALL TO authenticated
  USING (owner_user_id IN (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text));
CREATE POLICY "wallet_creator" ON wallets FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.auth_id = auth.uid()::text AND profiles.role IN ('creator', 'admin')));

-- Wallet transactions
DROP POLICY IF EXISTS "wallet_tx_owner" ON wallet_transactions;
DROP POLICY IF EXISTS "wallet_tx_creator" ON wallet_transactions;
CREATE POLICY "wallet_tx_owner" ON wallet_transactions FOR SELECT TO authenticated
  USING (wallet_id IN (SELECT id FROM wallets WHERE owner_user_id IN (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text)));
CREATE POLICY "wallet_tx_creator" ON wallet_transactions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.auth_id = auth.uid()::text AND profiles.role IN ('creator', 'admin')));
CREATE POLICY "wallet_tx_insert" ON wallet_transactions FOR INSERT TO authenticated WITH CHECK (true);

-- Withdrawal requests
DROP POLICY IF EXISTS "withdrawal_owner" ON withdrawal_requests;
CREATE POLICY "withdrawal_owner" ON withdrawal_requests FOR ALL TO authenticated
  USING (user_id IN (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text));
CREATE POLICY "withdrawal_creator" ON withdrawal_requests FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.auth_id = auth.uid()::text AND profiles.role IN ('creator', 'admin')));

-- Bank accounts
DROP POLICY IF EXISTS "bank_account_owner" ON bank_accounts;
CREATE POLICY "bank_account_owner" ON bank_accounts FOR ALL TO authenticated
  USING (user_id IN (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text));

-- Step 9: Core function — process payment into escrow
CREATE OR REPLACE FUNCTION public.process_booking_payment(
  p_booking_id UUID,
  p_paystack_reference TEXT,
  p_amount NUMERIC
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_booking RECORD;
  v_wallet_id UUID;
BEGIN
  -- Get booking
  SELECT * INTO v_booking FROM worker_bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  
  -- Update booking
  UPDATE worker_bookings SET 
    status = 'paid',
    paystack_reference = p_paystack_reference,
    paystack_status = 'success',
    paid_at = NOW(),
    dispute_period_ends_at = NOW() + INTERVAL '48 hours',
    updated_at = NOW()
  WHERE id = p_booking_id;
  
  -- Record status change
  INSERT INTO booking_status_history (booking_id, old_status, new_status, changed_by, notes)
  VALUES (p_booking_id, v_booking.status, 'paid', 'system', 'Payment received via Paystack: ' || p_paystack_reference);
  
  -- Get or create wallet for worker
  SELECT id INTO v_wallet_id FROM wallets WHERE owner_user_id = v_booking.worker_id;
  IF v_wallet_id IS NULL THEN
    INSERT INTO wallets (owner_user_id, owner_type, pending_balance)
    VALUES (v_booking.worker_id, 'worker', p_amount)
    RETURNING id INTO v_wallet_id;
  ELSE
    UPDATE wallets SET pending_balance = pending_balance + p_amount, updated_at = NOW() WHERE id = v_wallet_id;
  END IF;
  
  -- Record transaction
  INSERT INTO wallet_transactions (wallet_id, transaction_type, amount, commission_amount, net_amount, booking_id, paystack_reference, status, description)
  VALUES (v_wallet_id, 'earning', p_amount, v_booking.wehouse_fee, v_booking.total_amount - v_booking.wehouse_fee, p_booking_id, p_paystack_reference, 'pending', 'Booking payment held in escrow');
  
  RETURN TRUE;
END;
$$;

-- Step 10: Function — release escrow after job completion
CREATE OR REPLACE FUNCTION public.release_escrow(
  p_booking_id UUID,
  p_released_by TEXT DEFAULT 'system'
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_booking RECORD;
  v_wallet_id UUID;
  v_net_amount NUMERIC;
BEGIN
  SELECT * INTO v_booking FROM worker_bookings WHERE id = p_booking_id;
  IF NOT FOUND OR v_booking.status != 'confirmed' THEN RETURN FALSE; END IF;
  
  v_net_amount := v_booking.total_amount - v_booking.wehouse_fee;
  
  -- Get wallet
  SELECT id INTO v_wallet_id FROM wallets WHERE owner_user_id = v_booking.worker_id;
  IF v_wallet_id IS NULL THEN RETURN FALSE; END IF;
  
  -- Move from pending to available
  UPDATE wallets SET 
    pending_balance = GREATEST(pending_balance - v_booking.total_amount, 0),
    available_balance = available_balance + v_net_amount,
    total_earned = total_earned + v_net_amount,
    updated_at = NOW()
  WHERE id = v_wallet_id;
  
  -- Update booking
  UPDATE worker_bookings SET 
    escrow_released_at = NOW(),
    released_amount = v_net_amount,
    updated_at = NOW()
  WHERE id = p_booking_id;
  
  -- Update transaction to completed
  UPDATE wallet_transactions SET 
    status = 'completed',
    transaction_type = 'earning',
    completed_at = NOW(),
    description = 'Escrow released after job completion'
  WHERE booking_id = p_booking_id;
  
  RETURN TRUE;
END;
$$;

-- Step 11: Function — request withdrawal
CREATE OR REPLACE FUNCTION public.request_withdrawal(
  p_user_id TEXT,
  p_amount NUMERIC
)
RETURNS TABLE(withdrawal_id UUID, paystack_amount_kobo INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wallet RECORD;
  v_bank RECORD;
BEGIN
  -- Get wallet
  SELECT * INTO v_wallet FROM wallets WHERE owner_user_id = p_user_id;
  IF NOT FOUND OR v_wallet.available_balance < p_amount THEN
    RETURN;
  END IF;
  
  -- Get default bank account
  SELECT * INTO v_bank FROM bank_accounts 
  WHERE user_id = p_user_id AND verified_at IS NOT NULL
  ORDER BY is_default DESC, created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  -- Deduct from available balance
  UPDATE wallets SET 
    available_balance = available_balance - p_amount,
    total_withdrawn = total_withdrawn + p_amount,
    updated_at = NOW()
  WHERE id = v_wallet.id;
  
  -- Create withdrawal request
  RETURN QUERY
  INSERT INTO withdrawal_requests (wallet_id, user_id, amount, bank_account_number, bank_code, bank_name, account_name, paystack_recipient_code)
  VALUES (v_wallet.id, p_user_id, p_amount, v_bank.account_number, v_bank.bank_code, v_bank.bank_name, v_bank.account_name, v_bank.paystack_recipient_code)
  RETURNING id, (p_amount * 100)::INT;
END;
$$;

-- Step 12: Commission calculation from Creator settings
CREATE OR REPLACE FUNCTION public.calculate_commission(
  p_amount NUMERIC,
  p_commission_type TEXT DEFAULT 'worker'
)
RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_percent NUMERIC;
BEGIN
  -- Get commission rate from platform_settings
  SELECT (value::NUMERIC) INTO v_percent 
  FROM platform_settings 
  WHERE key = CASE 
    WHEN p_commission_type = 'worker' THEN 'commission_rate_worker'
    WHEN p_commission_type = 'property' THEN 'commission_rate_property'
    WHEN p_commission_type = 'hotel' THEN 'commission_rate_hotel'
    ELSE 'commission_rate_default'
  END;
  
  IF v_percent IS NULL THEN v_percent := 10; END IF; -- default 10%
  
  RETURN ROUND(p_amount * (v_percent / 100), 2);
END;
$$;

-- Step 13: Grant permissions
GRANT EXECUTE ON FUNCTION public.process_booking_payment TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_escrow TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_withdrawal TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_commission TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- DONE. Part 3: Money flow architecture is complete.
-- ═══════════════════════════════════════════════════════════════
