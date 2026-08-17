-- Date-based Short Stay apartment lifecycle. Long Stay remains annual/tenure based.
-- Short Stay reservations can coexist for non-overlapping dates and do not
-- globally remove the listing from discovery until an actual check-in occurs.

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS stay_type text,
  ADD COLUMN IF NOT EXISTS stay_check_in date,
  ADD COLUMN IF NOT EXISTS stay_check_out date,
  ADD COLUMN IF NOT EXISTS stay_nights integer,
  ADD COLUMN IF NOT EXISTS nightly_rate_snapshot numeric,
  ADD COLUMN IF NOT EXISTS stay_rent_total numeric,
  ADD COLUMN IF NOT EXISTS security_deposit_snapshot numeric,
  ADD COLUMN IF NOT EXISTS security_deposit_status text DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS security_deposit_returned_at timestamptz;

UPDATE public.reservations r
SET stay_type=COALESCE(l.sub_type,'long_stay')
FROM public.listings l
WHERE l.id::text=r.listing_id
  AND r.stay_type IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='reservations_stay_type_check') THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT reservations_stay_type_check
      CHECK (stay_type IS NULL OR stay_type IN ('short_let','long_stay'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='reservations_short_stay_dates_check') THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT reservations_short_stay_dates_check
      CHECK (
        stay_type IS DISTINCT FROM 'short_let'
        OR (stay_check_in IS NOT NULL AND stay_check_out IS NOT NULL AND stay_check_out>stay_check_in AND stay_nights>0)
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='reservations_security_deposit_status_check') THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT reservations_security_deposit_status_check
      CHECK (security_deposit_status IN ('not_required','pending','held','refund_due','returned','review'));
  END IF;
END $$;

INSERT INTO public.platform_settings(key,value,category,label,description,data_type,editable,is_active)
VALUES
 ('short_stay_min_nights','1','housing','Short Stay minimum nights','Minimum nights a customer can reserve a Short Stay apartment.','number',true,true),
 ('short_stay_max_nights','90','housing','Short Stay maximum nights','Maximum nights in one Short Stay apartment reservation.','number',true,true),
 ('home_long_stay_min_price','180000','housing','Long Stay search minimum','Minimum annual-rent value shown by the Home budget slider.','number',true,true),
 ('home_long_stay_max_price','5000000','housing','Long Stay search maximum','Maximum annual-rent value shown by the Home budget slider.','number',true,true),
 ('home_short_stay_min_price','5000','housing','Short Stay search minimum','Minimum nightly-rate value shown by the Home budget slider.','number',true,true),
 ('home_short_stay_max_price','500000','housing','Short Stay search maximum','Maximum nightly-rate value shown by the Home budget slider.','number',true,true)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.prevent_double_reservation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
BEGIN
  IF NEW.status <> ALL (ARRAY['payment_pending','reserved','inspection_pending','ready_for_move_in','occupied']::text[]) THEN
    RETURN NEW;
  END IF;

  IF NEW.stay_type='short_let' THEN
    IF NEW.stay_check_in IS NULL OR NEW.stay_check_out IS NULL OR NEW.stay_check_out<=NEW.stay_check_in THEN
      RAISE EXCEPTION 'Short Stay requires valid check-in and check-out dates';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.reservations r
      WHERE r.listing_id=NEW.listing_id
        AND r.id<>NEW.id
        AND r.status = ANY (ARRAY['payment_pending','reserved','inspection_pending','ready_for_move_in','occupied']::text[])
        AND (
          COALESCE(r.stay_type,'long_stay')<>'short_let'
          OR daterange(r.stay_check_in,r.stay_check_out,'[)') && daterange(NEW.stay_check_in,NEW.stay_check_out,'[)')
        )
    ) THEN
      RAISE EXCEPTION 'Those Short Stay dates are no longer available';
    END IF;
  ELSIF EXISTS (
    SELECT 1 FROM public.reservations r
    WHERE r.listing_id=NEW.listing_id
      AND r.id<>NEW.id
      AND r.status = ANY (ARRAY['payment_pending','reserved','inspection_pending','ready_for_move_in','occupied']::text[])
  ) THEN
    RAISE EXCEPTION 'This property is already held or occupied by another customer';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_apartment_reservation(p_listing_id text)
RETURNS public.reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_profile public.profiles;
  v_listing public.listings;
  v_existing public.reservations;
  v_created public.reservations;
  v_fee numeric;
  v_checkout_minutes integer;
  v_checkout_expires timestamptz;
  v_reference text;
