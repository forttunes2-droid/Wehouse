-- ═══════════════════════════════════════════════════════════════════
-- PAYMENT SECURITY LIVE RECONCILIATION
-- Date: 2025-07-30
--
-- BASED ON: Complete 16-block live database audit
-- NOT based on historical migration files
--
-- PHASES:
-- 1. Fix P0 blockers (syntax errors, signature conflicts, CHECK violations)
-- 2. Fix critical security vulnerabilities (RLS + RPC auth)
-- 3. Create canonical payment ledger (booking_payments)
-- 4. Secure worker verification payment flow
-- 5. Secure withdrawal system
-- 6. Repair Migration 2 drift
-- 7. Edge Function contract (finalized)
--
-- PRINCIPLES:
-- - Live database is the source of truth
-- - Never DROP functions without tracing all callers
-- - Preserve existing signatures when frontend depends on them
-- - All financial RPCs must perform their own authorization
-- - Two-stage verification: Paystack API → DB record → Status update
-- ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 0: EXPAND EXISTING CHECK CONSTRAINTS (must happen first)
-- ═══════════════════════════════════════════════════════════════════

-- financial_audit_logs.event_type: add missing values used by new RPCs
ALTER TABLE financial_audit_logs
  DROP CONSTRAINT IF EXISTS financial_audit_logs_event_type_check;

ALTER TABLE financial_audit_logs
  ADD CONSTRAINT financial_audit_logs_event_type_check
    CHECK (event_type IN (
      'customer_payment', 'escrow_created', 'escrow_released', 'escrow_refunded',
      'withdrawal_requested', 'withdrawal_processing', 'withdrawal_successful',
      'withdrawal_failed', 'withdrawal_reversed', 'wallet_frozen', 'wallet_unfrozen',
      'commission_deducted', 'security_deposit_held', 'security_deposit_released',
      'security_deposit_claimed', 'blue_badge_purchased', 'blue_badge_renewed',
      'dispute_opened', 'dispute_resolved', 'manual_adjustment',
      'bank_account_change', 'payment_reversed', 'worker_verification_payment',
      'withdrawal_snapshot', 'escrow_credit_wallet'
    ));

-- support_tickets.status: add 'in_progress' used by StaffDashboard
ALTER TABLE support_tickets
  DROP CONSTRAINT IF EXISTS support_tickets_status_check;

ALTER TABLE support_tickets
  ADD CONSTRAINT support_tickets_status_check
    CHECK (status IN ('open', 'in_progress', 'resolved', 'closed'));

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 1: CREATE CANONICAL PAYMENT LEDGER
-- booking_payments does not exist. It is needed because:
-- - payments (legacy) uses INTEGER IDs, not UUID
-- - worker_bookings is booking-centric, not payment-centric
-- - escrow_transactions is escrow-centric
-- - No unified table for server-verified Paystack payments exists
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
-- PHASE 2: CREATE COMMISSION LEDGER
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
-- PHASE 3: CREATE VERIFIED PAYSTACK REFERENCES (idempotency)
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
-- PHASE 4: CREATE PAYMENT REVERSALS
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
  FOR ALL USING (EXISTS (
    SELECT 1 FROM profiles
    WHERE auth_id = auth.uid()::text
    AND role IN ('staff','admin','creator','creator_admin')
  ));

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 5: CREATE BANK ACCOUNT HISTORY
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
  FOR ALL USING (EXISTS (
    SELECT 1 FROM profiles
    WHERE auth_id = auth.uid()::text
    AND role IN ('staff','admin','creator','creator_admin')
  ));

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 6: ADD WITHDRAWAL BANK SNAPSHOT COLUMNS
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS snapshot_bank_name TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_bank_account_number TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_bank_account_name TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_bank_code TEXT;

ALTER TABLE withdrawal_requests
  ADD COLUMN IF NOT EXISTS snapshot_bank_name TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_bank_account_number TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_bank_account_name TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_bank_code TEXT;

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 7: FIX RLS POLICIES — REMOVE public ALL true
-- ═══════════════════════════════════════════════════════════════════

-- escrow_transactions: remove wide-open policy, add proper policies
DROP POLICY IF EXISTS "ea" ON escrow_transactions;

DROP POLICY IF EXISTS "escrow_participant" ON escrow_transactions;
CREATE POLICY "escrow_participant" ON escrow_transactions
  FOR SELECT USING (
    payer_user_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
    OR payee_user_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
    OR EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin'))
  );

-- financial_audit_log (singular): restrict to staff only
DROP POLICY IF EXISTS "aa" ON financial_audit_log;

