-- Close the authenticated SECURITY DEFINER review queue without breaking RLS.
--
-- Categories are explicit:
--   * approved_policy_helper: actor-bound predicates invoked by RLS policies;
--   * approved_client_rpc: reviewed actor-bound product APIs, including the two
--     deliberately dynamic call sites in the app/Edge Functions;
--   * approved_service_only: legacy, superseded, or internal functions whose
--     direct signed-in execution is no longer part of the product contract.

alter table public.function_execution_registry
  drop constraint if exists function_execution_registry_review_state_check;
alter table public.function_execution_registry
  add constraint function_execution_registry_review_state_check
  check(review_state in(
    'requires_review','approved_public_projection','approved_client_rpc',
    'approved_policy_helper','approved_service_only','retired'
  ));

with policy_helpers(function_name) as (
  values
    ('can_access_hotel_booking_conversation'),
    ('can_access_my_conversation'),
    ('can_current_actor_read_profile'),
    ('current_actor_can_access_listing_ref'),
    ('current_actor_can_access_worker_booking'),
    ('current_actor_can_read_hotel_booking_record'),
    ('current_actor_can_read_hotel_record'),
    ('current_actor_has_workspace'),
    ('current_actor_hotel_role'),
    ('current_actor_in_scope'),
    ('current_profile_role'),
    ('current_staff_has_permission'),
    ('hotel_actor_has_capability'),
    ('is_current_announcement_sender'),
    ('is_current_creator')
)
update public.function_execution_registry r set
  review_state='approved_policy_helper',
  rationale='Actor-bound SECURITY DEFINER predicate required by an active row-level security policy.',
  captured_at=now()
from policy_helpers h
where r.function_name=h.function_name
  and r.security_mode='definer'
  and r.authenticated_allowed;

-- These actor-bound interfaces are canonical even when their UI arrives in a
-- later implementation slice. The three property earning actions are the
-- complete allowlist behind property-earning-action; the two activation RPCs
-- are selected by the Account workspace switch.
with canonical_client_rpc(function_name) as (
  values
    ('accept_effective_policy'),
    ('activate_my_property_partner_workspace'),
    ('activate_my_worker_workspace'),
    ('appeal_caution_resolution'),
    ('get_my_ledger_statement'),
    ('guest_respond_to_caution_claim'),
    ('guest_submit_short_let_check_in_evidence'),
    ('hold_property_partner_earning'),
    ('partner_raise_caution_claim'),
    ('record_caution_property_finding'),
    ('release_property_partner_earning'),
    ('resolve_caution_finance'),
    ('reverse_pending_property_partner_earning'),
    ('send_canonical_thread_message'),
    ('unblock_my_contact'),
    ('worker_request_completion_reminder')
)
update public.function_execution_registry r set
  review_state='approved_client_rpc',
  rationale=case
    when r.function_name in(
      'hold_property_partner_earning','release_property_partner_earning',
      'reverse_pending_property_partner_earning'
    ) then 'Actor-bound Finance or arrival action behind the fixed property-earning-action Edge Function allowlist.'
    when r.function_name in(
      'activate_my_property_partner_workspace','activate_my_worker_workspace'
    ) then 'Actor-bound Personal-account workspace activation selected by the Account workspace switch.'
    else 'Actor-bound canonical lifecycle API retained for the locked product contract.'
  end,
  captured_at=now()
from canonical_client_rpc c
where r.function_name=c.function_name
  and r.security_mode='definer'
  and r.authenticated_allowed;

-- No function may remain directly executable by a signed-in user while its
-- security review state is unresolved. SECURITY DEFINER owners and service
-- workers retain the internal execution path; RLS helpers were excluded above.
do $$
declare v record;
begin
  for v in
    select p.oid::regprocedure as procedure_identity
    from public.function_execution_registry r
    join pg_proc p on p.oid=r.function_signature::regprocedure::oid
    join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
    where r.security_mode='definer'
      and r.authenticated_allowed
      and r.review_state='requires_review'
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated',
      v.procedure_identity
    );
    execute format(
      'grant execute on function %s to service_role',
      v.procedure_identity
    );
  end loop;
end
$$;

update public.function_execution_registry r set
  public_allowed=has_function_privilege('public',r.function_signature,'execute'),
  anon_allowed=has_function_privilege('anon',r.function_signature,'execute'),
  authenticated_allowed=has_function_privilege('authenticated',r.function_signature,'execute'),
  service_role_allowed=has_function_privilege('service_role',r.function_signature,'execute'),
  review_state='approved_service_only',
  rationale='Legacy, superseded, or internal function; direct signed-in execution removed after application and dependency review.',
  captured_at=now()
where r.security_mode='definer'
  and r.review_state='requires_review';

do $$
begin
  if exists(
    select 1 from public.function_execution_registry
    where security_mode='definer'
      and authenticated_allowed
      and review_state='requires_review'
  ) then
    raise exception 'Authenticated SECURITY DEFINER review queue is not closed';
  end if;
end
$$;
