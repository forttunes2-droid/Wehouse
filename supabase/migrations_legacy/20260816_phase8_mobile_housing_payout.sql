-- Phase 8 follow-up: Property Partner pipeline linkage + secure payout account storage.

-- Every Property Partner inspection request must retain the canonical partner row.
CREATE OR REPLACE FUNCTION public.attach_property_partner_to_inspection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
BEGIN
  IF NEW.partner_id IS NULL AND NEW.owner_id IS NOT NULL THEN
    SELECT pp.id INTO NEW.partner_id
    FROM public.property_partners pp
    WHERE pp.profile_id=NEW.owner_id
    ORDER BY pp.created_at DESC
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attach_property_partner_to_inspection ON public.inspection_requests;
CREATE TRIGGER trg_attach_property_partner_to_inspection
BEFORE INSERT OR UPDATE OF owner_id ON public.inspection_requests
FOR EACH ROW EXECUTE FUNCTION public.attach_property_partner_to_inspection();

UPDATE public.inspection_requests ir
SET partner_id=pp.id,updated_at=now()
FROM public.property_partners pp
WHERE ir.partner_id IS NULL
  AND pp.profile_id=ir.owner_id;

-- Server-only storage for Paystack-resolved payout accounts.
-- The Edge Function performs provider resolution and replacement-name checks;
-- this RPC provides the atomic write/audit boundary and cannot be called by clients.
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
  v_replacing boolean;
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
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Active Worker or Property Partner account required'; END IF;

  IF COALESCE(BTRIM(p_bank_code),'')='' OR COALESCE(BTRIM(p_bank_name),'')='' THEN
    RAISE EXCEPTION 'Verified bank is required';
  END IF;
  IF COALESCE(BTRIM(p_account_number),'') !~ '^[0-9]{10}$' THEN
    RAISE EXCEPTION 'Bank account number must contain 10 digits';
  END IF;
  IF COALESCE(BTRIM(p_account_name),'')='' THEN RAISE EXCEPTION 'Verified account name is required'; END IF;

  SELECT EXISTS(SELECT 1 FROM public.bank_accounts WHERE user_id=p_user_id) INTO v_replacing;

  -- WeHouse keeps one active payout destination. Historical destinations remain in
  -- bank_account_history and withdrawal snapshots, not as selectable live accounts.
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
$$;

REVOKE ALL ON FUNCTION public.save_verified_payout_account(text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_verified_payout_account(text,text,text,text,text,text) TO service_role;

-- Retire the old client-trusting payout writer. New accounts must be resolved by Paystack.
REVOKE ALL ON FUNCTION public.upsert_my_bank_account(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_my_bank_account(text,text,text) TO service_role;
