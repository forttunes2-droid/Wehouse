-- ============================================================
-- FIX: INFINITE RECURSION IN PROFILES RLS
-- ============================================================
-- Problem: The profiles policy was doing "SELECT FROM profiles"
-- inside the profiles policy — infinite loop.
-- Fix: Create a SECURITY DEFINER function that bypasses RLS,
-- then use it in the policy.
-- ============================================================

-- Step 1: Create helper function that checks if user is staff/creator
-- SECURITY DEFINER bypasses RLS, preventing recursion
CREATE OR REPLACE FUNCTION public.is_staff_or_creator(uid text)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE user_id = uid
      AND role IN ('staff','admin','state_admin','assistant_state_admin','director','creator','creator_admin')
  );
$$;

-- Step 2: Drop the broken recursive policy
DROP POLICY IF EXISTS "profiles_self" ON profiles;

-- Step 3: Create new non-recursive policies
-- SELECT: users see their own profile, staff/creator see all
CREATE POLICY "profiles_select" ON profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid()::text OR public.is_staff_or_creator(auth.uid()::text));

-- INSERT: users can only insert their own profile
CREATE POLICY "profiles_insert" ON profiles
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid()::text);

-- UPDATE: users can update their own, staff/creator can update any
CREATE POLICY "profiles_update" ON profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()::text OR public.is_staff_or_creator(auth.uid()::text))
  WITH CHECK (user_id = auth.uid()::text OR public.is_staff_or_creator(auth.uid()::text));

-- DELETE: only staff/creator can delete
CREATE POLICY "profiles_delete" ON profiles
  FOR DELETE TO authenticated
  USING (public.is_staff_or_creator(auth.uid()::text));
