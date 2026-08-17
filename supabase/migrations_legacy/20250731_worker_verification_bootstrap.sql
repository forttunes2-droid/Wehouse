-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION: Worker Verification Payment Bootstrap
-- Date: 2025-07-31
-- Context: Server-side bootstrap for worker verification payments.
--          Fixes confirm_booking_payment v_caller crash.
--          Adds atomic worker status transition.
--          Retires record_worker_verification_payment from active flow.
-- ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 1: CONCURRENCY PROTECTION
-- Partial unique index: one pending worker-verification per user
-- ═══════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_pending_worker_verification
ON booking_payments (user_id, purpose)
WHERE status = 'pending';

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 2: NEW BOOTSTRAP RPC
-- Zero-parameter server-side payment creation for worker verification.
-- Server derives all fields from authenticated identity + platform settings.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION create_worker_verification_payment()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller TEXT;
  v_caller_role TEXT;
  v_amount NUMERIC;
  v_reference TEXT;
  v_existing RECORD;
BEGIN
  -- ── 1. AUTH: Identify caller ──
  SELECT user_id, role INTO v_caller, v_caller_role
  FROM profiles WHERE auth_id = auth.uid()::text;

  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- ── 2. DERIVE amount from platform settings (NEVER from browser) ──
  SELECT COALESCE(NULLIF(value, '')::NUMERIC, 0) INTO v_amount
  FROM platform_settings WHERE key = 'worker_verification_fee';

  IF v_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Verification fee not configured');
  END IF;

  -- ── 3. EXPIRE stale pending records (>30 minutes) ──
  -- Payment attempts remain auditable — UPDATE to 'expired', never DELETE.
  UPDATE booking_payments SET
    status = 'expired',
    updated_at = NOW()
  WHERE user_id = v_caller
    AND purpose = 'worker_verification'
    AND status = 'pending'
    AND created_at < NOW() - INTERVAL '30 minutes';

  -- ── 4. IDEMPOTENCY: check for fresh pending with matching amount ──
  SELECT * INTO v_existing FROM booking_payments
  WHERE user_id = v_caller
    AND purpose = 'worker_verification'
    AND status = 'pending'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    -- Reuse only if stored amount matches current settings fee
    IF v_existing.amount_total = v_amount THEN
      RETURN jsonb_build_object(
        'success', true,
        'reference', v_existing.paystack_reference,
        'amount', v_amount,
        'existing', true
      );
    END IF;
    -- Amount mismatch: expire the stale pending record
    UPDATE booking_payments SET status = 'expired', updated_at = NOW()
    WHERE id = v_existing.id;
  END IF;

  -- ── 5. GENERATE reference: full UUID, cryptographically secure ──
  v_reference := 'WH-' || gen_random_uuid()::text;

  -- ── 6. INSERT pending record (all fields server-derived) ──
  INSERT INTO booking_payments (
    payment_reference,
    user_id,
    payer_user_id,
    payee_user_id,
    type,
    booking_type,
    amount,
    amount_total,
    net_amount,
    amount_commission,
    currency,
    status,
    purpose,
    paystack_reference,
    metadata,
    created_at,
    updated_at
  ) VALUES (
    v_reference,
    v_caller,           -- user_id from auth
    v_caller,           -- payer = self
    v_caller,           -- payee = self
    'worker_subscription',
    'worker_subscription',
    v_amount,
    v_amount,
    v_amount,
    0,
    'NGN',
    'pending',
    'worker_verification',
    v_reference,
    jsonb_build_object('source', 'create_worker_verification_payment'),
    NOW(),
    NOW()
  );

  RETURN jsonb_build_object(
    'success', true,
    'reference', v_reference,
    'amount', v_amount,
    'existing', false
  );

EXCEPTION WHEN unique_violation THEN
  -- Race: another transaction created the pending row
  SELECT * INTO v_existing FROM booking_payments
  WHERE user_id = v_caller
    AND purpose = 'worker_verification'
    AND status = 'pending';

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'reference', v_existing.paystack_reference,
      'amount', v_existing.amount_total,
      'existing', true
    );
  END IF;

  RETURN jsonb_build_object('success', false, 'error', 'Race condition lost');
END;
$$;

-- Privileges: authenticated users only
REVOKE EXECUTE ON FUNCTION create_worker_verification_payment()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_worker_verification_payment()
  TO authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 3: FIX confirm_booking_payment
-- - Add missing v_caller declaration
-- - verified_by = 'paystack-verify' (trusted backend verifier)
-- - Atomic worker status transition for worker_verification
-- - worker_verified NEVER touched
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
  v_updated INTEGER;
  v_payment_user_id TEXT;
