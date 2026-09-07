-- Session and password activity is private account-security data. Direct table
-- access is owner-only; privileged operational access must use a separately
-- scoped, audited RPC rather than broad profile-read authority.
alter table public.user_activity enable row level security;

drop policy if exists user_activity_read_canonical on public.user_activity;
create policy user_activity_read_canonical
on public.user_activity
for select
to authenticated
using (
  user_id = public.current_profile_user_id()
  and auth_id = (select auth.uid())::text
);

drop policy if exists user_activity_insert_own_canonical on public.user_activity;
create policy user_activity_insert_own_canonical
on public.user_activity
for insert
to authenticated
with check (
  user_id = public.current_profile_user_id()
  and auth_id = (select auth.uid())::text
);

revoke all on table public.user_activity from anon;
revoke update, delete, truncate, references, trigger on table public.user_activity from authenticated;
grant select, insert on table public.user_activity to authenticated;
