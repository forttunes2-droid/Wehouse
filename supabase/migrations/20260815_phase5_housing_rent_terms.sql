BEGIN;

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS annual_rent_snapshot numeric,
  ADD COLUMN IF NOT EXISTS contract_rent_total numeric,
  ADD COLUMN IF NOT EXISTS upfront_rent_required numeric,
  ADD COLUMN IF NOT EXISTS installment_balance numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS installment_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rent_payment_status text NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS rent_payment_reference text,
  ADD COLUMN IF NOT EXISTS rent_paid_at timestamptz;

ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_rent_payment_status_check;
ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_rent_payment_status_check
  CHECK (rent_payment_status = ANY (ARRAY['not_started','payment_pending','upfront_paid','paid','refunded']::text[]));

ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_installment_count_check;
ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_installment_count_check CHECK (installment_count BETWEEN 0 AND 4);

ALTER TABLE public.rent_plans
  ADD COLUMN IF NOT EXISTS reservation_id text,
  ADD COLUMN IF NOT EXISTS total_contract_rent numeric,
  ADD COLUMN IF NOT EXISTS upfront_percent numeric,
  ADD COLUMN IF NOT EXISTS upfront_amount numeric,
  ADD COLUMN IF NOT EXISTS installment_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS installment_amount numeric,
  ADD COLUMN IF NOT EXISTS installment_balance numeric,
  ADD COLUMN IF NOT EXISTS paid_installments integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='rent_plans_reservation_id_fkey') THEN
    ALTER TABLE public.rent_plans
      ADD CONSTRAINT rent_plans_reservation_id_fkey
      FOREIGN KEY (reservation_id) REFERENCES public.reservations(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS rent_plans_one_per_reservation
ON public.rent_plans(reservation_id)
WHERE reservation_id IS NOT NULL AND status <> 'cancelled';

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
  v_total numeric;
  v_upfront numeric;
  v_balance numeric;
  v_count integer;
BEGIN
  SELECT user_id INTO v_user_id FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_plan_years NOT IN (1,2,3) THEN RAISE EXCEPTION 'Choose a supported 1, 2 or 3 year tenure'; END IF;

  SELECT * INTO v_res FROM public.reservations
  WHERE id=p_reservation_id AND user_id=v_user_id
    AND status = ANY (ARRAY['payment_pending','reserved','inspection_pending','ready_for_move_in']::text[])
  FOR UPDATE;
  IF v_res IS NULL THEN RAISE EXCEPTION 'Active reservation not found'; END IF;
  IF v_res.rent_payment_status NOT IN ('not_started','payment_pending') THEN
    RAISE EXCEPTION 'Tenure cannot change after contract rent has been paid';
  END IF;
  IF v_res.rent_payment_status='payment_pending' AND EXISTS (
    SELECT 1 FROM public.booking_payments bp
    WHERE bp.paystack_reference=v_res.rent_payment_reference AND bp.status='pending'
  ) THEN
    RAISE EXCEPTION 'Cancel or complete the current rent checkout before changing tenure';
  END IF;

  SELECT * INTO v_listing FROM public.listings WHERE id::text=v_res.listing_id FOR SHARE;
  IF v_listing IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF;
  IF COALESCE(v_listing.price,0)<=0 THEN RAISE EXCEPTION 'Listing rent is invalid'; END IF;

  v_total:=round(v_listing.price * p_plan_years,2);
  IF p_plan_years<=2 THEN
    v_upfront:=v_total;
    v_balance:=0;
    v_count:=0;
  ELSE
    v_upfront:=round(v_total * 0.68,2);
    v_balance:=v_total-v_upfront;
    v_count:=4;
  END IF;

  UPDATE public.reservations
  SET rental_plan_years=p_plan_years,
      rental_plan_selected_at=now(),
      annual_rent_snapshot=v_listing.price,
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
  IF v_res IS NULL THEN RAISE EXCEPTION 'Reservation not found'; END IF;
  IF v_res.status<>'ready_for_move_in' THEN RAISE EXCEPTION 'Contract rent becomes payable after the inspection passes'; END IF;
  IF v_res.manual_payment_status NOT IN ('paid','completed') OR v_res.paid_at IS NULL THEN
    RAISE EXCEPTION 'Reservation fee must be confirmed first';
  END IF;
  IF v_res.rent_payment_status IN ('paid','upfront_paid') THEN
    RETURN jsonb_build_object('success',true,'already_paid',true,'status',v_res.rent_payment_status);
  END IF;

  SELECT * INTO v_listing FROM public.listings WHERE id::text=v_res.listing_id FOR SHARE;
  IF v_listing IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF;
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
  IF v_pending IS NOT NULL THEN
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

CREATE OR REPLACE FUNCTION public.fulfill_apartment_rent_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='pg_catalog','public'
AS $$
DECLARE
  v_res public.reservations;
  v_start_months integer;
  v_installment_amount numeric;
BEGIN
  IF NEW.purpose<>'apartment_rent' OR NEW.status NOT IN ('paid','completed') THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.status IN ('paid','completed') THEN RETURN NEW; END IF;

  SELECT * INTO v_res FROM public.reservations
  WHERE id=NEW.metadata->>'reservation_id'
    AND user_id=COALESCE(NEW.payer_user_id,NEW.user_id)
  FOR UPDATE;
  IF v_res IS NULL THEN RAISE EXCEPTION 'Apartment rent payment has no matching reservation'; END IF;
  IF v_res.status<>'ready_for_move_in' THEN RAISE EXCEPTION 'Reservation is not ready for rent settlement'; END IF;
  IF v_res.rent_payment_reference IS DISTINCT FROM NEW.paystack_reference THEN RAISE EXCEPTION 'Rent payment reference mismatch'; END IF;
  IF round(COALESCE(NEW.amount_total,NEW.amount),2) <> round(COALESCE(v_res.upfront_rent_required,0),2) THEN
    RAISE EXCEPTION 'Rent payment amount mismatch';
  END IF;

  UPDATE public.reservations
  SET rent_payment_status=CASE WHEN installment_balance>0 THEN 'upfront_paid' ELSE 'paid' END,
      rent_paid_at=COALESCE(rent_paid_at,now()),updated_at=now()
  WHERE id=v_res.id;

  IF COALESCE(v_res.installment_balance,0)>0 THEN
    SELECT COALESCE(NULLIF(value,'')::integer,4) INTO v_start_months
    FROM public.platform_settings WHERE key='rent_plan_start_after_months' LIMIT 1;
    IF v_start_months IS NULL OR v_start_months<0 OR v_start_months>24 THEN v_start_months:=4; END IF;
    v_installment_amount:=round(v_res.installment_balance / GREATEST(v_res.installment_count,1),2);

    INSERT INTO public.rent_plans(
      user_id,listing_id,reservation_id,target_amount,start_after_months,cancellation_fee_percent,accepted_terms,status,
      total_contract_rent,upfront_percent,upfront_amount,installment_count,installment_amount,installment_balance,paid_installments,
      created_at,updated_at
    )
    SELECT
      v_res.user_id,v_res.listing_id::uuid,v_res.id,v_res.installment_balance,v_start_months,
      COALESCE((SELECT NULLIF(value,'')::numeric FROM public.platform_settings WHERE key='rent_plan_cancellation_fee_percent' LIMIT 1),10),
      jsonb_build_object('tenure_years',v_res.rental_plan_years,'total_contract_rent',v_res.contract_rent_total,'upfront_percent',68,'upfront_amount',v_res.upfront_rent_required,'installment_count',v_res.installment_count,'balance',v_res.installment_balance,'snapshot_at',now())::text,
      'active',v_res.contract_rent_total,68,v_res.upfront_rent_required,v_res.installment_count,v_installment_amount,v_res.installment_balance,0,
      now(),now()
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fulfill_apartment_rent_payment_trigger ON public.booking_payments;
CREATE TRIGGER fulfill_apartment_rent_payment_trigger
AFTER UPDATE OF status ON public.booking_payments
FOR EACH ROW
WHEN (NEW.purpose='apartment_rent' AND NEW.status = ANY (ARRAY['paid','completed']::text[]))
EXECUTE FUNCTION public.fulfill_apartment_rent_payment();

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
  IF v_res.status<>'ready_for_move_in' THEN RAISE EXCEPTION 'Inspection must pass before move-in'; END IF;
  IF v_res.manual_payment_status NOT IN ('paid','completed') OR v_res.paid_at IS NULL THEN RAISE EXCEPTION 'Reservation fee is not confirmed'; END IF;
  IF v_res.rent_payment_status NOT IN ('paid','upfront_paid') OR v_res.rent_paid_at IS NULL THEN RAISE EXCEPTION 'Required contract rent must be verified before move-in'; END IF;

  v_years:=COALESCE(v_res.rental_plan_years,1);
  IF v_years NOT IN (1,2,3) THEN RAISE EXCEPTION 'Invalid rental tenure'; END IF;
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
  UPDATE public.rent_plans
  SET tenancy_start_date=p_start_date,
      next_rent_due_date=CASE WHEN status='active' THEN (p_start_date + make_interval(months=>start_after_months))::date ELSE next_rent_due_date END,
      updated_at=now()
  WHERE reservation_id=v_res.id AND status='active';
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.create_apartment_rent_payment(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_apartment_rent_payment(text) TO authenticated;

COMMIT;
