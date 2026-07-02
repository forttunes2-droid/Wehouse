-- ============================================================
-- RLS POLICIES — COMPLETE WORKING VERSION
-- Run this entire block in Supabase SQL Editor
-- ============================================================

-- 1. LISTINGS
ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "listings_public_read" ON listings;
DROP POLICY IF EXISTS "listings_staff_all" ON listings;
CREATE POLICY "listings_public_read" ON listings FOR SELECT TO authenticated USING (status IN ('available', 'reserved', 'pending_approval'));
CREATE POLICY "listings_staff_all" ON listings FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role IN ('staff','admin','state_admin','assistant_state_admin','director','creator','creator_admin')));

-- 2. CONVERSATIONS
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "conversations_participants" ON conversations;
CREATE POLICY "conversations_participants" ON conversations FOR ALL TO authenticated USING (participant_a = auth.uid()::text OR participant_b = auth.uid()::text OR EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role IN ('staff','admin','state_admin','assistant_state_admin','director','creator','creator_admin')));

-- 3. MESSAGES
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "messages_participants" ON messages;
CREATE POLICY "messages_participants" ON messages FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM conversations WHERE conversations.id = messages.conversation_id AND (conversations.participant_a = auth.uid()::text OR conversations.participant_b = auth.uid()::text)) OR EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role IN ('staff','admin','state_admin','assistant_state_admin','director','creator','creator_admin')));

-- 4. SAVED_LISTINGS
ALTER TABLE saved_listings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "saved_listings_owner" ON saved_listings;
CREATE POLICY "saved_listings_owner" ON saved_listings FOR ALL TO authenticated USING (user_id = auth.uid()::text);

-- 5. ENQUIRIES
ALTER TABLE enquiries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "enquiries_owner" ON enquiries;
CREATE POLICY "enquiries_owner" ON enquiries FOR ALL TO authenticated USING (user_id = auth.uid()::text OR EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role IN ('staff','admin','state_admin','assistant_state_admin','director','creator','creator_admin')));

-- 6. RESERVATIONS
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reservations_owner" ON reservations;
CREATE POLICY "reservations_owner" ON reservations FOR ALL TO authenticated USING (user_id = auth.uid()::text OR staff_id = auth.uid()::text OR EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role IN ('staff','admin','state_admin','assistant_state_admin','director','creator','creator_admin')));

-- 7. ROOMMATE_PREFERENCES
ALTER TABLE roommate_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "roommate_prefs_owner" ON roommate_preferences;
CREATE POLICY "roommate_prefs_owner" ON roommate_preferences FOR ALL TO authenticated USING (user_id = auth.uid()::text);

-- 8. ROOMMATE_MATCHES
ALTER TABLE roommate_matches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "roommate_matches_participants" ON roommate_matches;
CREATE POLICY "roommate_matches_participants" ON roommate_matches FOR ALL TO authenticated USING (user_a_id = auth.uid()::text OR user_b_id = auth.uid()::text);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_conversations_participant_a ON conversations(participant_a);
CREATE INDEX IF NOT EXISTS idx_conversations_participant_b ON conversations(participant_b);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_saved_listings_user_id ON saved_listings(user_id);
CREATE INDEX IF NOT EXISTS idx_enquiries_user_id ON enquiries(user_id);
CREATE INDEX IF NOT EXISTS idx_reservations_user_id ON reservations(user_id);
CREATE INDEX IF NOT EXISTS idx_reservations_staff_id ON reservations(staff_id);
CREATE INDEX IF NOT EXISTS idx_roommate_prefs_user_id ON roommate_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_roommate_matches_user_a ON roommate_matches(user_a_id);
CREATE INDEX IF NOT EXISTS idx_roommate_matches_user_b ON roommate_matches(user_b_id);

-- PROFILES
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "profiles_self" ON profiles;
CREATE POLICY "profiles_self" ON profiles FOR ALL TO authenticated USING (user_id = auth.uid()::text OR EXISTS (SELECT 1 FROM profiles AS p WHERE p.user_id = auth.uid()::text AND p.role IN ('staff','admin','state_admin','assistant_state_admin','director','creator','creator_admin')));

-- ANNOUNCEMENTS
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "announcements_read" ON announcements;
DROP POLICY IF EXISTS "announcements_staff_write" ON announcements;
CREATE POLICY "announcements_read" ON announcements FOR SELECT TO authenticated USING (true);
CREATE POLICY "announcements_staff_write" ON announcements FOR ALL TO authenticated USING (created_by = auth.uid()::text OR EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role IN ('staff','admin','state_admin','assistant_state_admin','director','creator','creator_admin')));
