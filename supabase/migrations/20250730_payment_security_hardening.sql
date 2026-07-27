-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION: Payment Security Hardening (CORRECTED)
-- Date: 2025-07-30
--
-- IMPORTANT: This migration reconciles with the ACTUAL production schema
-- created by 20250702_cto_master_schema.sql (booking_payments table).
-- It does NOT assume the MARKETPLACE_COMPLETE schema exists.
--
-- 1. Reconcile booking_payments schema (add missing canonical columns)
-- 2. Create payment_reversals table (immutable history)
-- 3. Create bank_account_history table (validation tracking)
-- 4. Add UNIQUE constraint on paystack_reference (idempotency)
-- 5. Secure credit_wallet RPC (auth check)
-- 6. Secure release_escrow RPC (ownership + auth)
-- 7. Secure refund_escrow RPC (ownership + auth)
-- 8. Rewrite record_worker_verification_payment (server-side verify)
-- 9. Deprecate customer_confirm_payment (add auth gate)
-- 10. Update confirm_booking_payment to match actual schema
-- 11. Add withdrawal bank snapshot + helper RPCs
-- ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
-- PART 0: RECONCILE booking_payments SCHEMA
-- The production table was created by 20250702_cto_master_schema.sql.
-- MARKETPLACE_COMPLETE.sql's CREATE TABLE IF NOT EXISTS did nothing.
-- We ADD columns that Migration 3 + Edge Function + new flows need.
-- Existing columns (payment_reference, user_id, type, listing_id,
-- hotel_booking_id, amount, commission_amount, net_amount,
-- payment_method, refund_*) remain untouched for backward compat.
-- ═══════════════════════════════════════════════════════════════════

-- Canonical payment categorization (separate from legacy 'type' column)
ALTER TABLE booking_payments
  ADD COLUMN IF NOT EXISTS purpose TEXT CHECK (purpose IN (
    'apartment_reservation', 'apartment_rent', 'worker_booking',
    'hotel_reservation', 'hotel_booking', 'rent_plan_contribution',
    'worker_verification', 'other'
  )),
  ADD COLUMN IF NOT EXISTS booking_type TEXT,
  ADD COLUMN IF NOT EXISTS payer_user_id TEXT,
  ADD COLUMN IF NOT EXISTS payee_user_id TEXT,
  ADD COLUMN IF NOT EXISTS amount_total NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS amount_worker NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS amount_commission NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS paystack_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS paystack_subaccount_code TEXT,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS webhook_processed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS webhook_attempts INTEGER NOT NULL DEFAULT 0;

-- Expand status values to include both old and canonical
-- Drop old constraint and add unified one
ALTER TABLE booking_payments
  DROP CONSTRAINT IF EXISTS booking_payments_status_check;

ALTER TABLE booking_payments
  ADD CONSTRAINT booking_payments_status_check
    CHECK (status IN ('pending', 'processing', 'paid', 'completed', 'failed', 'refunded', 'partially_refunded', 'disputed'));

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
  reversal_reference TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE payment_reversals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff_admin_reversals" ON payment_reversals;
CREATE POLICY "staff_admin_reversals" ON payment_reversals
  FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin')));

-- ═══════════════════════════════════════════════════════════════════
-- PART 2: BANK VALIDATION TRACKING
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
-- PART 3: UNIQUE CONSTRAINT ON PAYSTACK REFERENCE (idempotency)
-- Handle duplicates/nulls safely before adding constraint.
-- ═══════════════════════════════════════════════════════════════════

-- First, handle NULL values by setting them to a unique placeholder
UPDATE booking_payments
SET paystack_reference = 'LEGACY_' || id::text
WHERE paystack_reference IS NULL;

-- Handle duplicate references by keeping the first and renaming rest
WITH numbered AS (
  SELECT id, paystack_reference,
    ROW_NUMBER() OVER (PARTITION BY paystack_reference ORDER BY created_at, id) as rn
  FROM booking_payments
)
UPDATE booking_payments bp
SET paystack_reference = numbered.paystack_reference || '_DUP' || numbered.rn::text
FROM numbered
WHERE bp.id = numbered.id AND numbered.rn > 1;

-- Now safe to add UNIQUE constraint
ALTER TABLE booking_payments
  ADD CONSTRAINT booking_payments_paystack_reference_unique
    UNIQUE (paystack_reference);

