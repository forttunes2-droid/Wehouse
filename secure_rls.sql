-- ═══════════════════════════════════════════════════════════
-- SECURE RLS POLICIES — Fixed with UUID→TEXT casts
-- ═══════════════════════════════════════════════════════════

-- First, re-enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotels ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotel_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotel_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotel_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE enquiries ENABLE ROW LEVEL SECURITY;

-- Drop old open policies
DROP POLICY IF EXISTS "profiles_all" ON profiles;
DROP POLICY IF EXISTS "listings_all" ON listings;
DROP POLICY IF EXISTS "hotels_all" ON hotels;
DROP POLICY IF EXISTS "hotel_rooms_all" ON hotel_rooms;
DROP POLICY IF EXISTS "hotel_bookings_all" ON hotel_bookings;
DROP POLICY IF EXISTS "hotel_reviews_all" ON hotel_reviews;
DROP POLICY IF EXISTS "conversations_all" ON conversations;
DROP POLICY IF EXISTS "messages_all" ON messages;
DROP POLICY IF EXISTS "announcements_all" ON announcements;
DROP POLICY IF EXISTS "announcement_recipients_all" ON announcement_recipients;
DROP POLICY IF EXISTS "reviews_all" ON reviews;
DROP POLICY IF EXISTS "reservations_all" ON reservations;
DROP POLICY IF EXISTS "enquiries_all" ON enquiries;

-- ═══════════════════════════════════════════════════════════
-- PROFILES
-- ═══════════════════════════════════════════════════════════

CREATE POLICY "profiles_select_own" ON profiles FOR SELECT USING (
  user_id = (auth.uid())::text 
  OR role IN ('staff', 'admin', 'assistant_state_admin', 'state_admin', 'director', 'creator')
);

CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE USING (
  user_id = (auth.uid())::text
);

CREATE POLICY "profiles_insert" ON profiles FOR INSERT WITH CHECK (
  user_id = (auth.uid())::text
);

-- ═══════════════════════════════════════════════════════════
-- LISTINGS
-- ═══════════════════════════════════════════════════════════

CREATE POLICY "listings_select" ON listings FOR SELECT USING (
  status IN ('available', 'reserved') 
  OR owner_id = (auth.uid())::text
  OR EXISTS (SELECT 1 FROM profiles WHERE user_id = (auth.uid())::text AND role IN ('staff','admin','assistant_state_admin','state_admin','director','creator'))
);

CREATE POLICY "listings_insert" ON listings FOR INSERT WITH CHECK (
  owner_id = (auth.uid())::text
);

CREATE POLICY "listings_update" ON listings FOR UPDATE USING (
  owner_id = (auth.uid())::text
  OR EXISTS (SELECT 1 FROM profiles WHERE user_id = (auth.uid())::text AND role IN ('admin','assistant_state_admin','state_admin','director','creator'))
);

CREATE POLICY "listings_delete" ON listings FOR DELETE USING (
  owner_id = (auth.uid())::text
  OR EXISTS (SELECT 1 FROM profiles WHERE user_id = (auth.uid())::text AND role IN ('state_admin','director','creator'))
);

-- ═══════════════════════════════════════════════════════════
-- CONVERSATIONS
-- ═══════════════════════════════════════════════════════════

CREATE POLICY "conv_select" ON conversations FOR SELECT USING (
  user_a_id = (auth.uid())::text 
  OR user_b_id = (auth.uid())::text
  OR EXISTS (SELECT 1 FROM profiles WHERE user_id = (auth.uid())::text AND role IN ('staff','admin','assistant_state_admin','state_admin','director','creator'))
);

CREATE POLICY "conv_insert" ON conversations FOR INSERT WITH CHECK (
  user_a_id = (auth.uid())::text OR user_b_id = (auth.uid())::text
);

-- ═══════════════════════════════════════════════════════════
-- MESSAGES
-- ═══════════════════════════════════════════════════════════

