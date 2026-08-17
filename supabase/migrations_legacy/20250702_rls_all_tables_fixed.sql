-- ============================================================
-- RLS FOR ALL REMAINING TABLES — INTEGER FIX
-- Some tables have user_id as INTEGER, not TEXT.
-- Fix: cast both sides ::text so it works for both types.
-- ============================================================

-- FAVORITES — user_id is integer
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "favorites_owner" ON favorites;
CREATE POLICY "favorites_owner" ON favorites FOR ALL TO authenticated USING (user_id::text = auth.uid()::text);

-- PAYMENTS — user_id is integer
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payments_owner" ON payments;
CREATE POLICY "payments_owner" ON payments FOR ALL TO authenticated USING (user_id::text = auth.uid()::text OR EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role IN ('staff','admin','state_admin','assistant_state_admin','director','creator','creator_admin')));

-- REVIEWS — reviewer_id and reviewee_id are integer
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reviews_participants" ON reviews;
CREATE POLICY "reviews_participants" ON reviews FOR ALL TO authenticated USING (reviewer_id::text = auth.uid()::text OR reviewee_id::text = auth.uid()::text OR EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role IN ('staff','admin','state_admin','assistant_state_admin','director','creator','creator_admin')));

-- STAFF
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff_read" ON staff;
DROP POLICY IF EXISTS "staff_admin_write" ON staff;
CREATE POLICY "staff_read" ON staff FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role IN ('staff','admin','state_admin','assistant_state_admin','director','creator','creator_admin')));
CREATE POLICY "staff_admin_write" ON staff FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role IN ('admin','state_admin','director','creator','creator_admin')));

-- ROOMMATE_PROFILES — user_id is integer
ALTER TABLE roommate_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "roommate_profiles_owner" ON roommate_profiles;
CREATE POLICY "roommate_profiles_owner" ON roommate_profiles FOR ALL TO authenticated USING (user_id::text = auth.uid()::text);

-- TEST_BASIC — recommend deleting this table
ALTER TABLE test_basic ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "test_basic_creator_only" ON test_basic;
CREATE POLICY "test_basic_creator_only" ON test_basic FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role = 'creator'));

-- USER_ID_COUNTER
ALTER TABLE user_id_counter ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_id_counter_restricted" ON user_id_counter;
CREATE POLICY "user_id_counter_restricted" ON user_id_counter FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role IN ('creator','creator_admin')));

-- USER_IDS
ALTER TABLE user_ids ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_ids_restricted" ON user_ids;
CREATE POLICY "user_ids_restricted" ON user_ids FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role IN ('creator','creator_admin')));

-- PLATFORM_SETTINGS — stores OpenAI keys, creator only
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "platform_settings_creator" ON platform_settings;
CREATE POLICY "platform_settings_creator" ON platform_settings FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role IN ('creator','creator_admin')));

-- SYSTEM_SETTINGS
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "system_settings_creator" ON system_settings;
CREATE POLICY "system_settings_creator" ON system_settings FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role IN ('creator','creator_admin')));

-- USER_ACTIVITY — user_id is integer
ALTER TABLE user_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_activity_owner" ON user_activity;
CREATE POLICY "user_activity_owner" ON user_activity FOR ALL TO authenticated USING (user_id::text = auth.uid()::text OR EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role IN ('staff','admin','state_admin','assistant_state_admin','director','creator','creator_admin')));

-- USER_SESSIONS — user_id is integer
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_sessions_owner" ON user_sessions;
CREATE POLICY "user_sessions_owner" ON user_sessions FOR ALL TO authenticated USING (user_id::text = auth.uid()::text);

-- LISTING_REPORTS — reporter_id is integer
ALTER TABLE listing_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "listing_reports_policy" ON listing_reports;
CREATE POLICY "listing_reports_policy" ON listing_reports FOR ALL TO authenticated USING (reporter_id::text = auth.uid()::text OR EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role IN ('staff','admin','state_admin','assistant_state_admin','director','creator','creator_admin')));

-- ROLE_CHANGE_HISTORY
ALTER TABLE role_change_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "role_change_history_policy" ON role_change_history;
CREATE POLICY "role_change_history_policy" ON role_change_history FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role IN ('admin','state_admin','director','creator','creator_admin')));

-- STAFF_REVIEWS
ALTER TABLE staff_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff_reviews_policy" ON staff_reviews;
CREATE POLICY "staff_reviews_policy" ON staff_reviews FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role IN ('staff','admin','state_admin','assistant_state_admin','director','creator','creator_admin')));

-- LISTING_IMAGE_HASHES — no user_id, read-only for all
ALTER TABLE listing_image_hashes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "image_hashes_read" ON listing_image_hashes;
CREATE POLICY "image_hashes_read" ON listing_image_hashes FOR SELECT TO authenticated USING (true);

-- MESSAGE_REQUESTS — sender_id and receiver_id are integer
ALTER TABLE message_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "message_requests_owner" ON message_requests;
CREATE POLICY "message_requests_owner" ON message_requests FOR ALL TO authenticated USING (sender_id::text = auth.uid()::text OR receiver_id::text = auth.uid()::text);

-- NOTIFICATIONS — user_id is integer
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notifications_owner" ON notifications;
CREATE POLICY "notifications_owner" ON notifications FOR ALL TO authenticated USING (user_id::text = auth.uid()::text);

-- ROOMMATE_SEARCH_RESULTS — user_id is integer
ALTER TABLE roommate_search_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "search_results_owner" ON roommate_search_results;
CREATE POLICY "search_results_owner" ON roommate_search_results FOR ALL TO authenticated USING (user_id::text = auth.uid()::text);

-- USER_COUNTERS — user_id is integer
ALTER TABLE user_counters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_counters_owner" ON user_counters;
CREATE POLICY "user_counters_owner" ON user_counters FOR ALL TO authenticated USING (user_id::text = auth.uid()::text);
