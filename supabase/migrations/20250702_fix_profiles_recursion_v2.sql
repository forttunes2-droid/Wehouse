-- ============================================================
-- FIX: INFINITE RECURSION IN PROFILES RLS (v2)
-- Fix: Fully qualify table as public.profiles since search_path is cleared
-- ============================================================

-- Step 1: Create helper function with fully qualified table reference
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

-- Step 2: Drop the broken recursive policy
DROP POLICY IF EXISTS "profiles_self" ON profiles;

-- Step 3: Create new non-recursive policies
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
