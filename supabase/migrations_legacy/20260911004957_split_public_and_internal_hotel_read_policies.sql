-- Keep the anonymous path independent from the protected actor helper.
-- PostgreSQL is not required to short-circuit policy OR expressions, so an
-- anonymous visitor must never need EXECUTE on the internal access function.

drop policy if exists hotels_canonical_select on public.hotels;
drop policy if exists hotels_public_active_select on public.hotels;
drop policy if exists hotels_internal_select on public.hotels;

create policy hotels_public_active_select on public.hotels
for select to authenticated, anon
using (status = 'active');

create policy hotels_internal_select on public.hotels
for select to authenticated
using (
  public.current_actor_can_read_hotel_record(hotel_id, owner_id, state, city)
);
