-- Cover ownership and audit foreign keys used by deletion, revocation and
-- incident investigation. These indexes do not grant access to any records.
create index if not exists property_commercial_change_actor_idx
  on public.property_commercial_change_log(actor_user_id);
create index if not exists property_host_date_blocks_created_by_idx
  on public.property_host_date_blocks(created_by);
create index if not exists property_host_date_blocks_reopened_by_idx
  on public.property_host_date_blocks(reopened_by);
create index if not exists resource_invitations_accepted_user_idx
  on public.resource_invitations(accepted_user_id);
create index if not exists resource_invitations_inviter_user_idx
  on public.resource_invitations(inviter_user_id);
create index if not exists sponsored_market_rules_updated_by_idx
  on public.sponsored_market_rules(updated_by);
create index if not exists sponsored_placements_viewer_idx
  on public.sponsored_placements(viewer_user_id);
create index if not exists worker_market_capacity_updated_by_idx
  on public.worker_market_capacity(updated_by);
create index if not exists worker_publication_controls_updated_by_idx
  on public.worker_publication_controls(updated_by);
