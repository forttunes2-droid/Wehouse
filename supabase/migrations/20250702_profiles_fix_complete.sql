-- ============================================================
-- COMPLETE FIX: INFINITE RECURSION IN PROFILES RLS
-- Step 1: Create function (must exist before policies reference it)
-- Step 2: Drop ALL policies
-- Step 3: Recreate 4 clean policies
-- ============================================================

-- STEP 1: Create helper function
CREATE OR REPLACE FUNCTION public.is_staff_or_creator(uid text)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = uid
      AND role IN ('staff','admin','state_admin','assistant_state_admin','director','creator','creator_admin')
  );
$$;

-- STEP 2: Drop ALL existing policies (13 total)
DROP POLICY IF EXISTS "profiles_insert" ON profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
DROP POLICY IF EXISTS "profiles_read_own" ON profiles;
DROP POLICY IF EXISTS "profiles_select" ON profiles;
DROP POLICY IF EXISTS "profiles_select_all" ON profiles;
DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
DROP POLICY IF EXISTS "profiles_self" ON profiles;
DROP POLICY IF EXISTS "profiles_update" ON profiles;
DROP POLICY IF EXISTS "profiles_update_admin" ON profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
DROP POLICY IF EXISTS "test_policy" ON profiles;

-- STEP 3: Recreate only 4 clean policies
CREATE POLICY "profiles_select" ON profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid()::text OR public.is_staff_or_creator(auth.uid()::text));

CREATE POLICY "profiles_insert" ON profiles
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY "profiles_update" ON profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()::text OR public.is_staff_or_creator(auth.uid()::text));

CREATE POLICY "profiles_delete" ON profiles
  FOR DELETE TO authenticated
  USING (public.is_staff_or_creator(auth.uid()::text));
