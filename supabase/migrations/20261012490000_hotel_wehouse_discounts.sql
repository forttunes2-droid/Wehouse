-- WeHouse-funded hotel discounts. Same rule as Short Let: the partner is paid on the price after the
-- hotel's own discount only; WeHouse's share comes out of its commission, never above the hotel
-- commission rate (and never above 15%), and host + WeHouse together never exceed 50%.
alter table public.hotel_discounts
  add column if not exists funded_by text not null default 'host' check (funded_by in ('host','wehouse'));
alter table public.hotel_discounts alter column hotel_id drop not null;
alter table public.hotel_discounts drop constraint if exists hotel_discounts_wehouse_scope;
alter table public.hotel_discounts add constraint hotel_discounts_wehouse_scope
  check (hotel_id is not null or funded_by = 'wehouse');
drop index if exists public.hotel_discounts_one_active_scope;
create unique index hotel_discounts_one_active_scope on public.hotel_discounts(
  funded_by, coalesce(hotel_id, 0), coalesce(room_id, 0), coalesce(rate_plan_id, 0)) where active;

create or replace function public.wehouse_hotel_discount_ceiling()
returns numeric language sql stable security definer set search_path to 'pg_catalog','public' as $$
  select least(15, greatest(0, coalesce(min((p.value->>'percent')::numeric), 0)))
  from public.creator_policy_versions p
  where p.policy_key = 'commission_hotel' and p.scope_type = 'global' and p.scope_key = '*' and p.status = 'active'
    and p.effective_from <= now() and (p.effective_until is null or p.effective_until > now()) $$;
revoke all on function public.wehouse_hotel_discount_ceiling() from public;
grant execute on function public.wehouse_hotel_discount_ceiling() to authenticated, service_role;

-- Most specific active discount per funder. WeHouse share is capped by commission and the 50% total.
create or replace function private.hotel_discount_split(p_hotel_id integer, p_room_id integer, p_rate_plan_id integer, p_on date)
returns table(partner_percent numeric, wehouse_percent numeric)
language plpgsql stable security definer set search_path to 'pg_catalog','public' as $$
declare v_p numeric; v_w numeric;
begin
  select coalesce((select d.percent from public.hotel_discounts d
    where d.active and d.funded_by = 'host' and d.hotel_id = p_hotel_id and d.starts_on <= p_on and (d.ends_on is null or d.ends_on >= p_on)
      and (d.rate_plan_id = p_rate_plan_id or (d.rate_plan_id is null and d.room_id = p_room_id) or (d.rate_plan_id is null and d.room_id is null))
    order by (d.rate_plan_id is not null) desc, (d.room_id is not null) desc, d.created_at desc limit 1), 0) into v_p;
  select coalesce((select d.percent from public.hotel_discounts d
    where d.active and d.funded_by = 'wehouse' and (d.hotel_id = p_hotel_id or d.hotel_id is null) and d.starts_on <= p_on and (d.ends_on is null or d.ends_on >= p_on)
      and (d.hotel_id is null or d.rate_plan_id = p_rate_plan_id or (d.rate_plan_id is null and d.room_id = p_room_id) or (d.rate_plan_id is null and d.room_id is null))
    order by (d.rate_plan_id is not null) desc, (d.room_id is not null) desc, (d.hotel_id is not null) desc, d.created_at desc limit 1), 0) into v_w;
  v_w := greatest(0, least(v_w, public.wehouse_hotel_discount_ceiling(), floor(100 * (1 - 0.5 / (1 - v_p / 100)))));
  return query select v_p, v_w;
end $$;
revoke all on function private.hotel_discount_split(integer,integer,integer,date) from public, anon, authenticated;
drop function if exists private.hotel_discount_for(integer,integer,integer,date);

create table if not exists public.hotel_booking_discounts (
  booking_id integer primary key references public.hotel_bookings(booking_id) on delete cascade,
  partner_percent numeric not null,
  wehouse_percent numeric not null,
  partner_total numeric(12,2) not null
);
alter table public.hotel_booking_discounts enable row level security;
revoke all on public.hotel_booking_discounts from public, anon, authenticated;

create or replace function private.hotel_booking_quote_core(
  p_room_id integer, p_rate_plan_id integer, p_check_in date, p_check_out date,
  p_exclude_booking_id integer default null, p_include_live_holds boolean default true, p_lock_inventory boolean default true)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','private' as $$
