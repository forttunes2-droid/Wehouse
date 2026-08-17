-- Final housing lifecycle guards after introducing date-based Short Stay.
-- Keep Long Stay operations yearly and prevent paid future Short Stay bookings
-- from inheriting the Long Stay three-day property hold timeout.

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
  v_is_short boolean;
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

  SELECT * INTO v_listing
  FROM public.listings
  WHERE id::text=v_res.listing_id
  LIMIT 1
  FOR UPDATE;
  IF v_listing IS NULL THEN RAISE EXCEPTION 'Apartment reservation listing not found'; END IF;
  v_is_short := COALESCE(v_res.stay_type,v_listing.sub_type,'long_stay')='short_let';

  IF v_is_short THEN
    IF EXISTS (
      SELECT 1
      FROM public.reservations r
      WHERE r.listing_id=v_res.listing_id
        AND r.id<>v_res.id
        AND r.status = ANY (ARRAY['payment_pending','reserved','inspection_pending','ready_for_move_in','occupied']::text[])
        AND (
          COALESCE(r.stay_type,'long_stay')<>'short_let'
          OR daterange(r.stay_check_in,r.stay_check_out,'[)') && daterange(v_res.stay_check_in,v_res.stay_check_out,'[)')
        )
    ) THEN
      UPDATE public.reservations
      SET status='payment_conflict',manual_payment_status='paid',paid_at=COALESCE(paid_at,now()),
          refund_reason='Payment completed after the selected dates became unavailable',processed_at=now(),updated_at=now()
      WHERE id=v_res.id;
      RETURN NEW;
    END IF;
  ELSE
    IF v_listing.current_reservation_id IS DISTINCT FROM v_res.id AND v_listing.status<>'available' THEN
      UPDATE public.reservations
      SET status='payment_conflict',manual_payment_status='paid',paid_at=COALESCE(paid_at,now()),
          refund_reason='Payment completed after the property was assigned elsewhere',processed_at=now(),updated_at=now()
      WHERE id=v_res.id;
      RETURN NEW;
    END IF;
  END IF;

  SELECT NULLIF(value,'')::integer INTO v_hold_days
  FROM public.platform_settings
  WHERE key='apartment_reservation_hold_days' AND COALESCE(is_active,true)=true
  LIMIT 1;
  IF v_hold_days IS NULL OR v_hold_days<1 OR v_hold_days>30 THEN v_hold_days:=3; END IF;
  v_hold_expires:=now()+make_interval(days=>v_hold_days);

  UPDATE public.reservations
  SET status=CASE WHEN status='payment_pending' THEN 'reserved' ELSE status END,
      manual_payment_status='paid',
      paid_at=COALESCE(paid_at,now()),
      payment_expires_at=NULL,
      -- Short Stay is date-reserved. It must not expire after the Long Stay
      -- three-day decision hold just because check-in is later in the month.
      hold_expires_at=CASE WHEN v_is_short THEN NULL ELSE v_hold_expires END,
      updated_at=now()
  WHERE id=v_res.id;

  IF NOT v_is_short THEN
    UPDATE public.listings
    SET status='reserved',availability_status='reserved',reserved_by=v_res.user_id,
        reservation_expiry=v_hold_expires,reservation_fee_paid=true,chat_unlocked=true,
        current_reservation_id=v_res.id,updated_at=now()
    WHERE id=v_listing.id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_housing_operations()
