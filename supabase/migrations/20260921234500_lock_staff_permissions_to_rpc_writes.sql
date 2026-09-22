begin;

-- staff_permissions is an authorization ledger. Browser clients may read only
-- the rows allowed by RLS; every mutation must go through an authorized RPC.
-- Keeping table-level DML grants around is unnecessary privilege even when
-- current RLS policies happen to block writes.
revoke all on table public.staff_permissions from anon;
revoke insert, update, delete, truncate on table public.staff_permissions from authenticated;
grant select on table public.staff_permissions to authenticated;

commit;