BEGIN
  SELECT * INTO v_profile FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF v_profile.role NOT IN ('user','worker','property_partner') THEN RAISE EXCEPTION 'This account cannot create customer reservations'; END IF;

  SELECT * INTO v_listing FROM public.listings
  WHERE (id::text=p_listing_id OR listing_id=p_listing_id) AND deleted_at IS NULL
  LIMIT 1 FOR UPDATE;
  IF v_listing IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF;
  IF COALESCE(v_listing.sub_type,'')<>'long_stay' THEN
    RAISE EXCEPTION 'Short Stay requires check-in and check-out dates';
  END IF;

  SELECT * INTO v_existing FROM public.reservations
  WHERE listing_id=v_listing.id::text AND user_id=v_profile.user_id
    AND status = ANY (ARRAY['payment_pending','reserved','inspection_pending','ready_for_move_in','occupied']::text[])
  ORDER BY created_at DESC LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  IF v_listing.status<>'available' OR v_listing.availability_status<>'available' THEN RAISE EXCEPTION 'Listing is not available'; END IF;

  SELECT NULLIF(value,'')::numeric INTO v_fee FROM public.platform_settings WHERE key='reservation_fee' AND COALESCE(is_active,true)=true LIMIT 1;
  IF v_fee IS NULL OR v_fee<=0 THEN RAISE EXCEPTION 'Reservation fee is not configured'; END IF;
  SELECT NULLIF(value,'')::integer INTO v_checkout_minutes FROM public.platform_settings WHERE key='apartment_payment_hold_minutes' AND COALESCE(is_active,true)=true LIMIT 1;
  IF v_checkout_minutes IS NULL OR v_checkout_minutes<5 OR v_checkout_minutes>120 THEN v_checkout_minutes:=30; END IF;
  v_checkout_expires:=now()+make_interval(mins=>v_checkout_minutes);
  v_reference:='WHAPT-'||upper(replace(gen_random_uuid()::text,'-',''));

  INSERT INTO public.reservations(
    listing_id,user_id,user_email,user_phone,listing_title,listing_price,listing_location,
    status,manual_payment_status,payment_reference,amount,currency,reservation_type,stay_type,
    payment_expires_at,hold_expires_at,created_at,updated_at
  ) VALUES (
    v_listing.id::text,v_profile.user_id,v_profile.email,v_profile.phone,v_listing.title,v_listing.price,
    concat_ws(', ',v_listing.city,v_listing.state),'payment_pending','unpaid',v_reference,v_fee,'NGN','apartment','long_stay',
    v_checkout_expires,NULL,now(),now()
  ) RETURNING * INTO v_created;

  INSERT INTO public.booking_payments(
    payment_reference,user_id,payer_user_id,type,booking_type,listing_id,amount,amount_total,currency,status,purpose,payment_method,paystack_reference,metadata,created_at,updated_at
  ) VALUES (
    v_reference,v_profile.user_id,v_profile.user_id,'apartment','apartment',v_listing.id::text,v_fee,v_fee,'NGN','pending',
    'apartment_reservation','paystack',v_reference,jsonb_build_object('reservation_id',v_created.id,'listing_id',v_listing.id::text,'stay_type','long_stay','source','create_apartment_reservation'),now(),now()
  );

  UPDATE public.listings
  SET status='reserved',availability_status='reserved',reserved_by=v_profile.user_id,reservation_expiry=v_checkout_expires,
      reservation_fee_paid=false,chat_unlocked=false,current_reservation_id=v_created.id,updated_at=now()
  WHERE id=v_listing.id;
  RETURN v_created;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_short_stay_reservation(
  p_listing_id text,
  p_check_in date,
  p_check_out date
)
RETURNS public.reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_profile public.profiles;
  v_listing public.listings;
  v_created public.reservations;
  v_fee numeric;
  v_checkout_minutes integer;
  v_checkout_expires timestamptz;
  v_reference text;
  v_min_nights integer;
  v_max_nights integer;
  v_nights integer;
  v_rate numeric;
  v_rent numeric;
  v_deposit numeric;
