CREATE OR REPLACE FUNCTION public.get_my_hotel_bookings()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_user text:=public.current_profile_user_id();
begin
  if v_user is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;

  return coalesce((
    select jsonb_agg(
      to_jsonb(booking)||jsonb_build_object(
        'refund_status',refund.status,'refund_amount_ngn',refund.amount,
        'hotels',(
          to_jsonb(hotel)
            -'gps_latitude'-'gps_longitude'-'owner_id'
            -'inspection_request_id'-'approved_by'
        )||jsonb_build_object(
          'address',hotel.address,
          'gps_latitude',null,
          'gps_longitude',null,
          'location_exact',false
        ),
        'hotel_rooms',to_jsonb(room),
        'hotel_rate_plans',to_jsonb(rate_plan)
      )
      order by booking.created_at desc
    )
    from public.hotel_bookings booking
    join public.hotels hotel on hotel.hotel_id=booking.hotel_id
    join public.hotel_rooms room on room.room_id=booking.room_id
    left join public.hotel_rate_plans rate_plan
      on rate_plan.rate_plan_id=booking.rate_plan_id
    left join lateral(select a.status,a.amount from public.financial_action_outbox a
      where a.action_type='refund_hotel_cancellation' and a.subject_type='hotel'
      and a.subject_id=booking.booking_id::text and a.payment_protection_id=booking.payment_protection_id
      order by a.created_at desc limit 1)refund on true
    where booking.user_id=v_user
  ),'[]'::jsonb);
end
$function$;

