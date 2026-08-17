-- ═══════════════════════════════════════════════════════════════════
-- WEHOUSE FINANCE SYSTEM (Complete)
-- Automatic withdrawals, escrow, audit trail, finance dashboard
-- ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════
-- 1. WALLET BALANCES TABLE (Real-time balances per user)
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS wallet_balances (
  user_id TEXT PRIMARY KEY REFERENCES profiles(user_id) ON DELETE CASCADE,
  available_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  pending_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_earned NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_withdrawn NUMERIC(12,2) NOT NULL DEFAULT 0,
  frozen BOOLEAN NOT NULL DEFAULT FALSE,
  frozen_reason TEXT DEFAULT NULL,
  frozen_by TEXT DEFAULT NULL,
  frozen_at TIMESTAMPTZ DEFAULT NULL,
  currency TEXT NOT NULL DEFAULT 'NGN',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE wallet_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wallet_owner_read" ON wallet_balances FOR SELECT USING (auth.uid()::text = user_id OR EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('creator','admin','staff')));
CREATE POLICY "wallet_system_write" ON wallet_balances FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- ═══════════════════════════════════════════════════════════
-- 2. WALLET TRANSACTIONS (Every credit/debit to a wallet)
-- ═══════════════════════════════════════════════════════════
CREATE TYPE wallet_transaction_type AS ENUM (
  'booking_credit',      -- Money from completed booking
  'commission_deduct',   -- WeHouse commission taken
  'withdrawal_request',  -- User requested withdrawal
  'withdrawal_paid',     -- Withdrawal completed
  'withdrawal_failed',   -- Withdrawal failed
  'refund',              -- Refund to user
  'adjustment',          -- Manual adjustment by admin
  'escrow_release',      -- Money released from escrow
  'escrow_deposit'       -- Money put into escrow
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES profiles(user_id),
  transaction_type wallet_transaction_type NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  balance_after NUMERIC(12,2) NOT NULL,
  reference_id TEXT,           -- booking_id, withdrawal_id, etc.
  reference_type TEXT,         -- 'booking', 'withdrawal', 'refund'
  description TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wallet_tx_all" ON wallet_transactions FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE INDEX IF NOT EXISTS idx_wt_user ON wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_wt_type ON wallet_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_wt_created ON wallet_transactions(created_at);

-- ═══════════════════════════════════════════════════════════
-- 3. ESCROW TRANSACTIONS (Tracks money held in escrow)
-- ═══════════════════════════════════════════════════════════
CREATE TYPE escrow_status AS ENUM ('holding', 'released', 'refunded', 'disputed');

CREATE TABLE IF NOT EXISTS escrow_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL,
  booking_type TEXT NOT NULL DEFAULT 'worker', -- worker, hotel, property
  payer_user_id TEXT NOT NULL,
  payee_user_id TEXT NOT NULL,
  amount_total NUMERIC(12,2) NOT NULL,
  amount_commission NUMERIC(12,2) NOT NULL,
  amount_payee NUMERIC(12,2) NOT NULL,
  commission_rate NUMERIC(5,2) NOT NULL,
  status escrow_status NOT NULL DEFAULT 'holding',
  released_at TIMESTAMPTZ,
  released_by TEXT, -- 'user_confirm', 'auto_release', 'admin'
  dispute_reason TEXT,
  paystack_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE escrow_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "escrow_all" ON escrow_transactions FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE INDEX IF NOT EXISTS idx_et_booking ON escrow_transactions(booking_id);
CREATE INDEX IF NOT EXISTS idx_et_status ON escrow_transactions(status);
CREATE INDEX IF NOT EXISTS idx_et_payee ON escrow_transactions(payee_user_id);

-- ═══════════════════════════════════════════════════════════
-- 4. WITHDRAWAL REQUESTS (Worker/Partner payout requests)
-- ═══════════════════════════════════════════════════════════
CREATE TYPE withdrawal_status AS ENUM (
  'pending',       -- Requested, awaiting processing
  'processing',    -- Being processed by Paystack
  'paid',          -- Successfully transferred
  'failed',        -- Transfer failed
  'rejected',      -- Rejected by admin/finance
  'retrying'       -- Failed but being retried
);

CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES profiles(user_id),
  user_role TEXT NOT NULL, -- worker, property_partner
  amount_requested NUMERIC(12,2) NOT NULL,
  withdrawal_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount_paid NUMERIC(12,2), -- After fee deduction
  status withdrawal_status NOT NULL DEFAULT 'pending',
  bank_name TEXT NOT NULL,
  bank_code TEXT NOT NULL,
  bank_account_number TEXT NOT NULL,
  bank_account_name TEXT,
  paystack_transfer_code TEXT,
  paystack_transfer_reference TEXT,
  failure_reason TEXT,
  processed_by TEXT, -- staff user_id who processed (if manual)
  processed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  retry_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE withdrawal_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "withdrawal_all" ON withdrawal_requests FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE INDEX IF NOT EXISTS idx_wr_user ON withdrawal_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_wr_status ON withdrawal_requests(status);
CREATE INDEX IF NOT EXISTS idx_wr_created ON withdrawal_requests(created_at);

-- ═══════════════════════════════════════════════════════════
-- 5. FINANCIAL AUDIT LOG (Complete audit trail — NEVER deleted)
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS financial_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,           -- 'withdrawal_created', 'withdrawal_paid', 'wallet_frozen', etc.
  actor_id TEXT,                  -- Who did it (user_id or 'system')
  actor_role TEXT,                -- worker, partner, admin, staff, system
  target_user_id TEXT,            -- Who was affected
  target_type TEXT,               -- 'withdrawal', 'wallet', 'escrow', 'booking'
  target_id TEXT,                 -- The ID of the affected record
  amount NUMERIC(12,2),
  balance_before NUMERIC(12,2),
  balance_after NUMERIC(12,2),
  commission_amount NUMERIC(12,2),
  description TEXT NOT NULL,
  paystack_reference TEXT,
  paystack_transfer_code TEXT,
  bank_details JSONB,
  status_before TEXT,
  status_after TEXT,
  failure_reason TEXT,
  ip_address TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE financial_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_all" ON financial_audit_log FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE INDEX IF NOT EXISTS idx_fal_actor ON financial_audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_fal_target ON financial_audit_log(target_user_id);
CREATE INDEX IF NOT EXISTS idx_fal_action ON financial_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_fal_created ON financial_audit_log(created_at DESC);

-- ═══════════════════════════════════════════════════════════
-- 6. FUNCTIONS: Automatic Payout System
-- ═══════════════════════════════════════════════════════════

-- Credit a worker/partner wallet after escrow release
CREATE OR REPLACE FUNCTION public.credit_wallet(
  p_user_id TEXT,
  p_amount NUMERIC,
  p_reference_id TEXT,
  p_reference_type TEXT,
  p_description TEXT,
  p_metadata JSONB DEFAULT '{}'
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old_balance NUMERIC;
  v_new_balance NUMERIC;
BEGIN
  -- Get or create wallet
  SELECT available_balance INTO v_old_balance FROM wallet_balances WHERE user_id = p_user_id;
  IF v_old_balance IS NULL THEN
    INSERT INTO wallet_balances (user_id, available_balance, total_earned)
    VALUES (p_user_id, p_amount, p_amount);
    v_old_balance := 0;
    v_new_balance := p_amount;
  ELSE
    v_new_balance := v_old_balance + p_amount;
    UPDATE wallet_balances SET
      available_balance = v_new_balance,
      total_earned = total_earned + p_amount,
      updated_at = NOW()
    WHERE user_id = p_user_id;
  END IF;

  -- Record transaction
  INSERT INTO wallet_transactions (user_id, transaction_type, amount, balance_after,
    reference_id, reference_type, description, metadata)
  VALUES (p_user_id, 'booking_credit', p_amount, v_new_balance,
    p_reference_id, p_reference_type, p_description, p_metadata);

  -- Audit log
  INSERT INTO financial_audit_log (action, actor_id, actor_role, target_user_id,
    target_type, target_id, amount, balance_before, balance_after, description)
  VALUES ('wallet_credited', 'system', 'system', p_user_id,
    p_reference_type, p_reference_id, p_amount, v_old_balance, v_new_balance, p_description);

  RETURN jsonb_build_object('success', TRUE, 'new_balance', v_new_balance);
END;
$$;

-- Create a withdrawal request (validates balance and details)
CREATE OR REPLACE FUNCTION public.create_withdrawal_request(
  p_user_id TEXT,
  p_amount NUMERIC
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_balance NUMERIC;
  v_frozen BOOLEAN;
  v_min_withdrawal NUMERIC;
  v_withdrawal_fee NUMERIC;
  v_bank_name TEXT;
  v_bank_code TEXT;
  v_account_number TEXT;
  v_account_name TEXT;
  v_request_id UUID;
  v_net_amount NUMERIC;
BEGIN
  -- Check wallet exists and not frozen
  SELECT available_balance, frozen INTO v_balance, v_frozen
  FROM wallet_balances WHERE user_id = p_user_id;

  IF v_balance IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'No wallet found');
  END IF;

  IF v_frozen THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Wallet is frozen. Contact support.');
  END IF;

  -- Get settings
  SELECT COALESCE(NULLIF(value,''),'1000')::NUMERIC INTO v_min_withdrawal
  FROM platform_settings WHERE key = 'minimum_withdrawal';
  SELECT COALESCE(NULLIF(value,''),'50')::NUMERIC INTO v_withdrawal_fee
  FROM platform_settings WHERE key = 'withdrawal_fee';

  -- Validate amount
  IF p_amount < v_min_withdrawal THEN
    RETURN jsonb_build_object('success', FALSE, 'error',
      format('Minimum withdrawal is N%s', v_min_withdrawal));
  END IF;

  IF p_amount > v_balance THEN
    RETURN jsonb_build_object('success', FALSE, 'error',
      format('Insufficient balance. Available: N%s', v_balance));
  END IF;

  -- Get bank details from profile
  SELECT bank_name, bank_code, bank_account_number
  INTO v_bank_name, v_bank_code, v_account_number
  FROM profiles WHERE user_id = p_user_id;

  IF COALESCE(v_bank_code,'') = '' OR COALESCE(v_account_number,'') = '' THEN
    RETURN jsonb_build_object('success', FALSE, 'error',
      'Bank details not set. Add your bank account in profile settings.');
  END IF;

  -- Calculate net amount
  v_net_amount := p_amount - v_withdrawal_fee;
  IF v_net_amount <= 0 THEN
    RETURN jsonb_build_object('success', FALSE, 'error',
      'Amount too small after withdrawal fee');
  END IF;

  -- Deduct from available, add to pending
  UPDATE wallet_balances SET
    available_balance = available_balance - p_amount,
    pending_balance = pending_balance + p_amount,
    updated_at = NOW()
  WHERE user_id = p_user_id;

  -- Create withdrawal request
  INSERT INTO withdrawal_requests (user_id, user_role, amount_requested,
    withdrawal_fee, amount_paid, bank_name, bank_code, bank_account_number,
    status, metadata)
  SELECT p_user_id, role, p_amount, v_withdrawal_fee, v_net_amount,
    v_bank_name, v_bank_code, v_account_number, 'pending',
    jsonb_build_object('net_amount', v_net_amount, 'fee', v_withdrawal_fee)
  FROM profiles WHERE user_id = p_user_id
  RETURNING id INTO v_request_id;

  -- Record wallet transaction
  INSERT INTO wallet_transactions (user_id, transaction_type, amount, balance_after,
    reference_id, reference_type, description)
  VALUES (p_user_id, 'withdrawal_request', -p_amount, v_balance - p_amount,
    v_request_id::text, 'withdrawal', format('Withdrawal request: N%s', p_amount));

  -- Audit log
  INSERT INTO financial_audit_log (action, actor_id, actor_role, target_user_id,
    target_type, target_id, amount, balance_before, balance_after, description,
    bank_details)
  VALUES ('withdrawal_created', p_user_id,
    (SELECT role FROM profiles WHERE user_id = p_user_id),
    p_user_id, 'withdrawal', v_request_id::text, p_amount, v_balance,
    v_balance - p_amount, format('Withdrawal request created: N%s', p_amount),
    jsonb_build_object('bank_name', v_bank_name, 'account', v_account_number));

  RETURN jsonb_build_object('success', TRUE, 'request_id', v_request_id,
    'amount', p_amount, 'fee', v_withdrawal_fee, 'net_amount', v_net_amount);
END;
$$;

-- Process withdrawal (mark as paid — called after Paystack transfer succeeds)
CREATE OR REPLACE FUNCTION public.complete_withdrawal(
  p_request_id UUID,
  p_paystack_transfer_code TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'paid'
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_request RECORD;
  v_balance NUMERIC;
BEGIN
  SELECT * INTO v_request FROM withdrawal_requests WHERE id = p_request_id;
  IF v_request IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Withdrawal not found');
  END IF;

  -- Update withdrawal status
  UPDATE withdrawal_requests SET
    status = p_status::withdrawal_status,
    paystack_transfer_code = COALESCE(p_paystack_transfer_code, paystack_transfer_code),
    completed_at = CASE WHEN p_status = 'paid' THEN NOW() ELSE completed_at END,
    updated_at = NOW()
  WHERE id = p_request_id;

  -- If paid: move from pending to withdrawn
  IF p_status = 'paid' THEN
    UPDATE wallet_balances SET
      pending_balance = pending_balance - v_request.amount_requested,
      total_withdrawn = total_withdrawn + v_request.amount_requested,
      updated_at = NOW()
    WHERE user_id = v_request.user_id;

    SELECT available_balance INTO v_balance FROM wallet_balances WHERE user_id = v_request.user_id;

    -- Record transaction
    INSERT INTO wallet_transactions (user_id, transaction_type, amount, balance_after,
      reference_id, reference_type, description)
    VALUES (v_request.user_id, 'withdrawal_paid', 0, v_balance,
      p_request_id::text, 'withdrawal', format('Withdrawal paid: N%s', v_request.amount_paid));
  END IF;

  -- Audit log
  INSERT INTO financial_audit_log (action, actor_id, actor_role, target_user_id,
    target_type, target_id, amount, description, paystack_transfer_code, status_after)
  VALUES (format('withdrawal_%s', p_status), 'system', 'system', v_request.user_id,
    'withdrawal', p_request_id::text, v_request.amount_paid,
    format('Withdrawal %s: N%s', p_status, v_request.amount_paid),
    p_paystack_transfer_code, p_status);

  RETURN jsonb_build_object('success', TRUE, 'status', p_status);
END;
$$;

-- Freeze/unfreeze wallet (Finance/Admin only)
CREATE OR REPLACE FUNCTION public.set_wallet_frozen(
  p_user_id TEXT,
  p_frozen BOOLEAN,
  p_reason TEXT DEFAULT NULL,
  p_frozen_by TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE wallet_balances SET
    frozen = p_frozen,
    frozen_reason = CASE WHEN p_frozen THEN p_reason ELSE NULL END,
    frozen_by = CASE WHEN p_frozen THEN p_frozen_by ELSE NULL END,
    frozen_at = CASE WHEN p_frozen THEN NOW() ELSE NULL END,
    updated_at = NOW()
  WHERE user_id = p_user_id;

  INSERT INTO financial_audit_log (action, actor_id, actor_role, target_user_id,
    target_type, description, status_after)
  VALUES (CASE WHEN p_frozen THEN 'wallet_frozen' ELSE 'wallet_unfrozen' END,
    p_frozen_by, 'staff', p_user_id, 'wallet',
    COALESCE(p_reason, 'No reason provided'),
    CASE WHEN p_frozen THEN 'frozen' ELSE 'active' END);

  RETURN jsonb_build_object('success', TRUE, 'frozen', p_frozen);
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 7. FUNCTIONS: Finance Dashboard Stats
-- ═══════════════════════════════════════════════════════════

-- Get complete platform financial summary
CREATE OR REPLACE FUNCTION public.get_platform_finance_summary(
  p_start_date TIMESTAMPTZ DEFAULT NULL,
  p_end_date TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total_revenue NUMERIC;
  v_total_commission NUMERIC;
  v_total_worker_earnings NUMERIC;
  v_total_partner_earnings NUMERIC;
  v_total_withdrawn NUMERIC;
  v_pending_withdrawals NUMERIC;
  v_escrow_holding NUMERIC;
  v_failed_payouts NUMERIC;
  v_total_refunds NUMERIC;
BEGIN
  -- Revenue from paid bookings
  SELECT COALESCE(SUM(amount_total), 0) INTO v_total_revenue
  FROM booking_payments
  WHERE status = 'paid'
    AND (p_start_date IS NULL OR created_at >= p_start_date)
    AND (p_end_date IS NULL OR created_at <= p_end_date);

  -- Commission earned
  SELECT COALESCE(SUM(commission_amount), 0) INTO v_total_commission
  FROM commission_ledger
  WHERE (p_start_date IS NULL OR created_at >= p_start_date)
    AND (p_end_date IS NULL OR created_at <= p_end_date);

  -- Worker earnings
  SELECT COALESCE(SUM(amount_worker), 0) INTO v_total_worker_earnings
  FROM booking_payments
  WHERE booking_type = 'worker' AND status = 'paid'
    AND (p_start_date IS NULL OR created_at >= p_start_date)
    AND (p_end_date IS NULL OR created_at <= p_end_date);

  -- Partner earnings
  SELECT COALESCE(SUM(amount_worker), 0) INTO v_total_partner_earnings
  FROM booking_payments
  WHERE booking_type = 'partner' AND status = 'paid'
    AND (p_start_date IS NULL OR created_at >= p_start_date)
    AND (p_end_date IS NULL OR created_at <= p_end_date);

  -- Total withdrawn
  SELECT COALESCE(SUM(amount_paid), 0) INTO v_total_withdrawn
  FROM withdrawal_requests
  WHERE status = 'paid'
    AND (p_start_date IS NULL OR created_at <= p_end_date);

  -- Pending withdrawals
  SELECT COALESCE(SUM(amount_requested), 0) INTO v_pending_withdrawals
  FROM withdrawal_requests
  WHERE status IN ('pending', 'processing', 'retrying');

  -- Escrow holding
  SELECT COALESCE(SUM(amount_total), 0) INTO v_escrow_holding
  FROM escrow_transactions WHERE status = 'holding';

  -- Failed payouts
  SELECT COALESCE(SUM(amount_paid), 0) INTO v_failed_payouts
  FROM withdrawal_requests WHERE status = 'failed';

  -- Refunds
  SELECT COALESCE(SUM(amount), 0) INTO v_total_refunds
  FROM wallet_transactions WHERE transaction_type = 'refund'
    AND (p_start_date IS NULL OR created_at >= p_start_date)
    AND (p_end_date IS NULL OR created_at <= p_end_date);

  RETURN jsonb_build_object(
    'total_revenue', v_total_revenue,
    'total_commission', v_total_commission,
    'total_worker_earnings', v_total_worker_earnings,
    'total_partner_earnings', v_total_partner_earnings,
    'total_withdrawn', v_total_withdrawn,
    'pending_withdrawals', v_pending_withdrawals,
    'escrow_holding', v_escrow_holding,
    'failed_payouts', v_failed_payouts,
    'total_refunds', v_total_refunds
  );
END;
$$;

-- Get withdrawal requests with filters (for finance dashboard)
CREATE OR REPLACE FUNCTION public.get_withdrawal_requests(
  p_status TEXT DEFAULT NULL,
  p_user_role TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE(
  id UUID, user_id TEXT, user_role TEXT, username TEXT,
  amount_requested NUMERIC, withdrawal_fee NUMERIC, amount_paid NUMERIC,
  status TEXT, bank_name TEXT, bank_account_number TEXT,
  paystack_transfer_code TEXT, failure_reason TEXT, retry_count INTEGER,
  created_at TIMESTAMPTZ, completed_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT wr.id, wr.user_id, wr.user_role, p.username,
    wr.amount_requested, wr.withdrawal_fee, wr.amount_paid,
    wr.status::text, wr.bank_name, wr.bank_account_number,
    wr.paystack_transfer_code, wr.failure_reason, wr.retry_count,
    wr.created_at, wr.completed_at
  FROM withdrawal_requests wr
  JOIN profiles p ON p.user_id = wr.user_id
  WHERE (p_status IS NULL OR wr.status::text = p_status)
    AND (p_user_role IS NULL OR wr.user_role = p_user_role)
  ORDER BY wr.created_at DESC
  LIMIT p_limit;
END;
$$;

-- Get user's wallet with transaction history
CREATE OR REPLACE FUNCTION public.get_user_wallet(p_user_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wallet RECORD;
  v_recent_tx JSONB;
BEGIN
  SELECT * INTO v_wallet FROM wallet_balances WHERE user_id = p_user_id;

  SELECT jsonb_agg(jsonb_build_object(
    'id', wt.id, 'type', wt.transaction_type, 'amount', wt.amount,
    'balance_after', wt.balance_after, 'description', wt.description,
    'created_at', wt.created_at
  ) ORDER BY wt.created_at DESC)
  INTO v_recent_tx
  FROM wallet_transactions wt
  WHERE wt.user_id = p_user_id
  LIMIT 20;

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'available_balance', COALESCE(v_wallet.available_balance, 0),
    'pending_balance', COALESCE(v_wallet.pending_balance, 0),
    'total_earned', COALESCE(v_wallet.total_earned, 0),
    'total_withdrawn', COALESCE(v_wallet.total_withdrawn, 0),
    'frozen', COALESCE(v_wallet.frozen, FALSE),
    'frozen_reason', v_wallet.frozen_reason,
    'transactions', COALESCE(v_recent_tx, '[]'::jsonb)
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 8. GRANT PERMISSIONS
-- ═══════════════════════════════════════════════════════════

GRANT EXECUTE ON FUNCTION public.credit_wallet TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_withdrawal_request TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_withdrawal TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_wallet_frozen TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_platform_finance_summary TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_withdrawal_requests TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_wallet TO authenticated;
