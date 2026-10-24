-- ============================================================
-- AI Chat v2: Creator unlimited, photo limits, session tracking
-- ============================================================

-- ─── CHAT PHOTO USAGE TRACKING ─────────────────────────────
-- Normal users get 1 free photo total
-- Premium users get unlimited photos
-- Creator gets unlimited photos
CREATE TABLE IF NOT EXISTS chat_photo_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_photo_user ON chat_photo_usage(user_id);

ALTER TABLE chat_photo_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "photo_usage_select_own" ON chat_photo_usage
  FOR SELECT USING (user_id = (auth.uid())::text);

CREATE POLICY "photo_usage_insert_own" ON chat_photo_usage
  FOR INSERT WITH CHECK (user_id = (auth.uid())::text);

-- Admin can view all
CREATE POLICY "photo_usage_admin" ON chat_photo_usage
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM profiles WHERE auth_id = (auth.uid())::text
    AND role IN ('creator', 'creator_admin', 'state_admin', 'admin', 'director')
  ));

-- ─── SINGLE-DEVICE SESSION MANAGEMENT ──────────────────────
-- When user logs in on a new device, old session is invalidated
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  auth_id TEXT NOT NULL,
  device TEXT,
  browser TEXT,
  os TEXT,
  ip_address TEXT,
  is_active BOOLEAN DEFAULT true,
  is_current BOOLEAN DEFAULT true,
  login_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  logout_time TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(user_id, is_active);

ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sessions_select_own" ON user_sessions
  FOR SELECT USING (user_id = (auth.uid())::text);

CREATE POLICY "sessions_insert_own" ON user_sessions
  FOR INSERT WITH CHECK (user_id = (auth.uid())::text);

CREATE POLICY "sessions_update_own" ON user_sessions
  FOR UPDATE USING (user_id = (auth.uid())::text);

-- Admin can view all sessions
CREATE POLICY "sessions_admin" ON user_sessions
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM profiles WHERE auth_id = (auth.uid())::text
    AND role IN ('creator', 'creator_admin', 'state_admin', 'admin', 'director')
  ));

-- ─── FUNCTION: Invalidate old sessions on new login ───────
CREATE OR REPLACE FUNCTION invalidate_old_sessions()
RETURNS TRIGGER AS $$
BEGIN
  -- Deactivate all other active sessions for this user
  UPDATE user_sessions
  SET is_active = false, is_current = false
  WHERE user_id = NEW.user_id
    AND id != NEW.id
    AND is_active = true;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop if exists to allow re-running
DROP TRIGGER IF EXISTS trg_invalidate_old_sessions ON user_sessions;

CREATE TRIGGER trg_invalidate_old_sessions
  AFTER INSERT ON user_sessions
  FOR EACH ROW
  EXECUTE FUNCTION invalidate_old_sessions();

SELECT 'AI Chat v2 + Session management setup complete!' as status;
