-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION: Payment Security Hardening (RECONCILED FOR LIVE DB)
-- Date: 2025-07-30
--
-- RECONCILED against actual live database schema.
-- The following tables were discovered to NOT exist in production:
--   booking_payments, commission_ledger, financial_audit_logs,
--   payment_reversals, bank_account_history, verified_paystack_references
-- This migration CREATEs them instead of ALTERing them.
--
-- Tables that DO exist and are used:
--   wallets, wallet_transactions, escrow_transactions, withdrawals,
--   withdrawal_requests, worker_bookings, payments (legacy)
--
-- Schema differences handled:
--   wallet_transactions.user_id (NOT wallet_id)
--   wallet_transactions.transaction_type (NOT type)
--   escrow_transactions.amount_payee (NOT amount_worker)
--   wallets.pending_balance, paystack_recipient_code exist
--   withdrawals.paystack_transfer_reference, paystack_transfer_code exist
-- ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
-- PART 0: CREATE booking_payments (did not exist in production)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS booking_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_reference TEXT NOT NULL,
  user_id TEXT,
  payer_user_id TEXT,
  payee_user_id TEXT,
  type TEXT,
  booking_type TEXT,
  listing_id TEXT,
  hotel_booking_id INTEGER,
  amount NUMERIC(12,2),
  amount_total NUMERIC(12,2),
  amount_commission NUMERIC(12,2),
  amount_worker NUMERIC(12,2),
  commission_rate NUMERIC(5,2),
  net_amount NUMERIC(12,2),
  currency TEXT DEFAULT 'NGN',
  status TEXT DEFAULT 'pending',
  purpose TEXT CHECK (purpose IN (
    'apartment_reservation', 'apartment_rent', 'worker_booking',
    'hotel_reservation', 'hotel_booking', 'rent_plan_contribution',
    'worker_verification', 'other'
  )),
  payment_method TEXT,
  paystack_reference TEXT,
  paystack_transaction_id TEXT,
  paystack_subaccount_code TEXT,
  verified_amount NUMERIC(12,2),
  verified_at TIMESTAMPTZ,
  verification_source TEXT CHECK (verification_source IN ('webhook', 'edge_function', 'manual')),
  paid_at TIMESTAMPTZ,
  webhook_processed BOOLEAN NOT NULL DEFAULT FALSE,
  webhook_attempts INTEGER NOT NULL DEFAULT 0,
  refund_reason TEXT,
  refund_processed_at TIMESTAMPTZ,
  refund_reference TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════
