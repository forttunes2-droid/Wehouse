-- Step 1: Drop ALL policies on profiles (including profiles_delete)
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'profiles'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON profiles', pol.policyname);
  END LOOP;
END $$;

-- Step 2: Recreate with auth_id check
CREATE POLICY "profiles_select" ON profiles
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()::text
    OR auth_id = auth.uid()::text
    OR public.is_staff_or_creator(auth.uid()::text)
  );

CREATE POLICY "profiles_insert" ON profiles
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid()::text OR auth_id = auth.uid()::text);

CREATE POLICY "profiles_update" ON profiles
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()::text
    OR auth_id = auth.uid()::text
    OR public.is_staff_or_creator(auth.uid()::text)
  );

CREATE POLICY "profiles_delete" ON profiles
  FOR DELETE TO authenticated
  USING (public.is_staff_or_creator(auth.uid()::text));