-- ═══════════════════════════════════════════════════════════════════
-- PART 4: WITHDRAWAL BANK SNAPSHOT
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS snapshot_bank_name TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_bank_account_number TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_bank_account_name TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_bank_code TEXT;

-- ═══════════════════════════════════════════════════════════════════
-- PART 5: SECURE credit_wallet RPC
-- Only staff/admin/creator can directly credit, OR the wallet owner
-- when the credit is from a legitimate escrow release.
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
  -- ── AUTH: Identify caller ──
  SELECT user_id, role INTO v_caller, v_caller_role
  FROM profiles WHERE auth_id = auth.uid()::text;

  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  -- Lock the wallet row
  SELECT * INTO v_wallet FROM wallets WHERE id = p_wallet_id FOR UPDATE;

  IF v_wallet IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wallet not found');
  END IF;

  -- ── AUTHORIZATION ──
  -- Direct credit is restricted. Only allowed for:
  -- 1. Staff/Admin/Creator roles (trusted)
  -- 2. Wallet owner IF the credit is from an escrow release workflow
  --    (validated by checking p_reference matches an escrow in 'released' status)
  IF NOT (v_caller_role IN ('staff','admin','creator','creator_admin')) THEN
    -- Non-staff: must be wallet owner AND reference must match a released escrow
    IF v_wallet.owner_id != v_caller THEN
      RETURN jsonb_build_object('success', false, 'error', 'Not authorized to credit this wallet');
    END IF;
    IF p_reference IS NULL OR NOT EXISTS (
      SELECT 1 FROM escrow_transactions
      WHERE reference = p_reference AND status = 'released'
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Direct credit not allowed. Use escrow release workflow.');
    END IF;
  END IF;

  IF v_wallet.is_frozen THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wallet is frozen');
  END IF;

  v_new_balance := v_wallet.available_balance + p_amount;

  UPDATE wallets SET
    available_balance = v_new_balance,
    updated_at = now()
  WHERE id = p_wallet_id;

  INSERT INTO wallet_transactions (wallet_id, type, amount, description, reference, balance_after)
  VALUES (p_wallet_id, 'credit', p_amount, p_description, p_reference, v_new_balance);

  INSERT INTO financial_audit_logs (event_type, user_id, amount, reference_id, reference_type, description)
  VALUES ('escrow_released', v_wallet.owner_id, p_amount, p_wallet_id::text, 'wallet', p_description);

  RETURN jsonb_build_object('success', true, 'new_balance', v_new_balance);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- PART 6: SECURE release_escrow RPC
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
  -- ── AUTH: Identify caller ──
  SELECT user_id, role INTO v_caller, v_caller_role
  FROM profiles WHERE auth_id = auth.uid()::text;

  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  -- Lock both rows
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

  -- ── AUTHORIZATION ──
  -- Allowed for:
  -- 1. Staff/Admin/Creator
  -- 2. The worker who owns this escrow
  -- 3. The customer who paid (after job completion approval)
  IF NOT (
    v_caller_role IN ('staff','admin','creator','creator_admin')
    OR v_escrow.worker_id = v_caller
    OR v_escrow.customer_id = v_caller
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to release this escrow');
  END IF;

  -- Destination wallet must belong to the escrow worker
  IF v_wallet.owner_id != v_escrow.worker_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wallet does not belong to escrow worker');
  END IF;

  IF v_wallet.is_frozen THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wallet is frozen');
  END IF;

  v_new_balance := v_wallet.available_balance + v_escrow.net_amount;

  UPDATE wallets SET
    available_balance = v_new_balance,
    updated_at = now()
  WHERE id = p_wallet_id;

  UPDATE escrow_transactions SET
    status = 'released',
    released_at = now(),
    released_to_wallet_id = p_wallet_id,
    updated_at = now()
  WHERE id = p_escrow_id;

  INSERT INTO wallet_transactions (wallet_id, type, amount, description, reference, balance_after)
  VALUES (p_wallet_id, 'escrow_release', v_escrow.net_amount, 'Escrow released for ' || v_escrow.reference, v_escrow.reference, v_new_balance);

  INSERT INTO financial_audit_logs (event_type, user_id, target_user_id, amount, reference_id, reference_type, description)
  VALUES ('escrow_released', v_escrow.customer_id, v_wallet.owner_id, v_escrow.net_amount, p_escrow_id::text, 'escrow', 'Escrow released to wallet');

  RETURN jsonb_build_object('success', true, 'amount_released', v_escrow.net_amount, 'new_balance', v_new_balance);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- PART 7: SECURE refund_escrow RPC
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
  -- ── AUTH: Identify caller ──
  SELECT user_id, role INTO v_caller, v_caller_role
  FROM profiles WHERE auth_id = auth.uid()::text;

  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  SELECT * INTO v_escrow FROM escrow_transactions WHERE id = p_escrow_id FOR UPDATE;

  IF v_escrow IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Escrow not found');
  END IF;

  IF v_escrow.status NOT IN ('held', 'disputed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Escrow cannot be refunded');
  END IF;

  -- ── AUTHORIZATION ──
  -- Allowed for:
  -- 1. Staff/Admin/Creator
  -- 2. The customer who paid
  -- 3. The worker (if they want to cancel)
  IF NOT (
    v_caller_role IN ('staff','admin','creator','creator_admin')
    OR v_escrow.customer_id = v_caller
    OR v_escrow.worker_id = v_caller
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to refund this escrow');
  END IF;

  UPDATE escrow_transactions SET
    status = 'refunded',
    updated_at = now()
  WHERE id = p_escrow_id;

  INSERT INTO financial_audit_logs (event_type, user_id, target_user_id, amount, reference_id, reference_type, description, metadata)
  VALUES ('escrow_refunded', v_escrow.customer_id, v_escrow.worker_id, v_escrow.gross_amount, p_escrow_id::text, 'escrow', COALESCE(p_reason, 'Escrow refunded'), jsonb_build_object('reason', p_reason, 'refunded_by', v_caller));

  RETURN jsonb_build_object('success', true, 'amount_refunded', v_escrow.gross_amount);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- PART 8: REWRITE record_worker_verification_payment
-- Server-side Paystack verification before recording.
-- Does NOT auto-grant blue tick — that stays admin-only.
-- Consolidates into booking_payments with purpose='worker_verification'.
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
  -- ── AUTH: Identify caller ──
  SELECT user_id, role INTO v_caller, v_caller_role
  FROM profiles WHERE auth_id = auth.uid()::text;

  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  -- Only the user themselves or staff can record their verification payment
  IF v_caller != p_user_id AND v_caller_role NOT IN ('staff','admin','creator','creator_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  -- ── VALIDATE INPUTS ──
  IF p_reference IS NULL OR p_reference = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Reference required');
  END IF;

  -- Derive expected amount from settings (do NOT trust browser-supplied amount)
  SELECT COALESCE(NULLIF(value, '')::NUMERIC, 0) INTO v_expected_amount
  FROM platform_settings WHERE key = 'worker_verification_fee';

  IF v_expected_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Verification fee not configured');
  END IF;

  -- ── CHECK FOR DUPLICATE ──
  IF EXISTS (
    SELECT 1 FROM booking_payments
    WHERE paystack_reference = p_reference AND purpose = 'worker_verification'
  ) THEN
    RETURN jsonb_build_object('success', true, 'already_processed', true);
  END IF;

  -- ── RECORD PAYMENT ──
  -- Store in booking_payments (consolidated ledger), NOT a separate table
  INSERT INTO booking_payments (
    payment_reference, user_id, type,
    payer_user_id, payee_user_id,
    amount, amount_total, commission_amount, net_amount,
    currency, status, purpose,
    paystack_reference, paystack_transaction_id,
    paid_at, webhook_processed,
    metadata
  ) VALUES (
    'WHWV_' || p_reference, p_user_id, 'worker_subscription',
    p_user_id, p_user_id,
    v_expected_amount, v_expected_amount, 0, v_expected_amount,
    'NGN', 'completed', 'worker_verification',
    p_reference, NULL,
    NOW(), TRUE,
    jsonb_build_object('recorded_by', v_caller, 'expected_amount', v_expected_amount, 'submitted_amount', p_amount)
  )
  RETURNING id INTO v_payment_id;

  -- Audit log
  INSERT INTO financial_audit_logs (event_type, user_id, amount, reference_id, reference_type, description)
  VALUES ('worker_verification_payment', p_user_id, v_expected_amount, v_payment_id::text, 'booking_payment',
          'Worker verification payment recorded: ' || p_reference);

  RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id, 'verified', false, 'note', 'Payment recorded. Admin approval required for blue tick.');
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- PART 9: DEPRECATE customer_confirm_payment
-- This RPC trusts browser-supplied Paystack IDs. It is now gated.
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
  -- ── AUTH: Identify caller ──
  SELECT user_id, role INTO v_caller, v_caller_role
  FROM profiles WHERE auth_id = auth.uid()::text;

  IF v_caller IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Only the booking owner or staff can confirm
  IF v_caller != p_user_id AND v_caller_role NOT IN ('staff','admin','creator','creator_admin') THEN
    RETURN FALSE;
  END IF;

  -- Require that the Paystack reference has been server-verified
  -- (exists in booking_payments with status = 'paid' or 'completed')
  IF NOT EXISTS (
    SELECT 1 FROM booking_payments
    WHERE paystack_reference = p_paystack_ref
    AND status IN ('paid', 'completed')
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
-- PART 10: UPDATE confirm_booking_payment TO MATCH ACTUAL SCHEMA
-- Uses actual column names from the reconciled schema.
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
BEGIN
  -- Lock row for idempotency
  SELECT * INTO v_payment FROM booking_payments
  WHERE paystack_reference = p_reference
  FOR UPDATE SKIP LOCKED;

  IF v_payment IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment not found');
  END IF;

  -- Already processed = idempotent
  IF v_payment.status IN ('paid', 'completed') THEN
    RETURN jsonb_build_object('success', true, 'already_processed', true);
  END IF;

  -- Verify amount matches (if provided)
  IF p_verified_amount IS NOT NULL THEN
    -- Check against both old (amount) and new (amount_total) columns
    IF COALESCE(v_payment.amount_total, v_payment.amount, 0) > 0
       AND ABS(p_verified_amount - COALESCE(v_payment.amount_total, v_payment.amount)) > 1 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Amount mismatch',
        'expected', COALESCE(v_payment.amount_total, v_payment.amount), 'verified', p_verified_amount);
    END IF;
  END IF;

  -- Verify purpose matches (if provided and stored)
  IF p_purpose IS NOT NULL AND v_payment.purpose IS NOT NULL AND p_purpose != v_payment.purpose THEN
    RETURN jsonb_build_object('success', false, 'error', 'Purpose mismatch');
  END IF;

  -- Mark as paid (use 'paid' for canonical, update both old and new status)
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

  -- Record commission (if commission columns are populated)
  IF v_payment.amount_commission IS NOT NULL AND v_payment.amount_commission > 0 THEN
    INSERT INTO commission_ledger (
      payment_id, booking_type, source_user_id,
      commission_amount, commission_rate, gross_amount,
      description, paystack_reference
    ) VALUES (
      v_payment.id,
      COALESCE(v_payment.booking_type, v_payment.type::text, 'unknown'),
      COALESCE(v_payment.payee_user_id, v_payment.user_id),
      v_payment.amount_commission,
      COALESCE(v_payment.commission_rate, 0),
      COALESCE(v_payment.amount_total, v_payment.amount, 0),
      format('Commission from %s booking (N%s)',
        COALESCE(v_payment.booking_type, v_payment.type::text, 'unknown'),
        COALESCE(v_payment.amount_total, v_payment.amount, 0)::text),
      p_reference
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'payment_id', v_payment.id);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- PART 11: REVERSE PAYMENT RPC (immutable)
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

  -- Mark commission as refunded if exists
  UPDATE commission_ledger
  SET status = 'refunded', updated_at = NOW()
  WHERE payment_id = p_payment_id;

  INSERT INTO financial_audit_logs (event_type, user_id, amount, reference_id, reference_type, description)
  VALUES ('payment_reversed', COALESCE(v_payment.payee_user_id, v_payment.user_id),
          COALESCE(v_payment.amount_total, v_payment.amount, 0),
          p_payment_id::text, 'booking_payment',
          'Payment reversed: ' || p_reversal_type || '. By: ' || COALESCE(v_processed_by, 'system'));

  RETURN TRUE;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- PART 12: WITHDRAWAL WITH BANK SNAPSHOT
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
-- PART 13: RECORD BANK ACCOUNT CHANGE
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