declare q jsonb; v_hotel integer; s record; v_original numeric; v_partner_total numeric; v_total numeric;
begin
  q := private.hotel_booking_quote_core_undiscounted(p_room_id, p_rate_plan_id, p_check_in, p_check_out, p_exclude_booking_id, p_include_live_holds, p_lock_inventory);
  if not coalesce((q->>'available')::boolean, false) then return q; end if;
  select hotel_id into v_hotel from public.hotel_rooms where room_id = p_room_id;
  select * into s from private.hotel_discount_split(v_hotel, p_room_id, p_rate_plan_id, p_check_in);
  v_original := (q->>'total_price')::numeric;
  if s.partner_percent + s.wehouse_percent <= 0 then
    return q || jsonb_build_object('original_price', v_original, 'discount_percent', 0, 'discount_amount', 0, 'wehouse_discount_percent', 0);
  end if;
  v_partner_total := greatest(1, round(v_original * (1 - s.partner_percent / 100), 0));
  v_total := greatest(1, round(v_partner_total * (1 - s.wehouse_percent / 100), 0));
  return q || jsonb_build_object('total_price', v_total, 'original_price', v_original,
    'discount_percent', round((1 - v_total / v_original) * 100, 1), 'discount_amount', v_original - v_total,
    'wehouse_discount_percent', s.wehouse_percent, 'partner_percent', s.partner_percent);
end $$;
revoke all on function private.hotel_booking_quote_core(integer,integer,date,date,integer,boolean,boolean) from public, anon, authenticated;

-- Remember what the hotel is paid on, at the moment the booking is created.
create or replace function private.snapshot_hotel_booking_discount()
returns trigger language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare s record;
begin
  select * into s from private.hotel_discount_split(new.hotel_id, new.room_id, new.rate_plan_id, new.check_in);
  if s.wehouse_percent > 0 then
    insert into public.hotel_booking_discounts(booking_id, partner_percent, wehouse_percent, partner_total)
    values (new.booking_id, s.partner_percent, s.wehouse_percent, round(new.total_price / (1 - s.wehouse_percent / 100), 2))
    on conflict (booking_id) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists hotel_bookings_snapshot_discount on public.hotel_bookings;
create trigger hotel_bookings_snapshot_discount after insert on public.hotel_bookings
  for each row execute function private.snapshot_hotel_booking_discount();
revoke all on function private.snapshot_hotel_booking_discount() from public, anon, authenticated;

-- The hotel's payout is on its own discounted price; WeHouse's discount comes out of the commission.
create or replace function public.apply_hotel_partner_payout()
returns trigger language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare d public.hotel_booking_discounts; v_commission numeric;
begin
  if new.subject_type is distinct from 'hotel_stay' then return new; end if;
  select * into d from public.hotel_booking_discounts where booking_id::text = new.subject_id;
  if d.booking_id is null or d.partner_total <= new.amount_total then return new; end if;
  v_commission := greatest(0, new.amount_total - round(d.partner_total * (1 - new.commission_rate / 100), 2));
  new.amount_commission := v_commission;
  new.amount_payee := new.amount_total - v_commission;
  return new;
end $$;
drop trigger if exists payment_protection_hotel_partner_payout on public.payment_protection_transactions;
create trigger payment_protection_hotel_partner_payout before insert on public.payment_protection_transactions
  for each row execute function public.apply_hotel_partner_payout();
revoke all on function public.apply_hotel_partner_payout() from public, anon, authenticated;

-- Hotel-funded RPCs now only touch hotel-funded rows.
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
  where hotel_id = p_hotel_id and funded_by = 'host' and active and coalesce(room_id, 0) = coalesce(p_room_id, 0) and coalesce(rate_plan_id, 0) = coalesce(p_rate_plan_id, 0);
  insert into public.hotel_discounts(hotel_id, room_id, rate_plan_id, percent, ends_on, created_by, funded_by)
  values (p_hotel_id, p_room_id, p_rate_plan_id, p_percent, p_ends_on, v_actor, 'host') returning id into v_id;
  return v_id;
end $$;

create or replace function public.partner_clear_hotel_discount(p_discount_id uuid)
returns void language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare v_hotel integer;
begin
  select hotel_id into v_hotel from public.hotel_discounts where id = p_discount_id and funded_by = 'host';
  if v_hotel is null or not public.hotel_actor_has_capability(v_hotel, 'hotel.rate.manage') then
    raise exception 'Hotel rate capability is required';
  end if;
  update public.hotel_discounts set active = false where id = p_discount_id;
