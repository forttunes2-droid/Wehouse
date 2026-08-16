-- Final payout-account security boundary.
-- First account: any Paystack-resolved account is allowed.
-- Replacement: at least two meaningful verified bank-name tokens must match
-- the saved WeHouse full name. Both Worker and Property Partner withdrawals
-- always use the one current verified payout account stored by WeHouse.

CREATE UNIQUE INDEX IF NOT EXISTS bank_accounts_one_current_per_user
  ON public.bank_accounts(user_id);

REVOKE INSERT,UPDATE,DELETE ON public.bank_accounts FROM anon,authenticated;
REVOKE ALL ON FUNCTION public.upsert_my_bank_account(text,text,text) FROM PUBLIC,anon,authenticated;

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
  v_existing public.bank_accounts;
  v_account public.bank_accounts;
  v_replacing boolean:=false;
  v_profile_tokens text[];
  v_account_tokens text[];
  v_match_count integer:=0;
BEGIN
  IF v_claim_role<>'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE user_id=p_user_id
    AND role IN ('worker','property_partner')
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  FOR UPDATE;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Active Worker or Property Partner account required'; END IF;

  IF COALESCE(BTRIM(p_bank_code),'')='' OR COALESCE(BTRIM(p_bank_name),'')='' THEN RAISE EXCEPTION 'Verified bank is required'; END IF;
  IF COALESCE(BTRIM(p_account_number),'') !~ '^[0-9]{10}$' THEN RAISE EXCEPTION 'Bank account number must contain 10 digits'; END IF;
  IF COALESCE(BTRIM(p_account_name),'')='' THEN RAISE EXCEPTION 'Verified account name is required'; END IF;

  SELECT * INTO v_existing FROM public.bank_accounts WHERE user_id=p_user_id FOR UPDATE;
  v_replacing:=v_existing IS NOT NULL;

  IF v_replacing THEN
    IF COALESCE(BTRIM(v_profile.full_name),'')='' THEN
      RAISE EXCEPTION 'Complete your WeHouse full name before changing your payout account';
    END IF;

    SELECT ARRAY(
      SELECT DISTINCT token
      FROM unnest(regexp_split_to_array(
        lower(regexp_replace(unaccent(v_profile.full_name),'[^a-zA-Z0-9 ]',' ','g')),
        '\s+'
      )) token
      WHERE length(token)>1
        AND token NOT IN ('mr','mrs','miss','ms','dr','chief','alhaji','hajiya','hon','prof','sir','madam')
    ) INTO v_profile_tokens;

    SELECT ARRAY(
      SELECT DISTINCT token
      FROM unnest(regexp_split_to_array(
        lower(regexp_replace(unaccent(p_account_name),'[^a-zA-Z0-9 ]',' ','g')),
        '\s+'
      )) token
      WHERE length(token)>1
        AND token NOT IN ('mr','mrs','miss','ms','dr','chief','alhaji','hajiya','hon','prof','sir','madam')
    ) INTO v_account_tokens;

    IF COALESCE(cardinality(v_profile_tokens),0)<2 THEN
      RAISE EXCEPTION 'Your WeHouse full name must contain at least two names before changing your payout account';
    END IF;

    SELECT count(DISTINCT token)::integer INTO v_match_count
    FROM unnest(v_profile_tokens) token
    WHERE token=ANY(v_account_tokens);

    IF v_match_count<2 THEN
      RAISE EXCEPTION 'The verified bank account name must match at least two names from your WeHouse full name';
    END IF;
  END IF;

  DELETE FROM public.bank_accounts WHERE user_id=p_user_id;

  INSERT INTO public.bank_accounts(
    user_id,account_number,bank_code,bank_name,account_name,
    paystack_recipient_code,is_default,verified_at,created_at
  ) VALUES (
    p_user_id,BTRIM(p_account_number),BTRIM(p_bank_code),BTRIM(p_bank_name),BTRIM(p_account_name),
    NULLIF(BTRIM(COALESCE(p_recipient_code,'')),''),true,now(),now()
  ) RETURNING * INTO v_account;

  UPDATE public.wallets
  SET bank_name=v_account.bank_name,
      bank_account_number=v_account.account_number,
      bank_account_name=v_account.account_name,
      paystack_recipient_code=v_account.paystack_recipient_code,
      updated_at=now()
  WHERE owner_id=p_user_id AND owner_type=v_profile.role;

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
    CASE WHEN v_replacing THEN 'payout_account_changed' ELSE 'payout_account_added' END,
    p_user_id,p_user_id,v_account.id::text,'bank_account',
    CASE WHEN v_replacing THEN 'Verified payout account changed' ELSE 'Verified payout account added' END,
    jsonb_build_object(
      'bank_name',v_account.bank_name,
      'account_last4',RIGHT(v_account.account_number,4),
      'account_name',v_account.account_name,
      'replacement',v_replacing,
      'matching_name_tokens',CASE WHEN v_replacing THEN v_match_count ELSE NULL END
    ),now()
  );

  RETURN jsonb_build_object(
    'success',true,
    'replacement',v_replacing,
    'name_match_count',v_match_count,
    'account',jsonb_build_object(
      'id',v_account.id,
      'bank_name',v_account.bank_name,
      'bank_code',v_account.bank_code,
      'account_number',v_account.account_number,
      'account_name',v_account.account_name,
      'is_default',true,
      'verified_at',v_account.verified_at
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_verified_payout_account(text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_verified_payout_account(text,text,text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.request_worker_withdrawal(
  p_amount numeric,
  p_bank_account_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_user_id text;
  v_role text;
  v_wallet public.wallets;
  v_bank public.bank_accounts;
  v_min numeric;
  v_request_id uuid;
  v_new_balance numeric;
BEGIN
  SELECT user_id,role INTO v_user_id,v_role
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND role='worker'
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_user_id IS NULL OR v_role<>'worker' THEN RETURN jsonb_build_object('success',false,'error','Worker account required'); END IF;
  IF p_amount IS NULL OR p_amount<=0 THEN RETURN jsonb_build_object('success',false,'error','Amount must be positive'); END IF;

  SELECT * INTO v_bank
  FROM public.bank_accounts
  WHERE user_id=v_user_id AND verified_at IS NOT NULL
  LIMIT 1;
  IF v_bank IS NULL THEN RETURN jsonb_build_object('success',false,'error','Add and verify your payout account first'); END IF;

  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE owner_id=v_user_id AND owner_type='worker'
  FOR UPDATE;
  IF v_wallet IS NULL THEN RETURN jsonb_build_object('success',false,'error','Wallet not found'); END IF;
  IF COALESCE(v_wallet.is_frozen,false) THEN RETURN jsonb_build_object('success',false,'error','Wallet is frozen'); END IF;

  SELECT NULLIF(trim(value),'')::numeric INTO v_min
  FROM public.platform_settings
  WHERE key='wallet_minimum_withdrawal' AND is_active=true;
  IF v_min IS NULL THEN RETURN jsonb_build_object('success',false,'error','Minimum withdrawal setting is missing'); END IF;
  IF p_amount<v_min THEN RETURN jsonb_build_object('success',false,'error',format('Minimum withdrawal is ₦%s',v_min)); END IF;
  IF p_amount>COALESCE(v_wallet.available_balance,0) THEN RETURN jsonb_build_object('success',false,'error','Insufficient balance'); END IF;

  v_new_balance:=v_wallet.available_balance-p_amount;
  UPDATE public.wallets
  SET available_balance=v_new_balance,
      pending_balance=COALESCE(pending_balance,0)+p_amount,
      updated_at=now()
  WHERE id=v_wallet.id;

  INSERT INTO public.withdrawals(
    wallet_id,amount,bank_name,bank_account_number,bank_account_name,status,created_at,updated_at
  ) VALUES (
    v_wallet.id,p_amount,v_bank.bank_name,v_bank.account_number,v_bank.account_name,'pending',now(),now()
  ) RETURNING id INTO v_request_id;

  INSERT INTO public.wallet_transactions(
    user_id,transaction_type,amount,balance_after,reference_id,reference_type,description,metadata,created_at
  ) VALUES (
    v_user_id,'withdrawal',-p_amount,v_new_balance,v_request_id::text,'withdrawal',
    format('Withdrawal request: ₦%s to %s ending %s',p_amount,v_bank.bank_name,right(v_bank.account_number,4)),
    jsonb_build_object('wallet_id',v_wallet.id,'amount',p_amount,'bank_account_id',v_bank.id),now()
  );

  RETURN jsonb_build_object('success',true,'request_id',v_request_id,'amount',p_amount,'status','pending');
END;
$$;

CREATE OR REPLACE FUNCTION public.request_my_property_partner_withdrawal(
  p_amount numeric,
  p_bank_account_number text,
  p_bank_code text,
  p_bank_name text,
  p_account_name text
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
    AND role='property_partner'
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_user_id IS NULL OR v_role<>'property_partner' THEN RAISE EXCEPTION 'Property Partner account required'; END IF;
  IF p_amount IS NULL OR p_amount<=0 THEN RAISE EXCEPTION 'Amount must be greater than 0'; END IF;

  SELECT * INTO v_bank
  FROM public.bank_accounts
  WHERE user_id=v_user_id AND verified_at IS NOT NULL
  LIMIT 1;
  IF v_bank IS NULL THEN RAISE EXCEPTION 'Add and verify your payout account first'; END IF;

  SELECT COALESCE(NULLIF(value,'')::numeric,5000) INTO v_min
  FROM public.platform_settings
  WHERE key='min_withdrawal'
  LIMIT 1;
  v_min:=COALESCE(v_min,5000);
  IF p_amount<v_min THEN RAISE EXCEPTION 'Minimum withdrawal is N%',v_min; END IF;

  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE owner_id=v_user_id AND owner_type='property_partner'
  FOR UPDATE;
  IF v_wallet IS NULL THEN RAISE EXCEPTION 'Wallet not found'; END IF;
  IF COALESCE(v_wallet.is_frozen,false) THEN RAISE EXCEPTION 'Wallet is frozen'; END IF;
  IF p_amount>COALESCE(v_wallet.available_balance,0) THEN RAISE EXCEPTION 'Insufficient available balance'; END IF;

  UPDATE public.wallets
  SET available_balance=available_balance-p_amount,
      frozen_balance=COALESCE(frozen_balance,0)+p_amount,
      updated_at=now()
  WHERE id=v_wallet.id;

  INSERT INTO public.withdrawals(
    wallet_id,amount,status,bank_name,bank_account_number,bank_account_name,
    snapshot_bank_name,snapshot_bank_account_number,snapshot_bank_account_name,snapshot_bank_code,
    created_at,updated_at
  ) VALUES (
    v_wallet.id,p_amount,'pending',v_bank.bank_name,v_bank.account_number,v_bank.account_name,
    v_bank.bank_name,v_bank.account_number,v_bank.account_name,v_bank.bank_code,now(),now()
  ) RETURNING id INTO v_withdrawal_id;

  INSERT INTO public.wallet_transactions(
    user_id,transaction_type,amount,balance_after,reference_id,reference_type,description,metadata
  ) VALUES (
    v_user_id,'withdrawal',-p_amount,(v_wallet.available_balance-p_amount),v_withdrawal_id::text,'withdrawal',
    'Withdrawal requested; funds held pending approval',
    jsonb_build_object('status','pending','bank_account_id',v_bank.id)
  );

  RETURN v_withdrawal_id;
END;
$$;
