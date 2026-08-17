DO $$
DECLARE fn record;
DECLARE service_only text[] := ARRAY[
  'confirm_worker_booking_payment','fulfill_apartment_rent_payment','fulfill_apartment_reservation_payment',
  'fulfill_hotel_booking_payment','fulfill_rent_plan_contribution_payment','lock_admin_staff_location',
  'log_settings_change','process_booking_payment','process_withdrawal','record_bank_account_change',
  'record_worker_verification_payment','refund_escrow','register_pending_property_partner_earning',
  'reject_withdrawal_v2','release_escrow','request_inspection_pause_expiry','request_withdrawal',
  'request_withdrawal_v2','reserve_lga_booking_code','reserve_listing_on_activation','reverse_payment',
  'review_my_staff_listing','save_verified_payout_account','set_reservation_expiry','set_setting_v2',
  'settle_verified_property_partner_payment','transition_inspection_status','upsert_my_bank_account',
  'worker_professional_profile_ready','worker_test_passed'
];
BEGIN
  FOR fn IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY(service_only)
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated',fn.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',fn.signature);
  END LOOP;
END
$$;
