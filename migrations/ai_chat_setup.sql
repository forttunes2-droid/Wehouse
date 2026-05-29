-- Premium fields on profiles
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT false;

ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS premium_expires_at TIMESTAMPTZ DEFAULT NULL;

-- OpenAI API key storage (creator sets this)
INSERT INTO platform_settings (key, value) 
VALUES ('openai_api_key', NULL)
ON CONFLICT (key) DO NOTHING;

-- Chat usage tracking (7 messages per day per user)
CREATE TABLE IF NOT EXISTS chat_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_usage_user_date ON chat_usage(user_id, date);

-- Support tickets for complaints
CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES profiles(user_id) ON DELETE CASCADE,
  user_email TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'closed')),
  reply TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_user ON support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

-- FIXED: Cast auth.uid() to text
CREATE POLICY "tickets_select_own" ON support_tickets
  FOR SELECT USING (user_id = (auth.uid())::text);

CREATE POLICY "tickets_insert_own" ON support_tickets
  FOR INSERT WITH CHECK (user_id = (auth.uid())::text);

CREATE POLICY "tickets_select_admin" ON support_tickets
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM profiles WHERE auth_id = (auth.uid())::text
    AND role IN ('creator', 'creator_admin', 'state_admin', 'admin', 'director')
  ));

CREATE POLICY "tickets_update_admin" ON support_tickets
  FOR UPDATE USING (EXISTS (
    SELECT 1 FROM profiles WHERE auth_id = (auth.uid())::text
    AND role IN ('creator', 'creator_admin', 'state_admin', 'admin', 'director')
  ));

SELECT 'AI Chat setup complete!' as status;
