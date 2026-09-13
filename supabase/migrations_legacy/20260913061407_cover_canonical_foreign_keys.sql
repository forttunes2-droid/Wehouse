-- Cover every foreign key reported by the preview advisor after the canonical
-- schema was applied. These indexes protect lifecycle deletes/updates and the
-- operational joins used by Finance, Hotels, Workers and shared payments.

create index if not exists canonical_fk_unprotected_wallet_tx
  on public.canonical_unprotected_settlement_receipts(wallet_transaction_id);
create index if not exists canonical_fk_unprotected_policy
  on public.canonical_unprotected_settlement_receipts(policy_version_id);
create index if not exists canonical_fk_unprotected_payee
  on public.canonical_unprotected_settlement_receipts(payee_user_id);
create index if not exists canonical_fk_unprotected_wallet
  on public.canonical_unprotected_settlement_receipts(wallet_id);

create index if not exists canonical_fk_release_ledger_tx
  on public.canonical_wallet_release_receipts(ledger_transaction_id);
create index if not exists canonical_fk_release_payee
  on public.canonical_wallet_release_receipts(payee_user_id);
create index if not exists canonical_fk_release_protection
  on public.canonical_wallet_release_receipts(payment_protection_id);
create index if not exists canonical_fk_release_wallet
  on public.canonical_wallet_release_receipts(wallet_id);
create index if not exists canonical_fk_release_wallet_tx
  on public.canonical_wallet_release_receipts(wallet_transaction_id);

create index if not exists canonical_fk_caution_shared_group
  on public.caution_claims(shared_payment_group_id);
create index if not exists canonical_fk_hotel_message_sender
  on public.hotel_booking_messages(sender_id);
create index if not exists canonical_fk_hotel_booking_integration
  on public.hotel_bookings(integration_id);
create index if not exists canonical_fk_hotel_booking_protection
  on public.hotel_bookings(payment_protection_id);
create index if not exists canonical_fk_hotel_booking_policy
  on public.hotel_bookings(policy_version_id);
create index if not exists canonical_fk_hotel_inventory_updater
  on public.hotel_inventory_daily(updated_by);
create index if not exists canonical_fk_hotel_team_inviter
  on public.hotel_team_members(invited_by);
create index if not exists canonical_fk_inspection_evidence_reviewer
  on public.inspection_requests(field_evidence_reviewed_by);

create index if not exists canonical_fk_protection_protected_ledger
  on public.payment_protection_transactions(protected_ledger_transaction_id);
create index if not exists canonical_fk_protection_refund_ledger
  on public.payment_protection_transactions(refund_ledger_transaction_id);
create index if not exists canonical_fk_protection_release_ledger
  on public.payment_protection_transactions(release_ledger_transaction_id);
create index if not exists canonical_fk_submission_inspection
  on public.property_submission_items(inspection_request_id);

create index if not exists canonical_fk_reservation_caution_protection
  on public.reservations(caution_payment_protection_id);
create index if not exists canonical_fk_reservation_commission_policy
  on public.reservations(commission_policy_version_id);
create index if not exists canonical_fk_reservation_hold_policy
  on public.reservations(reservation_policy_version_id);
create index if not exists canonical_fk_reservation_stay_protection
  on public.reservations(stay_payment_protection_id);
create index if not exists canonical_fk_reservation_rent_protection
  on public.reservations(year_one_rent_protection_id);
create index if not exists canonical_fk_saved_hotel
  on public.saved_hotels(hotel_id);

create index if not exists canonical_fk_shared_legacy_listing
  on public.shared_housing_groups(listing_id);
create index if not exists canonical_fk_shared_legacy_reservation
  on public.shared_housing_groups(reservation_id);
create index if not exists canonical_fk_shared_component_group
  on public.shared_payment_protection_components(shared_payment_group_id);
create index if not exists canonical_fk_case_event_actor
  on public.support_case_events(actor_id);

create index if not exists canonical_fk_worker_review_customer
  on public.worker_booking_reviews(user_id);
create index if not exists canonical_fk_worker_review_worker
  on public.worker_booking_reviews(worker_id);
create index if not exists canonical_fk_worker_booking_protection
  on public.worker_bookings(payment_protection_id);
create index if not exists canonical_fk_worker_booking_policy
  on public.worker_bookings(policy_version_id);
create index if not exists canonical_fk_worker_booking_subcategory
  on public.worker_bookings(service_subcategory_id);
create index if not exists canonical_fk_worker_reaction_user
  on public.worker_showcase_reactions(user_id);

create index if not exists canonical_fk_workspace_grantor
  on public.workspace_role_assignments(granted_by);
create index if not exists canonical_fk_workspace_revoker
  on public.workspace_role_assignments(revoked_by);
