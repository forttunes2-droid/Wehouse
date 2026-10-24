CREATE OR REPLACE FUNCTION public.ack_hotel_pms_reservation(p_integration_id uuid, p_booking_id integer, p_expected_updated_at timestamp with time zone, p_expected_status text, p_accepted boolean, p_external_id text, p_reason text, p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare integration public.hotel_integrations;booking public.hotel_bookings;event public.hotel_integration_events;v_details jsonb;
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'Service role required';end if;
 select * into integration from public.hotel_integrations where integration_id=p_integration_id;
 if integration.integration_id is null or not public.hotel_integration_runtime_active(p_integration_id)
  or not('reservations.ack'=any(integration.scopes)) then raise exception 'Active authorized Hotel connection required';end if;
 select * into event from public.hotel_integration_events where integration_event_id=p_event_id
  and integration_id=p_integration_id and direction='inbound' and event_type='reservation_ack' for update;
 if event.integration_event_id is null or event.status<>'pending' then raise exception 'Pending acknowledgement event required';end if;
 select * into booking from public.hotel_bookings where booking_id=p_booking_id and hotel_id=integration.hotel_id for update;
 if booking.booking_id is null or booking.payment_status not in('paid','refunded') then raise exception 'Paid WeHouse reservation not found';end if;
 if p_expected_updated_at is null or p_expected_status is null or p_accepted is null
  or booking.updated_at is distinct from p_expected_updated_at or booking.status is distinct from p_expected_status
  or booking.integration_id is not null and booking.integration_id<>p_integration_id then
  raise exception 'Reservation changed; fetch its current version before acknowledgement' using errcode='40001';
 end if;
 if length(coalesce(p_external_id,''))>200 or length(coalesce(p_reason,''))>1000 then raise exception 'Acknowledgement text is too long';end if;
 update public.hotel_bookings set integration_id=p_integration_id,
  pms_external_reservation_id=coalesce(nullif(btrim(p_external_id),''),booking.pms_external_reservation_id),
  pms_sync_status=case when p_accepted then 'acknowledged' else 'review_required' end,pms_last_synced_at=now(),updated_at=now()
 where booking_id=p_booking_id;
 v_details:=jsonb_build_object('booking_id',p_booking_id,'accepted',p_accepted,
  'external_reservation_id',coalesce(nullif(btrim(p_external_id),''),booking.pms_external_reservation_id),
  'review_required',not p_accepted,'reservation_status',booking.status,'reservation_updated_at',booking.updated_at,'reason',nullif(btrim(p_reason),''));
 update public.hotel_integration_events set status=case when p_accepted then 'acknowledged' else 'review_required' end,
  processed_at=now(),acknowledged_at=case when p_accepted then now() end,details=v_details,
  error_message=case when not p_accepted then coalesce(nullif(btrim(p_reason),''),'PMS rejected reservation state') end
 where integration_event_id=p_event_id;
 update public.hotel_integration_events set status=case when p_accepted then 'acknowledged' else 'review_required' end,
  acknowledged_at=case when p_accepted then now() end,processed_at=now(),next_attempt_at=null,
  error_message=case when not p_accepted then coalesce(nullif(btrim(p_reason),''),'PMS rejected reservation state') end
 where integration_id=p_integration_id and direction='outbound' and external_reference=p_booking_id::text
  and event_type=case when booking.status in('cancelled','refunded') then 'reservation.cancelled' else 'reservation.paid_confirmed' end
  and status in('pending','delivered','retry');
 return v_details;
end; $function$;

