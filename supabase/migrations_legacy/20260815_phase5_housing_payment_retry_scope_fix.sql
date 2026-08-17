BEGIN;

-- This legacy index was named for Worker verification but applied to every
-- payment purpose. Keep the original business rule only for Worker verification.
DROP INDEX IF EXISTS public.idx_one_pending_worker_verification;
CREATE UNIQUE INDEX idx_one_pending_worker_verification
ON public.booking_payments(user_id,purpose)
WHERE status='pending' AND purpose='worker_verification';

-- Housing allows a customer to have more than one property workflow, but each
-- reservation may have only one pending payment for a given Housing purpose.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_housing_payment_per_reservation_purpose
ON public.booking_payments(purpose,(metadata->>'reservation_id'))
WHERE status='pending'
  AND purpose IN ('apartment_reservation','apartment_rent')
  AND metadata ? 'reservation_id';

CREATE OR REPLACE FUNCTION public.create_apartment_reservation(p_listing_id text)
RETURNS public.reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
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
  SELECT * INTO v_profile
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_profile.user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF v_profile.role NOT IN ('user','worker','property_partner') THEN
    RAISE EXCEPTION 'This account cannot create customer reservations';
  END IF;

  SELECT * INTO v_listing
  FROM public.listings
  WHERE (id::text=p_listing_id OR listing_id=p_listing_id)
    AND deleted_at IS NULL
  LIMIT 1
  FOR UPDATE;
  IF v_listing.id IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF;

  SELECT * INTO v_existing
  FROM public.reservations
  WHERE listing_id=v_listing.id::text
    AND user_id=v_profile.user_id
    AND status = ANY (ARRAY['payment_pending','reserved','inspection_pending','ready_for_move_in','occupied']::text[])
  ORDER BY created_at DESC
  LIMIT 1;
  IF v_existing.id IS NOT NULL THEN RETURN v_existing; END IF;

  IF v_listing.status<>'available' OR v_listing.availability_status<>'available' THEN
    RAISE EXCEPTION 'Listing is not available';
  END IF;

  SELECT NULLIF(value,'')::numeric INTO v_fee
  FROM public.platform_settings WHERE key='reservation_fee' AND COALESCE(is_active,true)=true LIMIT 1;
  IF v_fee IS NULL OR v_fee<=0 THEN RAISE EXCEPTION 'Reservation fee is not configured'; END IF;

  SELECT NULLIF(value,'')::integer INTO v_checkout_minutes
  FROM public.platform_settings WHERE key='apartment_payment_hold_minutes' AND COALESCE(is_active,true)=true LIMIT 1;
  IF v_checkout_minutes IS NULL OR v_checkout_minutes<5 OR v_checkout_minutes>120 THEN v_checkout_minutes:=30; END IF;
  v_checkout_expires:=now()+make_interval(mins=>v_checkout_minutes);
  v_reference:='WHAPT-'||upper(replace(gen_random_uuid()::text,'-',''));

  BEGIN
    INSERT INTO public.reservations(
      listing_id,user_id,user_email,user_phone,listing_title,listing_price,listing_location,
      status,manual_payment_status,payment_reference,amount,currency,reservation_type,
      payment_expires_at,hold_expires_at,created_at,updated_at
    ) VALUES (
      v_listing.id::text,v_profile.user_id,v_profile.email,v_profile.phone,v_listing.title,v_listing.price,
      concat_ws(', ',v_listing.city,v_listing.state),'payment_pending','unpaid',v_reference,v_fee,'NGN','apartment',
      v_checkout_expires,NULL,now(),now()
    ) RETURNING * INTO v_created;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'This property is already held or occupied by another customer';
  END;

  INSERT INTO public.booking_payments(
    payment_reference,user_id,payer_user_id,type,booking_type,listing_id,
    amount,amount_total,currency,status,purpose,payment_method,paystack_reference,metadata,created_at,updated_at
  ) VALUES (
    v_reference,v_profile.user_id,v_profile.user_id,'apartment','apartment',v_listing.id::text,
    v_fee,v_fee,'NGN','pending','apartment_reservation','paystack',v_reference,
    jsonb_build_object('reservation_id',v_created.id,'listing_id',v_listing.id::text,'source','create_apartment_reservation'),
    now(),now()
  );

  UPDATE public.listings
  SET status='reserved',availability_status='reserved',reserved_by=v_profile.user_id,
      reservation_expiry=v_checkout_expires,reservation_fee_paid=false,chat_unlocked=false,
      current_reservation_id=v_created.id,updated_at=now()
  WHERE id=v_listing.id;

  RETURN v_created;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_user_inspection_request(p_reservation_id text,p_notes text DEFAULT NULL)
RETURNS public.user_inspection_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE
  v_user_id text;
  v_res public.reservations;
  v_existing public.user_inspection_requests;
  v_created public.user_inspection_requests;
