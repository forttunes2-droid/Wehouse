BEGIN;

-- Phase 5 Housing lifecycle
-- `listings.status` is canonical; availability_status remains a compatibility mirror.

ALTER TABLE public.listings
  DROP CONSTRAINT IF EXISTS listings_status_check,
  DROP CONSTRAINT IF EXISTS listings_availability_status_check;

ALTER TABLE public.listings
  ADD CONSTRAINT listings_status_check CHECK (
    status = ANY (ARRAY['pending_approval','available','reserved','occupied','maintenance','closed','rejected']::text[])
  ),
  ADD CONSTRAINT listings_availability_status_check CHECK (
    availability_status = ANY (ARRAY['pending_approval','available','reserved','occupied','maintenance','closed','rejected']::text[])
  );

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS payment_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS tenancy_start_date date,
  ADD COLUMN IF NOT EXISTS tenancy_end_date date,
  ADD COLUMN IF NOT EXISTS move_out_grace_until date,
  ADD COLUMN IF NOT EXISTS occupancy_started_at timestamptz;

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS current_reservation_id text,
  ADD COLUMN IF NOT EXISTS occupied_by text,
  ADD COLUMN IF NOT EXISTS occupied_at timestamptz,
  ADD COLUMN IF NOT EXISTS tenancy_ends_at date;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='listings_current_reservation_id_fkey'
  ) THEN
    ALTER TABLE public.listings
      ADD CONSTRAINT listings_current_reservation_id_fkey
      FOREIGN KEY (current_reservation_id) REFERENCES public.reservations(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_status_check;
ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_status_check CHECK (
    status = ANY (ARRAY[
      'payment_pending','reserved','inspection_pending','ready_for_move_in',
      'occupied','completed','cancelled','expired','refunded','payment_conflict'
    ]::text[])
  );

INSERT INTO public.platform_settings(key,value,category,label,description,data_type,editable,is_active)
VALUES
  ('apartment_payment_hold_minutes','30','booking','Apartment checkout hold','Minutes a property is held while the customer completes the reservation-fee checkout.','number',true,true),
  ('tenancy_grace_days','7','booking','Tenancy move-out grace days','Grace period after the tenancy end date before operations escalation.','number',true,true)
ON CONFLICT (key) DO NOTHING;

-- Remove legacy triggers whose assumptions pre-date the canonical payment lifecycle.
DROP TRIGGER IF EXISTS reserve_listing_on_activation_trigger ON public.reservations;
DROP TRIGGER IF EXISTS set_reservation_expiry_trigger ON public.reservations;

DROP INDEX IF EXISTS public.reservations_one_live_hold_per_listing;
CREATE UNIQUE INDEX reservations_one_live_hold_per_listing
ON public.reservations(listing_id)
WHERE status = ANY (ARRAY['payment_pending','reserved','inspection_pending','ready_for_move_in','occupied']::text[]);

CREATE OR REPLACE FUNCTION public.prevent_double_reservation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='pg_catalog','public'
AS $$
BEGIN
  IF NEW.status = ANY (ARRAY['payment_pending','reserved','inspection_pending','ready_for_move_in','occupied']::text[]) AND EXISTS (
    SELECT 1 FROM public.reservations r
    WHERE r.listing_id=NEW.listing_id
      AND r.status = ANY (ARRAY['payment_pending','reserved','inspection_pending','ready_for_move_in','occupied']::text[])
      AND r.id<>NEW.id
  ) THEN
    RAISE EXCEPTION 'This property is already held or occupied by another customer';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_double_reservation_trigger ON public.reservations;
CREATE TRIGGER prevent_double_reservation_trigger
BEFORE INSERT OR UPDATE OF listing_id,status ON public.reservations
FOR EACH ROW
WHEN (NEW.status = ANY (ARRAY['payment_pending','reserved','inspection_pending','ready_for_move_in','occupied']::text[]))
EXECUTE FUNCTION public.prevent_double_reservation();

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
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF v_profile.role NOT IN ('user','worker','property_partner') THEN
    RAISE EXCEPTION 'This account cannot create customer reservations';
  END IF;

  SELECT * INTO v_listing
  FROM public.listings
  WHERE (id::text=p_listing_id OR listing_id=p_listing_id)
    AND deleted_at IS NULL
  LIMIT 1
  FOR UPDATE;
  IF v_listing IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF;

  SELECT * INTO v_existing
  FROM public.reservations
  WHERE listing_id=v_listing.id::text
    AND user_id=v_profile.user_id
    AND status = ANY (ARRAY['payment_pending','reserved','inspection_pending','ready_for_move_in','occupied']::text[])
  ORDER BY created_at DESC
  LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

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

CREATE OR REPLACE FUNCTION public.fulfill_apartment_reservation_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='pg_catalog','public'
AS $$
DECLARE
  v_res public.reservations;
  v_listing public.listings;
  v_hold_days integer;
  v_hold_expires timestamptz;
BEGIN
  IF NEW.purpose<>'apartment_reservation' OR NEW.status NOT IN ('paid','completed') THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.status IN ('paid','completed') THEN RETURN NEW; END IF;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE payment_reference=NEW.paystack_reference
  LIMIT 1
  FOR UPDATE;
  IF v_res IS NULL THEN RAISE EXCEPTION 'Apartment reservation payment has no reservation'; END IF;
  IF v_res.user_id IS DISTINCT FROM COALESCE(NEW.payer_user_id,NEW.user_id) THEN
    RAISE EXCEPTION 'Apartment reservation payment owner mismatch';
  END IF;

  SELECT * INTO v_listing FROM public.listings WHERE id::text=v_res.listing_id LIMIT 1 FOR UPDATE;
  IF v_listing IS NULL THEN RAISE EXCEPTION 'Apartment reservation listing not found'; END IF;
  IF v_listing.current_reservation_id IS DISTINCT FROM v_res.id
     AND v_listing.status<>'available' THEN
    UPDATE public.reservations
    SET status='payment_conflict',manual_payment_status='paid',paid_at=COALESCE(paid_at,now()),
        refund_reason='Payment completed after the property was assigned elsewhere',processed_at=now(),updated_at=now()
    WHERE id=v_res.id;
    RETURN NEW;
  END IF;

  SELECT NULLIF(value,'')::integer INTO v_hold_days
  FROM public.platform_settings WHERE key='apartment_reservation_hold_days' AND COALESCE(is_active,true)=true LIMIT 1;
  IF v_hold_days IS NULL OR v_hold_days<1 OR v_hold_days>30 THEN v_hold_days:=3; END IF;
  v_hold_expires:=now()+make_interval(days=>v_hold_days);

  UPDATE public.reservations
  SET status=CASE WHEN status='payment_pending' THEN 'reserved' ELSE status END,
      manual_payment_status='paid',paid_at=COALESCE(paid_at,now()),payment_expires_at=NULL,
      hold_expires_at=v_hold_expires,updated_at=now()
  WHERE id=v_res.id;

  UPDATE public.listings
  SET status='reserved',availability_status='reserved',reserved_by=v_res.user_id,
      reservation_expiry=v_hold_expires,reservation_fee_paid=true,chat_unlocked=true,
      current_reservation_id=v_res.id,updated_at=now()
  WHERE id=v_listing.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fulfill_apartment_reservation_payment_trigger ON public.booking_payments;
CREATE TRIGGER fulfill_apartment_reservation_payment_trigger
AFTER UPDATE OF status ON public.booking_payments
FOR EACH ROW
WHEN (NEW.purpose='apartment_reservation' AND NEW.status = ANY (ARRAY['paid','completed']::text[]))
EXECUTE FUNCTION public.fulfill_apartment_reservation_payment();

CREATE OR REPLACE FUNCTION public.get_my_reservation_for_listing(p_listing_id text)
RETURNS public.reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE v_user_id text; v_listing_id text; v_result public.reservations;
BEGIN
  SELECT user_id INTO v_user_id FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT id::text INTO v_listing_id FROM public.listings WHERE id::text=p_listing_id OR listing_id=p_listing_id LIMIT 1;
  IF v_listing_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_result FROM public.reservations
  WHERE listing_id=v_listing_id AND user_id=v_user_id
    AND status = ANY (ARRAY['payment_pending','reserved','inspection_pending','ready_for_move_in','occupied']::text[])
  ORDER BY created_at DESC LIMIT 1;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_my_reservation_plan(p_reservation_id text,p_plan_years integer)
RETURNS public.reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE v_user_id text; v_result public.reservations;
BEGIN
  SELECT user_id INTO v_user_id FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_plan_years IS NULL OR p_plan_years<1 OR p_plan_years>10 THEN RAISE EXCEPTION 'Rental plan must be between 1 and 10 years'; END IF;
  UPDATE public.reservations
  SET rental_plan_years=p_plan_years,rental_plan_selected_at=now(),updated_at=now()
  WHERE id=p_reservation_id AND user_id=v_user_id
    AND status = ANY (ARRAY['payment_pending','reserved','inspection_pending','ready_for_move_in']::text[])
  RETURNING * INTO v_result;
  IF v_result IS NULL THEN RAISE EXCEPTION 'Active reservation not found'; END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_my_apartment_reservation(p_reservation_id text)
RETURNS public.reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE v_user_id text; v_res public.reservations; v_result public.reservations;
BEGIN
  SELECT user_id INTO v_user_id FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_res FROM public.reservations WHERE id=p_reservation_id AND user_id=v_user_id FOR UPDATE;
  IF v_res IS NULL THEN RAISE EXCEPTION 'Reservation not found'; END IF;
  IF v_res.status NOT IN ('payment_pending','reserved','inspection_pending','ready_for_move_in') THEN
    RAISE EXCEPTION 'Reservation can no longer be cancelled here';
  END IF;
  IF v_res.manual_payment_status IN ('paid','completed') OR v_res.paid_at IS NOT NULL THEN
    RAISE EXCEPTION 'Paid reservations must be handled by support';
  END IF;
  UPDATE public.reservations SET status='cancelled',processed_at=now(),updated_at=now()
  WHERE id=v_res.id RETURNING * INTO v_result;
  UPDATE public.booking_payments SET status='cancelled',updated_at=now()
  WHERE paystack_reference=v_res.payment_reference AND status='pending';
  UPDATE public.listings
  SET status='available',availability_status='available',reserved_by=NULL,reservation_expiry=NULL,
      reservation_fee_paid=false,chat_unlocked=false,current_reservation_id=NULL,updated_at=now()
  WHERE id::text=v_res.listing_id AND current_reservation_id=v_res.id;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_user_inspection_request(p_reservation_id text,p_notes text DEFAULT NULL)
RETURNS public.user_inspection_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE v_user_id text; v_res public.reservations; v_existing public.user_inspection_requests; v_created public.user_inspection_requests;
BEGIN
  SELECT user_id INTO v_user_id FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_res FROM public.reservations WHERE id=p_reservation_id AND user_id=v_user_id FOR UPDATE;
  IF v_res IS NULL THEN RAISE EXCEPTION 'Reservation not found'; END IF;
  IF v_res.manual_payment_status NOT IN ('paid','completed') OR v_res.paid_at IS NULL THEN
    RAISE EXCEPTION 'Pay the reservation fee before requesting inspection';
  END IF;
  IF v_res.status NOT IN ('reserved','inspection_pending') THEN RAISE EXCEPTION 'Reservation is not eligible for inspection'; END IF;
  SELECT * INTO v_existing FROM public.user_inspection_requests
  WHERE reservation_id=p_reservation_id AND status IN ('pending','scheduled','in_progress')
  ORDER BY created_at DESC LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  INSERT INTO public.user_inspection_requests(reservation_id,listing_id,user_id,notes,status,created_at,updated_at)
  VALUES(v_res.id,v_res.listing_id,v_user_id,NULLIF(btrim(p_notes),''),'pending',now(),now()) RETURNING * INTO v_created;
  UPDATE public.reservations SET status='inspection_pending',inspection_requested_at=now(),updated_at=now() WHERE id=v_res.id;
  RETURN v_created;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_inspection_result(p_inspection_id uuid,p_result text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='pg_catalog','public'
AS $$
DECLARE v_actor public.profiles; v_req public.user_inspection_requests; v_res public.reservations;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role IN ('staff','admin','creator')
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Field operations access required'; END IF;
  IF p_result NOT IN ('passed','failed','customer_declined') THEN RAISE EXCEPTION 'Invalid inspection result'; END IF;
  SELECT * INTO v_req FROM public.user_inspection_requests WHERE id=p_inspection_id FOR UPDATE;
  IF v_req IS NULL THEN RAISE EXCEPTION 'Inspection not found'; END IF;
  IF v_actor.role='staff' THEN
    IF v_req.field_officer_id<>v_actor.user_id OR NOT public.current_staff_has_permission('field_officer') THEN RAISE EXCEPTION 'Inspection is not assigned to this Field Officer'; END IF;
  ELSIF v_actor.role='admin' AND NOT public.current_actor_can_access_listing_ref(v_req.listing_id) THEN
    RAISE EXCEPTION 'Inspection is outside your assigned branch';
  END IF;
  SELECT * INTO v_res FROM public.reservations WHERE id=v_req.reservation_id FOR UPDATE;
  UPDATE public.user_inspection_requests SET status='completed',condition=p_result,updated_at=now() WHERE id=p_inspection_id;
  UPDATE public.reservations SET inspection_result=p_result,inspection_completed=true,inspection_completed_at=now(),updated_at=now() WHERE id=v_req.reservation_id;
  IF p_result='passed' THEN
    UPDATE public.reservations SET status='ready_for_move_in',updated_at=now() WHERE id=v_req.reservation_id;
  ELSIF p_result='customer_declined' THEN
    UPDATE public.reservations SET status='cancelled',processed_at=now(),updated_at=now() WHERE id=v_req.reservation_id;
    UPDATE public.listings SET status='available',availability_status='available',reserved_by=NULL,reservation_expiry=NULL,
      reservation_fee_paid=false,chat_unlocked=false,current_reservation_id=NULL,updated_at=now()
    WHERE id::text=v_req.listing_id AND current_reservation_id=v_req.reservation_id;
  ELSE
    UPDATE public.reservations SET status='cancelled',refund_reason='provider_failure',processed_at=now(),updated_at=now() WHERE id=v_req.reservation_id;
    UPDATE public.listings SET status='maintenance',availability_status='maintenance',reserved_by=NULL,reservation_expiry=NULL,
      chat_unlocked=false,current_reservation_id=NULL,updated_at=now()
    WHERE id::text=v_req.listing_id AND current_reservation_id=v_req.reservation_id;
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_apartment_tenancy(p_reservation_id text,p_start_date date DEFAULT CURRENT_DATE)
RETURNS public.reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='pg_catalog','public'
AS $$
DECLARE v_actor public.profiles; v_res public.reservations; v_listing public.listings; v_years integer; v_grace integer; v_end date; v_result public.reservations;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role IN ('staff','admin','creator')
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Housing operations access required'; END IF;
  IF v_actor.role='staff' AND NOT public.current_staff_has_permission('operations') THEN RAISE EXCEPTION 'Operations permission required'; END IF;
  SELECT * INTO v_res FROM public.reservations WHERE id=p_reservation_id FOR UPDATE;
  IF v_res IS NULL THEN RAISE EXCEPTION 'Reservation not found'; END IF;
  SELECT * INTO v_listing FROM public.listings WHERE id::text=v_res.listing_id FOR UPDATE;
  IF v_listing IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF;
  IF v_actor.role<>'creator' AND NOT public.current_actor_in_scope(v_listing.state,v_listing.city) THEN RAISE EXCEPTION 'Listing is outside your assigned State/LGA'; END IF;
  IF v_res.status NOT IN ('reserved','inspection_pending','ready_for_move_in') THEN RAISE EXCEPTION 'Reservation is not ready for tenancy activation'; END IF;
  IF v_res.manual_payment_status NOT IN ('paid','completed') OR v_res.paid_at IS NULL THEN RAISE EXCEPTION 'Reservation fee is not confirmed'; END IF;
  v_years:=COALESCE(v_res.rental_plan_years,1);
  IF v_years<1 OR v_years>10 THEN RAISE EXCEPTION 'Invalid rental tenure'; END IF;
  SELECT NULLIF(value,'')::integer INTO v_grace FROM public.platform_settings WHERE key='tenancy_grace_days' AND COALESCE(is_active,true)=true LIMIT 1;
  IF v_grace IS NULL OR v_grace<0 OR v_grace>30 THEN v_grace:=7; END IF;
  v_end:=(p_start_date + make_interval(years=>v_years))::date;
  UPDATE public.reservations
  SET status='occupied',tenancy_start_date=p_start_date,tenancy_end_date=v_end,
      move_out_grace_until=v_end+v_grace,occupancy_started_at=now(),updated_at=now()
  WHERE id=v_res.id RETURNING * INTO v_result;
  UPDATE public.listings
  SET status='occupied',availability_status='occupied',occupied_by=v_res.user_id,occupied_at=now(),tenancy_ends_at=v_end,
      reserved_by=NULL,reservation_expiry=NULL,current_reservation_id=v_res.id,updated_at=now()
  WHERE id=v_listing.id;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_apartment_tenancy(p_reservation_id text,p_next_status text DEFAULT 'maintenance')
RETURNS public.reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='pg_catalog','public'
AS $$
DECLARE v_actor public.profiles; v_res public.reservations; v_listing public.listings; v_result public.reservations;
BEGIN
  IF p_next_status NOT IN ('maintenance','available','closed') THEN RAISE EXCEPTION 'Invalid next property status'; END IF;
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role IN ('staff','admin','creator')
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Housing operations access required'; END IF;
  IF v_actor.role='staff' AND NOT public.current_staff_has_permission('operations') THEN RAISE EXCEPTION 'Operations permission required'; END IF;
  SELECT * INTO v_res FROM public.reservations WHERE id=p_reservation_id AND status='occupied' FOR UPDATE;
  IF v_res IS NULL THEN RAISE EXCEPTION 'Occupied reservation not found'; END IF;
  SELECT * INTO v_listing FROM public.listings WHERE id::text=v_res.listing_id FOR UPDATE;
  IF v_actor.role<>'creator' AND NOT public.current_actor_in_scope(v_listing.state,v_listing.city) THEN RAISE EXCEPTION 'Listing is outside your assigned State/LGA'; END IF;
  UPDATE public.reservations SET status='completed',completed_at=now(),processed_by=v_actor.user_id,processed_at=now(),updated_at=now()
  WHERE id=v_res.id RETURNING * INTO v_result;
  UPDATE public.listings SET status=p_next_status,availability_status=p_next_status,occupied_by=NULL,occupied_at=NULL,tenancy_ends_at=NULL,
    reserved_by=NULL,reservation_expiry=NULL,reservation_fee_paid=false,chat_unlocked=false,current_reservation_id=NULL,updated_at=now()
  WHERE id=v_listing.id;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_overdue_reservations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='pg_catalog','public'
AS $$
DECLARE v_role text; v_count integer:=0; v_row record;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    SELECT role INTO v_role FROM public.profiles WHERE auth_id=auth.uid()::text AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
    IF v_role<>'creator' THEN RAISE EXCEPTION 'Creator or service execution required'; END IF;
  END IF;
  FOR v_row IN
    SELECT r.id,r.listing_id,r.status,r.payment_reference
    FROM public.reservations r
    WHERE (r.status='payment_pending' AND r.payment_expires_at<now())
       OR (r.status IN ('reserved','inspection_pending','ready_for_move_in') AND r.hold_expires_at<now())
    FOR UPDATE
  LOOP
    IF v_row.status='payment_pending' AND EXISTS(
      SELECT 1 FROM public.booking_payments bp WHERE bp.paystack_reference=v_row.payment_reference AND bp.status IN ('paid','completed')
    ) THEN CONTINUE; END IF;
    UPDATE public.reservations SET status='expired',refund_amount=0,refund_reason='Reservation hold expired',processed_at=now(),updated_at=now() WHERE id=v_row.id;
    UPDATE public.booking_payments SET status='expired',updated_at=now() WHERE paystack_reference=v_row.payment_reference AND status='pending';
    UPDATE public.listings SET status='available',availability_status='available',reserved_by=NULL,reservation_expiry=NULL,
      reservation_fee_paid=false,chat_unlocked=false,current_reservation_id=NULL,updated_at=now()
    WHERE id::text=v_row.listing_id AND current_reservation_id=v_row.id;
    v_count:=v_count+1;
  END LOOP;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_listing_status_internal(p_listing_id text,p_status text)
RETURNS public.listings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE v_actor public.profiles; v_listing public.listings;
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role IN ('staff','admin','creator')
    AND NOT COALESCE(deleted,false) AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false)
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Listing operations access required'; END IF;
  IF v_actor.role='staff' AND NOT public.current_staff_has_permission('operations') THEN RAISE EXCEPTION 'Operations Staff permission required'; END IF;
  IF p_status NOT IN ('available','maintenance','closed') THEN
    RAISE EXCEPTION 'Reserved and occupied states are controlled by reservation/tenancy workflows';
  END IF;
  SELECT * INTO v_listing FROM public.listings
  WHERE (listing_id=p_listing_id OR id::text=p_listing_id) AND deleted_at IS NULL FOR UPDATE;
  IF v_listing IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF;
  IF v_actor.role<>'creator' AND NOT public.current_actor_in_scope(v_listing.state,v_listing.city) THEN RAISE EXCEPTION 'Listing is outside your assigned State/LGA'; END IF;
  IF v_listing.status IN ('pending_approval','rejected') THEN RAISE EXCEPTION 'Approval state must be resolved first'; END IF;
  IF v_listing.status IN ('reserved','occupied') OR v_listing.current_reservation_id IS NOT NULL THEN
    RAISE EXCEPTION 'Resolve the active reservation/tenancy instead of manually changing this property';
  END IF;
  UPDATE public.listings SET status=p_status,availability_status=p_status,updated_at=now() WHERE id=v_listing.id RETURNING * INTO v_listing;
  RETURN v_listing;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_apartment_tenancy(text,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.activate_apartment_tenancy(text,date) TO authenticated;
REVOKE ALL ON FUNCTION public.complete_apartment_tenancy(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.complete_apartment_tenancy(text,text) TO authenticated;

COMMIT;
