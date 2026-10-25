-- Cover confirmed FK lookups for cleanup, jobs, pricing and audit ownership.
-- Existing owner-first composite indexes cannot cover reverse FK lookups.
-- No data, grants, policies or product rules change. Fail rather than wait on locks.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create index if not exists email_account_challenges_auth_id_fk_idx on public.email_account_challenges(auth_id);
create index if not exists email_account_challenges_device_session_id_fk_idx on public.email_account_challenges(device_session_id);
create index if not exists experience_activity_events_actor_user_id_fk_idx on public.experience_activity_events(actor_user_id);
create index if not exists experience_session_events_actor_user_id_fk_idx on public.experience_session_events(actor_user_id);
create index if not exists friend_messages_reply_to_id_fk_idx on public.friend_messages(reply_to_id);
create index if not exists hotel_bookings_cancellation_policy_version_id_fk_idx on public.hotel_bookings(cancellation_policy_version_id);
create index if not exists hotel_discounts_hotel_id_fk_idx on public.hotel_discounts(hotel_id);
create index if not exists hotel_discounts_rate_plan_id_fk_idx on public.hotel_discounts(rate_plan_id);
create index if not exists hotel_discounts_room_id_fk_idx on public.hotel_discounts(room_id);
create index if not exists hotel_rate_plans_cancellation_policy_version_id_fk_idx on public.hotel_rate_plans(cancellation_policy_version_id);
create index if not exists inspection_requests_document_requirements_set_by_fk_idx on public.inspection_requests(document_requirements_set_by);
create index if not exists native_push_devices_auth_id_fk_idx on public.native_push_devices(auth_id);
create index if not exists native_push_jobs_activity_event_id_fk_idx on public.native_push_jobs(activity_event_id);
create index if not exists native_push_jobs_user_id_fk_idx on public.native_push_jobs(user_id);
create index if not exists property_arrival_instructions_owner_id_fk_idx on public.property_arrival_instructions(owner_id);
create index if not exists partner_pro_entitlements_last_payment_id_fk_idx on public.partner_pro_entitlements(last_payment_id);
create index if not exists partner_pro_entitlements_review_payment_id_fk_idx on public.partner_pro_entitlements(review_payment_id);
create index if not exists partner_pro_provider_events_payment_id_fk_idx on public.partner_pro_provider_events(payment_id);
create index if not exists property_change_requests_requested_by_fk_idx on public.property_change_requests(requested_by);
create index if not exists property_change_requests_reviewed_by_fk_idx on public.property_change_requests(reviewed_by);
create index if not exists property_submission_documents_reviewed_by_fk_idx on public.property_submission_documents(reviewed_by);
create index if not exists reservations_short_stay_cancellation_policy_version_id_fk_idx on public.reservations(short_stay_cancellation_policy_version_id);
create index if not exists reservations_short_stay_rate_terms_policy_version_id_fk_idx on public.reservations(short_stay_rate_terms_policy_version_id);
create index if not exists worker_credential_documents_reviewed_by_fk_idx on public.worker_credential_documents(reviewed_by);
create index if not exists worker_customer_record_consents_customer_id_fk_idx on public.worker_customer_record_consents(customer_id);
create index if not exists worker_pro_customer_notes_customer_id_fk_idx on public.worker_pro_customer_notes(customer_id);
create index if not exists worker_pro_job_costs_booking_id_fk_idx on public.worker_pro_job_costs(booking_id);
create index if not exists worker_pro_provider_review_events_payment_id_fk_idx on public.worker_pro_provider_review_events(payment_id);
create index if not exists worker_pro_receipt_notes_booking_id_fk_idx on public.worker_pro_receipt_notes(booking_id);
create index if not exists worker_pro_reminders_booking_id_fk_idx on public.worker_pro_reminders(booking_id);
create index if not exists worker_verifications_credential_requirements_set_by_fk_idx on public.worker_verifications(credential_requirements_set_by);
commit;
