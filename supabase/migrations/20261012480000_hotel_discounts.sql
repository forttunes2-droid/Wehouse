-- Hotel discounts. The hotel chooses the scope: the whole hotel, one room type, or one room package.
-- The most specific active discount wins, they do not stack. Hotel-funded, 5-50%, with optional end date,
-- applied to the check-in date. The discount is applied inside the one hotel quote, so the booking total,
-- the payment, the refund and the commission all follow the amount the guest actually pays.
create table if not exists public.hotel_discounts (
  id uuid primary key default gen_random_uuid(),
  hotel_id integer not null references public.hotels(hotel_id) on delete cascade,
  room_id integer references public.hotel_rooms(room_id) on delete cascade,
  rate_plan_id integer references public.hotel_rate_plans(rate_plan_id) on delete cascade,
  percent numeric(4,1) not null check (percent between 5 and 50),
  starts_on date not null default current_date,
  ends_on date,
  active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on),
  check (rate_plan_id is null or room_id is not null)
);
create unique index if not exists hotel_discounts_one_active_scope on public.hotel_discounts(
  hotel_id, coalesce(room_id, 0), coalesce(rate_plan_id, 0)) where active;
alter table public.hotel_discounts enable row level security;
revoke all on public.hotel_discounts from public, anon, authenticated;

-- Most specific active discount for a package on a check-in date.
create or replace function private.hotel_discount_for(p_hotel_id integer, p_room_id integer, p_rate_plan_id integer, p_on date)
returns numeric language sql stable security definer set search_path to 'pg_catalog','public' as $$
  select coalesce((
    select d.percent from public.hotel_discounts d
    where d.active and d.hotel_id = p_hotel_id and d.starts_on <= p_on and (d.ends_on is null or d.ends_on >= p_on)
      and (d.rate_plan_id = p_rate_plan_id or (d.rate_plan_id is null and d.room_id = p_room_id) or (d.rate_plan_id is null and d.room_id is null))
    order by (d.rate_plan_id is not null) desc, (d.room_id is not null) desc, d.created_at desc limit 1), 0) $$;
revoke all on function private.hotel_discount_for(integer,integer,integer,date) from public, anon, authenticated;

-- Wrap the existing quote: same availability rules, discounted total with the original kept for display.
alter function private.hotel_booking_quote_core(integer,integer,date,date,integer,boolean,boolean)
  rename to hotel_booking_quote_core_undiscounted;

create or replace function private.hotel_booking_quote_core(
  p_room_id integer, p_rate_plan_id integer, p_check_in date, p_check_out date,
  p_exclude_booking_id integer default null, p_include_live_holds boolean default true, p_lock_inventory boolean default true)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','private' as $$
declare q jsonb; v_hotel integer; v_pct numeric; v_original numeric; v_total numeric;
begin
  q := private.hotel_booking_quote_core_undiscounted(p_room_id, p_rate_plan_id, p_check_in, p_check_out, p_exclude_booking_id, p_include_live_holds, p_lock_inventory);
  if not coalesce((q->>'available')::boolean, false) then return q; end if;
  select hotel_id into v_hotel from public.hotel_rooms where room_id = p_room_id;
  v_pct := private.hotel_discount_for(v_hotel, p_room_id, p_rate_plan_id, p_check_in);
  v_original := (q->>'total_price')::numeric;
  if v_pct <= 0 then
    return q || jsonb_build_object('original_price', v_original, 'discount_percent', 0, 'discount_amount', 0, 'discount_funded_by', null);
  end if;
  v_total := greatest(1, round(v_original * (1 - v_pct / 100), 0));
  return q || jsonb_build_object('total_price', v_total, 'original_price', v_original, 'discount_percent', v_pct,
    'discount_amount', v_original - v_total, 'discount_funded_by', 'host');
end $$;
revoke all on function private.hotel_booking_quote_core(integer,integer,date,date,integer,boolean,boolean) from public, anon, authenticated;

create or replace function public.partner_set_hotel_discount(
  p_hotel_id integer, p_room_id integer, p_rate_plan_id integer, p_percent numeric, p_ends_on date default null)
returns uuid language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare v_actor text; v_id uuid;
begin
  select user_id into v_actor from public.profiles where auth_id=(select auth.uid())::text limit 1;
  if v_actor is null or not public.hotel_actor_has_capability(p_hotel_id, 'hotel.rate.manage') then
    raise exception 'Hotel rate capability is required';
  end if;
  if p_percent is null or p_percent < 5 or p_percent > 50 then raise exception 'A discount must be between 5%% and 50%%'; end if;
  if p_ends_on is not null and p_ends_on < current_date then raise exception 'The end date is in the past'; end if;
  if p_room_id is not null and not exists(select 1 from public.hotel_rooms where room_id = p_room_id and hotel_id = p_hotel_id) then
    raise exception 'That room is not part of this hotel';
  end if;
  if p_rate_plan_id is not null and not exists(select 1 from public.hotel_rate_plans where rate_plan_id = p_rate_plan_id and hotel_id = p_hotel_id and room_id = p_room_id) then
    raise exception 'That package is not part of this room';
  end if;
  update public.hotel_discounts set active = false
  where hotel_id = p_hotel_id and active and coalesce(room_id, 0) = coalesce(p_room_id, 0) and coalesce(rate_plan_id, 0) = coalesce(p_rate_plan_id, 0);
  insert into public.hotel_discounts(hotel_id, room_id, rate_plan_id, percent, ends_on, created_by)
  values (p_hotel_id, p_room_id, p_rate_plan_id, p_percent, p_ends_on, v_actor) returning id into v_id;
  return v_id;
end $$;

create or replace function public.partner_clear_hotel_discount(p_discount_id uuid)
returns void language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare v_hotel integer;
begin
  select hotel_id into v_hotel from public.hotel_discounts where id = p_discount_id;
  if v_hotel is null or not public.hotel_actor_has_capability(v_hotel, 'hotel.rate.manage') then
    raise exception 'Hotel rate capability is required';
  end if;
  update public.hotel_discounts set active = false where id = p_discount_id;
end $$;

create or replace function public.partner_list_hotel_discounts(p_hotel_id integer)
returns table(id uuid, room_id integer, rate_plan_id integer, percent numeric, starts_on date, ends_on date)
language plpgsql stable security definer set search_path to 'pg_catalog','public' as $$
begin
  if not public.hotel_actor_has_capability(p_hotel_id, 'hotel.rate.manage') then raise exception 'Hotel rate capability is required'; end if;
  return query select d.id, d.room_id, d.rate_plan_id, d.percent, d.starts_on, d.ends_on
  from public.hotel_discounts d where d.hotel_id = p_hotel_id and d.active order by d.created_at desc;
end $$;

revoke all on function public.partner_set_hotel_discount(integer,integer,integer,numeric,date), public.partner_clear_hotel_discount(uuid), public.partner_list_hotel_discounts(integer) from public, anon;
grant execute on function public.partner_set_hotel_discount(integer,integer,integer,numeric,date), public.partner_clear_hotel_discount(uuid), public.partner_list_hotel_discounts(integer) to authenticated, service_role;
