-- Fix: Creator is identified by role='creator', not user_id='wehouse_support'
DROP FUNCTION IF EXISTS public.admin_get_user_count(TEXT);
CREATE OR REPLACE FUNCTION public.admin_get_user_count(p_caller_role TEXT DEFAULT 'admin')
RETURNS TABLE(total BIGINT, today BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COUNT(*)::BIGINT AS total,
    COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::BIGINT AS today
  FROM profiles
  WHERE deleted_at IS NULL
    AND (p_caller_role = 'creator' OR role != 'creator');
$$;

-- Also fix getCreatorDashboardStats approach: use role-based filter
-- (The frontend now uses profile.role === 'creator' to detect creator)
