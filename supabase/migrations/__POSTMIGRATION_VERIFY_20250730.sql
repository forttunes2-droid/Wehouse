-- ═══════════════════════════════════════════════════════════════════
-- POST-MIGRATION READ-ONLY VERIFICATION
-- WeHouse Nigeria — 2025-07-30
-- Run each numbered block separately in Supabase SQL Editor.
-- All statements are SELECT — no modifications.
-- ═══════════════════════════════════════════════════════════════════

-- ================================================================
-- BLOCK 1: NEW TABLES — columns, types, defaults, constraints, PKs
-- ================================================================
SELECT 
  c.table_name,
  c.column_name,
  c.data_type,
  c.is_nullable,
  c.column_default
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name IN (
    'booking_payments', 'commission_ledger', 'verified_paystack_references',
    'payment_reversals', 'bank_account_history'
  )
ORDER BY c.table_name, c.ordinal_position;

-- ================================================================
-- BLOCK 2: EXISTING TABLES — verify they still exist
-- ================================================================
WITH expected(tname) AS (VALUES
  ('wallets'), ('wallet_transactions'), ('escrow_transactions'),
  ('withdrawals'), ('withdrawal_requests'), ('financial_audit_log'),
  ('financial_audit_logs'), ('worker_bookings'), ('support_tickets')
)
SELECT 
  e.tname AS table_name,
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = e.tname) AS exists,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = e.tname LIMIT 1) AS has_columns
FROM expected e
ORDER BY e.tname;

-- ================================================================
-- BLOCK 3: ALTERED COLUMNS — snapshot columns on withdrawals tables
-- ================================================================
SELECT 
  c.table_name,
  c.column_name,
  c.data_type,
  c.is_nullable,
  c.column_default
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name IN ('withdrawals', 'withdrawal_requests')
  AND c.column_name LIKE 'snapshot_%'
ORDER BY c.table_name, c.column_name;

-- ================================================================
-- BLOCK 4: CHECK CONSTRAINTS — actual definitions
-- ================================================================
SELECT
  conrelid::regclass AS table_name,
  conname AS constraint_name,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE contype = 'c'
  AND conrelid::regclass::text IN (
    'financial_audit_logs', 'support_tickets', 'withdrawals',
    'escrow_transactions', 'booking_payments', 'commission_ledger',
    'verified_paystack_references', 'payment_reversals'
  )
ORDER BY table_name, constraint_name;

-- ================================================================
-- BLOCK 5: RLS STATUS + ALL POLICIES
-- ================================================================

-- RLS enabled status for all relevant tables
SELECT 
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS force_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'escrow_transactions', 'financial_audit_log', 'wallet_transactions',
    'withdrawal_requests', 'payment_reversals', 'bank_account_history',
    'booking_payments', 'commission_ledger', 'verified_paystack_references'
  )
ORDER BY c.relname;

-- All policies for those tables
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles::text,
  cmd,
  qual AS using_expr,
  with_check AS with_check_expr
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'escrow_transactions', 'financial_audit_log', 'wallet_transactions',
    'withdrawal_requests', 'payment_reversals', 'bank_account_history',
    'booking_payments', 'commission_ledger', 'verified_paystack_references'
  )
ORDER BY tablename, policyname;

-- ================================================================
-- BLOCK 6: FUNCTION DEFINITIONS
-- ================================================================

-- All 10 functions: name, args, return type, security, search_path, owner
SELECT 
  p.proname AS function_name,
  pg_get_function_arguments(p.oid) AS arguments,
  pg_get_function_result(p.oid) AS return_type,
  CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END AS security,
  p.proconfig::text AS config,
  p.proowner::regrole AS owner
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname IN (
    'confirm_booking_payment', 'reverse_payment', 'credit_wallet',
    'release_escrow', 'refund_escrow', 'process_withdrawal',
    'unfreeze_wallet', 'record_bank_account_change',
    'record_worker_verification_payment', 'customer_confirm_payment'
  )
ORDER BY p.proname;

