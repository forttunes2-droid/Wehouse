BEGIN;

-- Human-readable booking identifiers. They identify a reservation at handover /
-- reception; they are never treated as authentication secrets.
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS booking_code text;
ALTER TABLE public.hotel_bookings
  ADD COLUMN IF NOT EXISTS booking_code text,
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS payment_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS reservations_booking_code_unique
ON public.reservations(booking_code) WHERE booking_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS hotel_bookings_booking_code_unique
ON public.hotel_bookings(booking_code) WHERE booking_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS hotel_bookings_payment_reference_unique
ON public.hotel_bookings(payment_reference) WHERE payment_reference IS NOT NULL;

ALTER TABLE public.hotel_bookings DROP CONSTRAINT IF EXISTS hotel_bookings_status_check;
ALTER TABLE public.hotel_bookings
  ADD CONSTRAINT hotel_bookings_status_check
  CHECK (status = ANY (ARRAY['pending','confirmed','checked_in','checked_out','cancelled','completed','refunded','expired','payment_conflict']::text[]));

ALTER TABLE public.hotel_bookings DROP CONSTRAINT IF EXISTS hotel_bookings_payment_status_check;
ALTER TABLE public.hotel_bookings
  ADD CONSTRAINT hotel_bookings_payment_status_check
  CHECK (payment_status = ANY (ARRAY['unpaid','payment_pending','paid','refunded','failed','expired']::text[]));

CREATE OR REPLACE FUNCTION public.set_reservation_booking_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='pg_catalog','public'
AS $$
DECLARE v_code text;
BEGIN
  IF TG_OP='UPDATE' THEN
    NEW.booking_code:=OLD.booking_code;
    RETURN NEW;
  END IF;
  IF NULLIF(btrim(COALESCE(NEW.booking_code,'')),'') IS NOT NULL THEN RETURN NEW; END IF;
  LOOP
    v_code:='WH-HSE-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.reservations r WHERE r.booking_code=v_code);
  END LOOP;
  NEW.booking_code:=v_code;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_reservation_booking_code_trigger ON public.reservations;
CREATE TRIGGER set_reservation_booking_code_trigger
BEFORE INSERT OR UPDATE OF booking_code ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.set_reservation_booking_code();

CREATE OR REPLACE FUNCTION public.set_hotel_booking_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='pg_catalog','public'
AS $$
DECLARE v_code text;
BEGIN
  IF TG_OP='UPDATE' THEN
    NEW.booking_code:=OLD.booking_code;
    RETURN NEW;
  END IF;
  IF NULLIF(btrim(COALESCE(NEW.booking_code,'')),'') IS NOT NULL THEN RETURN NEW; END IF;
  LOOP
    v_code:='WH-HTL-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.hotel_bookings hb WHERE hb.booking_code=v_code);
  END LOOP;
  NEW.booking_code:=v_code;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_hotel_booking_code_trigger ON public.hotel_bookings;
CREATE TRIGGER set_hotel_booking_code_trigger
BEFORE INSERT OR UPDATE OF booking_code ON public.hotel_bookings
FOR EACH ROW EXECUTE FUNCTION public.set_hotel_booking_code();

