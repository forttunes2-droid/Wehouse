-- ═══════════════════════════════════════════════════════════════
-- CRITICAL FIX: Profiles RLS using wrong column
-- Problem: user_id = auth.uid()::text NEVER matches
--   user_id stores custom ID (wh_abc123) 
--   auth.uid() returns Supabase UUID (a1b2c3d4...)
-- Fix: Use auth_id (stores Supabase UUID) instead
-- ═══════════════════════════════════════════════════════════════

-- Step 1: Fix the helper function to compare auth_id (not user_id)
CREATE OR REPLACE FUNCTION public.is_staff_or_creator(uid text)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_id = uid  -- FIXED: was user_id
      AND role IN ('staff','admin','state_admin','assistant_state_admin','director','creator','creator_admin')
  );
$$;

-- Step 2: Drop existing broken policies
DROP POLICY IF EXISTS "profiles_select" ON profiles;
DROP POLICY IF EXISTS "profiles_insert" ON profiles;
DROP POLICY IF EXISTS "profiles_update" ON profiles;
DROP POLICY IF EXISTS "profiles_delete" ON profiles;

-- Step 3: Create fixed SELECT policy (use auth_id for self-lookup)
CREATE POLICY "profiles_select" ON profiles
  FOR SELECT TO authenticated
  USING (auth_id = auth.uid()::text OR public.is_staff_or_creator(auth.uid()::text));

-- Step 4: Create fixed INSERT policy
CREATE POLICY "profiles_insert" ON profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth_id = auth.uid()::text);

-- Step 5: Create fixed UPDATE policy
CREATE POLICY "profiles_update" ON profiles
  FOR UPDATE TO authenticated
  USING (auth_id = auth.uid()::text OR public.is_staff_or_creator(auth.uid()::text));

-- Step 6: Create fixed DELETE policy
CREATE POLICY "profiles_delete" ON profiles
  FOR DELETE TO authenticated
  USING (public.is_staff_or_creator(auth.uid()::text));
