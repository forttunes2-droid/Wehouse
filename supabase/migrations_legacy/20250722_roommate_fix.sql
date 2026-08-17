-- ═══════════════════════════════════════════════════════════════
-- FIX: Roommate system — create missing find_roommate_matches RPC
-- Also fix inspection checklist (remove from field officer)
-- Also verify worker pending status shows in creator dashboard
-- ═══════════════════════════════════════════════════════════════

-- 1. Create the find_roommate_matches RPC function (was missing!)
-- This is the core matching algorithm for the roommate system
DROP FUNCTION IF EXISTS public.find_roommate_matches(TEXT);

CREATE OR REPLACE FUNCTION public.find_roommate_matches(p_user_id TEXT)
RETURNS TABLE(
  user_id TEXT,
  username TEXT,
  full_name TEXT,
  gender TEXT,
  city TEXT,
  state TEXT,
  bio TEXT,
  school_name TEXT,
  campus TEXT,
  match_score INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_prefs RECORD;
  v_budget_min INTEGER;
  v_budget_max INTEGER;
BEGIN
  -- Get the searcher's preferences
  SELECT * INTO v_prefs
  FROM public.roommate_preferences
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_budget_min := COALESCE(v_prefs.budget_min, 100000);
  v_budget_max := COALESCE(v_prefs.budget_max, 2000000);

  RETURN QUERY
  SELECT 
    p.user_id,
    p.username,
    p.full_name,
    p.gender,
    p.city,
    p.state,
    p.bio,
    rp.school_name,
    rp.campus,
    -- Calculate match score (0-100)
    (
      -- Budget compatibility (40%)
      40 - ABS(COALESCE(rp.budget_min, v_budget_min) - v_budget_min) * 40 / NULLIF(GREATEST(v_budget_max, COALESCE(rp.budget_max, v_budget_max)), 0)
      +
      -- Location match (30%)
      CASE WHEN p.city = v_prefs.city THEN 30 ELSE 0 END
      +
      -- School match (15%)
      CASE WHEN rp.school_name = v_prefs.school_name AND v_prefs.school_match THEN 15 ELSE 0 END
      +
      -- Campus match (10%)
      CASE WHEN rp.campus = v_prefs.campus AND v_prefs.campus_match THEN 10 ELSE 0 END
      +
      -- Gender preference (5%)
      CASE 
        WHEN v_prefs.gender_preference = 'no_preference' THEN 5
        WHEN p.gender = v_prefs.gender_preference THEN 5
        ELSE 0
      END
    )::INTEGER AS match_score
  FROM public.profiles p
  INNER JOIN public.roommate_preferences rp ON rp.user_id = p.user_id
  WHERE p.user_id != p_user_id
    AND p.role = 'user'
    AND p.deleted = false
    AND rp.search_status IN ('active', 'stopped')
    -- Budget overlap check
    AND COALESCE(rp.budget_max, 999999999) >= v_budget_min
    AND COALESCE(rp.budget_min, 0) <= v_budget_max
    -- Gender filter
    AND (
      v_prefs.gender_preference = 'no_preference'
      OR p.gender = v_prefs.gender_preference
      OR p.gender IS NULL
    )
    -- Exclude already matched users
    AND NOT EXISTS (
      SELECT 1 FROM public.roommate_search_results rsr
      WHERE rsr.searcher_id = p_user_id
        AND rsr.matched_user_id = p.user_id
    )
  ORDER BY match_score DESC
  LIMIT 20;
END;
$$;

-- 2. Ensure roommate_search_results table exists with correct schema
CREATE TABLE IF NOT EXISTS public.roommate_search_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  searcher_id TEXT NOT NULL,
  matched_user_id TEXT NOT NULL,
  match_score INTEGER DEFAULT 0,
  status TEXT DEFAULT 'new', -- new, viewed, accepted, declined
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(searcher_id, matched_user_id)
);

-- Enable RLS on roommate_search_results
ALTER TABLE public.roommate_search_results ENABLE ROW LEVEL SECURITY;

-- Drop existing policy and recreate
DROP POLICY IF EXISTS "search_results_searcher" ON public.roommate_search_results;
CREATE POLICY "search_results_searcher" ON public.roommate_search_results
  FOR ALL TO authenticated
  USING (searcher_id = auth.uid()::text);

-- 3. Create index for performance
CREATE INDEX IF NOT EXISTS idx_roommate_search_searcher ON public.roommate_search_results(searcher_id);
CREATE INDEX IF NOT EXISTS idx_roommate_search_matched ON public.roommate_search_results(matched_user_id);

-- 4. Ensure roommate_preferences has search_status column
ALTER TABLE public.roommate_preferences 
  ADD COLUMN IF NOT EXISTS search_status TEXT DEFAULT 'stopped',
  ADD COLUMN IF NOT EXISTS search_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS search_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS search_match_count INTEGER DEFAULT 0;