-- Safe backfill for any historical rows.
UPDATE public.reservations
SET booking_code='WH-HSE-'||upper(substr(md5(id||created_at::text),1,10))
WHERE booking_code IS NULL;
UPDATE public.hotel_bookings
SET booking_code='WH-HTL-'||upper(substr(md5(booking_id::text||created_at::text),1,10))
WHERE booking_code IS NULL;
ALTER TABLE public.reservations ALTER COLUMN booking_code SET NOT NULL;
ALTER TABLE public.hotel_bookings ALTER COLUMN booking_code SET NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_hotel_booking_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='pg_catalog','public'
AS $$
DECLARE
  v_actor public.profiles;
  v_hotel public.hotels;
  v_room public.hotel_rooms;
  v_reserved integer;
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND NOT COALESCE(deleted,false)
    AND NOT COALESCE(suspended,false)
    AND NOT COALESCE(banned,false)
  LIMIT 1;

  IF TG_OP='INSERT' THEN
    IF v_actor IS NULL OR v_actor.role<>'user' THEN RAISE EXCEPTION 'Active User account required'; END IF;
    NEW.user_id:=v_actor.user_id;
    NEW.status:='pending';
    NEW.payment_status:='unpaid';
    NEW.payment_expires_at:=COALESCE(NEW.payment_expires_at,now()+interval '30 minutes');
    IF NEW.check_in IS NULL OR NEW.check_out IS NULL OR NEW.check_in<=CURRENT_DATE OR NEW.check_out<=NEW.check_in THEN RAISE EXCEPTION 'Choose valid future check-in and check-out dates'; END IF;
    IF COALESCE(NEW.guest_count,0)<1 THEN RAISE EXCEPTION 'At least one guest is required'; END IF;
    IF NULLIF(btrim(NEW.guest_name),'') IS NULL OR NULLIF(btrim(NEW.guest_phone),'') IS NULL THEN RAISE EXCEPTION 'Guest name and phone are required'; END IF;

    SELECT * INTO v_hotel
    FROM public.hotels
    WHERE hotel_id=NEW.hotel_id AND status='active' AND approved_at IS NOT NULL AND published_at IS NOT NULL;
    IF v_hotel IS NULL THEN RAISE EXCEPTION 'Hotel is not available for booking'; END IF;

    SELECT * INTO v_room
    FROM public.hotel_rooms
    WHERE room_id=NEW.room_id AND hotel_id=NEW.hotel_id
    FOR UPDATE;
    IF v_room IS NULL THEN RAISE EXCEPTION 'Room type not found for this hotel'; END IF;
    IF NEW.guest_count>COALESCE(v_room.max_guests,2) THEN RAISE EXCEPTION 'Guest count exceeds this room type capacity'; END IF;
    IF COALESCE(v_room.total_rooms,0)<1 OR COALESCE(v_room.price_per_night,0)<=0 THEN RAISE EXCEPTION 'Room type is not available for booking'; END IF;

    SELECT count(*)::integer INTO v_reserved
    FROM public.hotel_bookings hb
    WHERE hb.room_id=NEW.room_id
      AND hb.check_in<NEW.check_out AND hb.check_out>NEW.check_in
      AND (
        hb.status IN ('confirmed','checked_in')
        OR (hb.status='pending' AND COALESCE(hb.payment_expires_at,hb.created_at+interval '30 minutes')>now())
      );
    IF v_reserved>=v_room.total_rooms THEN RAISE EXCEPTION 'This room type is fully booked for those dates'; END IF;

    NEW.total_nights:=NEW.check_out-NEW.check_in;
    NEW.total_price:=NEW.total_nights*v_room.price_per_night;
    NEW.created_at:=COALESCE(NEW.created_at,now());
    NEW.updated_at:=now();
    RETURN NEW;
  END IF;

  IF TG_OP='UPDATE' THEN
    -- Trusted SECURITY DEFINER payment/operations functions own lifecycle updates.
    IF current_user NOT IN ('anon','authenticated') THEN
      NEW.updated_at:=now();
      RETURN NEW;
    END IF;
    IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
    IF v_actor.role='creator' THEN NEW.updated_at:=now(); RETURN NEW; END IF;
    IF v_actor.role<>'user' OR OLD.user_id IS DISTINCT FROM v_actor.user_id THEN RAISE EXCEPTION 'Booking owner access required'; END IF;
    IF OLD.status<>'pending' OR NEW.status<>'cancelled' OR OLD.payment_status='paid' THEN
      RAISE EXCEPTION 'Customers can only cancel their own unpaid pending booking';
    END IF;
    NEW.hotel_id:=OLD.hotel_id; NEW.room_id:=OLD.room_id; NEW.user_id:=OLD.user_id;
    NEW.check_in:=OLD.check_in; NEW.check_out:=OLD.check_out; NEW.guest_count:=OLD.guest_count;
    NEW.total_nights:=OLD.total_nights; NEW.total_price:=OLD.total_price;
    NEW.guest_name:=OLD.guest_name; NEW.guest_phone:=OLD.guest_phone; NEW.special_requests:=OLD.special_requests;
    NEW.payment_reference:=OLD.payment_reference; NEW.paid_at:=OLD.paid_at; NEW.confirmed_at:=OLD.confirmed_at;
    NEW.created_at:=OLD.created_at; NEW.updated_at:=now();
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_my_hotel_booking(
  p_hotel_id integer,p_room_id integer,p_check_in date,p_check_out date,p_guest_count integer,
  p_guest_name text,p_guest_phone text,p_special_requests text DEFAULT NULL
)
RETURNS public.hotel_bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='pg_catalog','public'
AS $$
DECLARE
  v_actor public.profiles;
  v_hotel public.hotels;
  v_room public.hotel_rooms;
  v_nights integer;
  v_reserved integer;
  v_result public.hotel_bookings;
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role='user'
    AND NOT COALESCE(deleted,false) AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false)
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Active User account required'; END IF;
  IF p_check_in IS NULL OR p_check_out IS NULL OR p_check_in<=CURRENT_DATE OR p_check_out<=p_check_in THEN RAISE EXCEPTION 'Choose valid future check-in and check-out dates'; END IF;
  IF COALESCE(p_guest_count,0)<1 THEN RAISE EXCEPTION 'At least one guest is required'; END IF;
  IF NULLIF(btrim(p_guest_name),'') IS NULL OR NULLIF(btrim(p_guest_phone),'') IS NULL THEN RAISE EXCEPTION 'Guest name and phone are required'; END IF;

  SELECT * INTO v_hotel FROM public.hotels
  WHERE hotel_id=p_hotel_id AND status='active' AND approved_at IS NOT NULL AND published_at IS NOT NULL;
  IF v_hotel IS NULL THEN RAISE EXCEPTION 'Hotel is not available for booking'; END IF;

  SELECT * INTO v_room FROM public.hotel_rooms WHERE room_id=p_room_id AND hotel_id=p_hotel_id FOR UPDATE;
  IF v_room IS NULL THEN RAISE EXCEPTION 'Room type not found for this hotel'; END IF;
  IF p_guest_count>COALESCE(v_room.max_guests,2) THEN RAISE EXCEPTION 'Guest count exceeds this room type capacity'; END IF;
  IF COALESCE(v_room.total_rooms,0)<1 OR COALESCE(v_room.price_per_night,0)<=0 THEN RAISE EXCEPTION 'Room type is not available for booking'; END IF;

  SELECT count(*)::integer INTO v_reserved
  FROM public.hotel_bookings hb
  WHERE hb.room_id=p_room_id
    AND hb.check_in<p_check_out AND hb.check_out>p_check_in
    AND (
      hb.status IN ('confirmed','checked_in')
      OR (hb.status='pending' AND COALESCE(hb.payment_expires_at,hb.created_at+interval '30 minutes')>now())
    );
  IF v_reserved>=v_room.total_rooms THEN RAISE EXCEPTION 'This room type is fully booked for those dates'; END IF;

  v_nights:=p_check_out-p_check_in;
  INSERT INTO public.hotel_bookings(
    hotel_id,room_id,user_id,check_in,check_out,guest_count,total_nights,total_price,status,
    guest_name,guest_phone,special_requests,payment_status,payment_expires_at,created_at,updated_at
  ) VALUES (
    p_hotel_id,p_room_id,v_actor.user_id,p_check_in,p_check_out,p_guest_count,v_nights,v_nights*v_room.price_per_night,'pending',
    btrim(p_guest_name),btrim(p_guest_phone),NULLIF(btrim(p_special_requests),''),'unpaid',now()+interval '30 minutes',now(),now()
  ) RETURNING * INTO v_result;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_hotel_booking_payment(p_booking_id integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='pg_catalog','public'
AS $$
DECLARE
  v_user_id text;
  v_booking public.hotel_bookings;
  v_hotel public.hotels;
  v_reference text;
  v_pending public.booking_payments;
BEGIN
  SELECT user_id INTO v_user_id
  FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role='user'
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Active User account required'; END IF;

  SELECT * INTO v_booking
  FROM public.hotel_bookings
  WHERE booking_id=p_booking_id AND user_id=v_user_id
  FOR UPDATE;
  IF v_booking.booking_id IS NULL THEN RAISE EXCEPTION 'Hotel booking not found'; END IF;
  IF v_booking.status='confirmed' AND v_booking.payment_status='paid' THEN
    RETURN jsonb_build_object('success',true,'already_paid',true,'booking_code',v_booking.booking_code);
  END IF;
  IF v_booking.status<>'pending' THEN RAISE EXCEPTION 'Hotel booking is no longer awaiting payment'; END IF;
  IF v_booking.payment_expires_at IS NULL OR v_booking.payment_expires_at<=now() THEN
    UPDATE public.hotel_bookings SET status='expired',payment_status='expired',updated_at=now() WHERE booking_id=v_booking.booking_id;
    RAISE EXCEPTION 'Hotel checkout hold has expired. Choose the room again.';
  END IF;
  IF COALESCE(v_booking.total_price,0)<=0 THEN RAISE EXCEPTION 'Hotel booking amount is invalid'; END IF;

  SELECT * INTO v_hotel FROM public.hotels WHERE hotel_id=v_booking.hotel_id;
  IF v_hotel.hotel_id IS NULL THEN RAISE EXCEPTION 'Hotel not found'; END IF;

  SELECT * INTO v_pending
  FROM public.booking_payments
  WHERE user_id=v_user_id AND purpose='hotel_booking' AND hotel_booking_id=v_booking.booking_id AND status='pending'
    AND round(COALESCE(amount_total,amount),2)=round(v_booking.total_price,2)
  ORDER BY created_at DESC LIMIT 1;
  IF v_pending.id IS NOT NULL THEN
    UPDATE public.hotel_bookings SET payment_status='payment_pending',payment_reference=v_pending.paystack_reference,updated_at=now() WHERE booking_id=v_booking.booking_id;
    RETURN jsonb_build_object('success',true,'reference',v_pending.paystack_reference,'amount',COALESCE(v_pending.amount_total,v_pending.amount),'existing',true,'booking_code',v_booking.booking_code);
  END IF;

  v_reference:='WHHOTEL-'||upper(replace(gen_random_uuid()::text,'-',''));
  INSERT INTO public.booking_payments(
    payment_reference,user_id,payer_user_id,type,booking_type,hotel_booking_id,amount,amount_total,currency,status,
    purpose,payment_method,paystack_reference,metadata,created_at,updated_at
  ) VALUES (
    v_reference,v_user_id,v_user_id,'hotel','hotel',v_booking.booking_id,v_booking.total_price,v_booking.total_price,'NGN','pending',
    'hotel_booking','paystack',v_reference,
    jsonb_build_object(
      'hotel_booking_id',v_booking.booking_id,
      'hotel_id',v_booking.hotel_id,
      'room_id',v_booking.room_id,
      'booking_code',v_booking.booking_code,
      'check_in',v_booking.check_in,
      'check_out',v_booking.check_out,
      'eligible_partner_amount',v_booking.total_price
    ),now(),now()
  );
  UPDATE public.hotel_bookings
  SET payment_status='payment_pending',payment_reference=v_reference,updated_at=now()
  WHERE booking_id=v_booking.booking_id;
  RETURN jsonb_build_object('success',true,'reference',v_reference,'amount',v_booking.total_price,'existing',false,'booking_code',v_booking.booking_code);
END;
$$;

CREATE OR REPLACE FUNCTION public.fulfill_hotel_booking_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='pg_catalog','public'
AS $$
DECLARE
  v_booking public.hotel_bookings;
  v_room public.hotel_rooms;
  v_reserved integer;
BEGIN
  IF NEW.purpose<>'hotel_booking' OR NEW.status NOT IN ('paid','completed') THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.status IN ('paid','completed') THEN RETURN NEW; END IF;

  SELECT * INTO v_booking
  FROM public.hotel_bookings
  WHERE booking_id=NEW.hotel_booking_id
    AND user_id=COALESCE(NEW.payer_user_id,NEW.user_id)
  FOR UPDATE;
  IF v_booking.booking_id IS NULL THEN RAISE EXCEPTION 'Hotel payment has no matching booking'; END IF;
  IF v_booking.payment_reference IS DISTINCT FROM NEW.paystack_reference THEN RAISE EXCEPTION 'Hotel payment reference mismatch'; END IF;
  IF round(v_booking.total_price,2)<>round(COALESCE(NEW.amount_total,NEW.amount),2) THEN RAISE EXCEPTION 'Hotel payment amount mismatch'; END IF;
  IF v_booking.status='confirmed' AND v_booking.payment_status='paid' THEN RETURN NEW; END IF;

  SELECT * INTO v_room FROM public.hotel_rooms WHERE room_id=v_booking.room_id AND hotel_id=v_booking.hotel_id FOR UPDATE;
  IF v_room.room_id IS NULL THEN RAISE EXCEPTION 'Hotel room no longer exists'; END IF;

  SELECT count(*)::integer INTO v_reserved
  FROM public.hotel_bookings hb
  WHERE hb.room_id=v_booking.room_id
    AND hb.booking_id<>v_booking.booking_id
    AND hb.check_in<v_booking.check_out AND hb.check_out>v_booking.check_in
    AND hb.status IN ('confirmed','checked_in');

  IF v_reserved>=v_room.total_rooms THEN
    UPDATE public.hotel_bookings
    SET status='payment_conflict',payment_status='paid',paid_at=COALESCE(paid_at,now()),updated_at=now()
    WHERE booking_id=v_booking.booking_id;
    RETURN NEW;
  END IF;

  UPDATE public.hotel_bookings
  SET status='confirmed',payment_status='paid',paid_at=COALESCE(paid_at,now()),confirmed_at=COALESCE(confirmed_at,now()),updated_at=now()
  WHERE booking_id=v_booking.booking_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fulfill_hotel_booking_payment_trigger ON public.booking_payments;
CREATE TRIGGER fulfill_hotel_booking_payment_trigger
AFTER UPDATE OF status ON public.booking_payments
FOR EACH ROW
WHEN (NEW.purpose='hotel_booking' AND NEW.status = ANY (ARRAY['paid','completed']::text[]))
EXECUTE FUNCTION public.fulfill_hotel_booking_payment();

CREATE OR REPLACE FUNCTION public.cancel_my_hotel_booking(p_booking_id integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='pg_catalog','public'
AS $$
DECLARE v_user_id text;v_changed integer;
BEGIN
  SELECT p.user_id INTO v_user_id
  FROM public.profiles p
  WHERE p.auth_id=auth.uid()::text AND p.role='user'
    AND NOT COALESCE(p.deleted,false) AND NOT COALESCE(p.suspended,false) AND NOT COALESCE(p.banned,false)
  LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Active User account required'; END IF;

  UPDATE public.hotel_bookings
  SET status='cancelled',payment_status=CASE WHEN payment_status='paid' THEN payment_status ELSE 'expired' END,updated_at=now()
  WHERE booking_id=p_booking_id AND user_id=v_user_id AND status='pending' AND payment_status<>'paid';
  GET DIAGNOSTICS v_changed=ROW_COUNT;
  IF v_changed=0 THEN RAISE EXCEPTION 'Only your unpaid pending hotel booking can be cancelled'; END IF;

  UPDATE public.booking_payments bp
  SET status='cancelled',updated_at=now()
  WHERE bp.hotel_booking_id=p_booking_id AND bp.user_id=v_user_id AND bp.purpose='hotel_booking' AND bp.status='pending';
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_stale_hotel_booking_holds()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='pg_catalog','public'
AS $$
DECLARE v_count integer;
BEGIN
  WITH expired AS (
    UPDATE public.hotel_bookings hb
    SET status='expired',payment_status='expired',updated_at=now()
    WHERE hb.status='pending'
      AND hb.payment_status IN ('unpaid','payment_pending')
      AND hb.payment_expires_at IS NOT NULL
      AND hb.payment_expires_at<now()
      AND NOT EXISTS (
        SELECT 1 FROM public.booking_payments bp
        WHERE bp.hotel_booking_id=hb.booking_id AND bp.purpose='hotel_booking' AND bp.status IN ('paid','completed')
      )
    RETURNING hb.booking_id
  )
  SELECT count(*)::integer INTO v_count FROM expired;

  UPDATE public.booking_payments bp
  SET status='expired',updated_at=now()
  WHERE bp.purpose='hotel_booking' AND bp.status='pending'
    AND EXISTS (
      SELECT 1 FROM public.hotel_bookings hb
      WHERE hb.booking_id=bp.hotel_booking_id AND hb.status='expired'
    );
  RETURN COALESCE(v_count,0);
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname='wehouse_expire_hotel_booking_holds';
    PERFORM cron.schedule('wehouse_expire_hotel_booking_holds','*/5 * * * *','SELECT public.expire_stale_hotel_booking_holds();');
  END IF;
END $$;

-- Guard Property Partner settlement: a paid Hotel transaction is not released
-- to a Partner unless its booking actually reached confirmed state. Payment
-- conflicts remain recorded for Finance/Support resolution without double-booking.
CREATE OR REPLACE FUNCTION public.settle_verified_property_partner_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_partner_id text;v_partner_role text;v_commission_key text;v_commission_rate numeric;v_verified_total numeric;
  v_eligible_gross numeric;v_security_deposit numeric:=0;v_commission numeric;v_partner_net numeric;v_wallet record;
  v_new_pending numeric;v_payment_component text;
BEGIN
  IF NEW.status NOT IN ('paid','completed') OR OLD.status IN ('paid','completed') THEN RETURN NEW; END IF;
  IF NEW.purpose IN ('apartment_reservation','hotel_reservation') THEN RETURN NEW; END IF;
  IF NEW.purpose NOT IN ('apartment_rent','rent_plan_contribution','hotel_booking') THEN RETURN NEW; END IF;
  IF NEW.paystack_reference IS NULL THEN RAISE EXCEPTION 'Verified property payment requires a Paystack reference'; END IF;
  IF EXISTS (SELECT 1 FROM public.commission_ledger WHERE paystack_reference=NEW.paystack_reference) THEN RETURN NEW; END IF;

  -- A late Hotel payment can be verified while room fulfillment conflicts. Do
  -- not credit the property partner until the booking itself is confirmed.
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
    SELECT COALESCE(l.owner_id,l.partner_id) INTO v_partner_id FROM public.listings l
    WHERE l.id::text=NEW.listing_id OR l.listing_id=NEW.listing_id LIMIT 1;
    IF v_partner_id IS NULL THEN RAISE EXCEPTION 'Apartment payment is not linked to a Property Partner listing'; END IF;
    v_commission_key:='commission_apartment';
    v_payment_component:=COALESCE(NEW.metadata->>'payment_component',CASE WHEN NEW.purpose='rent_plan_contribution' THEN 'rent_plan_contribution' ELSE NULL END);
    IF v_payment_component IS NULL OR v_payment_component NOT IN ('long_stay_rent','short_stay_rent','rent_plan_contribution') THEN RAISE EXCEPTION 'Apartment payment must identify a supported payment component'; END IF;
    v_security_deposit:=round(COALESCE(NULLIF(NEW.metadata->>'security_deposit_amount','')::numeric,0),2);
    IF v_security_deposit<0 OR v_security_deposit>v_verified_total THEN RAISE EXCEPTION 'Invalid security deposit amount'; END IF;
    IF v_payment_component='short_stay_rent' AND NOT (NEW.metadata ? 'security_deposit_amount') THEN RAISE EXCEPTION 'Short Stay payment must store security_deposit_amount separately'; END IF;
    v_eligible_gross:=round(COALESCE(NULLIF(NEW.metadata->>'eligible_partner_amount','')::numeric,v_verified_total-v_security_deposit),2);
  ELSE
    SELECT h.owner_id INTO v_partner_id
    FROM public.hotel_bookings hb JOIN public.hotels h ON h.hotel_id=hb.hotel_id
    WHERE hb.booking_id=NEW.hotel_booking_id LIMIT 1;
    IF v_partner_id IS NULL THEN RAISE EXCEPTION 'Hotel payment is not linked to a Property Partner hotel'; END IF;
    v_commission_key:='commission_hotel';v_payment_component:='hotel_payment';v_eligible_gross:=v_verified_total;
  END IF;

  IF v_eligible_gross<=0 OR v_eligible_gross>v_verified_total THEN RAISE EXCEPTION 'Invalid eligible Property Partner amount'; END IF;
  SELECT role INTO v_partner_role FROM public.profiles
  WHERE user_id=v_partner_id AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_partner_role IS DISTINCT FROM 'property_partner' THEN RAISE EXCEPTION 'Payment owner is not an active Property Partner'; END IF;
  SELECT NULLIF(value,'')::numeric INTO v_commission_rate FROM public.platform_settings WHERE key=v_commission_key AND COALESCE(is_active,true)=true LIMIT 1;
  IF v_commission_rate IS NULL OR v_commission_rate<0 OR v_commission_rate>50 THEN RAISE EXCEPTION 'Creator commission setting is missing or invalid'; END IF;

  v_commission:=round(v_eligible_gross*v_commission_rate/100,2);v_partner_net:=round(v_eligible_gross-v_commission,2);
  INSERT INTO public.wallets(owner_id,owner_type,available_balance,pending_balance,frozen_balance,total_withdrawn)
  VALUES(v_partner_id,'property_partner',0,0,0,0) ON CONFLICT(owner_id,owner_type) DO NOTHING;
  SELECT * INTO v_wallet FROM public.wallets WHERE owner_id=v_partner_id AND owner_type='property_partner' FOR UPDATE;
  IF COALESCE(v_wallet.is_frozen,false) THEN RAISE EXCEPTION 'Property Partner wallet is frozen'; END IF;
  v_new_pending:=COALESCE(v_wallet.pending_balance,0)+v_partner_net;
  UPDATE public.wallets SET pending_balance=v_new_pending,updated_at=now() WHERE id=v_wallet.id;
  UPDATE public.booking_payments SET payee_user_id=v_partner_id,commission_rate=v_commission_rate,amount_commission=v_commission,net_amount=v_partner_net,updated_at=now() WHERE id=NEW.id;
  INSERT INTO public.commission_ledger(payment_id,booking_type,source_user_id,commission_amount,commission_rate,gross_amount,description,paystack_reference,status,created_at,updated_at)
  VALUES(NEW.id,CASE WHEN NEW.purpose='hotel_booking' THEN 'hotel' ELSE 'apartment' END,v_partner_id,v_commission,v_commission_rate,v_eligible_gross,
    format('%s commission from verified %s payment',CASE WHEN NEW.purpose='hotel_booking' THEN 'Hotel' ELSE 'Apartment' END,v_payment_component),NEW.paystack_reference,'collected',now(),now());
  INSERT INTO public.wallet_transactions(user_id,transaction_type,amount,balance_after,reference_id,reference_type,description,metadata,created_at)
  VALUES(v_partner_id,'property_earning_pending',v_partner_net,v_new_pending,NEW.id::text,'booking_payment',format('Pending net earnings from %s',replace(v_payment_component,'_',' ')),
    jsonb_build_object('paystack_reference',NEW.paystack_reference,'purpose',NEW.purpose,'gross_eligible_amount',v_eligible_gross,'security_deposit_amount',v_security_deposit,'commission_rate',v_commission_rate,'commission_amount',v_commission,'net_amount',v_partner_net,'wallet_bucket','pending'),now());
  INSERT INTO public.financial_audit_logs(event_type,user_id,target_user_id,amount,reference_id,reference_type,description,metadata)
  VALUES('commission_deducted',NEW.user_id,v_partner_id,v_partner_net,NEW.id::text,'booking_payment','Verified property payment recorded as pending partner earnings',jsonb_build_object('purpose',NEW.purpose,'commission_key',v_commission_key,'commission_amount',v_commission));
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.create_hotel_booking_payment(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_hotel_booking_payment(integer) TO authenticated;
REVOKE ALL ON FUNCTION public.expire_stale_hotel_booking_holds() FROM PUBLIC,anon,authenticated;

COMMIT;
