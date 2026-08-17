-- ROLE + SCOPE (Location-Based Permissions)
-- WeHouse Architecture v2

-- 1. Add scope columns to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS assigned_state TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS assigned_lga TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS scope TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS updated_by TEXT DEFAULT NULL;

-- 2. Assign global scope to existing creator
UPDATE profiles SET scope = 'global' WHERE role IN ('creator', 'creator_admin');

-- 3. Set admin/staff default scope to local (will need location assignment)
UPDATE profiles SET scope = 'local' WHERE role IN ('admin', 'staff') AND scope IS NULL;

-- 4. Set user/worker default scope to NULL (no scope needed)
UPDATE profiles SET scope = NULL WHERE role IN ('user', 'worker') AND scope IS NULL;

-- 5. Copy existing state/city to assigned_state/assigned_lga for staff/admin who have location set
UPDATE profiles SET assigned_state = COALESCE(assigned_state, state) WHERE role IN ('admin', 'staff') AND state IS NOT NULL;
UPDATE profiles SET assigned_lga = COALESCE(assigned_lga, city) WHERE role IN ('admin', 'staff') AND city IS NOT NULL;
