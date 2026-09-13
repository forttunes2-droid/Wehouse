-- WeHouse accounts are for adults aged 18 or older. Date of birth is kept in
-- a private eligibility table rather than the broadly-read profiles table.
create table if not exists public.profile_age_eligibility (
  user_id text primary key references public.profiles(user_id) on delete cascade,
  date_of_birth date not null,
  verified_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profile_age_eligibility enable row level security;
revoke all on table public.profile_age_eligibility from public, anon, authenticated;

create or replace function public.set_my_date_of_birth(p_date_of_birth date)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id text;
begin
  select p.user_id into v_user_id
  from public.profiles p
  where p.auth_id = auth.uid()::text
    and coalesce(p.deleted, false) = false
  limit 1;
  if v_user_id is null then raise exception 'Account not found'; end if;
  if p_date_of_birth is null then raise exception 'Date of birth is required'; end if;
  if p_date_of_birth > current_date - interval '18 years' then
    raise exception 'You must be 18 or older to use WeHouse';
  end if;
  if p_date_of_birth < current_date - interval '120 years' then
    raise exception 'Check the date of birth and try again';
  end if;
  insert into public.profile_age_eligibility(user_id, date_of_birth, verified_at, updated_at)
  values(v_user_id, p_date_of_birth, now(), now())
  on conflict(user_id) do update set
    date_of_birth = excluded.date_of_birth,
    verified_at = excluded.verified_at,
    updated_at = now();
  return true;
end;
$$;

revoke all on function public.set_my_date_of_birth(date) from public;
grant execute on function public.set_my_date_of_birth(date) to authenticated;

create or replace function public.require_adult_before_profile_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.profile_complete is true and coalesce(old.profile_complete, false) is false then
    if not exists (
      select 1 from public.profile_age_eligibility a
      where a.user_id = new.user_id
        and a.date_of_birth <= current_date - interval '18 years'
    ) then
      raise exception 'Confirm that you are 18 or older before completing your profile';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_require_adult_before_completion on public.profiles;
create trigger profiles_require_adult_before_completion
before update of profile_complete on public.profiles
for each row execute function public.require_adult_before_profile_completion();
