-- Paid portfolio reporting and owner-authored arrival guidance for booked guests.
begin;
create table public.partner_pro_arrival_instructions (
  owner_id text not null references public.profiles(user_id) on delete cascade,
  asset_kind text not null check(asset_kind in ('home','hotel')),
  asset_id text not null,
  instructions text not null check(length(btrim(instructions)) between 1 and 1500),
  updated_at timestamptz not null default now(),
  primary key(asset_kind,asset_id)
);
alter table public.partner_pro_arrival_instructions enable row level security;
revoke all on public.partner_pro_arrival_instructions from public,anon,authenticated;
grant all on public.partner_pro_arrival_instructions to service_role;

create or replace function public.get_my_partner_pro_arrival_setup()
returns jsonb language plpgsql stable security definer set search_path='pg_catalog','public' as $$
declare v_actor text:=public.current_profile_user_id();
begin
  if v_actor is null or not public.current_actor_has_workspace('property_partner',null)
    or not public.partner_pro_is_active(v_actor) then raise exception 'Active Property Partner Pro required'; end if;
  return jsonb_build_object(
    'instructions',coalesce((select jsonb_agg(jsonb_build_object('kind',i.asset_kind,'asset_id',i.asset_id,
      'instructions',i.instructions)) from public.partner_pro_arrival_instructions i
      where i.owner_id=v_actor and public.partner_pro_owns_asset(i.asset_kind,i.asset_id)),'[]'::jsonb),
    'occupancy',coalesce((select jsonb_agg(to_jsonb(x) order by x.title) from (
      select 'home'::text kind,l.id::text asset_id,l.title,
        30 available_unit_nights,
        coalesce((select sum(greatest(0,least(r.stay_check_out::date,current_date+30)
          -greatest(r.stay_check_in::date,current_date)))::integer
          from public.reservations r where r.listing_id in (l.id::text,l.listing_id)
            and r.stay_check_in::date<current_date+30 and r.stay_check_out::date>current_date
            and r.status not in ('cancelled','expired','refunded')
            and (r.rent_payment_status='paid' or r.manual_payment_status in ('paid','completed')
              or r.status in ('occupied','completed'))),0) booked_unit_nights
      from public.property_host_assignments a join public.listings l on l.id=a.listing_id
      where a.user_id=v_actor and a.assignment_role='owner' and a.status='active' and l.deleted_at is null
      union all
      select 'hotel',h.hotel_id::text,h.name,
        coalesce((select sum(greatest(room.total_rooms,0))::integer from public.hotel_rooms room
          where room.hotel_id=h.hotel_id),0)*30,
        coalesce((select sum(greatest(0,least(b.check_out,current_date+30)-greatest(b.check_in,current_date)))::integer
          from public.hotel_bookings b where b.hotel_id=h.hotel_id
            and b.check_in<current_date+30 and b.check_out>current_date
            and b.status not in ('cancelled','expired','refunded','payment_conflict')
            and (b.payment_status='paid' or b.status in ('confirmed','checked_in','checked_out','completed'))),0)
      from public.hotels h where h.owner_id=v_actor
    ) x),'[]'::jsonb)
  );
end $$;
revoke all on function public.get_my_partner_pro_arrival_setup() from public,anon;
grant execute on function public.get_my_partner_pro_arrival_setup() to authenticated;

create or replace function public.save_my_partner_pro_arrival_instructions(
  p_kind text,p_asset_id text,p_instructions text)
returns boolean language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_actor text:=public.current_profile_user_id();
begin
  if v_actor is null or not public.current_actor_has_workspace('property_partner',null)
    or not public.partner_pro_is_active(v_actor) or p_kind not in ('home','hotel')
    or not public.partner_pro_owns_asset(p_kind,p_asset_id) then
    raise exception 'Owned Property Partner Pro asset required'; end if;
  if length(btrim(coalesce(p_instructions,'')))>1500 then raise exception 'Instructions are too long'; end if;
  if nullif(btrim(coalesce(p_instructions,'')),'') is null then
    delete from public.partner_pro_arrival_instructions
      where owner_id=v_actor and asset_kind=p_kind and asset_id=p_asset_id;
  else
    insert into public.partner_pro_arrival_instructions(owner_id,asset_kind,asset_id,instructions)
    values(v_actor,p_kind,p_asset_id,btrim(p_instructions))
    on conflict(asset_kind,asset_id) do update set owner_id=excluded.owner_id,
      instructions=excluded.instructions,updated_at=now();
  end if;
  return true;
end $$;
revoke all on function public.save_my_partner_pro_arrival_instructions(text,text,text) from public,anon;
grant execute on function public.save_my_partner_pro_arrival_instructions(text,text,text) to authenticated;

create or replace function public.get_my_stay_arrival_instructions(p_kind text,p_booking_id text)
returns text language plpgsql stable security definer set search_path='pg_catalog','public' as $$
declare v_actor text:=public.current_profile_user_id(); v_asset text;
begin
  if v_actor is null then return null; end if;
  if p_kind='home' then
    select l.id::text into v_asset from public.reservations r
      join public.listings l on r.listing_id in (l.id::text,l.listing_id)
      where r.id=p_booking_id and r.user_id=v_actor
      and r.status not in ('cancelled','expired','refunded')
      and (r.rent_payment_status='paid' or r.manual_payment_status in ('paid','completed'));
  elsif p_kind='hotel' then
    select b.hotel_id::text into v_asset from public.hotel_bookings b
      where b.booking_id::text=p_booking_id and b.user_id=v_actor and b.payment_status='paid'
        and b.status not in ('cancelled','expired','refunded','payment_conflict');
  else return null;
  end if;
  if v_asset is null then return null; end if;
  return (select i.instructions from public.partner_pro_arrival_instructions i
    where i.asset_kind=p_kind and i.asset_id=v_asset);
end $$;
revoke all on function public.get_my_stay_arrival_instructions(text,text) from public,anon;
grant execute on function public.get_my_stay_arrival_instructions(text,text) to authenticated;
commit;
