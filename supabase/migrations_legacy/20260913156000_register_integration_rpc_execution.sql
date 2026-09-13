-- Record the final master-plan RPC surface after Pro, workspace, hotel/PMS and
-- accommodation-protection migrations. The Supabase advisor reports every
-- authenticated SECURITY DEFINER RPC; this registry is the function-by-
-- function review record and fails the migration if an expected grant drifts.

with approved(function_signature,review_state,rationale) as (
  values
    ('accept_current_worker_pro_terms()','approved_client_rpc','Signed-in Worker accepts the exact current Pro terms; the function binds the receipt to the current actor.'),
    ('create_worker_pro_web_payment()','approved_client_rpc','Signed-in Worker creates a Paystack checkout request; entitlement remains provider-verified.'),
    ('creator_set_worker_pro_setting(text,text)','approved_client_rpc','Creator-only configuration command with server-side Creator authorization and audit.'),
    ('get_my_accommodation_protection(text,text)','approved_client_rpc','Actor-scoped read of the caller accommodation protection and arrival issue eligibility.'),
    ('get_my_booking_conversations_v3(text)','approved_client_rpc','Actor-scoped canonical Worker booking and money read model.'),
    ('get_my_worker_pro()','approved_client_rpc','Actor-scoped read of the caller Pro subscription and entitlement.'),
    ('owner_request_hotel_pms_connection(integer,text,text)','approved_client_rpc','Hotel Owner may request, but cannot activate, a named PMS connection.'),
    ('report_my_accommodation_arrival_issue(text,text,text)','approved_client_rpc','Customer-only formal arrival issue command with booking ownership and deadline checks.'),
    ('current_actor_has_personal_workspace()','approved_policy_helper','Boolean current-actor workspace helper used by RLS and guarded commands.'),
    ('current_actor_has_workspace_role(text)','approved_policy_helper','Boolean current-actor workspace-role helper used by RLS and guarded commands.'),
    ('current_actor_hotel_capabilities(integer)','approved_policy_helper','Returns only the current actor effective capabilities for the named hotel.'),
    ('hotel_actor_has_any_capability(integer)','approved_policy_helper','Boolean current-actor hotel capability helper used by RLS.'),
    ('hotel_integration_owns_domain(integer,text)','approved_policy_helper','Boolean hotel authority-domain helper used by guarded manual operations.'),
    ('hotel_payment_protection_is_current(uuid)','approved_policy_helper','Boolean hotel payment-protection consistency helper used by check-in enforcement.'),
    ('worker_pro_is_active(text)','approved_policy_helper','Read-only active-Pro predicate used for server-authoritative entitlement presentation.')
)
insert into public.function_execution_registry(
  function_signature,function_name,security_mode,public_allowed,anon_allowed,
  authenticated_allowed,service_role_allowed,review_state,rationale,captured_at,
  reviewed_at,reviewed_by
)
select
  proc.oid::regprocedure::text,
  proc.proname,
  case when proc.prosecdef then 'definer' else 'invoker' end,
  has_function_privilege('public',proc.oid,'execute'),
  has_function_privilege('anon',proc.oid,'execute'),
  has_function_privilege('authenticated',proc.oid,'execute'),
  has_function_privilege('service_role',proc.oid,'execute'),
  approved.review_state,
  approved.rationale,
  now(),
  now(),
  null
from approved
join pg_proc proc on proc.oid::regprocedure::text=approved.function_signature
join pg_namespace namespace on namespace.oid=proc.pronamespace
  and namespace.nspname='public'
on conflict(function_signature) do update set
  function_name=excluded.function_name,
  security_mode=excluded.security_mode,
  public_allowed=excluded.public_allowed,
  anon_allowed=excluded.anon_allowed,
  authenticated_allowed=excluded.authenticated_allowed,
  service_role_allowed=excluded.service_role_allowed,
  review_state=excluded.review_state,
  rationale=excluded.rationale,
  captured_at=excluded.captured_at,
  reviewed_at=excluded.reviewed_at,
  reviewed_by=excluded.reviewed_by;

do $$
declare
  v_expected constant integer:=15;
  v_reviewed integer;
begin
  select count(*) into v_reviewed
  from public.function_execution_registry registry
  where registry.function_signature in(
    'accept_current_worker_pro_terms()',
    'create_worker_pro_web_payment()',
    'creator_set_worker_pro_setting(text,text)',
    'get_my_accommodation_protection(text,text)',
    'get_my_booking_conversations_v3(text)',
    'get_my_worker_pro()',
    'owner_request_hotel_pms_connection(integer,text,text)',
    'report_my_accommodation_arrival_issue(text,text,text)',
    'current_actor_has_personal_workspace()',
    'current_actor_has_workspace_role(text)',
    'current_actor_hotel_capabilities(integer)',
    'hotel_actor_has_any_capability(integer)',
    'hotel_integration_owns_domain(integer,text)',
    'hotel_payment_protection_is_current(uuid)',
    'worker_pro_is_active(text)'
  )
    and security_mode='definer'
    and not public_allowed
    and not anon_allowed
    and authenticated_allowed
    and service_role_allowed
    and review_state in('approved_client_rpc','approved_policy_helper');
  if v_reviewed<>v_expected then
    raise exception 'Master-plan function execution review drift: expected %, found %',
      v_expected,v_reviewed;
  end if;
end
$$;
