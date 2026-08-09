-- Property Partner verified payment settlement
-- Reservation payments remain WeHouse revenue and are never credited to Property Partners.
-- Eligible Apartment and Hotel payments use Creator Settings commission values.

CREATE UNIQUE INDEX IF NOT EXISTS uq_commission_ledger_paystack_reference
ON public.commission_ledger(paystack_reference)
WHERE paystack_reference IS NOT NULL;

CREATE OR REPLACE FUNCTION public.settle_verified_property_partner_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_partner_id TEXT;
  v_partner_role TEXT;
  v_commission_key TEXT;
  v_commission_rate NUMERIC;
  v_verified_total NUMERIC;
  v_eligible_gross NUMERIC;
  v_security_deposit NUMERIC := 0;
  v_commission NUMERIC;
  v_partner_net NUMERIC;
  v_wallet RECORD;
  v_new_pending NUMERIC;
  v_payment_component TEXT;
BEGIN
  IF NEW.status NOT IN ('paid','completed') OR OLD.status IN ('paid','completed') THEN
    RETURN NEW;
  END IF;

  IF NEW.purpose IN ('apartment_reservation','hotel_reservation') THEN
    RETURN NEW;
  END IF;

  IF NEW.purpose NOT IN ('apartment_rent','rent_plan_contribution','hotel_booking') THEN
    RETURN NEW;
  END IF;

  IF NEW.paystack_reference IS NULL THEN
    RAISE EXCEPTION 'Verified property payment requires a Paystack reference';
  END IF;

  IF EXISTS (SELECT 1 FROM public.commission_ledger WHERE paystack_reference=NEW.paystack_reference) THEN
    RETURN NEW;
  END IF;

  v_verified_total := ROUND(COALESCE(NEW.verified_amount,NEW.amount_total,NEW.amount,0)::NUMERIC,2);
  IF v_verified_total<=0 THEN RAISE EXCEPTION 'Verified property payment amount must be greater than zero'; END IF;

  IF NEW.purpose IN ('apartment_rent','rent_plan_contribution') THEN
    SELECT COALESCE(l.owner_id,l.partner_id) INTO v_partner_id
    FROM public.listings l
    WHERE l.id::TEXT=NEW.listing_id OR l.listing_id=NEW.listing_id
    LIMIT 1;

    IF v_partner_id IS NULL THEN RAISE EXCEPTION 'Apartment payment is not linked to a Property Partner listing'; END IF;

    v_commission_key := 'commission_apartment';
    v_payment_component := COALESCE(NEW.metadata->>'payment_component',CASE WHEN NEW.purpose='rent_plan_contribution' THEN 'rent_plan_contribution' ELSE NULL END);

    IF v_payment_component IS NULL OR v_payment_component NOT IN ('long_stay_rent','short_stay_rent','rent_plan_contribution') THEN
      RAISE EXCEPTION 'Apartment payment must identify long_stay_rent, short_stay_rent, or rent_plan_contribution';
    END IF;

    v_security_deposit := ROUND(COALESCE(NULLIF(NEW.metadata->>'security_deposit_amount','')::NUMERIC,0),2);
    IF v_security_deposit<0 OR v_security_deposit>v_verified_total THEN RAISE EXCEPTION 'Invalid security deposit amount'; END IF;
    IF v_payment_component='short_stay_rent' AND NOT (NEW.metadata ? 'security_deposit_amount') THEN
      RAISE EXCEPTION 'Short Stay payment must store security_deposit_amount separately';
    END IF;

    v_eligible_gross := ROUND(COALESCE(NULLIF(NEW.metadata->>'eligible_partner_amount','')::NUMERIC,v_verified_total-v_security_deposit),2);
  ELSE
    SELECT h.owner_id INTO v_partner_id
    FROM public.hotel_bookings hb
    JOIN public.hotels h ON h.hotel_id=hb.hotel_id
    WHERE hb.booking_id=NEW.hotel_booking_id
    LIMIT 1;

    IF v_partner_id IS NULL THEN RAISE EXCEPTION 'Hotel payment is not linked to a Property Partner hotel'; END IF;

    v_commission_key := 'commission_hotel';
    v_payment_component := 'hotel_payment';
    v_eligible_gross := v_verified_total;
  END IF;

  IF v_eligible_gross<=0 OR v_eligible_gross>v_verified_total THEN RAISE EXCEPTION 'Invalid eligible Property Partner amount'; END IF;

  SELECT role INTO v_partner_role
  FROM public.profiles
  WHERE user_id=v_partner_id
    AND COALESCE(deleted,FALSE)=FALSE
    AND COALESCE(suspended,FALSE)=FALSE
    AND COALESCE(banned,FALSE)=FALSE
  LIMIT 1;

  IF v_partner_role IS DISTINCT FROM 'property_partner' THEN RAISE EXCEPTION 'Payment owner is not an active Property Partner'; END IF;

  SELECT NULLIF(value,'')::NUMERIC INTO v_commission_rate
  FROM public.platform_settings
  WHERE key=v_commission_key AND COALESCE(is_active,TRUE)=TRUE
  LIMIT 1;

  IF v_commission_rate IS NULL OR v_commission_rate<0 OR v_commission_rate>50 THEN
    RAISE EXCEPTION 'Creator % setting is missing or invalid',v_commission_key;
  END IF;

  v_commission := ROUND(v_eligible_gross*v_commission_rate/100,2);
  v_partner_net := ROUND(v_eligible_gross-v_commission,2);

  INSERT INTO public.wallets(owner_id,owner_type,available_balance,pending_balance,frozen_balance,total_withdrawn)
  VALUES(v_partner_id,'property_partner',0,0,0,0)
  ON CONFLICT(owner_id,owner_type) DO NOTHING;

  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE owner_id=v_partner_id AND owner_type='property_partner'
  FOR UPDATE;

  IF COALESCE(v_wallet.is_frozen,FALSE) THEN RAISE EXCEPTION 'Property Partner wallet is frozen'; END IF;

  v_new_pending := COALESCE(v_wallet.pending_balance,0)+v_partner_net;

  UPDATE public.wallets SET pending_balance=v_new_pending,updated_at=NOW() WHERE id=v_wallet.id;

  UPDATE public.booking_payments
  SET payee_user_id=v_partner_id,commission_rate=v_commission_rate,amount_commission=v_commission,net_amount=v_partner_net,updated_at=NOW()
  WHERE id=NEW.id;

  INSERT INTO public.commission_ledger(payment_id,booking_type,source_user_id,commission_amount,commission_rate,gross_amount,description,paystack_reference,status,created_at,updated_at)
  VALUES(NEW.id,CASE WHEN NEW.purpose='hotel_booking' THEN 'hotel' ELSE 'apartment' END,v_partner_id,v_commission,v_commission_rate,v_eligible_gross,
    format('%s commission from verified %s payment',CASE WHEN NEW.purpose='hotel_booking' THEN 'Hotel' ELSE 'Apartment' END,v_payment_component),
    NEW.paystack_reference,'collected',NOW(),NOW());

  INSERT INTO public.wallet_transactions(user_id,transaction_type,amount,balance_after,reference_id,reference_type,description,metadata,created_at)
  VALUES(v_partner_id,'property_earning_pending',v_partner_net,v_new_pending,NEW.id::TEXT,'booking_payment',
    format('Pending net earnings from %s',replace(v_payment_component,'_',' ')),
    jsonb_build_object('paystack_reference',NEW.paystack_reference,'purpose',NEW.purpose,'gross_eligible_amount',v_eligible_gross,'security_deposit_amount',v_security_deposit,'commission_rate',v_commission_rate,'commission_amount',v_commission,'net_amount',v_partner_net,'wallet_bucket','pending'),NOW());

  INSERT INTO public.financial_audit_logs(event_type,user_id,target_user_id,amount,reference_id,reference_type,description,metadata)
  VALUES('commission_deducted',NEW.user_id,v_partner_id,v_partner_net,NEW.id::TEXT,'booking_payment','Verified property payment recorded as pending partner earnings',
    jsonb_build_object('purpose',NEW.purpose,'commission_key',v_commission_key,'commission_amount',v_commission));

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.settle_verified_property_partner_payment() FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS settle_verified_property_partner_payment_trigger ON public.booking_payments;
CREATE TRIGGER settle_verified_property_partner_payment_trigger
AFTER UPDATE OF status ON public.booking_payments
FOR EACH ROW
WHEN (NEW.status IN ('paid','completed') AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.settle_verified_property_partner_payment();

CREATE OR REPLACE FUNCTION public.get_my_property_partner_finance()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_user_id TEXT;v_role TEXT;v_wallet RECORD;v_min NUMERIC:=5000;
  v_apartment_rate NUMERIC;v_hotel_rate NUMERIC;v_total_earnings NUMERIC:=0;
BEGIN
  SELECT user_id,role INTO v_user_id,v_role FROM public.profiles WHERE auth_id=auth.uid()::TEXT LIMIT 1;
  IF v_user_id IS NULL OR v_role<>'property_partner' THEN RAISE EXCEPTION 'Property Partner account required'; END IF;
  PERFORM public.ensure_my_property_partner_wallet();
  SELECT * INTO v_wallet FROM public.wallets WHERE owner_id=v_user_id AND owner_type='property_partner';
  SELECT COALESCE(NULLIF(value,'')::NUMERIC,5000) INTO v_min FROM public.platform_settings WHERE key='min_withdrawal' AND COALESCE(is_active,TRUE)=TRUE LIMIT 1;
  SELECT NULLIF(value,'')::NUMERIC INTO v_apartment_rate FROM public.platform_settings WHERE key='commission_apartment' AND COALESCE(is_active,TRUE)=TRUE LIMIT 1;
  SELECT NULLIF(value,'')::NUMERIC INTO v_hotel_rate FROM public.platform_settings WHERE key='commission_hotel' AND COALESCE(is_active,TRUE)=TRUE LIMIT 1;
  SELECT COALESCE(SUM(amount),0) INTO v_total_earnings FROM public.wallet_transactions WHERE user_id=v_user_id AND transaction_type IN ('property_earning_pending','property_earning_released');
  RETURN jsonb_build_object('wallet_id',v_wallet.id,'available_balance',COALESCE(v_wallet.available_balance,0),'pending_balance',COALESCE(v_wallet.pending_balance,0),'frozen_balance',COALESCE(v_wallet.frozen_balance,0),'total_withdrawn',COALESCE(v_wallet.total_withdrawn,0),'is_frozen',COALESCE(v_wallet.is_frozen,FALSE),'apartment_commission_rate',COALESCE(v_apartment_rate,0),'hotel_commission_rate',COALESCE(v_hotel_rate,0),'total_earnings',v_total_earnings,'minimum_withdrawal',COALESCE(v_min,5000));
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_property_partner_finance() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_property_partner_finance() TO authenticated;
