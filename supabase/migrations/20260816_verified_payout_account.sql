-- One verified payout destination per Worker / Property Partner.
-- First account may belong to any resolved account holder.
-- Replacing an existing payout account requires at least two name tokens to
-- match the profile full name. Paystack resolution is performed server-side
-- by the payout-bank-account Edge Function; this RPC is service-role only.

CREATE UNIQUE INDEX IF NOT EXISTS bank_accounts_one_current_per_user
  ON public.bank_accounts(user_id);

REVOKE EXECUTE ON FUNCTION public.upsert_my_bank_account(text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.bank_accounts FROM anon, authenticated;
GRANT SELECT ON public.bank_accounts TO authenticated;

CREATE OR REPLACE FUNCTION public.service_save_verified_payout_account(
  p_user_id text,
  p_bank_name text,
  p_bank_code text,
  p_account_number text,
  p_verified_account_name text,
  p_paystack_recipient_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_profile public.profiles;
  v_existing public.bank_accounts;
  v_account public.bank_accounts;
  v_profile_tokens text[];
  v_account_tokens text[];
  v_match_count integer:=0;
  v_is_replacement boolean:=false;
  v_old_summary jsonb:=NULL;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role',true),'') <> 'service_role' THEN
    RAISE EXCEPTION 'Service authorization required';
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE user_id=p_user_id
    AND role IN ('worker','property_partner')
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  FOR UPDATE;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Active Worker or Property Partner required'; END IF;

  IF p_account_number !~ '^[0-9]{10}$' THEN RAISE EXCEPTION 'Bank account number must contain 10 digits'; END IF;
  IF NULLIF(BTRIM(COALESCE(p_bank_name,'')),'') IS NULL OR NULLIF(BTRIM(COALESCE(p_bank_code,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Bank is required';
  END IF;
  IF NULLIF(BTRIM(COALESCE(p_verified_account_name,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Verified account holder name is required';
  END IF;

  SELECT * INTO v_existing FROM public.bank_accounts WHERE user_id=p_user_id FOR UPDATE;
  v_is_replacement:=v_existing IS NOT NULL;

  IF v_is_replacement THEN
    IF NULLIF(BTRIM(COALESCE(v_profile.full_name,'')),'') IS NULL THEN
      RAISE EXCEPTION 'Complete your full name before changing your payout account';
    END IF;

    SELECT ARRAY(
      SELECT DISTINCT token
      FROM unnest(regexp_split_to_array(
        lower(regexp_replace(v_profile.full_name,'[^[:alnum:] ]',' ','g')),
        '\\s+'
      )) token
      WHERE length(token)>=2
    ) INTO v_profile_tokens;

    SELECT ARRAY(
      SELECT DISTINCT token
      FROM unnest(regexp_split_to_array(
        lower(regexp_replace(p_verified_account_name,'[^[:alnum:] ]',' ','g')),
        '\\s+'
      )) token
      WHERE length(token)>=2
    ) INTO v_account_tokens;

    IF COALESCE(cardinality(v_profile_tokens),0)<2 THEN
      RAISE EXCEPTION 'Your WeHouse full name must contain at least two names before changing payout account';
    END IF;

    SELECT count(DISTINCT token)::int INTO v_match_count
    FROM unnest(v_profile_tokens) token
    WHERE token=ANY(v_account_tokens);

    IF v_match_count<2 THEN
      RAISE EXCEPTION 'For a bank-account change, at least two names on the bank account must match your WeHouse full name';
    END IF;

    v_old_summary:=jsonb_build_object(
      'bank_name',v_existing.bank_name,
      'account_last4',right(v_existing.account_number,4),
      'account_name',v_existing.account_name
    );

    INSERT INTO public.bank_account_history(
      user_id,bank_name,bank_code,bank_account_number,bank_account_name,
      verified_account_name,is_verified,changed_by
    ) VALUES(
      p_user_id,v_existing.bank_name,v_existing.bank_code,v_existing.account_number,
      v_existing.account_name,v_existing.account_name,v_existing.verified_at IS NOT NULL,p_user_id
    );

    UPDATE public.bank_accounts
    SET bank_name=BTRIM(p_bank_name),
        bank_code=BTRIM(p_bank_code),
        account_number=p_account_number,
        account_name=BTRIM(p_verified_account_name),
        paystack_recipient_code=NULLIF(BTRIM(COALESCE(p_paystack_recipient_code,'')),''),
        is_default=true,
        verified_at=now()
    WHERE id=v_existing.id
    RETURNING * INTO v_account;
  ELSE
    INSERT INTO public.bank_accounts(
      user_id,bank_name,bank_code,account_number,account_name,
      paystack_recipient_code,is_default,verified_at
    ) VALUES(
      p_user_id,BTRIM(p_bank_name),BTRIM(p_bank_code),p_account_number,
      BTRIM(p_verified_account_name),NULLIF(BTRIM(COALESCE(p_paystack_recipient_code,'')),''),true,now()
    ) RETURNING * INTO v_account;
  END IF;

  INSERT INTO public.bank_account_history(
    user_id,bank_name,bank_code,bank_account_number,bank_account_name,
    verified_account_name,is_verified,changed_by
  ) VALUES(
    p_user_id,v_account.bank_name,v_account.bank_code,v_account.account_number,
    v_account.account_name,v_account.account_name,true,p_user_id
  );

  INSERT INTO public.financial_audit_logs(event_type,user_id,reference_id,reference_type,description,metadata)
  VALUES(
    CASE WHEN v_is_replacement THEN 'payout_account_changed' ELSE 'payout_account_added' END,
    p_user_id,v_account.id::text,'bank_account',
    CASE WHEN v_is_replacement THEN 'Verified payout account changed' ELSE 'Verified payout account added' END,
    jsonb_build_object(
      'role',v_profile.role,
      'bank_name',v_account.bank_name,
      'account_last4',right(v_account.account_number,4),
      'verified_account_name',v_account.account_name,
      'replacement',v_is_replacement,
      'matching_name_tokens',CASE WHEN v_is_replacement THEN v_match_count ELSE NULL END,
      'previous',v_old_summary
    )
  );

  RETURN jsonb_build_object(
    'success',true,
    'replacement',v_is_replacement,
    'name_match_count',v_match_count,
    'account',jsonb_build_object(
      'id',v_account.id,
      'bank_name',v_account.bank_name,
      'bank_code',v_account.bank_code,
      'account_number',v_account.account_number,
      'account_name',v_account.account_name,
      'is_default',v_account.is_default,
      'verified_at',v_account.verified_at
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.service_save_verified_payout_account(text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_save_verified_payout_account(text,text,text,text,text,text) TO service_role;

-- Withdrawals always use the verified payout account stored by WeHouse.
CREATE OR REPLACE FUNCTION public.request_worker_withdrawal(p_amount numeric,p_bank_account_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_user_id text; v_role text; v_wallet public.wallets; v_bank public.bank_accounts;
  v_min numeric; v_request_id uuid; v_new_balance numeric;
BEGIN
  SELECT user_id,role INTO v_user_id,v_role
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_user_id IS NULL OR v_role<>'worker' THEN RETURN jsonb_build_object('success',false,'error','Worker account required'); END IF;
  IF p_amount IS NULL OR p_amount<=0 THEN RETURN jsonb_build_object('success',false,'error','Amount must be positive'); END IF;

  SELECT * INTO v_bank FROM public.bank_accounts WHERE user_id=v_user_id AND verified_at IS NOT NULL LIMIT 1;
  IF v_bank IS NULL THEN RETURN jsonb_build_object('success',false,'error','Add and verify your payout account first'); END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE owner_id=v_user_id AND owner_type='worker' FOR UPDATE;
  IF v_wallet IS NULL THEN RETURN jsonb_build_object('success',false,'error','Wallet not found'); END IF;
  IF COALESCE(v_wallet.is_frozen,false) THEN RETURN jsonb_build_object('success',false,'error','Wallet is frozen'); END IF;

  SELECT NULLIF(trim(value),'')::numeric INTO v_min
  FROM public.platform_settings WHERE key='wallet_minimum_withdrawal' AND is_active=true;
  IF v_min IS NULL THEN RETURN jsonb_build_object('success',false,'error','Minimum withdrawal setting is missing'); END IF;
  IF p_amount<v_min THEN RETURN jsonb_build_object('success',false,'error',format('Minimum withdrawal is ₦%s',v_min)); END IF;
  IF p_amount>COALESCE(v_wallet.available_balance,0) THEN RETURN jsonb_build_object('success',false,'error','Insufficient balance'); END IF;

  v_new_balance:=v_wallet.available_balance-p_amount;
  UPDATE public.wallets
  SET available_balance=v_new_balance,pending_balance=COALESCE(pending_balance,0)+p_amount,updated_at=now()
  WHERE id=v_wallet.id;

  INSERT INTO public.withdrawals(
    wallet_id,amount,bank_name,bank_account_number,bank_account_name,status,created_at,updated_at
  ) VALUES(
    v_wallet.id,p_amount,v_bank.bank_name,v_bank.account_number,v_bank.account_name,'pending',now(),now()
  ) RETURNING id INTO v_request_id;

  INSERT INTO public.wallet_transactions(user_id,transaction_type,amount,balance_after,reference_id,reference_type,description,metadata,created_at)
  VALUES(v_user_id,'withdrawal',-p_amount,v_new_balance,v_request_id::text,'withdrawal',
    format('Withdrawal request: ₦%s to %s ending %s',p_amount,v_bank.bank_name,right(v_bank.account_number,4)),
    jsonb_build_object('wallet_id',v_wallet.id,'amount',p_amount,'bank_account_id',v_bank.id),now());

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
  v_user_id text; v_role text; v_wallet public.wallets; v_bank public.bank_accounts;
  v_withdrawal_id uuid; v_min numeric:=5000;
BEGIN
  SELECT user_id,role INTO v_user_id,v_role
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_user_id IS NULL OR v_role<>'property_partner' THEN RAISE EXCEPTION 'Property Partner account required'; END IF;
  IF p_amount IS NULL OR p_amount<=0 THEN RAISE EXCEPTION 'Amount must be greater than 0'; END IF;

  SELECT * INTO v_bank FROM public.bank_accounts WHERE user_id=v_user_id AND verified_at IS NOT NULL LIMIT 1;
  IF v_bank IS NULL THEN RAISE EXCEPTION 'Add and verify your payout account first'; END IF;

  SELECT COALESCE(NULLIF(value,'')::numeric,5000) INTO v_min
  FROM public.platform_settings WHERE key='min_withdrawal' LIMIT 1;
  v_min:=COALESCE(v_min,5000);
  IF p_amount<v_min THEN RAISE EXCEPTION 'Minimum withdrawal is N%',v_min; END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE owner_id=v_user_id AND owner_type='property_partner' FOR UPDATE;
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
  ) VALUES(
    v_wallet.id,p_amount,'pending',v_bank.bank_name,v_bank.account_number,v_bank.account_name,
    v_bank.bank_name,v_bank.account_number,v_bank.account_name,v_bank.bank_code,now(),now()
  ) RETURNING id INTO v_withdrawal_id;

  INSERT INTO public.wallet_transactions(user_id,transaction_type,amount,balance_after,reference_id,reference_type,description,metadata)
  VALUES(v_user_id,'withdrawal',-p_amount,(v_wallet.available_balance-p_amount),v_withdrawal_id::text,'withdrawal',
    'Withdrawal requested; funds held pending approval',jsonb_build_object('status','pending','bank_account_id',v_bank.id));

  RETURN v_withdrawal_id;
END;
$$;
