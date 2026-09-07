-- A customer-facing hotel booking code is proof of a verified paid booking.
-- Creating a checkout hold must never allocate a code.
alter table public.hotel_bookings alter column booking_code drop not null;

create or replace function public.set_hotel_booking_code()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $$
declare
  v_lga text;
  v_paid boolean;
  v_codeable boolean;
begin
  if tg_op = 'UPDATE' and nullif(btrim(coalesce(old.booking_code, '')), '') is not null then
    new.booking_code := old.booking_code;
    return new;
  end if;

  v_paid := new.paid_at is not null and new.payment_status in ('paid', 'refunded');
  v_codeable := new.status in ('confirmed', 'checked_in', 'checked_out', 'completed', 'refunded');

  if not (v_paid and v_codeable) then
    new.booking_code := null;
    return new;
  end if;

  select coalesce(nullif(btrim(h.city), ''), nullif(btrim(h.state), ''), 'General')
  into v_lga
  from public.hotels h
  where h.hotel_id = new.hotel_id
  limit 1;

  new.booking_code := public.reserve_lga_booking_code(coalesce(v_lga, 'General'));
  return new;
end;
$$;

drop trigger if exists set_hotel_booking_code_trigger on public.hotel_bookings;
create trigger set_hotel_booking_code_trigger
before insert or update of booking_code, status, payment_status, paid_at
on public.hotel_bookings
for each row execute function public.set_hotel_booking_code();

revoke all on function public.set_hotel_booking_code() from public, anon, authenticated;
grant execute on function public.set_hotel_booking_code() to service_role;

create or replace function public.verify_branch_booking_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $$
declare
  v_actor public.profiles;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_result jsonb;
  v_state text;
  v_lga text;
begin
  if v_code !~ '^[A-Z]{3}WH[0-9]{5}$' then
    raise exception 'Enter a valid WeHouse booking code';
  end if;

  select * into v_actor
  from public.profiles
  where auth_id = auth.uid()::text
    and role in ('staff', 'admin', 'creator')
    and not coalesce(deleted, false)
    and not coalesce(suspended, false)
    and not coalesce(banned, false)
  limit 1;
  if v_actor is null then raise exception 'Operations access required'; end if;
  if v_actor.role = 'staff' and not public.current_staff_has_permission('operations') then
    raise exception 'Operations module required';
  end if;

  select jsonb_build_object(
      'kind', 'housing', 'code', r.booking_code, 'status', r.status,
      'payment_status', r.manual_payment_status,
      'valid', r.paid_at is not null
        and r.manual_payment_status in ('paid', 'completed')
        and r.status in ('reserved', 'inspection_pending', 'ready_for_move_in', 'occupied'),
      'can_handover', r.paid_at is not null
        and r.manual_payment_status in ('paid', 'completed')
        and r.rent_paid_at is not null
        and r.rent_payment_status in ('paid', 'upfront_paid')
        and r.status = 'ready_for_move_in',
      'customer_name', coalesce(p.full_name, p.username, r.user_email),
      'customer_phone', coalesce(p.phone, r.user_phone),
      'property_name', coalesce(l.title, r.listing_title),
      'state', l.state, 'lga', l.city, 'reservation_id', r.id,
      'listing_id', r.listing_id, 'tenancy_start_date', r.tenancy_start_date,
      'tenancy_end_date', r.tenancy_end_date
    ), l.state, l.city
  into v_result, v_state, v_lga
  from public.reservations r
  join public.listings l on l.id::text = r.listing_id or l.listing_id = r.listing_id
  left join public.profiles p on p.user_id = r.user_id
  where r.booking_code = v_code
  limit 1;

  if v_result is null then
    select jsonb_build_object(
        'kind', 'hotel', 'code', hb.booking_code, 'status', hb.status,
        'payment_status', hb.payment_status,
        'valid', hb.paid_at is not null and hb.payment_status = 'paid'
          and hb.status in ('confirmed', 'checked_in'),
        'can_check_in', hb.paid_at is not null and hb.payment_status = 'paid'
          and hb.status = 'confirmed'
          and current_date >= hb.check_in and current_date < hb.check_out,
        'customer_name', coalesce(p.full_name, p.username, hb.guest_name),
        'customer_phone', coalesce(p.phone, hb.guest_phone),
        'property_name', h.name, 'state', h.state, 'lga', h.city,
        'booking_id', hb.booking_id, 'hotel_id', hb.hotel_id,
        'check_in', hb.check_in, 'check_out', hb.check_out,
        'guest_count', hb.guest_count
      ), h.state, h.city
    into v_result, v_state, v_lga
    from public.hotel_bookings hb
    join public.hotels h on h.hotel_id = hb.hotel_id
    left join public.profiles p on p.user_id = hb.user_id
    where hb.booking_code = v_code
    limit 1;
  end if;

  if v_result is null then return null; end if;
  if v_actor.role <> 'creator' then
    if lower(btrim(coalesce(v_actor.assigned_state, v_actor.state, ''))) <>
         lower(btrim(coalesce(v_state, '')))
       or lower(btrim(coalesce(v_actor.assigned_lga, v_actor.local_government, v_actor.city, ''))) <>
          lower(btrim(coalesce(v_lga, ''))) then
      raise exception 'This booking belongs to another WeHouse branch';
    end if;
  end if;
  return v_result;
end;
$$;

revoke all on function public.verify_branch_booking_code(text) from public, anon;
grant execute on function public.verify_branch_booking_code(text) to authenticated, service_role;

create or replace function public.confirm_hotel_check_in_by_code(p_booking_code text)
returns public.hotel_bookings
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $$
declare
  v_verified jsonb;
  v_booking public.hotel_bookings;
begin
  v_verified := public.verify_branch_booking_code(p_booking_code);
  if v_verified is null or v_verified->>'kind' <> 'hotel' then
    raise exception 'Hotel booking not found';
  end if;
  if coalesce((v_verified->>'can_check_in')::boolean, false) is not true then
    raise exception 'This code cannot check in a guest in its current payment, date or booking state';
  end if;

  update public.hotel_bookings
  set status = 'checked_in', updated_at = now()
  where booking_id = (v_verified->>'booking_id')::integer
    and booking_code = upper(btrim(p_booking_code))
    and status = 'confirmed'
    and payment_status = 'paid'
    and paid_at is not null
  returning * into v_booking;
  if v_booking.booking_id is null then
    raise exception 'Hotel booking changed before check-in; verify the code again';
  end if;
  return v_booking;
end;
$$;

revoke all on function public.confirm_hotel_check_in_by_code(text) from public, anon;
grant execute on function public.confirm_hotel_check_in_by_code(text) to authenticated, service_role;

