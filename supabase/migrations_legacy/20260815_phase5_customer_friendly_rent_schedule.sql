BEGIN;

-- Phase 5 refinement: long-stay customers pay Year 1 in full. For each
-- additional contract year, the next year's rent is built through eight
-- monthly contributions beginning four months after the start of the
-- preceding rental year. No customer finances every future year at once.

ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_installment_count_check;
ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_installment_count_check
  CHECK (installment_count BETWEEN 0 AND 64);

ALTER TABLE public.rent_plan_contributions
  ADD COLUMN IF NOT EXISTS reservation_id text,
  ADD COLUMN IF NOT EXISTS target_year integer,
  ADD COLUMN IF NOT EXISTS installment_number integer,
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='rent_plan_contributions_reservation_id_fkey') THEN
    ALTER TABLE public.rent_plan_contributions
      ADD CONSTRAINT rent_plan_contributions_reservation_id_fkey
      FOREIGN KEY (reservation_id) REFERENCES public.reservations(id) ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE public.rent_plan_contributions DROP CONSTRAINT IF EXISTS rent_plan_contributions_status_check;
ALTER TABLE public.rent_plan_contributions
  ADD CONSTRAINT rent_plan_contributions_status_check
  CHECK (status = ANY (ARRAY['scheduled','payment_pending','paid','pending','completed','failed','reversed','waived']::text[]));
ALTER TABLE public.rent_plan_contributions ALTER COLUMN status SET DEFAULT 'scheduled';

ALTER TABLE public.rent_plan_contributions DROP CONSTRAINT IF EXISTS rent_plan_contributions_target_year_check;
ALTER TABLE public.rent_plan_contributions
  ADD CONSTRAINT rent_plan_contributions_target_year_check
  CHECK (target_year IS NULL OR target_year BETWEEN 2 AND 20);

ALTER TABLE public.rent_plan_contributions DROP CONSTRAINT IF EXISTS rent_plan_contributions_installment_number_check;
ALTER TABLE public.rent_plan_contributions
  ADD CONSTRAINT rent_plan_contributions_installment_number_check
  CHECK (installment_number IS NULL OR installment_number BETWEEN 1 AND 8);

CREATE UNIQUE INDEX IF NOT EXISTS rent_plan_contributions_schedule_unique
ON public.rent_plan_contributions(rent_plan_id,target_year,installment_number)
WHERE target_year IS NOT NULL AND installment_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS rent_plan_contributions_paystack_reference_unique
ON public.rent_plan_contributions(paystack_reference)
WHERE paystack_reference IS NOT NULL;

DROP POLICY IF EXISTS users_own_contributions ON public.rent_plan_contributions;
DROP POLICY IF EXISTS rent_plan_contributions_read_canonical ON public.rent_plan_contributions;
CREATE POLICY rent_plan_contributions_read_canonical
ON public.rent_plan_contributions
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.rent_plans rp
    WHERE rp.id=rent_plan_contributions.rent_plan_id
      AND (
        rp.user_id=public.current_profile_user_id()
        OR (
          public.current_profile_role() = ANY (ARRAY['staff','admin','creator']::text[])
          AND public.current_actor_can_access_listing_ref(rp.listing_id::text)
        )
      )
  )
);

CREATE OR REPLACE FUNCTION public.update_my_reservation_plan(p_reservation_id text,p_plan_years integer)
RETURNS public.reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='pg_catalog','public'
AS $$
DECLARE
  v_user_id text;
  v_res public.reservations;
  v_listing public.listings;
  v_annual numeric;
  v_total numeric;
  v_upfront numeric;
  v_balance numeric;
  v_count integer;