BEGIN
  SELECT * INTO v_profile FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF v_profile.role NOT IN ('user','worker','property_partner') THEN RAISE EXCEPTION 'This account cannot create customer reservations'; END IF;

  SELECT * INTO v_listing FROM public.listings
  WHERE (id::text=p_listing_id OR listing_id=p_listing_id)
    AND deleted_at IS NULL AND sub_type='short_let'
  LIMIT 1 FOR SHARE;
  IF v_listing IS NULL THEN RAISE EXCEPTION 'Short Stay listing not found'; END IF;
  IF v_listing.status IN ('maintenance','closed','rejected','pending_approval') THEN RAISE EXCEPTION 'This Short Stay is not bookable'; END IF;
  IF p_check_in IS NULL OR p_check_out IS NULL OR p_check_in<CURRENT_DATE OR p_check_out<=p_check_in THEN
    RAISE EXCEPTION 'Choose valid future check-in and check-out dates';
  END IF;

  SELECT COALESCE(NULLIF(value,'')::integer,1) INTO v_min_nights FROM public.platform_settings WHERE key='short_stay_min_nights' AND COALESCE(is_active,true)=true LIMIT 1;
  SELECT COALESCE(NULLIF(value,'')::integer,90) INTO v_max_nights FROM public.platform_settings WHERE key='short_stay_max_nights' AND COALESCE(is_active,true)=true LIMIT 1;
  v_min_nights:=GREATEST(COALESCE(v_min_nights,1),1);
  v_max_nights:=GREATEST(COALESCE(v_max_nights,90),v_min_nights);
  v_nights:=p_check_out-p_check_in;
  IF v_nights<v_min_nights OR v_nights>v_max_nights THEN RAISE EXCEPTION 'Short Stay must be between % and % nights',v_min_nights,v_max_nights; END IF;

  IF EXISTS (
    SELECT 1 FROM public.reservations r
    WHERE r.listing_id=v_listing.id::text
      AND r.status = ANY (ARRAY['payment_pending','reserved','inspection_pending','ready_for_move_in','occupied']::text[])
      AND (COALESCE(r.stay_type,'long_stay')<>'short_let' OR daterange(r.stay_check_in,r.stay_check_out,'[)') && daterange(p_check_in,p_check_out,'[)'))
  ) THEN RAISE EXCEPTION 'Those Short Stay dates are no longer available'; END IF;

  v_rate:=round(COALESCE(v_listing.price,0),2);
  v_deposit:=round(COALESCE(v_listing.security_deposit_amount,0),2);
  IF v_rate<=0 THEN RAISE EXCEPTION 'Nightly rate is not configured'; END IF;
  IF v_deposit<=0 THEN RAISE EXCEPTION 'Refundable security deposit is not configured'; END IF;
  v_rent:=round(v_rate*v_nights,2);

  SELECT NULLIF(value,'')::numeric INTO v_fee FROM public.platform_settings WHERE key='reservation_fee' AND COALESCE(is_active,true)=true LIMIT 1;
  IF v_fee IS NULL OR v_fee<=0 THEN RAISE EXCEPTION 'Reservation fee is not configured'; END IF;
  SELECT NULLIF(value,'')::integer INTO v_checkout_minutes FROM public.platform_settings WHERE key='apartment_payment_hold_minutes' AND COALESCE(is_active,true)=true LIMIT 1;
  IF v_checkout_minutes IS NULL OR v_checkout_minutes<5 OR v_checkout_minutes>120 THEN v_checkout_minutes:=30; END IF;
  v_checkout_expires:=now()+make_interval(mins=>v_checkout_minutes);
  v_reference:='WHAPT-'||upper(replace(gen_random_uuid()::text,'-',''));

  INSERT INTO public.reservations(
    listing_id,user_id,user_email,user_phone,listing_title,listing_price,listing_location,
    status,manual_payment_status,payment_reference,amount,currency,reservation_type,stay_type,
    stay_check_in,stay_check_out,stay_nights,nightly_rate_snapshot,stay_rent_total,security_deposit_snapshot,security_deposit_status,
    payment_expires_at,hold_expires_at,created_at,updated_at
  ) VALUES (
    v_listing.id::text,v_profile.user_id,v_profile.email,v_profile.phone,v_listing.title,v_listing.price,
    concat_ws(', ',v_listing.city,v_listing.state),'payment_pending','unpaid',v_reference,v_fee,'NGN','apartment','short_let',
    p_check_in,p_check_out,v_nights,v_rate,v_rent,v_deposit,'pending',v_checkout_expires,NULL,now(),now()
  ) RETURNING * INTO v_created;

  INSERT INTO public.booking_payments(
    payment_reference,user_id,payer_user_id,type,booking_type,listing_id,amount,amount_total,currency,status,purpose,payment_method,paystack_reference,metadata,created_at,updated_at
  ) VALUES (
    v_reference,v_profile.user_id,v_profile.user_id,'apartment','apartment',v_listing.id::text,v_fee,v_fee,'NGN','pending',
    'apartment_reservation','paystack',v_reference,
    jsonb_build_object('reservation_id',v_created.id,'listing_id',v_listing.id::text,'stay_type','short_let','check_in',p_check_in,'check_out',p_check_out,'source','create_short_stay_reservation'),now(),now()
  );

  -- Date-specific holds are represented by the reservation row. The listing
  -- remains discoverable so non-overlapping future dates can still be booked.
  RETURN v_created;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fulfill_apartment_reservation_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_res public.reservations;
  v_listing public.listings;
  v_hold_days integer;
  v_hold_expires timestamptz;