end $$;

drop function if exists public.partner_list_hotel_discounts(integer);
create function public.partner_list_hotel_discounts(p_hotel_id integer)
returns table(id uuid, room_id integer, rate_plan_id integer, percent numeric, starts_on date, ends_on date, funded_by text)
language plpgsql stable security definer set search_path to 'pg_catalog','public' as $$
begin
  if not public.hotel_actor_has_capability(p_hotel_id, 'hotel.rate.manage') then raise exception 'Hotel rate capability is required'; end if;
  return query select d.id, d.room_id, d.rate_plan_id, d.percent, d.starts_on, d.ends_on, d.funded_by
  from public.hotel_discounts d where (d.hotel_id = p_hotel_id or (d.hotel_id is null and d.funded_by = 'wehouse')) and d.active order by d.created_at desc;
end $$;
revoke all on function public.partner_list_hotel_discounts(integer) from public, anon;
grant execute on function public.partner_list_hotel_discounts(integer) to authenticated, service_role;

-- Only the Creator spends WeHouse money: everywhere, or one hotel / room / package.
create or replace function public.creator_set_wehouse_hotel_discount(
  p_hotel_id integer, p_room_id integer, p_rate_plan_id integer, p_percent numeric, p_ends_on date default null)
returns uuid language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare v_actor public.profiles; v_id uuid;
begin
  v_actor := public._admin_dashboard_actor();
  if v_actor.role <> 'creator' then raise exception 'Only the Creator can set a WeHouse-funded discount'; end if;
  if p_percent is null or p_percent < 5 or p_percent > 15 then raise exception 'A WeHouse-funded discount must be between 5%% and 15%%'; end if;
  if p_percent > public.wehouse_hotel_discount_ceiling() then
    raise exception 'WeHouse cannot discount more than the commission it earns (% percent)', public.wehouse_hotel_discount_ceiling();
  end if;
  if p_hotel_id is null and (p_room_id is not null or p_rate_plan_id is not null) then raise exception 'Choose a hotel first'; end if;
  update public.hotel_discounts set active = false
  where funded_by = 'wehouse' and active and coalesce(hotel_id, 0) = coalesce(p_hotel_id, 0)
    and coalesce(room_id, 0) = coalesce(p_room_id, 0) and coalesce(rate_plan_id, 0) = coalesce(p_rate_plan_id, 0);
  insert into public.hotel_discounts(hotel_id, room_id, rate_plan_id, percent, ends_on, created_by, funded_by)
  values (p_hotel_id, p_room_id, p_rate_plan_id, p_percent, p_ends_on, v_actor.user_id, 'wehouse') returning id into v_id;
  return v_id;
end $$;

create or replace function public.creator_list_wehouse_hotel_discounts()
returns table(id uuid, hotel_id integer, hotel_name text, room_id integer, rate_plan_id integer, percent numeric, ends_on date)
language plpgsql stable security definer set search_path to 'pg_catalog','public' as $$
begin
  if public._admin_dashboard_actor().role <> 'creator' then raise exception 'Only the Creator can view this'; end if;
  return query select d.id, d.hotel_id, h.name::text, d.room_id, d.rate_plan_id, d.percent, d.ends_on
  from public.hotel_discounts d left join public.hotels h on h.hotel_id = d.hotel_id
  where d.funded_by = 'wehouse' and d.active order by d.created_at desc;
end $$;

create or replace function public.creator_stop_wehouse_hotel_discount(p_id uuid)
returns void language plpgsql security definer set search_path to 'pg_catalog','public' as $$
begin
  if public._admin_dashboard_actor().role <> 'creator' then raise exception 'Only the Creator can stop this'; end if;
  update public.hotel_discounts set active = false where id = p_id and funded_by = 'wehouse';
end $$;

revoke all on function public.creator_set_wehouse_hotel_discount(integer,integer,integer,numeric,date), public.creator_list_wehouse_hotel_discounts(), public.creator_stop_wehouse_hotel_discount(uuid) from public, anon;
grant execute on function public.creator_set_wehouse_hotel_discount(integer,integer,integer,numeric,date), public.creator_list_wehouse_hotel_discounts(), public.creator_stop_wehouse_hotel_discount(uuid) to authenticated, service_role;
