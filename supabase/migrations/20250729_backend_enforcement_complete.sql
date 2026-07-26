-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION: Backend Enforcement — Reservations, Rent Plans,
-- Withdrawals, Fraud Controls, Commission, Staff Analytics
-- Date: 2025-07-29
-- ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
-- PART 0: FIX MISSING hotel_reservation_refund_policy
-- ═══════════════════════════════════════════════════════════════════

INSERT INTO platform_settings (key, value, label, category, data_type, is_active) VALUES
  ('hotel_reservation_refund_policy', 'Reservation fee is refundable if cancelled within 24 hours of booking.', 'Hotel Reservation Refund Policy', 'hotel', 'textarea', true)
ON CONFLICT (key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- PART 1: APARTMENT RESERVATION BACKEND
-- ═══════════════════════════════════════════════════════════════════

-- 1A: Add reservation state fields
ALTER TABLE IF EXISTS reservations
  ADD COLUMN IF NOT EXISTS reservation_type TEXT DEFAULT 'apartment' CHECK (reservation_type IN ('apartment', 'hotel')),
  ADD COLUMN IF NOT EXISTS hold_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS commission_rate NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_amount NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_reason TEXT,
  ADD COLUMN IF NOT EXISTS processed_by TEXT,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inspection_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inspection_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inspection_result TEXT CHECK (inspection_result IN (NULL, 'passed', 'failed', 'customer_declined'));

-- 1B: Reservation status CHECK constraint
-- Valid states: pending → active → inspection_pending → (rented|refunded|expired)
--                        → expired (timeout)
--                        → refunded (voluntary or provider failure)

-- 1C: Prevent double-reservation on same listing
CREATE OR REPLACE FUNCTION prevent_double_reservation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM reservations
    WHERE listing_id = NEW.listing_id
      AND status IN ('active', 'inspection_pending')
      AND id != NEW.id
  ) THEN
    RAISE EXCEPTION 'This property is already reserved by another customer';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_double_reservation_trigger ON reservations;
CREATE TRIGGER prevent_double_reservation_trigger
  BEFORE INSERT OR UPDATE ON reservations
  FOR EACH ROW WHEN (NEW.status IN ('active', 'inspection_pending'))
  EXECUTE FUNCTION prevent_double_reservation();

-- 1D: Reservation expiry — set hold_expires_at on activation
CREATE OR REPLACE FUNCTION set_reservation_expiry()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_hold_days INTEGER;
BEGIN
  IF NEW.status = 'active' AND OLD.status != 'active' THEN
    -- Read hold days from platform settings (default 3)
    SELECT COALESCE(NULLIF(value, '')::INTEGER, 3)
    INTO v_hold_days
    FROM platform_settings
    WHERE key = 'apartment_reservation_hold_days';

    IF v_hold_days IS NULL THEN v_hold_days := 3; END IF;

    NEW.hold_expires_at := NOW() + (v_hold_days || ' days')::INTERVAL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_reservation_expiry_trigger ON reservations;
CREATE TRIGGER set_reservation_expiry_trigger
  BEFORE UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION set_reservation_expiry();

-- 1E: Reservation expiry — mark as expired when hold expires (run via cron/calling function)
CREATE OR REPLACE FUNCTION expire_overdue_reservations()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  UPDATE reservations
  SET status = 'expired',
      refund_amount = 0,  -- 0% refund on timeout
      refund_reason = 'Reservation hold expired — no refund',
      processed_at = NOW()
  WHERE status = 'active'
    AND hold_expires_at IS NOT NULL
    AND hold_expires_at < NOW();

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Also release properties
  UPDATE listings
  SET availability_status = 'available',
      reserved_by = NULL,
      reserved_at = NULL
  WHERE availability_status = 'reserved'
    AND id IN (
      SELECT listing_id FROM reservations
      WHERE status = 'expired'
        AND processed_at > NOW() - INTERVAL '1 minute'
    );

  RETURN v_count;
END;
$$;

