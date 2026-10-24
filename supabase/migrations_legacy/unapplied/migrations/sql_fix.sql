CREATE TABLE IF NOT EXISTS chat_photo_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_photo_user ON chat_photo_usage(user_id);

ALTER TABLE chat_photo_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "photo_select_own" ON chat_photo_usage
  FOR SELECT USING (user_id = (auth.uid())::text);

CREATE POLICY "photo_insert_own" ON chat_photo_usage
  FOR INSERT WITH CHECK (user_id = (auth.uid())::text);

CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  auth_id TEXT NOT NULL,
  device TEXT,
  browser TEXT,
  os TEXT,
  is_active BOOLEAN DEFAULT true,
  is_current BOOLEAN DEFAULT true,
  login_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  logout_time TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(user_id, is_active);

ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sess_select_own" ON user_sessions
  FOR SELECT USING (user_id = (auth.uid())::text);

CREATE POLICY "sess_insert_own" ON user_sessions
  FOR INSERT WITH CHECK (user_id = (auth.uid())::text);

CREATE POLICY "sess_update_own" ON user_sessions
  FOR UPDATE USING (user_id = (auth.uid())::text);

SELECT 'Tables and policies created!' as status;