-- PART 1: CREATE commission_ledger (did not exist in production)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS commission_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID REFERENCES booking_payments(id),
  booking_type TEXT,
  source_user_id TEXT,
  commission_amount NUMERIC(12,2),
  commission_rate NUMERIC(5,2),
  gross_amount NUMERIC(12,2),
  description TEXT,
  paystack_reference TEXT,
  status TEXT DEFAULT 'collected' CHECK (status IN ('collected', 'settled', 'refunded', 'disputed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════
-- PART 2: CREATE financial_audit_logs (did not exist in production)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS financial_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  user_id TEXT,
  target_user_id TEXT,
  amount NUMERIC(12,2),
  reference_id TEXT,
  reference_type TEXT,
  description TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════
-- PART 3: CREATE payment_reversals (new)
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
  reversal_reference TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE payment_reversals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff_admin_reversals" ON payment_reversals;
CREATE POLICY "staff_admin_reversals" ON payment_reversals
  FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin')));

-- ═══════════════════════════════════════════════════════════════════
-- PART 4: CREATE bank_account_history (new)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS bank_account_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  bank_code TEXT,
  bank_account_number TEXT NOT NULL,
  bank_account_name TEXT NOT NULL,
  verified_account_name TEXT,
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
-- PART 5: CREATE verified_paystack_references (idempotency)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS verified_paystack_references (
  paystack_reference TEXT PRIMARY KEY,
  booking_payment_id UUID NOT NULL REFERENCES booking_payments(id),
  verified_at TIMESTAMPTZ DEFAULT NOW(),
  verified_amount NUMERIC(12,2),
  verification_source TEXT CHECK (verification_source IN ('webhook', 'edge_function', 'manual')),
  verified_by TEXT
);

-- ═══════════════════════════════════════════════════════════════════
-- PART 6: WITHDRAWAL BANK SNAPSHOT (alter existing withdrawals table)
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS snapshot_bank_name TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_bank_account_number TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_bank_account_name TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_bank_code TEXT;

-- ═══════════════════════════════════════════════════════════════════
-- PART 7: SECURE credit_wallet RPC — STAFF/ADMIN/CREATOR ONLY
-- Uses ACTUAL schema: wallets (owner_id, available_balance, is_frozen)
-- wallet_transactions (user_id, transaction_type, balance_after)
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION credit_wallet(
  p_wallet_id UUID,
  p_amount DECIMAL,
  p_description TEXT,
  p_reference TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_wallet RECORD;
  v_caller TEXT;
  v_caller_role TEXT;
  v_new_balance DECIMAL;
BEGIN
  SELECT user_id, role INTO v_caller, v_caller_role
  FROM profiles WHERE auth_id = auth.uid()::text;

  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  IF v_caller_role NOT IN ('staff','admin','creator','creator_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  SELECT * INTO v_wallet FROM wallets WHERE id = p_wallet_id FOR UPDATE;

  IF v_wallet IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wallet not found');
  END IF;

  IF v_wallet.is_frozen THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wallet is frozen');
  END IF;

  v_new_balance := v_wallet.available_balance + p_amount;

  UPDATE wallets SET
    available_balance = v_new_balance,
    updated_at = now()
  WHERE id = p_wallet_id;

  -- Insert using ACTUAL wallet_transactions schema (user_id, transaction_type)
  INSERT INTO wallet_transactions (user_id, transaction_type, amount, description, reference_id, reference_type, balance_after)
  VALUES (v_wallet.owner_id, 'credit', p_amount, p_description, p_reference, 'wallet_credit', v_new_balance);

  RETURN jsonb_build_object('success', true, 'new_balance', v_new_balance);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- PART 8: SECURE release_escrow RPC — STAFF/ADMIN/CREATOR ONLY
-- Uses ACTUAL schema: escrow_transactions (amount_payee, released_by)
-- wallets (owner_id, available_balance, is_frozen)
-- wallet_transactions (user_id, transaction_type, balance_after)
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION release_escrow(
  p_escrow_id UUID,
  p_wallet_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_escrow RECORD;
  v_wallet RECORD;
  v_caller TEXT;
  v_caller_role TEXT;
  v_new_balance DECIMAL;
BEGIN
  SELECT user_id, role INTO v_caller, v_caller_role
  FROM profiles WHERE auth_id = auth.uid()::text;

  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  IF v_caller_role NOT IN ('staff','admin','creator','creator_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  SELECT * INTO v_escrow FROM escrow_transactions WHERE id = p_escrow_id FOR UPDATE;
  SELECT * INTO v_wallet FROM wallets WHERE id = p_wallet_id FOR UPDATE;

  IF v_escrow IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Escrow not found');
  END IF;

  IF v_escrow.status != 'held' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Escrow is not in held status');
  END IF;

  IF v_wallet IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wallet not found');
  END IF;

  -- Server-side: wallet must belong to escrow worker
  IF v_wallet.owner_id != v_escrow.payee_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wallet does not belong to escrow payee');
  END IF;

  IF v_wallet.is_frozen THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wallet is frozen');
  END IF;

  -- Amount derived server-side from escrow.amount_payee
  v_new_balance := v_wallet.available_balance + v_escrow.amount_payee;

  UPDATE wallets SET
    available_balance = v_new_balance,
    updated_at = now()
  WHERE id = p_wallet_id;

  UPDATE escrow_transactions SET
    status = 'released',
    released_at = now(),
    released_by = v_caller,
    updated_at = now()
  WHERE id = p_escrow_id;

  INSERT INTO wallet_transactions (user_id, transaction_type, amount, description, reference_id, reference_type, balance_after)
  VALUES (v_wallet.owner_id, 'escrow_release', v_escrow.amount_payee, 'Escrow released for ' || v_escrow.paystack_reference, p_escrow_id::text, 'escrow', v_new_balance);

  RETURN jsonb_build_object('success', true, 'amount_released', v_escrow.amount_payee, 'new_balance', v_new_balance);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- PART 9: SECURE refund_escrow RPC — STAFF/ADMIN/CREATOR ONLY
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION refund_escrow(
  p_escrow_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_escrow RECORD;
  v_caller TEXT;
  v_caller_role TEXT;
BEGIN
  SELECT user_id, role INTO v_caller, v_caller_role
  FROM profiles WHERE auth_id = auth.uid()::text;

  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  IF v_caller_role NOT IN ('staff','admin','creator','creator_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  SELECT * INTO v_escrow FROM escrow_transactions WHERE id = p_escrow_id FOR UPDATE;

  IF v_escrow IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Escrow not found');
  END IF;

  IF v_escrow.status NOT IN ('held', 'disputed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Escrow cannot be refunded');
  END IF;

  UPDATE escrow_transactions SET
    status = 'refunded',
    updated_at = now()
  WHERE id = p_escrow_id;

  RETURN jsonb_build_object('success', true, 'amount_refunded', v_escrow.amount_total);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- PART 10: REWRITE record_worker_verification_payment
-- Uses ACTUAL booking_payments table (freshly created above).
-- Does NOT auto-grant blue tick.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION record_worker_verification_payment(
  p_user_id TEXT,
  p_reference TEXT,
  p_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller TEXT;
  v_caller_role TEXT;
  v_expected_amount NUMERIC;
  v_payment_id UUID;
BEGIN
  SELECT user_id, role INTO v_caller, v_caller_role
  FROM profiles WHERE auth_id = auth.uid()::text;

  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  IF v_caller != p_user_id AND v_caller_role NOT IN ('staff','admin','creator','creator_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  IF p_reference IS NULL OR p_reference = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Reference required');
  END IF;

  SELECT COALESCE(NULLIF(value, '')::NUMERIC, 0) INTO v_expected_amount
  FROM platform_settings WHERE key = 'worker_verification_fee';

  IF v_expected_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Verification fee not configured');
  END IF;

  IF EXISTS (
    SELECT 1 FROM verified_paystack_references
    WHERE paystack_reference = p_reference
  ) THEN
    RETURN jsonb_build_object('success', true, 'already_processed', true);
  END IF;

  INSERT INTO booking_payments (
    payment_reference, user_id, type,
    payer_user_id, payee_user_id,
    amount, amount_total, commission_amount, net_amount,
    currency, status, purpose,
    paystack_reference,
    paid_at, webhook_processed,
    metadata
  ) VALUES (
    'WHWV_' || p_reference, p_user_id, 'worker_subscription',
    p_user_id, p_user_id,
    v_expected_amount, v_expected_amount, 0, v_expected_amount,
    'NGN', 'completed', 'worker_verification',
    p_reference,
    NOW(), TRUE,
    jsonb_build_object('recorded_by', v_caller, 'expected_amount', v_expected_amount, 'submitted_amount', p_amount)
  )
  RETURNING id INTO v_payment_id;

  INSERT INTO verified_paystack_references (paystack_reference, booking_payment_id, verified_amount)
  VALUES (p_reference, v_payment_id, v_expected_amount)
  ON CONFLICT (paystack_reference) DO NOTHING;

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'verified', false,
    'note', 'Payment recorded. Admin approval required for blue tick.'
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- PART 11: SECURE customer_confirm_payment
-- Requires server-verified payment in verified_paystack_references.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION customer_confirm_payment(
  p_booking_id UUID,
  p_user_id TEXT,
  p_paystack_ref TEXT,
  p_paystack_tx_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller TEXT;
  v_caller_role TEXT;
BEGIN
  SELECT user_id, role INTO v_caller, v_caller_role
  FROM profiles WHERE auth_id = auth.uid()::text;

  IF v_caller IS NULL THEN
    RETURN FALSE;
  END IF;

  IF v_caller != p_user_id AND v_caller_role NOT IN ('staff','admin','creator','creator_admin') THEN
    RETURN FALSE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM verified_paystack_references WHERE paystack_reference = p_paystack_ref
  ) THEN
    RETURN FALSE;
  END IF;

  UPDATE worker_bookings SET
    status = 'confirmed',
    paystack_reference = p_paystack_ref,
    paystack_transaction_id = p_paystack_tx_id,
    updated_at = NOW()
  WHERE id = p_booking_id AND user_id = p_user_id AND status = 'waiting_payment';

  RETURN FOUND;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- PART 12: UPDATE confirm_booking_payment
-- Uses ACTUAL booking_payments columns.
-- Idempotency via verified_paystack_references + FOR UPDATE.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION confirm_booking_payment(
  p_reference TEXT,
  p_transaction_id TEXT DEFAULT NULL,
  p_verified_amount NUMERIC DEFAULT NULL,
  p_verification_source TEXT DEFAULT 'webhook',
  p_purpose TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_payment RECORD;
  v_caller TEXT;
BEGIN
  SELECT user_id INTO v_caller FROM profiles WHERE auth_id = auth.uid()::text;
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  SELECT * INTO v_payment FROM booking_payments
  WHERE paystack_reference = p_reference
  FOR UPDATE SKIP LOCKED;

  IF v_payment IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment not found');
  END IF;

  IF EXISTS (SELECT 1 FROM verified_paystack_references WHERE paystack_reference = p_reference) THEN
    RETURN jsonb_build_object('success', true, 'already_processed', true);
  END IF;

  IF v_payment.status IN ('paid', 'completed') THEN
    RETURN jsonb_build_object('success', true, 'already_processed', true);
  END IF;

  IF p_verified_amount IS NOT NULL THEN
    IF COALESCE(v_payment.amount_total, v_payment.amount, 0) > 0
       AND ABS(p_verified_amount - COALESCE(v_payment.amount_total, v_payment.amount)) > 1 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Amount mismatch',
        'expected', COALESCE(v_payment.amount_total, v_payment.amount), 'verified', p_verified_amount);
    END IF;
  END IF;

  IF p_purpose IS NOT NULL AND v_payment.purpose IS NOT NULL AND p_purpose != v_payment.purpose THEN
    RETURN jsonb_build_object('success', false, 'error', 'Purpose mismatch');
  END IF;

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

  INSERT INTO verified_paystack_references (
    paystack_reference, booking_payment_id, verified_amount, verification_source, verified_by
  ) VALUES (
    p_reference, v_payment.id, p_verified_amount, p_verification_source, v_caller
  )
  ON CONFLICT (paystack_reference) DO NOTHING;

  IF v_payment.amount_commission IS NOT NULL AND v_payment.amount_commission > 0 THEN
    INSERT INTO commission_ledger (
      payment_id, booking_type, source_user_id,
      commission_amount, commission_rate, gross_amount,
      description, paystack_reference
    ) VALUES (
      v_payment.id,
      COALESCE(v_payment.booking_type, v_payment.type, 'unknown'),
      COALESCE(v_payment.payee_user_id, v_payment.user_id),
      v_payment.amount_commission,
      COALESCE(v_payment.commission_rate, 0),
      COALESCE(v_payment.amount_total, v_payment.amount, 0),
      format('Commission from %s booking (N%s)',
        COALESCE(v_payment.booking_type, v_payment.type, 'unknown'),
        COALESCE(v_payment.amount_total, v_payment.amount, 0)::text),
      p_reference
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'payment_id', v_payment.id);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- PART 13: REVERSE PAYMENT RPC
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

  v_net := 0;

  INSERT INTO payment_reversals (
    original_payment_id, original_reference, reversal_type,
    original_amount, reversal_amount, net_after_reversal,
    reason, processed_by, reversal_reference
  ) VALUES (
    p_payment_id, v_payment.paystack_reference, p_reversal_type,
    COALESCE(v_payment.amount_total, v_payment.amount, 0),
    COALESCE(v_payment.amount_total, v_payment.amount, 0),
    v_net, p_reason, v_processed_by, p_reversal_reference
  );

  UPDATE booking_payments
  SET status = 'refunded', updated_at = NOW()
  WHERE id = p_payment_id;

  UPDATE commission_ledger
  SET status = 'refunded', updated_at = NOW()
  WHERE payment_id = p_payment_id;

  RETURN TRUE;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- PART 14: WITHDRAWAL WITH BANK SNAPSHOT
-- Uses ACTUAL withdrawals schema (wallet_id, amount, status, bank_*)
-- ═══════════════════════════════════════════════════════════════════

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

  UPDATE wallets
  SET available_balance = available_balance - p_amount,
      frozen_balance = frozen_balance + p_amount,
      updated_at = NOW()
  WHERE id = p_wallet_id;

  INSERT INTO withdrawals (
    wallet_id, amount, status,
    bank_name, bank_account_number, bank_account_name,
    snapshot_bank_name, snapshot_bank_account_number,
    snapshot_bank_account_name, snapshot_bank_code
  ) VALUES (
    p_wallet_id, p_amount, 'pending',
    v_wallet.bank_name, v_wallet.bank_account_number, v_wallet.bank_account_name,
    v_wallet.bank_name, v_wallet.bank_account_number,
    v_wallet.bank_account_name, NULL
  ) RETURNING id INTO v_withdrawal_id;

  RETURN v_withdrawal_id;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- PART 15: RECORD BANK ACCOUNT CHANGE
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

  RETURN TRUE;
END;
$$;
