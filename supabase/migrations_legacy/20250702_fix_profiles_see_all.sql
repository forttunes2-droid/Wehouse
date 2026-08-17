-- CRITICAL FIX: Creator/Staff couldn't see regular users
-- Problem: RLS checked "role IN (staff,admin,creator)" on each ROW
-- This meant: creator sees other staff, but NOT users with role='user'
-- Fix: Function checks the VIEWER's role, not the row's role

-- Step 1: Create function that checks if the CURRENT USER is staff/creator
-- SECURITY DEFINER bypasses RLS so no recursion
CREATE OR REPLACE FUNCTION public.current_user_is_staff()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_id = auth.uid()::text
      AND role IN ('staff','admin','state_admin','assistant_state_admin','director','creator','creator_admin')
  );
$$;

-- Step 2: Drop all existing policies
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'profiles'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON profiles', pol.policyname);
  END LOOP;
END $$;

-- Step 3: Recreate policies with correct logic
-- SELECT: see own profile OR see all if staff/creator
CREATE POLICY "profiles_select" ON profiles
  FOR SELECT TO authenticated
  USING (
    auth_id = auth.uid()::text
    OR public.current_user_is_staff()
  );

-- INSERT: only own profile
CREATE POLICY "profiles_insert" ON profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth_id = auth.uid()::text);

-- UPDATE: own profile OR staff/creator can update any
CREATE POLICY "profiles_update" ON profiles
  FOR UPDATE TO authenticated
  USING (
    auth_id = auth.uid()::text
    OR public.current_user_is_staff()
  );

-- DELETE: staff/creator only
CREATE POLICY "profiles_delete" ON profiles
  FOR DELETE TO authenticated
  USING (public.current_user_is_staff());
