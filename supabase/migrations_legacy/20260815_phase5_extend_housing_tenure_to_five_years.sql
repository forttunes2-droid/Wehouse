BEGIN;

-- Housing offers a practical initial contract range of 1–5 years. Year 1 is
-- paid in full; every future year is funded through the same eight-payment
-- months-5-to-12 cycle in the preceding rental year.
DO $$
DECLARE
  v_sql text;
  v_next text;
BEGIN
  SELECT pg_get_functiondef('public.update_my_reservation_plan(text,integer)'::regprocedure)
  INTO v_sql;
  v_next:=replace(
    v_sql,
    'IF p_plan_years NOT IN (1,2,3) THEN RAISE EXCEPTION ''Choose a supported 1, 2 or 3 year tenure''; END IF;',
    'IF p_plan_years < 1 OR p_plan_years > 5 THEN RAISE EXCEPTION ''Choose a supported 1 to 5 year tenure''; END IF;'
  );
  IF v_next=v_sql THEN RAISE EXCEPTION 'Could not update Housing plan tenure guard'; END IF;
  EXECUTE v_next;

  SELECT pg_get_functiondef('public.create_apartment_rent_payment(text)'::regprocedure)
  INTO v_sql;
  v_next:=replace(
    v_sql,
    'IF v_years NOT IN (1,2,3) THEN RAISE EXCEPTION ''Reservation tenure is invalid''; END IF;',
    'IF v_years < 1 OR v_years > 5 THEN RAISE EXCEPTION ''Reservation tenure must be between 1 and 5 years''; END IF;'
  );
  IF v_next=v_sql THEN RAISE EXCEPTION 'Could not update Year 1 rent tenure guard'; END IF;
  EXECUTE v_next;

  SELECT pg_get_functiondef('public.activate_apartment_tenancy(text,date)'::regprocedure)
  INTO v_sql;
  v_next:=replace(
    v_sql,
    'IF v_years NOT IN (1,2,3) THEN RAISE EXCEPTION ''Invalid rental tenure''; END IF;',
    'IF v_years < 1 OR v_years > 5 THEN RAISE EXCEPTION ''Rental tenure must be between 1 and 5 years''; END IF;'
  );
  IF v_next=v_sql THEN RAISE EXCEPTION 'Could not update tenancy activation tenure guard'; END IF;
  EXECUTE v_next;
END;
$$;

COMMIT;
