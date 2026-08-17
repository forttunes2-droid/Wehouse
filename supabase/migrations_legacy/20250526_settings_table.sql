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
  EXISTS (SELECT 1 FROM profiles p WHERE p.auth_id = auth.uid()::text AND p.role IN ('creator','admin','staff'))
);

INSERT INTO platform_settings (key, value) VALUES
  ('platform_name', 'WeHouse'),
  ('listing_approval_required', 'false'),
  ('default_user_role', 'user'),
  ('maintenance_mode', 'false'),
  ('registration_open', 'true'),
  ('max_listings_per_user', '5')
ON CONFLICT (key) DO NOTHING;
