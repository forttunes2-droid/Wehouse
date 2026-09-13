-- Finance queues and audit views filter/group payouts by their reviewer.
create index if not exists idx_withdrawals_reviewed_by
  on public.withdrawals(reviewed_by)
  where reviewed_by is not null;
