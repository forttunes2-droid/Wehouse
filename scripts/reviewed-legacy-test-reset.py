"""Print the single reviewed 2026-09-20 test reset; default execution rolls back.

This is not a general wipe or a migration. It has no credentials and performs no
network calls. The owner confirmed all payments are Test and corrected scope to
records that still violate newer rules. Showcase and compliant data stay intact.
An operator must review the rollback manifest before running --mode apply.
"""
import argparse

PAYMENTS = [
    '3d345710-81f2-4b92-9450-b6ebc33e9dc4', 'd6fbc99f-5704-4565-b7a1-4732fd09edea',
    'a1f8e48a-0998-4dd1-b5e7-17a957493278', 'a607a11b-1d91-478d-91db-7c380570dfa3',
    'f0d0e725-a533-4b47-b740-cd84822d5fec', '9f8a8bc9-41f9-4e98-aa5f-fa3ec4c71186',
    'fcece87e-ca8b-4d78-8e9c-90237e2c1acf', 'b4d12109-47d5-4f9c-901b-e4001b286a62',
    '36d8643d-29c0-4901-9403-a20400c2c969', 'a95c9a20-5030-4464-9e18-c45f943ce54e',
]
WORKERS = ['133a0699-ef51-4f17-910f-4e2502df4958', 'd09a8c6d-13d1-49a9-b5cf-25960c979bba']
RESERVATION = 'e1aca208-af5c-454b-8bc5-0cb2c9c38ccf'
RESET_ID = 'reviewed-legacy-test-records-2026-09-20'


def quoted(values):
    return ','.join("'" + value.replace("'", "''") + "'" for value in values)


