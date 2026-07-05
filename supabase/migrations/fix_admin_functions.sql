-- Fix: admin_get_all_users was using 'deleted = false' but table uses 'deleted_at IS NULL'
DROP FUNCTION IF EXISTS public.admin_get_all_users();
CREATE OR REPLACE FUNCTION public.admin_get_all_users()
RETURNS SETOF profiles
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM profiles WHERE deleted_at IS NULL ORDER BY created_at DESC;
$$;

-- Fix: admin_get_user_count same issue
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
    AND (p_caller_role = 'creator' OR user_id != 'wehouse_support');
$$;

-- Fix: admin_get_all_workers same issue
DROP FUNCTION IF EXISTS public.admin_get_all_workers();
CREATE OR REPLACE FUNCTION public.admin_get_all_workers()
RETURNS SETOF profiles
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM profiles WHERE role = 'worker' AND deleted_at IS NULL ORDER BY created_at DESC;
$$;

-- Fix: admin_get_field_officers same issue
DROP FUNCTION IF EXISTS public.admin_get_field_officers();
CREATE OR REPLACE FUNCTION public.admin_get_field_officers()
RETURNS SETOF profiles
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM profiles WHERE role = 'staff' AND deleted_at IS NULL ORDER BY created_at DESC;
$$;

-- Also fix get_staff_rating to handle missing table gracefully
DROP FUNCTION IF EXISTS public.get_staff_rating(TEXT);
CREATE OR REPLACE FUNCTION public.get_staff_rating(p_staff_user_id TEXT)
RETURNS TABLE(avg_rating NUMERIC, review_count BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(AVG("Rating"), 0)::NUMERIC, COUNT(*)::BIGINT 
  FROM staff_reviews WHERE staff_id = p_staff_user_id;
$$;
