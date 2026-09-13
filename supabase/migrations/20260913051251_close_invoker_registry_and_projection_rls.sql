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
  'save_my_property_search','verify_google_password_recovery'
);

update public.function_execution_registry set
  review_state='approved_public_projection',
  rationale='Effective public policy projection; underlying rows are disclosure-filtered',
  captured_at=now()
where function_name='get_effective_policy';

do $$
begin
  if exists(
    select 1 from public.function_execution_registry
    where authenticated_allowed and review_state='requires_review'
  ) then raise exception 'Function execution review queue is not closed'; end if;
end
$$;
