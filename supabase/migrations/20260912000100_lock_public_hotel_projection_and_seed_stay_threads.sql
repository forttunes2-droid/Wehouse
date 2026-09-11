-- Public hotel discovery must expose only the allowlisted projection returned by
-- the public hotel RPCs. RLS filters rows, not columns, so a public SELECT policy
-- on public.hotels leaks exact address/coordinates and internal ownership fields.
--
-- Hotel stay chat must also be deterministic. A paid confirmed stay gets one
-- canonical conversation regardless of whether the guest or hotel opens Inbox
-- first. Ended stays keep that same thread as read-only history.

-- ---------------------------------------------------------------------------
-- 1. Public hotel reads go through column-safe projections only.
-- ---------------------------------------------------------------------------

drop policy if exists hotels_public_active_select on public.hotels;

-- Anonymous clients never need the base hotel row. Authenticated internal actors
-- retain their table grant, but RLS now limits them to hotels_internal_select.
revoke select on table public.hotels from anon;

revoke all on function public.get_discoverable_hotels() from public, anon;
revoke all on function public.get_public_hotel_detail(integer) from public, anon;

grant execute on function public.get_discoverable_hotels()
  to anon, authenticated, service_role;
grant execute on function public.get_public_hotel_detail(integer)
  to anon, authenticated, service_role;

comment on function public.get_discoverable_hotels()
  is 'Column-safe public hotel discovery projection. Anonymous and authenticated callers use this instead of selecting public.hotels directly.';
comment on function public.get_public_hotel_detail(integer)
  is 'Column-safe hotel detail projection. Exact location is returned only when the function authorizes that caller.';

-- ---------------------------------------------------------------------------
-- 2. One deterministic conversation per paid hotel stay.
-- ---------------------------------------------------------------------------

create or replace function public.ensure_paid_hotel_stay_conversation()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  if new.payment_status = 'paid'
     and new.status in ('confirmed','checked_in','checked_out','completed') then
    insert into public.hotel_booking_conversations(
      booking_id,
      hotel_id,
      guest_user_id,
      updated_at
    ) values (
      new.booking_id,
      new.hotel_id,
      new.user_id,
      now()
    )
    on conflict (booking_id) do update
      set hotel_id = excluded.hotel_id,
          guest_user_id = excluded.guest_user_id;
  end if;
  return new;
end;
$$;

revoke all on function public.ensure_paid_hotel_stay_conversation()
  from public, anon, authenticated;
grant execute on function public.ensure_paid_hotel_stay_conversation()
  to service_role;

drop trigger if exists hotel_bookings_ensure_stay_conversation
  on public.hotel_bookings;
create trigger hotel_bookings_ensure_stay_conversation
after insert or update of payment_status, status, hotel_id, user_id
on public.hotel_bookings
for each row
execute function public.ensure_paid_hotel_stay_conversation();

-- Repair existing paid stays so hotel staff do not see an action that depends on
-- the guest having opened chat first. Closed stays receive the same historical
-- thread but remain non-writable under send_hotel_booking_message().
insert into public.hotel_booking_conversations(
  booking_id,
  hotel_id,
  guest_user_id,
  updated_at
)
select
  booking.booking_id,
  booking.hotel_id,
  booking.user_id,
  now()
from public.hotel_bookings booking
where booking.payment_status = 'paid'
  and booking.status in ('confirmed','checked_in','checked_out','completed')
on conflict (booking_id) do nothing;

comment on function public.ensure_paid_hotel_stay_conversation()
  is 'Creates the canonical hotel stay thread when a paid booking becomes a live or historical confirmed stay.';
