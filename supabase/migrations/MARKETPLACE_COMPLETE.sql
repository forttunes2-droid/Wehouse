-- ═══════════════════════════════════════════════════════════════════
-- WEHOUSE MARKETPLACE PAYMENT SYSTEM
-- Auto-split payments, commission ledger, worker reset, webhook support
-- ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════
-- SECTION 1: BOOKING PAYMENTS TABLE (Tracks every payment)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS booking_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL,
  booking_type TEXT NOT NULL DEFAULT 'worker',
  payer_user_id TEXT NOT NULL,
  payee_user_id TEXT NOT NULL,
  amount_total NUMERIC(12,2) NOT NULL,
  amount_worker NUMERIC(12,2) NOT NULL,
  amount_commission NUMERIC(12,2) NOT NULL,
  commission_rate NUMERIC(5,2) NOT NULL DEFAULT 10.00,
  currency TEXT NOT NULL DEFAULT 'NGN',
  paystack_reference TEXT UNIQUE,
  paystack_transaction_id TEXT,
  paystack_subaccount_code TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'paid', 'failed', 'refunded', 'disputed')),
  paid_at TIMESTAMPTZ,
  webhook_processed BOOLEAN NOT NULL DEFAULT FALSE,
  webhook_attempts INTEGER NOT NULL DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE booking_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "booking_payments_all" ON booking_payments FOR ALL USING (TRUE) WITH CHECK (TRUE);

CREATE INDEX IF NOT EXISTS idx_bp_reference ON booking_payments(paystack_reference);
CREATE INDEX IF NOT EXISTS idx_bp_status ON booking_payments(status);
CREATE INDEX IF NOT EXISTS idx_bp_payee ON booking_payments(payee_user_id);

-- ═══════════════════════════════════════════════════════════
-- SECTION 2: COMMISSION LEDGER (WeHouse earnings)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS commission_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID REFERENCES booking_payments(id),
  booking_type TEXT NOT NULL,
  source_user_id TEXT NOT NULL,
  commission_amount NUMERIC(12,2) NOT NULL,
  commission_rate NUMERIC(5,2) NOT NULL,
  gross_amount NUMERIC(12,2) NOT NULL,
  description TEXT NOT NULL,
  paystack_reference TEXT,
  status TEXT NOT NULL DEFAULT 'collected'
    CHECK (status IN ('collected', 'settled', 'refunded', 'disputed')),
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE commission_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "commission_ledger_all" ON commission_ledger FOR ALL USING (TRUE) WITH CHECK (TRUE);

CREATE INDEX IF NOT EXISTS idx_cl_status ON commission_ledger(status);
CREATE INDEX IF NOT EXISTS idx_cl_created ON commission_ledger(created_at);

-- ═══════════════════════════════════════════════════════════
-- SECTION 3: WORKER SUBACCOUNTS (Paystack subaccount codes)
-- ═══════════════════════════════════════════════════════════

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS paystack_subaccount_code TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS paystack_subaccount_id TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS paystack_transfer_recipient TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bank_account_number TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bank_code TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bank_name TEXT DEFAULT NULL;

