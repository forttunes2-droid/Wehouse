-- ═════════════════════════════════════════════════════════════════════════════
-- PREFLIGHT SQL: Run these queries against the LIVE database BEFORE applying
-- 20260807_worker_workflow_hardening.sql
-- ═════════════════════════════════════════════════════════════════════════════

-- Run in psql or Supabase SQL Editor. DO NOT include in the migration itself.

-- ═════════════════════════════════════════════════════════════════════════════
-- SECTION 1: LIVE SCHEMA VALIDATION
-- Compares migration assumptions against actual database columns
-- ═════════════════════════════════════════════════════════════════════════════

SELECT '=== LIVE COLUMN AUDIT ===' AS section;

-- 1.1 wallet_transactions
SELECT 'wallet_transactions' AS table_name,
       ARRAY_AGG(column_name ORDER BY ordinal_position) AS columns
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'wallet_transactions';

-- 1.2 escrow_transactions
SELECT 'escrow_transactions' AS table_name,
       ARRAY_AGG(column_name ORDER BY ordinal_position) AS columns
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'escrow_transactions';

-- 1.3 booking_payments
SELECT 'booking_payments' AS table_name,
       ARRAY_AGG(column_name ORDER BY ordinal_position) AS columns
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'booking_payments';

-- 1.4 worker_bookings
SELECT 'worker_bookings' AS table_name,
       ARRAY_AGG(column_name ORDER BY ordinal_position) AS columns
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'worker_bookings';

-- 1.5 profiles (worker-relevant columns)
SELECT 'profiles' AS table_name,
       ARRAY_AGG(column_name ORDER BY ordinal_position) AS columns
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'profiles'
  AND column_name IN ('user_id','auth_id','role','worker_status','worker_verified',
      'available','deleted','suspended','banned','state','city','local_government',
      'area','worker_occupation','worker_skills','worker_price','worker_bio',
      'worker_experience','rating','review_count','is_online','last_seen');

-- 1.6 platform_settings (columns used by migration)
SELECT 'platform_settings' AS table_name,
       ARRAY_AGG(column_name ORDER BY ordinal_position) AS columns
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'platform_settings';

-- ═════════════════════════════════════════════════════════════════════════════
-- SECTION 2: FUNCTION SIGNATURES
-- Check for old overloads that could cause ambiguity
-- ═════════════════════════════════════════════════════════════════════════════

SELECT '=== FUNCTION SIGNATURE AUDIT ===' AS section;

SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS signature
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('create_worker_booking_payment',
                    'confirm_worker_booking_payment',
                    'request_worker_withdrawal',
                    'confirm_booking_payment',
                    'set_my_worker_availability',
                    'create_booking_request',
                    'send_booking_message',
                    'worker_accept_booking',
                    'worker_start_job',
                    'worker_mark_complete',
                    'customer_confirm_completion',
                    'customer_raise_dispute',
                    'cancel_booking',
                    'get_public_workers')
ORDER BY p.proname;

-- ═════════════════════════════════════════════════════════════════════════════
-- SECTION 3: SECURITY DEFINER AUDIT
-- Verify all worker workflow functions are SECURITY DEFINER
-- ═════════════════════════════════════════════════════════════════════════════

SELECT '=== SECURITY DEFINER AUDIT ===' AS section;

SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS signature,
       CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END AS security
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('create_worker_booking_payment',
                    'confirm_worker_booking_payment',
                    'request_worker_withdrawal',
                    'create_booking_request',
                    'send_booking_message',
                    'worker_accept_booking',
                    'worker_start_job',
                    'worker_mark_complete',
                    'customer_confirm_completion',
                    'customer_raise_dispute',
                    'cancel_booking',
                    'get_public_workers')
ORDER BY p.proname;

-- ═════════════════════════════════════════════════════════════════════════════
-- SECTION 4: STATUS VALUE VALIDATION
-- Verify status values used in CHECK constraints match migration code
-- ═════════════════════════════════════════════════════════════════════════════

SELECT '=== STATUS CONSTRAINTS ===' AS section;

SELECT table_name, column_name, check_clause
FROM information_schema.check_constraints cc
JOIN information_schema.constraint_column_usage ccu
  ON cc.constraint_name = ccu.constraint_name
WHERE cc.constraint_schema = 'public'
  AND table_name IN ('worker_bookings','booking_payments','escrow_transactions',
                     'withdrawals','wallets','profiles','booking_conversations')
  AND column_name LIKE '%status%';

-- ═════════════════════════════════════════════════════════════════════════════
-- SECTION 5: PAYMENT DATA PREFLIGHT
-- Zero-touch safety checks before adding constraints
-- ═════════════════════════════════════════════════════════════════════════════

SELECT '=== PAYMENT DATA PREFLIGHT ===' AS section;

