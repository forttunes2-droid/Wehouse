-- ============================================================
-- RLS FOR ALL REMAINING TABLES — PROPER RESTRICTIONS
-- Run this entire block in Supabase SQL Editor
-- ============================================================

-- ─── FAVORITES ──────────────────────────────────────────────
-- Currently: RLS disabled. Fix: users see only their own.
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "favorites_owner" ON favorites;
CREATE POLICY "favorites_owner" ON favorites FOR ALL TO authenticated USING (user_id = auth.uid()::text);

-- ─── PAYMENTS ───────────────────────────────────────────────
-- Currently: UNRESTRICTED. Fix: users see only their own payments.
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payments_owner" ON payments;
CREATE POLICY "payments_owner" ON payments FOR ALL TO authenticated USING (user_id = auth.uid()::text OR EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role IN ('staff','admin','state_admin','assistant_state_admin','director','creator','creator_admin')));

-- ─── REVIEWS ────────────────────────────────────────────────
-- Currently: UNRESTRICTED. Fix: users see reviews they wrote or received.
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reviews_participants" ON reviews;
CREATE POLICY "reviews_participants" ON reviews FOR ALL TO authenticated USING (reviewer_id = auth.uid()::text OR reviewee_id = auth.uid()::text OR EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role IN ('staff','admin','state_admin','assistant_state_admin','director','creator','creator_admin')));

-- ─── STAFF ──────────────────────────────────────────────────
-- Currently: UNRESTRICTED. Fix: only staff+ can read, only admin+ can modify.
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff_read" ON staff;
DROP POLICY IF EXISTS "staff_admin_write" ON staff;
CREATE POLICY "staff_read" ON staff FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role IN ('staff','admin','state_admin','assistant_state_admin','director','creator','creator_admin')));
CREATE POLICY "staff_admin_write" ON staff FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role IN ('admin','state_admin','director','creator','creator_admin')));

-- ─── ROOMMATE_PROFILES ──────────────────────────────────────
-- Currently: UNRESTRICTED. Fix: users see only their own.
ALTER TABLE roommate_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "roommate_profiles_owner" ON roommate_profiles;
CREATE POLICY "roommate_profiles_owner" ON roommate_profiles FOR ALL TO authenticated USING (user_id = auth.uid()::text);

-- ─── TEST_BASIC ─────────────────────────────────────────────
-- Currently: UNRESTRICTED. This looks like a test table.
-- If it's not used in production, you should delete it.
-- If you keep it, this restricts it:
ALTER TABLE test_basic ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "test_basic_creator_only" ON test_basic;
CREATE POLICY "test_basic_creator_only" ON test_basic FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role = 'creator'));

-- ─── USER_ID_COUNTER ────────────────────────────────────────
-- Currently: UNRESTRICTED. This is an internal utility table.
ALTER TABLE user_id_counter ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_id_counter_restricted" ON user_id_counter;
CREATE POLICY "user_id_counter_restricted" ON user_id_counter FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role IN ('creator','creator_admin')));

-- ─── USER_IDS ───────────────────────────────────────────────
-- Currently: UNRESTRICTED. Internal utility table.
ALTER TABLE user_ids ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_ids_restricted" ON user_ids;
CREATE POLICY "user_ids_restricted" ON user_ids FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role IN ('creator','creator_admin')));

-- ─── ALSO CHECK: PLATFORM_SETTINGS ──────────────────────────
-- This table stores sensitive config (OpenAI keys, etc.)
-- It MUST be restricted to creator only.
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "platform_settings_creator" ON platform_settings;
CREATE POLICY "platform_settings_creator" ON platform_settings FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role IN ('creator','creator_admin')));

-- ─── ALSO CHECK: SYSTEM_SETTINGS ────────────────────────────
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "system_settings_creator" ON system_settings;
CREATE POLICY "system_settings_creator" ON system_settings FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role IN ('creator','creator_admin')));

-- ─── ALSO CHECK: USER_ACTIVITY ──────────────────────────────
ALTER TABLE user_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_activity_owner" ON user_activity;
CREATE POLICY "user_activity_owner" ON user_activity FOR ALL TO authenticated USING (user_id = auth.uid()::text OR EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role IN ('staff','admin','state_admin','assistant_state_admin','director','creator','creator_admin')));

-- ─── ALSO CHECK: USER_SESSIONS ──────────────────────────────
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_sessions_owner" ON user_sessions;
CREATE POLICY "user_sessions_owner" ON user_sessions FOR ALL TO authenticated USING (user_id = auth.uid()::text);

-- ─── ALSO CHECK: LISTING_REPORTS ────────────────────────────
ALTER TABLE listing_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "listing_reports_policy" ON listing_reports;
CREATE POLICY "listing_reports_policy" ON listing_reports FOR ALL TO authenticated USING (reporter_id = auth.uid()::text OR EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role IN ('staff','admin','state_admin','assistant_state_admin','director','creator','creator_admin')));

-- ─── ALSO CHECK: ROLE_CHANGE_HISTORY ────────────────────────
ALTER TABLE role_change_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "role_change_history_policy" ON role_change_history;
CREATE POLICY "role_change_history_policy" ON role_change_history FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role IN ('admin','state_admin','director','creator','creator_admin')));

-- ─── ALSO CHECK: STAFF_REVIEWS ──────────────────────────────
ALTER TABLE staff_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff_reviews_policy" ON staff_reviews;
CREATE POLICY "staff_reviews_policy" ON staff_reviews FOR ALL TO authenticated USING ( EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role IN ('staff','admin','state_admin','assistant_state_admin','director','creator','creator_admin')));

-- ─── ALSO CHECK: LISTING_IMAGE_HASHES ───────────────────────
ALTER TABLE listing_image_hashes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "image_hashes_read" ON listing_image_hashes;
CREATE POLICY "image_hashes_read" ON listing_image_hashes FOR SELECT TO authenticated USING (true);

-- ─── ALSO CHECK: MESSAGE_REQUESTS ───────────────────────────
ALTER TABLE message_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "message_requests_owner" ON message_requests;
CREATE POLICY "message_requests_owner" ON message_requests FOR ALL TO authenticated USING (sender_id = auth.uid()::text OR receiver_id = auth.uid()::text);

-- ─── ALSO CHECK: NOTIFICATIONS ──────────────────────────────
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notifications_owner" ON notifications;
CREATE POLICY "notifications_owner" ON notifications FOR ALL TO authenticated USING (user_id = auth.uid()::text);

-- ─── ALSO CHECK: ROOMMATE_SEARCH_RESULTS ────────────────────
ALTER TABLE roommate_search_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "search_results_owner" ON roommate_search_results;
CREATE POLICY "search_results_owner" ON roommate_search_results FOR ALL TO authenticated USING (user_id = auth.uid()::text);

-- ─── ALSO CHECK: USER_COUNTERS ──────────────────────────────
ALTER TABLE user_counters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_counters_owner" ON user_counters;
CREATE POLICY "user_counters_owner" ON user_counters FOR ALL TO authenticated USING (user_id = auth.uid()::text);
