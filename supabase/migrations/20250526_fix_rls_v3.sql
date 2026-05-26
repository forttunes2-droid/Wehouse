-- MINIMAL RLS FIX: Cast auth.uid() to text to match column type
-- Only fixes profiles RLS — the core issue

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_all" ON profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
DROP POLICY IF EXISTS "profiles_update_admin" ON profiles;
DROP POLICY IF EXISTS "profiles_delete_admin" ON profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;

CREATE POLICY "profiles_select_all" ON profiles FOR SELECT USING (true);
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE USING (auth.uid()::text = auth_id);
CREATE POLICY "profiles_update_admin" ON profiles FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.auth_id = auth.uid()::text AND p.role IN ('creator','admin','staff'))
);
CREATE POLICY "profiles_delete_admin" ON profiles FOR DELETE USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.auth_id = auth.uid()::text AND p.role IN ('creator','admin','staff'))
);
CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT WITH CHECK (auth.uid()::text = auth_id);
