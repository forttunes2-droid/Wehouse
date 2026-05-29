-- ═══════════════════════════════════════════════════════════
-- Roommate Background Search System Migration
-- Adds 8-hour search window, persistent match results
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Add search status columns to roommate_preferences ───

-- Add search_status enum column (default: idle)
ALTER TABLE roommate_preferences 
ADD COLUMN IF NOT EXISTS search_status TEXT NOT NULL DEFAULT 'idle' 
CHECK (search_status IN ('idle', 'active', 'expired', 'stopped'));

-- Add search timestamp columns
ALTER TABLE roommate_preferences 
ADD COLUMN IF NOT EXISTS search_started_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE roommate_preferences 
ADD COLUMN IF NOT EXISTS search_expires_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE roommate_preferences 
ADD COLUMN IF NOT EXISTS search_match_count INTEGER NOT NULL DEFAULT 0;

-- ─── 2. Create roommate_search_results table ──────────────

CREATE TABLE IF NOT EXISTS roommate_search_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  searcher_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  matched_user_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  match_score INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'viewed', 'accepted', 'declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(searcher_id, matched_user_id)
);

-- ─── 3. Indexes for performance ───────────────────────────

CREATE INDEX IF NOT EXISTS idx_search_results_searcher 
ON roommate_search_results(searcher_id);

CREATE INDEX IF NOT EXISTS idx_search_results_matched 
ON roommate_search_results(matched_user_id);

CREATE INDEX IF NOT EXISTS idx_search_results_status 
ON roommate_search_results(searcher_id, status);

CREATE INDEX IF NOT EXISTS idx_prefs_search_status 
ON roommate_preferences(search_status) 
WHERE search_status = 'active';

-- ─── 4. RLS Policies for roommate_search_results ──────────

ALTER TABLE roommate_search_results ENABLE ROW LEVEL SECURITY;

-- Users can view their own search results
CREATE POLICY "search_results_select_own" ON roommate_search_results
  FOR SELECT USING (searcher_id = (auth.uid())::text);

-- Users can insert their own search results
CREATE POLICY "search_results_insert_own" ON roommate_search_results
  FOR INSERT WITH CHECK (searcher_id = (auth.uid())::text);

-- Users can update their own search result statuses
CREATE POLICY "search_results_update_own" ON roommate_search_results
  FOR UPDATE USING (searcher_id = (auth.uid())::text);

-- Users can delete their own search results
CREATE POLICY "search_results_delete_own" ON roommate_search_results
  FOR DELETE USING (searcher_id = (auth.uid())::text);

-- ─── 5. Function to auto-expire searches (run via cron) ───

CREATE OR REPLACE FUNCTION expire_old_searches()
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE roommate_preferences
  SET search_status = 'expired'
  WHERE search_status = 'active'
    AND search_expires_at < NOW();

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql;
