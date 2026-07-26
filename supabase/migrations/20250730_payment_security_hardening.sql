-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION: Payment Security Hardening
-- Date: 2025-07-30
-- 
-- 1. payment_reversals table (immutable history)
-- 2. Add purpose + verified_amount + verified_at to booking_payments
-- 3. Update confirm_booking_payment to verify amount/purpose
-- 4. Bank validation tracking
-- 5. Withdrawal bank snapshot
-- ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
-- PART 1: PAYMENT REVERSALS (immutable history)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS payment_reversals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_payment_id UUID NOT NULL REFERENCES booking_payments(id),
  original_reference TEXT NOT NULL,
  reversal_type TEXT NOT NULL CHECK (reversal_type IN ('refund', 'chargeback', 'admin_reversal')),
  original_amount NUMERIC NOT NULL,
  reversal_amount NUMERIC NOT NULL,
  net_after_reversal NUMERIC NOT NULL,
  reason TEXT,
  processed_by TEXT,
  reversal_reference TEXT,  -- Paystack refund reference if applicable
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE payment_reversals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff_admin_reversals" ON payment_reversals;
CREATE POLICY "staff_admin_reversals" ON payment_reversals
  FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin')));

-- ═══════════════════════════════════════════════════════════════════
-- PART 2: ADD VERIFICATION COLUMNS TO booking_payments
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE booking_payments
  ADD COLUMN IF NOT EXISTS purpose TEXT CHECK (purpose IN (
    'apartment_reservation', 'apartment_rent', 'worker_booking',
    'hotel_reservation', 'hotel_booking', 'rent_plan_contribution',
    'worker_verification', 'other'
  )),
  ADD COLUMN IF NOT EXISTS verified_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_source TEXT CHECK (verification_source IN ('webhook', 'edge_function', 'manual'));

-- ═══════════════════════════════════════════════════════════════════
-- PART 3: REVERSE PAYMENT RPC (immutable — never delete)
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION reverse_payment(
  p_payment_id UUID,
  p_reversal_type TEXT,
  p_reason TEXT DEFAULT NULL,
  p_reversal_reference TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_payment RECORD;
  v_processed_by TEXT;
  v_net NUMERIC;
BEGIN
  SELECT user_id INTO v_processed_by FROM profiles WHERE auth_id = auth.uid()::text;
  SELECT * INTO v_payment FROM booking_payments WHERE id = p_payment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF v_payment.status IN ('refunded', 'disputed') THEN RAISE EXCEPTION 'Already reversed'; END IF;

  v_net := 0;  -- After full reversal, net is 0

  -- Record reversal
  INSERT INTO payment_reversals (
    original_payment_id, original_reference, reversal_type,
    original_amount, reversal_amount, net_after_reversal,
    reason, processed_by, reversal_reference
  ) VALUES (
    p_payment_id, v_payment.paystack_reference, p_reversal_type,
    v_payment.amount_total, v_payment.amount_total, v_net,
    p_reason, v_processed_by, p_reversal_reference
  );

  -- Mark payment as refunded
  UPDATE booking_payments
  SET status = 'refunded', updated_at = NOW()
  WHERE id = p_payment_id;

  -- Mark commission as refunded
  UPDATE commission_ledger
  SET status = 'refunded', updated_at = NOW()
  WHERE payment_id = p_payment_id;

  -- If worker wallet was credited, flag for review
  -- (actual debit requires business rules — logged for review)
  INSERT INTO financial_audit_logs (event_type, user_id, amount, reference_id, reference_type, description)
  VALUES ('payment_reversed', v_payment.payee_user_id, v_payment.amount_total,
          p_payment_id::text, 'booking_payment',
          'Payment reversed: ' || p_reversal_type || '. Worker may need debit.');

  RETURN TRUE;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- PART 4: BANK VALIDATION TRACKING
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS bank_account_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  bank_code TEXT,
  bank_account_number TEXT NOT NULL,
  bank_account_name TEXT NOT NULL,
  verified_account_name TEXT,  -- From Paystack Resolve API
  is_verified BOOLEAN NOT NULL DEFAULT false,
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  changed_by TEXT
);

ALTER TABLE bank_account_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_own_bank" ON bank_account_history;
CREATE POLICY "user_own_bank" ON bank_account_history
  FOR SELECT USING (auth.uid()::text = user_id);
DROP POLICY IF EXISTS "staff_admin_all_bank" ON bank_account_history;
CREATE POLICY "staff_admin_all_bank" ON bank_account_history
  FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin')));

-- ═══════════════════════════════════════════════════════════════════
-- PART 5: WITHDRAWAL BANK SNAPSHOT
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS snapshot_bank_name TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_bank_account_number TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_bank_account_name TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_bank_code TEXT;

