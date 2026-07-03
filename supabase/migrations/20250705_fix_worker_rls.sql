-- ═══════════════════════════════════════════════════════════════
-- FIX: Allow regular users to see approved worker profiles
-- ═══════════════════════════════════════════════════════════════

-- Problem: The profiles_select policy only allowed users to see their own profile
-- or staff/creator to see all. Regular users couldn't see any workers.
--
-- Fix: Allow all authenticated users to see worker profiles with status 'verified'.
-- Pending/suspended/rejected workers remain hidden from public view.

-- Drop old select policy
DROP POLICY IF EXISTS "profiles_select" ON profiles;

-- New select policy:
-- 1. Users see their own profile (always)
-- 2. All users see APPROVED workers (worker_status = 'verified')
-- 3. Staff/creator see ALL profiles (no restriction)
CREATE POLICY "profiles_select" ON profiles
  FOR SELECT TO authenticated
  USING (
    auth_id = auth.uid()::text
    OR (role = 'worker' AND worker_status = 'verified')
    OR role IN ('staff','admin','creator','creator_admin')
  );
