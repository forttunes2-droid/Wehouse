-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION: Backend Enforcement — Reservations, Rent Plans,
-- Withdrawals, Commission, Staff Analytics
-- Date: 2025-07-29
-- CORRECTED: Matches actual production schema (wallets.owner_id,
-- wallets.frozen_balance, existing withdrawals table)
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

-- 1A: Add reservation state fields (if not present)
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

-- 1B: Prevent double-reservation on same listing
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

-- 1C: Set hold expiry on activation
CREATE OR REPLACE FUNCTION set_reservation_expiry()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_hold_days INTEGER;
BEGIN
  IF NEW.status = 'active' AND OLD.status != 'active' THEN
    SELECT COALESCE(NULLIF(value, '')::INTEGER, 3)
    INTO v_hold_days FROM platform_settings WHERE key = 'apartment_reservation_hold_days';
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

-- 1D: Expire overdue reservations (0% refund)
CREATE OR REPLACE FUNCTION expire_overdue_reservations()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_count INTEGER := 0;
BEGIN
  UPDATE reservations
  SET status = 'expired',
      refund_amount = 0,
      refund_reason = 'Reservation hold expired — no refund',
      processed_at = NOW()
  WHERE status = 'active'
    AND hold_expires_at IS NOT NULL
    AND hold_expires_at < NOW();
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE listings
  SET availability_status = 'available', reserved_by = NULL, reserved_at = NULL
  WHERE availability_status = 'reserved'
    AND id IN (SELECT listing_id FROM reservations
               WHERE status = 'expired' AND processed_at > NOW() - INTERVAL '1 minute');
  RETURN v_count;
END;
$$;

-- 1E: Reserve listing on activation
CREATE OR REPLACE FUNCTION reserve_listing_on_activation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status = 'active' AND OLD.status != 'active' THEN
    UPDATE listings
    SET availability_status = 'reserved', reserved_by = NEW.user_id, reserved_at = NOW()
    WHERE id = NEW.listing_id AND availability_status = 'available';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reserve_listing_on_activation_trigger ON reservations;
CREATE TRIGGER reserve_listing_on_activation_trigger
  AFTER UPDATE ON reservations
  FOR EACH ROW WHEN (NEW.status = 'active')
  EXECUTE FUNCTION reserve_listing_on_activation();

-- 1F: Reservation refunds table
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
    'listing_mismatch'              -- 100%
  )),
  reason_detail TEXT,
  processed_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1G: Authoritative refund calculation (NO admin discretion)
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
  SELECT * INTO v_reservation FROM reservations WHERE id = p_reservation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found'; END IF;

  CASE p_reason_category
    WHEN 'expired_no_action' THEN v_refund_percent := 0;
    WHEN 'customer_declined_inspection' THEN
      SELECT COALESCE(NULLIF(value, '')::NUMERIC, 50)
      INTO v_post_inspection_percent FROM platform_settings WHERE key = 'post_inspection_refund_percent';
      v_refund_percent := COALESCE(v_post_inspection_percent, 50);
    WHEN 'provider_failure', 'listing_mismatch' THEN v_refund_percent := 100;
    ELSE v_refund_percent := 0;
  END CASE;

  refund_amount := ROUND(v_reservation.amount * v_refund_percent / 100, 2);
  wehouse_retained := v_reservation.amount - refund_amount;
  refund_percent := v_refund_percent;
  RETURN NEXT;
END;
$$;

