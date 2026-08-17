-- Fix: column name is "Rating" (capital R), not "rating"
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