BEGIN
  SELECT user_id INTO v_user_id
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_plan_years NOT IN (1,2,3) THEN RAISE EXCEPTION 'Choose a supported 1, 2 or 3 year tenure'; END IF;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE id=p_reservation_id
    AND user_id=v_user_id
    AND status = ANY (ARRAY['payment_pending','reserved','inspection_pending','ready_for_move_in']::text[])
  FOR UPDATE;
  IF v_res IS NULL THEN RAISE EXCEPTION 'Active reservation not found'; END IF;
  IF v_res.rent_payment_status NOT IN ('not_started','payment_pending') THEN
    RAISE EXCEPTION 'Tenure cannot change after Year 1 rent has been paid';
  END IF;
  IF v_res.rent_payment_status='payment_pending' AND EXISTS (
    SELECT 1 FROM public.booking_payments bp
    WHERE bp.paystack_reference=v_res.rent_payment_reference AND bp.status='pending'
  ) THEN
    RAISE EXCEPTION 'Complete the current rent checkout before changing tenure';
  END IF;

  SELECT * INTO v_listing
  FROM public.listings
  WHERE id::text=v_res.listing_id
  FOR SHARE;
  IF v_listing IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF;
  IF COALESCE(v_listing.sub_type,'long_stay')<>'long_stay' THEN
    RAISE EXCEPTION 'Yearly tenure plans apply to Long Stay apartments only';
  END IF;
  IF COALESCE(v_listing.price,0)<=0 THEN RAISE EXCEPTION 'Listing rent is invalid'; END IF;

  v_annual:=round(v_listing.price,2);
  v_total:=round(v_annual*p_plan_years,2);
  v_upfront:=v_annual;
  v_balance:=round(v_annual*GREATEST(p_plan_years-1,0),2);
  v_count:=8*GREATEST(p_plan_years-1,0);

  UPDATE public.reservations
  SET rental_plan_years=p_plan_years,
      rental_plan_selected_at=now(),
      annual_rent_snapshot=v_annual,
      contract_rent_total=v_total,
      upfront_rent_required=v_upfront,
      installment_balance=v_balance,
      installment_count=v_count,
      rent_payment_status='not_started',
      rent_payment_reference=NULL,
      updated_at=now()
  WHERE id=v_res.id
  RETURNING * INTO v_res;
  RETURN v_res;
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
  v_annual numeric;
  v_total numeric;
  v_upfront numeric;
  v_balance numeric;
  v_count integer;
  v_years integer;
BEGIN
  SELECT user_id INTO v_user_id
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE id=p_reservation_id AND user_id=v_user_id
  FOR UPDATE;
  IF v_res.id IS NULL THEN RAISE EXCEPTION 'Reservation not found'; END IF;
  IF v_res.status<>'ready_for_move_in' THEN RAISE EXCEPTION 'Year 1 rent becomes payable after the inspection passes'; END IF;
  IF v_res.manual_payment_status NOT IN ('paid','completed') OR v_res.paid_at IS NULL THEN
    RAISE EXCEPTION 'Reservation fee must be confirmed first';
  END IF;
  IF v_res.rent_payment_status IN ('paid','upfront_paid') THEN
    RETURN jsonb_build_object('success',true,'already_paid',true,'status',v_res.rent_payment_status);
  END IF;

  SELECT * INTO v_listing
  FROM public.listings
  WHERE id::text=v_res.listing_id
  FOR SHARE;
  IF v_listing.id IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF;
  IF COALESCE(v_listing.sub_type,'long_stay')<>'long_stay' THEN
    RAISE EXCEPTION 'Short Stay uses a date-based stay payment workflow';
  END IF;

  v_years:=COALESCE(v_res.rental_plan_years,1);
  IF v_years NOT IN (1,2,3) THEN RAISE EXCEPTION 'Reservation tenure is invalid'; END IF;
  v_annual:=round(COALESCE(v_res.annual_rent_snapshot,v_listing.price),2);
  IF v_annual<=0 THEN RAISE EXCEPTION 'Required Year 1 rent is invalid'; END IF;
  v_total:=round(v_annual*v_years,2);
  v_upfront:=v_annual;
  v_balance:=round(v_annual*GREATEST(v_years-1,0),2);
  v_count:=8*GREATEST(v_years-1,0);

  SELECT * INTO v_pending
  FROM public.booking_payments
  WHERE user_id=v_user_id
    AND purpose='apartment_rent'
    AND status='pending'
    AND metadata->>'reservation_id'=v_res.id
    AND round(COALESCE(amount_total,amount),2)=round(v_upfront,2)
  ORDER BY created_at DESC
  LIMIT 1;
  IF v_pending.id IS NOT NULL THEN
    UPDATE public.reservations
    SET rent_payment_status='payment_pending',rent_payment_reference=v_pending.paystack_reference,updated_at=now()
    WHERE id=v_res.id;
    RETURN jsonb_build_object('success',true,'reference',v_pending.paystack_reference,'amount',COALESCE(v_pending.amount_total,v_pending.amount),'existing',true);
  END IF;

  v_reference:='WHRENT-'||upper(replace(gen_random_uuid()::text,'-',''));
  INSERT INTO public.booking_payments(
    payment_reference,user_id,payer_user_id,type,booking_type,listing_id,amount,amount_total,currency,status,
    purpose,payment_method,paystack_reference,metadata,created_at,updated_at
  ) VALUES (
    v_reference,v_user_id,v_user_id,'apartment','apartment',v_listing.id::text,v_upfront,v_upfront,'NGN','pending',
    'apartment_rent','paystack',v_reference,
    jsonb_build_object(
      'reservation_id',v_res.id,
      'listing_id',v_listing.id::text,
      'tenure_years',v_years,
      'total_contract_rent',v_total,
      'year_one_upfront',v_upfront,
      'future_rent_balance',v_balance,
      'contribution_count',v_count,
      'contribution_months_per_year',8,
      'start_after_months',4,
      'payment_component','long_stay_rent',
      'security_deposit_amount',0,
      'eligible_partner_amount',v_upfront
    ),
    now(),now()
  );

  UPDATE public.reservations
  SET annual_rent_snapshot=v_annual,
      contract_rent_total=v_total,
      upfront_rent_required=v_upfront,
      installment_balance=v_balance,
      installment_count=v_count,
      rent_payment_status='payment_pending',
      rent_payment_reference=v_reference,
      updated_at=now()
  WHERE id=v_res.id;

  RETURN jsonb_build_object('success',true,'reference',v_reference,'amount',v_upfront,'existing',false);