BEGIN
  IF NEW.purpose<>'apartment_reservation' OR NEW.status NOT IN ('paid','completed') THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.status IN ('paid','completed') THEN RETURN NEW; END IF;

  SELECT * INTO v_res FROM public.reservations WHERE payment_reference=NEW.paystack_reference LIMIT 1 FOR UPDATE;
  IF v_res IS NULL THEN RAISE EXCEPTION 'Apartment reservation payment has no reservation'; END IF;
  IF v_res.user_id IS DISTINCT FROM COALESCE(NEW.payer_user_id,NEW.user_id) THEN RAISE EXCEPTION 'Apartment reservation payment owner mismatch'; END IF;
  SELECT * INTO v_listing FROM public.listings WHERE id::text=v_res.listing_id LIMIT 1 FOR UPDATE;
  IF v_listing IS NULL THEN RAISE EXCEPTION 'Apartment reservation listing not found'; END IF;

  IF COALESCE(v_res.stay_type,v_listing.sub_type,'long_stay')='short_let' THEN
    IF EXISTS (
      SELECT 1 FROM public.reservations r
      WHERE r.listing_id=v_res.listing_id AND r.id<>v_res.id
        AND r.status = ANY (ARRAY['payment_pending','reserved','inspection_pending','ready_for_move_in','occupied']::text[])
        AND (COALESCE(r.stay_type,'long_stay')<>'short_let' OR daterange(r.stay_check_in,r.stay_check_out,'[)') && daterange(v_res.stay_check_in,v_res.stay_check_out,'[)'))
    ) THEN
      UPDATE public.reservations SET status='payment_conflict',manual_payment_status='paid',paid_at=COALESCE(paid_at,now()),refund_reason='Payment completed after the selected dates became unavailable',processed_at=now(),updated_at=now() WHERE id=v_res.id;
      RETURN NEW;
    END IF;
  ELSE
    IF v_listing.current_reservation_id IS DISTINCT FROM v_res.id AND v_listing.status<>'available' THEN
      UPDATE public.reservations SET status='payment_conflict',manual_payment_status='paid',paid_at=COALESCE(paid_at,now()),refund_reason='Payment completed after the property was assigned elsewhere',processed_at=now(),updated_at=now() WHERE id=v_res.id;
      RETURN NEW;
    END IF;
  END IF;

  SELECT NULLIF(value,'')::integer INTO v_hold_days FROM public.platform_settings WHERE key='apartment_reservation_hold_days' AND COALESCE(is_active,true)=true LIMIT 1;
  IF v_hold_days IS NULL OR v_hold_days<1 OR v_hold_days>30 THEN v_hold_days:=3; END IF;
  v_hold_expires:=now()+make_interval(days=>v_hold_days);

  UPDATE public.reservations
  SET status=CASE WHEN status='payment_pending' THEN 'reserved' ELSE status END,
      manual_payment_status='paid',paid_at=COALESCE(paid_at,now()),payment_expires_at=NULL,hold_expires_at=v_hold_expires,updated_at=now()
  WHERE id=v_res.id;

  IF COALESCE(v_res.stay_type,v_listing.sub_type,'long_stay')<>'short_let' THEN
    UPDATE public.listings
    SET status='reserved',availability_status='reserved',reserved_by=v_res.user_id,reservation_expiry=v_hold_expires,
        reservation_fee_paid=true,chat_unlocked=true,current_reservation_id=v_res.id,updated_at=now()
    WHERE id=v_listing.id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_apartment_rent_payment(p_reservation_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_user_id text; v_res public.reservations; v_listing public.listings; v_reference text; v_pending public.booking_payments;
  v_annual numeric; v_total numeric; v_upfront numeric; v_balance numeric; v_count integer; v_years integer;
BEGIN
  SELECT user_id INTO v_user_id FROM public.profiles
  WHERE auth_id=auth.uid()::text AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_res FROM public.reservations WHERE id=p_reservation_id AND user_id=v_user_id FOR UPDATE;
  IF v_res.id IS NULL THEN RAISE EXCEPTION 'Reservation not found'; END IF;
  IF v_res.status='inspection_pending' THEN RAISE EXCEPTION 'Complete the requested inspection before paying Long Stay rent'; END IF;
  IF v_res.status NOT IN ('reserved','ready_for_move_in') THEN RAISE EXCEPTION 'Reservation is not ready for Long Stay rent payment'; END IF;
  IF v_res.manual_payment_status NOT IN ('paid','completed') OR v_res.paid_at IS NULL THEN RAISE EXCEPTION 'Reservation fee must be confirmed first'; END IF;
  IF v_res.rent_payment_status IN ('paid','upfront_paid') THEN RETURN jsonb_build_object('success',true,'already_paid',true,'status',v_res.rent_payment_status); END IF;
  SELECT * INTO v_listing FROM public.listings WHERE id::text=v_res.listing_id FOR SHARE;
  IF v_listing.id IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF;
  IF v_listing.sub_type<>'long_stay' THEN RAISE EXCEPTION 'Short Stay uses a date-based stay payment workflow'; END IF;

  v_years:=COALESCE(v_res.rental_plan_years,1);
  IF v_years<1 OR v_years>5 THEN RAISE EXCEPTION 'Reservation tenure must be between 1 and 5 years'; END IF;
  v_annual:=round(COALESCE(v_res.annual_rent_snapshot,v_listing.price),2);
  IF v_annual<=0 THEN RAISE EXCEPTION 'Required Year 1 rent is invalid'; END IF;
  v_total:=round(v_annual*v_years,2); v_upfront:=v_annual; v_balance:=round(v_annual*GREATEST(v_years-1,0),2); v_count:=8*GREATEST(v_years-1,0);

  SELECT * INTO v_pending FROM public.booking_payments
  WHERE user_id=v_user_id AND purpose='apartment_rent' AND status='pending' AND metadata->>'reservation_id'=v_res.id
    AND round(COALESCE(amount_total,amount),2)=round(v_upfront,2)
  ORDER BY created_at DESC LIMIT 1;
  IF v_pending.id IS NOT NULL THEN
    UPDATE public.reservations SET rent_payment_status='payment_pending',rent_payment_reference=v_pending.paystack_reference,updated_at=now() WHERE id=v_res.id;
    RETURN jsonb_build_object('success',true,'reference',v_pending.paystack_reference,'amount',COALESCE(v_pending.amount_total,v_pending.amount),'existing',true);
  END IF;

  v_reference:='WHRENT-'||upper(replace(gen_random_uuid()::text,'-',''));
  INSERT INTO public.booking_payments(payment_reference,user_id,payer_user_id,type,booking_type,listing_id,amount,amount_total,currency,status,purpose,payment_method,paystack_reference,metadata,created_at,updated_at)
  VALUES(v_reference,v_user_id,v_user_id,'apartment','apartment',v_listing.id::text,v_upfront,v_upfront,'NGN','pending','apartment_rent','paystack',v_reference,
    jsonb_build_object('reservation_id',v_res.id,'listing_id',v_listing.id::text,'tenure_years',v_years,'total_contract_rent',v_total,'year_one_upfront',v_upfront,'future_rent_balance',v_balance,'contribution_count',v_count,'contribution_months_per_year',8,'start_after_months',4,'payment_component','long_stay_rent','security_deposit_amount',0,'eligible_partner_amount',v_upfront),now(),now());
  UPDATE public.reservations
  SET stay_type='long_stay',annual_rent_snapshot=v_annual,contract_rent_total=v_total,upfront_rent_required=v_upfront,installment_balance=v_balance,installment_count=v_count,
      rent_payment_status='payment_pending',rent_payment_reference=v_reference,updated_at=now()
  WHERE id=v_res.id;
  RETURN jsonb_build_object('success',true,'reference',v_reference,'amount',v_upfront,'existing',false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_short_stay_payment(p_reservation_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_user_id text; v_res public.reservations; v_listing public.listings; v_reference text; v_pending public.booking_payments;
  v_rent numeric; v_deposit numeric; v_total numeric;
BEGIN
  SELECT user_id INTO v_user_id FROM public.profiles
  WHERE auth_id=auth.uid()::text AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_res FROM public.reservations WHERE id=p_reservation_id AND user_id=v_user_id FOR UPDATE;
  IF v_res IS NULL THEN RAISE EXCEPTION 'Reservation not found'; END IF;
  IF v_res.stay_type<>'short_let' THEN RAISE EXCEPTION 'This is not a Short Stay reservation'; END IF;
  IF v_res.status='inspection_pending' THEN RAISE EXCEPTION 'Complete the requested inspection before paying for the Short Stay'; END IF;
  IF v_res.status NOT IN ('reserved','ready_for_move_in') THEN RAISE EXCEPTION 'Short Stay reservation is not ready for payment'; END IF;
  IF v_res.manual_payment_status NOT IN ('paid','completed') OR v_res.paid_at IS NULL THEN RAISE EXCEPTION 'Reservation fee must be confirmed first'; END IF;
  IF v_res.rent_payment_status='paid' THEN RETURN jsonb_build_object('success',true,'already_paid',true,'status','paid'); END IF;
  SELECT * INTO v_listing FROM public.listings WHERE id::text=v_res.listing_id AND sub_type='short_let' FOR SHARE;
  IF v_listing IS NULL THEN RAISE EXCEPTION 'Short Stay listing not found'; END IF;
  IF v_res.stay_check_out<=CURRENT_DATE THEN RAISE EXCEPTION 'This Short Stay has already ended'; END IF;

  v_rent:=round(COALESCE(v_res.stay_rent_total,v_res.nightly_rate_snapshot*v_res.stay_nights),2);
  v_deposit:=round(COALESCE(v_res.security_deposit_snapshot,v_listing.security_deposit_amount,0),2);
  v_total:=round(v_rent+v_deposit,2);
  IF v_rent<=0 OR v_deposit<=0 THEN RAISE EXCEPTION 'Short Stay amount or refundable deposit is invalid'; END IF;

  SELECT * INTO v_pending FROM public.booking_payments
  WHERE user_id=v_user_id AND purpose='apartment_rent' AND status='pending' AND metadata->>'reservation_id'=v_res.id
    AND metadata->>'payment_component'='short_stay_rent'
  ORDER BY created_at DESC LIMIT 1;
  IF v_pending.id IS NOT NULL THEN
    UPDATE public.reservations SET rent_payment_status='payment_pending',rent_payment_reference=v_pending.paystack_reference,updated_at=now() WHERE id=v_res.id;
    RETURN jsonb_build_object('success',true,'reference',v_pending.paystack_reference,'amount',COALESCE(v_pending.amount_total,v_pending.amount),'existing',true);
  END IF;

  v_reference:='WHSTAY-'||upper(replace(gen_random_uuid()::text,'-',''));
  INSERT INTO public.booking_payments(payment_reference,user_id,payer_user_id,type,booking_type,listing_id,amount,amount_total,currency,status,purpose,payment_method,paystack_reference,metadata,created_at,updated_at)
  VALUES(v_reference,v_user_id,v_user_id,'apartment','apartment',v_listing.id::text,v_total,v_total,'NGN','pending','apartment_rent','paystack',v_reference,
    jsonb_build_object('reservation_id',v_res.id,'listing_id',v_listing.id::text,'payment_component','short_stay_rent','check_in',v_res.stay_check_in,'check_out',v_res.stay_check_out,'nights',v_res.stay_nights,'nightly_rate',v_res.nightly_rate_snapshot,'stay_rent_total',v_rent,'security_deposit_amount',v_deposit,'eligible_partner_amount',v_rent),now(),now());
  UPDATE public.reservations
  SET stay_rent_total=v_rent,security_deposit_snapshot=v_deposit,security_deposit_status='pending',rent_payment_status='payment_pending',rent_payment_reference=v_reference,updated_at=now()
  WHERE id=v_res.id;
  RETURN jsonb_build_object('success',true,'reference',v_reference,'amount',v_total,'rent',v_rent,'security_deposit',v_deposit,'existing',false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fulfill_apartment_rent_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_res public.reservations; v_listing public.listings; v_start_months integer:=4; v_installment_amount numeric; v_upfront_percent numeric;
  v_expected numeric;
BEGIN
  IF NEW.purpose<>'apartment_rent' OR NEW.status NOT IN ('paid','completed') THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.status IN ('paid','completed') THEN RETURN NEW; END IF;
  SELECT * INTO v_res FROM public.reservations WHERE id=NEW.metadata->>'reservation_id' AND user_id=COALESCE(NEW.payer_user_id,NEW.user_id) FOR UPDATE;
  IF v_res IS NULL THEN RAISE EXCEPTION 'Apartment payment has no matching reservation'; END IF;
  SELECT * INTO v_listing FROM public.listings WHERE id::text=v_res.listing_id FOR SHARE;
  IF v_listing IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF;
  IF v_res.rent_payment_reference IS DISTINCT FROM NEW.paystack_reference THEN RAISE EXCEPTION 'Apartment payment reference mismatch'; END IF;

  IF COALESCE(v_res.stay_type,v_listing.sub_type)='short_let' THEN
    IF NEW.metadata->>'payment_component'<>'short_stay_rent' THEN RAISE EXCEPTION 'Short Stay payment component mismatch'; END IF;
    IF v_res.status NOT IN ('reserved','ready_for_move_in') THEN RAISE EXCEPTION 'Short Stay reservation is not ready for settlement'; END IF;
    v_expected:=round(COALESCE(v_res.stay_rent_total,0)+COALESCE(v_res.security_deposit_snapshot,0),2);
    IF round(COALESCE(NEW.verified_amount,NEW.amount_total,NEW.amount),2)<>v_expected THEN RAISE EXCEPTION 'Short Stay payment amount mismatch'; END IF;
    UPDATE public.reservations
    SET rent_payment_status='paid',rent_paid_at=COALESCE(rent_paid_at,now()),security_deposit_status='held',
        status=CASE WHEN status='reserved' THEN 'ready_for_move_in' ELSE status END,updated_at=now()
    WHERE id=v_res.id;
    RETURN NEW;
  END IF;

  IF NEW.metadata->>'payment_component'<>'long_stay_rent' THEN RAISE EXCEPTION 'Long Stay payment component mismatch'; END IF;
  IF v_res.status NOT IN ('reserved','ready_for_move_in') THEN RAISE EXCEPTION 'Long Stay reservation is not ready for rent settlement'; END IF;
  IF round(COALESCE(NEW.verified_amount,NEW.amount_total,NEW.amount),2)<>round(COALESCE(v_res.annual_rent_snapshot,v_res.upfront_rent_required,0),2) THEN RAISE EXCEPTION 'Year 1 rent payment amount mismatch'; END IF;
  UPDATE public.reservations
  SET rent_payment_status=CASE WHEN installment_balance>0 THEN 'upfront_paid' ELSE 'paid' END,rent_paid_at=COALESCE(rent_paid_at,now()),
      status=CASE WHEN status='reserved' THEN 'ready_for_move_in' ELSE status END,updated_at=now()
  WHERE id=v_res.id;

  IF COALESCE(v_res.installment_balance,0)>0 THEN
    SELECT COALESCE(NULLIF(value,'')::integer,4) INTO v_start_months FROM public.platform_settings WHERE key='rent_plan_start_after_months' AND COALESCE(is_active,true)=true LIMIT 1;
    IF v_start_months IS NULL OR v_start_months<>4 THEN v_start_months:=4; END IF;
    v_installment_amount:=round(COALESCE(v_res.annual_rent_snapshot,0)/8.0,2);
    v_upfront_percent:=round(100.0/GREATEST(COALESCE(v_res.rental_plan_years,1),1),2);
    INSERT INTO public.rent_plans(user_id,listing_id,reservation_id,target_amount,start_after_months,cancellation_fee_percent,accepted_terms,status,total_contract_rent,upfront_percent,upfront_amount,installment_count,installment_amount,installment_balance,paid_installments,created_at,updated_at)
    VALUES(v_res.user_id,v_res.listing_id::uuid,v_res.id,v_res.installment_balance,v_start_months,
      COALESCE((SELECT NULLIF(value,'')::numeric FROM public.platform_settings WHERE key='rent_plan_cancellation_fee_percent' LIMIT 1),10),
      jsonb_build_object('tenure_years',v_res.rental_plan_years,'annual_rent',v_res.annual_rent_snapshot,'year_one_paid_in_full',true,'year_one_upfront',v_res.upfront_rent_required,'future_rent_balance',v_res.installment_balance,'start_after_months',4,'contributions_per_future_year',8,'future_years',GREATEST(COALESCE(v_res.rental_plan_years,1)-1,0),'snapshot_at',now())::text,
      'active',v_res.contract_rent_total,v_upfront_percent,v_res.upfront_rent_required,v_res.installment_count,v_installment_amount,v_res.installment_balance,0,now(),now())
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_short_stay_unavailable_listing_ids(p_check_in date,p_check_out date)
RETURNS TABLE(listing_id text)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'pg_catalog','public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_check_in IS NULL OR p_check_out IS NULL OR p_check_out<=p_check_in THEN RAISE EXCEPTION 'Valid dates required'; END IF;
  RETURN QUERY
  SELECT DISTINCT r.listing_id
  FROM public.reservations r
  JOIN public.listings l ON l.id::text=r.listing_id
  WHERE l.sub_type='short_let'
    AND r.stay_type='short_let'
    AND r.status = ANY (ARRAY['payment_pending','reserved','inspection_pending','ready_for_move_in','occupied']::text[])
    AND daterange(r.stay_check_in,r.stay_check_out,'[)') && daterange(p_check_in,p_check_out,'[)');
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_property_partner_earning(p_payment_id uuid,p_release_event text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_actor public.profiles; v_e record; v_wallet record; v_expected text; v_new_pending numeric; v_new_available numeric;
  v_listing_state text; v_listing_lga text;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text
    AND role IN ('staff','admin','creator') AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authorized WeHouse operations or finance account required'; END IF;
  IF v_actor.role='staff' AND (NOT public.current_staff_has_permission('operations') OR p_release_event NOT IN ('long_stay_move_in_confirmed','short_stay_check_in_confirmed')) THEN
    RAISE EXCEPTION 'Staff may release property earnings only through a confirmed housing arrival event';
  END IF;

  SELECT * INTO v_e FROM public.property_partner_earning_releases WHERE payment_id=p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending Property Partner earning not found'; END IF;
  SELECT l.state,l.city INTO v_listing_state,v_listing_lga
  FROM public.booking_payments bp JOIN public.listings l ON l.id::text=bp.listing_id
  WHERE bp.id=p_payment_id LIMIT 1;
  IF v_actor.role='admin' AND NOT public.can_current_actor_read_profile(v_e.partner_id) THEN RAISE EXCEPTION 'Partner is outside your assigned branch'; END IF;
  IF v_actor.role='staff' AND (v_listing_state IS NULL OR NOT public.current_actor_in_scope(v_listing_state,v_listing_lga)) THEN RAISE EXCEPTION 'Property is outside your assigned branch'; END IF;
  IF v_e.status='available' THEN RETURN jsonb_build_object('success',true,'already_released',true); END IF;
  IF v_e.status<>'pending' THEN RAISE EXCEPTION 'Earning is not releasable from status %',v_e.status; END IF;
  v_expected:=CASE v_e.earning_type WHEN 'long_stay_rent' THEN 'long_stay_move_in_confirmed' WHEN 'rent_plan_contribution' THEN 'long_stay_installment_period_confirmed' WHEN 'short_stay_rent' THEN 'short_stay_check_in_confirmed' WHEN 'hotel_payment' THEN 'hotel_stay_completed' END;
  IF p_release_event IS DISTINCT FROM v_expected THEN RAISE EXCEPTION 'Invalid release event'; END IF;
  SELECT * INTO v_wallet FROM public.wallets WHERE owner_id=v_e.partner_id AND owner_type='property_partner' FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_wallet.is_frozen,false) OR COALESCE(v_wallet.pending_balance,0)<v_e.net_amount THEN RAISE EXCEPTION 'Partner wallet is not releasable'; END IF;
  v_new_pending:=v_wallet.pending_balance-v_e.net_amount; v_new_available:=COALESCE(v_wallet.available_balance,0)+v_e.net_amount;
  UPDATE public.wallets SET pending_balance=v_new_pending,available_balance=v_new_available,updated_at=now() WHERE id=v_wallet.id;
  UPDATE public.property_partner_earning_releases SET status='available',release_event=p_release_event,released_by=v_actor.user_id,released_at=now(),updated_at=now() WHERE id=v_e.id;
  UPDATE public.commission_ledger SET status='settled',updated_at=now() WHERE payment_id=p_payment_id AND status='collected';
  UPDATE public.property_partners SET total_earnings=COALESCE(total_earnings,0)+v_e.net_amount,updated_at=now() WHERE profile_id=v_e.partner_id;
  INSERT INTO public.wallet_transactions(user_id,transaction_type,amount,balance_after,reference_id,reference_type,description,metadata)
  VALUES(v_e.partner_id,'property_earning_released',v_e.net_amount,v_new_available,p_payment_id::text,'booking_payment','Property earnings released to available balance',jsonb_build_object('release_event',p_release_event,'earning_type',v_e.earning_type,'pending_balance_after',v_new_pending,'available_balance_after',v_new_available));
  INSERT INTO public.financial_audit_logs(event_type,user_id,target_user_id,amount,reference_id,reference_type,description,metadata)
  VALUES('escrow_credit_wallet',v_actor.user_id,v_e.partner_id,v_e.net_amount,p_payment_id::text,'booking_payment','Pending Property Partner earnings released',jsonb_build_object('release_event',p_release_event,'earning_type',v_e.earning_type));
  RETURN jsonb_build_object('success',true,'partner_id',v_e.partner_id,'amount',v_e.net_amount,'status','available');
END;
$function$;

CREATE OR REPLACE FUNCTION public.activate_short_stay(p_reservation_id text,p_actual_check_in date DEFAULT CURRENT_DATE)
RETURNS public.reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_actor public.profiles; v_res public.reservations; v_listing public.listings; v_result public.reservations; v_payment_id uuid;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role IN ('staff','admin','creator')
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Housing operations access required'; END IF;
  IF v_actor.role='staff' AND NOT public.current_staff_has_permission('operations') THEN RAISE EXCEPTION 'Operations permission required'; END IF;
  SELECT * INTO v_res FROM public.reservations WHERE id=p_reservation_id AND stay_type='short_let' FOR UPDATE;
  IF v_res IS NULL THEN RAISE EXCEPTION 'Short Stay reservation not found'; END IF;
  SELECT * INTO v_listing FROM public.listings WHERE id::text=v_res.listing_id FOR UPDATE;
  IF v_listing IS NULL OR v_listing.sub_type<>'short_let' THEN RAISE EXCEPTION 'Short Stay listing not found'; END IF;
  IF v_actor.role<>'creator' AND NOT public.current_actor_in_scope(v_listing.state,v_listing.city) THEN RAISE EXCEPTION 'Listing is outside your assigned State/LGA'; END IF;
  IF v_res.status<>'ready_for_move_in' OR v_res.rent_payment_status<>'paid' OR v_res.rent_paid_at IS NULL THEN RAISE EXCEPTION 'Short Stay payment must be verified before check-in'; END IF;
  IF p_actual_check_in<v_res.stay_check_in OR p_actual_check_in>=v_res.stay_check_out THEN RAISE EXCEPTION 'Check-in must fall inside the reserved stay dates'; END IF;
  IF v_listing.status='occupied' AND v_listing.current_reservation_id IS DISTINCT FROM v_res.id THEN RAISE EXCEPTION 'Property is currently occupied'; END IF;

  UPDATE public.reservations
  SET status='occupied',tenancy_start_date=p_actual_check_in,tenancy_end_date=v_res.stay_check_out,move_out_grace_until=v_res.stay_check_out,
      occupancy_started_at=now(),updated_at=now()
  WHERE id=v_res.id RETURNING * INTO v_result;
  UPDATE public.listings
  SET status='occupied',availability_status='occupied',occupied_by=v_res.user_id,occupied_at=now(),tenancy_ends_at=v_res.stay_check_out,
      reserved_by=NULL,reservation_expiry=NULL,current_reservation_id=v_res.id,updated_at=now()
  WHERE id=v_listing.id;

  SELECT id INTO v_payment_id FROM public.booking_payments
  WHERE paystack_reference=v_res.rent_payment_reference AND purpose='apartment_rent' AND status IN ('paid','completed') LIMIT 1;
  IF v_payment_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.property_partner_earning_releases WHERE payment_id=v_payment_id AND status='pending') THEN
    PERFORM public.release_property_partner_earning(v_payment_id,'short_stay_check_in_confirmed');
  END IF;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_short_stay(p_reservation_id text,p_next_status text DEFAULT 'maintenance')
RETURNS public.reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_actor public.profiles; v_res public.reservations; v_listing public.listings; v_result public.reservations;
BEGIN
  IF p_next_status NOT IN ('maintenance','available','closed') THEN RAISE EXCEPTION 'Invalid next property status'; END IF;
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role IN ('staff','admin','creator')
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Housing operations access required'; END IF;
  IF v_actor.role='staff' AND NOT public.current_staff_has_permission('operations') THEN RAISE EXCEPTION 'Operations permission required'; END IF;
  SELECT * INTO v_res FROM public.reservations WHERE id=p_reservation_id AND stay_type='short_let' AND status='occupied' FOR UPDATE;
  IF v_res IS NULL THEN RAISE EXCEPTION 'Active Short Stay not found'; END IF;
  SELECT * INTO v_listing FROM public.listings WHERE id::text=v_res.listing_id FOR UPDATE;
  IF v_actor.role<>'creator' AND NOT public.current_actor_in_scope(v_listing.state,v_listing.city) THEN RAISE EXCEPTION 'Listing is outside your assigned State/LGA'; END IF;
  UPDATE public.reservations
  SET status='completed',completed_at=now(),processed_by=v_actor.user_id,processed_at=now(),
      security_deposit_status=CASE WHEN COALESCE(security_deposit_snapshot,0)>0 THEN 'refund_due' ELSE 'not_required' END,updated_at=now()
  WHERE id=v_res.id RETURNING * INTO v_result;
  UPDATE public.listings
  SET status=p_next_status,availability_status=p_next_status,occupied_by=NULL,occupied_at=NULL,tenancy_ends_at=NULL,
      reserved_by=NULL,reservation_expiry=NULL,reservation_fee_paid=false,chat_unlocked=false,current_reservation_id=NULL,updated_at=now()
  WHERE id=v_listing.id;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_short_stay_operations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_actor public.profiles; v_result jsonb;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role IN ('staff','admin','creator')
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Housing operations access required'; END IF;
  IF v_actor.role='staff' AND NOT public.current_staff_has_permission('operations') THEN RAISE EXCEPTION 'Operations permission required'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'reservation_id',r.id,'booking_code',r.booking_code,'status',r.status,'payment_status',r.rent_payment_status,
    'check_in',r.stay_check_in,'check_out',r.stay_check_out,'nights',r.stay_nights,'nightly_rate',r.nightly_rate_snapshot,
    'stay_rent_total',r.stay_rent_total,'security_deposit',r.security_deposit_snapshot,'security_deposit_status',r.security_deposit_status,
    'customer_user_id',r.user_id,'customer_name',COALESCE(p.full_name,p.username,p.email),'customer_phone',p.phone,
    'listing_id',l.id,'listing_title',l.title,'state',l.state,'lga',l.city,'address',l.address,'listing_status',l.status
  ) ORDER BY r.stay_check_in ASC,r.created_at ASC),'[]'::jsonb) INTO v_result
  FROM public.reservations r
  JOIN public.listings l ON l.id::text=r.listing_id
  LEFT JOIN public.profiles p ON p.user_id=r.user_id
  WHERE r.stay_type='short_let'
    AND r.status IN ('payment_pending','reserved','inspection_pending','ready_for_move_in','occupied')
    AND (v_actor.role='creator' OR public.current_actor_in_scope(l.state,l.city));
  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_short_stay_reservation(text,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_short_stay_payment(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_short_stay_unavailable_listing_ids(date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_short_stay(text,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_short_stay(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_short_stay_operations() TO authenticated;
