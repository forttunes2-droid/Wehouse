-- ═══════════════════════════════════════════════════════════════
-- CREATE ALL MISSING TABLES + FIX RLS POLICIES
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

-- Only Houses, Apartments, Hotels — Workers and Roommates are SEPARATE tabs in Explore
INSERT INTO property_types (id, name, icon, sort_order, is_active) VALUES
  (1, 'Houses', 'house', 1, true),
  (2, 'Apartments', 'apartment', 2, true),
  (3, 'Hotels', 'hotel', 3, true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE property_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "property_types_all_access" ON property_types;
CREATE POLICY "property_types_all_access" ON property_types FOR ALL USING (true);

-- ═══ 2. service_categories ═══
CREATE TABLE IF NOT EXISTS service_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE service_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_categories_all_access" ON service_categories;
CREATE POLICY "service_categories_all_access" ON service_categories FOR ALL USING (true);

-- ═══ 3. service_subcategories ═══
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
DROP POLICY IF EXISTS "service_subcategories_all_access" ON service_subcategories;
CREATE POLICY "service_subcategories_all_access" ON service_subcategories FOR ALL USING (true);

-- ═══ 4. staff_permissions ═══
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
DROP POLICY IF EXISTS "staff_permissions_all_access" ON staff_permissions;
CREATE POLICY "staff_permissions_all_access" ON staff_permissions FOR ALL USING (true);

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
DROP POLICY IF EXISTS "worker_reviews_all_access" ON worker_verification_reviews;
CREATE POLICY "worker_reviews_all_access" ON worker_verification_reviews FOR ALL USING (true);

-- ═══ 6. platform_settings ═══
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "platform_settings_creator" ON platform_settings;
DROP POLICY IF EXISTS "settings_select_all" ON platform_settings;
DROP POLICY IF EXISTS "settings_update_admin" ON platform_settings;
DROP POLICY IF EXISTS "settings_all_access" ON platform_settings;
CREATE POLICY "settings_all_access" ON platform_settings FOR ALL USING (true);
