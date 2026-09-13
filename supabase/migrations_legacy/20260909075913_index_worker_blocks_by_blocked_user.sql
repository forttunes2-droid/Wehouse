create index if not exists worker_user_blocks_blocked_user_idx
  on public.worker_user_blocks(blocked_user_id,blocker_user_id);

