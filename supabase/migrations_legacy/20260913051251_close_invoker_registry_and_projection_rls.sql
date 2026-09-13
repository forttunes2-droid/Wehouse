-- Close registry rows reopened by later CREATE OR REPLACE statements. These
-- functions are SECURITY INVOKER; classification still stays explicit.

create policy canonical_wallet_release_receipts_service_only
on public.canonical_wallet_release_receipts
for all to service_role using(true) with check(true);

create policy canonical_unprotected_settlement_receipts_service_only
on public.canonical_unprotected_settlement_receipts
for all to service_role using(true) with check(true);

update public.function_execution_registry set
  review_state='approved_policy_helper',
  rationale='Reviewed SECURITY INVOKER normalization or policy helper',
  captured_at=now()
where function_name in(
  'canonical_saved_search_criteria','hotel_capabilities_valid',
  'hotel_default_capabilities','infer_notification_workspace_scope',
  'wehouse_lga_key','wehouse_state_key'
);

update public.function_execution_registry set
  review_state='approved_client_rpc',
  rationale='Reviewed signed-in SECURITY INVOKER application RPC',
  captured_at=now()
where function_name in(
  'get_my_active_device_sessions','get_my_property_pipeline_v2',
  'mark_all_my_notifications_read','mark_my_notification_read',
  'record_my_user_activity','save_my_property_search',
  'verify_google_password_recovery'
);

update public.function_execution_registry set
  review_state='approved_public_projection',
  rationale='Effective public policy projection; underlying rows are disclosure-filtered',
  captured_at=now()
where function_name='get_effective_policy';

-- Production may retain PostgreSQL's default EXECUTE grant on immutable
-- helpers even when a clean replay does not. Close that drift before asserting
-- the review queue so the migration remains fail-closed on both histories.
revoke all on function public.canonical_product_transition_allowed(text,text,text)
from public,anon,authenticated,service_role;

update public.function_execution_registry set
  public_allowed=false,
  anon_allowed=false,
  authenticated_allowed=false,
  service_role_allowed=false,
  review_state='approved_service_only',
  rationale='Internal immutable lifecycle transition validator; no direct role execution grant',
  captured_at=now()
where function_signature='canonical_product_transition_allowed(text,text,text)';

revoke all on function public.hotel_allowed_capabilities()
from public,anon,authenticated,service_role;

update public.function_execution_registry set
  public_allowed=false,
  anon_allowed=false,
  authenticated_allowed=false,
  service_role_allowed=false,
  review_state='approved_policy_helper',
  rationale='Immutable hotel capability allowlist used only by reviewed capability predicates and commands',
  captured_at=now()
where function_signature='hotel_allowed_capabilities()';

do $$
begin
  if exists(
    select 1 from public.function_execution_registry
    where authenticated_allowed and review_state='requires_review'
  ) then raise exception 'Function execution review queue is not closed'; end if;
end
$$;
