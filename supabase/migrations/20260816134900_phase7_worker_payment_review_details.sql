-- Phase 7: expose only the payment-review boolean needed by the two booking
-- participants so the customer UI cannot invite a second payment or cancellation.

CREATE OR REPLACE FUNCTION public.get_my_worker_booking_details(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_actor public.profiles;
  v_booking public.worker_bookings;
  v_customer public.profiles;
  v_worker public.profiles;
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_booking FROM public.worker_bookings WHERE id=p_booking_id;
  IF v_booking IS NULL THEN RETURN NULL; END IF;
  IF v_actor.user_id IS DISTINCT FROM v_booking.user_id
     AND v_actor.user_id IS DISTINCT FROM v_booking.worker_id THEN
    RAISE EXCEPTION 'Booking participant access required';
  END IF;

  SELECT * INTO v_customer FROM public.profiles WHERE user_id=v_booking.user_id LIMIT 1;
  SELECT * INTO v_worker FROM public.profiles WHERE user_id=v_booking.worker_id LIMIT 1;

  RETURN jsonb_build_object(
    'id',v_booking.id,
    'booking_code',v_booking.booking_code,
    'status',v_booking.status,
    'service_type',v_booking.service_type,
    'description',v_booking.description,
    'address',v_booking.address,
    'negotiated_amount',v_booking.negotiated_amount,
    'agreed_amount',v_booking.agreed_amount,
    'scheduled_date',v_booking.scheduled_date,
    'created_at',v_booking.created_at,
    'updated_at',v_booking.updated_at,
    'user_id',v_booking.user_id,
    'worker_id',v_booking.worker_id,
    'user_name',COALESCE(v_customer.full_name,v_customer.username,'Customer'),
    'customer_username',v_customer.username,
    'user_avatar',v_customer.avatar_url,
    'worker_name',COALESCE(v_worker.full_name,v_worker.username,'Worker'),
    'worker_avatar',v_worker.avatar_url,
    'payment_review_required',EXISTS(
      SELECT 1
      FROM public.booking_payments bp
      WHERE bp.worker_booking_id=v_booking.id
        AND bp.status='review_required'
    )
  );
END;
$$;
