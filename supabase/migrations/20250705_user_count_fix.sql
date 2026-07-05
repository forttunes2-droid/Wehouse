-- Fix user count: admin sees 10 (no creator), creator sees 11 (all)
-- Replace the old function with a role-aware version

DROP FUNCTION IF EXISTS public.admin_get_user_count();

CREATE OR REPLACE FUNCTION public.admin_get_user_count(p_caller_role TEXT DEFAULT 'admin')
RETURNS TABLE(total bigint, today bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    (SELECT COUNT(*) FROM public.profiles 
     WHERE user_id != 'wehouse_support' 
       AND (p_caller_role = 'creator' OR role != 'creator')
    ) as total,
    (SELECT COUNT(*) FROM public.profiles 
     WHERE user_id != 'wehouse_support' 
       AND (p_caller_role = 'creator' OR role != 'creator')
       AND created_at >= date_trunc('day', now())
    ) as today;
$$;

-- Add campus column to roommate_preferences if missing
ALTER TABLE roommate_preferences ADD COLUMN IF NOT EXISTS campus TEXT;

-- Sync bio for all workers (fix stale emoji)
UPDATE profiles SET bio = '🛠️STATUS:' || worker_status || '🛠️ ' || COALESCE(full_name, username, 'User')
WHERE role = 'worker' AND worker_status IS NOT NULL;