-- Function: create withdrawal with bank snapshot
CREATE OR REPLACE FUNCTION create_withdrawal_with_snapshot(
  p_wallet_id UUID,
  p_amount NUMERIC
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_wallet RECORD;
  v_withdrawal_id UUID;
  v_min_withdrawal NUMERIC;
BEGIN
  SELECT COALESCE(NULLIF(value, '')::NUMERIC, 5000)
  INTO v_min_withdrawal FROM platform_settings WHERE key = 'min_withdrawal';

  SELECT * INTO v_wallet FROM wallets WHERE id = p_wallet_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet not found'; END IF;

  IF p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be > 0'; END IF;
  IF p_amount < v_min_withdrawal THEN RAISE EXCEPTION 'Min: N%', v_min_withdrawal; END IF;
  IF p_amount > v_wallet.available_balance THEN RAISE EXCEPTION 'Insufficient balance'; END IF;

  -- Move from available to frozen
  UPDATE wallets
  SET available_balance = available_balance - p_amount,
      frozen_balance = frozen_balance + p_amount,
      updated_at = NOW()
  WHERE id = p_wallet_id;

  -- Create withdrawal WITH bank snapshot from wallet
  INSERT INTO withdrawals (
    wallet_id, amount, status,
    bank_name, account_number, account_name,
    snapshot_bank_name, snapshot_bank_account_number,
    snapshot_bank_account_name, snapshot_bank_code
  ) VALUES (
    p_wallet_id, p_amount, 'pending',
    v_wallet.bank_name, v_wallet.bank_account_number, v_wallet.bank_account_name,
    v_wallet.bank_name, v_wallet.bank_account_number,
    v_wallet.bank_account_name, NULL
  ) RETURNING id INTO v_withdrawal_id;

  INSERT INTO financial_audit_logs (event_type, user_id, amount, reference_id, reference_type, description)
  VALUES ('withdrawal_snapshot', v_wallet.owner_id, p_amount, v_withdrawal_id::text, 'withdrawal',
          'Bank snapshot: ' || v_wallet.bank_name || ' / ' || v_wallet.bank_account_number);

  RETURN v_withdrawal_id;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- PART 6: RECORD BANK ACCOUNT CHANGE
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION record_bank_account_change(
  p_user_id TEXT,
  p_bank_name TEXT,
  p_bank_code TEXT,
  p_bank_account_number TEXT,
  p_bank_account_name TEXT,
  p_verified_account_name TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_changed_by TEXT;
BEGIN
  SELECT user_id INTO v_changed_by FROM profiles WHERE auth_id = auth.uid()::text;

  INSERT INTO bank_account_history (
    user_id, bank_name, bank_code, bank_account_number,
    bank_account_name, verified_account_name,
    is_verified, changed_by
  ) VALUES (
    p_user_id, p_bank_name, p_bank_code, p_bank_account_number,
    p_bank_account_name, p_verified_account_name,
    p_verified_account_name IS NOT NULL, v_changed_by
  );

  INSERT INTO financial_audit_logs (event_type, user_id, reference_id, reference_type, description)
  VALUES (
    'bank_account_change', p_user_id, p_user_id, 'profile',
    'Bank changed to: ' || p_bank_name || ' / ' || p_bank_account_number
  );

  RETURN TRUE;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- PART 7: UPDATE confirm_booking_payment TO VERIFY AMOUNT/PURPOSE
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION confirm_booking_payment(
  p_reference TEXT,
  p_transaction_id TEXT DEFAULT NULL,
  p_verified_amount NUMERIC DEFAULT NULL,
  p_verification_source TEXT DEFAULT 'webhook',
  p_purpose TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_payment RECORD;
BEGIN
  -- Lock row for idempotency
  SELECT * INTO v_payment FROM booking_payments
  WHERE paystack_reference = p_reference
  FOR UPDATE SKIP LOCKED;

  IF v_payment IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment not found');
  END IF;

  -- Already processed = idempotent
  IF v_payment.status = 'paid' THEN
    RETURN jsonb_build_object('success', true, 'already_processed', true);
  END IF;

  -- Verify amount matches (if provided)
  IF p_verified_amount IS NOT NULL AND p_verified_amount != v_payment.amount_total THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount mismatch',
      'expected', v_payment.amount_total, 'verified', p_verified_amount);
  END IF;

  -- Verify purpose matches (if provided)
  IF p_purpose IS NOT NULL AND v_payment.purpose IS NOT NULL AND p_purpose != v_payment.purpose THEN
    RETURN jsonb_build_object('success', false, 'error', 'Purpose mismatch');
  END IF;

  -- Mark as paid
  UPDATE booking_payments SET
    status = 'paid',
    paystack_transaction_id = COALESCE(p_transaction_id, paystack_transaction_id),
    verified_amount = p_verified_amount,
    verified_at = NOW(),
    verification_source = p_verification_source,
    paid_at = NOW(),
    webhook_processed = true,
    updated_at = NOW()
  WHERE id = v_payment.id;

  -- Record commission
  INSERT INTO commission_ledger (
    payment_id, booking_type, source_user_id,
    commission_amount, commission_rate, gross_amount,
    description, paystack_reference
  ) VALUES (
    v_payment.id, v_payment.booking_type, v_payment.payee_user_id,
    v_payment.amount_commission, v_payment.commission_rate, v_payment.amount_total,
    format('Commission from %s booking (N%s)', v_payment.booking_type, v_payment.amount_total),
    p_reference
  );

  RETURN jsonb_build_object('success', true, 'payment_id', v_payment.id);
END;
$$;