CREATE POLICY "messages_select" ON messages FOR SELECT USING (
  sender_id = (auth.uid())::text
  OR EXISTS (
    SELECT 1 FROM conversations c 
    WHERE c.conversation_id = messages.conversation_id 
    AND (c.user_a_id = (auth.uid())::text OR c.user_b_id = (auth.uid())::text)
  )
);

CREATE POLICY "messages_insert" ON messages FOR INSERT WITH CHECK (
  sender_id = (auth.uid())::text
);

-- ═══════════════════════════════════════════════════════════
-- HOTELS
-- ═══════════════════════════════════════════════════════════

CREATE POLICY "hotels_select" ON hotels FOR SELECT USING (
  status = 'active'
  OR EXISTS (SELECT 1 FROM profiles WHERE user_id = (auth.uid())::text AND role IN ('state_admin','director','creator'))
);

CREATE POLICY "hotels_insert" ON hotels FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE user_id = (auth.uid())::text AND role IN ('state_admin','director','creator'))
);

CREATE POLICY "hotels_update" ON hotels FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE user_id = (auth.uid())::text AND role IN ('state_admin','director','creator'))
);

-- ═══════════════════════════════════════════════════════════
-- HOTEL ROOMS
-- ═══════════════════════════════════════════════════════════

CREATE POLICY "hotel_rooms_select" ON hotel_rooms FOR SELECT USING (true);

CREATE POLICY "hotel_rooms_insert" ON hotel_rooms FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE user_id = (auth.uid())::text AND role IN ('state_admin','director','creator'))
);

CREATE POLICY "hotel_rooms_update" ON hotel_rooms FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE user_id = (auth.uid())::text AND role IN ('state_admin','director','creator'))
);

-- ═══════════════════════════════════════════════════════════
-- HOTEL BOOKINGS
-- ═══════════════════════════════════════════════════════════

CREATE POLICY "bookings_select" ON hotel_bookings FOR SELECT USING (
  user_id = (auth.uid())::text
  OR EXISTS (SELECT 1 FROM profiles WHERE user_id = (auth.uid())::text AND role IN ('state_admin','director','creator'))
);

CREATE POLICY "bookings_insert" ON hotel_bookings FOR INSERT WITH CHECK (
  user_id = (auth.uid())::text
);

-- ═══════════════════════════════════════════════════════════
-- HOTEL REVIEWS
-- ═══════════════════════════════════════════════════════════

CREATE POLICY "hotel_reviews_select" ON hotel_reviews FOR SELECT USING (true);

CREATE POLICY "hotel_reviews_insert" ON hotel_reviews FOR INSERT WITH CHECK (
  user_id = (auth.uid())::text
);

-- ═══════════════════════════════════════════════════════════
-- ANNOUNCEMENTS
-- ═══════════════════════════════════════════════════════════

CREATE POLICY "announcements_select" ON announcements FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE user_id = (auth.uid())::text)
);

CREATE POLICY "announcements_insert" ON announcements FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE user_id = (auth.uid())::text AND role IN ('state_admin','director','creator'))
);

-- ═══════════════════════════════════════════════════════════
-- ANNOUNCEMENT RECIPIENTS
-- ═══════════════════════════════════════════════════════════

CREATE POLICY "recipients_select" ON announcement_recipients FOR SELECT USING (
  user_id = (auth.uid())::text
);

-- ═══════════════════════════════════════════════════════════
-- REPORTS
-- ═══════════════════════════════════════════════════════════

CREATE POLICY "reports_select" ON listing_reports FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE user_id = (auth.uid())::text AND role IN ('state_admin','director','creator'))
);

CREATE POLICY "reports_insert" ON listing_reports FOR INSERT WITH CHECK (
  reporter_id = (auth.uid())::text
);

-- ═══════════════════════════════════════════════════════════
-- RESERVATIONS
-- ═══════════════════════════════════════════════════════════

