-- ═══════════════════════════════════════════════════════════════
-- Batch Fix: Jul 21, 2026
-- 1. Fix field officers to exclude creator/admin/support
-- 2. Only staff with field_officer permission qualify
-- ═══════════════════════════════════════════════════════════════

-- 1. Fix admin_get_field_officers — only staff with field_officer permission
DROP FUNCTION IF EXISTS public.admin_get_field_officers();

CREATE OR REPLACE FUNCTION public.admin_get_field_officers()
RETURNS TABLE(user_id TEXT, username TEXT, full_name TEXT, phone TEXT)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT p.user_id, p.username, p.full_name, p.phone 
  FROM public.profiles p
  INNER JOIN public.staff_permissions sp ON sp.staff_id = p.user_id
  WHERE p.role = 'staff'
    AND sp.permission = 'field_officer'
    AND sp.is_active = true
    AND p.user_id != 'wehouse_support'
    AND p.deleted = false
  ORDER BY p.username;
$$;
