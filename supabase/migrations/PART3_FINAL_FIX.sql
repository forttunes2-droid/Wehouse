-- ═══════════════════════════════════════════════════════════════
-- PART 3 FINAL FIX: Drop ALL function versions, then recreate
-- ═══════════════════════════════════════════════════════════════

-- Step 1: Drop ALL existing function versions (by signature)
DROP FUNCTION IF EXISTS public.release_escrow(uuid, uuid);
DROP FUNCTION IF EXISTS public.release_escrow(uuid);
DROP FUNCTION IF EXISTS public.release_escrow(uuid, text);
DROP FUNCTION IF EXISTS public.release_escrow();
DROP FUNCTION IF EXISTS public.process_booking_payment(uuid, text, numeric);
DROP FUNCTION IF EXISTS public.process_booking_payment();
DROP FUNCTION IF EXISTS public.request_withdrawal(text, numeric);
DROP FUNCTION IF EXISTS public.request_withdrawal();
DROP FUNCTION IF EXISTS public.calculate_commission(numeric, text);
DROP FUNCTION IF EXISTS public.calculate_commission();

-- Step 2: Now recreate the functions cleanly

-- FUNCTION: Release escrow after job completion
CREATE OR REPLACE FUNCTION public.release_escrow(
  p_booking_id UUID,
  p_released_by TEXT DEFAULT 'system'
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_booking RECORD;
  v_wallet RECORD;
  v_net NUMERIC;
BEGIN
  SELECT * INTO v_booking FROM worker_bookings WHERE id = p_booking_id;
  IF NOT FOUND OR v_booking.status NOT IN ('completed', 'confirmed') THEN RETURN FALSE; END IF;
  
  v_net := v_booking.total_amount - v_booking.wehouse_fee;
  
  SELECT * INTO v_wallet FROM wallets WHERE owner_id = v_booking.worker_id;
  IF v_wallet.id IS NULL THEN RETURN FALSE; END IF;
  
  UPDATE wallets SET 
    pending_balance = GREATEST(COALESCE(pending_balance, 0) - v_booking.total_amount, 0),
    available_balance = COALESCE(available_balance, 0) + v_net,
    updated_at = NOW()
  WHERE id = v_wallet.id;
  
  UPDATE worker_bookings SET 
    escrow_released_at = NOW(),
    released_amount = v_net,
    updated_at = NOW()
  WHERE id = p_booking_id;
  
  RETURN TRUE;
END;
$$;

-- FUNCTION: Process payment into escrow
CREATE OR REPLACE FUNCTION public.process_booking_payment(
  p_booking_id UUID,
  p_paystack_reference TEXT,
  p_amount NUMERIC
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_booking RECORD;
  v_wallet RECORD;
BEGIN
  SELECT * INTO v_booking FROM worker_bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  
  UPDATE worker_bookings SET 
    status = 'paid',
    paystack_reference = p_paystack_reference,
    paystack_status = 'success',
    paid_at = NOW(),
    dispute_period_ends_at = NOW() + INTERVAL '48 hours',
    updated_at = NOW()
  WHERE id = p_booking_id;
  
  INSERT INTO booking_status_history (booking_id, old_status, new_status, changed_by, notes)
  VALUES (p_booking_id, v_booking.status, 'paid', 'system', 'Paystack: ' || p_paystack_reference);
  
  SELECT * INTO v_wallet FROM wallets WHERE owner_id = v_booking.worker_id;
  
  IF v_wallet.id IS NULL THEN
    INSERT INTO wallets (owner_id, owner_type, pending_balance)
    VALUES (v_booking.worker_id, 'worker', p_amount);
  ELSE
    UPDATE wallets SET 
      pending_balance = COALESCE(pending_balance, 0) + p_amount,
      updated_at = NOW()
    WHERE id = v_wallet.id;
  END IF;
  
  RETURN TRUE;
END;
$$;

-- FUNCTION: Request withdrawal
CREATE OR REPLACE FUNCTION public.request_withdrawal(
  p_user_id TEXT,
  p_amount NUMERIC
)
RETURNS TABLE(withdrawal_id UUID, paystack_kobo INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wallet RECORD;
  v_bank RECORD;
BEGIN
  SELECT * INTO v_wallet FROM wallets WHERE owner_id = p_user_id;
  IF NOT FOUND OR COALESCE(v_wallet.available_balance, 0) < p_amount THEN RETURN; END IF;
  
  SELECT * INTO v_bank FROM bank_accounts 
  WHERE user_id = p_user_id 
  ORDER BY is_default DESC, created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  
  UPDATE wallets SET 
    available_balance = COALESCE(available_balance, 0) - p_amount,
    total_withdrawn = COALESCE(total_withdrawn, 0) + p_amount,
    updated_at = NOW()
  WHERE id = v_wallet.id;
  
  RETURN QUERY 
  INSERT INTO withdrawal_requests (wallet_id, user_id, amount, bank_account_number, bank_code, bank_name, account_name)
  VALUES (v_wallet.id, p_user_id, p_amount, v_bank.account_number, v_bank.bank_code, v_bank.bank_name, v_bank.account_name)
  RETURNING id, (p_amount * 100)::INT;
END;
$$;

-- FUNCTION: Commission from Creator settings
CREATE OR REPLACE FUNCTION public.calculate_commission(
  p_amount NUMERIC,
  p_type TEXT DEFAULT 'worker'
)
RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_percent NUMERIC;
BEGIN
  SELECT value::NUMERIC INTO v_percent FROM platform_settings WHERE key = CASE
    WHEN p_type = 'worker' THEN 'commission_rate_worker'
    WHEN p_type = 'property' THEN 'commission_rate_property'
    WHEN p_type = 'hotel' THEN 'commission_rate_hotel'
    ELSE 'commission_rate_default'
  END;
  IF v_percent IS NULL THEN v_percent := 10; END IF;
  RETURN ROUND(p_amount * (v_percent / 100), 2);
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.release_escrow TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_booking_payment TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_withdrawal TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_commission TO authenticated;