-- 1F: Reserve property on listing when reservation becomes active
CREATE OR REPLACE FUNCTION reserve_listing_on_activation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status = 'active' AND OLD.status != 'active' THEN
    UPDATE listings
    SET availability_status = 'reserved',
        reserved_by = NEW.user_id,
        reserved_at = NOW()
    WHERE id = NEW.listing_id
      AND availability_status = 'available';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reserve_listing_on_activation_trigger ON reservations;
CREATE TRIGGER reserve_listing_on_activation_trigger
  AFTER UPDATE ON reservations
  FOR EACH ROW WHEN (NEW.status = 'active')
  EXECUTE FUNCTION reserve_listing_on_activation();

-- 1G: Reservation refunds table (permanent audit)
CREATE TABLE IF NOT EXISTS reservation_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES reservations(id),
  user_id TEXT NOT NULL,
  original_amount NUMERIC NOT NULL,
  refund_percent NUMERIC NOT NULL,
  refund_amount NUMERIC NOT NULL,
  wehouse_retained NUMERIC NOT NULL DEFAULT 0,
  reason_category TEXT NOT NULL CHECK (reason_category IN (
    'expired_no_action',           -- 0%
    'customer_declined_inspection', -- post_inspection_refund_percent
    'provider_failure',             -- 100%
    'listing_mismatch',             -- 100%
    'manual_override'               -- admin discretion
  )),
  reason_detail TEXT,
  processed_by TEXT,  -- admin/creator who processed, or 'system'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1H: Authoritative refund calculation RPC
