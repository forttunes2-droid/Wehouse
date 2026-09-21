begin;

-- These tables are authority, audit or money ledgers. Browser roles may use
-- approved read paths/RPCs, but never mutate them directly.
revoke insert, update, delete, truncate on table public.workspace_role_assignments from anon, authenticated;
revoke insert, update, delete, truncate on table public.staff_permissions from anon, authenticated;
revoke insert, update, delete, truncate on table public.activity_events from anon, authenticated;
revoke insert, update, delete, truncate on table public.activity_event_audiences from anon, authenticated;
revoke insert, update, delete, truncate on table public.wallets from anon, authenticated;
revoke insert, update, delete, truncate on table public.withdrawals from anon, authenticated;

commit;
