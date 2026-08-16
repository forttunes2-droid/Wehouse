-- Preserve multiple verified payout accounts per Worker / Property Partner.
-- Rule:
--   * first account: Paystack-resolved, no WeHouse-name-match restriction
--   * every genuinely new later account: at least two name tokens must match profile.full_name
--   * previously accepted accounts remain selectable for withdrawals

CREATE OR REPLACE FUNCTION public.save_verified_payout_account(
  p_user_id text,
  p_bank_code text,
  p_bank_name text,
  p_account_number text,
  p_account_name text,
  p_recipient_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_claim_role text:=COALESCE(current_setting('request.jwt.claim.role',true),'');
  v_profile public.profiles;
  v_account public.bank_accounts;
  v_has_existing boolean:=false;
  v_existing_count integer:=0;
BEGIN
  IF v_claim_role<>'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE user_id=p_user_id
    AND role IN ('worker','property_partner')
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Active Worker or Property Partner account required';
  END IF;

  IF COALESCE(BTRIM(p_bank_code),'')='' OR COALESCE(BTRIM(p_bank_name),'')='' THEN
    RAISE EXCEPTION 'Verified bank is required';
  END IF;
  IF COALESCE(BTRIM(p_account_number),'') !~ '^[0-9]{10}$' THEN
    RAISE EXCEPTION 'Bank account number must contain 10 digits';
  END IF;
  IF COALESCE(BTRIM(p_account_name),'')='' THEN
    RAISE EXCEPTION 'Verified account name is required';
  END IF;

  SELECT count(*)::integer INTO v_existing_count
  FROM public.bank_accounts
  WHERE user_id=p_user_id;
  v_has_existing:=v_existing_count>0;

  -- Idempotent re-save of an already accepted account: keep the same account row,
  -- refresh Paystack details, and never make the user re-pass later-account rules.
  SELECT * INTO v_account
  FROM public.bank_accounts
  WHERE user_id=p_user_id
    AND account_number=BTRIM(p_account_number)
    AND bank_code=BTRIM(p_bank_code)
  LIMIT 1;

  IF v_account IS NOT NULL THEN
    UPDATE public.bank_accounts
    SET bank_name=BTRIM(p_bank_name),
        account_name=BTRIM(p_account_name),
        paystack_recipient_code=COALESCE(NULLIF(BTRIM(COALESCE(p_recipient_code,'')),''),paystack_recipient_code),
        verified_at=now()
    WHERE id=v_account.id
    RETURNING * INTO v_account;

    RETURN jsonb_build_object(
      'success',true,
      'already_saved',true,
      'additional_account',v_existing_count>1 OR NOT COALESCE(v_account.is_default,false),
      'account',jsonb_build_object(
        'id',v_account.id,
        'bank_name',v_account.bank_name,
        'bank_code',v_account.bank_code,
        'account_number',v_account.account_number,
        'account_name',v_account.account_name,
        'is_default',COALESCE(v_account.is_default,false),
        'verified_at',v_account.verified_at
      )
    );
  END IF;

  INSERT INTO public.bank_accounts(
    user_id,account_number,bank_code,bank_name,account_name,
    paystack_recipient_code,is_default,verified_at,created_at
  ) VALUES (
    p_user_id,BTRIM(p_account_number),BTRIM(p_bank_code),BTRIM(p_bank_name),BTRIM(p_account_name),
    NULLIF(BTRIM(COALESCE(p_recipient_code,'')),''),NOT v_has_existing,now(),now()
  )
  RETURNING * INTO v_account;

  -- Legacy wallet bank columns mirror the default account only. Additional
  -- accounts remain in bank_accounts and are selected explicitly at withdrawal.
  IF COALESCE(v_account.is_default,false) THEN
    UPDATE public.wallets
    SET bank_name=v_account.bank_name,
        bank_account_number=v_account.account_number,
        bank_account_name=v_account.account_name,
        paystack_recipient_code=v_account.paystack_recipient_code,
        updated_at=now()
    WHERE owner_id=p_user_id AND owner_type=v_profile.role;
  END IF;

  INSERT INTO public.bank_account_history(
    user_id,bank_name,bank_code,bank_account_number,bank_account_name,
    verified_account_name,is_verified,changed_at,changed_by
  ) VALUES (
    p_user_id,v_account.bank_name,v_account.bank_code,v_account.account_number,
    v_account.account_name,v_account.account_name,true,now(),p_user_id
  );

  INSERT INTO public.financial_audit_logs(
    event_type,user_id,target_user_id,reference_id,reference_type,description,metadata,created_at
  ) VALUES (
    'payout_account_added',p_user_id,p_user_id,v_account.id::text,'bank_account',
    CASE WHEN v_has_existing THEN 'Additional verified payout account added' ELSE 'First verified payout account added' END,
    jsonb_build_object(
      'bank_name',v_account.bank_name,
      'account_last4',RIGHT(v_account.account_number,4),
      'account_name',v_account.account_name,
      'is_first_account',NOT v_has_existing,
      'is_default',COALESCE(v_account.is_default,false)
    ),now()
  );

  RETURN jsonb_build_object(
    'success',true,
    'already_saved',false,
    'additional_account',v_has_existing,
    'account',jsonb_build_object(
      'id',v_account.id,
      'bank_name',v_account.bank_name,
      'bank_code',v_account.bank_code,
      'account_number',v_account.account_number,
      'account_name',v_account.account_name,
      'is_default',COALESCE(v_account.is_default,false),
      'verified_at',v_account.verified_at
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_verified_payout_account(text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_verified_payout_account(text,text,text,text,text,text) TO service_role;

-- Property Partner withdrawals must select one of the caller's stored accounts.
-- The caller can no longer submit arbitrary bank details in the withdrawal RPC.
CREATE OR REPLACE FUNCTION public.request_my_property_partner_withdrawal(
  p_amount numeric,
  p_bank_account_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_user_id text;
  v_role text;
  v_wallet public.wallets;
  v_bank public.bank_accounts;
  v_withdrawal_id uuid;
  v_min numeric:=5000;
BEGIN
  SELECT user_id,role INTO v_user_id,v_role
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;

  IF v_user_id IS NULL OR v_role<>'property_partner' THEN
    RAISE EXCEPTION 'Property Partner account required';
  END IF;
  IF p_amount IS NULL OR p_amount<=0 THEN
    RAISE EXCEPTION 'Amount must be greater than 0';
  END IF;

  SELECT COALESCE(NULLIF(value,'')::numeric,5000) INTO v_min
  FROM public.platform_settings
  WHERE key='min_withdrawal'
  LIMIT 1;
  v_min:=COALESCE(v_min,5000);
  IF p_amount<v_min THEN
    RAISE EXCEPTION 'Minimum withdrawal is N%',v_min;
  END IF;

  SELECT * INTO v_bank
  FROM public.bank_accounts
  WHERE id=p_bank_account_id AND user_id=v_user_id
  LIMIT 1;
  IF v_bank IS NULL THEN
    RAISE EXCEPTION 'Choose one of your saved payout accounts';
  END IF;

  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE owner_id=v_user_id AND owner_type='property_partner'
  FOR UPDATE;
  IF v_wallet IS NULL THEN RAISE EXCEPTION 'Wallet not found'; END IF;
  IF COALESCE(v_wallet.is_frozen,false) THEN RAISE EXCEPTION 'Wallet is frozen'; END IF;
  IF p_amount>COALESCE(v_wallet.available_balance,0) THEN RAISE EXCEPTION 'Insufficient available balance'; END IF;

  UPDATE public.wallets
  SET available_balance=available_balance-p_amount,
      frozen_balance=frozen_balance+p_amount,
      updated_at=now()
  WHERE id=v_wallet.id;

  INSERT INTO public.withdrawals(
    wallet_id,amount,status,
    bank_name,bank_account_number,bank_account_name,
    snapshot_bank_name,snapshot_bank_account_number,snapshot_bank_account_name,snapshot_bank_code,
    created_at,updated_at
  ) VALUES (
    v_wallet.id,p_amount,'pending',
    v_bank.bank_name,v_bank.account_number,v_bank.account_name,
    v_bank.bank_name,v_bank.account_number,v_bank.account_name,v_bank.bank_code,
    now(),now()
  )
  RETURNING id INTO v_withdrawal_id;

  INSERT INTO public.wallet_transactions(
    user_id,transaction_type,amount,balance_after,reference_id,reference_type,description,metadata
  ) VALUES (
    v_user_id,'withdrawal',-p_amount,v_wallet.available_balance-p_amount,
    v_withdrawal_id::text,'withdrawal','Withdrawal requested; funds held pending approval',
    jsonb_build_object('status','pending','bank_account_id',v_bank.id,'bank_last4',RIGHT(v_bank.account_number,4))
  );

  RETURN v_withdrawal_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_my_property_partner_withdrawal(numeric,uuid) TO authenticated;

-- Retire the old client-supplied-details signature from authenticated callers.
REVOKE ALL ON FUNCTION public.request_my_property_partner_withdrawal(numeric,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_my_property_partner_withdrawal(numeric,text,text,text,text) TO service_role;