BEGIN
  SELECT user_id INTO v_user_id FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_res FROM public.reservations WHERE id=p_reservation_id AND user_id=v_user_id FOR UPDATE;
  IF v_res.id IS NULL THEN RAISE EXCEPTION 'Reservation not found'; END IF;
  IF v_res.manual_payment_status NOT IN ('paid','completed') OR v_res.paid_at IS NULL THEN
    RAISE EXCEPTION 'Pay the reservation fee before requesting inspection';
  END IF;
  IF v_res.status NOT IN ('reserved','inspection_pending') THEN RAISE EXCEPTION 'Reservation is not eligible for inspection'; END IF;
  SELECT * INTO v_existing FROM public.user_inspection_requests
  WHERE reservation_id=p_reservation_id AND status IN ('pending','scheduled','in_progress')
  ORDER BY created_at DESC LIMIT 1;
  IF v_existing.id IS NOT NULL THEN RETURN v_existing; END IF;
  INSERT INTO public.user_inspection_requests(reservation_id,listing_id,user_id,notes,status,created_at,updated_at)
  VALUES(v_res.id,v_res.listing_id,v_user_id,NULLIF(btrim(p_notes),''),'pending',now(),now()) RETURNING * INTO v_created;
  UPDATE public.reservations SET status='inspection_pending',inspection_requested_at=now(),updated_at=now() WHERE id=v_res.id;
  RETURN v_created;
END;
$$;

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
  WHERE auth_id=auth.uid()::text
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_res FROM public.reservations WHERE id=p_reservation_id AND user_id=v_user_id FOR UPDATE;
  IF v_res.id IS NULL THEN RAISE EXCEPTION 'Reservation not found'; END IF;
  IF v_res.status<>'ready_for_move_in' THEN RAISE EXCEPTION 'Contract rent becomes payable after the inspection passes'; END IF;
  IF v_res.manual_payment_status NOT IN ('paid','completed') OR v_res.paid_at IS NULL THEN
    RAISE EXCEPTION 'Reservation fee must be confirmed first';
  END IF;
  IF v_res.rent_payment_status IN ('paid','upfront_paid') THEN
    RETURN jsonb_build_object('success',true,'already_paid',true,'status',v_res.rent_payment_status);
  END IF;

  SELECT * INTO v_listing FROM public.listings WHERE id::text=v_res.listing_id FOR SHARE;
  IF v_listing.id IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF;
  v_years:=COALESCE(v_res.rental_plan_years,1);
  IF v_years NOT IN (1,2,3) THEN RAISE EXCEPTION 'Reservation tenure is invalid'; END IF;

  v_total:=COALESCE(v_res.contract_rent_total,round(v_listing.price*v_years,2));
  IF v_years<=2 THEN
    v_upfront:=v_total; v_balance:=0; v_count:=0;
  ELSE
    v_upfront:=COALESCE(v_res.upfront_rent_required,round(v_total*0.68,2));
    v_balance:=v_total-v_upfront; v_count:=4;
  END IF;
  IF v_upfront<=0 THEN RAISE EXCEPTION 'Required rent amount is invalid'; END IF;

  SELECT * INTO v_pending FROM public.booking_payments
  WHERE user_id=v_user_id AND purpose='apartment_rent' AND status='pending'
    AND metadata->>'reservation_id'=v_res.id
  ORDER BY created_at DESC LIMIT 1;
  IF v_pending.id IS NOT NULL THEN
    UPDATE public.reservations SET rent_payment_status='payment_pending',rent_payment_reference=v_pending.paystack_reference,updated_at=now() WHERE id=v_res.id;
    RETURN jsonb_build_object('success',true,'reference',v_pending.paystack_reference,'amount',COALESCE(v_pending.amount_total,v_pending.amount),'existing',true);
  END IF;

  v_reference:='WHRENT-'||upper(replace(gen_random_uuid()::text,'-',''));
  INSERT INTO public.booking_payments(
    payment_reference,user_id,payer_user_id,type,booking_type,listing_id,amount,amount_total,currency,status,
    purpose,payment_method,paystack_reference,metadata,created_at,updated_at
  ) VALUES (
    v_reference,v_user_id,v_user_id,'apartment','apartment',v_listing.id::text,v_upfront,v_upfront,'NGN','pending',
    'apartment_rent','paystack',v_reference,
    jsonb_build_object('reservation_id',v_res.id,'listing_id',v_listing.id::text,'tenure_years',v_years,'total_contract_rent',v_total,'upfront_amount',v_upfront,'installment_balance',v_balance,'installment_count',v_count),
    now(),now()
  );

  UPDATE public.reservations
  SET annual_rent_snapshot=v_listing.price,contract_rent_total=v_total,upfront_rent_required=v_upfront,
      installment_balance=v_balance,installment_count=v_count,rent_payment_status='payment_pending',rent_payment_reference=v_reference,updated_at=now()
  WHERE id=v_res.id;

  RETURN jsonb_build_object('success',true,'reference',v_reference,'amount',v_upfront,'existing',false);
END;
$$;

COMMIT;
