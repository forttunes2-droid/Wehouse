-- Cover foreign keys introduced by the master-plan integration. These indexes
-- keep parent updates/deletes and operational joins from scanning child tables.

create index if not exists hotel_commercial_change_audit_actor_idx
  on public.hotel_commercial_change_audit(actor_user_id);

create index if not exists hotel_integrations_provider_idx
  on public.hotel_integrations(provider);

create index if not exists hotel_integrations_authorized_by_idx
  on public.hotel_integrations(hotel_authorized_by);

create index if not exists worker_pro_subscription_events_subscription_idx
  on public.worker_pro_subscription_events(subscription_id);
