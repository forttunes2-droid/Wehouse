-- ═══════════════════════════════════════════════════════════════
-- FIX: Chat RLS Policies — Allow users to send/receive messages
-- ═══════════════════════════════════════════════════════════════

-- ─── CONVERSATIONS TABLE ─────────────────────────────────────

-- Enable RLS
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- Drop old policies if they exist
DROP POLICY IF EXISTS "conversations_select" ON conversations;
DROP POLICY IF EXISTS "conversations_insert" ON conversations;
DROP POLICY IF EXISTS "conversations_update" ON conversations;

-- Users can see conversations where they are a participant
CREATE POLICY "conversations_select" ON conversations
  FOR SELECT TO authenticated
  USING (
    participant_a = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
    OR participant_b = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
    OR EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin'))
  );

-- Users can create conversations
CREATE POLICY "conversations_insert" ON conversations
  FOR INSERT TO authenticated
  WITH CHECK (
    participant_a = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
    OR EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin'))
  );

-- Participants can update conversations (mark seen, status changes)
CREATE POLICY "conversations_update" ON conversations
  FOR UPDATE TO authenticated
  USING (
    participant_a = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
    OR participant_b = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
    OR EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin'))
  );

-- ─── MESSAGES TABLE ──────────────────────────────────────────

-- Enable RLS
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Drop old policies if they exist
DROP POLICY IF EXISTS "messages_select" ON messages;
DROP POLICY IF EXISTS "messages_insert" ON messages;
DROP POLICY IF EXISTS "messages_update" ON messages;

-- Users can see messages in conversations they participate in
CREATE POLICY "messages_select" ON messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
      AND (c.participant_a = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
           OR c.participant_b = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1))
    )
    OR EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin'))
  );

-- Users can send messages to conversations they participate in
CREATE POLICY "messages_insert" ON messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
      AND (c.participant_a = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
           OR c.participant_b = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1))
    )
  );

-- Users can mark messages as seen
CREATE POLICY "messages_update" ON messages
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
      AND (c.participant_a = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
           OR c.participant_b = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1))
    )
  );
