-- ============================================
-- ANNOUNCEMENT SYSTEM v2 - Complete Rebuild
-- ============================================

-- Drop old tables if they exist
DROP TABLE IF EXISTS official_message_recipients CASCADE;
DROP TABLE IF EXISTS official_messages CASCADE;

-- ============================================
-- 1. announcements table
-- ============================================
CREATE TABLE IF NOT EXISTS announcements (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  created_by TEXT NOT NULL,
  sender_name TEXT DEFAULT 'Admin',
  sender_role TEXT DEFAULT 'creator',
  target_type TEXT NOT NULL DEFAULT 'all_users',
  target_state TEXT,
  target_lga TEXT,
  recipient_count INTEGER DEFAULT 0,
  read_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 2. announcement_recipients table
-- ============================================
CREATE TABLE IF NOT EXISTS announcement_recipients (
  id SERIAL PRIMARY KEY,
  announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  read_status BOOLEAN DEFAULT FALSE,
  delivered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 3. Indexes for performance
-- ============================================
CREATE INDEX IF NOT EXISTS idx_announcements_created_by ON announcements(created_by);
CREATE INDEX IF NOT EXISTS idx_announcements_created_at ON announcements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_announcement_recipients_user_id ON announcement_recipients(user_id);
CREATE INDEX IF NOT EXISTS idx_announcement_recipients_announcement_id ON announcement_recipients(announcement_id);
CREATE INDEX IF NOT EXISTS idx_announcement_recipients_read_status ON announcement_recipients(read_status);

-- ============================================
-- 4. Enable Realtime
-- ============================================
ALTER PUBLICATION supabase_realtime ADD TABLE announcements;
ALTER PUBLICATION supabase_realtime ADD TABLE announcement_recipients;

-- ============================================
-- 5. RLS Policies - OPEN for authenticated users
-- ============================================
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_recipients ENABLE ROW LEVEL SECURITY;

-- announcements: anyone can read (to see message content)
CREATE POLICY "Anyone can read announcements"
ON announcements FOR SELECT TO authenticated USING (true);

-- announcements: anyone can insert (for sending)
CREATE POLICY "Anyone can insert announcements"
ON announcements FOR INSERT TO authenticated WITH CHECK (true);

-- announcements: creator can update (read count, etc)
CREATE POLICY "Anyone can update announcements"
ON announcements FOR UPDATE TO authenticated USING (true);

-- announcement_recipients: anyone can read
CREATE POLICY "Anyone can read recipients"
ON announcement_recipients FOR SELECT TO authenticated USING (true);

-- announcement_recipients: anyone can insert
CREATE POLICY "Anyone can insert recipients"
ON announcement_recipients FOR INSERT TO authenticated WITH CHECK (true);

-- announcement_recipients: recipient can update read_status
CREATE POLICY "Recipient can update read"
ON announcement_recipients FOR UPDATE TO authenticated USING (true);

-- ============================================
-- 6. Function to get unread count for a user
-- ============================================
CREATE OR REPLACE FUNCTION get_unread_announcement_count(p_user_id TEXT)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*)::INTEGER INTO v_count
  FROM announcement_recipients ar
  JOIN announcements a ON a.id = ar.announcement_id
  WHERE ar.user_id = p_user_id
  AND ar.read_status = FALSE;
  
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 7. Function to mark announcement as read
-- ============================================
CREATE OR REPLACE FUNCTION mark_announcement_read(p_announcement_id INTEGER, p_user_id TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE announcement_recipients
  SET read_status = TRUE
  WHERE announcement_id = p_announcement_id
  AND user_id = p_user_id
  AND read_status = FALSE;
  
  -- Update the read count on the announcement
  UPDATE announcements
  SET read_count = (
    SELECT COUNT(*) FROM announcement_recipients 
    WHERE announcement_id = p_announcement_id AND read_status = TRUE
  )
  WHERE id = p_announcement_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
