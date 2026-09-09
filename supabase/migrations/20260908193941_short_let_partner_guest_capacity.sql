-- A Short Let capacity is chosen by its Property Partner. Never infer it from
-- bedroom count, because bedrooms do not define safe or intended occupancy.

create or replace function public.inherit_short_let_guest_capacity()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $$
begin
  if new.sub_type='short_let' then
    if new.inspection_request_id is not null then
      select ir.max_guests
      into new.max_guests
      from public.inspection_requests ir
      where ir.id=new.inspection_request_id;
    end if;
    if new.max_guests is null or new.max_guests<1 then
      raise exception 'Property Partner must choose the Short Let guest capacity';
    end if;
  else
    new.max_guests := null;
  end if;
  return new;
end
$$;

create or replace function public.create_short_stay_reservation(
  p_listing_id text,
  p_check_in date,
  p_check_out date,
  p_guest_count integer
) returns public.reservations
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_listing public.listings;
  v_created public.reservations;
begin
  select * into v_listing
  from public.listings
  where (id::text=p_listing_id or listing_id=p_listing_id)
    and deleted_at is null
    and sub_type='short_let'
  limit 1
  for share;

  if v_listing is null then
    raise exception 'Short Stay listing not found';
  end if;
  if v_listing.max_guests is null or v_listing.max_guests<1 then
    raise exception 'Property Partner has not chosen the Short Let guest capacity';
  end if;
  if coalesce(p_guest_count,0)<1 or p_guest_count>v_listing.max_guests then
    raise exception 'Choose between 1 and % guests',v_listing.max_guests;
  end if;

  v_created := public.create_short_stay_reservation(
    p_listing_id,
    p_check_in,
    p_check_out
  );
  update public.reservations
  set guest_count=p_guest_count,
      listing_location=concat_ws(
        ', ',
        nullif(v_listing.address,''),
        nullif(v_listing.city,''),
        nullif(v_listing.state,'')
      ),
      updated_at=now()
  where id=v_created.id
  returning * into v_created;
  return v_created;
end
$$;

revoke all on function public.create_short_stay_reservation(text,date,date,integer) from public,anon;
grant execute on function public.create_short_stay_reservation(text,date,date,integer) to authenticated,service_role;
