-- Expired reservations are durable customer-facing lifecycle events.
-- Keep Activity as the source of truth; delivery layers can consume it separately.
create or replace function public.notify_reservation_customer_expired_activity()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $$
declare
  v_event_id uuid;
  v_title text;
  v_summary text;
  v_listing_title text;
begin
  if tg_op <> 'UPDATE'
     or new.status <> 'expired'
     or old.status is not distinct from new.status
     or new.user_id is null then
    return new;
  end if;

  select coalesce(l.title, 'Apartment')
    into v_listing_title
  from public.listings l
  where l.id::text = new.listing_id
     or l.listing_id = new.listing_id
  limit 1;

  if coalesce(new.stay_type, 'long_stay') = 'short_let'
     and new.reservation_fee_status = 'paid' then
    v_title := 'Short Let stay payment missed';
    v_summary := v_listing_title || ' · the stay payment deadline passed, so the reservation expired. You can reserve the dates again if they are still available.';
  else
    v_title := 'Reservation expired';
    v_summary := v_listing_title || ' · the payment or reservation hold deadline passed, so the reservation expired. You can start a new reservation if the place is still available.';
  end if;

  v_event_id := private.upsert_activity_event(
    'customer_reservation_expired:' || new.id::text,
    case
      when coalesce(new.stay_type, 'long_stay') = 'short_let'
           and new.reservation_fee_status = 'paid'
        then 'reservation.stay_payment_expired'
      else 'reservation.expired'
    end,
    'reservation',
    new.id::text,
    new.user_id,
    v_title,
    v_summary,
    'my_reservations',
    jsonb_build_object('bookingId', new.id::text),
    coalesce(new.updated_at, now())
  );

  perform private.add_activity_audience(
    v_event_id,
    new.user_id,
    'personal',
    'housing',
    null,
    false
  );

  return new;
end
$$;

drop trigger if exists reservations_customer_expired_activity
  on public.reservations;

create trigger reservations_customer_expired_activity
after update of status
on public.reservations
for each row
execute function public.notify_reservation_customer_expired_activity();

revoke all on function public.notify_reservation_customer_expired_activity()
  from public, anon, authenticated;

grant execute on function public.notify_reservation_customer_expired_activity()
  to service_role;