-- 5.1 Duplicate paystack_reference in worker_bookings
SELECT COUNT(*) AS worker_bookings_dup_ref_count
FROM (SELECT paystack_reference FROM public.worker_bookings
      WHERE paystack_reference IS NOT NULL
      GROUP BY paystack_reference HAVING COUNT(*) > 1) dups;

-- 5.2 Duplicate paystack_reference in booking_payments
SELECT COUNT(*) AS booking_payments_dup_ref_count
FROM (SELECT paystack_reference FROM public.booking_payments
      WHERE paystack_reference IS NOT NULL
      GROUP BY paystack_reference HAVING COUNT(*) > 1) dups;

-- 5.3 Duplicate escrow for same worker booking
SELECT COUNT(*) AS escrow_dup_count
FROM (SELECT booking_id, booking_type FROM public.escrow_transactions
      WHERE booking_type = 'worker_booking'
      GROUP BY booking_id, booking_type HAVING COUNT(*) > 1) dups;

-- 5.4 Orphaned payment records (purpose=worker_booking without worker_booking_id)
SELECT COUNT(*) AS orphaned_worker_payments
FROM public.booking_payments
WHERE purpose = 'worker_booking'
  AND worker_booking_id IS NULL;

-- 5.5 Booking status distribution (watch for unexpected values)
SELECT status, COUNT(*) AS count
FROM public.worker_bookings
GROUP BY status
ORDER BY count DESC;

-- 5.6 Payment status distribution
SELECT status, COUNT(*) AS count
FROM public.booking_payments
GROUP BY status
ORDER BY count DESC;

-- 5.7 Escrow status distribution
SELECT status, COUNT(*) AS count
FROM public.escrow_transactions
GROUP BY status
ORDER BY count DESC;

-- 5.8 Withdrawal status distribution
SELECT status, COUNT(*) AS count
FROM public.withdrawals
GROUP BY status
ORDER BY count DESC;

-- ═════════════════════════════════════════════════════════════════════════════
-- SECTION 6: FK TYPE COMPATIBILITY
-- ═════════════════════════════════════════════════════════════════════════════

SELECT '=== FK COMPATIBILITY ===' AS section;

SELECT
  ccu.table_name AS parent_table,
  ccu.column_name AS parent_column,
  c.data_type AS parent_type,
  'worker_bookings.worker_booking_id' AS fk_column,
  (SELECT data_type FROM information_schema.columns
   WHERE table_schema='public' AND table_name='booking_payments'
     AND column_name='worker_booking_id') AS fk_type
FROM information_schema.constraint_column_usage ccu
JOIN information_schema.columns c
  ON c.table_schema = ccu.table_schema
  AND c.table_name = ccu.table_name
  AND c.column_name = ccu.column_name
WHERE ccu.constraint_name = (SELECT constraint_name FROM information_schema.table_constraints
    WHERE table_schema='public' AND table_name='booking_payments'
      AND constraint_type='FOREIGN KEY' AND constraint_name LIKE '%worker_booking%')
UNION ALL
SELECT
  ccu.table_name AS parent_table,
  ccu.column_name AS parent_column,
  c.data_type AS parent_type,
  'wallets.owner_id' AS fk_column,
  (SELECT data_type FROM information_schema.columns
   WHERE table_schema='public' AND table_name='wallets'
     AND column_name='owner_id') AS fk_type
FROM information_schema.constraint_column_usage ccu
JOIN information_schema.columns c
  ON c.table_schema = ccu.table_schema
  AND c.table_name = ccu.table_name
  AND c.column_name = ccu.column_name
WHERE ccu.constraint_name = (SELECT constraint_name FROM information_schema.table_constraints
    WHERE table_schema='public' AND table_name='wallets'
      AND constraint_type='UNIQUE' AND constraint_name LIKE '%owner%');

-- ═════════════════════════════════════════════════════════════════════════════
-- SECTION 7: STORAGE POLICIES (before/after snapshot)
-- ═════════════════════════════════════════════════════════════════════════════

SELECT '=== STORAGE POLICIES ===' AS section;

SELECT bucket_id, name, action
FROM storage.policies
WHERE bucket_id IN ('worker-files', 'chat-files')
ORDER BY bucket_id, name;

-- ═════════════════════════════════════════════════════════════════════════════
-- SECTION 8: PLATFORM SETTINGS REQUIRED KEYS
-- ═════════════════════════════════════════════════════════════════════════════

SELECT '=== REQUIRED SETTINGS ===' AS section;

SELECT key, value, COALESCE(is_active, TRUE) AS is_active
FROM public.platform_settings
WHERE key IN ('worker_commission_rate', 'wallet_minimum_withdrawal', 'paystack_public_key');
