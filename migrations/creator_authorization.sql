-- ═══════════════════════════════════════════════════════════
-- Creator Authorization Password System
-- Adds a sudo-like password for critical actions
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Add creator auth fields to platform_settings ──────

-- Check if platform_settings table exists, create if not
CREATE TABLE IF NOT EXISTS platform_settings (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT,
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Creator authorization password hash (bcrypt)
-- NULL means not set yet (first-time setup)
INSERT INTO platform_settings (key, value)
VALUES ('creator_auth_hash', NULL)
ON CONFLICT (key) DO NOTHING;

INSERT INTO platform_settings (key, value)
VALUES ('creator_auth_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

-- ─── 2. RPC Function: Verify Creator Auth Password ────────
-- This runs with SECURITY DEFINER (bypasses RLS) so it can read the hash

CREATE OR REPLACE FUNCTION verify_creator_auth(p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash TEXT;
  v_enabled TEXT;
BEGIN
  -- Check if auth is enabled
  SELECT value INTO v_enabled FROM platform_settings WHERE key = 'creator_auth_enabled';
  
  -- If not enabled, always allow (backwards compatibility)
  IF v_enabled IS NULL OR v_enabled != 'true' THEN
    RETURN TRUE;
  END IF;
  
  -- Get stored hash
  SELECT value INTO v_hash FROM platform_settings WHERE key = 'creator_auth_hash';
  
  -- If hash not set yet, require setup first
  IF v_hash IS NULL OR v_hash = '' THEN
    RETURN FALSE;
  END IF;
  
  -- Use pgcrypto to verify bcrypt password
  -- pgcrypto's crypt() function checks bcrypt hashes
  RETURN v_hash = crypt(p_password, v_hash);
END;
$$;

-- ─── 3. RPC Function: Set Creator Auth Password ───────────

CREATE OR REPLACE FUNCTION set_creator_auth(p_new_password TEXT, p_old_password TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash TEXT;
  v_enabled TEXT;
BEGIN
  -- Check if there's an existing password
  SELECT value INTO v_hash FROM platform_settings WHERE key = 'creator_auth_hash';
  SELECT value INTO v_enabled FROM platform_settings WHERE key = 'creator_auth_enabled';
  
  -- If a password already exists and auth is enabled, verify old password
  IF v_hash IS NOT NULL AND v_hash != '' AND v_enabled = 'true' THEN
    IF p_old_password IS NULL THEN
      RETURN FALSE; -- Old password required
    END IF;
    IF v_hash != crypt(p_old_password, v_hash) THEN
      RETURN FALSE; -- Old password incorrect
    END IF;
  END IF;
  
  -- Validate new password
  IF p_new_password IS NULL OR length(p_new_password) < 6 THEN
    RETURN FALSE;
  END IF;
  
  -- Hash new password with bcrypt
  UPDATE platform_settings 
  SET value = crypt(p_new_password, gen_salt('bf', 10)),
      updated_at = NOW()
  WHERE key = 'creator_auth_hash';
  
  -- Enable auth
  UPDATE platform_settings 
  SET value = 'true',
      updated_at = NOW()
  WHERE key = 'creator_auth_enabled';
  
  RETURN TRUE;
END;
$$;

-- ─── 4. RPC Function: Disable Creator Auth ────────────────

CREATE OR REPLACE FUNCTION disable_creator_auth(p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash TEXT;
BEGIN
  SELECT value INTO v_hash FROM platform_settings WHERE key = 'creator_auth_hash';
  
  -- Verify password
  IF v_hash IS NULL OR v_hash = '' THEN
    RETURN FALSE;
  END IF;
  
  IF v_hash != crypt(p_password, v_hash) THEN
    RETURN FALSE;
  END IF;
  
  -- Disable auth (but keep the hash so it can be re-enabled)
  UPDATE platform_settings 
  SET value = 'false',
      updated_at = NOW()
  WHERE key = 'creator_auth_enabled';
  
  RETURN TRUE;
END;
$$;

-- ─── 5. Check if pgcrypto extension is available ──────────

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'pgcrypto extension creation failed - may need superuser. If verify_creator_auth fails, run: CREATE EXTENSION pgcrypto;';
END;
$$;

-- ─── 6. Add RLS policy for platform_settings ─────────────

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "platform_settings_select_all" ON platform_settings;
DROP POLICY IF EXISTS "platform_settings_insert_creator" ON platform_settings;
DROP POLICY IF EXISTS "platform_settings_update_creator" ON platform_settings;

-- Everyone can read platform settings (needed for maintenance mode, etc.)
CREATE POLICY "platform_settings_select_all" ON platform_settings
  FOR SELECT USING (true);

-- Only creator can insert/update settings via direct queries
-- (RPC functions use SECURITY DEFINER so they bypass this)
CREATE POLICY "platform_settings_insert_creator" ON platform_settings
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE auth_id = auth.uid() 
      AND role = 'creator'
    )
  );

CREATE POLICY "platform_settings_update_creator" ON platform_settings
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE auth_id = auth.uid() 
      AND role = 'creator'
    )
  );
