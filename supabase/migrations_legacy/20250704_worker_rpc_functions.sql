-- ═══════════════════════════════════════════════════════════════
-- WORKER SYSTEM: RPC Functions for Atomic Wallet Operations
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. CREDIT WALLET (Atomic) ───────────────────────────────
-- Credits amount to wallet, creates transaction record, logs audit
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
  v_new_balance DECIMAL;
BEGIN
  -- Lock the wallet row
  SELECT * INTO v_wallet FROM wallets WHERE id = p_wallet_id FOR UPDATE;
  
  IF v_wallet IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wallet not found');
  END IF;

  IF v_wallet.is_frozen THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wallet is frozen');
  END IF;

  -- Calculate new balance
  v_new_balance := v_wallet.available_balance + p_amount;

  -- Update wallet
  UPDATE wallets SET
    available_balance = v_new_balance,
    updated_at = now()
  WHERE id = p_wallet_id;

  -- Create transaction record
  INSERT INTO wallet_transactions (wallet_id, type, amount, description, reference, balance_after)
  VALUES (p_wallet_id, 'credit', p_amount, p_description, p_reference, v_new_balance);

  -- Log audit
  INSERT INTO financial_audit_logs (event_type, user_id, amount, reference_id, reference_type, description)
  VALUES ('escrow_released', v_wallet.owner_id, p_amount, p_wallet_id::text, 'wallet', p_description);

  RETURN jsonb_build_object('success', true, 'new_balance', v_new_balance);
END;
$$;

-- ─── 2. RELEASE ESCROW (Atomic) ──────────────────────────────
-- Moves escrow from 'held' to 'released', credits wallet
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
  v_new_balance DECIMAL;
BEGIN
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

  IF v_wallet.is_frozen THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wallet is frozen');
  END IF;

  -- Calculate new balance
  v_new_balance := v_wallet.available_balance + v_escrow.net_amount;

  -- Update wallet
  UPDATE wallets SET
    available_balance = v_new_balance,
    updated_at = now()
  WHERE id = p_wallet_id;

  -- Update escrow
  UPDATE escrow_transactions SET
    status = 'released',
    released_at = now(),
    released_to_wallet_id = p_wallet_id,
    updated_at = now()
  WHERE id = p_escrow_id;

  -- Create wallet transaction
  INSERT INTO wallet_transactions (wallet_id, type, amount, description, reference, balance_after)
  VALUES (p_wallet_id, 'escrow_release', v_escrow.net_amount, 'Escrow released for ' || v_escrow.reference, v_escrow.reference, v_new_balance);

  -- Log audit
  INSERT INTO financial_audit_logs (event_type, user_id, target_user_id, amount, reference_id, reference_type, description)
  VALUES ('escrow_released', v_escrow.customer_id, v_wallet.owner_id, v_escrow.net_amount, p_escrow_id::text, 'escrow', 'Escrow released to wallet');

  RETURN jsonb_build_object('success', true, 'amount_released', v_escrow.net_amount, 'new_balance', v_new_balance);
END;
$$;

-- ─── 3. REFUND ESCROW (Atomic) ───────────────────────────────
-- Refunds escrow to customer, marks as refunded
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
BEGIN
  SELECT * INTO v_escrow FROM escrow_transactions WHERE id = p_escrow_id FOR UPDATE;

  IF v_escrow IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Escrow not found');
  END IF;

  IF v_escrow.status NOT IN ('held', 'disputed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Escrow cannot be refunded');
  END IF;

  -- Update escrow status
  UPDATE escrow_transactions SET
    status = 'refunded',
    updated_at = now()
  WHERE id = p_escrow_id;

  -- Log audit
  INSERT INTO financial_audit_logs (event_type, user_id, target_user_id, amount, reference_id, reference_type, description, metadata)
  VALUES ('escrow_refunded', v_escrow.customer_id, v_escrow.worker_id, v_escrow.gross_amount, p_escrow_id::text, 'escrow', COALESCE(p_reason, 'Escrow refunded'), jsonb_build_object('reason', p_reason));

  RETURN jsonb_build_object('success', true, 'amount_refunded', v_escrow.gross_amount);
END;
$$;

