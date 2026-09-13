alter function public.canonical_product_transition_allowed(text,text,text)
set search_path to pg_catalog,public;
do $policies$
declare v_table text;
begin
  foreach v_table in array array[
    'caution_claims','caution_evidence','creator_elevation_grants',
    'financial_action_outbox','hotel_stay_transitions','ledger_accounts',
    'ledger_entries','ledger_transactions','long_let_reservation_transitions',
    'obligation_policy_snapshots','payment_protection_transitions',
    'payout_account_change_requests','shared_payment_groups',
    'shared_payment_members','short_let_booking_transitions',
    'verified_provider_events','worker_booking_reviews',
    'worker_completion_reminder_requests','worker_job_transitions',
    'worker_user_blocks'
  ] loop
    if to_regclass('public.'||v_table) is not null then
      execute format('drop policy if exists canonical_rpc_only on public.%I',v_table);
      execute format('create policy canonical_rpc_only on public.%I for all to anon, authenticated using (false) with check (false)',v_table);
    end if;
  end loop;
end
$policies$;
