-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: Revert old 'approved' workers to 'pending'
-- Date: 2025-07-08
-- Issue: Pre-verification workers had worker_status = 'approved'
--        which is not a valid status in the new flow.
--        New flow: pending → verification_paid → verified/declined
-- ═══════════════════════════════════════════════════════════════

-- Step 1: Show how many workers will be affected (dry run info)
SELECT 'Workers with approved status that will be reverted to pending: ' AS info,
       COUNT(*) AS count
FROM profiles
WHERE role = 'worker'
  AND worker_status = 'approved';

-- Step 2: Update all 'approved' workers to 'pending'
-- These workers will need to go through the new verification flow:
-- 1. Submit docs → 2. Pay N3,000 → 3. WeHouse review → 4. Golden tick
UPDATE profiles
SET worker_status = 'pending',
    updated_at = NOW()
WHERE role = 'worker'
  AND worker_status = 'approved';

-- Step 3: Show workers that were updated
SELECT user_id, username, email, worker_status, updated_at
FROM profiles
WHERE role = 'worker'
  AND worker_status = 'pending'
ORDER BY updated_at DESC;

-- Step 4: Verify count of workers by status after migration
SELECT worker_status, COUNT(*) AS count
FROM profiles
WHERE role = 'worker'
GROUP BY worker_status
ORDER BY count DESC;
