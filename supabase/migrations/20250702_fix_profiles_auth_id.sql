-- Fix: profiles RLS was checking user_id (custom text ID) against auth.uid() (UUID)
-- Need to also check auth_id column which stores the actual Supabase auth UUID

-- Drop all existing policies
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

-- Recreate with auth_id check (auth_id = Supabase UUID = auth.uid())
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
