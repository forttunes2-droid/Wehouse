-- ═══════════════════════════════════════════════════════════════
-- STAGE 3.1 — CRITICAL: SECRET KEY ISOLATION
-- 
-- PROBLEM: paystack_secret_key and openai_api_key stored in
-- platform_settings. get_all_settings_v2() returns ALL keys
-- to ANY authenticated user. Any user can read secrets.
--
-- FIX:
-- 1. Create secrets table with creator-only RLS
-- 2. Migrate existing secret keys from platform_settings
-- 3. get_all_settings_v2: filters out secret keys
-- 4. get_setting_v2: filters out secret keys  
-- 5. get_secret_v2: creator-only RPC for reading secrets
-- ═══════════════════════════════════════════════════════════════

-- ═══ 1. CREATE SECRETS TABLE ═══

CREATE TABLE IF NOT EXISTS secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT
);

-- Enable RLS
ALTER TABLE secrets ENABLE ROW LEVEL SECURITY;

-- Creator-only access (even read)
CREATE POLICY "secrets_creator_only" ON secrets
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role IN ('creator','creator_admin'))
  );

-- ═══ 2. MIGRATE EXISTING SECRET KEYS ═══

INSERT INTO secrets (key, value, description, updated_at)
SELECT key, value, 
  CASE key
    WHEN 'paystack_secret_key' THEN 'Paystack secret key for server-side transfers and webhooks'
    WHEN 'flutterwave_secret_key' THEN 'Flutterwave secret key for server-side transfers'
    WHEN 'openai_api_key' THEN 'OpenAI API key for AI chat agent'
    ELSE 'Migrated secret from platform_settings'
  END,
  NOW()
FROM platform_settings
WHERE key IN ('paystack_secret_key', 'flutterwave_secret_key', 'openai_api_key')
ON CONFLICT (key) DO NOTHING;

-- ═══ 3. HARDEN get_all_settings_v2 — EXCLUDE SECRET KEYS ═══

DROP FUNCTION IF EXISTS get_all_settings_v2();

CREATE OR REPLACE FUNCTION get_all_settings_v2()
RETURNS TABLE (
  id UUID,
  key TEXT,
  value TEXT,
  label TEXT,
  description TEXT,
  category TEXT,
  data_type TEXT,
  is_active BOOLEAN,
  updated_at TIMESTAMPTZ
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT 
    ps.id,
    ps.key,
    ps.value,
    ps.label,
    ps.description,
    ps.category,
    ps.data_type,
    ps.is_active,
    ps.updated_at
  FROM platform_settings ps
  WHERE ps.is_active = true
    AND ps.key NOT LIKE '%secret%'
    AND ps.key NOT LIKE '%api_key%'
    AND ps.key NOT LIKE '%private%'
    AND ps.key NOT LIKE '%password%'
    AND ps.key NOT LIKE '%token%'
  ORDER BY ps.category, ps.key;
$$;

GRANT EXECUTE ON FUNCTION get_all_settings_v2 TO authenticated, anon;

-- ═══ 4. HARDEN get_setting_v2 — EXCLUDE SECRET KEYS ═══

DROP FUNCTION IF EXISTS get_setting_v2(TEXT);

CREATE OR REPLACE FUNCTION get_setting_v2(p_key TEXT)
RETURNS TABLE (
  id UUID,
  key TEXT,
  value TEXT,
  label TEXT,
  description TEXT,
  category TEXT,
  data_type TEXT,
  is_active BOOLEAN,
  updated_at TIMESTAMPTZ
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT 
    ps.id,
    ps.key,
    ps.value,
    ps.label,
    ps.description,
    ps.category,
    ps.data_type,
    ps.is_active,
    ps.updated_at
  FROM platform_settings ps
  WHERE ps.key = p_key
    AND ps.is_active = true
    AND ps.key NOT LIKE '%secret%'
    AND ps.key NOT LIKE '%api_key%'
    AND ps.key NOT LIKE '%private%'
    AND ps.key NOT LIKE '%password%'
    AND ps.key NOT LIKE '%token%'
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_setting_v2 TO authenticated, anon;

-- ═══ 5. CREATOR-ONLY SECRET READ RPC ═══

CREATE OR REPLACE FUNCTION get_secret_v2(p_key TEXT)
RETURNS TABLE (key TEXT, value TEXT) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role TEXT;
BEGIN
  -- Validate caller is creator
  SELECT role INTO v_role FROM profiles WHERE user_id = auth.uid()::text;
  IF v_role NOT IN ('creator', 'creator_admin') THEN
    RAISE EXCEPTION 'Only Creator can read secrets';
  END IF;
  
  RETURN QUERY SELECT s.key, s.value FROM secrets s WHERE s.key = p_key;
END;
$$;

GRANT EXECUTE ON FUNCTION get_secret_v2 TO authenticated;

-- ═══ 6. CREATOR-ONLY SECRET WRITE RPC ═══

CREATE OR REPLACE FUNCTION set_secret_v2(p_key TEXT, p_value TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE user_id = auth.uid()::text;
  IF v_role NOT IN ('creator', 'creator_admin') THEN
    RAISE EXCEPTION 'Only Creator can write secrets';
  END IF;
  
  INSERT INTO secrets (key, value, updated_at, updated_by)
  VALUES (p_key, p_value, NOW(), auth.uid()::text)
  ON CONFLICT (key) DO UPDATE SET 
    value = EXCLUDED.value, 
    updated_at = NOW(),
    updated_by = auth.uid()::text;
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION set_secret_v2 TO authenticated;
