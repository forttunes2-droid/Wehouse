-- Keep the one canonical Reservation Desk conversation aligned with its booking.
update public.partner_support_conversations c
set subject = coalesce(l.title, case when r.stay_type = 'short_let' then 'Short Let' else 'Long Stay' end),
    category = 'reservation_operations',
    channel_kind = 'reservation_operations',
    context_snapshot = to_jsonb(r) || jsonb_build_object(
      'reservation_id', r.id,
      'listing_title', coalesce(l.title, 'Property reservation'),
      'listing_city', l.city,
      'listing_state', l.state,
      'listing_location', concat_ws(', ', nullif(l.city, ''), nullif(l.state, ''))
    ),
    updated_at = now()
from public.reservations r
left join public.listings l on l.listing_id = r.listing_id or l.id::text = r.listing_id
where c.channel_kind = 'reservation_operations'
  and c.context_type in ('apartment_reservation', 'reservation')
  and c.context_id = r.id::text;

update public.partner_support_conversations c
set subject = coalesce(h.name, 'Hotel stay'),
    category = 'reservation_operations',
    channel_kind = 'reservation_operations',
    context_snapshot = to_jsonb(b) || jsonb_build_object(
      'booking_id', b.booking_id,
      'hotel_name', coalesce(h.name, 'Hotel stay')
    ),
    updated_at = now()
from public.hotel_bookings b
join public.hotels h on h.hotel_id = b.hotel_id
where c.channel_kind = 'reservation_operations'
  and c.context_type = 'hotel_booking'
  and c.context_id = b.booking_id::text;