-- 1H: Process refund (server-side, no admin override)
CREATE OR REPLACE FUNCTION process_reservation_refund(
  p_reservation_id UUID,
  p_reason_category TEXT,
  p_reason_detail TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_reservation RECORD;
  v_result RECORD;
  v_processed_by TEXT;
BEGIN
  SELECT user_id INTO v_processed_by FROM profiles WHERE auth_id = auth.uid()::text;
  SELECT * INTO v_reservation FROM reservations WHERE id = p_reservation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found'; END IF;
  IF v_reservation.status = 'refunded' THEN RAISE EXCEPTION 'Already refunded'; END IF;
  IF p_reason_category NOT IN ('expired_no_action', 'customer_declined_inspection', 'provider_failure', 'listing_mismatch') THEN
    RAISE EXCEPTION 'Invalid refund reason: %', p_reason_category;
  END IF;

  SELECT * INTO v_result FROM calculate_reservation_refund(p_reservation_id, p_reason_category);

  INSERT INTO reservation_refunds (reservation_id, user_id, original_amount, refund_percent, refund_amount, wehouse_retained, reason_category, reason_detail, processed_by)
  VALUES (p_reservation_id, v_reservation.user_id, v_reservation.amount, v_result.refund_percent, v_result.refund_amount, v_result.wehouse_retained, p_reason_category, p_reason_detail, COALESCE(v_processed_by, 'system'));

  UPDATE reservations SET status = 'refunded', refund_amount = v_result.refund_amount, refund_reason = p_reason_category || COALESCE(': ' || p_reason_detail, ''), processed_by = COALESCE(v_processed_by, 'system'), processed_at = NOW() WHERE id = p_reservation_id;

  UPDATE listings SET availability_status = 'available', reserved_by = NULL, reserved_at = NULL WHERE id = v_reservation.listing_id;

  RETURN TRUE;
END;
$$;

-- 1I: Inspection pauses expiry
CREATE OR REPLACE FUNCTION request_inspection_pause_expiry()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE reservations SET status = 'inspection_pending', inspection_requested_at = NOW()
  WHERE id = NEW.reservation_id AND status IN ('active', 'inspection_pending');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS request_inspection_pause_expiry_trigger ON user_inspection_requests;
CREATE TRIGGER request_inspection_pause_expiry_trigger
  AFTER INSERT ON user_inspection_requests
  FOR EACH ROW EXECUTE FUNCTION request_inspection_pause_expiry();

-- 1J: Complete inspection
CREATE OR REPLACE FUNCTION complete_inspection_result(
  p_inspection_id UUID,
  p_result TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_inspection RECORD;
BEGIN
  SELECT * INTO v_inspection FROM user_inspection_requests WHERE id = p_inspection_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inspection not found'; END IF;

  UPDATE user_inspection_requests SET status = 'completed', condition = p_result, updated_at = NOW() WHERE id = p_inspection_id;
  UPDATE reservations SET inspection_result = p_result, inspection_completed_at = NOW() WHERE id = v_inspection.reservation_id;

  IF p_result = 'customer_declined' THEN
    UPDATE listings SET availability_status = 'available', reserved_by = NULL, reserved_at = NULL WHERE id = v_inspection.listing_id;
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
  target_amount NUMERIC NOT NULL,
  start_after_months INTEGER NOT NULL DEFAULT 4,
  cancellation_fee_percent NUMERIC NOT NULL DEFAULT 10,
  accepted_terms TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  total_contributed NUMERIC NOT NULL DEFAULT 0,
  total_paid_out NUMERIC NOT NULL DEFAULT 0,
  last_contribution_at TIMESTAMPTZ,
  tenancy_start_date DATE,
  next_rent_due_date DATE,
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

-- 2A: Create rent plan with snapshotted settings
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
BEGIN
  SELECT COALESCE(NULLIF(value, '')::INTEGER, 4) INTO v_start_months FROM platform_settings WHERE key = 'rent_plan_start_after_months';
  SELECT COALESCE(NULLIF(value, '')::NUMERIC, 10) INTO v_cancel_percent FROM platform_settings WHERE key = 'rent_plan_cancellation_fee_percent';

  INSERT INTO rent_plans (user_id, listing_id, target_amount, start_after_months, cancellation_fee_percent, accepted_terms, status, tenancy_start_date)
  VALUES (p_user_id, p_listing_id, p_target_amount, v_start_months, v_cancel_percent,
          jsonb_build_object('start_after_months', v_start_months, 'cancellation_fee_percent', v_cancel_percent, 'snapshot_at', NOW())::text,
          'active', CURRENT_DATE)
  RETURNING id INTO v_plan_id;
  RETURN v_plan_id;
END;
$$;

-- 2B: Cancel rent plan
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

  IF p_reason_category = 'provider_failure' THEN
    v_fee_amount := 0;
    v_refund_amount := v_plan.total_contributed;
  ELSE
    v_fee_amount := ROUND(v_plan.total_contributed * v_plan.cancellation_fee_percent / 100, 2);
    v_refund_amount := v_plan.total_contributed - v_fee_amount;
  END IF;

  INSERT INTO rent_plan_cancellations (rent_plan_id, user_id, total_contributed, cancellation_fee_percent, cancellation_fee_amount, refund_amount, reason, reason_category)
  VALUES (p_plan_id, v_plan.user_id, v_plan.total_contributed, v_plan.cancellation_fee_percent, v_fee_amount, v_refund_amount, p_reason, p_reason_category);

  UPDATE rent_plans SET status = 'cancelled', total_paid_out = v_refund_amount, updated_at = NOW() WHERE id = p_plan_id;

  refund_amount := v_refund_amount;
  fee_amount := v_fee_amount;
  total_contributed := v_plan.total_contributed;
  RETURN NEXT;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- PART 3: WITHDRAWAL v2 (uses existing withdrawals table + frozen_balance)
-- ═══════════════════════════════════════════════════════════════════

-- 3B: Request withdrawal (deducts available, moves to frozen_balance)
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
  SELECT COALESCE(NULLIF(value, '')::NUMERIC, 5000) INTO v_min_withdrawal FROM platform_settings WHERE key = 'min_withdrawal';
  SELECT * INTO v_wallet FROM wallets WHERE id = p_wallet_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet not found'; END IF;

  IF p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be greater than 0'; END IF;
  IF p_amount < v_min_withdrawal THEN RAISE EXCEPTION 'Minimum withdrawal is N%', v_min_withdrawal; END IF;
  IF p_amount > v_wallet.available_balance THEN RAISE EXCEPTION 'Insufficient balance. Available: N%', v_wallet.available_balance; END IF;

  -- Move from available to frozen (hold until approved/rejected)
  UPDATE wallets SET available_balance = available_balance - p_amount, frozen_balance = frozen_balance + p_amount, updated_at = NOW() WHERE id = p_wallet_id;

  INSERT INTO withdrawals (wallet_id, amount, bank_account_number, bank_code, bank_name, account_name, status)
  VALUES (p_wallet_id, p_amount, p_bank_account_number, p_bank_code, p_bank_name, p_account_name, 'pending')
  RETURNING id INTO v_withdrawal_id;

  INSERT INTO financial_audit_logs (event_type, user_id, amount, reference_id, reference_type, description)
  VALUES ('withdrawal_requested', v_wallet.owner_id, p_amount, v_withdrawal_id::text, 'withdrawal', 'Funds moved to frozen_balance');

  RETURN v_withdrawal_id;
END;
$$;

-- 3C: Approve withdrawal
CREATE OR REPLACE FUNCTION approve_withdrawal_v2(
  p_withdrawal_id UUID,
  p_approved_by TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_withdrawal RECORD;
  v_wallet RECORD;
BEGIN
  SELECT * INTO v_withdrawal FROM withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Withdrawal not found'; END IF;
  IF v_withdrawal.status NOT IN ('pending', 'processing') THEN RAISE EXCEPTION 'Cannot be approved'; END IF;

  SELECT * INTO v_wallet FROM wallets WHERE id = v_withdrawal.wallet_id FOR UPDATE;
  IF v_wallet.owner_id = p_approved_by THEN RAISE EXCEPTION 'Cannot approve own withdrawal'; END IF;

  UPDATE wallets SET frozen_balance = GREATEST(0, frozen_balance - v_withdrawal.amount), total_withdrawn = total_withdrawn + v_withdrawal.amount, updated_at = NOW() WHERE id = v_withdrawal.wallet_id;
  UPDATE withdrawals SET status = 'successful', processed_at = NOW(), updated_at = NOW() WHERE id = p_withdrawal_id;

  INSERT INTO financial_audit_logs (event_type, user_id, amount, reference_id, reference_type, description)
  VALUES ('withdrawal_successful', v_wallet.owner_id, v_withdrawal.amount, p_withdrawal_id::text, 'withdrawal', 'Approved by ' || p_approved_by);
  RETURN TRUE;
END;
$$;

-- 3D: Reject withdrawal (returns frozen funds to available)
CREATE OR REPLACE FUNCTION reject_withdrawal_v2(
  p_withdrawal_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_withdrawal RECORD;
  v_wallet RECORD;
BEGIN
  SELECT * INTO v_withdrawal FROM withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Withdrawal not found'; END IF;
  IF v_withdrawal.status NOT IN ('pending', 'processing') THEN RAISE EXCEPTION 'Cannot be rejected'; END IF;

  SELECT * INTO v_wallet FROM wallets WHERE id = v_withdrawal.wallet_id FOR UPDATE;

  UPDATE wallets SET frozen_balance = GREATEST(0, frozen_balance - v_withdrawal.amount), available_balance = available_balance + v_withdrawal.amount, updated_at = NOW() WHERE id = v_withdrawal.wallet_id;
  UPDATE withdrawals SET status = 'failed', failed_reason = p_reason, updated_at = NOW() WHERE id = p_withdrawal_id;

  INSERT INTO financial_audit_logs (event_type, user_id, amount, reference_id, reference_type, description)
  VALUES ('withdrawal_failed', v_wallet.owner_id, v_withdrawal.amount, p_withdrawal_id::text, 'withdrawal', COALESCE(p_reason, 'Rejected'));
  RETURN TRUE;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- PART 4: COMMISSION CALCULATIONS
-- ═══════════════════════════════════════════════════════════════════

-- 4A: Worker booking with server-side commission
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
BEGIN
  SELECT COALESCE(NULLIF(value, '')::NUMERIC, 15) INTO v_commission_percent FROM platform_settings WHERE key = 'commission_worker';
  v_wehouse_fee := ROUND(p_agreed_price * v_commission_percent / 100, 2);

  INSERT INTO worker_bookings (user_id, worker_id, service_type, agreed_amount, worker_receives, status, address, notes)
  VALUES (p_user_id, p_worker_id, p_service_type, p_agreed_price, p_agreed_price - v_wehouse_fee, 'pending', p_address, p_notes)
  RETURNING id INTO v_booking_id;

  RETURN v_booking_id;
END;
$$;

-- 4B: Apartment commission snapshot on reservation
CREATE OR REPLACE FUNCTION set_apartment_commission_on_reservation(p_reservation_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_rate NUMERIC;
BEGIN
  SELECT COALESCE(NULLIF(value, '')::NUMERIC, 10) INTO v_rate FROM platform_settings WHERE key = 'commission_apartment';
  UPDATE reservations SET commission_rate = v_rate WHERE id = p_reservation_id;
  RETURN TRUE;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- PART 5: STAFF ANALYTICS — BRANCH/MODULE SCOPED
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION staff_branch_analytics(
  p_staff_user_id TEXT
)
RETURNS TABLE(metric TEXT, value INTEGER)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_staff RECORD;
  v_permission TEXT;
BEGIN
  SELECT assigned_state, assigned_lga, scope INTO v_staff
  FROM profiles WHERE user_id = p_staff_user_id AND role = 'staff';

  IF v_staff.assigned_state IS NULL OR v_staff.assigned_lga IS NULL THEN
    metric := 'unassigned'; value := 1; RETURN NEXT; RETURN;
  END IF;

  SELECT permission INTO v_permission
  FROM staff_permissions WHERE staff_id = p_staff_user_id AND is_active = true LIMIT 1;

  IF v_permission = 'field_officer' THEN
    metric := 'inspections';
    SELECT COUNT(*)::INTEGER INTO value FROM user_inspection_requests uir
    JOIN listings l ON l.id = uir.listing_id
    WHERE l.state = v_staff.assigned_state AND COALESCE(l.city, l.local_government) = v_staff.assigned_lga
      AND uir.field_officer_id = p_staff_user_id AND uir.status IN ('scheduled', 'in_progress');
    RETURN NEXT;
  END IF;

  IF v_permission = 'support' THEN
    metric := 'open_tickets';
    SELECT COUNT(*)::INTEGER INTO value FROM support_tickets st
    JOIN profiles p ON p.user_id = st.user_id
    WHERE st.status = 'open' AND p.state = v_staff.assigned_state AND COALESCE(p.local_government, p.city) = v_staff.assigned_lga;
    RETURN NEXT;
  END IF;

  IF v_permission = 'operations' THEN
    metric := 'pending_listings';
    SELECT COUNT(*)::INTEGER INTO value FROM listings
    WHERE status = 'pending_approval' AND state = v_staff.assigned_state AND COALESCE(city, local_government) = v_staff.assigned_lga;
    RETURN NEXT;
  END IF;

  IF v_permission = 'verification' THEN
    metric := 'pending_workers';
    SELECT COUNT(*)::INTEGER INTO value FROM profiles
    WHERE role = 'worker' AND worker_status = 'pending'
      AND state = v_staff.assigned_state AND COALESCE(local_government, city) = v_staff.assigned_lga;
    RETURN NEXT;
  END IF;

  IF v_permission = 'finance' THEN
    metric := 'pending_withdrawals';
    SELECT COUNT(*)::INTEGER INTO value FROM withdrawals w
    JOIN wallets wl ON wl.id = w.wallet_id
    JOIN profiles p ON p.user_id = wl.owner_id
    WHERE w.status = 'pending' AND p.state = v_staff.assigned_state AND COALESCE(p.local_government, p.city) = v_staff.assigned_lga;
    RETURN NEXT;
  END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- PART 6: RLS POLICIES ON NEW TABLES
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE reservation_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE rent_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE rent_plan_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rent_plan_cancellations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_own_refunds" ON reservation_refunds;
CREATE POLICY "users_own_refunds" ON reservation_refunds FOR SELECT USING (auth.uid()::text = user_id);
DROP POLICY IF EXISTS "staff_admin_all_refunds" ON reservation_refunds;
CREATE POLICY "staff_admin_all_refunds" ON reservation_refunds FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid() AND role IN ('staff','admin','creator','creator_admin')));

DROP POLICY IF EXISTS "users_own_rent_plans" ON rent_plans;
CREATE POLICY "users_own_rent_plans" ON rent_plans FOR SELECT USING (auth.uid()::text = user_id);
DROP POLICY IF EXISTS "staff_admin_manage_rent" ON rent_plans;
CREATE POLICY "staff_admin_manage_rent" ON rent_plans FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid() AND role IN ('staff','admin','creator','creator_admin')));

DROP POLICY IF EXISTS "users_own_contributions" ON rent_plan_contributions;
CREATE POLICY "users_own_contributions" ON rent_plan_contributions FOR SELECT USING (EXISTS (SELECT 1 FROM rent_plans WHERE id = rent_plan_contributions.rent_plan_id AND user_id = auth.uid()::text));

DROP POLICY IF EXISTS "users_own_cancellations" ON rent_plan_cancellations;
CREATE POLICY "users_own_cancellations" ON rent_plan_cancellations FOR SELECT USING (auth.uid()::text = user_id);
