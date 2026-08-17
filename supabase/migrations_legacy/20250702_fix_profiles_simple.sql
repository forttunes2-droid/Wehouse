-- SIMPLE FIX: Drop the broken function, use direct auth_id check
-- No more is_staff_or_creator function needed

-- Step 1: Drop all existing policies
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'profiles'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON profiles', pol.policyname);
  END LOOP;
END $$;

-- Step 2: Drop the broken function
DROP FUNCTION IF EXISTS public.is_staff_or_creator(text);

-- Step 3: Create simple policies using auth_id directly
-- SELECT: users see own profile, staff/creator see all
CREATE POLICY "profiles_select" ON profiles
  FOR SELECT TO authenticated
  USING (
    auth_id = auth.uid()::text
    OR role IN ('staff','admin','state_admin','assistant_state_admin','director','creator','creator_admin')
  );

-- INSERT: own profile only
CREATE POLICY "profiles_insert" ON profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth_id = auth.uid()::text);

-- UPDATE: own profile + staff/creator can update any
CREATE POLICY "profiles_update" ON profiles
  FOR UPDATE TO authenticated
  USING (
    auth_id = auth.uid()::text
    OR role IN ('staff','admin','state_admin','assistant_state_admin','director','creator','creator_admin')
  );

-- DELETE: staff/creator only
CREATE POLICY "profiles_delete" ON profiles
  FOR DELETE TO authenticated
  USING (
    role IN ('staff','admin','state_admin','assistant_state_admin','director','creator','creator_admin')
  );
