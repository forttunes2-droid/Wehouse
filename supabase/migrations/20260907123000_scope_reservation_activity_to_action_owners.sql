-- Routine customer checkout actions belong in Bookings, not privileged Activity.
-- Creator sees escalations through its oversight records; branch Admin and Property
-- Operations receive only reservation transitions that require operational action.
create or replace function public.notify_reservation_operations_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_listing public.listings;
  v_recipient text;
  v_title text;
  v_state_key text;
begin
  if tg_op = 'UPDATE'
     and old.status is not distinct from new.status
     and old.rent_payment_status is not distinct from new.rent_payment_status then
    return new;
  end if;

  -- An unpaid checkout attempt, its cancellation, and expiry are not operational
  -- Activity. Terminal success states remain available in the booking record.
  if coalesce(new.status, '') not in ('reserved', 'inspection_pending', 'ready_for_move_in', 'payment_conflict') then
    return new;
  end if;
  if new.status = 'reserved'
     and coalesce(new.manual_payment_status, 'unpaid') not in ('paid', 'completed')
     and new.paid_at is null then
    return new;
  end if;

  select * into v_listing
  from public.listings l
  where l.id::text = new.listing_id or l.listing_id = new.listing_id
  limit 1;
  if v_listing is null then return new; end if;

  v_title := case
    when new.status = 'reserved' then 'Paid reservation needs review'
    when new.status = 'inspection_pending' then 'Apartment inspection needs coordination'
    when new.status = 'ready_for_move_in' then 'Handover needs coordination'
    when new.status = 'payment_conflict' then 'Reservation payment needs review'
    else 'Reservation needs action'
  end;
  v_state_key := coalesce(new.status, 'unknown') || ':' || coalesce(new.rent_payment_status, 'unknown');

  for v_recipient in
    select distinct p.user_id
    from public.profiles p
    where not coalesce(p.deleted, false)
      and not coalesce(p.suspended, false)
      and not coalesce(p.banned, false)
      and (
        (p.role = 'admin'
          and lower(btrim(coalesce(p.assigned_state, ''))) = lower(btrim(coalesce(v_listing.state, '')))
          and lower(btrim(coalesce(p.assigned_lga, ''))) = lower(btrim(coalesce(v_listing.city, ''))))
        or (p.role = 'staff'
          and lower(btrim(coalesce(p.assigned_state, ''))) = lower(btrim(coalesce(v_listing.state, '')))
          and lower(btrim(coalesce(p.assigned_lga, ''))) = lower(btrim(coalesce(v_listing.city, '')))
          and exists (
            select 1 from public.staff_permissions sp
            where sp.staff_id = p.user_id and sp.permission = 'operations' and sp.is_active
          ))
      )
  loop
    insert into public.notifications(
      recipient_id, type, title, message, read, related_id, source_type, source_id,
      destination_route, destination_params, event_key, created_at
    ) values (
      v_recipient, 'reservation_action_required', v_title,
      concat_ws(' · ', nullif(v_listing.title, ''), nullif(new.booking_code, ''), replace(new.status, '_', ' ')),
      false, new.id::text, 'reservation', new.id::text, 'operations_inbox',
      jsonb_build_object('reservation_id', new.id, 'booking_code', new.booking_code, 'status', new.status),
      'operations_reservation:' || new.id::text || ':' || v_state_key, now()
    ) on conflict (recipient_id, event_key) where event_key is not null do nothing;
  end loop;
  return new;
end;
$$;

-- Remove only the routine privileged-feed rows produced by the previous trigger.
-- The reservation/payment records themselves remain intact in their owners' queues.
delete from public.notifications n
using public.reservations r
where n.source_type = 'reservation'
  and n.source_id = r.id::text
  and n.destination_route = 'operations_inbox'
  and (
    r.status in ('cancelled', 'expired', 'payment_pending', 'occupied', 'completed', 'refunded')
    or (r.status = 'reserved'
      and coalesce(r.manual_payment_status, 'unpaid') not in ('paid', 'completed')
      and r.paid_at is null)
  );

revoke all on function public.notify_reservation_operations_activity() from public, anon, authenticated;
grant execute on function public.notify_reservation_operations_activity() to service_role;