def sql(mode='check'):
    # Explicit dependency order. No wildcard deletes or trigger bypasses.
    rules = {
        'booking_messages': 'conversation_id in (select id from wh_worker_threads)',
        'hotel_booking_messages': 'conversation_id in (select id from wh_hotel_threads)',
        'support_case_events': 'conversation_id in (select id from wh_help_threads)',
        'support_message_drafts': 'conversation_id in (select id from wh_help_threads)',
        'partner_support_messages': 'conversation_id in (select id from wh_help_threads)',
        'conversation_key_envelopes': "conversation_id in (select id from wh_worker_threads union select id from wh_help_threads)",
        'booking_conversations': 'id in (select id from wh_worker_threads)',
        'hotel_booking_conversations': 'id in (select id from wh_hotel_threads)',
        'booking_status_history': 'booking_id in (select id from wh_workers)',
        'worker_booking_reviews': 'booking_id in (select id from wh_workers)',
        'rent_plan_cancellations': 'rent_plan_id in (select id from wh_rent_plans)',
        'rent_plan_contributions': 'reservation_id in (select id from wh_reservations) or rent_plan_id in (select id from wh_rent_plans)',
        'rent_plans': 'id in (select id from wh_rent_plans)',
        'user_inspection_requests': 'reservation_id in (select id from wh_reservations)',
        'activity_event_audiences': 'activity_event_id in (select activity_event_id from wh_activity)',
        'activity_events': 'activity_event_id in (select activity_event_id from wh_activity)',
        'notifications': 'id in (select id from wh_notifications)',
        'commission_ledger': 'payment_id in (select id from wh_payments)',
        'verified_paystack_references': 'booking_payment_id in (select id from wh_payments)',
        'wallet_transactions': 'id in (select id from wh_wallet_transactions)',
        'property_partner_earning_releases': 'payment_id in (select id from wh_payments)',
        'booking_payments': 'id in (select id from wh_payments)',
        'worker_bookings': 'id in (select id from wh_workers)',
        'hotel_bookings': 'booking_id in (select booking_id from wh_hotels)',
        'reservations': 'id in (select id from wh_reservations)',
        'partner_support_conversations': 'id in (select id from wh_help_threads)',
        'payment_protection_transactions': 'id in (select id from wh_protection)',
    }
    preserved = {
        'auth.users': 'to_jsonb(t)',
        'public.profiles': "to_jsonb(t)-'rating'-'review_count'-'updated_at'",
        'public.workspace_role_assignments': 'to_jsonb(t)',
        'public.worker_verifications': 'to_jsonb(t)',
        'public.worker_identity_checks': 'to_jsonb(t)',
        'public.worker_showcase_posts': 'to_jsonb(t)',
        'public.hotels': 'to_jsonb(t)',
        'public.hotel_rooms': 'to_jsonb(t)',
        'public.hotel_room_units': 'to_jsonb(t)',
        'public.ledger_transactions': 'to_jsonb(t)',
        'public.ledger_entries': 'to_jsonb(t)',
        'public.financial_action_outbox': 'to_jsonb(t)',
        'public.platform_settings': 'to_jsonb(t)',
        'supabase_migrations.schema_migrations': 'to_jsonb(t)',
    }
    out = [f"""begin isolation level serializable;
set local lock_timeout='5s';
set local statement_timeout='90s';
do $$ begin
  if not pg_try_advisory_xact_lock(hashtext('wehouse-coordinated-release')) then raise exception 'Another release is active'; end if;
  if not exists(select 1 from platform_settings where key='payment_test_mode' and value='true' and is_active) then raise exception 'Test mode required'; end if;
  if exists(select 1 from wehouse_maintenance.test_record_resets where reset_id='{RESET_ID}') then raise exception 'Reset already applied'; end if;
  if exists(select 1 from financial_action_outbox) or exists(select 1 from withdrawals)
    or exists(select 1 from withdrawal_requests) or exists(select 1 from payment_reversals)
    or exists(select 1 from reservation_refunds) then raise exception 'Unexpected financial obligations; stop and review'; end if;
end $$;
lock table booking_payments,worker_bookings,hotel_bookings,reservations,payment_protection_transactions,
  wallets,property_partner_earning_releases in share row exclusive mode;
create temp table wh_payments on commit drop as select * from booking_payments where id in ({quoted(PAYMENTS)});
create temp table wh_workers on commit drop as select * from worker_bookings where id in ({quoted(WORKERS)});
create temp table wh_hotels on commit drop as select * from hotel_bookings where booking_id in (14,15);
create temp table wh_reservations on commit drop as select * from reservations where id='{RESERVATION}';
create temp table wh_protection on commit drop as select * from payment_protection_transactions where subject_type='worker_booking' and subject_id in (select id::text from wh_workers);
create temp table wh_worker_threads on commit drop as select * from booking_conversations where booking_id in (select id from wh_workers);
create temp table wh_hotel_threads on commit drop as select * from hotel_booking_conversations where booking_id in (select booking_id from wh_hotels);
create temp table wh_help_threads on commit drop as select * from partner_support_conversations where context_type='apartment_reservation' and context_id='{RESERVATION}';
create temp table wh_rent_plans on commit drop as select * from rent_plans where reservation_id='{RESERVATION}';
create temp table wh_wallet_transactions on commit drop as select * from wallet_transactions where
  (reference_type='booking_payment' and reference_id in (select id::text from wh_payments))
  or id='b934be7b-462e-4ddd-ae57-6e87fc6bc457';
create temp table wh_subjects(kind text,id text) on commit drop;
insert into wh_subjects select kind,id::text from wh_workers cross join unnest(array['worker_booking','worker_job']) kind;
insert into wh_subjects select kind,booking_id::text from wh_hotels cross join unnest(array['hotel_booking','hotel_stay']) kind;
insert into wh_subjects select kind,id::text from wh_reservations cross join unnest(array['apartment_reservation','reservation','long_let_reservation']) kind;
insert into wh_subjects select kind,id::text from wh_payments cross join unnest(array['booking_payment','payment']) kind;
create temp table wh_activity on commit drop as select * from activity_events a where exists(select 1 from wh_subjects s where s.kind=a.subject_type and s.id=a.subject_id);
create temp table wh_notifications on commit drop as select * from notifications n where
 exists(select 1 from wh_subjects s where s.kind=n.source_type and s.id=n.source_id)
 or n.related_id in (select id::text from wh_workers union select id::text from wh_reservations union select id::text from wh_payments)
 or (n.type like 'hotel_%' and n.related_id in ('14','15'));
create temp table wh_wallet_deltas on commit drop as
 select w.id,sum(e.net_amount) pending,0::numeric available from wallets w
 join property_partner_earning_releases e on e.partner_id=w.owner_id and w.owner_type='property_partner'
 where e.payment_id in (select id from wh_payments) and e.status='pending' group by w.id
 union all select w.id,0::numeric,sum(p.amount_payee) from wallets w join wh_protection p
 on p.payee_user_id=w.owner_id and w.owner_type='worker' where p.status='released' group by w.id;
do $$ begin
 if (select count(*) from wh_payments)<>10 or (select count(*) from wh_payments where status='paid')<>8
   or (select count(*) from wh_payments where status='pending')<>2
   or (select sum(verified_amount) from wh_payments where status='paid')<>210000 then raise exception 'Payment manifest changed'; end if;
 if (select count(*) from wh_workers)<>2 or exists(select 1 from wh_workers where payment_protection_id is not null or policy_version_id is not null)
   or (select count(*) from wh_hotels)<>2 or exists(select 1 from wh_hotels where payment_protection_id is not null or policy_version_id is not null)
   or (select count(*) from wh_reservations)<>1 or exists(select 1 from wh_reservations where year_one_rent_protection_id is not null or reservation_policy_version_id is not null)
   then raise exception 'A target now follows current rules; stop and review'; end if;
 if (select count(*) from wh_protection)<>2 or exists(select 1 from wh_protection where protected_ledger_transaction_id is not null or release_ledger_transaction_id is not null or refund_ledger_transaction_id is not null)
   then raise exception 'Canonical money must be preserved'; end if;
 if (select sum(pending) from wh_wallet_deltas)<>162010 or (select sum(available) from wh_wallet_deltas)<>6370
   or exists(select 1 from wh_wallet_deltas d join wallets w using(id) where w.pending_balance<>d.pending or w.available_balance<>d.available or w.frozen_balance<>0 or w.total_withdrawn<>0)
   or (select count(*) from wh_wallet_transactions)<>4 then raise exception 'Wallet reconciliation changed'; end if;
 if exists(select 1 from worker_showcase_posts where booking_id in (select id from wh_workers))
   or exists(select 1 from hotel_room_units where current_booking_id in (14,15)) then raise exception 'Unexpected valid supply dependency'; end if;
 if not exists(select 1 from hotel_bookings b join payment_protection_transactions p on p.id=b.payment_protection_id
   where b.booking_id=16 and b.policy_version_id is not null and p.protected_ledger_transaction_id is not null)
   then raise exception 'Compliant hotel stay changed'; end if;
end $$;
create temp table wh_before(name text primary key,rows jsonb) on commit drop;
create temp table wh_preserved(name text primary key,digest text) on commit drop;
"""]
    for table, expr in preserved.items():
        digest = f"select md5(coalesce(string_agg(row::text,'' order by row::text),'')) from (select {expr} row from {table} t) rows"
        out.append(f"insert into wh_preserved values ('{table}',({digest}));")
    unaffected = {
        'booking_payments': 'id not in (select id from wh_payments)',
        'hotel_bookings': 'booking_id not in (14,15)',
        'hotel_booking_conversations': 'booking_id not in (14,15)',
        'hotel_booking_messages': 'conversation_id not in (select id from wh_hotel_threads)',
        'reservations': f"id<>'{RESERVATION}'",
        'payment_protection_transactions': 'id not in (select id from wh_protection)',
        'listings': f"current_reservation_id is distinct from '{RESERVATION}'",
    }
    for table, condition in unaffected.items():
        out.append(f"insert into wh_preserved values ('unaffected.{table}',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) from public.{table} t where {condition}));")
    for table, condition in {**rules, 'wallets':'id in (select id from wh_wallet_deltas)', 'listings':f"current_reservation_id='{RESERVATION}'"}.items():
        out.append(f"insert into wh_before select '{table}',coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from public.{table} t where {condition};")
    out.append(f"""insert into wehouse_maintenance.test_record_resets(reset_id,reason,owner_confirmed_test,before_rows,manifest)
select '{RESET_ID}','Owner-confirmed Test only: obsolete verification charges and bookings without current protection/policy records. Preserve valid supply, Showcase and compliant transactions.',true,
 jsonb_object_agg(name,rows),jsonb_object_agg(name,jsonb_array_length(rows)) from wh_before;
update wallets w set pending_balance=w.pending_balance-d.pending,available_balance=w.available_balance-d.available,updated_at=now() from wh_wallet_deltas d where w.id=d.id;
update listings set current_reservation_id=null,reserved_by=null,reservation_expiry=null,
 reservation_fee_paid=false,chat_unlocked=false,status='available',availability_status='available',updated_at=now()
 where current_reservation_id='{RESERVATION}' and occupied_by is null;
""")
    for table, condition in rules.items():
        out.append(f"delete from public.{table} where {condition};")
    for table, expr in preserved.items():
        digest = f"select md5(coalesce(string_agg(row::text,'' order by row::text),'')) from (select {expr} row from {table} t) rows"
        out.append(f"do $$ begin if (select digest from wh_preserved where name='{table}') is distinct from ({digest}) then raise exception 'Preserved records changed: {table}'; end if; end $$;")
    for table, condition in unaffected.items():
        # The released listing changes its current reservation, so identify the
        # original unaffected set using its stable ID captured before mutation.
        if table == 'listings':
            condition = "id::text not in (select row->>'id' from wh_before,jsonb_array_elements(rows) row where name='listings')"
        out.append(f"do $$ begin if (select digest from wh_preserved where name='unaffected.{table}') is distinct from (select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) from public.{table} t where {condition}) then raise exception 'Unaffected {table} changed'; end if; end $$;")
    out.append(f"""do $$ begin
 if exists(select 1 from booking_payments where id in (select id from wh_payments))
   or exists(select 1 from wallets w join wh_wallet_deltas d using(id) where w.available_balance<>0 or w.pending_balance<>0)
   or exists(select 1 from listings where current_reservation_id='{RESERVATION}' or (id::text in (select listing_id::text from wh_reservations) and status<>'available'))
   then raise exception 'Reset postconditions failed'; end if;
end $$;
select reset_id,manifest,'{mode}' as execution_mode from wehouse_maintenance.test_record_resets where reset_id='{RESET_ID}';
{'commit' if mode=='apply' else 'rollback'};
""")
    return '\n'.join(out)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=['check','apply'], default='check')
    print(sql(parser.parse_args().mode))