BEGIN
  -- ── AUTH: EXECUTE privilege is the primary boundary ──
  -- service_role has no auth.uid(); defense-in-depth against misconfiguration
  IF auth.uid() IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  -- ── REQUIRED: verified amount must be provided ──
  IF p_verified_amount IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Verified amount required');
  END IF;

  -- ── Lock and find canonical payment row ──
  SELECT * INTO v_payment FROM booking_payments
  WHERE paystack_reference = p_reference
  FOR UPDATE SKIP LOCKED;

  IF v_payment IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment not found');
  END IF;

  -- ── Idempotency: already verified? ──
  IF EXISTS (SELECT 1 FROM verified_paystack_references WHERE paystack_reference = p_reference) THEN
    RETURN jsonb_build_object('success', true, 'already_processed', true);
  END IF;

  IF v_payment.status IN ('paid', 'completed') THEN
    RETURN jsonb_build_object('success', true, 'already_processed', true);
  END IF;

  -- ── Amount verification ──
  IF COALESCE(v_payment.amount_total, v_payment.amount, 0) > 0
     AND ABS(p_verified_amount - COALESCE(v_payment.amount_total, v_payment.amount)) > 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount mismatch',
      'expected', COALESCE(v_payment.amount_total, v_payment.amount),
      'verified', p_verified_amount);
  END IF;

  -- ── Purpose verification ──
  IF p_purpose IS NOT NULL AND v_payment.purpose IS NOT NULL AND p_purpose != v_payment.purpose THEN
    RETURN jsonb_build_object('success', false, 'error', 'Purpose mismatch');
  END IF;

  -- Store user_id before we lose row context
  v_payment_user_id := v_payment.user_id;

  -- ── Mark payment as paid ──
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

  -- ── Record verified reference ──
  -- verified_by = 'paystack-verify' represents the trusted backend verifier
  INSERT INTO verified_paystack_references (
    paystack_reference, booking_payment_id, verified_amount,
    verification_source, verified_by
  ) VALUES (p_reference, v_payment.id, p_verified_amount, p_verification_source, 'paystack-verify')
  ON CONFLICT (paystack_reference) DO NOTHING;

  -- ── Commission (if any) ──
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

  -- ── Worker verification: ATOMIC profile transition ──
  IF v_payment.purpose = 'worker_verification' THEN
    -- Transition from 'pending' (first payment)
    UPDATE profiles SET
      worker_status = 'approved_for_verification',
      updated_at = NOW()
    WHERE user_id = v_payment_user_id
      AND worker_status = 'pending';

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    -- If no row updated, try 'rejected' (repayment after rejection)
    IF v_updated = 0 THEN
      UPDATE profiles SET
        worker_status = 'approved_for_verification',
        updated_at = NOW()
      WHERE user_id = v_payment_user_id
        AND worker_status = 'rejected';

      GET DIAGNOSTICS v_updated = ROW_COUNT;
    END IF;

    -- worker_verified is NEVER touched here.
    -- Admin/creator approval is the only path to worker_verified = TRUE.

    -- If profile was not in expected state (not pending, not rejected),
    -- this is an idempotent re-processing. Payment is still valid.
    -- No error — the profile may already be at a later state.
  END IF;

  -- ── Audit log ──
  INSERT INTO financial_audit_logs (
    event_type, user_id, amount, reference_id, reference_type, description
  ) VALUES (
    CASE WHEN v_payment.purpose = 'worker_verification'
         THEN 'worker_verification_payment'
         ELSE 'customer_payment' END,
    v_payment_user_id,
    p_verified_amount,
    v_payment.id::text,
    'booking_payment',
    format('Payment confirmed via %s: %s', p_verification_source, p_reference)
  );

  RETURN jsonb_build_object('success', true, 'payment_id', v_payment.id);
END;
$$;

-- Privileges: confirm_booking_payment remains server-only
REVOKE EXECUTE ON FUNCTION confirm_booking_payment(TEXT, TEXT, NUMERIC, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION confirm_booking_payment(TEXT, TEXT, NUMERIC, TEXT, TEXT)
  TO service_role;

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 4: RETIRE record_worker_verification_payment FROM ACTIVE FLOW
-- REVOKE EXECUTE from authenticated — stale callers fail loudly.
-- Function remains for rollback safety; can be dropped after confirmed clean.
-- ═══════════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION record_worker_verification_payment(TEXT, TEXT, NUMERIC)
  FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 5: ADD INDEX FOR PAYSTACK REFERENCE LOOKUPS
-- Currently no index on paystack_reference — every verification is a table scan.
-- ═══════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_booking_payments_reference
ON booking_payments (paystack_reference);
