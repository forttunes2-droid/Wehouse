-- Saving a hotel is a private user bookmark. It is deliberately separate from
-- followed searches (notification intent) and Worker Showcase reactions (social intent).

create table if not exists public.saved_hotels (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.profiles(user_id) on delete cascade,
  hotel_id integer not null references public.hotels(hotel_id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(user_id, hotel_id)
);

alter table public.saved_hotels enable row level security;

revoke all on table public.saved_hotels from public, anon;
grant select, insert, delete on table public.saved_hotels to authenticated, service_role;

drop policy if exists saved_hotels_read_own on public.saved_hotels;
create policy saved_hotels_read_own on public.saved_hotels
for select to authenticated
using (user_id = public.current_profile_user_id());

drop policy if exists saved_hotels_insert_own on public.saved_hotels;
create policy saved_hotels_insert_own on public.saved_hotels
for insert to authenticated
with check (user_id = public.current_profile_user_id());

drop policy if exists saved_hotels_delete_own on public.saved_hotels;
create policy saved_hotels_delete_own on public.saved_hotels
for delete to authenticated
using (user_id = public.current_profile_user_id());

create index if not exists saved_hotels_user_created_idx
  on public.saved_hotels(user_id, created_at desc);

create or replace function public.save_my_hotel(p_hotel_id integer)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_user_id text := public.current_profile_user_id();
begin
  if v_user_id is null then raise exception 'Authenticated profile required'; end if;
  if not exists(
    select 1 from public.hotels h
    where h.hotel_id = p_hotel_id
      and h.status = 'active'
      and h.approved_at is not null
      and h.published_at is not null
  ) then raise exception 'This hotel is not available to save'; end if;

  insert into public.saved_hotels(user_id, hotel_id)
  values(v_user_id, p_hotel_id)
  on conflict(user_id, hotel_id) do nothing;
  return true;
end;
$$;

create or replace function public.unsave_my_hotel(p_hotel_id integer)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_user_id text := public.current_profile_user_id();
begin
  if v_user_id is null then raise exception 'Authenticated profile required'; end if;
  delete from public.saved_hotels
  where user_id = v_user_id and hotel_id = p_hotel_id;
  return found;
end;
$$;

revoke all on function public.save_my_hotel(integer) from public, anon;
revoke all on function public.unsave_my_hotel(integer) from public, anon;
grant execute on function public.save_my_hotel(integer) to authenticated, service_role;
grant execute on function public.unsave_my_hotel(integer) to authenticated, service_role;

comment on table public.saved_hotels is
  'Private hotel bookmarks. Not Showcase likes and not followed-search subscriptions.';
