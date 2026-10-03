-- The exact 500k-profile load exposed slow Auth/profile provisioning.
-- Match the existing case-insensitive identity collision lookup without changing
-- its authorization or duplicate-email semantics. Non-unique intentionally.
create index if not exists profiles_email_lower_lookup_idx
on public.profiles (lower(email));
