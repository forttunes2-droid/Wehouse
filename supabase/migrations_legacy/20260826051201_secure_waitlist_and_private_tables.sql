alter table public.waitlist_signups
  alter column email drop not null,
  add column if not exists budget numeric(14,2),
  add column if not exists notified boolean not null default false,
  add column if not exists status text not null default 'waiting';

alter table public.waitlist_signups
  drop constraint if exists waitlist_email_format,
  drop constraint if exists waitlist_contact_required,
  drop constraint if exists waitlist_budget_valid,
  drop constraint if exists waitlist_status_allowed;

alter table public.waitlist_signups
  add constraint waitlist_email_format check (
    email is null or (
      char_length(email) between 5 and 254
      and email = lower(btrim(email))
      and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  ),
  add constraint waitlist_contact_required check (
    nullif(btrim(coalesce(email,'')), '') is not null
    or nullif(btrim(coalesce(phone,'')), '') is not null
  ),
  add constraint waitlist_budget_valid check (budget is null or budget >= 0),
  add constraint waitlist_status_allowed check (status in ('waiting','contacted','invited','joined','archived'));

create unique index if not exists waitlist_signups_phone_unique
  on public.waitlist_signups (phone)
  where phone is not null and btrim(phone) <> '';

drop policy if exists "public can join waitlist" on public.waitlist_signups;
create policy "public can join waitlist"
  on public.waitlist_signups
  for insert
  to anon, authenticated
  with check (
    source = 'website'
    and interest in ('housing','roommate','worker')
    and status = 'waiting'
    and notified = false
    and (
      nullif(btrim(coalesce(email,'')), '') is not null
      or nullif(btrim(coalesce(phone,'')), '') is not null
    )
  );

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'activity_logs','admin_logs','audit_logs','booking_code_registry',
    'booking_payments','chat_rooms','message_requests','payments','reviews',
    'system_settings','verified_paystack_references','wallet_balances',
    'worker_identity_checks','worker_test_questions','workers'
  ]
  loop
    if not exists (
      select 1 from pg_policies
      where schemaname='public'
        and tablename=table_name
        and policyname='private by default'
    ) then
      execute format(
        'create policy %I on public.%I for all to anon, authenticated using (false) with check (false)',
        'private by default',
        table_name
      );
    end if;
  end loop;
end $$;

