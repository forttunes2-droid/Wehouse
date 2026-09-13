-- A block is a discovery boundary, not only a presentation filter. Prevent
-- refresh jobs and compatibility writers from recreating a blocked pair in
-- roommate_search_results. Paid/shared-housing records remain in their own
-- lifecycle tables for review and resolution.

create or replace function public.prevent_blocked_roommate_match_result()
returns trigger
language plpgsql
security invoker
set search_path to 'pg_catalog','public'
as $$
begin
  if exists(
    select 1
    from public.roommate_user_blocks blocked_pair
    where (blocked_pair.blocker_user_id=new.searcher_id
        and blocked_pair.blocked_user_id=new.matched_user_id)
       or (blocked_pair.blocker_user_id=new.matched_user_id
        and blocked_pair.blocked_user_id=new.searcher_id)
  ) then
    return null;
  end if;
  return new;
end
$$;

revoke all on function public.prevent_blocked_roommate_match_result()
from public,anon,authenticated;
grant execute on function public.prevent_blocked_roommate_match_result()
to service_role;

drop trigger if exists prevent_blocked_roommate_match_result_trigger
on public.roommate_search_results;
create trigger prevent_blocked_roommate_match_result_trigger
before insert or update of searcher_id,matched_user_id
on public.roommate_search_results
for each row execute function public.prevent_blocked_roommate_match_result();

-- Remove stale discovery projections only. This does not remove a conversation,
-- booking, payment, shared-payment group, case, evidence or audit record.
delete from public.roommate_search_results result
where exists(
  select 1
  from public.roommate_user_blocks blocked_pair
  where (blocked_pair.blocker_user_id=result.searcher_id
      and blocked_pair.blocked_user_id=result.matched_user_id)
     or (blocked_pair.blocker_user_id=result.matched_user_id
      and blocked_pair.blocked_user_id=result.searcher_id)
);

insert into public.function_execution_registry(
  function_signature,function_name,security_mode,public_allowed,anon_allowed,
  authenticated_allowed,service_role_allowed,review_state,rationale,captured_at
)
select
  procedure.oid::regprocedure::text,procedure.proname,
  case when procedure.prosecdef then 'definer' else 'invoker' end,
  has_function_privilege('public',procedure.oid,'execute'),
  has_function_privilege('anon',procedure.oid,'execute'),
  has_function_privilege('authenticated',procedure.oid,'execute'),
  has_function_privilege('service_role',procedure.oid,'execute'),
  'approved_service_only',
  'Trigger-only guard preventing blocked Roommate pairs from re-entering discovery projections.',
  now()
from pg_proc procedure
join pg_namespace namespace on namespace.oid=procedure.pronamespace
where namespace.nspname='public'
  and procedure.proname='prevent_blocked_roommate_match_result'
on conflict(function_signature) do update set
  security_mode=excluded.security_mode,
  public_allowed=excluded.public_allowed,
  anon_allowed=excluded.anon_allowed,
  authenticated_allowed=excluded.authenticated_allowed,
  service_role_allowed=excluded.service_role_allowed,
  review_state=excluded.review_state,
  rationale=excluded.rationale,
  captured_at=excluded.captured_at;
