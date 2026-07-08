-- ═══════════════════════════════════════════════════════════
-- MIGRATION: Revert old 'approved' workers to 'pending'
-- Per Constitution: No worker is "approved" without completing
-- the full verification flow (submit docs → Paystack → WeHouse review)
-- ═══════════════════════════════════════════════════════════

-- Revert all workers with old 'approved' status to 'pending'
-- These workers must complete the new verification flow
UPDATE profiles
SET
  worker_status = 'pending',
  worker_verified = false,
  bio = regexp_replace(bio, '🛠️STATUS:\w+🛠️\s*', '', 'g')
WHERE role = 'worker'
  AND worker_status = 'approved';

-- Verify count
SELECT COUNT(*) as reverted_count
FROM profiles
WHERE role = 'worker'
  AND worker_status = 'pending'
  AND NOT worker_verified;
