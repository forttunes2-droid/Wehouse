-- ═══════════════════════════════════════════════════════════
-- SECURE RLS POLICIES V3 — Fixed column names
-- ═══════════════════════════════════════════════════════════

-- Step 1: Check actual column names in conversations table
-- Run this first to verify
SELECT column_name FROM information_schema.columns WHERE table_name = 'conversations' ORDER BY ordinal_position;

-- Step 2: Check actual column names in messages table
SELECT column_name FROM information_schema.columns WHERE table_name = 'messages' ORDER BY ordinal_position;

-- Step 3: Drop all existing policies
DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
DROP POLICY IF EXISTS "profiles_insert" ON profiles;
DROP POLICY IF EXISTS "listings_select" ON listings;
DROP POLICY IF EXISTS "listings_insert" ON listings;
DROP POLICY IF EXISTS "listings_update" ON listings;
DROP POLICY IF EXISTS "listings_delete" ON listings;
DROP POLICY IF EXISTS "conv_select" ON conversations;
DROP POLICY IF EXISTS "conv_insert" ON conversations;
DROP POLICY IF EXISTS "messages_select" ON messages;
DROP POLICY IF EXISTS "messages_insert" ON messages;
DROP POLICY IF EXISTS "hotels_select" ON hotels;
DROP POLICY IF EXISTS "hotels_insert" ON hotels;
DROP POLICY IF EXISTS "hotels_update" ON hotels;
DROP POLICY IF EXISTS "hotel_rooms_select" ON hotel_rooms;
DROP POLICY IF EXISTS "hotel_rooms_insert" ON hotel_rooms;
DROP POLICY IF EXISTS "hotel_rooms_update" ON hotel_rooms;
DROP POLICY IF EXISTS "bookings_select" ON hotel_bookings;
DROP POLICY IF EXISTS "bookings_insert" ON hotel_bookings;
DROP POLICY IF EXISTS "hotel_reviews_select" ON hotel_reviews;
DROP POLICY IF EXISTS "hotel_reviews_insert" ON hotel_reviews;
DROP POLICY IF EXISTS "announcements_select" ON announcements;
DROP POLICY IF EXISTS "announcements_insert" ON announcements;
DROP POLICY IF EXISTS "recipients_select" ON announcement_recipients;
DROP POLICY IF EXISTS "reports_select" ON listing_reports;
DROP POLICY IF EXISTS "reports_insert" ON listing_reports;
DROP POLICY IF EXISTS "reservations_select" ON reservations;
DROP POLICY IF EXISTS "reservations_insert" ON reservations;
DROP POLICY IF EXISTS "enquiries_select" ON enquiries;
DROP POLICY IF EXISTS "enquiries_insert" ON enquiries;
DROP POLICY IF EXISTS "audit_select" ON audit_logs;
DROP POLICY IF EXISTS "notifications_select" ON notifications;
DROP POLICY IF EXISTS "notifications_insert" ON notifications;
DROP POLICY IF EXISTS "settings_select" ON system_settings;
DROP POLICY IF EXISTS "settings_update" ON system_settings;
DROP POLICY IF EXISTS "platform_settings_select" ON platform_settings;
DROP POLICY IF EXISTS "platform_settings_update" ON platform_settings;
DROP POLICY IF EXISTS "test_policy" ON profiles;

-- ═══════════════════════════════════════════════════════════
-- PROFILES
-- ═══════════════════════════════════════════════════════════
CREATE POLICY "profiles_select_own" ON profiles FOR SELECT USING (
  user_id = (auth.uid())::text 
  OR role IN ('staff', 'admin', 'assistant_state_admin', 'state_admin', 'director', 'creator')
);
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE USING (user_id = (auth.uid())::text);
CREATE POLICY "profiles_insert" ON profiles FOR INSERT WITH CHECK (user_id = (auth.uid())::text);

-- ═══════════════════════════════════════════════════════════
-- LISTINGS
-- ═══════════════════════════════════════════════════════════
CREATE POLICY "listings_select" ON listings FOR SELECT USING (
  status IN ('available', 'reserved') 
  OR owner_id = (auth.uid())::text
  OR EXISTS (SELECT 1 FROM profiles WHERE user_id = (auth.uid())::text AND role IN ('staff','admin','assistant_state_admin','state_admin','director','creator'))
);
CREATE POLICY "listings_insert" ON listings FOR INSERT WITH CHECK (owner_id = (auth.uid())::text);
CREATE POLICY "listings_update" ON listings FOR UPDATE USING (
  owner_id = (auth.uid())::text
  OR EXISTS (SELECT 1 FROM profiles WHERE user_id = (auth.uid())::text AND role IN ('admin','assistant_state_admin','state_admin','director','creator'))
);
CREATE POLICY "listings_delete" ON listings FOR DELETE USING (
  owner_id = (auth.uid())::text
  OR EXISTS (SELECT 1 FROM profiles WHERE user_id = (auth.uid())::text AND role IN ('state_admin','director','creator'))
);

