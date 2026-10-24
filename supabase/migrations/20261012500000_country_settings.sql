-- Country settings. Nigeria is the first row, not a rule: currency, time zone and phone prefix are data,
-- so another country is a new row. Nothing existing reads this yet; callers move over one area at a time.
create table if not exists public.platform_countries (
  country_code text primary key check (country_code ~ '^[A-Z]{2}$'),
  name text not null,
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  currency_symbol text not null,
  time_zone text not null,
  phone_prefix text not null,
  locale text not null,
  enabled boolean not null default false,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists platform_countries_one_default on public.platform_countries(is_default) where is_default;
alter table public.platform_countries enable row level security;
drop policy if exists platform_countries_read on public.platform_countries;
create policy platform_countries_read on public.platform_countries for select to anon, authenticated using (enabled);
revoke all on public.platform_countries from public, anon, authenticated;
grant select on public.platform_countries to anon, authenticated;

insert into public.platform_countries(country_code, name, currency_code, currency_symbol, time_zone, phone_prefix, locale, enabled, is_default)
values ('NG', 'Nigeria', 'NGN', '₦', 'Africa/Lagos', '+234', 'en-NG', true, true)
on conflict (country_code) do nothing;

create or replace function public.platform_default_country()
returns public.platform_countries language sql stable security definer set search_path to 'pg_catalog','public' as $$
  select c from public.platform_countries c where c.enabled and c.is_default limit 1 $$;
revoke all on function public.platform_default_country() from public;
grant execute on function public.platform_default_country() to authenticated, service_role;
