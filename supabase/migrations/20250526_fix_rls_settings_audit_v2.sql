-- ============================================
-- FIX V2: All types match TEXT (not UUID)
-- ============================================

-- STEP 1: PROFILES RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_all" ON profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
DROP POLICY IF EXISTS "profiles_update_admin" ON profiles;
DROP POLICY IF EXISTS "profiles_delete_admin" ON profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;

CREATE POLICY "profiles_select_all" ON profiles FOR SELECT USING (true);
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE USING (auth.uid() = auth_id);
CREATE POLICY "profiles_update_admin" ON profiles FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.auth_id = auth.uid() AND p.role IN ('creator','admin','staff'))
);
CREATE POLICY "profiles_delete_admin" ON profiles FOR DELETE USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.auth_id = auth.uid() AND p.role IN ('creator','admin','staff'))
);
CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT WITH CHECK (auth.uid() = auth_id);

-- STEP 2: PLATFORM SETTINGS TABLE
CREATE TABLE IF NOT EXISTS platform_settings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  key TEXT NOT NULL UNIQUE,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by TEXT
);

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "settings_select_all" ON platform_settings;
DROP POLICY IF EXISTS "settings_update_admin" ON platform_settings;

CREATE POLICY "settings_select_all" ON platform_settings FOR SELECT USING (true);
CREATE POLICY "settings_update_admin" ON platform_settings FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.auth_id = auth.uid() AND p.role IN ('creator','admin','staff'))
);

INSERT INTO platform_settings (key, value) VALUES
  ('platform_name', 'WeHouse'),
  ('listing_approval_required', 'false'),
  ('default_user_role', 'user'),
  ('maintenance_mode', 'false'),
  ('registration_open', 'true'),
  ('max_listings_per_user', '5')
ON CONFLICT (key) DO NOTHING;

-- STEP 3: AUDIT LOGS TABLE
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  admin_id TEXT,
  admin_email TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  details TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_select_admin" ON audit_logs;
DROP POLICY IF EXISTS "audit_insert_all" ON audit_logs;

CREATE POLICY "audit_select_admin" ON audit_logs FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.auth_id = auth.uid() AND p.role IN ('creator','admin','staff'))
);
CREATE POLICY "audit_insert_all" ON audit_logs FOR INSERT WITH CHECK (true);

-- STEP 4: LISTING REPORTS TABLE
CREATE TABLE IF NOT EXISTS listing_reports (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  reporter_id TEXT NOT NULL,
  listing_id TEXT,
  reported_user_id TEXT,
  reason TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  resolved_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

ALTER TABLE listing_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reports_select_admin" ON listing_reports;
DROP POLICY IF EXISTS "reports_insert_all" ON listing_reports;
DROP POLICY IF EXISTS "reports_update_admin" ON listing_reports;

CREATE POLICY "reports_select_admin" ON listing_reports FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.auth_id = auth.uid() AND p.role IN ('creator','admin','staff'))
);
CREATE POLICY "reports_insert_all" ON listing_reports FOR INSERT WITH CHECK (true);
CREATE POLICY "reports_update_admin" ON listing_reports FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.auth_id = auth.uid() AND p.role IN ('creator','admin','staff'))
);
