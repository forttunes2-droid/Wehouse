-- ═══════════════════════════════════════════════════════════════
-- DROP EXISTING POLICIES FIRST (to avoid "already exists" errors)
-- Then create tables and policies cleanly
-- ═══════════════════════════════════════════════════════════════

-- ═══ 1. property_types ═══
CREATE TABLE IF NOT EXISTS property_types (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'house',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO property_types (id, name, icon, sort_order, is_active) VALUES
  (1, 'Houses', 'house', 1, true),
  (2, 'Apartments', 'apartment', 2, true),
  (3, 'Hotels', 'hotel', 3, true)
ON CONFLICT (id) DO NOTHING;

DELETE FROM property_types WHERE name IN ('Workers', 'Roommates');

ALTER TABLE property_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "property_types_select" ON property_types;
DROP POLICY IF EXISTS "property_types_admin" ON property_types;
DROP POLICY IF EXISTS "property_types_all_access" ON property_types;
CREATE POLICY "property_types_all_access" ON property_types FOR ALL USING (true);

-- ═══ 2. staff_permissions ═══
CREATE TABLE IF NOT EXISTS staff_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id TEXT NOT NULL,
  permission TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  granted_at TIMESTAMPTZ DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  UNIQUE(staff_id, permission)
);

CREATE INDEX IF NOT EXISTS idx_staff_permissions_staff ON staff_permissions(staff_id, is_active);
CREATE INDEX IF NOT EXISTS idx_staff_permissions_perm ON staff_permissions(permission, is_active);

ALTER TABLE staff_permissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff_permissions_creator_manage" ON staff_permissions;
DROP POLICY IF EXISTS "staff_permissions_view_own" ON staff_permissions;
DROP POLICY IF EXISTS "staff_permissions_all_access" ON staff_permissions;
CREATE POLICY "staff_permissions_all_access" ON staff_permissions FOR ALL USING (true);

-- ═══ 3. service_categories ═══
CREATE TABLE IF NOT EXISTS service_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE service_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_categories_select" ON service_categories;
DROP POLICY IF EXISTS "service_categories_admin" ON service_categories;
DROP POLICY IF EXISTS "service_categories_all_access" ON service_categories;
CREATE POLICY "service_categories_all_access" ON service_categories FOR ALL USING (true);

-- ═══ 4. service_subcategories ═══
CREATE TABLE IF NOT EXISTS service_subcategories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES service_categories(id),
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE service_subcategories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_subcategories_select" ON service_subcategories;
DROP POLICY IF EXISTS "service_subcategories_admin" ON service_subcategories;
DROP POLICY IF EXISTS "service_subcategories_all_access" ON service_subcategories;
CREATE POLICY "service_subcategories_all_access" ON service_subcategories FOR ALL USING (true);

-- ═══ 5. worker_verification_reviews ═══
CREATE TABLE IF NOT EXISTS worker_verification_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  reviewer_role TEXT NOT NULL,
  action TEXT NOT NULL,
  rejection_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_worker_verification_reviews_worker ON worker_verification_reviews(worker_id);
ALTER TABLE worker_verification_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "worker_reviews_staff" ON worker_verification_reviews;
DROP POLICY IF EXISTS "worker_reviews_all_access" ON worker_verification_reviews;
CREATE POLICY "worker_reviews_all_access" ON worker_verification_reviews FOR ALL USING (true);

-- ═══ 6. platform_settings RLS (open access) ═══
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "platform_settings_creator" ON platform_settings;
DROP POLICY IF EXISTS "settings_select_all" ON platform_settings;
DROP POLICY IF EXISTS "settings_update_admin" ON platform_settings;
DROP POLICY IF EXISTS "settings_all_access" ON platform_settings;
CREATE POLICY "settings_all_access" ON platform_settings FOR ALL USING (true);

-- ═══ 7. RPC functions ═══
CREATE OR REPLACE FUNCTION get_setting_v2(p_key TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_value TEXT;
BEGIN SELECT value INTO v_value FROM platform_settings WHERE key = p_key; RETURN v_value; END;
$$;

CREATE OR REPLACE FUNCTION set_setting_v2(p_key TEXT, p_value TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO platform_settings (key, value, updated_at) VALUES (p_key, p_value, NOW())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION get_setting_v2 TO authenticated, anon;
GRANT EXECUTE ON FUNCTION set_setting_v2 TO authenticated;
