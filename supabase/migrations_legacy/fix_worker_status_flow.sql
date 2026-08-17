-- ═══════════════════════════════════════════════════════════════
-- WORKER STATUS FLOW FIX
-- Adds profile_under_review status for the proper worker flow:
-- pending → approved_for_verification → profile_under_review → verified
-- ═══════════════════════════════════════════════════════════════

-- Step 1: Drop old constraint and add new one with profile_under_review
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_worker_status_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_worker_status_check 
  CHECK (worker_status IN ('pending', 'approved_for_verification', 'profile_under_review', 'verified', 'suspended', 'rejected'));

-- Step 2: Ensure worker_verified column exists
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS worker_verified BOOLEAN DEFAULT false;