-- ═══════════════════════════════════════════════════════════
-- SECTION 4: TRIGGER - Worker changes skill → Reset to under review
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.reset_worker_on_profile_change()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Only apply to verified workers who changed their service details
  IF NEW.role = 'worker' AND NEW.worker_status = 'verified' THEN
    -- Check if critical fields changed
    IF (
      OLD.worker_occupation IS DISTINCT FROM NEW.worker_occupation OR
      OLD.worker_skills IS DISTINCT FROM NEW.worker_skills OR
      OLD.worker_price IS DISTINCT FROM NEW.worker_price OR
      OLD.worker_bio IS DISTINCT FROM NEW.worker_bio
    ) THEN
      -- Reset to under review
      NEW.worker_status := 'profile_under_review';
      NEW.worker_verified := FALSE;
      
      -- Log the reset in audit
      INSERT INTO audit_log (actor_id, actor_role, action, target_type, target_id, details, created_at)
      VALUES (
        NEW.user_id,
        'worker',
        'worker_auto_reset',
        'profile',
        NEW.user_id,
        jsonb_build_object(
          'reason', 'Worker changed service details after verification',
          'old_occupation', OLD.worker_occupation,
          'new_occupation', NEW.worker_occupation,
          'old_price', OLD.worker_price,
          'new_price', NEW.worker_price
        ),
        NOW()
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Drop existing trigger if any, then recreate
DROP TRIGGER IF EXISTS trg_worker_profile_change ON profiles;
CREATE TRIGGER trg_worker_profile_change
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.reset_worker_on_profile_change();

-- ═══════════════════════════════════════════════════════════
-- SECTION 5: FUNCTIONS - Payment Processing
-- ═══════════════════════════════════════════════════════════

-- Get commission rate from settings (not hardcoded)
CREATE OR REPLACE FUNCTION public.get_commission_rate(p_booking_type TEXT DEFAULT 'worker')
RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rate TEXT; v_num NUMERIC;
BEGIN
  IF p_booking_type = 'worker' THEN
    SELECT value INTO v_rate FROM platform_settings WHERE key = 'commission_rate_worker';
  ELSIF p_booking_type = 'partner' THEN
    SELECT value INTO v_rate FROM platform_settings WHERE key = 'commission_rate_partner';
  ELSIF p_booking_type = 'hotel' THEN
    SELECT value INTO v_rate FROM platform_settings WHERE key = 'commission_rate_hotel';
  ELSE
    SELECT value INTO v_rate FROM platform_settings WHERE key = 'commission_rate_worker';
  END IF;
  
  v_num := NULLIF(trim(v_rate), '');
  IF v_num IS NULL THEN RETURN 10.00; END IF;
  RETURN GREATEST(0, LEAST(100, v_num::NUMERIC));
END;
$$;

-- Create a booking payment record (called before Paystack init)
CREATE OR REPLACE FUNCTION public.create_booking_payment(
  p_booking_id UUID,
  p_booking_type TEXT,
  p_payer_user_id TEXT,
  p_payee_user_id TEXT,
  p_amount_total NUMERIC,
  p_paystack_reference TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rate NUMERIC;
  v_commission NUMERIC;
  v_worker_amount NUMERIC;
  v_subaccount_code TEXT;
  v_payment_id UUID;
BEGIN
  -- Get commission rate from settings
  v_rate := get_commission_rate(p_booking_type);
  v_commission := ROUND((p_amount_total * v_rate / 100)::NUMERIC, 2);
  v_worker_amount := p_amount_total - v_commission;
  
  -- Get worker's Paystack subaccount code
  SELECT paystack_subaccount_code INTO v_subaccount_code
  FROM profiles WHERE user_id = p_payee_user_id;
  
  -- Insert payment record
  INSERT INTO booking_payments (
    booking_id, booking_type, payer_user_id, payee_user_id,
    amount_total, amount_worker, amount_commission, commission_rate,
    paystack_reference, paystack_subaccount_code, status, metadata
  ) VALUES (
    p_booking_id, p_booking_type, p_payer_user_id, p_payee_user_id,
    p_amount_total, v_worker_amount, v_commission, v_rate,
    p_paystack_reference, v_subaccount_code, 'pending',
    jsonb_build_object('commission_rate_used', v_rate)
  )
  RETURNING id INTO v_payment_id;
  
  RETURN jsonb_build_object(
    'payment_id', v_payment_id,
    'amount_total', p_amount_total,
    'amount_worker', v_worker_amount,
    'amount_commission', v_commission,
    'commission_rate', v_rate,
    'subaccount_code', v_subaccount_code,
    'reference', p_paystack_reference
  );
END;
$$;

-- Mark payment as paid (called by webhook or frontend verify)
CREATE OR REPLACE FUNCTION public.confirm_booking_payment(
  p_reference TEXT,
  p_transaction_id TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_payment RECORD;
BEGIN
  -- Lock the row for update to prevent double-processing
  SELECT * INTO v_payment FROM booking_payments
  WHERE paystack_reference = p_reference
  FOR UPDATE SKIP LOCKED;
  
  IF v_payment IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Payment not found');
  END IF;
  
  IF v_payment.status = 'paid' THEN
    RETURN jsonb_build_object('success', TRUE, 'already_processed', TRUE);
  END IF;
  
  -- Update payment status
  UPDATE booking_payments SET
    status = 'paid',
    paystack_transaction_id = COALESCE(p_transaction_id, paystack_transaction_id),
    paid_at = NOW(),
    webhook_processed = TRUE,
    updated_at = NOW()
  WHERE id = v_payment.id;
  
  -- Record commission in ledger
  INSERT INTO commission_ledger (
    payment_id, booking_type, source_user_id,
    commission_amount, commission_rate, gross_amount,
    description, paystack_reference
  ) VALUES (
    v_payment.id, v_payment.booking_type, v_payment.payee_user_id,
    v_payment.amount_commission, v_payment.commission_rate, v_payment.amount_total,
    format('Commission from %s booking (₦%s)', v_payment.booking_type, v_payment.amount_total),
    p_reference
  );
  
  RETURN jsonb_build_object(
    'success', TRUE,
    'payment_id', v_payment.id,
    'commission', v_payment.amount_commission,
    'worker_amount', v_payment.amount_worker
  );
END;
$$;

-- Get commission summary for Creator dashboard
CREATE OR REPLACE FUNCTION public.get_commission_summary(
  p_start_date TIMESTAMPTZ DEFAULT NULL,
  p_end_date TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total_collected NUMERIC;
  v_total_settled NUMERIC;
  v_total_payments INTEGER;
  v_result JSONB;
BEGIN
  SELECT COALESCE(SUM(commission_amount), 0), COUNT(*)
  INTO v_total_collected, v_total_payments
  FROM commission_ledger
  WHERE (p_start_date IS NULL OR created_at >= p_start_date)
    AND (p_end_date IS NULL OR created_at <= p_end_date);
  
  SELECT COALESCE(SUM(commission_amount), 0)
  INTO v_total_settled
  FROM commission_ledger
  WHERE status = 'settled'
    AND (p_start_date IS NULL OR created_at >= p_start_date)
    AND (p_end_date IS NULL OR created_at <= p_end_date);
  
  RETURN jsonb_build_object(
    'total_collected', v_total_collected,
    'total_settled', v_total_settled,
    'total_pending', v_total_collected - v_total_settled,
    'total_payments', v_total_payments
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- SECTION 6: Grant execute permissions
-- ═══════════════════════════════════════════════════════════

GRANT EXECUTE ON FUNCTION public.get_commission_rate TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking_payment TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_booking_payment TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_commission_summary TO authenticated;

-- ═══════════════════════════════════════════════════════════
-- SECTION 7: Seed Paystack settings if not present
-- ═══════════════════════════════════════════════════════════

INSERT INTO platform_settings (key, value, category, label, description, data_type, is_active) VALUES
  ('paystack_secret_key', '', 'payment', 'Paystack Secret Key', 'For server-side verification and transfers', 'text', true),
  ('paystack_commission_bearer', 'subaccount', 'payment', 'Commission Bearer', 'Who bears the commission fee (subaccount or account)', 'text', true),
  ('auto_confirm_webhook', 'true', 'payment', 'Auto-Confirm via Webhook', 'Automatically confirm payments from webhook', 'toggle', true)
ON CONFLICT (key) DO NOTHING;
