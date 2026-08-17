-- BLOCK 1: Admin functions (fix user count)
-- Run this first. These exclude wehouse_support from counts.

CREATE OR REPLACE FUNCTION public.admin_get_all_users()
RETURNS SETOF public.profiles
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT * FROM public.profiles 
  WHERE email != 'support@wehouse.com.ng'
    AND username != 'wehousupport'
    AND COALESCE(full_name, '') != 'WeHouse Support'
  ORDER BY created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_user_count()
RETURNS TABLE(total bigint, today bigint)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 
    (SELECT COUNT(*) FROM public.profiles WHERE email != 'support@wehouse.com.ng' AND username != 'wehousupport') as total,
    (SELECT COUNT(*) FROM public.profiles WHERE email != 'support@wehouse.com.ng' AND username != 'wehousupport' AND created_at >= date_trunc('day', now())) as today;
$$;