DROP POLICY IF EXISTS "audit_log_staff" ON financial_audit_log;
CREATE POLICY "audit_log_staff" ON financial_audit_log
  FOR ALL USING (EXISTS (
    SELECT 1 FROM profiles
    WHERE auth_id = auth.uid()::text
    AND role IN ('staff','admin','creator','creator_admin')
  ));

-- wallet_transactions: remove wide-open policy, add proper policies
DROP POLICY IF EXISTS "wtx" ON wallet_transactions;

DROP POLICY IF EXISTS "wtx_owner" ON wallet_transactions;
CREATE POLICY "wtx_owner" ON wallet_transactions
  FOR SELECT USING (
    user_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
    OR EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin'))
  );

-- withdrawal_requests: remove wide-open policy, add proper policies
DROP POLICY IF EXISTS "wda" ON withdrawal_requests;

DROP POLICY IF EXISTS "wda_owner" ON withdrawal_requests;
CREATE POLICY "wda_owner" ON withdrawal_requests
  FOR SELECT USING (
    user_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
    OR EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin'))
  );

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 8: SECURE FINANCIAL RPCs — ADD AUTH CHECKS
-- ═══════════════════════════════════════════════════════════════════

-- credit_wallet: add auth check (was callable by any authenticated user)
CREATE OR REPLACE FUNCTION credit_wallet(
  p_wallet_id UUID,
  p_amount NUMERIC,
  p_description TEXT,
  p_reference TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet RECORD;
  v_caller TEXT;
  v_caller_role TEXT;
  v_new_balance NUMERIC;
BEGIN
  -- ── AUTH: Identify caller ──
  SELECT user_id, role INTO v_caller, v_caller_role
  FROM profiles WHERE auth_id = auth.uid()::text;

  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  -- ── AUTHORIZATION: staff/admin/creator only ──
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
    updated_at = NOW()
  WHERE id = p_wallet_id;

  INSERT INTO wallet_transactions (
    user_id, transaction_type, amount, description,
    reference_id, reference_type, balance_after
  ) VALUES (
    v_wallet.owner_id, 'credit', p_amount, p_description,
    p_reference, 'wallet_credit', v_new_balance
  );

  RETURN jsonb_build_object('success', true, 'new_balance', v_new_balance);
END;
$$;

-- release_escrow: PRESERVE live signature, add auth check
-- Live: (p_booking_id uuid, p_released_by text) → boolean
-- No frontend callers exist for this function — keeping signature for compatibility
CREATE OR REPLACE FUNCTION release_escrow(
  p_booking_id UUID,
  p_released_by TEXT DEFAULT 'system'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_escrow RECORD;
  v_wallet RECORD;
  v_caller TEXT;
  v_caller_role TEXT;
  v_new_balance NUMERIC;
BEGIN
  -- ── AUTH: Identify caller ──
  SELECT user_id, role INTO v_caller, v_caller_role
  FROM profiles WHERE auth_id = auth.uid()::text;

  IF v_caller IS NULL THEN
    RETURN FALSE;
  END IF;

  -- ── AUTHORIZATION: staff/admin/creator only ──
  IF v_caller_role NOT IN ('staff','admin','creator','creator_admin') THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO v_escrow
  FROM escrow_transactions
  WHERE booking_id = p_booking_id AND status = 'holding'
  FOR UPDATE;

  IF v_escrow IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO v_wallet
  FROM wallets
  WHERE owner_id = v_escrow.payee_user_id
  FOR UPDATE;

  IF v_wallet IS NULL THEN
    RETURN FALSE;
  END IF;

  IF v_wallet.is_frozen THEN
    RETURN FALSE;
  END IF;

  -- Amount derived server-side from escrow.amount_payee
  v_new_balance := v_wallet.available_balance + v_escrow.amount_payee;

  UPDATE wallets SET
    available_balance = v_new_balance,
    updated_at = NOW()
  WHERE id = v_wallet.id;

  UPDATE escrow_transactions SET
    status = 'released',
    released_at = NOW(),
    released_by = COALESCE(p_released_by, v_caller),
    updated_at = NOW()
  WHERE id = v_escrow.id;

  INSERT INTO wallet_transactions (
    user_id, transaction_type, amount, description,
    reference_id, reference_type, balance_after
  ) VALUES (
    v_wallet.owner_id, 'escrow_release', v_escrow.amount_payee,
    'Escrow released for booking ' || p_booking_id::text,
    v_escrow.id::text, 'escrow', v_new_balance
  );

  RETURN TRUE;
END;
$$;

-- refund_escrow: add auth check
CREATE OR REPLACE FUNCTION refund_escrow(
  p_escrow_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  -- ── AUTHORIZATION: staff/admin/creator only ──
  IF v_caller_role NOT IN ('staff','admin','creator','creator_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  SELECT * INTO v_escrow FROM escrow_transactions WHERE id = p_escrow_id FOR UPDATE;

  IF v_escrow IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Escrow not found');
  END IF;

  IF v_escrow.status NOT IN ('holding', 'disputed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Escrow cannot be refunded');
  END IF;

  UPDATE escrow_transactions SET
    status = 'refunded',
    updated_at = NOW()
  WHERE id = p_escrow_id;

  RETURN jsonb_build_object('success', true, 'amount_refunded', v_escrow.amount_total);
END;
$$;

-- process_withdrawal: add auth check
CREATE OR REPLACE FUNCTION process_withdrawal(
  p_withdrawal_id UUID,
  p_paystack_transfer_code TEXT,
  p_paystack_reference TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_withdrawal RECORD;
  v_wallet RECORD;
  v_caller TEXT;
  v_caller_role TEXT;
BEGIN
  -- ── AUTH: Identify caller ──
  SELECT user_id, role INTO v_caller, v_caller_role
  FROM profiles WHERE auth_id = auth.uid()::text;

  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  -- ── AUTHORIZATION: staff/admin/creator only ──
  IF v_caller_role NOT IN ('staff','admin','creator','creator_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  SELECT * INTO v_withdrawal FROM withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF v_withdrawal IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Withdrawal not found');
  END IF;

  IF v_withdrawal.status != 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Withdrawal not pending');
  END IF;

  SELECT * INTO v_wallet FROM wallets WHERE id = v_withdrawal.wallet_id;
  IF v_wallet IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wallet not found');
  END IF;

  UPDATE withdrawals SET
    status = 'processing',
    paystack_transfer_code = p_paystack_transfer_code,
    paystack_transfer_reference = p_paystack_reference,
    processed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_withdrawal_id;

  RETURN jsonb_build_object('success', true, 'status', 'processing');
END;
$$;

-- unfreeze_wallet: add auth check
CREATE OR REPLACE FUNCTION unfreeze_wallet(
  p_wallet_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet RECORD;
  v_caller TEXT;
  v_caller_role TEXT;
BEGIN
  -- ── AUTH: Identify caller ──
  SELECT user_id, role INTO v_caller, v_caller_role
  FROM profiles WHERE auth_id = auth.uid()::text;

  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  -- ── AUTHORIZATION: staff/admin/creator only ──
  IF v_caller_role NOT IN ('staff','admin','creator','creator_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  UPDATE wallets SET
    is_frozen = FALSE,
    frozen_reason = NULL,
    frozen_by = NULL,
    frozen_at = NULL,
    updated_at = NOW()
  WHERE id = p_wallet_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 9: record_worker_verification_payment
-- PRESERVES live boolean return type.
-- CONSUMES trusted verification state. NEVER CREATES it.
-- Does NOT auto-grant worker_verified or blue badge.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION record_worker_verification_payment(
  p_user_id TEXT,
  p_reference TEXT,
  p_amount NUMERIC
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller TEXT;
  v_caller_role TEXT;
  v_expected_amount NUMERIC;
  v_payment_id UUID;
  v_verified_ref RECORD;
BEGIN
  -- ── AUTH: Identify caller ──
  SELECT user_id, role INTO v_caller, v_caller_role
  FROM profiles WHERE auth_id = auth.uid()::text;

  IF v_caller IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Only the user themselves or staff can record
  IF v_caller != p_user_id AND v_caller_role NOT IN ('staff','admin','creator','creator_admin') THEN
    RETURN FALSE;
  END IF;

  IF p_reference IS NULL OR p_reference = '' THEN
    RETURN FALSE;
  END IF;

  -- ── REQUIRE: reference must have been independently server-verified ──
  -- This function CONSUMES verification state, never creates it.
  SELECT * INTO v_verified_ref
  FROM verified_paystack_references
  WHERE paystack_reference = p_reference;

  IF v_verified_ref IS NULL THEN
    RETURN FALSE; -- Reference was never server-verified
  END IF;

  -- ── Ownership: verified reference must belong to this user ──
  SELECT bp.user_id INTO v_payment_id FROM booking_payments bp
  WHERE bp.id = v_verified_ref.booking_payment_id;
  
  -- Note: booking_payments row must exist with correct payer_user_id
  IF NOT EXISTS (
    SELECT 1 FROM booking_payments
    WHERE id = v_verified_ref.booking_payment_id
    AND (payer_user_id = p_user_id OR user_id = p_user_id)
  ) THEN
    RETURN FALSE; -- Verified reference belongs to another user
  END IF;

  -- ── Derive expected amount from settings (NOT browser) ──
  SELECT COALESCE(NULLIF(value, '')::NUMERIC, 0) INTO v_expected_amount
  FROM platform_settings WHERE key = 'worker_verification_fee';

  IF v_expected_amount <= 0 THEN
    RETURN FALSE;
  END IF;

  -- ── Idempotency: already recorded? ──
  IF EXISTS (
    SELECT 1 FROM booking_payments
    WHERE paystack_reference = p_reference AND purpose = 'worker_verification'
  ) THEN
    RETURN TRUE;
  END IF;

  -- ── Record payment in booking_payments ──
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
    jsonb_build_object('recorded_by', v_caller, 'expected_amount', v_expected_amount, 'submitted_amount', p_amount, 'verified_by', v_verified_ref.verified_by, 'verified_at', v_verified_ref.verified_at)
  )
  RETURNING id INTO v_payment_id;

  -- ── Audit log ──
  INSERT INTO financial_audit_logs (
    event_type, user_id, amount, reference_id, reference_type, description
  ) VALUES (
    'worker_verification_payment', p_user_id, v_expected_amount,
    v_payment_id::text, 'booking_payment',
    'Worker verification payment recorded (post-verify): ' || p_reference
  );

  RETURN TRUE;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 10: confirm_booking_payment
-- SERVER-SIDE PAYMENT VERIFICATION FINALIZATION.
-- Called ONLY by Edge Functions (service role).
-- NEVER by ordinary authenticated users.
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
SET search_path = public
AS $$
DECLARE
  v_payment RECORD;
BEGIN
  -- ── AUTH: EXECUTE privilege is the security boundary ──
  -- REVOKE'd from PUBLIC, anon, authenticated.
  -- GRANT'd to service_role (Edge Functions only).
  -- Defense-in-depth against privilege misconfiguration:
  IF auth.uid() IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  -- ── REQUIRED: verified amount must be provided ──
  IF p_verified_amount IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Verified amount required');
  END IF;

  -- Lock row
  SELECT * INTO v_payment FROM booking_payments
  WHERE paystack_reference = p_reference
  FOR UPDATE SKIP LOCKED;

  IF v_payment IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment not found');
  END IF;

  -- Idempotency: already verified?
  IF EXISTS (SELECT 1 FROM verified_paystack_references WHERE paystack_reference = p_reference) THEN
    RETURN jsonb_build_object('success', true, 'already_processed', true);
  END IF;

  IF v_payment.status IN ('paid', 'completed') THEN
    RETURN jsonb_build_object('success', true, 'already_processed', true);
  END IF;

  -- Verify amount
  IF COALESCE(v_payment.amount_total, v_payment.amount, 0) > 0
     AND ABS(p_verified_amount - COALESCE(v_payment.amount_total, v_payment.amount)) > 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount mismatch',
      'expected', COALESCE(v_payment.amount_total, v_payment.amount), 'verified', p_verified_amount);
  END IF;

  -- Verify purpose
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
    webhook_processed = TRUE,
    updated_at = NOW()
  WHERE id = v_payment.id;

  -- Record verified reference
  INSERT INTO verified_paystack_references (
    paystack_reference, booking_payment_id, verified_amount,
    verification_source, verified_by
  ) VALUES (p_reference, v_payment.id, p_verified_amount, p_verification_source, v_caller)
  ON CONFLICT (paystack_reference) DO NOTHING;

  -- Record commission
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
      format('Commission from %s (N%s)',
        COALESCE(v_payment.booking_type, v_payment.type, 'unknown'),
        COALESCE(v_payment.amount_total, v_payment.amount, 0)::text),
      p_reference
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'payment_id', v_payment.id);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 11: reverse_payment
-- NEW function. Immutable reversal history.
-- Staff/admin/creator/creator_admin only.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION reverse_payment(
  p_payment_id UUID,
  p_reversal_type TEXT,
  p_reason TEXT DEFAULT NULL,
  p_reversal_reference TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment RECORD;
  v_processed_by TEXT;
  v_processed_by_role TEXT;
  v_net NUMERIC;
BEGIN
  -- ── AUTH ──
  SELECT user_id, role INTO v_processed_by, v_processed_by_role
  FROM profiles WHERE auth_id = auth.uid()::text;

  -- Staff/admin/creator/creator_admin only
  IF v_processed_by_role NOT IN ('staff','admin','creator','creator_admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

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
-- PHASE 12: record_bank_account_change
-- NEW function. Logs every bank change. Does NOT modify wallets or withdrawals.
-- Caller may update their OWN history. Staff may update anyone's.
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed_by TEXT;
  v_changed_by_role TEXT;
BEGIN
  -- ── AUTH ──
  SELECT user_id, role INTO v_changed_by, v_changed_by_role
  FROM profiles WHERE auth_id = auth.uid()::text;

  -- Self or staff only
  IF v_changed_by != p_user_id AND v_changed_by_role NOT IN ('staff','admin','creator','creator_admin') THEN
    RETURN FALSE;
  END IF;

  -- ── This function ONLY inserts into bank_account_history ──
  -- It does NOT modify wallets, withdrawals, or withdrawal_requests.
  -- Changing the bank account on a pending withdrawal requires
  -- a separate workflow (cancel + re-create, or admin override).

  INSERT INTO bank_account_history (
    user_id, bank_name, bank_code, bank_account_number,
    bank_account_name, verified_account_name,
    is_verified, changed_by
  ) VALUES (
    p_user_id, p_bank_name, p_bank_code, p_bank_account_number,
    p_bank_account_name, p_verified_account_name,
    p_verified_account_name IS NOT NULL, v_changed_by
  );

  INSERT INTO financial_audit_logs (
    event_type, user_id, reference_id, reference_type, description
  ) VALUES (
    'bank_account_change', p_user_id, p_user_id, 'profile',
    'Bank changed to: ' || p_bank_name || ' / ' || p_bank_account_number
  );

  RETURN TRUE;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 13: customer_confirm_payment — add server-verification gate
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

  IF v_caller IS NULL THEN RETURN FALSE; END IF;

  IF v_caller != p_user_id AND v_caller_role NOT IN ('staff','admin','creator','creator_admin') THEN
    RETURN FALSE;
  END IF;

  -- Require server-verified payment reference
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
-- PHASE 16: EXECUTE PRIVILEGE RESTRICTIONS
--
-- Supabase PostgreSQL roles:
--   postgres      — database owner (creates functions, owns public schema)
--   service_role  — Edge Function server-role (separate from postgres)
--   authenticated — browser users (JWT-validated)
--   anon          — unauthenticated visitors
--   PUBLIC        — all of the above
--
-- CRITICAL: service_role is NOT the same as postgres.
-- Function owner privileges do NOT automatically extend to service_role.
-- After REVOKE FROM PUBLIC, service_role would LOSE EXECUTE.
-- Explicit GRANT TO service_role is required.
--
-- Edge Functions use SUPABASE_SERVICE_ROLE_KEY and connect as service_role.
-- Browser users connect as authenticated (or anon).
--
-- Security model: REVOKE from browser roles, GRANT to service_role.
-- Internal auth checks are defense-in-depth, not the primary boundary.
-- ═══════════════════════════════════════════════════════════════════

-- confirm_booking_payment: server-only (Edge Function → Paystack verify → this RPC)
REVOKE EXECUTE ON FUNCTION confirm_booking_payment(TEXT, TEXT, NUMERIC, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION confirm_booking_payment(TEXT, TEXT, NUMERIC, TEXT, TEXT)
  TO service_role;

-- reverse_payment: admin-only
REVOKE EXECUTE ON FUNCTION reverse_payment(UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reverse_payment(UUID, TEXT, TEXT, TEXT)
  TO service_role;

-- credit_wallet: admin-only
REVOKE EXECUTE ON FUNCTION credit_wallet(UUID, NUMERIC, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION credit_wallet(UUID, NUMERIC, TEXT, TEXT)
  TO service_role;

-- release_escrow: admin-only
REVOKE EXECUTE ON FUNCTION release_escrow(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION release_escrow(UUID, TEXT)
  TO service_role;

-- refund_escrow: admin-only
REVOKE EXECUTE ON FUNCTION refund_escrow(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION refund_escrow(UUID, TEXT)
  TO service_role;

-- process_withdrawal: admin-only
REVOKE EXECUTE ON FUNCTION process_withdrawal(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION process_withdrawal(UUID, TEXT, TEXT)
  TO service_role;

-- unfreeze_wallet: admin-only
REVOKE EXECUTE ON FUNCTION unfreeze_wallet(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION unfreeze_wallet(UUID)
  TO service_role;

-- record_bank_account_change: self-or-staff (no browser caller found)
REVOKE EXECUTE ON FUNCTION record_bank_account_change(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_bank_account_change(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
  TO service_role;
