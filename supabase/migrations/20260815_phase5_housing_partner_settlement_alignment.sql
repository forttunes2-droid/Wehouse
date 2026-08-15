BEGIN;

CREATE OR REPLACE FUNCTION public.settle_verified_property_partner_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_partner_id text;
  v_explicit_partner_id text;
  v_owner_id text;
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

  v_verified_total:=round(COALESCE(NEW.verified_amount,NEW.amount_total,NEW.amount,0)::numeric,2);
  IF v_verified_total<=0 THEN RAISE EXCEPTION 'Verified property payment amount must be greater than zero'; END IF;

  IF NEW.purpose IN ('apartment_rent','rent_plan_contribution') THEN
    SELECT l.partner_id,l.owner_id INTO v_explicit_partner_id,v_owner_id
    FROM public.listings l
    WHERE l.id::text=NEW.listing_id OR l.listing_id=NEW.listing_id
    LIMIT 1;

    v_partner_id:=COALESCE(v_explicit_partner_id,v_owner_id);
    IF v_partner_id IS NULL THEN
      -- WeHouse-managed property: no Property Partner payout is expected.
      RETURN NEW;
    END IF;

    SELECT role INTO v_partner_role FROM public.profiles
    WHERE user_id=v_partner_id AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false
    LIMIT 1;

    IF v_partner_role IS DISTINCT FROM 'property_partner' THEN
      IF v_explicit_partner_id IS NOT NULL THEN
        RAISE EXCEPTION 'Assigned Property Partner is not active';
      END IF;
      -- Internal/Staff/Creator-owned property: payment remains a WeHouse-managed property payment.
      RETURN NEW;
    END IF;

    v_commission_key:='commission_apartment';
    v_payment_component:=COALESCE(NEW.metadata->>'payment_component',CASE WHEN NEW.purpose='rent_plan_contribution' THEN 'rent_plan_contribution' ELSE NULL END);
    IF v_payment_component IS NULL OR v_payment_component NOT IN ('long_stay_rent','short_stay_rent','rent_plan_contribution') THEN
      RAISE EXCEPTION 'Apartment payment must identify long_stay_rent, short_stay_rent, or rent_plan_contribution';
    END IF;

    v_security_deposit:=round(COALESCE(NULLIF(NEW.metadata->>'security_deposit_amount','')::numeric,0),2);
    IF v_security_deposit<0 OR v_security_deposit>v_verified_total THEN RAISE EXCEPTION 'Invalid security deposit amount'; END IF;
    IF v_payment_component='short_stay_rent' AND NOT (NEW.metadata ? 'security_deposit_amount') THEN
      RAISE EXCEPTION 'Short Stay payment must store security_deposit_amount separately';
    END IF;
    v_eligible_gross:=round(COALESCE(NULLIF(NEW.metadata->>'eligible_partner_amount','')::numeric,v_verified_total-v_security_deposit),2);
  ELSE
    SELECT h.owner_id INTO v_partner_id
    FROM public.hotel_bookings hb JOIN public.hotels h ON h.hotel_id=hb.hotel_id
    WHERE hb.booking_id=NEW.hotel_booking_id LIMIT 1;
    IF v_partner_id IS NULL THEN RAISE EXCEPTION 'Hotel payment is not linked to a Property Partner hotel'; END IF;
    SELECT role INTO v_partner_role FROM public.profiles
    WHERE user_id=v_partner_id AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false
    LIMIT 1;
    IF v_partner_role IS DISTINCT FROM 'property_partner' THEN RAISE EXCEPTION 'Payment owner is not an active Property Partner'; END IF;
    v_commission_key:='commission_hotel';
    v_payment_component:='hotel_payment';
    v_eligible_gross:=v_verified_total;
  END IF;

  IF v_eligible_gross<=0 OR v_eligible_gross>v_verified_total THEN RAISE EXCEPTION 'Invalid eligible Property Partner amount'; END IF;
  SELECT NULLIF(value,'')::numeric INTO v_commission_rate FROM public.platform_settings
  WHERE key=v_commission_key AND COALESCE(is_active,true)=true LIMIT 1;
  IF v_commission_rate IS NULL OR v_commission_rate<0 OR v_commission_rate>50 THEN
    RAISE EXCEPTION 'Creator % setting is missing or invalid',v_commission_key;
  END IF;

  v_commission:=round(v_eligible_gross*v_commission_rate/100,2);
  v_partner_net:=round(v_eligible_gross-v_commission,2);

  INSERT INTO public.wallets(owner_id,owner_type,available_balance,pending_balance,frozen_balance,total_withdrawn)
  VALUES(v_partner_id,'property_partner',0,0,0,0)
  ON CONFLICT(owner_id,owner_type) DO NOTHING;
  SELECT * INTO v_wallet FROM public.wallets WHERE owner_id=v_partner_id AND owner_type='property_partner' FOR UPDATE;
  IF COALESCE(v_wallet.is_frozen,false) THEN RAISE EXCEPTION 'Property Partner wallet is frozen'; END IF;
  v_new_pending:=COALESCE(v_wallet.pending_balance,0)+v_partner_net;
  UPDATE public.wallets SET pending_balance=v_new_pending,updated_at=now() WHERE id=v_wallet.id;

  UPDATE public.booking_payments
  SET payee_user_id=v_partner_id,commission_rate=v_commission_rate,amount_commission=v_commission,net_amount=v_partner_net,updated_at=now()
  WHERE id=NEW.id;

  INSERT INTO public.commission_ledger(payment_id,booking_type,source_user_id,commission_amount,commission_rate,gross_amount,description,paystack_reference,status,created_at,updated_at)
  VALUES(NEW.id,CASE WHEN NEW.purpose='hotel_booking' THEN 'hotel' ELSE 'apartment' END,v_partner_id,v_commission,v_commission_rate,v_eligible_gross,
    format('%s commission from verified %s payment',CASE WHEN NEW.purpose='hotel_booking' THEN 'Hotel' ELSE 'Apartment' END,v_payment_component),
    NEW.paystack_reference,'collected',now(),now());

  INSERT INTO public.wallet_transactions(user_id,transaction_type,amount,balance_after,reference_id,reference_type,description,metadata,created_at)
  VALUES(v_partner_id,'property_earning_pending',v_partner_net,v_new_pending,NEW.id::text,'booking_payment',
    format('Pending net earnings from %s',replace(v_payment_component,'_',' ')),
    jsonb_build_object('paystack_reference',NEW.paystack_reference,'purpose',NEW.purpose,'gross_eligible_amount',v_eligible_gross,'security_deposit_amount',v_security_deposit,'commission_rate',v_commission_rate,'commission_amount',v_commission,'net_amount',v_partner_net,'wallet_bucket','pending'),now());

  INSERT INTO public.financial_audit_logs(event_type,user_id,target_user_id,amount,reference_id,reference_type,description,metadata)
  VALUES('commission_deducted',NEW.user_id,v_partner_id,v_partner_net,NEW.id::text,'booking_payment','Verified property payment recorded as pending partner earnings',
    jsonb_build_object('purpose',NEW.purpose,'commission_key',v_commission_key,'commission_amount',v_commission));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.settle_verified_property_partner_payment() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.create_apartment_rent_payment(p_reservation_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='pg_catalog','public'
AS $$
DECLARE
  v_user_id text;
  v_res public.reservations;
  v_listing public.listings;
  v_reference text;
  v_pending public.booking_payments;
  v_total numeric;
  v_upfront numeric;
  v_balance numeric;
  v_count integer;
  v_years integer;
BEGIN
  SELECT user_id INTO v_user_id FROM public.profiles
  WHERE auth_id=auth.uid()::text AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_res FROM public.reservations WHERE id=p_reservation_id AND user_id=v_user_id FOR UPDATE;
  IF v_res.id IS NULL THEN RAISE EXCEPTION 'Reservation not found'; END IF;
  IF v_res.status<>'ready_for_move_in' THEN RAISE EXCEPTION 'Contract rent becomes payable after the inspection passes'; END IF;
  IF v_res.manual_payment_status NOT IN ('paid','completed') OR v_res.paid_at IS NULL THEN RAISE EXCEPTION 'Reservation fee must be confirmed first'; END IF;
  IF v_res.rent_payment_status IN ('paid','upfront_paid') THEN RETURN jsonb_build_object('success',true,'already_paid',true,'status',v_res.rent_payment_status); END IF;

  SELECT * INTO v_listing FROM public.listings WHERE id::text=v_res.listing_id FOR SHARE;
  IF v_listing.id IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF;
  IF COALESCE(v_listing.sub_type,'long_stay')<>'long_stay' THEN
    RAISE EXCEPTION 'Short Stay uses a date-based stay payment workflow, not the long-stay tenure contract';
  END IF;

  v_years:=COALESCE(v_res.rental_plan_years,1);
  IF v_years NOT IN (1,2,3) THEN RAISE EXCEPTION 'Reservation tenure is invalid'; END IF;
  v_total:=COALESCE(v_res.contract_rent_total,round(v_listing.price*v_years,2));
  IF v_years<=2 THEN v_upfront:=v_total;v_balance:=0;v_count:=0;
  ELSE v_upfront:=COALESCE(v_res.upfront_rent_required,round(v_total*0.68,2));v_balance:=v_total-v_upfront;v_count:=4; END IF;
  IF v_upfront<=0 THEN RAISE EXCEPTION 'Required rent amount is invalid'; END IF;

  SELECT * INTO v_pending FROM public.booking_payments
  WHERE user_id=v_user_id AND purpose='apartment_rent' AND status='pending' AND metadata->>'reservation_id'=v_res.id
  ORDER BY created_at DESC LIMIT 1;
  IF v_pending.id IS NOT NULL THEN
    UPDATE public.reservations SET rent_payment_status='payment_pending',rent_payment_reference=v_pending.paystack_reference,updated_at=now() WHERE id=v_res.id;
    RETURN jsonb_build_object('success',true,'reference',v_pending.paystack_reference,'amount',COALESCE(v_pending.amount_total,v_pending.amount),'existing',true);
  END IF;

  v_reference:='WHRENT-'||upper(replace(gen_random_uuid()::text,'-',''));
  INSERT INTO public.booking_payments(payment_reference,user_id,payer_user_id,type,booking_type,listing_id,amount,amount_total,currency,status,purpose,payment_method,paystack_reference,metadata,created_at,updated_at)
  VALUES(v_reference,v_user_id,v_user_id,'apartment','apartment',v_listing.id::text,v_upfront,v_upfront,'NGN','pending','apartment_rent','paystack',v_reference,
    jsonb_build_object('reservation_id',v_res.id,'listing_id',v_listing.id::text,'tenure_years',v_years,'total_contract_rent',v_total,'upfront_amount',v_upfront,'installment_balance',v_balance,'installment_count',v_count,'payment_component','long_stay_rent','security_deposit_amount',0,'eligible_partner_amount',v_upfront),now(),now());

  UPDATE public.reservations SET annual_rent_snapshot=v_listing.price,contract_rent_total=v_total,upfront_rent_required=v_upfront,
    installment_balance=v_balance,installment_count=v_count,rent_payment_status='payment_pending',rent_payment_reference=v_reference,updated_at=now()
  WHERE id=v_res.id;
  RETURN jsonb_build_object('success',true,'reference',v_reference,'amount',v_upfront,'existing',false);
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_apartment_tenancy(p_reservation_id text,p_start_date date DEFAULT CURRENT_DATE)
RETURNS public.reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='pg_catalog','public'
AS $$
DECLARE
  v_actor public.profiles;
  v_res public.reservations;
  v_listing public.listings;
  v_years integer;
  v_grace integer;
  v_end date;
  v_result public.reservations;
  v_rent_payment_id uuid;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role IN ('staff','admin','creator')
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor.user_id IS NULL THEN RAISE EXCEPTION 'Housing operations access required'; END IF;
  IF v_actor.role='staff' AND NOT public.current_staff_has_permission('operations') THEN RAISE EXCEPTION 'Operations permission required'; END IF;
  SELECT * INTO v_res FROM public.reservations WHERE id=p_reservation_id FOR UPDATE;
  IF v_res.id IS NULL THEN RAISE EXCEPTION 'Reservation not found'; END IF;
  SELECT * INTO v_listing FROM public.listings WHERE id::text=v_res.listing_id FOR UPDATE;
  IF v_listing.id IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF;
  IF COALESCE(v_listing.sub_type,'long_stay')<>'long_stay' THEN RAISE EXCEPTION 'Long-stay tenancy activation is not valid for Short Stay'; END IF;
  IF v_actor.role<>'creator' AND NOT public.current_actor_in_scope(v_listing.state,v_listing.city) THEN RAISE EXCEPTION 'Listing is outside your assigned State/LGA'; END IF;
  IF v_res.status<>'ready_for_move_in' THEN RAISE EXCEPTION 'Inspection must pass before move-in'; END IF;
  IF v_res.manual_payment_status NOT IN ('paid','completed') OR v_res.paid_at IS NULL THEN RAISE EXCEPTION 'Reservation fee is not confirmed'; END IF;
  IF v_res.rent_payment_status NOT IN ('paid','upfront_paid') OR v_res.rent_paid_at IS NULL THEN RAISE EXCEPTION 'Required contract rent must be verified before move-in'; END IF;

  v_years:=COALESCE(v_res.rental_plan_years,1);
  IF v_years NOT IN (1,2,3) THEN RAISE EXCEPTION 'Invalid rental tenure'; END IF;
  SELECT NULLIF(value,'')::integer INTO v_grace FROM public.platform_settings WHERE key='tenancy_grace_days' AND COALESCE(is_active,true)=true LIMIT 1;
  IF v_grace IS NULL OR v_grace<0 OR v_grace>30 THEN v_grace:=7; END IF;
  v_end:=(p_start_date+make_interval(years=>v_years))::date;

  UPDATE public.reservations SET status='occupied',tenancy_start_date=p_start_date,tenancy_end_date=v_end,
    move_out_grace_until=v_end+v_grace,occupancy_started_at=now(),updated_at=now()
  WHERE id=v_res.id RETURNING * INTO v_result;
  UPDATE public.listings SET status='occupied',availability_status='occupied',occupied_by=v_res.user_id,occupied_at=now(),tenancy_ends_at=v_end,
    reserved_by=NULL,reservation_expiry=NULL,current_reservation_id=v_res.id,updated_at=now() WHERE id=v_listing.id;
  UPDATE public.rent_plans SET tenancy_start_date=p_start_date,
    next_rent_due_date=CASE WHEN status='active' THEN (p_start_date+make_interval(months=>start_after_months))::date ELSE next_rent_due_date END,
    updated_at=now() WHERE reservation_id=v_res.id AND status='active';

  SELECT id INTO v_rent_payment_id FROM public.booking_payments
  WHERE paystack_reference=v_res.rent_payment_reference AND purpose='apartment_rent' AND status IN ('paid','completed') LIMIT 1;
  IF v_rent_payment_id IS NOT NULL AND EXISTS(
    SELECT 1 FROM public.property_partner_earning_releases WHERE payment_id=v_rent_payment_id AND status='pending'
  ) THEN
    PERFORM public.release_property_partner_earning(v_rent_payment_id,'long_stay_move_in_confirmed');
  END IF;

  RETURN v_result;
END;
$$;

COMMIT;