-- ═══════════════════════════════════════════════════════════
-- CONVERSATIONS — Uses profile_id and conv_id (fixed)
-- ═══════════════════════════════════════════════════════════
CREATE POLICY "conv_select" ON conversations FOR SELECT USING (
  profile_id = (auth.uid())::text
  OR EXISTS (SELECT 1 FROM profiles WHERE user_id = (auth.uid())::text AND role IN ('staff','admin','assistant_state_admin','state_admin','director','creator'))
);
CREATE POLICY "conv_insert" ON conversations FOR INSERT WITH CHECK (profile_id = (auth.uid())::text);

-- ═══════════════════════════════════════════════════════════
-- MESSAGES — Uses conv_id (fixed)
-- ═══════════════════════════════════════════════════════════
CREATE POLICY "messages_select" ON messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM conversations c WHERE c.conv_id = messages.conv_id AND c.profile_id = (auth.uid())::text)
  OR sender_id = (auth.uid())::text
);
CREATE POLICY "messages_insert" ON messages FOR INSERT WITH CHECK (sender_id = (auth.uid())::text);

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
CREATE POLICY "bookings_insert" ON hotel_bookings FOR INSERT WITH CHECK (user_id = (auth.uid())::text);

-- ═══════════════════════════════════════════════════════════
-- HOTEL REVIEWS
-- ═══════════════════════════════════════════════════════════
CREATE POLICY "hotel_reviews_select" ON hotel_reviews FOR SELECT USING (true);
CREATE POLICY "hotel_reviews_insert" ON hotel_reviews FOR INSERT WITH CHECK (user_id = (auth.uid())::text);

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
CREATE POLICY "recipients_select" ON announcement_recipients FOR SELECT USING (user_id = (auth.uid())::text);

-- ═══════════════════════════════════════════════════════════
-- REPORTS
-- ═══════════════════════════════════════════════════════════
CREATE POLICY "reports_select" ON listing_reports FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE user_id = (auth.uid())::text AND role IN ('state_admin','director','creator'))
);
CREATE POLICY "reports_insert" ON listing_reports FOR INSERT WITH CHECK (reporter_id = (auth.uid())::text);

-- ═══════════════════════════════════════════════════════════
-- RESERVATIONS
-- ═══════════════════════════════════════════════════════════
CREATE POLICY "reservations_select" ON reservations FOR SELECT USING (
  user_id = (auth.uid())::text
  OR EXISTS (SELECT 1 FROM profiles WHERE user_id = (auth.uid())::text AND role IN ('staff','admin','assistant_state_admin','state_admin','director','creator'))
);
CREATE POLICY "reservations_insert" ON reservations FOR INSERT WITH CHECK (user_id = (auth.uid())::text);

-- ═══════════════════════════════════════════════════════════
-- ENQUIRIES
-- ═══════════════════════════════════════════════════════════
CREATE POLICY "enquiries_select" ON enquiries FOR SELECT USING (
  user_id = (auth.uid())::text
  OR staff_id = (auth.uid())::text
  OR EXISTS (SELECT 1 FROM profiles WHERE user_id = (auth.uid())::text AND role IN ('admin','assistant_state_admin','state_admin','director','creator'))
);
CREATE POLICY "enquiries_insert" ON enquiries FOR INSERT WITH CHECK (user_id = (auth.uid())::text);

-- ═══════════════════════════════════════════════════════════
-- AUDIT LOGS
-- ═══════════════════════════════════════════════════════════
CREATE POLICY "audit_select" ON audit_logs FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE user_id = (auth.uid())::text AND role IN ('director','creator'))
);

-- ═══════════════════════════════════════════════════════════
-- NOTIFICATIONS
-- ═══════════════════════════════════════════════════════════
CREATE POLICY "notifications_select" ON notifications FOR SELECT USING (user_id = (auth.uid())::text);
CREATE POLICY "notifications_insert" ON notifications FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE user_id = (auth.uid())::text AND role IN ('staff','admin','assistant_state_admin','state_admin','director','creator'))
);

-- ═══════════════════════════════════════════════════════════
-- SYSTEM SETTINGS
-- ═══════════════════════════════════════════════════════════
CREATE POLICY "settings_select" ON system_settings FOR SELECT USING (true);
CREATE POLICY "settings_update" ON system_settings FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE user_id = (auth.uid())::text AND role = 'creator')
);

-- ═══════════════════════════════════════════════════════════
-- PLATFORM SETTINGS
-- ═══════════════════════════════════════════════════════════
CREATE POLICY "platform_settings_select" ON platform_settings FOR SELECT USING (true);
CREATE POLICY "platform_settings_update" ON platform_settings FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE user_id = (auth.uid())::text AND role = 'creator')
);
