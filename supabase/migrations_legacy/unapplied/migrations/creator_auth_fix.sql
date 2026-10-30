-- ═══════════════════════════════════════════════════════════
-- Creator Authorization Password System (FIXED)
-- ═══════════════════════════════════════════════════════════

-- 1. Enable pgcrypto (for bcrypt hashing)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Create platform_settings table if not exists
CREATE TABLE IF NOT EXISTS platform_settings (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT,
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Insert default rows (no password set yet)
INSERT INTO platform_settings (key, value) VALUES ('creator_auth_hash', NULL) ON CONFLICT (key) DO NOTHING;
INSERT INTO platform_settings (key, value) VALUES ('creator_auth_enabled', 'false') ON CONFLICT (key) DO NOTHING;

-- 4. Enable RLS
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

-- 5. Drop old policies
DROP POLICY IF EXISTS "platform_settings_select_all" ON platform_settings;
DROP POLICY IF EXISTS "platform_settings_insert_creator" ON platform_settings;
DROP POLICY IF EXISTS "platform_settings_update_creator" ON platform_settings;

-- 6. Create policies (FIXED: cast auth.uid() to text)
CREATE POLICY "platform_settings_select_all" ON platform_settings FOR SELECT USING (true);
CREATE POLICY "platform_settings_insert_creator" ON platform_settings FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE auth_id = (auth.uid())::text AND role = 'creator'));
CREATE POLICY "platform_settings_update_creator" ON platform_settings FOR UPDATE USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = (auth.uid())::text AND role = 'creator'));

-- 7. Create verify function (FIXED: simpler syntax)
CREATE OR REPLACE FUNCTION verify_creator_auth(p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_hash TEXT;
  v_enabled TEXT;
BEGIN
  SELECT value INTO v_enabled FROM platform_settings WHERE key = 'creator_auth_enabled';
  IF v_enabled IS NULL OR v_enabled != 'true' THEN RETURN TRUE; END IF;
  SELECT value INTO v_hash FROM platform_settings WHERE key = 'creator_auth_hash';
  IF v_hash IS NULL OR v_hash = '' THEN RETURN FALSE; END IF;
  RETURN v_hash = crypt(p_password, v_hash);
END;
$$;

-- 8. Create set password function (FIXED: simpler syntax)
CREATE OR REPLACE FUNCTION set_creator_auth(p_new_password TEXT, p_old_password TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_hash TEXT;
  v_enabled TEXT;
BEGIN
  SELECT value INTO v_hash FROM platform_settings WHERE key = 'creator_auth_hash';
  SELECT value INTO v_enabled FROM platform_settings WHERE key = 'creator_auth_enabled';
  IF v_hash IS NOT NULL AND v_hash != '' AND v_enabled = 'true' THEN
    IF p_old_password IS NULL THEN RETURN FALSE; END IF;
    IF v_hash != crypt(p_old_password, v_hash) THEN RETURN FALSE; END IF;
  END IF;
  IF p_new_password IS NULL OR length(p_new_password) < 6 THEN RETURN FALSE; END IF;
  UPDATE platform_settings SET value = crypt(p_new_password, gen_salt('bf', 10)), updated_at = NOW() WHERE key = 'creator_auth_hash';
  UPDATE platform_settings SET value = 'true', updated_at = NOW() WHERE key = 'creator_auth_enabled';
  RETURN TRUE;
END;
$$;

-- 9. Create disable function (FIXED: simpler syntax)
CREATE OR REPLACE FUNCTION disable_creator_auth(p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_hash TEXT;
BEGIN
  SELECT value INTO v_hash FROM platform_settings WHERE key = 'creator_auth_hash';
  IF v_hash IS NULL OR v_hash = '' THEN RETURN FALSE; END IF;
  IF v_hash != crypt(p_password, v_hash) THEN RETURN FALSE; END IF;
  UPDATE platform_settings SET value = 'false', updated_at = NOW() WHERE key = 'creator_auth_enabled';
  RETURN TRUE;
END;
$$;

-- Done
SELECT 'Creator auth installed!' as status;
