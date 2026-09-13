-- worker_user_blocks predates its optional reason field in some databases;
-- CREATE TABLE IF NOT EXISTS does not reconcile columns on an existing table.
alter table public.worker_user_blocks
  add column if not exists reason text;
alter table public.worker_user_blocks
  drop constraint if exists worker_user_blocks_reason_length;
alter table public.worker_user_blocks
  add constraint worker_user_blocks_reason_length
  check(char_length(coalesce(reason,''))<=500);
