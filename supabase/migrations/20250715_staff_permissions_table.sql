-- ═══════════════════════════════════════════════════════════════
-- CREATE staff_permissions TABLE (it doesn't exist!)
-- ═══════════════════════════════════════════════════════════════

-- 1. Create the table
CREATE TABLE IF NOT EXISTS public.staff_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id TEXT NOT NULL,
  permission TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  granted_at TIMESTAMPTZ DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  UNIQUE(staff_id, permission)
);

-- 2. Create indexes
CREATE INDEX IF NOT EXISTS idx_staff_permissions_staff ON staff_permissions(staff_id, is_active);
CREATE INDEX IF NOT EXISTS idx_staff_permissions_perm ON staff_permissions(permission, is_active);

-- 3. Enable RLS
ALTER TABLE public.staff_permissions ENABLE ROW LEVEL SECURITY;

-- 4. RLS: Creator/Admin can manage all
DROP POLICY IF EXISTS "staff_permissions_creator_manage" ON public.staff_permissions;
CREATE POLICY "staff_permissions_creator_manage" ON public.staff_permissions
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE auth_id = auth.uid()::text AND role IN ('creator','admin','creator_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE auth_id = auth.uid()::text AND role IN ('creator','admin','creator_admin')));

-- 5. RLS: Staff can view their own
DROP POLICY IF EXISTS "staff_permissions_view_own" ON public.staff_permissions;
CREATE POLICY "staff_permissions_view_own" ON public.staff_permissions
  FOR SELECT TO authenticated
  USING (staff_id = auth.uid()::text);
