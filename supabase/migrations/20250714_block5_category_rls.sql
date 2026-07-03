-- BLOCK 5: Service category RLS policies
-- Allows staff/admin/creator to manage categories

DROP POLICY IF EXISTS "service_categories_staff_manage" ON service_categories;
CREATE POLICY "service_categories_staff_manage" ON service_categories
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin')));

DROP POLICY IF EXISTS "service_subcategories_staff_manage" ON service_subcategories;
CREATE POLICY "service_subcategories_staff_manage" ON service_subcategories
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin')));
