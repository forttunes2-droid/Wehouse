-- ═══════════════════════════════════════════════════════════════════
-- COMPLETE READ-ONLY LIVE DATABASE AUDIT
-- WeHouse Nigeria — 2025-07-30
-- 
-- INSTRUCTIONS: Run each numbered block separately in Supabase SQL Editor.
-- All statements are SELECT — no modifications.
-- Copy results and send them all back.
-- ═══════════════════════════════════════════════════════════════════

-- ================================================================
-- BLOCK 1: ALL TABLES IN PUBLIC SCHEMA (alphabetical)
-- ================================================================
SELECT 
  tablename,
  pg_size_pretty(pg_total_relation_size('public.' || tablename)) as size
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY tablename;

-- ================================================================
-- BLOCK 2: COLUMNS FOR EVERY TABLE (complete)
-- ================================================================
SELECT 
  c.table_name,
  c.column_name,
  c.data_type,
  c.is_nullable,
  c.column_default
FROM information_schema.columns c
WHERE c.table_schema = 'public'
ORDER BY c.table_name, c.ordinal_position;

-- ================================================================
-- BLOCK 3: PRIMARY KEYS
-- ================================================================
SELECT
  tc.table_name,
  kcu.column_name,
  tc.constraint_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu 
  ON tc.constraint_name = kcu.constraint_name AND tc.table_name = kcu.table_name
WHERE tc.table_schema = 'public' AND tc.constraint_type = 'PRIMARY KEY'
ORDER BY tc.table_name;

-- ================================================================
-- BLOCK 4: FOREIGN KEYS
-- ================================================================
SELECT
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table,
  ccu.column_name AS foreign_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu 
  ON tc.constraint_name = kcu.constraint_name AND tc.table_name = kcu.table_name
JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_name = ccu.constraint_name
WHERE tc.table_schema = 'public' AND tc.constraint_type = 'FOREIGN KEY'
ORDER BY tc.table_name;

-- ================================================================
-- BLOCK 5: UNIQUE CONSTRAINTS
-- ================================================================
SELECT
  tc.table_name,
  kcu.column_name,
  tc.constraint_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu 
  ON tc.constraint_name = kcu.constraint_name AND tc.table_name = kcu.table_name
WHERE tc.table_schema = 'public' AND tc.constraint_type = 'UNIQUE'
ORDER BY tc.table_name, tc.constraint_name;

-- ================================================================
-- BLOCK 6: CHECK CONSTRAINTS
-- ================================================================
SELECT
  conrelid::regclass AS table_name,
  conname AS constraint_name,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE contype = 'c'
  AND conrelid::regclass::text NOT LIKE 'pg_%'
  AND conrelid::regclass::text NOT LIKE 'auth_%'
  AND conrelid::regclass::text NOT LIKE 'storage_%'
  AND conrelid::regclass::text NOT LIKE 'realtime_%'
ORDER BY table_name, constraint_name;

-- ================================================================
-- BLOCK 7: INDEXES
-- ================================================================
SELECT 
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- ================================================================
-- BLOCK 8: RLS ENABLED STATUS
-- ================================================================
SELECT 
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;

-- ================================================================
-- BLOCK 9: RLS POLICIES
-- ================================================================
SELECT
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual AS using_expr
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- ================================================================
-- BLOCK 10: TRIGGERS
-- ================================================================
SELECT
  event_object_table AS table_name,
  trigger_name,
  event_manipulation AS event,
  action_timing AS timing
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY table_name, trigger_name;

-- ================================================================
-- BLOCK 11: ALL FUNCTIONS IN PUBLIC SCHEMA
-- ================================================================
SELECT 
  p.proname AS function_name,
  pg_get_function_arguments(p.oid) AS arguments,
  pg_get_function_result(p.oid) AS return_type,
  CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END AS security
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
ORDER BY p.proname;

