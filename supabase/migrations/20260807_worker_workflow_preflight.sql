-- WEHOUSE WORKER WORKFLOW LIVE PREFLIGHT
-- READ-ONLY: this script performs no INSERT, UPDATE, DELETE, ALTER or policy changes.
-- Run before:
--   1. 20260806_worker_workflow_required_settings.sql
--   2. 20260807_worker_workflow_hardening.sql

-- 1. Critical live table columns
SELECT
  table_name,
  ARRAY_AGG(column_name ORDER BY ordinal_position) AS columns
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'profiles',
    'worker_bookings',
    'booking_payments',
    'booking_conversations',
    'booking_messages',
    'escrow_transactions',
    'wallets',
    'wallet_transactions',
    'withdrawals',
    'bank_accounts',
    'platform_settings',
    'verified_paystack_references'
  )
GROUP BY table_name
ORDER BY table_name;

-- 2. Columns introduced by the hardening migration.
-- worker_booking_id being absent BEFORE deployment is expected and must not
-- cause this preflight to reference a nonexistent column.
SELECT
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'booking_payments'
      AND column_name = 'worker_booking_id'
  ) AS worker_booking_id_exists_before_migration,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'available'
  ) AS profiles_available_exists_before_migration,
  (
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'worker_skills'
  ) AS worker_skills_type;

-- 3. Existing function overloads that the migration replaces.
SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS signature,
  CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END AS security
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'create_worker_booking_payment',
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
    'get_public_workers'
  )
ORDER BY p.proname, signature;

-- 4. Live CHECK constraints affecting statuses and payment purpose.
SELECT
  conrelid::regclass::text AS table_name,
  conname,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
  AND conrelid IN (
    'public.worker_bookings'::regclass,
    'public.booking_payments'::regclass,
    'public.escrow_transactions'::regclass,
    'public.withdrawals'::regclass
  )
  AND contype = 'c'
ORDER BY table_name, conname;

-- 5. Duplicate-reference and duplicate-escrow checks.
SELECT
  (SELECT COUNT(*) FROM (
    SELECT paystack_reference
    FROM public.worker_bookings
    WHERE paystack_reference IS NOT NULL
    GROUP BY paystack_reference
    HAVING COUNT(*) > 1
  ) d) AS worker_booking_reference_duplicate_groups,
  (SELECT COUNT(*) FROM (
    SELECT paystack_reference
    FROM public.booking_payments
    WHERE paystack_reference IS NOT NULL
    GROUP BY paystack_reference
    HAVING COUNT(*) > 1
  ) d) AS booking_payment_reference_duplicate_groups,
  (SELECT COUNT(*) FROM (
    SELECT booking_id, booking_type
    FROM public.escrow_transactions
    WHERE booking_type = 'worker_booking'
    GROUP BY booking_id, booking_type
    HAVING COUNT(*) > 1
  ) d) AS worker_booking_escrow_duplicate_groups;

-- 6. Current workflow status distributions.
SELECT 'worker_bookings' AS source, status, COUNT(*) AS row_count
FROM public.worker_bookings
GROUP BY status
UNION ALL
SELECT 'booking_payments', status, COUNT(*)
FROM public.booking_payments
GROUP BY status
UNION ALL
SELECT 'escrow_transactions', status, COUNT(*)
FROM public.escrow_transactions
GROUP BY status
UNION ALL
SELECT 'withdrawals', status, COUNT(*)
FROM public.withdrawals
GROUP BY status
ORDER BY source, status;

-- 7. Current Worker status anomalies requiring manual review.
SELECT
  worker_status,
  worker_verified,
  COUNT(*) AS worker_count
FROM public.profiles
WHERE role = 'worker'
GROUP BY worker_status, worker_verified
ORDER BY worker_status, worker_verified;

-- 8. Existing Storage policies affecting the two private buckets.
SELECT
  schemaname,
  tablename,
  policyname,
  cmd,
  roles,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND (
    policyname ILIKE '%worker-files%'
    OR policyname ILIKE '%worker_files%'
    OR policyname ILIKE '%chat-files%'
    OR policyname ILIKE '%chat_files%'
    OR COALESCE(qual, '') ILIKE '%worker-files%'
    OR COALESCE(qual, '') ILIKE '%chat-files%'
    OR COALESCE(with_check, '') ILIKE '%worker-files%'
    OR COALESCE(with_check, '') ILIKE '%chat-files%'
  )
ORDER BY policyname;

-- 9. Required settings. Missing rows are expected before the prerequisite
-- migration and will be created without overwriting any existing value.
SELECT
  required.key,
  ps.value,
  ps.data_type,
  ps.is_active,
  CASE
    WHEN ps.key IS NULL THEN 'MISSING_WILL_BE_CREATED_BY_20260806'
    WHEN ps.is_active IS DISTINCT FROM TRUE THEN 'BLOCKED_INACTIVE'
    WHEN NULLIF(trim(ps.value), '') IS NULL THEN 'BLOCKED_EMPTY_VALUE'
    ELSE 'EXISTS'
  END AS preflight_state
FROM (
  VALUES
    ('worker_commission_rate'::text),
    ('wallet_minimum_withdrawal'::text)
) AS required(key)
LEFT JOIN public.platform_settings ps ON ps.key = required.key
ORDER BY required.key;

-- 10. Existing rows using the required keys, including duplicates.
SELECT key, COUNT(*) AS row_count, ARRAY_AGG(value ORDER BY id) AS values
FROM public.platform_settings
WHERE key IN ('worker_commission_rate', 'wallet_minimum_withdrawal')
GROUP BY key
ORDER BY key;
