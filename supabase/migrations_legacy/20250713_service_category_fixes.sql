-- ═══════════════════════════════════════════════════════════════
-- FIX: Service Categories — Add missing RLS policies for CRUD
-- ═══════════════════════════════════════════════════════════════

-- 1. Service categories: staff/admin/creator can manage (INSERT/UPDATE/DELETE)
DROP POLICY IF EXISTS "service_categories_staff_manage" ON service_categories;
CREATE POLICY "service_categories_staff_manage" ON service_categories
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin')));

-- 2. Service subcategories: staff/admin/creator can manage (INSERT/UPDATE/DELETE)
DROP POLICY IF EXISTS "service_subcategories_staff_manage" ON service_subcategories;
CREATE POLICY "service_subcategories_staff_manage" ON service_subcategories
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin')));

-- 3. RPC: Delete service category (with cascade to subcategories)
CREATE OR REPLACE FUNCTION public.delete_service_category(p_category_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Delete subcategories first (ON DELETE CASCADE should handle this, but explicit is safer)
  DELETE FROM public.service_subcategories WHERE category_id = p_category_id;
  -- Delete the category
  DELETE FROM public.service_categories WHERE id = p_category_id;
END;
$$;

-- 4. RPC: Delete service subcategory
CREATE OR REPLACE FUNCTION public.delete_service_subcategory(p_subcategory_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.service_subcategories WHERE id = p_subcategory_id;
END;
$$;

-- 5. RPC: Get all categories with subcategories (for admin — bypasses RLS, returns ALL including inactive)
CREATE OR REPLACE FUNCTION public.admin_get_all_categories_with_subs()
RETURNS TABLE(
  id UUID,
  name TEXT,
  icon TEXT,
  sort_order INTEGER,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  subcategories JSONB
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 
    c.id, c.name, c.icon, c.sort_order, c.is_active, c.created_at,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'icon', s.icon,
        'sort_order', s.sort_order,
        'is_active', s.is_active,
        'category_id', s.category_id,
        'created_at', s.created_at
      ) ORDER BY s.sort_order)
      FROM public.service_subcategories s WHERE s.category_id = c.id),
      '[]'::jsonb
    ) as subcategories
  FROM public.service_categories c
  ORDER BY c.sort_order;
$$;