-- ================================================================
-- BLOCK 12: ENUM TYPES
-- ================================================================
SELECT 
  t.typname AS enum_name,
  e.enumlabel AS value
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
JOIN pg_namespace n ON t.typnamespace = n.oid
WHERE n.nspname = 'public'
ORDER BY t.typname, e.enumsortorder;

-- ================================================================
-- BLOCK 13: VIEWS
-- ================================================================
SELECT viewname, definition FROM pg_views WHERE schemaname = 'public' ORDER BY viewname;

-- ================================================================
-- BLOCK 14: TABLE EXISTENCE CHECK
-- ================================================================
WITH expected(tname) AS (VALUES
  ('profiles'), ('platform_settings'), ('wallets'), ('wallet_transactions'),
  ('wallet_balances'), ('escrow_transactions'), ('withdrawals'), ('withdrawal_requests'),
  ('worker_bookings'), ('booking_conversations'), ('booking_messages'),
  ('booking_status_history'), ('booking_status_labels'), ('hotel_bookings'),
  ('payments'), ('reservations'), ('user_inspection_requests'),
  ('staff_permissions'), ('support_tickets'), ('listings'), ('hotels'),
  ('conversations'), ('messages'), ('announcements'),
  ('booking_payments'), ('commission_ledger'), ('financial_audit_logs'),
  ('rent_plan_snapshots'), ('rent_plan_contributions'), ('rent_plan_cancellations'),
  ('payment_reversals'), ('bank_account_history'), ('verified_paystack_references'),
  ('blue_badge_subscriptions'), ('worker_payments'), ('reviews'),
  ('notifications'), ('property_types'), ('service_categories'),
  ('enquiries'), ('listing_reports'), ('admin_audit_log')
)
SELECT 
  e.tname AS table_name,
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = e.tname) AS exists
FROM expected e
ORDER BY e.tname;

-- ================================================================
-- BLOCK 15: FUNCTION EXISTENCE CHECK
-- ================================================================
WITH expected(fname) AS (VALUES
  ('credit_wallet'), ('release_escrow'), ('refund_escrow'),
  ('record_worker_verification_payment'), ('customer_confirm_payment'),
  ('customer_confirm_completion'), ('confirm_booking_payment'),
  ('process_withdrawal'), ('request_withdrawal'), ('request_withdrawal_v2'),
  ('create_withdrawal_with_snapshot'), ('create_worker_booking_v2'),
  ('worker_start_job'), ('worker_mark_complete'), ('worker_accept_booking'),
  ('get_setting_v2'), ('get_all_settings_v2'), ('set_setting_v2'),
  ('reverse_payment'), ('create_rent_plan'), ('cancel_rent_plan'),
  ('reservation_expiry'), ('process_reservation_refund'),
  ('create_booking_payment'), ('expire_overdue_reservations'),
  ('get_staff_branch_analytics'), ('get_staff_activity'),
  ('set_apartment_commission_on_reservation')
)
SELECT 
  e.fname AS function_name,
  EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid 
          WHERE n.nspname = 'public' AND p.proname = e.fname) AS exists
FROM expected e
ORDER BY e.fname;

-- ================================================================
-- BLOCK 16: MIGRATION 1 + 2 VERIFICATION
-- ================================================================
SELECT 
  'platform_settings.category' AS check_item,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'platform_settings' AND column_name = 'category') AS exists
UNION ALL SELECT 'platform_settings.is_active',
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'platform_settings' AND column_name = 'is_active')
UNION ALL SELECT 'reservation_refunds table',
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'reservation_refunds')
UNION ALL SELECT 'rent_plan_snapshots table',
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'rent_plan_snapshots')
UNION ALL SELECT 'rent_plan_contributions table',
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'rent_plan_contributions')
UNION ALL SELECT 'get_staff_branch_analytics function',
  EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'get_staff_branch_analytics')
UNION ALL SELECT 'create_rent_plan function',
  EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'create_rent_plan');
