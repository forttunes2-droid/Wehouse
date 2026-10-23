-- A cancellation remains deliverable even while a connection needs operator review.
-- Runtime certification/legal gates still control every external API request.
create index if not exists hotel_events_reservation_delivery_idx on public.hotel_integration_events(integration_id,external_reference,event_type) where direction='outbound';
create function private.queue_hotel_cancellation_for_pms()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,extensions as $$
declare integration public.hotel_integrations;payload jsonb;active boolean;
begin
 if new.status<>'cancelled' or old.status='cancelled' or new.integration_id is null then return new;end if;
 select * into integration from public.hotel_integrations where integration_id=new.integration_id and hotel_id=new.hotel_id;
 if integration.integration_id is null then raise exception 'Hotel connection does not match this booking';end if;
 active:=public.hotel_integration_runtime_active(integration.integration_id);
 payload:=jsonb_build_object('booking_id',new.booking_id,'hotel_id',new.hotel_id,'room_id',new.room_id,
  'external_reservation_id',new.pms_external_reservation_id,'booking_status','cancelled',
  'check_in',new.check_in,'check_out',new.check_out,'payment_status',new.payment_status);
 insert into public.hotel_integration_events(integration_id,idempotency_key,direction,event_type,external_reference,payload_hash,status,next_attempt_at,details)
 values(integration.integration_id,'hotel-booking:'||new.booking_id||':cancelled:v1','outbound','reservation.cancelled',new.booking_id::text,
  encode(digest(payload::text,'sha256'),'hex'),'pending',now(),payload)
 on conflict(integration_id,idempotency_key) do nothing;
 update public.hotel_integration_events set status='review_required',next_attempt_at=null,
  error_message='Superseded by booking cancellation; do not deliver the earlier confirmation'
 where integration_id=integration.integration_id and direction='outbound' and external_reference=new.booking_id::text
  and event_type='reservation.paid_confirmed' and status in('pending','retry');
 new.pms_sync_status:=case when active then 'pending' else 'review_required' end;
 new.pms_last_synced_at:=null;
 if not active then
  insert into public.notifications(recipient_id,type,title,message,related_id,source_type,source_id,destination_route,destination_params,event_key,workspace_scope)
  select h.owner_id,'hotel_pms_review','Hotel cancellation needs connection review',
   'A cancelled booking is waiting for the hotel connection. Review the connection and confirm the cancellation with the hotel.',new.booking_id::text,
   'hotel_booking',new.booking_id::text,'property-owner',jsonb_build_object('hotel_id',new.hotel_id,'booking_id',new.booking_id),
   'hotel-pms-cancel-review:'||integration.integration_id||':'||new.booking_id,'property_partner'
  from public.hotels h where h.hotel_id=new.hotel_id and h.owner_id is not null;
 end if;
 return new;
end; $$;
revoke all on function private.queue_hotel_cancellation_for_pms() from public,anon,authenticated,service_role;
create trigger hotel_booking_queue_cancellation before update of status on public.hotel_bookings
 for each row execute function private.queue_hotel_cancellation_for_pms();

-- Acknowledge exactly the reservation version delivered, atomically with its event.
create function public.ack_hotel_pms_reservation(p_integration_id uuid,p_booking_id integer,p_expected_updated_at timestamptz,p_expected_status text,p_accepted boolean,p_external_id text,p_reason text,p_event_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare integration public.hotel_integrations;booking public.hotel_bookings;event public.hotel_integration_events;details jsonb;
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
 details:=jsonb_build_object('booking_id',p_booking_id,'accepted',p_accepted,
  'external_reservation_id',coalesce(nullif(btrim(p_external_id),''),booking.pms_external_reservation_id),
  'review_required',not p_accepted,'reservation_status',booking.status,'reservation_updated_at',booking.updated_at,'reason',nullif(btrim(p_reason),''));
 update public.hotel_integration_events set status=case when p_accepted then 'acknowledged' else 'review_required' end,
  processed_at=now(),acknowledged_at=case when p_accepted then now() end,details=ack_hotel_pms_reservation.details,
  error_message=case when not p_accepted then coalesce(nullif(btrim(p_reason),''),'PMS rejected reservation state') end
 where integration_event_id=p_event_id;
 update public.hotel_integration_events set status=case when p_accepted then 'acknowledged' else 'review_required' end,
  acknowledged_at=case when p_accepted then now() end,processed_at=now(),next_attempt_at=null,
  error_message=case when not p_accepted then coalesce(nullif(btrim(p_reason),''),'PMS rejected reservation state') end
 where integration_id=p_integration_id and direction='outbound' and external_reference=p_booking_id::text
  and event_type=case when booking.status in('cancelled','refunded') then 'reservation.cancelled' else 'reservation.paid_confirmed' end
  and status in('pending','delivered','retry');
 return details;
end; $$;
revoke all on function public.ack_hotel_pms_reservation(uuid,integer,timestamptz,text,boolean,text,text,uuid) from public,anon,authenticated;
grant execute on function public.ack_hotel_pms_reservation(uuid,integer,timestamptz,text,boolean,text,text,uuid) to service_role;
