create table if not exists public.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text,
  phone text,
  city text,
  interest text not null default 'housing',
  source text not null default 'website',
  created_at timestamptz not null default now(),
  constraint waitlist_email_format check (
    char_length(email) between 5 and 254
    and email = lower(btrim(email))
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint waitlist_name_length check (full_name is null or char_length(full_name) <= 100),
  constraint waitlist_phone_length check (phone is null or char_length(phone) <= 30),
  constraint waitlist_city_length check (city is null or char_length(city) <= 100),
  constraint waitlist_interest_allowed check (interest in ('housing','roommate','worker','property_partner','hotel','other')),
  constraint waitlist_source_allowed check (source in ('website'))
);

create unique index if not exists waitlist_signups_email_unique
  on public.waitlist_signups (lower(email));

alter table public.waitlist_signups enable row level security;

revoke all on table public.waitlist_signups from public, anon, authenticated;
grant insert on table public.waitlist_signups to anon, authenticated;

drop policy if exists "public can join waitlist" on public.waitlist_signups;
create policy "public can join waitlist"
  on public.waitlist_signups
  for insert
  to anon, authenticated
  with check (
    email = lower(btrim(email))
    and source = 'website'
    and interest in ('housing','roommate','worker','property_partner','hotel','other')
  );

comment on table public.waitlist_signups is
  'Pre-launch WeHouse waitlist. Public clients may insert only; reads and management remain privileged.';

