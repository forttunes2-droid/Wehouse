CREATE TABLE IF NOT EXISTS chat_photo_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
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

SELECT 'done' as status;
