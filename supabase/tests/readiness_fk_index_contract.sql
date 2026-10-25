-- Assert FK lookup coverage on the actual replayed schema, independent of index names.
begin;
do $$
declare missing text[];
begin
 select array_agg(c.conname order by c.conname) into missing
 from pg_constraint c
 where c.contype='f' and c.connamespace='public'::regnamespace
 and c.conname=any(array[
  'email_account_challenges_auth_id_fkey',
  'email_account_challenges_device_session_id_fkey',
  'experience_activity_events_actor_user_id_fkey',
  'experience_session_events_actor_user_id_fkey',
  'friend_messages_reply_to_id_fkey',
  'hotel_bookings_cancellation_policy_version_id_fkey',
  'hotel_discounts_hotel_id_fkey',
  'hotel_discounts_rate_plan_id_fkey',
  'hotel_discounts_room_id_fkey',
  'hotel_rate_plans_cancellation_policy_version_id_fkey',
  'inspection_requests_document_requirements_set_by_fkey',
  'native_push_devices_auth_id_fkey',
  'native_push_jobs_activity_event_id_fkey',
  'native_push_jobs_user_id_fkey',
  'partner_pro_entitlements_last_payment_id_fkey',
  'partner_pro_entitlements_review_payment_id_fkey',
  'partner_pro_provider_events_payment_id_fkey',
  'partner_pro_arrival_instructions_owner_id_fkey',
  'property_change_requests_requested_by_fkey',
  'property_change_requests_reviewed_by_fkey',
  'property_submission_documents_reviewed_by_fkey',
  'reservations_short_stay_cancellation_policy_version_id_fkey',
  'reservations_short_stay_rate_terms_policy_version_id_fkey',
  'worker_credential_documents_reviewed_by_fkey',
  'worker_customer_record_consents_customer_id_fkey',
  'worker_pro_customer_notes_customer_id_fkey',
  'worker_pro_job_costs_booking_id_fkey',
  'worker_pro_provider_review_events_payment_id_fkey',
  'worker_pro_receipt_notes_booking_id_fkey',
  'worker_pro_reminders_booking_id_fkey',
  'worker_verifications_credential_requirements_set_by_fkey'
 ]::text[])
 and not exists (
   select 1 from pg_index i
   where i.indrelid=c.conrelid and i.indisvalid and i.indisready
     and i.indpred is null and i.indnkeyatts>=cardinality(c.conkey)
     and (i.indkey::smallint[])[0:cardinality(c.conkey)-1] @> c.conkey
 );
 if missing is not null then raise exception 'Missing FK lookup coverage: %',missing;end if;
 if (select count(*) from pg_constraint c where c.connamespace='public'::regnamespace and c.contype='f' and c.conname=any(array[
  'email_account_challenges_auth_id_fkey',
  'email_account_challenges_device_session_id_fkey',
  'experience_activity_events_actor_user_id_fkey',
  'experience_session_events_actor_user_id_fkey',
  'friend_messages_reply_to_id_fkey',
  'hotel_bookings_cancellation_policy_version_id_fkey',
  'hotel_discounts_hotel_id_fkey',
  'hotel_discounts_rate_plan_id_fkey',
  'hotel_discounts_room_id_fkey',
  'hotel_rate_plans_cancellation_policy_version_id_fkey',
  'inspection_requests_document_requirements_set_by_fkey',
  'native_push_devices_auth_id_fkey',
  'native_push_jobs_activity_event_id_fkey',
  'native_push_jobs_user_id_fkey',
  'partner_pro_entitlements_last_payment_id_fkey',
  'partner_pro_entitlements_review_payment_id_fkey',
  'partner_pro_provider_events_payment_id_fkey',
  'partner_pro_arrival_instructions_owner_id_fkey',
  'property_change_requests_requested_by_fkey',
  'property_change_requests_reviewed_by_fkey',
  'property_submission_documents_reviewed_by_fkey',
  'reservations_short_stay_cancellation_policy_version_id_fkey',
  'reservations_short_stay_rate_terms_policy_version_id_fkey',
  'worker_credential_documents_reviewed_by_fkey',
  'worker_customer_record_consents_customer_id_fkey',
  'worker_pro_customer_notes_customer_id_fkey',
  'worker_pro_job_costs_booking_id_fkey',
  'worker_pro_provider_review_events_payment_id_fkey',
  'worker_pro_receipt_notes_booking_id_fkey',
  'worker_pro_reminders_booking_id_fkey',
  'worker_verifications_credential_requirements_set_by_fkey'
 ]::text[]))<>31 then raise exception 'Expected readiness foreign keys were removed or renamed; review coverage';end if;
end $$;
rollback;
