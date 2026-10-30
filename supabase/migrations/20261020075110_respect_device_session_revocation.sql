begin;
-- Keep the existing Auth liveness authority, and honour explicit WeHouse
-- device revocation even while an otherwise valid bearer has not expired.
create or replace function public.auth_session_is_active(p_auth_id uuid,p_session_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,auth,public as $$
  select exists(select 1 from auth.sessions s where s.id=p_session_id and s.user_id=p_auth_id
    and (s.not_after is null or s.not_after>now()))
  and not exists(select 1 from public.user_sessions d where d.auth_id=p_auth_id::text
    and d.auth_session_id=p_session_id::text and (not d.is_active or d.trust_status='rejected'));
$$;
-- Existing maintenance action also expires short-lived security material.
create or replace function public.purge_user_action_rate_limits_from_service()
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare removed_limits integer; removed_challenges integer;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required'; end if;
  delete from public.user_action_rate_limits where updated_at<now()-interval '2 days';
  get diagnostics removed_limits=row_count;
  -- Preserve unresolved, proof-verified processing attempts for recovery review.
  delete from public.email_account_challenges where expires_at<now()-interval '2 days'
    and (status<>'processing' or proof_verified_at is null);
  get diagnostics removed_challenges=row_count;
  return removed_limits;
end; $$;
commit;