CREATE POLICY "reservations_select" ON reservations FOR SELECT USING (
  user_id = (auth.uid())::text
  OR EXISTS (SELECT 1 FROM profiles WHERE user_id = (auth.uid())::text AND role IN ('staff','admin','assistant_state_admin','state_admin','director','creator'))
);

CREATE POLICY "reservations_insert" ON reservations FOR INSERT WITH CHECK (
  user_id = (auth.uid())::text
);

-- ═══════════════════════════════════════════════════════════
-- ENQUIRIES
-- ═══════════════════════════════════════════════════════════

CREATE POLICY "enquiries_select" ON enquiries FOR SELECT USING (
  user_id = (auth.uid())::text
  OR staff_id = (auth.uid())::text
  OR EXISTS (SELECT 1 FROM profiles WHERE user_id = (auth.uid())::text AND role IN ('admin','assistant_state_admin','state_admin','director','creator'))
);

CREATE POLICY "enquiries_insert" ON enquiries FOR INSERT WITH CHECK (
  user_id = (auth.uid())::text
);

-- ═══════════════════════════════════════════════════════════
-- AUDIT LOGS
-- ═══════════════════════════════════════════════════════════

CREATE POLICY "audit_select" ON audit_logs FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE user_id = (auth.uid())::text AND role IN ('director','creator'))
);

-- ═══════════════════════════════════════════════════════════
-- IMAGE HASHES (for duplicate detection)
-- ═══════════════════════════════════════════════════════════

CREATE POLICY "image_hashes_select" ON listing_image_hashes FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE user_id = (auth.uid())::text)
);

CREATE POLICY "image_hashes_insert" ON listing_image_hashes FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE user_id = (auth.uid())::text)
);

-- ═══════════════════════════════════════════════════════════
-- NOTIFICATIONS
-- ═══════════════════════════════════════════════════════════

CREATE POLICY "notifications_select" ON notifications FOR SELECT USING (
  user_id = (auth.uid())::text
);

CREATE POLICY "notifications_insert" ON notifications FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE user_id = (auth.uid())::text AND role IN ('staff','admin','assistant_state_admin','state_admin','director','creator'))
);

-- ═══════════════════════════════════════════════════════════
-- WORKERS
-- ═══════════════════════════════════════════════════════════

CREATE POLICY "workers_select" ON workers FOR SELECT USING (true);

CREATE POLICY "workers_insert" ON workers FOR INSERT WITH CHECK (
  user_id = (auth.uid())::text
);

CREATE POLICY "workers_update" ON workers FOR UPDATE USING (
  user_id = (auth.uid())::text
  OR EXISTS (SELECT 1 FROM profiles WHERE user_id = (auth.uid())::text AND role IN ('state_admin','director','creator'))
);

-- ═══════════════════════════════════════════════════════════
-- SYSTEM SETTINGS / PLATFORM SETTINGS
-- ═══════════════════════════════════════════════════════════

CREATE POLICY "settings_select" ON system_settings FOR SELECT USING (true);
CREATE POLICY "settings_update" ON system_settings FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE user_id = (auth.uid())::text AND role = 'creator')
);

CREATE POLICY "platform_settings_select" ON platform_settings FOR SELECT USING (true);
CREATE POLICY "platform_settings_update" ON platform_settings FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE user_id = (auth.uid())::text AND role = 'creator')
);

-- ═══════════════════════════════════════════════════════════
-- VERIFY POLICIES ARE CREATED
-- ═══════════════════════════════════════════════════════════
SELECT tablename, policyname, permissive, roles, cmd, qual 
FROM pg_policies 
WHERE schemaname = 'public' 
AND tablename IN ('profiles', 'listings', 'hotels', 'hotel_bookings', 'conversations', 'messages', 'announcements', 'listing_reports')
ORDER BY tablename, policyname;
