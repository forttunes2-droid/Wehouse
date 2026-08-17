-- ═══════════════════════════════════════════════════════════════
-- CRITICAL FIX: Worker profile update blocked by RLS
-- 
-- Problem: profiles table RLS checks user_id = auth.uid()::text
-- But WeHouse uses custom user_id (wh_abc123) != auth.uid (uuid)
-- So workers can't update their own profile (including worker_status)
--
-- Solution: Create RPC that bypasses RLS for profile updates
-- ═══════════════════════════════════════════════════════════════

-- 1. Fix the profiles RLS policy to also match via auth_id
-- First drop the existing policy
DROP POLICY IF EXISTS "profiles_self" ON public.profiles;

-- Create a new policy that matches by user_id OR auth_id
CREATE POLICY "profiles_self" ON public.profiles 
FOR ALL TO authenticated 
USING (
  user_id = auth.uid()::text 
  OR auth_id = auth.uid()::text
  OR EXISTS (
    SELECT 1 FROM profiles AS p 
    WHERE p.auth_id = auth.uid()::text 
    AND p.role IN ('staff','admin','creator')
  )
);

-- 2. Create RPC for workers to update their profile (bypasses RLS)
DROP FUNCTION IF EXISTS public.worker_update_profile(TEXT, JSONB);

CREATE OR REPLACE FUNCTION public.worker_update_profile(
  p_user_id TEXT,
  p_updates JSONB
)
RETURNS SETOF public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.profiles SET
    full_name = COALESCE(p_updates->>'full_name', full_name),
    phone = COALESCE(p_updates->>'phone', phone),
    bio = COALESCE(p_updates->>'bio', bio),
    avatar_url = COALESCE(p_updates->>'avatar_url', avatar_url),
    worker_status = COALESCE(p_updates->>'worker_status', worker_status),
    worker_verified = COALESCE((p_updates->>'worker_verified')::BOOLEAN, worker_verified),
    updated_at = NOW()
  WHERE user_id = p_user_id
  RETURNING *;
END;
$$;

-- 3. Also fix the staff_permissions RLS to be consistent
DROP POLICY IF EXISTS "staff_permissions_view_own" ON public.staff_permissions;
CREATE POLICY "staff_permissions_view_own" ON public.staff_permissions
  FOR ALL TO authenticated
  USING (
    staff_id IN (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text)
    OR EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator'))
  );
