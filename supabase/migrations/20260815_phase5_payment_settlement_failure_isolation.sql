BEGIN;

-- A verified customer payment and its booking/tenancy fulfillment must never be
-- rolled back because a downstream Property Partner settlement is temporarily
-- misconfigured. Settlement is retriable Finance work; payment verification is
-- the source of truth.
CREATE OR REPLACE FUNCTION public.settle_verified_property_partner_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='pg_catalog','public'
AS $$
DECLARE
  v_partner_id text;
  v_partner_role text;
  v_commission_key text;
  v_commission_rate numeric;
  v_verified_total numeric;
  v_eligible_gross numeric;
  v_security_deposit numeric:=0;
  v_commission numeric;
  v_partner_net numeric;
  v_wallet record;
  v_new_pending numeric;
  v_payment_component text;
BEGIN
  IF NEW.status NOT IN ('paid','completed') OR OLD.status IN ('paid','completed') THEN RETURN NEW; END IF;
  IF NEW.purpose IN ('apartment_reservation','hotel_reservation') THEN RETURN NEW; END IF;
  IF NEW.purpose NOT IN ('apartment_rent','rent_plan_contribution','hotel_booking') THEN RETURN NEW; END IF;
  IF NEW.paystack_reference IS NULL THEN RAISE EXCEPTION 'Verified property payment requires a Paystack reference'; END IF;
  IF EXISTS (SELECT 1 FROM public.commission_ledger WHERE paystack_reference=NEW.paystack_reference) THEN RETURN NEW; END IF;

  IF NEW.purpose='hotel_booking' AND NOT EXISTS (
    SELECT 1 FROM public.hotel_bookings hb
    WHERE hb.booking_id=NEW.hotel_booking_id AND hb.status='confirmed' AND hb.payment_status='paid'
  ) THEN
    INSERT INTO public.financial_audit_logs(event_type,user_id,amount,reference_id,reference_type,description,metadata)
    VALUES('hotel_payment_fulfillment_review',NEW.user_id,COALESCE(NEW.verified_amount,NEW.amount_total,NEW.amount,0),NEW.id::text,'booking_payment',
      'Verified hotel payment withheld from partner settlement until booking fulfillment is confirmed',
      jsonb_build_object('hotel_booking_id',NEW.hotel_booking_id,'paystack_reference',NEW.paystack_reference));
    RETURN NEW;
  END IF;

  v_verified_total:=round(COALESCE(NEW.verified_amount,NEW.amount_total,NEW.amount,0)::numeric,2);
  IF v_verified_total<=0 THEN RAISE EXCEPTION 'Verified property payment amount must be greater than zero'; END IF;

  IF NEW.purpose IN ('apartment_rent','rent_plan_contribution') THEN
    SELECT COALESCE(l.partner_id,l.owner_id) INTO v_partner_id
    FROM public.listings l
    WHERE l.id::text=NEW.listing_id OR l.listing_id=NEW.listing_id
    LIMIT 1;
    v_commission_key:='commission_apartment';
    v_payment_component:=COALESCE(NEW.metadata->>'payment_component',CASE WHEN NEW.purpose='rent_plan_contribution' THEN 'rent_plan_contribution' ELSE NULL END);
    IF v_payment_component IS NULL OR v_payment_component NOT IN ('long_stay_rent','short_stay_rent','rent_plan_contribution') THEN RAISE EXCEPTION 'Apartment payment must identify a supported payment component'; END IF;
    v_security_deposit:=round(COALESCE(NULLIF(NEW.metadata->>'security_deposit_amount','')::numeric,0),2);
    IF v_security_deposit<0 OR v_security_deposit>v_verified_total THEN RAISE EXCEPTION 'Invalid security deposit amount'; END IF;
    IF v_payment_component='short_stay_rent' AND NOT (NEW.metadata ? 'security_deposit_amount') THEN RAISE EXCEPTION 'Short Stay payment must store security_deposit_amount separately'; END IF;
    v_eligible_gross:=round(COALESCE(NULLIF(NEW.metadata->>'eligible_partner_amount','')::numeric,v_verified_total-v_security_deposit),2);
  ELSE
    SELECT h.owner_id INTO v_partner_id
    FROM public.hotel_bookings hb
    JOIN public.hotels h ON h.hotel_id=hb.hotel_id
    WHERE hb.booking_id=NEW.hotel_booking_id
    LIMIT 1;
    v_commission_key:='commission_hotel';
    v_payment_component:='hotel_payment';
    v_eligible_gross:=v_verified_total;
  END IF;

  -- Internal/WeHouse-owned inventory has no Property Partner settlement. The
  -- verified customer payment still completes normally.
  IF v_partner_id IS NULL THEN RETURN NEW; END IF;
  SELECT role INTO v_partner_role
  FROM public.profiles
  WHERE user_id=v_partner_id
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_partner_role IS DISTINCT FROM 'property_partner' THEN RETURN NEW; END IF;

  IF v_eligible_gross<=0 OR v_eligible_gross>v_verified_total THEN RAISE EXCEPTION 'Invalid eligible Property Partner amount'; END IF;
  SELECT NULLIF(value,'')::numeric INTO v_commission_rate
  FROM public.platform_settings
  WHERE key=v_commission_key AND COALESCE(is_active,true)=true
  LIMIT 1;
  IF v_commission_rate IS NULL OR v_commission_rate<0 OR v_commission_rate>50 THEN RAISE EXCEPTION 'Creator commission setting is missing or invalid'; END IF;

  v_commission:=round(v_eligible_gross*v_commission_rate/100,2);
  v_partner_net:=round(v_eligible_gross-v_commission,2);
  INSERT INTO public.wallets(owner_id,owner_type,available_balance,pending_balance,frozen_balance,total_withdrawn)
  VALUES(v_partner_id,'property_partner',0,0,0,0)
  ON CONFLICT(owner_id,owner_type) DO NOTHING;
  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE owner_id=v_partner_id AND owner_type='property_partner'
  FOR UPDATE;
  IF COALESCE(v_wallet.is_frozen,false) THEN RAISE EXCEPTION 'Property Partner wallet is frozen'; END IF;

  v_new_pending:=COALESCE(v_wallet.pending_balance,0)+v_partner_net;
  UPDATE public.wallets SET pending_balance=v_new_pending,updated_at=now() WHERE id=v_wallet.id;
  UPDATE public.booking_payments
  SET payee_user_id=v_partner_id,commission_rate=v_commission_rate,amount_commission=v_commission,net_amount=v_partner_net,updated_at=now()
  WHERE id=NEW.id;

  INSERT INTO public.commission_ledger(payment_id,booking_type,source_user_id,commission_amount,commission_rate,gross_amount,description,paystack_reference,status,created_at,updated_at)
  VALUES(NEW.id,CASE WHEN NEW.purpose='hotel_booking' THEN 'hotel' ELSE 'apartment' END,v_partner_id,v_commission,v_commission_rate,v_eligible_gross,
    format('%s commission from verified %s payment',CASE WHEN NEW.purpose='hotel_booking' THEN 'Hotel' ELSE 'Apartment' END,v_payment_component),NEW.paystack_reference,'collected',now(),now());
  INSERT INTO public.wallet_transactions(user_id,transaction_type,amount,balance_after,reference_id,reference_type,description,metadata,created_at)
  VALUES(v_partner_id,'property_earning_pending',v_partner_net,v_new_pending,NEW.id::text,'booking_payment',format('Pending net earnings from %s',replace(v_payment_component,'_',' ')),
    jsonb_build_object('paystack_reference',NEW.paystack_reference,'purpose',NEW.purpose,'gross_eligible_amount',v_eligible_gross,'security_deposit_amount',v_security_deposit,'commission_rate',v_commission_rate,'commission_amount',v_commission,'net_amount',v_partner_net,'wallet_bucket','pending'),now());
  INSERT INTO public.financial_audit_logs(event_type,user_id,target_user_id,amount,reference_id,reference_type,description,metadata)
  VALUES('commission_deducted',NEW.user_id,v_partner_id,v_partner_net,NEW.id::text,'booking_payment','Verified property payment recorded as pending partner earnings',jsonb_build_object('purpose',NEW.purpose,'commission_key',v_commission_key,'commission_amount',v_commission));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- All settlement-side writes above are rolled back to this exception block.
  -- Record the review item when possible, but never invalidate a verified
  -- customer payment because Finance settlement needs attention.
  BEGIN
    INSERT INTO public.financial_audit_logs(event_type,user_id,amount,reference_id,reference_type,description,metadata)
    VALUES('property_settlement_review',NEW.user_id,COALESCE(NEW.verified_amount,NEW.amount_total,NEW.amount,0),NEW.id::text,'booking_payment',
      'Verified property payment requires Finance settlement review',
      jsonb_build_object('purpose',NEW.purpose,'paystack_reference',NEW.paystack_reference,'reason',SQLERRM));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$$;

COMMIT;