END;
$$;

CREATE OR REPLACE FUNCTION public.fulfill_apartment_rent_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='pg_catalog','public'
AS $$
DECLARE
  v_res public.reservations;
  v_start_months integer:=4;
  v_installment_amount numeric;
  v_upfront_percent numeric;
BEGIN
  IF NEW.purpose<>'apartment_rent' OR NEW.status NOT IN ('paid','completed') THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.status IN ('paid','completed') THEN RETURN NEW; END IF;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE id=NEW.metadata->>'reservation_id'
    AND user_id=COALESCE(NEW.payer_user_id,NEW.user_id)
  FOR UPDATE;
  IF v_res IS NULL THEN RAISE EXCEPTION 'Apartment rent payment has no matching reservation'; END IF;
  IF v_res.status<>'ready_for_move_in' THEN RAISE EXCEPTION 'Reservation is not ready for rent settlement'; END IF;
  IF v_res.rent_payment_reference IS DISTINCT FROM NEW.paystack_reference THEN RAISE EXCEPTION 'Rent payment reference mismatch'; END IF;
  IF round(COALESCE(NEW.amount_total,NEW.amount),2)<>round(COALESCE(v_res.annual_rent_snapshot,v_res.upfront_rent_required,0),2) THEN
    RAISE EXCEPTION 'Year 1 rent payment amount mismatch';
  END IF;

  UPDATE public.reservations
  SET rent_payment_status=CASE WHEN installment_balance>0 THEN 'upfront_paid' ELSE 'paid' END,
      rent_paid_at=COALESCE(rent_paid_at,now()),
      updated_at=now()
  WHERE id=v_res.id;

  IF COALESCE(v_res.installment_balance,0)>0 THEN
    SELECT COALESCE(NULLIF(value,'')::integer,4) INTO v_start_months
    FROM public.platform_settings
    WHERE key='rent_plan_start_after_months' AND COALESCE(is_active,true)=true
    LIMIT 1;
    IF v_start_months IS NULL OR v_start_months<>4 THEN v_start_months:=4; END IF;
    v_installment_amount:=round(COALESCE(v_res.annual_rent_snapshot,0)/8.0,2);
    v_upfront_percent:=round(100.0/GREATEST(COALESCE(v_res.rental_plan_years,1),1),2);

    INSERT INTO public.rent_plans(
      user_id,listing_id,reservation_id,target_amount,start_after_months,cancellation_fee_percent,accepted_terms,status,
      total_contract_rent,upfront_percent,upfront_amount,installment_count,installment_amount,installment_balance,paid_installments,
      created_at,updated_at
    ) VALUES (
      v_res.user_id,v_res.listing_id::uuid,v_res.id,v_res.installment_balance,v_start_months,
      COALESCE((SELECT NULLIF(value,'')::numeric FROM public.platform_settings WHERE key='rent_plan_cancellation_fee_percent' LIMIT 1),10),
      jsonb_build_object(
        'tenure_years',v_res.rental_plan_years,
        'annual_rent',v_res.annual_rent_snapshot,
        'year_one_paid_in_full',true,
        'year_one_upfront',v_res.upfront_rent_required,
        'future_rent_balance',v_res.installment_balance,
        'start_after_months',4,
        'contributions_per_future_year',8,
        'future_years',GREATEST(COALESCE(v_res.rental_plan_years,1)-1,0),
        'snapshot_at',now()
      )::text,
      'active',v_res.contract_rent_total,v_upfront_percent,v_res.upfront_rent_required,v_res.installment_count,
      v_installment_amount,v_res.installment_balance,0,now(),now()
    )
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
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
  v_plan_id uuid;
  v_target_year integer;
  v_i integer;
  v_due date;
  v_base numeric;
  v_amount numeric;
  v_annual numeric;
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND role IN ('staff','admin','creator')
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
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
  IF v_res.rent_payment_status NOT IN ('paid','upfront_paid') OR v_res.rent_paid_at IS NULL THEN RAISE EXCEPTION 'Year 1 rent must be verified before move-in'; END IF;

  v_years:=COALESCE(v_res.rental_plan_years,1);
  IF v_years NOT IN (1,2,3) THEN RAISE EXCEPTION 'Invalid rental tenure'; END IF;
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

