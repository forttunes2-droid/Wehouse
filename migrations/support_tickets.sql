-- Support tickets table for chat bot complaints
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

-- Users can see their own tickets
CREATE POLICY "tickets_select_own" ON support_tickets
  FOR SELECT USING (user_id = (auth.uid())::text);

-- Users can create their own tickets
CREATE POLICY "tickets_insert_own" ON support_tickets
  FOR INSERT WITH CHECK (user_id = (auth.uid())::text);

-- Admins can see all tickets
CREATE POLICY "tickets_select_admin" ON support_tickets
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM profiles WHERE auth_id = auth.uid() 
    AND role IN ('creator', 'creator_admin', 'state_admin', 'admin', 'director')
  ));

-- Admins can update/reply to tickets
CREATE POLICY "tickets_update_admin" ON support_tickets
  FOR UPDATE USING (EXISTS (
    SELECT 1 FROM profiles WHERE auth_id = auth.uid() 
    AND role IN ('creator', 'creator_admin', 'state_admin', 'admin', 'director')
  ));