-- Actual function source for confirm_booking_payment
SELECT pg_get_functiondef(
  (SELECT oid FROM pg_proc WHERE proname = 'confirm_booking_payment' AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public') LIMIT 1)
);

-- Actual function source for record_worker_verification_payment
SELECT pg_get_functiondef(
  (SELECT oid FROM pg_proc WHERE proname = 'record_worker_verification_payment' AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public') LIMIT 1)
);

-- ================================================================
-- BLOCK 7: EXECUTE PRIVILEGES — ACLs for all 8 server-only RPCs
-- ================================================================

-- Method: has_function_privilege for each role
WITH functions(fname) AS (VALUES
  ('confirm_booking_payment'), ('reverse_payment'), ('credit_wallet'),
  ('release_escrow'), ('refund_escrow'), ('process_withdrawal'),
  ('unfreeze_wallet'), ('record_bank_account_change')
)
SELECT
  f.fname AS function_name,
  has_function_privilege('anon', f.fname, 'EXECUTE') AS anon_can_execute,
  has_function_privilege('authenticated', f.fname, 'EXECUTE') AS authenticated_can_execute,
  has_function_privilege('service_role', f.fname, 'EXECUTE') AS service_role_can_execute,
  has_function_privilege('postgres', f.fname, 'EXECUTE') AS postgres_can_execute
FROM functions f;

-- Alternative: check aclitem for PUBLIC
WITH functions(fname, args) AS (VALUES
  ('confirm_booking_payment', 'text, text, numeric, text, text'),
  ('reverse_payment', 'uuid, text, text, text'),
  ('credit_wallet', 'uuid, numeric, text, text'),
  ('release_escrow', 'uuid, text'),
  ('refund_escrow', 'uuid, text'),
  ('process_withdrawal', 'uuid, text, text'),
  ('unfreeze_wallet', 'uuid'),
  ('record_bank_account_change', 'text, text, text, text, text, text')
)
SELECT
  f.fname AS function_name,
  f.args AS arguments,
  p.proacl::text AS acl_entries
FROM functions f
JOIN pg_proc p ON p.proname = f.fname AND pg_get_function_arguments(p.oid) = f.args
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public';

-- ================================================================
-- BLOCK 8: FUNCTION OVERLOADS — check for multiple definitions
-- ================================================================
SELECT 
  p.proname AS function_name,
  pg_get_function_arguments(p.oid) AS arguments,
  pg_get_function_result(p.oid) AS return_type,
  CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END AS security
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname IN (
    'confirm_booking_payment', 'reverse_payment', 'credit_wallet',
    'release_escrow', 'refund_escrow', 'process_withdrawal',
    'unfreeze_wallet', 'record_bank_account_change',
    'record_worker_verification_payment', 'customer_confirm_payment'
  )
ORDER BY p.proname, arguments;

-- ================================================================
-- BLOCK 9: confirm_booking_payment — full source inspection
-- ================================================================
SELECT pg_get_functiondef(
  (SELECT oid FROM pg_proc 
   WHERE proname = 'confirm_booking_payment' 
   AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public') 
   LIMIT 1)
);

-- ================================================================
-- BLOCK 10: record_worker_verification_payment — full source inspection
-- ================================================================
SELECT pg_get_functiondef(
  (SELECT oid FROM pg_proc 
   WHERE proname = 'record_worker_verification_payment' 
   AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public') 
   LIMIT 1)
);

-- ================================================================
-- BLOCK 11: reverse_payment — full source inspection
-- ================================================================
SELECT pg_get_functiondef(
  (SELECT oid FROM pg_proc 
   WHERE proname = 'reverse_payment' 
   AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public') 
   LIMIT 1)
);

-- ================================================================
-- BLOCK 12: record_bank_account_change — full source inspection
-- ================================================================
SELECT pg_get_functiondef(
  (SELECT oid FROM pg_proc 
   WHERE proname = 'record_bank_account_change' 
   AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public') 
   LIMIT 1)
);

-- ================================================================
-- BLOCK 13: DEPENDENCIES / BROKEN FUNCTIONS
-- ================================================================

-- Check for functions referencing non-existent objects
SELECT 
  p.proname AS function_name,
  d.classid::regclass AS referenced_type,
  d.objid::regclass AS referenced_object,
  d.objsubid
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
LEFT JOIN pg_depend d ON d.objid = p.oid
WHERE n.nspname = 'public'
  AND p.proname IN (
    'confirm_booking_payment', 'reverse_payment', 'credit_wallet',
    'release_escrow', 'refund_escrow', 'process_withdrawal',
    'unfreeze_wallet', 'record_bank_account_change',
    'record_worker_verification_payment', 'customer_confirm_payment'
  )
  AND d.deptype = 'n'
ORDER BY p.proname, referenced_object;

-- Check for functions with invalid references (marked as such in pg_proc)
SELECT 
  p.proname AS function_name,
  p.prosrc AS source_preview,
  p.proisstrict AS is_strict,
  p.provolatile AS volatility
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname IN (
    'confirm_booking_payment', 'reverse_payment', 'credit_wallet',
    'release_escrow', 'refund_escrow', 'process_withdrawal',
    'unfreeze_wallet', 'record_bank_account_change',
    'record_worker_verification_payment', 'customer_confirm_payment'
  )
ORDER BY p.proname;

-- ================================================================
-- BLOCK 14: KNOWN ARCHITECTURE OBJECTS
-- ================================================================
WITH known_objects(otype, oname) AS (VALUES
  ('table', 'booking_payments'),
  ('table', 'verified_paystack_references'),
  ('table', 'commission_ledger'),
  ('table', 'rent_plan_snapshots'),
  ('function', 'staff_branch_analytics'),
  ('function', 'expire_overdue_reservations'),
  ('function', 'get_staff_branch_analytics'),
  ('function', 'get_staff_activity'),
  ('function', 'calculate_commission'),
  ('function', 'create_booking_payment')
)
SELECT 
  ko.otype AS object_type,
  ko.oname AS object_name,
  CASE ko.otype
    WHEN 'table' THEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ko.oname)
    WHEN 'function' THEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = ko.oname)
  END AS exists
FROM known_objects ko
ORDER BY ko.otype, ko.oname;

-- ================================================================
-- BLOCK 15: ALL FUNCTION SOURCES (for the 10 critical functions)
-- ================================================================

-- Use  to separate output for each function
SELECT 
  p.proname AS function_name,
  pg_get_functiondef(p.oid) AS full_definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname IN (
    'confirm_booking_payment', 'reverse_payment', 'credit_wallet',
    'release_escrow', 'refund_escrow', 'process_withdrawal',
    'unfreeze_wallet', 'record_bank_account_change',
    'record_worker_verification_payment', 'customer_confirm_payment'
  )
ORDER BY p.proname;
