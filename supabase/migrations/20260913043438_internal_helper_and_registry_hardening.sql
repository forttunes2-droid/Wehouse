-- Internal actor-bound helpers are callable only through reviewed RPCs. The
-- disabled legacy Creator overloads are not exposed merely to raise an error.

revoke all on function public.active_obligation_visibility(text,text)
from public,anon,authenticated;
grant execute on function public.active_obligation_visibility(text,text)
to service_role;
revoke all on function public.actor_can_open_case_for_subject(text,text,text)
from public,anon,authenticated;
grant execute on function public.actor_can_open_case_for_subject(text,text,text)
to service_role;
revoke all on function public.current_actor_can_access_operational_conversation(uuid,boolean)
from public,anon,authenticated;
grant execute on function public.current_actor_can_access_operational_conversation(uuid,boolean)
to service_role;

revoke all on function public.creator_set_team_role(text,text,text,text,text)
from public,anon,authenticated;
grant execute on function public.creator_set_team_role(text,text,text,text,text)
to service_role;
revoke all on function public.creator_reassign_branch(text,text,text)
from public,anon,authenticated;
grant execute on function public.creator_reassign_branch(text,text,text)
to service_role;

insert into public.function_execution_registry(
  function_signature,function_name,security_mode,public_allowed,anon_allowed,
  authenticated_allowed,service_role_allowed,review_state,rationale,captured_at
)
select p.oid::regprocedure::text,p.proname,'definer',
  has_function_privilege('public',p.oid,'execute'),
  has_function_privilege('anon',p.oid,'execute'),
  has_function_privilege('authenticated',p.oid,'execute'),
  has_function_privilege('service_role',p.oid,'execute'),
  'approved_client_rpc',case
    when p.proname in(
      'creator_set_team_role','creator_reassign_branch','manage_staff_permission'
    ) then 'Actor-bound authority mutation requiring Creator elevation or state-scoped Admin authority.'
    else 'Actor-bound canonical Activity read or read-state mutation.'
  end,now()
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.oid::regprocedure::text in(
  'creator_reassign_branch(text,text,text,uuid)',
  'creator_set_team_role(text,text,text,text,text,uuid)',
  'manage_staff_permission(text,text,boolean,uuid)',
  'get_my_canonical_activity(text,integer)',
  'mark_all_my_canonical_activity_read(text)',
  'mark_my_canonical_activity_read(uuid,text)'
)
on conflict(function_signature) do update set
  public_allowed=excluded.public_allowed,anon_allowed=excluded.anon_allowed,
  authenticated_allowed=excluded.authenticated_allowed,
  service_role_allowed=excluded.service_role_allowed,
  review_state=excluded.review_state,rationale=excluded.rationale,
  captured_at=excluded.captured_at;

update public.function_execution_registry set
  public_allowed=false,anon_allowed=false,authenticated_allowed=false,
  service_role_allowed=true,review_state='approved_service_only',
  rationale='Internal actor-bound helper; direct client execution removed 2026-09-13.',
  captured_at=now()
where function_signature in(
  'active_obligation_visibility(text,text)',
  'actor_can_open_case_for_subject(text,text,text)',
  'current_actor_can_access_operational_conversation(uuid,boolean)',
  'creator_set_team_role(text,text,text,text,text)',
  'creator_reassign_branch(text,text,text)'
);
