-- Worker verification and capacity status count public workers in a single
-- State/LGA/occupation bucket. Keep the index predicate identical to those
-- checks so a large verified population does not require scanning every worker.
create index if not exists profiles_verified_worker_capacity_bucket_idx
on public.profiles (
  public.wehouse_state_key(state),
  public.worker_market_text_key(coalesce(nullif(local_government,''),city)),
  public.worker_market_text_key(worker_occupation)
) include (user_id)
where worker_status='verified' and worker_verified=true
  and not coalesce(deleted,false)
  and not coalesce(suspended,false)
  and not coalesce(banned,false);
