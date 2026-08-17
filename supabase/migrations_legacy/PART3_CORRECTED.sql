-- ═══════════════════════════════════════════════════════════════
-- PART 3 CORRECTED: Uses existing schema column names
-- wallets.owner_id (NOT owner_user_id)
-- wallets.available_balance / pending_balance / frozen_balance / total_withdrawn
-- ═══════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- 1. BOOKING STATUS LABELS (reference table, nothing hardcoded)
-- ═══════════════════════════════════════════════════════════════

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

-- RLS: Everyone can read
ALTER TABLE booking_status_labels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bstatus_read" ON booking_status_labels;
CREATE POLICY "bstatus_read" ON booking_status_labels FOR SELECT TO authenticated USING (true);

-- ═══════════════════════════════════════════════════════════════
-- 2. WORKER BOOKINGS (escrow-based booking system)
-- ═══════════════════════════════════════════════════════════════

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
  -- Paystack payment tracking
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

-- RLS
ALTER TABLE worker_bookings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wb_user_sel" ON worker_bookings;
DROP POLICY IF EXISTS "wb_worker_sel" ON worker_bookings;
DROP POLICY IF EXISTS "wb_creator_sel" ON worker_bookings;
DROP POLICY IF EXISTS "wb_ins" ON worker_bookings;
DROP POLICY IF EXISTS "wb_upd" ON worker_bookings;

CREATE POLICY "wb_user_sel" ON worker_bookings FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.auth_id = auth.uid()::text AND profiles.user_id = worker_bookings.user_id));
CREATE POLICY "wb_worker_sel" ON worker_bookings FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.auth_id = auth.uid()::text AND profiles.user_id = worker_bookings.worker_id));
CREATE POLICY "wb_creator_sel" ON worker_bookings FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.auth_id = auth.uid()::text AND profiles.role IN ('creator', 'admin')));
CREATE POLICY "wb_ins" ON worker_bookings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "wb_upd" ON worker_bookings FOR UPDATE TO authenticated USING (true);

-- ═══════════════════════════════════════════════════════════════
-- 3. BOOKING STATUS HISTORY (permanent audit log)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS booking_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES worker_bookings(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT,
  changed_by TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE booking_status_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bsh_sel" ON booking_status_history;
DROP POLICY IF EXISTS "bsh_ins" ON booking_status_history;
CREATE POLICY "bsh_sel" ON booking_status_history FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM worker_bookings wb WHERE wb.id = booking_status_history.booking_id AND (wb.user_id IN (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text) OR wb.worker_id IN (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text))));
CREATE POLICY "bsh_ins" ON booking_status_history FOR INSERT TO authenticated WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════
-- 4. BANK ACCOUNTS (saved once, verified through Paystack)
-- ═══════════════════════════════════════════════════════════════

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

ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ba_owner" ON bank_accounts;
CREATE POLICY "ba_owner" ON bank_accounts FOR ALL TO authenticated
  USING (user_id IN (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text));

-- ═══════════════════════════════════════════════════════════════
-- 5. WITHDRAWAL REQUESTS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  user_id TEXT NOT NULL REFERENCES profiles(user_id),
  amount NUMERIC NOT NULL,
  bank_account_number TEXT,
  bank_code TEXT,
  bank_name TEXT,
  account_name TEXT,
  paystack_transfer_code TEXT,
  paystack_status TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  processed_at TIMESTAMPTZ,
  failed_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE withdrawal_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wr_owner" ON withdrawal_requests;
DROP POLICY IF EXISTS "wr_creator" ON withdrawal_requests;
CREATE POLICY "wr_owner" ON withdrawal_requests FOR ALL TO authenticated
  USING (user_id IN (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text));
CREATE POLICY "wr_creator" ON withdrawal_requests FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.auth_id = auth.uid()::text AND profiles.role IN ('creator', 'admin')));

-- ═══════════════════════════════════════════════════════════════
-- 6. CORE FUNCTIONS (using EXISTING schema column names)
-- ═══════════════════════════════════════════════════════════════

-- Drop old versions first
DROP FUNCTION IF EXISTS public.process_booking_payment(uuid,text,numeric);
DROP FUNCTION IF EXISTS public.release_escrow(uuid,text);
DROP FUNCTION IF EXISTS public.request_withdrawal(text,numeric);
DROP FUNCTION IF EXISTS public.calculate_commission(numeric,text);