CREATE OR REPLACE FUNCTION public.create_rent_plan_contribution_payment(p_contribution_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='pg_catalog','public'
AS $$
DECLARE
  v_user_id text;
  v_contribution public.rent_plan_contributions;
  v_plan public.rent_plans;
  v_res public.reservations;
  v_reference text;
  v_pending public.booking_payments;
BEGIN
  SELECT user_id INTO v_user_id
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_contribution
  FROM public.rent_plan_contributions
  WHERE id=p_contribution_id
  FOR UPDATE;
  IF v_contribution.id IS NULL THEN RAISE EXCEPTION 'Rent contribution not found'; END IF;

  SELECT * INTO v_plan
  FROM public.rent_plans
  WHERE id=v_contribution.rent_plan_id AND user_id=v_user_id
  FOR UPDATE;
  IF v_plan.id IS NULL THEN RAISE EXCEPTION 'Rent plan not found'; END IF;
  IF v_plan.status<>'active' THEN RAISE EXCEPTION 'Rent plan is not active'; END IF;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE id=v_plan.reservation_id AND user_id=v_user_id
  FOR SHARE;
  IF v_res.id IS NULL OR v_res.status<>'occupied' THEN RAISE EXCEPTION 'Active tenancy required'; END IF;

  IF v_contribution.status IN ('paid','completed') THEN
    RETURN jsonb_build_object('success',true,'already_paid',true,'contribution_id',v_contribution.id);
  END IF;
  IF v_contribution.status NOT IN ('scheduled','payment_pending','pending') THEN
    RAISE EXCEPTION 'This contribution cannot be paid';
  END IF;
  IF COALESCE(v_contribution.amount,0)<=0 THEN RAISE EXCEPTION 'Contribution amount is invalid'; END IF;

  SELECT * INTO v_pending
  FROM public.booking_payments
  WHERE user_id=v_user_id
    AND purpose='rent_plan_contribution'
    AND status='pending'
    AND metadata->>'contribution_id'=v_contribution.id::text
    AND round(COALESCE(amount_total,amount),2)=round(v_contribution.amount,2)
  ORDER BY created_at DESC
  LIMIT 1;
  IF v_pending.id IS NOT NULL THEN
    UPDATE public.rent_plan_contributions
    SET status='payment_pending',payment_reference=v_pending.payment_reference,paystack_reference=v_pending.paystack_reference,updated_at=now()
    WHERE id=v_contribution.id;
    RETURN jsonb_build_object('success',true,'reference',v_pending.paystack_reference,'amount',COALESCE(v_pending.amount_total,v_pending.amount),'existing',true);
  END IF;

  v_reference:='WHNEXT-'||upper(replace(gen_random_uuid()::text,'-',''));
  INSERT INTO public.booking_payments(
    payment_reference,user_id,payer_user_id,type,booking_type,listing_id,amount,amount_total,currency,status,
    purpose,payment_method,paystack_reference,metadata,created_at,updated_at
  ) VALUES (
    v_reference,v_user_id,v_user_id,'apartment','apartment',v_plan.listing_id::text,v_contribution.amount,v_contribution.amount,'NGN','pending',
    'rent_plan_contribution','paystack',v_reference,
    jsonb_build_object(
      'reservation_id',v_res.id,
      'listing_id',v_plan.listing_id::text,
      'rent_plan_id',v_plan.id::text,
      'contribution_id',v_contribution.id::text,
      'target_year',v_contribution.target_year,
      'installment_number',v_contribution.installment_number,
      'due_date',v_contribution.due_date,
      'payment_component','rent_plan_contribution',
      'security_deposit_amount',0,
      'eligible_partner_amount',v_contribution.amount
    ),
    now(),now()
  );

  UPDATE public.rent_plan_contributions
  SET status='payment_pending',payment_reference=v_reference,paystack_reference=v_reference,updated_at=now()
  WHERE id=v_contribution.id;

  RETURN jsonb_build_object('success',true,'reference',v_reference,'amount',v_contribution.amount,'existing',false);
END;
$$;

CREATE OR REPLACE FUNCTION public.fulfill_rent_plan_contribution_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='pg_catalog','public'
AS $$
DECLARE
  v_contribution public.rent_plan_contributions;
  v_plan public.rent_plans;
  v_paid_total numeric;
  v_paid_count integer;
  v_remaining integer;
  v_next_due date;
BEGIN
  IF NEW.purpose<>'rent_plan_contribution' OR NEW.status NOT IN ('paid','completed') THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.status IN ('paid','completed') THEN RETURN NEW; END IF;

  SELECT * INTO v_contribution
  FROM public.rent_plan_contributions
  WHERE id=(NEW.metadata->>'contribution_id')::uuid
  FOR UPDATE;
  IF v_contribution.id IS NULL THEN RAISE EXCEPTION 'Rent contribution payment has no schedule row'; END IF;
  IF v_contribution.paystack_reference IS DISTINCT FROM NEW.paystack_reference THEN RAISE EXCEPTION 'Rent contribution reference mismatch'; END IF;
  IF round(v_contribution.amount,2)<>round(COALESCE(NEW.amount_total,NEW.amount),2) THEN RAISE EXCEPTION 'Rent contribution amount mismatch'; END IF;

  UPDATE public.rent_plan_contributions
  SET status='paid',paid_at=COALESCE(paid_at,now()),completed_at=COALESCE(completed_at,now()),updated_at=now()
  WHERE id=v_contribution.id;

  SELECT * INTO v_plan
  FROM public.rent_plans
  WHERE id=v_contribution.rent_plan_id
  FOR UPDATE;
  IF v_plan.id IS NULL THEN RAISE EXCEPTION 'Rent plan not found'; END IF;

  SELECT COALESCE(sum(amount),0),count(*)::integer
  INTO v_paid_total,v_paid_count
  FROM public.rent_plan_contributions
  WHERE rent_plan_id=v_plan.id AND status IN ('paid','completed');

  SELECT count(*)::integer,min(due_date)
  INTO v_remaining,v_next_due
  FROM public.rent_plan_contributions
  WHERE rent_plan_id=v_plan.id AND status IN ('scheduled','payment_pending','pending');

  UPDATE public.rent_plans
  SET total_contributed=v_paid_total,
      paid_installments=v_paid_count,
      installment_balance=GREATEST(COALESCE(target_amount,0)-v_paid_total,0),
      last_contribution_at=now(),
      next_rent_due_date=v_next_due,
      status=CASE WHEN v_remaining=0 THEN 'completed' ELSE 'active' END,
      updated_at=now()
  WHERE id=v_plan.id;

  IF v_remaining=0 THEN
    UPDATE public.reservations
    SET rent_payment_status='paid',updated_at=now()
    WHERE id=v_plan.reservation_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fulfill_rent_plan_contribution_payment_trigger ON public.booking_payments;
CREATE TRIGGER fulfill_rent_plan_contribution_payment_trigger
AFTER UPDATE OF status ON public.booking_payments
FOR EACH ROW
WHEN (NEW.purpose='rent_plan_contribution' AND NEW.status = ANY (ARRAY['paid','completed']::text[]))
EXECUTE FUNCTION public.fulfill_rent_plan_contribution_payment();

REVOKE ALL ON FUNCTION public.create_rent_plan_contribution_payment(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_rent_plan_contribution_payment(uuid) TO authenticated;

COMMIT;
