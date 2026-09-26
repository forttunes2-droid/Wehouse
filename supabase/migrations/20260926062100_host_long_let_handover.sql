-- Extend the existing Long Let activation to the property-specific responsible Host.
-- All rent, move-in, grace, future-rent schedule and payout rules remain the canonical implementation.

CREATE OR REPLACE FUNCTION public.activate_apartment_tenancy(p_reservation_id text, p_start_date date DEFAULT (timezone('Africa/Lagos',now()))::date) RETURNS public.reservations
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
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
  v_plan_id uuid;
  v_target_year integer;
  v_i integer;
  v_due date;
  v_base numeric;
  v_amount numeric;
  v_annual numeric;
BEGIN
  SELECT * INTO v_res FROM public.reservations WHERE id=p_reservation_id FOR UPDATE;
  IF v_res.id IS NULL THEN RAISE EXCEPTION 'Reservation not found'; END IF;
  SELECT * INTO v_listing FROM public.listings WHERE id::text=v_res.listing_id FOR UPDATE;
  IF v_listing.id IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF;
  IF COALESCE(v_listing.sub_type,'long_stay')<>'long_stay' THEN RAISE EXCEPTION 'Long-stay tenancy activation is not valid for Short Stay'; END IF;

  IF NOT public.current_actor_can_host_reservation(v_res.id) THEN
    SELECT * INTO v_actor
    FROM public.profiles
    WHERE auth_id=auth.uid()::text
      AND role IN ('staff','admin','creator')
      AND COALESCE(deleted,false)=false
      AND COALESCE(suspended,false)=false
      AND COALESCE(banned,false)=false
    LIMIT 1;
    IF v_actor.user_id IS NULL OR NOT public.user_has_active_workspace(v_actor.user_id,v_actor.role) THEN
      RAISE EXCEPTION 'Housing operations access required';
    END IF;
    IF v_actor.role='staff' AND NOT public.current_staff_has_permission('operations') THEN
      RAISE EXCEPTION 'Operations permission required';
    END IF;
    IF NOT public.current_actor_in_scope(v_listing.state,v_listing.city) THEN
      RAISE EXCEPTION 'Listing is outside your assigned State/LGA';
    END IF;
  END IF;
  IF v_res.status<>'ready_for_move_in' THEN RAISE EXCEPTION 'Inspection must pass before move-in'; END IF;
  IF v_res.manual_payment_status NOT IN ('paid','completed') OR v_res.paid_at IS NULL THEN RAISE EXCEPTION 'Reservation fee is not confirmed'; END IF;
  IF v_res.rent_payment_status NOT IN ('paid','upfront_paid') OR v_res.rent_paid_at IS NULL THEN RAISE EXCEPTION 'Year 1 rent must be verified before move-in'; END IF;

  IF NOT public.property_arrival_allowed('long_stay',null,null,v_res.requested_move_in_at,p_start_date) THEN
    RAISE EXCEPTION 'Handover must be recorded today at or after the requested move-in time (Nigeria time)';
  END IF;

  v_years:=COALESCE(v_res.rental_plan_years,1);
  IF v_years < 1 OR v_years > 5 THEN RAISE EXCEPTION 'Rental tenure must be between 1 and 5 years'; END IF;
  SELECT NULLIF(value,'')::integer INTO v_grace
  FROM public.platform_settings
  WHERE key='tenancy_grace_days' AND COALESCE(is_active,true)=true
  LIMIT 1;
  IF v_grace IS NULL OR v_grace<0 OR v_grace>30 THEN v_grace:=7; END IF;
  v_end:=(p_start_date+make_interval(years=>v_years))::date;

  UPDATE public.reservations
  SET status='occupied',tenancy_start_date=p_start_date,tenancy_end_date=v_end,
      move_out_grace_until=v_end+v_grace,occupancy_started_at=now(),updated_at=now()
  WHERE id=v_res.id
  RETURNING * INTO v_result;

  UPDATE public.listings
  SET status='occupied',availability_status='occupied',occupied_by=v_res.user_id,occupied_at=now(),tenancy_ends_at=v_end,
      reserved_by=NULL,reservation_expiry=NULL,current_reservation_id=v_res.id,updated_at=now()
  WHERE id=v_listing.id;

  UPDATE public.rent_plans
  SET tenancy_start_date=p_start_date,updated_at=now()
  WHERE reservation_id=v_res.id AND status='active';

  IF v_years>1 THEN
    SELECT id INTO v_plan_id
    FROM public.rent_plans
    WHERE reservation_id=v_res.id AND status='active'
    LIMIT 1;
    IF v_plan_id IS NULL THEN RAISE EXCEPTION 'Future-rent plan is missing'; END IF;

    v_annual:=round(COALESCE(v_res.annual_rent_snapshot,v_listing.price),2);
    v_base:=trunc(v_annual/8.0,2);

    FOR v_target_year IN 2..v_years LOOP
      FOR v_i IN 1..8 LOOP
        v_due:=(p_start_date+make_interval(years=>v_target_year-2,months=>4+v_i-1))::date;
        v_amount:=CASE WHEN v_i=8 THEN round(v_annual-(v_base*7),2) ELSE v_base END;
        INSERT INTO public.rent_plan_contributions(
          rent_plan_id,reservation_id,amount,status,target_year,installment_number,due_date,created_at,updated_at
        ) VALUES (
          v_plan_id,v_res.id,v_amount,'scheduled',v_target_year,v_i,v_due,now(),now()
        )
        ON CONFLICT (rent_plan_id,target_year,installment_number)
        DO UPDATE SET
          reservation_id=EXCLUDED.reservation_id,
          amount=CASE WHEN public.rent_plan_contributions.status IN ('paid','completed') THEN public.rent_plan_contributions.amount ELSE EXCLUDED.amount END,
          due_date=CASE WHEN public.rent_plan_contributions.status IN ('paid','completed') THEN public.rent_plan_contributions.due_date ELSE EXCLUDED.due_date END,
          updated_at=now();
      END LOOP;
    END LOOP;

    UPDATE public.rent_plans
    SET next_rent_due_date=(
          SELECT min(c.due_date) FROM public.rent_plan_contributions c
          WHERE c.rent_plan_id=v_plan_id AND c.status IN ('scheduled','payment_pending','pending')
        ),
        installment_count=8*(v_years-1),
        installment_balance=round(v_annual*(v_years-1),2),
        target_amount=round(v_annual*(v_years-1),2),
        updated_at=now()
    WHERE id=v_plan_id;
  END IF;

  SELECT id INTO v_rent_payment_id
  FROM public.booking_payments
  WHERE paystack_reference=v_res.rent_payment_reference
    AND purpose='apartment_rent'
    AND status IN ('paid','completed')
  LIMIT 1;
  IF v_rent_payment_id IS NOT NULL
     AND EXISTS(SELECT 1 FROM public.property_partner_earning_releases WHERE payment_id=v_rent_payment_id AND status='pending') THEN
    PERFORM public.release_property_partner_earning(v_rent_payment_id,'long_stay_move_in_confirmed');
  END IF;
  RETURN v_result;
END;
$$;

revoke all on function public.activate_apartment_tenancy(text,date) from public,anon;
grant execute on function public.activate_apartment_tenancy(text,date) to authenticated,service_role;
