-- Security-definer routines must never inherit PostgreSQL's default PUBLIC
-- execution grant. Browser clients receive access only through explicit grants.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
  loop
    execute format('revoke execute on function %s from public, anon', fn.signature);
  end loop;
end
$$;

-- Internal policy helpers are called only by other database routines/policies.
-- Keeping them off the Data API removes unnecessary privileged RPC endpoints.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and (
        p.proname like '\_%' escape '\'
        or p.proname in (
          'calculate_commission',
          'can_access_my_conversation',
          'current_actor_can_access_reservation',
          'get_admin_staff_limit_v2',
          'get_secret_v2',
          'is_current_announcement_recipient',
          'is_current_announcement_sender',
          'is_staff_or_creator',
          'message_edit_window_minutes',
          'worker_identity_is_current',
          'worker_identity_recheck_days'
        )
      )
  loop
    execute format('revoke execute on function %s from authenticated', fn.signature);
  end loop;
end
$$;
