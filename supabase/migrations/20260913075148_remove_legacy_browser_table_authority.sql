-- Browser identities consume reviewed RPCs and RLS-scoped projections. They do
-- not need schema-management privileges, and authoritative lifecycle/money rows
-- must never be writable as ordinary PostgREST tables.

revoke truncate,references,trigger on all tables in schema public
from public,anon,authenticated;

revoke insert,update,delete,truncate,references,trigger on table
  public.booking_code_registry,
  public.booking_conversations,
  public.booking_messages,
  public.booking_payments,
  public.booking_status_history,
  public.booking_status_labels,
  public.canonical_wallet_release_receipts,
  public.case_reason_registry,
  public.caution_claims,
  public.caution_evidence,
  public.commission_ledger,
  public.hotel_booking_conversations,
  public.hotel_booking_messages,
  public.hotel_bookings,
  public.ledger_accounts,
  public.ledger_entries,
  public.ledger_transactions,
  public.long_let_reservation_transitions,
  public.operational_case_events,
  public.operational_case_evidence,
  public.operational_cases,
  public.payment_protection_transactions,
  public.payment_protection_transitions,
  public.payment_reversals,
  public.payments,
  public.payout_account_change_requests,
  public.rent_plan_contributions,
  public.reservation_refunds,
  public.reservations,
  public.shared_payment_groups,
  public.shared_payment_members,
  public.shared_payment_protection_components,
  public.short_let_booking_transitions,
  public.support_case_events,
  public.wallet_balances,
  public.wallet_transactions,
  public.wallets,
  public.worker_booking_reviews,
  public.worker_bookings,
  public.worker_showcase_comments,
  public.worker_showcase_posts,
  public.worker_showcase_reactions
from public,anon,authenticated;

-- This permissive legacy insert policy encoded the old mutually-exclusive
-- `profiles.role = user` generation. Hotel checkout is now RPC-only and checks
-- permanent Personal authority before taking a dated inventory lock.
drop policy if exists hotel_bookings_customer_insert_v2
on public.hotel_bookings;

do $$
declare
  v_table text;
begin
  if exists(
    select 1
    from information_schema.role_table_grants grant_row
    where grant_row.table_schema='public'
      and grant_row.grantee in('PUBLIC','anon','authenticated')
      and grant_row.privilege_type in('TRUNCATE','REFERENCES','TRIGGER')
  ) then
    raise exception 'Browser role still has a public schema-management table privilege';
  end if;

  foreach v_table in array array[
    'booking_code_registry','booking_conversations','booking_messages',
    'booking_payments','booking_status_history','booking_status_labels',
    'canonical_wallet_release_receipts','case_reason_registry','caution_claims',
    'caution_evidence','commission_ledger','hotel_booking_conversations',
    'hotel_booking_messages','hotel_bookings','ledger_accounts','ledger_entries',
    'ledger_transactions','long_let_reservation_transitions',
    'operational_case_events','operational_case_evidence','operational_cases',
    'payment_protection_transactions','payment_protection_transitions',
    'payment_reversals','payments','payout_account_change_requests',
    'rent_plan_contributions','reservation_refunds','reservations',
    'shared_payment_groups','shared_payment_members',
    'shared_payment_protection_components','short_let_booking_transitions',
    'support_case_events','wallet_balances','wallet_transactions','wallets',
    'worker_booking_reviews','worker_bookings','worker_showcase_comments',
    'worker_showcase_posts','worker_showcase_reactions'
  ] loop
    if has_table_privilege('anon',format('public.%I',v_table),'INSERT')
      or has_table_privilege('anon',format('public.%I',v_table),'UPDATE')
      or has_table_privilege('anon',format('public.%I',v_table),'DELETE')
      or has_table_privilege('authenticated',format('public.%I',v_table),'INSERT')
      or has_table_privilege('authenticated',format('public.%I',v_table),'UPDATE')
      or has_table_privilege('authenticated',format('public.%I',v_table),'DELETE')
    then
      raise exception 'Direct browser mutation remains on authoritative table %',v_table;
    end if;
  end loop;
end
$$;

comment on table public.hotel_bookings is
  'Authoritative Hotel stay lifecycle. Browser reads are policy-scoped; creation and transitions use reviewed RPCs only.';
