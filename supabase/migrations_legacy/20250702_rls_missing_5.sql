-- ============================================================
-- FINAL 5 TABLES — RLS FIX
-- Only chat_usage is actively used in code.
-- The other 4 are dead tables — recommend deleting them.
-- ============================================================

-- CHAT_USAGE — actively used by aiChat.ts for message tracking
-- Columns: user_id (text), date (text), created_at (timestamptz)
ALTER TABLE chat_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "chat_usage_owner" ON chat_usage;
CREATE POLICY "chat_usage_owner" ON chat_usage FOR ALL TO authenticated USING (user_id = auth.uid()::text);

-- The 4 tables below are NOT referenced anywhere in the codebase.
-- They appear to be leftover from earlier development.
-- You should delete them, but if you want to keep them:

-- BOOKINGS — dead table (code uses hotel_bookings instead)
-- Either delete it or restrict it
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bookings_restrict" ON bookings;
CREATE POLICY "bookings_restrict" ON bookings FOR ALL TO authenticated USING (false);

-- HOSTEL_HISTORY — dead table, not referenced in code
ALTER TABLE hostel_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hostel_history_restrict" ON hostel_history;
CREATE POLICY "hostel_history_restrict" ON hostel_history FOR ALL TO authenticated USING (false);

-- HOSTELS — dead table (code uses hotels instead)
ALTER TABLE hostels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hostels_restrict" ON hostels;
CREATE POLICY "hostels_restrict" ON hostels FOR ALL TO authenticated USING (false);

-- WORKER_PHOTOS — dead table, not referenced in code
ALTER TABLE worker_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "worker_photos_restrict" ON worker_photos;
CREATE POLICY "worker_photos_restrict" ON worker_photos FOR ALL TO authenticated USING (false);
