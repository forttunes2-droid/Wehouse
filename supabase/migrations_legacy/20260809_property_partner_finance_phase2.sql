-- Property Partner Finance Phase 2
-- Applied to production on 2026-08-09.
-- Canonical wallet creation, authenticated finance snapshot and secure manual withdrawal request.
-- Reservation fees remain WeHouse revenue and are not credited here.

CREATE OR REPLACE FUNCTION public.ensure_my_property_partner_wallet()
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE v_user_id TEXT; v_role TEXT; v_wallet_id UUID;
BEGIN
 SELECT user_id,role INTO v_user_id,v_role FROM public.profiles WHERE auth_id=auth.uid()::TEXT LIMIT 1;
 IF v_user_id IS NULL OR v_role<>'property_partner' THEN RAISE EXCEPTION 'Property Partner account required'; END IF;
 INSERT INTO public.wallets(owner_id,owner_type,available_balance,pending_balance,frozen_balance,total_withdrawn)
 VALUES(v_user_id,'property_partner',0,0,0,0) ON CONFLICT(owner_id,owner_type) DO NOTHING;
 SELECT id INTO v_wallet_id FROM public.wallets WHERE owner_id=v_user_id AND owner_type='property_partner';
 RETURN v_wallet_id;
END;$$;
REVOKE ALL ON FUNCTION public.ensure_my_property_partner_wallet() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ensure_my_property_partner_wallet() TO authenticated;

CREATE OR REPLACE FUNCTION public.request_my_property_partner_withdrawal(p_amount NUMERIC,p_bank_account_number TEXT,p_bank_code TEXT,p_bank_name TEXT,p_account_name TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user_id TEXT;v_role TEXT;v_wallet RECORD;v_id UUID;v_min NUMERIC:=5000;
BEGIN
 SELECT user_id,role INTO v_user_id,v_role FROM public.profiles WHERE auth_id=auth.uid()::TEXT LIMIT 1;
 IF v_user_id IS NULL OR v_role<>'property_partner' THEN RAISE EXCEPTION 'Property Partner account required'; END IF;
 IF p_amount IS NULL OR p_amount<=0 THEN RAISE EXCEPTION 'Amount must be greater than 0'; END IF;
 SELECT COALESCE(NULLIF(value,'')::NUMERIC,5000) INTO v_min FROM public.platform_settings WHERE key='min_withdrawal' LIMIT 1; v_min:=COALESCE(v_min,5000);
 IF p_amount<v_min THEN RAISE EXCEPTION 'Minimum withdrawal is N%',v_min; END IF;
 IF NULLIF(BTRIM(p_bank_account_number),'') IS NULL OR NULLIF(BTRIM(p_bank_code),'') IS NULL OR NULLIF(BTRIM(p_bank_name),'') IS NULL OR NULLIF(BTRIM(p_account_name),'') IS NULL THEN RAISE EXCEPTION 'Verified bank details are required'; END IF;
 SELECT * INTO v_wallet FROM public.wallets WHERE owner_id=v_user_id AND owner_type='property_partner' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Wallet not found'; END IF;
 IF COALESCE(v_wallet.is_frozen,FALSE) THEN RAISE EXCEPTION 'Wallet is frozen'; END IF;
 IF p_amount>COALESCE(v_wallet.available_balance,0) THEN RAISE EXCEPTION 'Insufficient available balance'; END IF;
 UPDATE public.wallets SET available_balance=available_balance-p_amount,frozen_balance=frozen_balance+p_amount,updated_at=NOW() WHERE id=v_wallet.id;
 INSERT INTO public.withdrawals(wallet_id,amount,status,bank_name,bank_account_number,bank_account_name,snapshot_bank_name,snapshot_bank_account_number,snapshot_bank_account_name,snapshot_bank_code,created_at,updated_at)
 VALUES(v_wallet.id,p_amount,'pending',BTRIM(p_bank_name),BTRIM(p_bank_account_number),BTRIM(p_account_name),BTRIM(p_bank_name),BTRIM(p_bank_account_number),BTRIM(p_account_name),BTRIM(p_bank_code),NOW(),NOW()) RETURNING id INTO v_id;
 INSERT INTO public.wallet_transactions(user_id,transaction_type,amount,balance_after,reference_id,reference_type,description,metadata)
 VALUES(v_user_id,'withdrawal',p_amount,v_wallet.available_balance-p_amount,v_id::TEXT,'withdrawal','Withdrawal requested; funds held pending approval',jsonb_build_object('status','pending'));
 RETURN v_id;
END;$$;
REVOKE ALL ON FUNCTION public.request_my_property_partner_withdrawal(NUMERIC,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_my_property_partner_withdrawal(NUMERIC,TEXT,TEXT,TEXT,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_property_partner_finance()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user_id TEXT;v_role TEXT;v_wallet RECORD;v_partner RECORD;v_min NUMERIC:=5000;
BEGIN
 SELECT user_id,role INTO v_user_id,v_role FROM public.profiles WHERE auth_id=auth.uid()::TEXT LIMIT 1;
 IF v_user_id IS NULL OR v_role<>'property_partner' THEN RAISE EXCEPTION 'Property Partner account required'; END IF;
 PERFORM public.ensure_my_property_partner_wallet();
 SELECT * INTO v_wallet FROM public.wallets WHERE owner_id=v_user_id AND owner_type='property_partner';
 SELECT * INTO v_partner FROM public.property_partners WHERE profile_id=v_user_id LIMIT 1;
 SELECT COALESCE(NULLIF(value,'')::NUMERIC,5000) INTO v_min FROM public.platform_settings WHERE key='min_withdrawal' LIMIT 1;
 RETURN jsonb_build_object('wallet_id',v_wallet.id,'available_balance',COALESCE(v_wallet.available_balance,0),'pending_balance',COALESCE(v_wallet.pending_balance,0),'frozen_balance',COALESCE(v_wallet.frozen_balance,0),'total_withdrawn',COALESCE(v_wallet.total_withdrawn,0),'is_frozen',COALESCE(v_wallet.is_frozen,FALSE),'commission_rate',COALESCE(v_partner.commission_rate,0),'total_earnings',COALESCE(v_partner.total_earnings,0),'total_paid_out',COALESCE(v_partner.total_paid_out,0),'minimum_withdrawal',COALESCE(v_min,5000));
END;$$;
REVOKE ALL ON FUNCTION public.get_my_property_partner_finance() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_property_partner_finance() TO authenticated;