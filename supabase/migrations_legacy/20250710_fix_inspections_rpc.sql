-- ═══════════════════════════════════════════════════════════════
-- RPC: Inspection requests (bypass RLS for admin/staff)
-- ═══════════════════════════════════════════════════════════════

-- 1. Get partner inspection requests (property submissions)
CREATE OR REPLACE FUNCTION public.admin_get_partner_inspections()
RETURNS TABLE(
  id UUID,
  request_code TEXT,
  owner_id TEXT,
  owner_email TEXT,
  owner_phone TEXT,
  property_address TEXT,
  property_city TEXT,
  property_state TEXT,
  property_type TEXT,
  bedrooms INTEGER,
  bathrooms INTEGER,
  expected_rent DECIMAL,
  description TEXT,
  status TEXT,
  assigned_to TEXT,
  field_officer_id TEXT,
  scheduled_date DATE,
  rejection_reason TEXT,
  notes TEXT,
  photo_urls TEXT[],
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  username TEXT,
  full_name TEXT,
  phone TEXT
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 
    ir.id, ir.request_code, ir.owner_id, ir.owner_email, ir.owner_phone,
    ir.property_address, ir.property_city, ir.property_state, ir.property_type,
    ir.bedrooms, ir.bathrooms, ir.expected_rent, ir.description,
    ir.status, ir.assigned_to, ir.field_officer_id, ir.scheduled_date,
    ir.rejection_reason, ir.notes, ir.photo_urls,
    ir.created_at, ir.updated_at,
    p.username, p.full_name, p.phone
  FROM public.inspection_requests ir
  LEFT JOIN public.profiles p ON p.user_id = ir.owner_id
  WHERE ir.status IN ('pending', 'scheduled', 'in_progress')
  ORDER BY ir.created_at DESC;
$$;

-- 2. Get user inspection requests (after reservation)
CREATE OR REPLACE FUNCTION public.admin_get_user_inspections()
RETURNS SETOF public.user_inspection_requests
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT * FROM public.user_inspection_requests 
  WHERE status IN ('pending', 'scheduled', 'in_progress')
  ORDER BY created_at DESC;
$$;

-- 3. Get field officers list
CREATE OR REPLACE FUNCTION public.admin_get_field_officers()
RETURNS TABLE(user_id TEXT, username TEXT, full_name TEXT, phone TEXT)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT p.user_id, p.username, p.full_name, p.phone 
  FROM public.profiles p
  WHERE p.role IN ('staff', 'admin', 'field_officer', 'creator')
    AND p.deleted = false
  ORDER BY p.username;
$$;
