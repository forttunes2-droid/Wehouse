-- ═══════════════════════════════════════════════════════════════
-- CRITICAL FIX: Field officer inspection visibility
-- 
-- Problem 1: admin_get_field_officers() returns wrong people
-- Problem 2: getInspectionRequestsForFieldOfficer() queries directly
--            (subject to RLS) instead of using RPC
-- 
-- Solution: Create RPC functions that bypass RLS for field officers
-- ═══════════════════════════════════════════════════════════════

-- 1. Fix admin_get_field_officers — ONLY staff with field_officer permission
DROP FUNCTION IF EXISTS public.admin_get_field_officers();

CREATE OR REPLACE FUNCTION public.admin_get_field_officers()
RETURNS TABLE(user_id TEXT, username TEXT, full_name TEXT, phone TEXT)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT p.user_id, p.username, p.full_name, p.phone 
  FROM public.profiles p
  INNER JOIN public.staff_permissions sp ON sp.staff_id = p.user_id
  WHERE p.role = 'staff'
    AND sp.permission = 'field_officer'
    AND sp.is_active = true
    AND p.user_id != 'wehouse_support'
    AND p.deleted = false
  ORDER BY p.username;
$$;

-- 2. NEW: RPC for field officers to get their assigned inspections
-- This bypasses RLS so field officers can always see their assignments
DROP FUNCTION IF EXISTS public.get_my_inspections(TEXT);

CREATE OR REPLACE FUNCTION public.get_my_inspections(p_field_officer_id TEXT)
RETURNS TABLE(
  id UUID,
  inspection_code TEXT,
  status TEXT,
  scheduled_date TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  property_address TEXT,
  property_city TEXT,
  property_state TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  notes TEXT,
  condition TEXT,
  report TEXT,
  _source TEXT,
  listing_title TEXT,
  listing_address TEXT,
  listing_city TEXT,
  listing_state TEXT,
  listing_images TEXT[]
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  -- User inspection requests (field_officer_id column)
  SELECT 
    uir.id,
    uir.inspection_code,
    uir.status,
    uir.scheduled_date,
    uir.completed_at,
    uir.address as property_address,
    uir.city as property_city,
    uir.state as property_state,
    uir.contact_name,
    uir.contact_phone,
    uir.notes,
    uir.condition,
    uir.report,
    'user'::TEXT as _source,
    l.title as listing_title,
    l.address as listing_address,
    l.city as listing_city,
    l.state as listing_state,
    l.images as listing_images
  FROM public.user_inspection_requests uir
  LEFT JOIN public.listings l ON l.id = uir.listing_id
  WHERE uir.field_officer_id = p_field_officer_id
    AND uir.status IN ('pending', 'scheduled', 'in_progress', 'completed')

  UNION ALL

  -- Partner inspection requests (assigned_to column)
  SELECT 
    ir.id,
    ir.request_code as inspection_code,
    ir.status,
    ir.scheduled_date,
    ir.completed_at,
    ir.property_address,
    ir.property_city,
    ir.property_state,
    NULL::TEXT as contact_name,
    ir.owner_phone as contact_phone,
    ir.notes,
    NULL::TEXT as condition,
    NULL::TEXT as report,
    'partner'::TEXT as _source,
    NULL::TEXT as listing_title,
    ir.property_address as listing_address,
    ir.property_city as listing_city,
    ir.property_state as listing_state,
    ir.photo_urls as listing_images
  FROM public.inspection_requests ir
  WHERE ir.assigned_to = p_field_officer_id
    AND ir.status IN ('pending', 'scheduled', 'in_progress', 'completed')

  ORDER BY scheduled_date DESC NULLS LAST, completed_at DESC NULLS LAST;
$$;

-- 3. NEW: RPC for field officers to update inspection status
-- Bypasses RLS so they can start/complete inspections
DROP FUNCTION IF EXISTS public.update_inspection_status(UUID, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.update_inspection_status(
  p_inspection_id UUID,
  p_new_status TEXT,
  p_source TEXT DEFAULT 'user',
  p_report TEXT DEFAULT NULL,
  p_condition TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_table TEXT;
BEGIN
  v_table := CASE 
    WHEN p_source = 'partner' THEN 'inspection_requests'
    ELSE 'user_inspection_requests'
  END;

  IF v_table = 'inspection_requests' THEN
    UPDATE public.inspection_requests SET
      status = p_new_status,
      completed_at = CASE WHEN p_new_status = 'completed' THEN NOW() ELSE completed_at END,
      notes = COALESCE(p_report, notes),
      updated_at = NOW()
    WHERE id = p_inspection_id;
  ELSE
    UPDATE public.user_inspection_requests SET
      status = p_new_status,
      completed_at = CASE WHEN p_new_status = 'completed' THEN NOW() ELSE completed_at END,
      report = COALESCE(p_report, report),
      condition = COALESCE(p_condition, condition),
      updated_at = NOW()
    WHERE id = p_inspection_id;
  END IF;

  RETURN FOUND;
END;
$$;

-- 4. NEW: RPC for field officers to post a property from inspection
-- Bypasses RLS for the insert
DROP FUNCTION IF EXISTS public.post_property_from_inspection(JSONB);

CREATE OR REPLACE FUNCTION public.post_property_from_inspection(p_data JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_listing_id UUID;
BEGIN
  INSERT INTO public.listings (
    listing_id, title, description, price, currency,
    state, city, address, bedrooms, bathrooms,
    property_type, sub_type, images, contact_phone,
    status, submitted_by_role, owner_id, partner_id,
    availability_status, created_at, updated_at
  ) VALUES (
    COALESCE((p_data->>'listing_id')::UUID, gen_random_uuid()),
    p_data->>'title',
    p_data->>'description',
    (p_data->>'price')::INTEGER,
    'NGN',
    p_data->>'state',
    p_data->>'city',
    p_data->>'address',
    COALESCE((p_data->>'bedrooms')::INTEGER, 1),
    COALESCE((p_data->>'bathrooms')::INTEGER, 1),
    'apartment',
    COALESCE(p_data->>'sub_type', 'short_let'),
    ARRAY(SELECT jsonb_array_elements_text(p_data->'images')),
    p_data->>'contact_phone',
    'pending_approval',
    'staff',
    (p_data->>'owner_id')::TEXT,
    NULLIF(p_data->>'partner_id', '')::TEXT,
    'available',
    NOW(),
    NOW()
  )
  RETURNING id INTO v_listing_id;

  RETURN v_listing_id;
END;
$$;
