-- Reservation conversations must show the live booking state. A conversation
-- snapshot is useful for identity and display, but it must not keep saying
-- "Reserved" after rent, move-in scheduling, handover or tenancy changes.

create or replace function public.sync_reservation_conversation_context()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $function$
begin
  update public.partner_support_conversations c
  set context_snapshot = coalesce(c.context_snapshot, '{}'::jsonb)
    || jsonb_build_object(
      'reservation_id', new.id,
      'status', new.status,
      'stay_type', coalesce(new.stay_type, 'long_stay'),
      'booking_code', new.booking_code,
      'rent_payment_status', new.rent_payment_status,
      'rent_paid_at', new.rent_paid_at,
      'requested_move_in_at', new.requested_move_in_at,
      'hold_expires_at', new.hold_expires_at,
      'tenancy_start_date', new.tenancy_start_date,
      'tenancy_end_date', new.tenancy_end_date,
      'check_in', new.stay_check_in,
      'check_out', new.stay_check_out
    )
  where c.context_type in (
      'apartment_reservation',
      'apartment_payment',
      'reservation'
    )
    and c.context_id = new.id::text;

  return new;
end;
$function$;

revoke all on function public.sync_reservation_conversation_context()
from public, anon, authenticated;
grant execute on function public.sync_reservation_conversation_context()
to service_role;

drop trigger if exists reservations_sync_conversation_context
on public.reservations;

create trigger reservations_sync_conversation_context
after update of
  status,
  stay_type,
  booking_code,
  rent_payment_status,
  rent_paid_at,
  requested_move_in_at,
  hold_expires_at,
  tenancy_start_date,
  tenancy_end_date,
  stay_check_in,
  stay_check_out
on public.reservations
for each row
execute function public.sync_reservation_conversation_context();

-- Repair existing reservation conversations without changing their unread
-- state or their place in the message list.
update public.partner_support_conversations c
set context_snapshot = coalesce(c.context_snapshot, '{}'::jsonb)
  || jsonb_build_object(
    'reservation_id', r.id,
    'status', r.status,
    'stay_type', coalesce(r.stay_type, 'long_stay'),
    'booking_code', r.booking_code,
    'rent_payment_status', r.rent_payment_status,
    'rent_paid_at', r.rent_paid_at,
    'requested_move_in_at', r.requested_move_in_at,
    'hold_expires_at', r.hold_expires_at,
    'tenancy_start_date', r.tenancy_start_date,
    'tenancy_end_date', r.tenancy_end_date,
    'check_in', r.stay_check_in,
    'check_out', r.stay_check_out
  )
from public.reservations r
where c.context_type in (
    'apartment_reservation',
    'apartment_payment',
    'reservation'
  )
  and c.context_id = r.id::text;