RETURNS TABLE(
  listing_id text, listing_title text, listing_status text, property_type text, sub_type text,
  state text, lga text, address text, annual_rent numeric, current_reservation_id text,
  reservation_status text, customer_user_id text, customer_name text, customer_username text,
  reservation_fee_paid boolean, payment_status text, rental_plan_years integer,
  contract_rent_total numeric, upfront_rent_required numeric, installment_balance numeric,
  installment_count integer, rent_payment_status text, rent_paid_at timestamptz,
  hold_expires_at timestamptz, tenancy_start_date date, tenancy_end_date date,
  move_out_grace_until date, occupied_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_actor public.profiles;
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND role IN ('staff','admin','creator')
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Housing operations access required'; END IF;
  IF v_actor.role='staff' AND NOT public.current_staff_has_permission('operations') THEN
    RAISE EXCEPTION 'Operations permission required';
  END IF;

  RETURN QUERY
  SELECT
    l.id::text,l.title,l.status,l.property_type,l.sub_type,l.state,l.city,l.address,l.price,
    l.current_reservation_id,r.status,r.user_id,COALESCE(p.full_name,p.username,p.email),p.username,
    COALESCE(l.reservation_fee_paid,false),r.manual_payment_status,r.rental_plan_years,
    r.contract_rent_total,r.upfront_rent_required,r.installment_balance,r.installment_count,
    r.rent_payment_status,r.rent_paid_at,r.hold_expires_at,r.tenancy_start_date,r.tenancy_end_date,
    r.move_out_grace_until,l.occupied_at
  FROM public.listings l
  LEFT JOIN public.reservations r ON r.id=l.current_reservation_id
  LEFT JOIN public.profiles p ON p.user_id=r.user_id
  WHERE l.deleted_at IS NULL
    AND COALESCE(l.property_type,'apartment')='apartment'
    AND l.sub_type='long_stay'
    AND l.status IN ('available','reserved','occupied','maintenance','closed')
    AND (v_actor.role='creator' OR public.current_actor_in_scope(l.state,l.city))
  ORDER BY CASE l.status WHEN 'reserved' THEN 1 WHEN 'occupied' THEN 2 WHEN 'maintenance' THEN 3 WHEN 'available' THEN 4 ELSE 5 END,l.updated_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_apartment_tenancy(
  p_reservation_id text,
  p_next_status text DEFAULT 'maintenance'
)
RETURNS public.reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_actor public.profiles;
  v_res public.reservations;
  v_listing public.listings;
  v_result public.reservations;
BEGIN
  IF p_next_status NOT IN ('maintenance','available','closed') THEN RAISE EXCEPTION 'Invalid next property status'; END IF;
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND role IN ('staff','admin','creator')
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Housing operations access required'; END IF;
  IF v_actor.role='staff' AND NOT public.current_staff_has_permission('operations') THEN RAISE EXCEPTION 'Operations permission required'; END IF;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE id=p_reservation_id AND status='occupied'
  FOR UPDATE;
  IF v_res IS NULL THEN RAISE EXCEPTION 'Occupied reservation not found'; END IF;
  IF COALESCE(v_res.stay_type,'long_stay')<>'long_stay' THEN
    RAISE EXCEPTION 'Short Stay checkout uses the Short Stay operations workflow';
  END IF;

  SELECT * INTO v_listing FROM public.listings WHERE id::text=v_res.listing_id FOR UPDATE;
  IF v_listing IS NULL OR v_listing.sub_type<>'long_stay' THEN RAISE EXCEPTION 'Long Stay listing not found'; END IF;
  IF v_actor.role<>'creator' AND NOT public.current_actor_in_scope(v_listing.state,v_listing.city) THEN
    RAISE EXCEPTION 'Listing is outside your assigned State/LGA';
  END IF;

  UPDATE public.reservations
  SET status='completed',completed_at=now(),processed_by=v_actor.user_id,processed_at=now(),updated_at=now()
  WHERE id=v_res.id
  RETURNING * INTO v_result;

  UPDATE public.listings
  SET status=p_next_status,availability_status=p_next_status,occupied_by=NULL,occupied_at=NULL,tenancy_ends_at=NULL,
      reserved_by=NULL,reservation_expiry=NULL,reservation_fee_paid=false,chat_unlocked=false,current_reservation_id=NULL,updated_at=now()
  WHERE id=v_listing.id;
  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_my_housing_operations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_apartment_tenancy(text,text) TO authenticated;
