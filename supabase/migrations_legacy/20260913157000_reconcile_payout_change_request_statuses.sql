-- Reconcile the secure payout-account state machine with the idempotent Edge
-- reconciliation states. Existing payout-account replacement remains blocked
-- until fresh-sign-in and OTP evidence are supplied; first-time setup may move
-- through processing/uncertain/succeeded without weakening that check.

alter table public.payout_account_change_requests
  drop constraint if exists payout_account_change_requests_status_check;

alter table public.payout_account_change_requests
  add constraint payout_account_change_requests_status_check check(status in(
    'processing','uncertain','cooling','activation_pending','active',
    'succeeded','failed','cancelled'
  ));
