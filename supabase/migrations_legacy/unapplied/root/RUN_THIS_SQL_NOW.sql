-- ================================================================
-- COPY AND PASTE THIS ENTIRE FILE INTO YOUR SUPABASE SQL EDITOR
-- THEN CLICK "RUN"
-- ================================================================

-- 1. Fix field officer inspections (bypasses RLS)
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

-- 2. Fix field officer status updates (bypasses RLS)
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
  v_table := CASE WHEN p_source = 'partner' THEN 'inspection_requests' ELSE 'user_inspection_requests' END;

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

-- 3. Fix field officer posting properties (bypasses RLS)
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

-- 4. Fix worker profile updates (bypasses RLS)
DROP FUNCTION IF EXISTS public.worker_update_profile(TEXT, JSONB);

CREATE OR REPLACE FUNCTION public.worker_update_profile(
  p_user_id TEXT,
  p_updates JSONB
)
RETURNS SETOF public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.profiles SET
    full_name = COALESCE(p_updates->>'full_name', full_name),
    phone = COALESCE(p_updates->>'phone', phone),
    bio = COALESCE(p_updates->>'bio', bio),
    avatar_url = COALESCE(p_updates->>'avatar_url', avatar_url),
    worker_status = COALESCE(p_updates->>'worker_status', worker_status),
    worker_verified = COALESCE((p_updates->>'worker_verified')::BOOLEAN, worker_verified),
    updated_at = NOW()
  WHERE user_id = p_user_id
  RETURNING *;
END;
$$;

-- 5. Fix roommate matching
DROP FUNCTION IF EXISTS public.find_roommate_matches(TEXT);

CREATE OR REPLACE FUNCTION public.find_roommate_matches(p_user_id TEXT)
RETURNS TABLE(
  user_id TEXT,
  username TEXT,
  full_name TEXT,
  gender TEXT,
  city TEXT,
  state TEXT,
  bio TEXT,
  school_name TEXT,
  campus TEXT,
  match_score INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_prefs RECORD;
  v_budget_min INTEGER;
  v_budget_max INTEGER;
BEGIN
  SELECT * INTO v_prefs FROM public.roommate_preferences WHERE user_id = p_user_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_budget_min := COALESCE(v_prefs.budget_min, 100000);
  v_budget_max := COALESCE(v_prefs.budget_max, 2000000);

  RETURN QUERY
  SELECT 
    p.user_id,
    p.username,
    p.full_name,
    p.gender,
    p.city,
    p.state,
    p.bio,
    rp.school_name,
    rp.campus,
    (
      CASE WHEN p.city = v_prefs.city THEN 30 ELSE 0 END
      + CASE WHEN rp.school_name = v_prefs.school_name AND v_prefs.school_match THEN 15 ELSE 0 END
      + CASE WHEN rp.campus = v_prefs.campus AND v_prefs.campus_match THEN 10 ELSE 0 END
      + CASE WHEN v_prefs.gender_preference = 'no_preference' THEN 5 WHEN p.gender = v_prefs.gender_preference THEN 5 ELSE 0 END
    )::INTEGER AS match_score
  FROM public.profiles p
  INNER JOIN public.roommate_preferences rp ON rp.user_id = p.user_id
  WHERE p.user_id != p_user_id
    AND p.role = 'user'
    AND p.deleted = false
    AND rp.search_status IN ('active', 'stopped')
    AND COALESCE(rp.budget_max, 999999999) >= v_budget_min
    AND COALESCE(rp.budget_min, 0) <= v_budget_max
    AND (v_prefs.gender_preference = 'no_preference' OR p.gender = v_prefs.gender_preference OR p.gender IS NULL)
    AND NOT EXISTS (SELECT 1 FROM public.roommate_search_results rsr WHERE rsr.searcher_id = p_user_id AND rsr.matched_user_id = p.user_id)
  ORDER BY match_score DESC
  LIMIT 20;
END;
$$;

-- 6. Ensure roommate_search_results table exists
CREATE TABLE IF NOT EXISTS public.roommate_search_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  searcher_id TEXT NOT NULL,
  matched_user_id TEXT NOT NULL,
  match_score INTEGER DEFAULT 0,
  status TEXT DEFAULT 'new',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(searcher_id, matched_user_id)
);

-- 7. Fix profiles RLS so workers can update their own profile
DROP POLICY IF EXISTS "profiles_self" ON public.profiles;
CREATE POLICY "profiles_self" ON public.profiles 
FOR ALL TO authenticated 
USING (
  user_id = auth.uid()::text 
  OR auth_id = auth.uid()::text
  OR EXISTS (SELECT 1 FROM profiles AS p WHERE p.auth_id = auth.uid()::text AND p.role IN ('staff','admin','creator'))
);

-- Done! All 7 functions created.
