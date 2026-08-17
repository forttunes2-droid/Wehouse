BEGIN;

-- Customer-facing reservation/booking identities are branch recognisable.
-- Paystack references remain separate internal payment identifiers.

CREATE TABLE IF NOT EXISTS public.booking_code_registry (
  code text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.booking_code_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.booking_code_registry FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.lga_booking_prefix(p_lga text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path='pg_catalog','public'
AS $$
DECLARE v_letters text;
BEGIN
  v_letters := upper(regexp_replace(COALESCE(p_lga,''), '[^A-Za-z]', '', 'g'));
  IF length(v_letters) < 3 THEN
    v_letters := rpad(v_letters, 3, 'X');
  END IF;
  IF v_letters = '' THEN v_letters := 'GEN'; END IF;
  RETURN substr(v_letters, 1, 3) || 'WH';
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_lga_booking_code(p_lga text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='pg_catalog','public'
AS $$
DECLARE
  v_prefix text := public.lga_booking_prefix(p_lga);
  v_code text;
  v_attempt integer := 0;
BEGIN
  LOOP
    v_attempt := v_attempt + 1;
    IF v_attempt > 100 THEN
      RAISE EXCEPTION 'Could not allocate a unique booking code';
    END IF;

    v_code := v_prefix || lpad(floor(random() * 100000)::integer::text, 5, '0');
    INSERT INTO public.booking_code_registry(code)
    VALUES (v_code)
    ON CONFLICT DO NOTHING;
    IF FOUND THEN RETURN v_code; END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_lga_booking_code(text) FROM PUBLIC, anon, authenticated;

-- Current production has no reservation/booking rows, but preserve any future-safe
-- pre-existing values if this migration is replayed elsewhere.
INSERT INTO public.booking_code_registry(code)
SELECT booking_code FROM public.reservations WHERE NULLIF(btrim(booking_code),'') IS NOT NULL
ON CONFLICT DO NOTHING;
INSERT INTO public.booking_code_registry(code)
SELECT booking_code FROM public.hotel_bookings WHERE NULLIF(btrim(booking_code),'') IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.set_reservation_booking_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='pg_catalog','public'
AS $$
DECLARE v_lga text;
BEGIN
  IF TG_OP='UPDATE' THEN
    NEW.booking_code := OLD.booking_code;
    RETURN NEW;
  END IF;

  IF NULLIF(btrim(COALESCE(NEW.booking_code,'')),'') IS NOT NULL THEN
    INSERT INTO public.booking_code_registry(code) VALUES (upper(btrim(NEW.booking_code))) ON CONFLICT DO NOTHING;
    NEW.booking_code := upper(btrim(NEW.booking_code));
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(btrim(l.city),''), NULLIF(btrim(l.state),''), 'General')
    INTO v_lga
  FROM public.listings l
  WHERE l.id::text=NEW.listing_id OR l.listing_id=NEW.listing_id
  LIMIT 1;

  NEW.booking_code := public.reserve_lga_booking_code(COALESCE(v_lga,'General'));
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
DECLARE v_lga text;
BEGIN
  IF TG_OP='UPDATE' THEN
    NEW.booking_code := OLD.booking_code;
    RETURN NEW;
  END IF;

  IF NULLIF(btrim(COALESCE(NEW.booking_code,'')),'') IS NOT NULL THEN
    INSERT INTO public.booking_code_registry(code) VALUES (upper(btrim(NEW.booking_code))) ON CONFLICT DO NOTHING;
    NEW.booking_code := upper(btrim(NEW.booking_code));
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(btrim(h.city),''), NULLIF(btrim(h.state),''), 'General')
    INTO v_lga
  FROM public.hotels h
  WHERE h.hotel_id=NEW.hotel_id
  LIMIT 1;

  NEW.booking_code := public.reserve_lga_booking_code(COALESCE(v_lga,'General'));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_hotel_booking_code_trigger ON public.hotel_bookings;
CREATE TRIGGER set_hotel_booking_code_trigger
BEFORE INSERT OR UPDATE OF booking_code ON public.hotel_bookings
FOR EACH ROW EXECUTE FUNCTION public.set_hotel_booking_code();

CREATE UNIQUE INDEX IF NOT EXISTS reservations_booking_code_unique
ON public.reservations(booking_code) WHERE booking_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS hotel_bookings_booking_code_unique
ON public.hotel_bookings(booking_code) WHERE booking_code IS NOT NULL;

CREATE OR REPLACE FUNCTION public.verify_branch_booking_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='pg_catalog','public'
AS $$
DECLARE
  v_actor public.profiles;
  v_code text := upper(btrim(COALESCE(p_code,'')));
  v_result jsonb;
  v_state text;
  v_lga text;
BEGIN
  IF v_code !~ '^[A-Z]{3}WH[0-9]{5}$' THEN
    RAISE EXCEPTION 'Enter a valid WeHouse booking code';
  END IF;

  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND role IN ('staff','admin','creator')
    AND NOT COALESCE(deleted,false)
    AND NOT COALESCE(suspended,false)
    AND NOT COALESCE(banned,false)
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Operations access required'; END IF;
  IF v_actor.role='staff' AND NOT public.current_staff_has_permission('operations') THEN
    RAISE EXCEPTION 'Operations module required';
  END IF;

  SELECT jsonb_build_object(
      'kind','housing','code',r.booking_code,'status',r.status,
      'payment_status',r.manual_payment_status,'customer_name',COALESCE(p.full_name,p.username,r.user_email),
      'customer_phone',COALESCE(p.phone,r.user_phone),'property_name',COALESCE(l.title,r.listing_title),
      'state',l.state,'lga',l.city,'reservation_id',r.id,'listing_id',r.listing_id,
      'tenancy_start_date',r.tenancy_start_date,'tenancy_end_date',r.tenancy_end_date
    ), l.state, l.city
  INTO v_result,v_state,v_lga
  FROM public.reservations r
  JOIN public.listings l ON l.id::text=r.listing_id OR l.listing_id=r.listing_id
  LEFT JOIN public.profiles p ON p.user_id=r.user_id
  WHERE r.booking_code=v_code
  LIMIT 1;

  IF v_result IS NULL THEN
    SELECT jsonb_build_object(
        'kind','hotel','code',hb.booking_code,'status',hb.status,
        'payment_status',hb.payment_status,'customer_name',COALESCE(p.full_name,p.username,hb.guest_name),
        'customer_phone',COALESCE(p.phone,hb.guest_phone),'property_name',h.name,
        'state',h.state,'lga',h.city,'booking_id',hb.booking_id,'hotel_id',hb.hotel_id,
        'check_in',hb.check_in,'check_out',hb.check_out,'guest_count',hb.guest_count
      ), h.state, h.city
    INTO v_result,v_state,v_lga
    FROM public.hotel_bookings hb
    JOIN public.hotels h ON h.hotel_id=hb.hotel_id
    LEFT JOIN public.profiles p ON p.user_id=hb.user_id
    WHERE hb.booking_code=v_code
    LIMIT 1;
  END IF;

  IF v_result IS NULL THEN RETURN NULL; END IF;

  IF v_actor.role<>'creator' THEN
    IF lower(btrim(COALESCE(v_actor.assigned_state,v_actor.state,''))) <> lower(btrim(COALESCE(v_state,'')))
       OR lower(btrim(COALESCE(v_actor.assigned_lga,v_actor.local_government,v_actor.city,''))) <> lower(btrim(COALESCE(v_lga,''))) THEN
      RAISE EXCEPTION 'This booking belongs to another WeHouse branch';
    END IF;
  END IF;

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.verify_branch_booking_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_branch_booking_code(text) TO authenticated;

COMMIT;
