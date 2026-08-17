-- Phase 7: protect Worker bookings when Paystack verified a charge but
-- booking finalization could not complete. Keep the booking/payment visible
-- for WeHouse review and prevent a second customer charge.

CREATE OR REPLACE FUNCTION public.create_worker_booking_payment(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  customer public.profiles;
  b public.worker_bookings;
  w public.profiles;
  amt numeric;
  ref text;
  existing public.booking_payments;
BEGIN
  SELECT * INTO customer FROM public.profiles WHERE auth_id=auth.uid()::text;
  IF customer IS NULL OR COALESCE(customer.deleted,false) OR COALESCE(customer.suspended,false) OR COALESCE(customer.banned,false) THEN
    RETURN jsonb_build_object('success',false,'error','Active customer account required');
  END IF;

  SELECT * INTO b FROM public.worker_bookings WHERE id=p_booking_id FOR UPDATE;
  IF b IS NULL THEN RETURN jsonb_build_object('success',false,'error','Booking not found'); END IF;
  IF b.user_id<>customer.user_id THEN RETURN jsonb_build_object('success',false,'error','Not authorized'); END IF;
  IF b.status<>'waiting_payment' THEN RETURN jsonb_build_object('success',false,'error','Booking is not waiting for payment'); END IF;

  IF EXISTS(
    SELECT 1
    FROM public.booking_payments bp
    WHERE bp.worker_booking_id=p_booking_id
      AND bp.status='review_required'
  ) THEN
    RETURN jsonb_build_object(
      'success',false,
      'requires_review',true,
      'error','A verified payment for this booking needs WeHouse review. Do not pay again.'
    );
  END IF;

  SELECT * INTO w FROM public.profiles WHERE user_id=b.worker_id AND role='worker';
  IF w IS NULL OR w.worker_status<>'verified' OR w.worker_verified IS DISTINCT FROM true OR COALESCE(w.deleted,false) OR COALESCE(w.suspended,false) OR COALESCE(w.banned,false) THEN
    RETURN jsonb_build_object('success',false,'error','Worker is no longer eligible for this booking');
  END IF;

  amt:=COALESCE(b.negotiated_amount,b.agreed_amount,0);
  IF amt<=0 THEN RETURN jsonb_build_object('success',false,'error','No agreed amount set'); END IF;

  SELECT * INTO existing
  FROM public.booking_payments
  WHERE worker_booking_id=p_booking_id AND status='pending'
  ORDER BY created_at DESC
  LIMIT 1;

  IF existing IS NOT NULL THEN
    IF round(existing.amount_total,2)=round(amt,2) AND existing.created_at>now()-interval '30 minutes' THEN
      RETURN jsonb_build_object('success',true,'reference',existing.paystack_reference,'amount',amt,'existing',true);
    END IF;
    UPDATE public.booking_payments SET status='expired',updated_at=now() WHERE id=existing.id;
  END IF;

  ref:='WHBK-'||gen_random_uuid()::text;
  INSERT INTO public.booking_payments(
    payment_reference,user_id,payer_user_id,payee_user_id,amount,amount_total,net_amount,
    amount_commission,currency,status,purpose,paystack_reference,worker_booking_id,metadata,created_at,updated_at
  ) VALUES(
    ref,customer.user_id,customer.user_id,b.worker_id,amt,amt,amt,0,'NGN','pending','worker_booking',ref,p_booking_id,
    jsonb_build_object('source','create_worker_booking_payment','booking_id',p_booking_id),now(),now()
  );
  RETURN jsonb_build_object('success',true,'reference',ref,'amount',amt);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_booking(p_booking_id uuid,p_reason text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_actor public.profiles;
  v_booking public.worker_bookings;
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND coalesce(deleted,false)=false
    AND coalesce(suspended,false)=false
    AND coalesce(banned,false)=false
  LIMIT 1;

  IF v_actor IS NULL OR v_actor.role NOT IN ('user','worker') THEN RAISE EXCEPTION 'Active booking participant required'; END IF;
  IF nullif(trim(coalesce(p_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'Cancellation reason is required'; END IF;

  SELECT * INTO v_booking FROM public.worker_bookings WHERE id=p_booking_id FOR UPDATE;
  IF v_booking IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF v_actor.user_id NOT IN (v_booking.user_id,v_booking.worker_id) THEN RAISE EXCEPTION 'Not authorized to cancel this booking'; END IF;
  IF v_booking.status NOT IN ('booking_requested','negotiating','waiting_payment') THEN RAISE EXCEPTION 'Booking cannot be cancelled in current status: %',v_booking.status; END IF;

  IF EXISTS(
    SELECT 1
    FROM public.booking_payments bp
    WHERE bp.worker_booking_id=p_booking_id
      AND bp.status='review_required'
  ) THEN
    RAISE EXCEPTION 'This booking has a verified payment awaiting WeHouse review and cannot be cancelled yet';
  END IF;

  UPDATE public.worker_bookings
  SET status='cancelled',cancellation_reason=trim(p_reason),cancelled_by=v_actor.user_id,updated_at=now()
  WHERE id=p_booking_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_my_branch_worker_booking_summaries()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_actor public.profiles;
  v_result jsonb;
BEGIN
  v_actor:=public._admin_dashboard_actor();

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'booking_code',wb.booking_code,
    'service_type',wb.service_type,
    'status',wb.status,
    'negotiated_amount',coalesce(wb.negotiated_amount,wb.agreed_amount,0),
    'scheduled_date',wb.scheduled_date,
    'created_at',wb.created_at,
    'updated_at',wb.updated_at,
    'worker_name',coalesce(w.full_name,w.username,'Worker'),
    'customer_name',coalesce(c.full_name,c.username,'Customer'),
    'needs_attention',(
      wb.status IN ('booking_requested','waiting_payment','completed_pending_approval','disputed')
      OR EXISTS(
        SELECT 1 FROM public.booking_payments bp
        WHERE bp.worker_booking_id=wb.id AND bp.status='review_required'
      )
    ),
    'has_dispute',wb.status='disputed',
    'payment_review_required',EXISTS(
      SELECT 1 FROM public.booking_payments bp
      WHERE bp.worker_booking_id=wb.id AND bp.status='review_required'
    )
  ) ORDER BY wb.updated_at DESC),'[]'::jsonb)
  INTO v_result
  FROM public.worker_bookings wb
  JOIN public.profiles w ON w.user_id=wb.worker_id
  JOIN public.profiles c ON c.user_id=wb.user_id
  WHERE v_actor.role='creator'
     OR (
       lower(trim(coalesce(w.state,'')))=lower(trim(coalesce(v_actor.assigned_state,'')))
       AND lower(trim(coalesce(nullif(w.local_government,''),nullif(w.city,''),'')))=lower(trim(coalesce(v_actor.assigned_lga,'')))
     );

  RETURN v_result;
END;
$$;
