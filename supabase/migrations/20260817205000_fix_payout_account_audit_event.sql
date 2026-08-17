-- Payout account save was rolling back because the function wrote audit event
-- types not allowed by financial_audit_logs_event_type_check. Reuse the
-- canonical bank_account_change event and distinguish add/change in metadata.

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
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_claim_role text:=COALESCE(current_setting('request.jwt.claim.role',true),'');
  v_profile public.profiles;
  v_account public.bank_accounts;
  v_replacing boolean;
BEGIN
  IF v_claim_role<>'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE user_id=p_user_id
    AND role IN ('worker','property_partner')
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Active Worker or Property Partner account required'; END IF;

  IF COALESCE(BTRIM(p_bank_code),'')='' OR COALESCE(BTRIM(p_bank_name),'')='' THEN RAISE EXCEPTION 'Verified bank is required'; END IF;
  IF COALESCE(BTRIM(p_account_number),'') !~ '^[0-9]{10}$' THEN RAISE EXCEPTION 'Bank account number must contain 10 digits'; END IF;
  IF COALESCE(BTRIM(p_account_name),'')='' THEN RAISE EXCEPTION 'Verified account name is required'; END IF;

  SELECT EXISTS(SELECT 1 FROM public.bank_accounts WHERE user_id=p_user_id) INTO v_replacing;
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
    'bank_account_change',
    p_user_id,p_user_id,v_account.id::text,'bank_account',
    CASE WHEN v_replacing THEN 'Verified payout account changed' ELSE 'Verified payout account added' END,
    jsonb_build_object(
      'action',CASE WHEN v_replacing THEN 'changed' ELSE 'added' END,
      'bank_name',v_account.bank_name,
      'account_last4',RIGHT(v_account.account_number,4),
      'account_name',v_account.account_name,
      'replacement',v_replacing
    ),now()
  );

  RETURN jsonb_build_object(
    'success',true,
    'replacement',v_replacing,
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
$function$;
