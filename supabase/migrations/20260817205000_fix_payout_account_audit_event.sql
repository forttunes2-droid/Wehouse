-- Keep the multi-account payout rules from PR #24 intact.
-- Only normalize the audit event to the allowed canonical event type.

CREATE OR REPLACE FUNCTION public.save_verified_payout_account(p_user_id text, p_bank_code text, p_bank_name text, p_account_number text, p_account_name text, p_recipient_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_claim_role text:=COALESCE(current_setting('request.jwt.claim.role',true),'');
  v_profile public.profiles;
  v_account public.bank_accounts;
  v_existing_count integer:=0;
  v_profile_tokens text[];
  v_account_tokens text[];
  v_match_count integer:=0;
  v_is_first boolean:=false;
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

  -- An already accepted destination remains accepted. Re-saving it never makes
  -- the user pass the later-account name rule again.
  SELECT * INTO v_account
  FROM public.bank_accounts
  WHERE user_id=p_user_id
    AND bank_code=BTRIM(p_bank_code)
    AND account_number=BTRIM(p_account_number)
  LIMIT 1;

  IF v_account IS NOT NULL THEN
    UPDATE public.bank_accounts
    SET bank_name=BTRIM(p_bank_name),
        account_name=BTRIM(p_account_name),
        paystack_recipient_code=COALESCE(NULLIF(BTRIM(COALESCE(p_recipient_code,'')),''),paystack_recipient_code),
        verified_at=COALESCE(verified_at,now())
    WHERE id=v_account.id
    RETURNING * INTO v_account;

    RETURN jsonb_build_object(
      'success',true,
      'already_saved',true,
      'first_account',COALESCE(v_account.is_default,false),
      'additional_account',NOT COALESCE(v_account.is_default,false),
      'name_match_count',NULL,
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

  SELECT count(*)::integer INTO v_existing_count
  FROM public.bank_accounts
  WHERE user_id=p_user_id;
  v_is_first:=v_existing_count=0;

  IF NOT v_is_first THEN
    IF COALESCE(BTRIM(v_profile.full_name),'')='' THEN
      RAISE EXCEPTION 'Complete your WeHouse full name before adding another payout account';
    END IF;

    SELECT ARRAY(
      SELECT DISTINCT token
      FROM unnest(regexp_split_to_array(
        lower(regexp_replace(v_profile.full_name,'[^a-zA-Z0-9 ]',' ','g')),
        '\s+'
      )) token
      WHERE length(token)>1
        AND token NOT IN ('mr','mrs','miss','ms','dr','chief','alhaji','hajiya','hon','prof','sir','madam')
    ) INTO v_profile_tokens;

    SELECT ARRAY(
      SELECT DISTINCT token
      FROM unnest(regexp_split_to_array(
        lower(regexp_replace(p_account_name,'[^a-zA-Z0-9 ]',' ','g')),
        '\s+'
      )) token
      WHERE length(token)>1
        AND token NOT IN ('mr','mrs','miss','ms','dr','chief','alhaji','hajiya','hon','prof','sir','madam')
    ) INTO v_account_tokens;

    IF COALESCE(cardinality(v_profile_tokens),0)<2 THEN
      RAISE EXCEPTION 'Your WeHouse full name must contain at least two names before adding another payout account';
    END IF;

    SELECT count(DISTINCT token)::integer INTO v_match_count
    FROM unnest(v_profile_tokens) token
    WHERE token=ANY(v_account_tokens);

    IF v_match_count<2 THEN
      RAISE EXCEPTION 'The verified bank account name must match at least two names from your WeHouse full name';
    END IF;
  END IF;

  INSERT INTO public.bank_accounts(
    user_id,account_number,bank_code,bank_name,account_name,
    paystack_recipient_code,is_default,verified_at,created_at
  ) VALUES (
    p_user_id,BTRIM(p_account_number),BTRIM(p_bank_code),BTRIM(p_bank_name),BTRIM(p_account_name),
    NULLIF(BTRIM(COALESCE(p_recipient_code,'')),''),v_is_first,now(),now()
  ) RETURNING * INTO v_account;

  -- Legacy wallet fields mirror only the first/default account. Withdrawal RPCs
  -- use the selected saved bank_accounts row, so old accounts never stop working.
  IF v_is_first THEN
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
    'bank_account_change',
    p_user_id,p_user_id,v_account.id::text,'bank_account',
    CASE WHEN v_is_first THEN 'First verified payout account added' ELSE 'Additional verified payout account added' END,
    jsonb_build_object(
      'bank_name',v_account.bank_name,
      'account_last4',RIGHT(v_account.account_number,4),
      'account_name',v_account.account_name,
      'first_account',v_is_first,
      'matching_name_tokens',CASE WHEN v_is_first THEN NULL ELSE v_match_count END
    ),now()
  );

  RETURN jsonb_build_object(
    'success',true,
    'already_saved',false,
    'first_account',v_is_first,
    'additional_account',NOT v_is_first,
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
$function$
;
