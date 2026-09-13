-- Active hotels remain public discovery records. Draft and inactive hotels
-- continue through the non-recursive actor authorization boundary.

drop policy if exists hotels_canonical_select on public.hotels;
create policy hotels_canonical_select on public.hotels
for select to authenticated, anon
using (
  status = 'active'
  or public.current_actor_can_read_hotel_record(hotel_id, owner_id, state, city)
);
