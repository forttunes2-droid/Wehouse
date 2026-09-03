create index if not exists user_sessions_trust_reviewer_idx
  on public.user_sessions (trust_reviewed_by_session_id)
  where trust_reviewed_by_session_id is not null;