-- Function: Process payment into escrow
-- Uses wallets.owner_id (not owner_user_id)
CREATE OR REPLACE FUNCTION public.process_booking_payment(
  p_booking_id UUID,
  p_paystack_reference TEXT,
  p_amount NUMERIC
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_booking RECORD;
  v_wallet RECORD;
BEGIN
  SELECT * INTO v_booking FROM worker_bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  
  -- Update booking to paid
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
  
  -- Get wallet for worker (uses owner_id, NOT owner_user_id)
  SELECT * INTO v_wallet FROM wallets WHERE owner_id = v_booking.worker_id;
  
  IF v_wallet.id IS NULL THEN
    -- Create wallet using correct column name: owner_id
    INSERT INTO wallets (owner_id, owner_type, pending_balance)
    VALUES (v_booking.worker_id, 'worker', p_amount);
  ELSE
    -- Update existing wallet
    UPDATE wallets SET 
      pending_balance = COALESCE(pending_balance, 0) + p_amount,
      updated_at = NOW()
    WHERE id = v_wallet.id;
  END IF;
  
  RETURN TRUE;
END;
$$;

-- Function: Release escrow after job completion
-- Uses correct column names: available_balance, pending_balance
CREATE OR REPLACE FUNCTION public.release_escrow(
  p_booking_id UUID,
  p_released_by TEXT DEFAULT 'system'
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_booking RECORD;
  v_wallet RECORD;
  v_net_amount NUMERIC;
BEGIN
  SELECT * INTO v_booking FROM worker_bookings WHERE id = p_booking_id;
  IF NOT FOUND OR v_booking.status NOT IN ('completed', 'confirmed') THEN RETURN FALSE; END IF;
  
  v_net_amount := v_booking.total_amount - v_booking.wehouse_fee;
  
  -- Get wallet using owner_id
  SELECT * INTO v_wallet FROM wallets WHERE owner_id = v_booking.worker_id;
  IF v_wallet.id IS NULL THEN RETURN FALSE; END IF;
  
  -- Move from pending to available (correct column names)
  UPDATE wallets SET 
    pending_balance = GREATEST(COALESCE(pending_balance, 0) - v_booking.total_amount, 0),
    available_balance = COALESCE(available_balance, 0) + v_net_amount,
    updated_at = NOW()
  WHERE id = v_wallet.id;
  
  -- Update booking
  UPDATE worker_bookings SET 
    escrow_released_at = NOW(),
    released_amount = v_net_amount,
    updated_at = NOW()
  WHERE id = p_booking_id;
  
  RETURN TRUE;
END;
$$;

-- Function: Request withdrawal
-- Uses correct column: wallets.owner_id
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
  -- Get wallet by owner_id
  SELECT * INTO v_wallet FROM wallets WHERE owner_id = p_user_id;
  IF NOT FOUND OR COALESCE(v_wallet.available_balance, 0) < p_amount THEN
    RETURN;
  END IF;
  
  -- Get default bank account
  SELECT * INTO v_bank FROM bank_accounts 
  WHERE user_id = p_user_id
  ORDER BY is_default DESC, created_at DESC LIMIT 1;
  
  -- Deduct from available balance
  UPDATE wallets SET 
    available_balance = COALESCE(available_balance, 0) - p_amount,
    total_withdrawn = COALESCE(total_withdrawn, 0) + p_amount,
    updated_at = NOW()
  WHERE id = v_wallet.id;
  
  -- Create withdrawal request
  RETURN QUERY
  INSERT INTO withdrawal_requests (wallet_id, user_id, amount, bank_account_number, bank_code, bank_name, account_name)
  VALUES (v_wallet.id, p_user_id, p_amount, v_bank.account_number, v_bank.bank_code, v_bank.bank_name, v_bank.account_name)
  RETURNING id, (p_amount * 100)::INT;
END;
$$;

-- Function: Commission from Creator settings
CREATE OR REPLACE FUNCTION public.calculate_commission(
  p_amount NUMERIC,
  p_commission_type TEXT DEFAULT 'worker'
)
RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_percent NUMERIC;
BEGIN
  SELECT (value::NUMERIC) INTO v_percent 
  FROM platform_settings 
  WHERE key = CASE 
    WHEN p_commission_type = 'worker' THEN 'commission_rate_worker'
    WHEN p_commission_type = 'property' THEN 'commission_rate_property'
    WHEN p_commission_type = 'hotel' THEN 'commission_rate_hotel'
    ELSE 'commission_rate_default'
  END;
  
  IF v_percent IS NULL THEN v_percent := 10; END IF;
  
  RETURN ROUND(p_amount * (v_percent / 100), 2);
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 7. GRANT PERMISSIONS
-- ═══════════════════════════════════════════════════════════════

GRANT EXECUTE ON FUNCTION public.process_booking_payment TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_escrow TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_withdrawal TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_commission TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- DONE. Uses existing schema: wallets.owner_id, wallets.available_balance, etc.
-- ═══════════════════════════════════════════════════════════════
