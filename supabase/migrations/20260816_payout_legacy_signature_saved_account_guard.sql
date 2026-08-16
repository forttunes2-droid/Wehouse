-- Compatibility wrapper for the current Property Partner UI.
-- It still submits the selected account details, but the backend accepts them only
-- when they exactly match one of the caller's saved payout accounts.
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
  v_bank public.bank_accounts;
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

  SELECT * INTO v_bank
  FROM public.bank_accounts
  WHERE user_id=v_user_id
    AND account_number=BTRIM(COALESCE(p_bank_account_number,''))
    AND bank_code=BTRIM(COALESCE(p_bank_code,''))
    AND bank_name=BTRIM(COALESCE(p_bank_name,''))
    AND account_name=BTRIM(COALESCE(p_account_name,''))
  LIMIT 1;

  IF v_bank IS NULL THEN
    RAISE EXCEPTION 'Choose one of your saved payout accounts';
  END IF;

  RETURN public.request_my_property_partner_withdrawal(p_amount,v_bank.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_my_property_partner_withdrawal(numeric,text,text,text,text) TO authenticated;
