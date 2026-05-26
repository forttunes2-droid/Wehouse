-- ============================================================
-- WeHouse Student Housing Platform v2
-- Schools, Viewings, Notifications, Badges, Public Pages
-- ============================================================

-- ─── 1. SCHOOL FIELDS ON PROFILES ───────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS school_name TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS campus TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS faculty TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS department TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS level TEXT DEFAULT NULL; -- 100, 200, 300, 400, 500
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_student BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS gender TEXT DEFAULT NULL; -- male, female, other

-- ─── 2. SCHOOLS TABLE ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS schools (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  state TEXT NOT NULL,
  lga TEXT NOT NULL,
  campus TEXT DEFAULT NULL,
  type TEXT DEFAULT 'university', -- university, polytechnic, college
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
CREATE POLICY "schools_select_all" ON schools FOR SELECT USING (true);

-- Insert Nasarawa State schools
INSERT INTO schools (name, state, lga, campus, type) VALUES
  ('Nasarawa State University', 'Nasarawa', 'Keffi', 'Keffi', 'university'),
  ('Nasarawa State University', 'Nasarawa', 'Lafia', 'Lafia', 'university'),
  ('Federal University of Lafia', 'Nasarawa', 'Lafia', 'Main Campus', 'university'),
  ('Nasarawa State Polytechnic', 'Nasarawa', 'Lafia', 'Lafia', 'polytechnic'),
  ('College of Education Akwanga', 'Nasarawa', 'Akwanga', 'Akwanga', 'college'),
  ('Federal College of Education', 'Nasarawa', 'Akwanga', 'Akwanga', 'college'),
  ('Nasarawa State College of Agriculture', 'Nasarawa', 'Lafia', 'Lafia', 'college'),
  ('Bingham University', 'Nasarawa', 'Karu', 'Karu', 'university'),
  ('Nigeria Police Academy', 'Nasarawa', 'Wuse', 'Wuse', 'university'),
  ('Federal Polytechnic Nasarawa', 'Nasarawa', 'Nasarawa', 'Nasarawa', 'polytechnic'),
  ('Open University of Nigeria', 'Nasarawa', 'Keffi', 'Study Centre', 'university'),
  ('Salem University', 'Nasarawa', 'Lokongoma', 'Lokongoma', 'university'),
  ('Nasarawa State University', 'Nasarawa', 'Shabu', 'Shabu', 'university'),
  ('Nasarawa State University', 'Nasarawa', 'Gudi', 'Gudi', 'university')
ON CONFLICT DO NOTHING;

-- ─── 3. VIEWINGS / INSPECTIONS TABLE ────────────────────────
CREATE TABLE IF NOT EXISTS viewings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  listing_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  staff_id TEXT,
  requested_date TIMESTAMPTZ,
  status TEXT DEFAULT 'requested', -- requested, approved, completed, cancelled, declined
  notes TEXT,
  staff_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE viewings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "viewings_select_user" ON viewings;
DROP POLICY IF EXISTS "viewings_insert_user" ON viewings;
DROP POLICY IF EXISTS "viewings_update_staff" ON viewings;

CREATE POLICY "viewings_select_user" ON viewings FOR SELECT USING (
  auth.uid()::text = user_id OR
  EXISTS (SELECT 1 FROM profiles p WHERE p.auth_id = auth.uid()::text AND p.role IN ('creator','admin','staff'))
);
CREATE POLICY "viewings_insert_user" ON viewings FOR INSERT WITH CHECK (true);
CREATE POLICY "viewings_update_staff" ON viewings FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.auth_id = auth.uid()::text AND p.role IN ('creator','admin','staff'))
);

-- ─── 4. NOTIFICATIONS TABLE ─────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL, -- reservation_approved, staff_replied, listing_approved, viewing_approved, role_changed, etc
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read BOOLEAN DEFAULT FALSE,
  data JSONB DEFAULT NULL, -- extra payload
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select_own" ON notifications;
DROP POLICY IF EXISTS "notifications_insert_all" ON notifications;
DROP POLICY IF EXISTS "notifications_update_own" ON notifications;

CREATE POLICY "notifications_select_own" ON notifications FOR SELECT USING (auth.uid()::text = user_id);
CREATE POLICY "notifications_insert_all" ON notifications FOR INSERT WITH CHECK (true);
CREATE POLICY "notifications_update_own" ON notifications FOR UPDATE USING (auth.uid()::text = user_id);

-- ─── 5. VERIFIED BADGES ─────────────────────────────────────
-- Add badge fields to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_verified_staff BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_verified_housing BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS verified_by TEXT DEFAULT NULL;

-- ─── 6. SAVED LISTINGS (ensure exists) ──────────────────────
-- Already exists from earlier, just add RLS if missing
CREATE TABLE IF NOT EXISTS saved_listings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, listing_id)
);

ALTER TABLE saved_listings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saved_select_own" ON saved_listings;
DROP POLICY IF EXISTS "saved_insert_own" ON saved_listings;
DROP POLICY IF EXISTS "saved_delete_own" ON saved_listings;

CREATE POLICY "saved_select_own" ON saved_listings FOR SELECT USING (auth.uid()::text = user_id);
CREATE POLICY "saved_insert_own" ON saved_listings FOR INSERT WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "saved_delete_own" ON saved_listings FOR DELETE USING (auth.uid()::text = user_id);

-- ─── 7. PUBLIC PAGES CONTENT ────────────────────────────────
CREATE TABLE IF NOT EXISTS public_pages (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pages_select_all" ON public_pages FOR SELECT USING (true);
CREATE POLICY "pages_update_admin" ON public_pages FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.auth_id = auth.uid()::text AND p.role IN ('creator','admin'))
);

-- Insert default pages
INSERT INTO public_pages (slug, title, content) VALUES
  ('about', 'About WeHouse', 'WeHouse is a student housing platform connecting students with safe, verified housing options near their campuses. Find houses, connect with roommates, and hire verified workers for your housing needs.'),
  ('privacy', 'Privacy Policy', 'WeHouse respects your privacy. We collect minimal data necessary to provide housing services. Your personal information is protected and never sold to third parties.'),
  ('terms', 'Terms of Service', 'By using WeHouse, you agree to our terms. All listings are verified by our team. Users must provide accurate information. We reserve the right to remove content that violates our policies.'),
  ('contact', 'Contact Us', 'Email: support@wehouse.ng\nPhone: +234 800 000 0000\nAddress: Lafia, Nasarawa State, Nigeria')
ON CONFLICT (slug) DO NOTHING;

-- ─── 8. ROOMMATE PREFERENCES (enhanced) ─────────────────────
-- Add future-ready fields
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS gender_preference TEXT DEFAULT NULL; -- same, any
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS budget_range TEXT DEFAULT NULL; -- e.g. "50000-100000"
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS roommate_needed BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS school_match_preferred BOOLEAN DEFAULT TRUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS campus_match_preferred BOOLEAN DEFAULT TRUE;