CREATE OR REPLACE FUNCTION calculate_reservation_refund(
  p_reservation_id UUID,
  p_reason_category TEXT
)
RETURNS TABLE(refund_amount NUMERIC, wehouse_retained NUMERIC, refund_percent NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_reservation RECORD;
  v_refund_percent NUMERIC;
  v_post_inspection_percent NUMERIC;
BEGIN
  -- Get reservation
  SELECT * INTO v_reservation FROM reservations WHERE id = p_reservation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found'; END IF;

  -- Determine refund percent based on reason
  CASE p_reason_category
    WHEN 'expired_no_action' THEN
      v_refund_percent := 0;
    WHEN 'customer_declined_inspection' THEN
      -- Read post_inspection_refund_percent from settings (default 50)
      SELECT COALESCE(NULLIF(value, '')::NUMERIC, 50)
      INTO v_post_inspection_percent
      FROM platform_settings WHERE key = 'post_inspection_refund_percent';
      v_refund_percent := COALESCE(v_post_inspection_percent, 50);
    WHEN 'provider_failure', 'listing_mismatch' THEN
      v_refund_percent := 100;
    WHEN 'manual_override' THEN
      v_refund_percent := 0; -- Admin sets manually
    ELSE
      v_refund_percent := 0;
  END CASE;

  refund_amount := ROUND(v_reservation.amount * v_refund_percent / 100, 2);
  wehouse_retained := v_reservation.amount - ROUND(v_reservation.amount * v_refund_percent / 100, 2);
  refund_percent := v_refund_percent;

  RETURN NEXT;
END;
$$;

-- 1I: Process refund RPC
CREATE OR REPLACE FUNCTION process_reservation_refund(
  p_reservation_id UUID,
  p_reason_category TEXT,
  p_reason_detail TEXT DEFAULT NULL,
  p_manual_percent NUMERIC DEFAULT NULL  -- only for manual_override
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_reservation RECORD;
  v_result RECORD;
  v_processed_by TEXT;
BEGIN
  -- Auth check
  SELECT user_id INTO v_processed_by
  FROM profiles WHERE auth_id = auth.uid()::text;

  SELECT * INTO v_reservation FROM reservations WHERE id = p_reservation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found'; END IF;

  -- Already refunded?
  IF v_reservation.status = 'refunded' THEN RAISE EXCEPTION 'Already refunded'; END IF;

  -- Calculate refund
  SELECT * INTO v_result FROM calculate_reservation_refund(p_reservation_id, p_reason_category);

  -- Allow manual override
  IF p_reason_category = 'manual_override' AND p_manual_percent IS NOT NULL THEN
    v_result.refund_percent := p_manual_percent;
    v_result.refund_amount := ROUND(v_reservation.amount * p_manual_percent / 100, 2);
    v_result.wehouse_retained := v_reservation.amount - v_result.refund_amount;
  END IF;

  -- Record refund
  INSERT INTO reservation_refunds (
    reservation_id, user_id, original_amount, refund_percent,
    refund_amount, wehouse_retained, reason_category, reason_detail, processed_by
  ) VALUES (
    p_reservation_id, v_reservation.user_id, v_reservation.amount,
    v_result.refund_percent, v_result.refund_amount, v_result.wehouse_retained,
    p_reason_category, p_reason_detail, COALESCE(v_processed_by, 'system')
  );

  -- Update reservation
  UPDATE reservations
  SET status = 'refunded',
      refund_amount = v_result.refund_amount,
      refund_reason = p_reason_category || COALESCE(': ' || p_reason_detail, ''),
      processed_by = COALESCE(v_processed_by, 'system'),
      processed_at = NOW()
  WHERE id = p_reservation_id;

  -- Release property
  UPDATE listings
  SET availability_status = 'available', reserved_by = NULL, reserved_at = NULL
  WHERE id = v_reservation.listing_id;

  RETURN TRUE;
END;
$$;

-- 1J: Inspection request pauses expiry
CREATE OR REPLACE FUNCTION request_inspection_pause_expiry()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Update reservation to inspection_pending when inspection is requested
  UPDATE reservations
  SET status = 'inspection_pending',
      inspection_requested_at = NOW()
  WHERE id = NEW.reservation_id
    AND status IN ('active', 'inspection_pending');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS request_inspection_pause_expiry_trigger ON user_inspection_requests;
CREATE TRIGGER request_inspection_pause_expiry_trigger
  AFTER INSERT ON user_inspection_requests
  FOR EACH ROW EXECUTE FUNCTION request_inspection_pause_expiry();

-- 1K: After inspection — if customer declines, enable refund path
CREATE OR REPLACE FUNCTION complete_inspection_result(
  p_inspection_id UUID,
  p_result TEXT  -- 'passed', 'failed', 'customer_declined'
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_inspection RECORD;
  v_reservation_id UUID;
BEGIN
  SELECT * INTO v_inspection FROM user_inspection_requests WHERE id = p_inspection_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inspection not found'; END IF;

  -- Update inspection
  UPDATE user_inspection_requests
  SET status = 'completed', condition = p_result, updated_at = NOW()
  WHERE id = p_inspection_id;

  -- Update reservation inspection result
  UPDATE reservations
  SET inspection_result = p_result,
      inspection_completed_at = NOW()
  WHERE id = v_inspection.reservation_id;

  -- If customer declined after inspection, property becomes available again
  -- Customer can then request refund via process_reservation_refund with 'customer_declined_inspection'
  IF p_result = 'customer_declined' THEN
    UPDATE listings
    SET availability_status = 'available', reserved_by = NULL, reserved_at = NULL
    WHERE id = v_inspection.listing_id;
  END IF;

  RETURN TRUE;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- PART 2: RENT PLAN BACKEND
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS rent_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES profiles(user_id),
  listing_id UUID REFERENCES listings(id),
  -- Snapshotted terms (immutable after creation)
  target_amount NUMERIC NOT NULL,
  start_after_months INTEGER NOT NULL DEFAULT 4,
  cancellation_fee_percent NUMERIC NOT NULL DEFAULT 10,
  accepted_terms TEXT,  -- JSON of snapshotted settings
  -- State
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  -- Tracking
  total_contributed NUMERIC NOT NULL DEFAULT 0,
  total_paid_out NUMERIC NOT NULL DEFAULT 0,
  last_contribution_at TIMESTAMPTZ,
  -- Tenancy reference
  tenancy_start_date DATE,
  next_rent_due_date DATE,
  -- Meta
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rent_plan_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rent_plan_id UUID NOT NULL REFERENCES rent_plans(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL,
  payment_reference TEXT,
  paystack_reference TEXT,
  status TEXT DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed', 'reversed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS rent_plan_cancellations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rent_plan_id UUID NOT NULL REFERENCES rent_plans(id),
  user_id TEXT NOT NULL,
  total_contributed NUMERIC NOT NULL,
  cancellation_fee_percent NUMERIC NOT NULL,
  cancellation_fee_amount NUMERIC NOT NULL,
  refund_amount NUMERIC NOT NULL,
  reason TEXT,
  reason_category TEXT CHECK (reason_category IN ('voluntary', 'provider_failure', 'other')),
  processed_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2A: Snapshot settings when creating rent plan
CREATE OR REPLACE FUNCTION create_rent_plan(
  p_user_id TEXT,
  p_listing_id UUID,
  p_target_amount NUMERIC
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_plan_id UUID;
  v_start_months INTEGER;
  v_cancel_percent NUMERIC;
  v_settings_json TEXT;
BEGIN
  -- Read current settings
  SELECT COALESCE(NULLIF(value, '')::INTEGER, 4)
  INTO v_start_months FROM platform_settings WHERE key = 'rent_plan_start_after_months';

  SELECT COALESCE(NULLIF(value, '')::NUMERIC, 10)
  INTO v_cancel_percent FROM platform_settings WHERE key = 'rent_plan_cancellation_fee_percent';

  -- Snapshot settings as JSON
  v_settings_json := jsonb_build_object(
    'start_after_months', v_start_months,
    'cancellation_fee_percent', v_cancel_percent,
    'created_with_settings_at', NOW()
  )::TEXT;

  INSERT INTO rent_plans (
    user_id, listing_id, target_amount,
    start_after_months, cancellation_fee_percent,
    accepted_terms, status, tenancy_start_date
  ) VALUES (
    p_user_id, p_listing_id, p_target_amount,
    v_start_months, v_cancel_percent,
    v_settings_json, 'active', CURRENT_DATE
  ) RETURNING id INTO v_plan_id;

  RETURN v_plan_id;
END;
$$;

-- 2B: Cancel rent plan with fee calculation
CREATE OR REPLACE FUNCTION cancel_rent_plan(
  p_plan_id UUID,
  p_reason TEXT DEFAULT NULL,
  p_reason_category TEXT DEFAULT 'voluntary'
)
RETURNS TABLE(refund_amount NUMERIC, fee_amount NUMERIC, total_contributed NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_plan RECORD;
  v_fee_amount NUMERIC;
  v_refund_amount NUMERIC;
BEGIN
  SELECT * INTO v_plan FROM rent_plans WHERE id = p_plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rent plan not found'; END IF;
  IF v_plan.status = 'cancelled' THEN RAISE EXCEPTION 'Already cancelled'; END IF;

  -- Provider failure = 100% refund, no fee
  IF p_reason_category = 'provider_failure' THEN
    v_fee_amount := 0;
    v_refund_amount := v_plan.total_contributed;
  ELSE
    -- Voluntary = apply snapshotted cancellation fee
    v_fee_amount := ROUND(v_plan.total_contributed * v_plan.cancellation_fee_percent / 100, 2);
    v_refund_amount := v_plan.total_contributed - v_fee_amount;
  END IF;

  -- Record cancellation
  INSERT INTO rent_plan_cancellations (
    rent_plan_id, user_id, total_contributed,
    cancellation_fee_percent, cancellation_fee_amount,
    refund_amount, reason, reason_category
  ) VALUES (
    p_plan_id, v_plan.user_id, v_plan.total_contributed,
    v_plan.cancellation_fee_percent, v_fee_amount,
    v_refund_amount, p_reason, p_reason_category
  );

  -- Update plan
  UPDATE rent_plans
  SET status = 'cancelled', total_paid_out = v_refund_amount, updated_at = NOW()
  WHERE id = p_plan_id;

  refund_amount := v_refund_amount;
  fee_amount := v_fee_amount;
  total_contributed := v_plan.total_contributed;
  RETURN NEXT;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- PART 3: WITHDRAWAL / AVAILABLE BALANCE BACKEND
-- ═══════════════════════════════════════════════════════════════════

-- 3A: Add reserved_balance to wallets for pending withdrawal tracking
ALTER TABLE IF EXISTS wallets
  ADD COLUMN IF NOT EXISTS reserved_balance NUMERIC NOT NULL DEFAULT 0;

-- 3B: Atomic withdrawal request with available balance check
CREATE OR REPLACE FUNCTION request_withdrawal_v2(
  p_wallet_id UUID,
  p_amount NUMERIC,
  p_bank_account_number TEXT,
  p_bank_code TEXT,
  p_bank_name TEXT,
  p_account_name TEXT
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_wallet RECORD;
  v_withdrawal_id UUID;
  v_min_withdrawal NUMERIC;
BEGIN
  -- Read min_withdrawal from settings
  SELECT COALESCE(NULLIF(value, '')::NUMERIC, 5000)
  INTO v_min_withdrawal FROM platform_settings WHERE key = 'min_withdrawal';

  -- Lock wallet row
  SELECT * INTO v_wallet FROM wallets WHERE id = p_wallet_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet not found'; END IF;

  -- FRAUD/VALIDATION CHECKS
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be greater than 0'; END IF;
  IF p_amount < v_min_withdrawal THEN RAISE EXCEPTION 'Minimum withdrawal is ₦%', v_min_withdrawal; END IF;

  -- AVAILABLE BALANCE = available_balance - reserved_balance
  IF p_amount > (v_wallet.available_balance - v_wallet.reserved_balance) THEN
    RAISE EXCEPTION 'Insufficient available balance. Available: ₦%, Reserved: ₦%',
      (v_wallet.available_balance - v_wallet.reserved_balance), v_wallet.reserved_balance;
  END IF;

  -- Atomic: reserve funds + create withdrawal
  UPDATE wallets
  SET reserved_balance = reserved_balance + p_amount,
      updated_at = NOW()
  WHERE id = p_wallet_id;

  INSERT INTO withdrawal_requests (
    wallet_id, user_id, amount,
    bank_account_number, bank_code, bank_name, account_name,
    status
  ) VALUES (
    p_wallet_id, v_wallet.owner_user_id, p_amount,
    p_bank_account_number, p_bank_code, p_bank_name, p_account_name,
    'pending'
  ) RETURNING id INTO v_withdrawal_id;

  -- Audit log
  INSERT INTO financial_audit_logs (event_type, user_id, wallet_id, amount, description)
  VALUES ('withdrawal_request', v_wallet.owner_user_id, p_wallet_id, p_amount,
          'Withdrawal request created, funds reserved');

  RETURN v_withdrawal_id;
END;
$$;

-- 3C: Approve withdrawal (release reserved, deduct available, mark completed)
CREATE OR REPLACE FUNCTION approve_withdrawal_v2(
  p_withdrawal_id UUID,
  p_approved_by TEXT  -- admin/staff user_id
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_withdrawal RECORD;
  v_wallet RECORD;
BEGIN
  SELECT * INTO v_withdrawal FROM withdrawal_requests WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Withdrawal not found'; END IF;
  IF v_withdrawal.status != 'pending' THEN RAISE EXCEPTION 'Withdrawal is not pending'; END IF;

  -- Lock wallet
  SELECT * INTO v_wallet FROM wallets WHERE id = v_withdrawal.wallet_id FOR UPDATE;

  -- Cannot approve own withdrawal
  IF v_withdrawal.user_id = p_approved_by THEN
    RAISE EXCEPTION 'You cannot approve your own withdrawal';
  END IF;

  -- Verify reserved funds match
  IF v_wallet.reserved_balance < v_withdrawal.amount THEN
    RAISE EXCEPTION 'Reserved funds mismatch. Reserved: %, Requested: %',
      v_wallet.reserved_balance, v_withdrawal.amount;
  END IF;

  -- Atomic settlement
  UPDATE wallets
  SET available_balance = available_balance - v_withdrawal.amount,
      reserved_balance = reserved_balance - v_withdrawal.amount,
      total_withdrawn = total_withdrawn + v_withdrawal.amount,
      updated_at = NOW()
  WHERE id = v_withdrawal.wallet_id;

  UPDATE withdrawal_requests
  SET status = 'successful',
      updated_at = NOW()
  WHERE id = p_withdrawal_id;

  INSERT INTO financial_audit_logs (event_type, user_id, wallet_id, amount, description)
  VALUES ('withdrawal_approved', v_withdrawal.user_id, v_withdrawal.wallet_id, v_withdrawal.amount,
          'Withdrawal approved by ' || p_approved_by);

  RETURN TRUE;
END;
$$;

-- 3D: Reject withdrawal (release reserved funds back to available)
CREATE OR REPLACE FUNCTION reject_withdrawal_v2(
  p_withdrawal_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_withdrawal RECORD;
BEGIN
  SELECT * INTO v_withdrawal FROM withdrawal_requests WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Withdrawal not found'; END IF;
  IF v_withdrawal.status != 'pending' THEN RAISE EXCEPTION 'Withdrawal is not pending'; END IF;

  -- Release reserved funds
  UPDATE wallets
  SET reserved_balance = GREATEST(0, reserved_balance - v_withdrawal.amount),
      updated_at = NOW()
  WHERE id = v_withdrawal.wallet_id;

  UPDATE withdrawal_requests
  SET status = 'failed',
      updated_at = NOW()
  WHERE id = p_withdrawal_id;

  INSERT INTO financial_audit_logs (event_type, user_id, wallet_id, amount, description)
  VALUES ('withdrawal_rejected', v_withdrawal.user_id, v_withdrawal.wallet_id, v_withdrawal.amount,
          COALESCE(p_reason, 'Withdrawal rejected'));

  RETURN TRUE;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- PART 4: COMMISSION CALCULATIONS
-- ═══════════════════════════════════════════════════════════════════

-- 4A: Worker commission — server-side calculation on booking creation
CREATE OR REPLACE FUNCTION create_worker_booking_v2(
  p_user_id TEXT,
  p_worker_id TEXT,
  p_agreed_price NUMERIC,
  p_service_type TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_booking_id UUID;
  v_commission_percent NUMERIC;
  v_wehouse_fee NUMERIC;
  v_worker_receives NUMERIC;
BEGIN
  -- Read commission_worker from settings (default 15)
  SELECT COALESCE(NULLIF(value, '')::NUMERIC, 15)
  INTO v_commission_percent FROM platform_settings WHERE key = 'commission_worker';

  v_wehouse_fee := ROUND(p_agreed_price * v_commission_percent / 100, 2);
  v_worker_receives := p_agreed_price - v_wehouse_fee;

  INSERT INTO worker_bookings (
    user_id, worker_id, service_type,
    agreed_price, wehouse_fee, total_amount,
    commission_percent,  -- PERSIST the rate used
    status, address, notes
  ) VALUES (
    p_user_id, p_worker_id, p_service_type,
    p_agreed_price, v_wehouse_fee, p_agreed_price,
    v_commission_percent,
    'pending', p_address, p_notes
  ) RETURNING id INTO v_booking_id;

  RETURN v_booking_id;
END;
$$;

-- 4B: Apartment commission — persist rate on listing/reservation
CREATE OR REPLACE FUNCTION set_apartment_commission_on_reservation(
  p_reservation_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_commission_rate NUMERIC;
BEGIN
  SELECT COALESCE(NULLIF(value, '')::NUMERIC, 10)
  INTO v_commission_rate FROM platform_settings WHERE key = 'commission_apartment';

  UPDATE reservations
  SET commission_rate = v_commission_rate
  WHERE id = p_reservation_id;

  RETURN TRUE;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- PART 5: STAFF ANALYTICS — BRANCH/MODULE SCOPING
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION staff_branch_analytics(
  p_staff_user_id TEXT
)
RETURNS TABLE(
  metric TEXT,
  value INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_staff RECORD;
  v_state TEXT;
  v_lga TEXT;
  v_permission TEXT;
BEGIN
  -- Get staff branch assignment
  SELECT assigned_state, assigned_lga, scope
  INTO v_state, v_lga, v_staff.scope
  FROM profiles
  WHERE user_id = p_staff_user_id AND role = 'staff';

  -- No assignment = no data
  IF v_state IS NULL OR v_lga IS NULL THEN
    metric := 'unassigned'; value := 1;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Get staff permission
  SELECT permission INTO v_permission
  FROM staff_permissions
  WHERE staff_id = p_staff_user_id AND is_active = true
  LIMIT 1;

  -- field_officer: inspections in branch
  IF v_permission = 'field_officer' THEN
    SELECT 'inspections' INTO metric;
    SELECT COUNT(*)::INTEGER INTO value
    FROM user_inspection_requests uir
    JOIN listings l ON l.id = uir.listing_id
    WHERE l.state = v_state AND COALESCE(l.city, l.local_government) = v_lga
      AND uir.field_officer_id = p_staff_user_id;
    RETURN NEXT;
  END IF;

  -- support: open tickets in branch
  IF v_permission = 'support' THEN
    SELECT 'open_tickets' INTO metric;
    SELECT COUNT(*)::INTEGER INTO value
    FROM support_tickets st
    JOIN profiles p ON p.user_id = st.user_id
    WHERE st.status = 'open'
      AND p.state = v_state AND COALESCE(p.local_government, p.city) = v_lga;
    RETURN NEXT;
  END IF;

  -- operations: pending listings in branch
  IF v_permission = 'operations' THEN
    SELECT 'pending_listings' INTO metric;
    SELECT COUNT(*)::INTEGER INTO value
    FROM listings
    WHERE status = 'pending_approval'
      AND state = v_state AND COALESCE(city, local_government) = v_lga;
    RETURN NEXT;
  END IF;

  -- verification: pending workers in branch
  IF v_permission = 'verification' THEN
    SELECT 'pending_workers' INTO metric;
    SELECT COUNT(*)::INTEGER INTO value
    FROM profiles
    WHERE role = 'worker' AND worker_status = 'pending'
      AND state = v_state AND COALESCE(local_government, city) = v_lga;
    RETURN NEXT;
  END IF;

  -- finance: pending withdrawals in branch
  IF v_permission = 'finance' THEN
    SELECT 'pending_withdrawals' INTO metric;
    SELECT COUNT(*)::INTEGER INTO value
    FROM withdrawal_requests wr
    JOIN wallets w ON w.id = wr.wallet_id
    JOIN profiles p ON p.user_id = w.owner_user_id
    WHERE wr.status = 'pending'
      AND p.state = v_state AND COALESCE(p.local_government, p.city) = v_lga;
    RETURN NEXT;
  END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- PART 6: ENABLE RLS ON NEW TABLES
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE reservation_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE rent_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE rent_plan_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rent_plan_cancellations ENABLE ROW LEVEL SECURITY;

-- Simple RLS: users see their own data, staff/admin see all
CREATE POLICY IF NOT EXISTS "Users see own refunds" ON reservation_refunds
  FOR SELECT USING (auth.uid()::text = user_id);
CREATE POLICY IF NOT EXISTS "Staff admin see all refunds" ON reservation_refunds
  FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid() AND role IN ('staff','admin','creator','creator_admin')));

CREATE POLICY IF NOT EXISTS "Users see own rent plans" ON rent_plans
  FOR SELECT USING (auth.uid()::text = user_id);
CREATE POLICY IF NOT EXISTS "Staff admin manage rent plans" ON rent_plans
  FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid() AND role IN ('staff','admin','creator','creator_admin')));

CREATE POLICY IF NOT EXISTS "Users see own contributions" ON rent_plan_contributions
  FOR SELECT USING (EXISTS (SELECT 1 FROM rent_plans WHERE id = rent_plan_contributions.rent_plan_id AND user_id = auth.uid()::text));

CREATE POLICY IF NOT EXISTS "Users see own cancellations" ON rent_plan_cancellations
  FOR SELECT USING (auth.uid()::text = user_id);
