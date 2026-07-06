-- ═══════════════════════════════════════════════════════════════════
-- FIX: Finance functions to match correct fee structure
-- - No withdrawal fee (workers get full net amount)
-- - Commission keys renamed: worker_commission, property_commission, hotel_commission
-- - No inspection_fee, blue_badge_price
-- ═══════════════════════════════════════════════════════════════════

-- Fix: get_commission_rate uses correct keys
CREATE OR REPLACE FUNCTION public.get_commission_rate(p_booking_type TEXT DEFAULT 'worker')
RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rate TEXT; v_num NUMERIC; BEGIN
  IF p_booking_type = 'worker' THEN SELECT value INTO v_rate FROM platform_settings WHERE key = 'worker_commission';
  ELSIF p_booking_type IN ('partner', 'property') THEN SELECT value INTO v_rate FROM platform_settings WHERE key = 'property_commission';
  ELSIF p_booking_type = 'hotel' THEN SELECT value INTO v_rate FROM platform_settings WHERE key = 'hotel_commission';
  ELSE SELECT value INTO v_rate FROM platform_settings WHERE key = 'worker_commission'; END IF;
  v_num := NULLIF(trim(v_rate),''); IF v_num IS NULL THEN RETURN 10.00; END IF;
  RETURN GREATEST(0,LEAST(100,v_num::NUMERIC)); END; $$;

-- Fix: create_withdrawal_request has NO fee deduction
CREATE OR REPLACE FUNCTION public.create_withdrawal_request(
  p_user_id TEXT,
  p_amount NUMERIC
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_balance NUMERIC;
  v_frozen BOOLEAN;
  v_min_withdrawal NUMERIC;
  v_bank_name TEXT;
  v_bank_code TEXT;
  v_account_number TEXT;
  v_request_id UUID;
BEGIN
  -- Check wallet
  SELECT available_balance, frozen INTO v_balance, v_frozen
  FROM wallet_balances WHERE user_id = p_user_id;
  IF v_balance IS NULL THEN RETURN jsonb_build_object('success', FALSE, 'error', 'No wallet found'); END IF;
  IF v_frozen THEN RETURN jsonb_build_object('success', FALSE, 'error', 'Wallet is frozen. Contact support.'); END IF;

  -- Get minimum withdrawal from settings
  SELECT COALESCE(NULLIF(value,''),'1000')::NUMERIC INTO v_min_withdrawal
  FROM platform_settings WHERE key = 'wallet_minimum_withdrawal';

  IF p_amount < v_min_withdrawal THEN
    RETURN jsonb_build_object('success', FALSE, 'error', format('Minimum withdrawal is N%s', v_min_withdrawal));
  END IF;
  IF p_amount > v_balance THEN
    RETURN jsonb_build_object('success', FALSE, 'error', format('Insufficient balance. Available: N%s', v_balance));
  END IF;

  -- Get bank details
  SELECT bank_name, bank_code, bank_account_number
  INTO v_bank_name, v_bank_code, v_account_number
  FROM profiles WHERE user_id = p_user_id;
  IF COALESCE(v_bank_code,'') = '' OR COALESCE(v_account_number,'') = '' THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Bank details not set. Add your bank account in profile settings.');
  END IF;

  -- Deduct from available, add to pending
  UPDATE wallet_balances SET
    available_balance = available_balance - p_amount,
    pending_balance = pending_balance + p_amount,
    updated_at = NOW()
  WHERE user_id = p_user_id;

  -- Create withdrawal request — NO fee deduction, full amount
  INSERT INTO withdrawal_requests (user_id, user_role, amount_requested,
    withdrawal_fee, amount_paid, bank_name, bank_code, bank_account_number,
    status, metadata)
  SELECT p_user_id, role, p_amount, 0, p_amount,
    v_bank_name, v_bank_code, v_account_number, 'pending',
    jsonb_build_object('net_amount', p_amount, 'fee', 0)
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
    v_balance - p_amount, format('Withdrawal request: N%s (no fee)', p_amount),
    jsonb_build_object('bank_name', v_bank_name, 'account', v_account_number));

  RETURN jsonb_build_object('success', TRUE, 'request_id', v_request_id,
    'amount', p_amount, 'fee', 0, 'net_amount', p_amount);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_commission_rate TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_withdrawal_request TO authenticated;
