begin;

-- Wallet hardening. The app reads only wallets, wallet_transactions and withdrawals.
-- wallet_balances is unused, and withdrawal_requests belongs to the retired
-- request_withdrawal() path (service-role only). Clients had broad table grants on
-- them that only RLS was holding back; remove the grants so a policy mistake can
-- never expose or edit money rows. Reads the app needs stay in place.
revoke all on table public.wallet_balances from anon, authenticated;
revoke all on table public.withdrawal_requests from anon;
revoke insert, update, delete, truncate, references, trigger, maintain
  on table public.withdrawal_requests from authenticated;

-- Signed-out visitors never have a wallet.
revoke all on table public.wallets from anon;
revoke all on table public.wallet_transactions from anon;
revoke all on table public.withdrawals from anon;

-- Signed-in users may read their own rows (RLS decides which); only server code writes.
revoke insert, update, delete, truncate, references, trigger, maintain
  on table public.wallets from authenticated;
revoke insert, update, delete, truncate, references, trigger, maintain
  on table public.wallet_transactions from authenticated;
revoke insert, update, delete, truncate, references, trigger, maintain
  on table public.withdrawals from authenticated;

-- The financial audit log is written only by server code; clients may read what RLS allows.
revoke all on table public.financial_audit_logs from anon;
revoke insert, update, delete, truncate, references, trigger, maintain
  on table public.financial_audit_logs from authenticated;

comment on table public.wallet_balances is
  'Unused legacy projection. Canonical balance is public.wallets. Do not read or write.';
comment on table public.withdrawal_requests is
  'Retired legacy payout table (request_withdrawal, service role only). Canonical payouts are public.withdrawals.';

commit;
