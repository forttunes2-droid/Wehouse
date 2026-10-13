-- Discounts: a host may discount their own property by 5-50%. WeHouse may fund a smaller 5-15% discount
-- for one property or a whole state. Rules live in the database; nothing is charged from here yet.
create table if not exists public.listing_discounts (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references public.listings(id) on delete cascade,
  state_key text,
  funded_by text not null check (funded_by in ('host','wehouse')),
  percent numeric(4,1) not null,
  starts_on date not null default current_date,
  ends_on date,
  active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now(),
  check ((listing_id is not null) <> (state_key is not null)),
  check (funded_by='wehouse' or listing_id is not null),
  check ((funded_by='host' and percent between 5 and 50) or (funded_by='wehouse' and percent between 5 and 15)),
  check (ends_on is null or ends_on>=starts_on)
);
create unique index if not exists listing_discounts_one_active_listing on public.listing_discounts(listing_id,funded_by) where active and listing_id is not null;
create unique index if not exists listing_discounts_one_active_state on public.listing_discounts(state_key) where active and state_key is not null;
alter table public.listing_discounts enable row level security;
revoke all on public.listing_discounts from public,anon,authenticated;

-- The discount that applies today: host and WeHouse discounts add up, never more than 50% in total.
create or replace function public.listing_discount_percent(p_listing_id uuid, p_on date default current_date)
returns numeric language sql stable security definer set search_path to 'pg_catalog','public' as $$
  select least(50,coalesce(sum(d.percent),0)) from public.listing_discounts d
  join public.listings l on l.id=p_listing_id
  where d.active and d.starts_on<=p_on and (d.ends_on is null or d.ends_on>=p_on)
    and (d.listing_id=l.id or d.state_key=public.wehouse_state_key(l.state)) $$;

create or replace function public.set_my_listing_discount(p_listing_id uuid,p_percent numeric,p_ends_on date default null)
returns uuid language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare a public.profiles; v_id uuid;
begin
  select * into a from public.profiles p where p.auth_id=(select auth.uid())::text and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false) limit 1;
  if a.user_id is null then raise exception 'Sign in first'; end if;
  if not exists(select 1 from public.listings l where l.id=p_listing_id and l.owner_id=a.user_id) then raise exception 'You can only discount your own property'; end if;
  if p_percent is null or p_percent<5 or p_percent>50 then raise exception 'A discount must be between 5% and 50%'; end if;
  update public.listing_discounts set active=false where listing_id=p_listing_id and funded_by='host' and active;
  insert into public.listing_discounts(listing_id,funded_by,percent,ends_on,created_by) values(p_listing_id,'host',p_percent,p_ends_on,a.user_id) returning id into v_id;
  return v_id;
end $$;

create or replace function public.clear_my_listing_discount(p_listing_id uuid)
returns void language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare a public.profiles;
begin
  select * into a from public.profiles p where p.auth_id=(select auth.uid())::text limit 1;
  update public.listing_discounts d set active=false where d.listing_id=p_listing_id and d.funded_by='host' and d.active
    and exists(select 1 from public.listings l where l.id=p_listing_id and l.owner_id=a.user_id);
end $$;

-- Only the Creator may spend WeHouse money, for one property or a whole state.
create or replace function public.creator_set_wehouse_discount(p_listing_id uuid,p_state text,p_percent numeric,p_ends_on date default null)
returns uuid language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare v_actor public.profiles; v_id uuid; v_state text:=nullif(public.wehouse_state_key(p_state),'');
begin
  v_actor:=public._admin_dashboard_actor();
  if v_actor.role<>'creator' then raise exception 'Only the Creator can set a WeHouse-funded discount'; end if;
  if (p_listing_id is null)=(v_state is null) then raise exception 'Choose one property or one state'; end if;
  if p_percent is null or p_percent<5 or p_percent>15 then raise exception 'A WeHouse-funded discount must be between 5% and 15%'; end if;
  update public.listing_discounts set active=false where funded_by='wehouse' and active
    and ((p_listing_id is not null and listing_id=p_listing_id) or (v_state is not null and state_key=v_state));
  insert into public.listing_discounts(listing_id,state_key,funded_by,percent,ends_on,created_by)
  values(p_listing_id,v_state,'wehouse',p_percent,p_ends_on,v_actor.user_id) returning id into v_id;
  return v_id;
end $$;

revoke all on function public.listing_discount_percent(uuid,date),public.set_my_listing_discount(uuid,numeric,date),public.clear_my_listing_discount(uuid),public.creator_set_wehouse_discount(uuid,text,numeric,date) from public,anon;
grant execute on function public.listing_discount_percent(uuid,date) to anon,authenticated,service_role;
grant execute on function public.set_my_listing_discount(uuid,numeric,date),public.clear_my_listing_discount(uuid),public.creator_set_wehouse_discount(uuid,text,numeric,date) to authenticated,service_role;