-- ─── 4. PROCESS WITHDRAWAL (Atomic) ──────────────────────────
-- Deducts from wallet, updates withdrawal status
CREATE OR REPLACE FUNCTION process_withdrawal(
  p_withdrawal_id UUID,
  p_paystack_transfer_code TEXT,
  p_paystack_reference TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_withdrawal RECORD;
  v_wallet RECORD;
  v_new_balance DECIMAL;
BEGIN
  SELECT * INTO v_withdrawal FROM withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  SELECT * INTO v_wallet FROM wallets WHERE id = v_withdrawal.wallet_id FOR UPDATE;

  IF v_withdrawal IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Withdrawal not found');
  END IF;

  IF v_withdrawal.status != 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Withdrawal is not pending');
  END IF;

  IF v_wallet.available_balance < v_withdrawal.amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance');
  END IF;

  -- Deduct from wallet
  v_new_balance := v_wallet.available_balance - v_withdrawal.amount;
  UPDATE wallets SET
    available_balance = v_new_balance,
    total_withdrawn = v_wallet.total_withdrawn + v_withdrawal.amount,
    updated_at = now()
  WHERE id = v_wallet.id;

  -- Update withdrawal
  UPDATE withdrawals SET
    status = 'processing',
    paystack_transfer_code = p_paystack_transfer_code,
    paystack_transfer_reference = p_paystack_reference,
    processed_at = now(),
    updated_at = now()
  WHERE id = p_withdrawal_id;

  -- Create wallet transaction
  INSERT INTO wallet_transactions (wallet_id, type, amount, description, reference, balance_after)
  VALUES (v_wallet.id, 'withdrawal', v_withdrawal.amount, 'Withdrawal to bank', p_paystack_reference, v_new_balance);

  -- Log audit
  INSERT INTO financial_audit_logs (event_type, user_id, amount, reference_id, reference_type, description)
  VALUES ('withdrawal_processing', v_wallet.owner_id, v_withdrawal.amount, p_withdrawal_id::text, 'withdrawal', 'Withdrawal processing');

  RETURN jsonb_build_object('success', true, 'new_balance', v_new_balance);
END;
$$;

-- ─── 5. FAIL WITHDRAWAL (Reverse funds to wallet) ────────────
CREATE OR REPLACE FUNCTION fail_withdrawal(
  p_withdrawal_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_withdrawal RECORD;
  v_wallet RECORD;
  v_new_balance DECIMAL;
BEGIN
  SELECT * INTO v_withdrawal FROM withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  SELECT * INTO v_wallet FROM wallets WHERE id = v_withdrawal.wallet_id FOR UPDATE;

  IF v_withdrawal IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Withdrawal not found');
  END IF;

  IF v_withdrawal.status NOT IN ('pending', 'processing') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot fail this withdrawal');
  END IF;

  -- Return funds to wallet
  v_new_balance := v_wallet.available_balance + v_withdrawal.amount;
  UPDATE wallets SET
    available_balance = v_new_balance,
    updated_at = now()
  WHERE id = v_wallet.id;

  -- Update withdrawal
  UPDATE withdrawals SET
    status = 'failed',
    failed_reason = p_reason,
    updated_at = now()
  WHERE id = p_withdrawal_id;

  -- Create wallet transaction (refund)
  INSERT INTO wallet_transactions (wallet_id, type, amount, description, reference, balance_after)
  VALUES (v_wallet.id, 'refund', v_withdrawal.amount, 'Withdrawal failed - funds returned', v_withdrawal.paystack_transfer_reference, v_new_balance);

  -- Log audit
  INSERT INTO financial_audit_logs (event_type, user_id, amount, reference_id, reference_type, description, metadata)
  VALUES ('withdrawal_failed', v_wallet.owner_id, v_withdrawal.amount, p_withdrawal_id::text, 'withdrawal', 'Withdrawal failed', jsonb_build_object('reason', p_reason));

  RETURN jsonb_build_object('success', true, 'amount_returned', v_withdrawal.amount, 'new_balance', v_new_balance);
END;
$$;

-- ─── 6. FREEZE WALLET ────────────────────────────────────────
CREATE OR REPLACE FUNCTION freeze_wallet(
  p_wallet_id UUID,
  p_reason TEXT,
  p_frozen_by TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_wallet RECORD;
BEGIN
  SELECT * INTO v_wallet FROM wallets WHERE id = p_wallet_id;

  IF v_wallet IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wallet not found');
  END IF;

  UPDATE wallets SET
    is_frozen = TRUE,
    frozen_reason = p_reason,
    frozen_by = p_frozen_by,
    frozen_at = now(),
    updated_at = now()
  WHERE id = p_wallet_id;

  -- Move available to frozen
  UPDATE wallets SET
    frozen_balance = frozen_balance + available_balance,
    available_balance = 0,
    updated_at = now()
  WHERE id = p_wallet_id;

  -- Log audit
  INSERT INTO financial_audit_logs (event_type, user_id, amount, reference_id, reference_type, description)
  VALUES ('wallet_frozen', v_wallet.owner_id, v_wallet.available_balance, p_wallet_id::text, 'wallet', p_reason);

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ─── 7. UNFREEZE WALLET ──────────────────────────────────────
CREATE OR REPLACE FUNCTION unfreeze_wallet(
  p_wallet_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_wallet RECORD;
BEGIN
  SELECT * INTO v_wallet FROM wallets WHERE id = p_wallet_id;

  IF v_wallet IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wallet not found');
  END IF;

  -- Move frozen back to available
  UPDATE wallets SET
    available_balance = available_balance + frozen_balance,
    frozen_balance = 0,
    is_frozen = FALSE,
    frozen_reason = NULL,
    frozen_by = NULL,
    frozen_at = NULL,
    updated_at = now()
  WHERE id = p_wallet_id;

  -- Log audit
  INSERT INTO financial_audit_logs (event_type, user_id, reference_id, reference_type, description)
  VALUES ('wallet_unfrozen', v_wallet.owner_id, p_wallet_id::text, 'wallet', 'Wallet unfrozen');

  RETURN jsonb_build_object('success', true);
END;
$$;
