-- ============================================================================
-- PROPERTY PARTNER WORKFLOW — PHASE 1
-- Date: 2026-08-09
-- Scope:
--   1. Secure Property Partner inspection/listing requests.
--   2. Preserve the Property Partner as canonical listing owner when WeHouse
--      staff converts a request into a listing.
--   3. Repair the live post_property_from_inspection RPC so it matches the
--      actual live listings/inspection_requests schema.
--
-- This migration intentionally does NOT implement partner earnings,
-- commissions, withdrawals, hotel settlement, or legacy-table cleanup.
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- 1. Property Partner self-service request RPC
-- --------------------------------------------------------------------------
-- The caller identity is derived from auth.uid(). The browser cannot choose
-- owner_id or submit a request for another Property Partner.

CREATE OR REPLACE FUNCTION public.create_my_property_inspection_request(
  p_property_address TEXT,
  p_property_city TEXT,
  p_property_state TEXT,
  p_property_type TEXT,
  p_bedrooms INTEGER DEFAULT NULL,
  p_bathrooms INTEGER DEFAULT NULL,
  p_expected_rent NUMERIC DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_owner_phone TEXT DEFAULT NULL,
  p_photo_urls TEXT[] DEFAULT ARRAY[]::TEXT[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile RECORD;
  v_request_id UUID;
  v_request_code TEXT;
BEGIN
  SELECT
    user_id,
    email,
    phone,
    role,
    deleted,
    suspended,
    banned
  INTO v_profile
  FROM public.profiles
  WHERE auth_id = auth.uid()::TEXT
  LIMIT 1;

  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF v_profile.role <> 'property_partner' THEN
    RAISE EXCEPTION 'Property Partner account required';
  END IF;

  IF COALESCE(v_profile.deleted, FALSE)
     OR COALESCE(v_profile.suspended, FALSE)
     OR COALESCE(v_profile.banned, FALSE) THEN
    RAISE EXCEPTION 'Account is not active';
  END IF;

  IF NULLIF(BTRIM(p_property_address), '') IS NULL THEN
    RAISE EXCEPTION 'Property address is required';
  END IF;

  IF NULLIF(BTRIM(p_property_city), '') IS NULL THEN
    RAISE EXCEPTION 'Property city/LGA is required';
  END IF;

  IF NULLIF(BTRIM(p_property_state), '') IS NULL THEN
    RAISE EXCEPTION 'Property state is required';
  END IF;

  IF NULLIF(BTRIM(p_property_type), '') IS NULL THEN
    RAISE EXCEPTION 'Property type is required';
  END IF;

  IF p_bedrooms IS NOT NULL AND p_bedrooms < 0 THEN
    RAISE EXCEPTION 'Bedrooms cannot be negative';
  END IF;

  IF p_bathrooms IS NOT NULL AND p_bathrooms < 0 THEN
    RAISE EXCEPTION 'Bathrooms cannot be negative';
  END IF;

  IF p_expected_rent IS NOT NULL AND p_expected_rent < 0 THEN
    RAISE EXCEPTION 'Expected rent cannot be negative';
  END IF;

  v_request_code := 'WHIR-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 10));

  INSERT INTO public.inspection_requests (
    request_code,
    owner_id,
    owner_email,
    owner_phone,
    property_address,
    property_city,
    property_state,
    property_type,
    bedrooms,
    bathrooms,
    expected_rent,
    description,
    photo_urls,
    status,
    created_at,
    updated_at
  ) VALUES (
    v_request_code,
    v_profile.user_id,
    v_profile.email,
    COALESCE(NULLIF(BTRIM(p_owner_phone), ''), v_profile.phone),
    BTRIM(p_property_address),
    BTRIM(p_property_city),
    BTRIM(p_property_state),
    BTRIM(p_property_type),
    p_bedrooms,
    p_bathrooms,
    p_expected_rent,
    NULLIF(BTRIM(p_description), ''),
    COALESCE(p_photo_urls, ARRAY[]::TEXT[]),
    'pending',
    NOW(),
    NOW()
  )
  RETURNING id INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_my_property_inspection_request(
  TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, NUMERIC, TEXT, TEXT, TEXT[]
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_my_property_inspection_request(
  TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, NUMERIC, TEXT, TEXT, TEXT[]
) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_my_property_inspection_request(
  TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, NUMERIC, TEXT, TEXT, TEXT[]
) TO authenticated;

-- --------------------------------------------------------------------------
-- 2. Canonical Property Partner ownership on listings
-- --------------------------------------------------------------------------
-- Existing staff code sends inspection.owner_id in listings.partner_id.
-- When partner_id is present and belongs to a Property Partner, it is the
-- authoritative owner identity. This prevents the logged-in staff member or
-- their Supabase auth UUID from becoming the property owner.

CREATE OR REPLACE FUNCTION public.enforce_property_partner_listing_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_partner_role TEXT;
BEGIN
  IF NEW.partner_id IS NOT NULL AND BTRIM(NEW.partner_id) <> '' THEN
    SELECT role
    INTO v_partner_role
    FROM public.profiles
    WHERE user_id = NEW.partner_id
    LIMIT 1;

    IF v_partner_role IS NULL THEN
      RAISE EXCEPTION 'Assigned Property Partner profile was not found';
    END IF;

    IF v_partner_role <> 'property_partner' THEN
      RAISE EXCEPTION 'Assigned listing partner must have property_partner role';
    END IF;

    NEW.owner_id := NEW.partner_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_property_partner_listing_owner_trigger
ON public.listings;

CREATE TRIGGER enforce_property_partner_listing_owner_trigger
BEFORE INSERT OR UPDATE OF owner_id, partner_id
ON public.listings
FOR EACH ROW
EXECUTE FUNCTION public.enforce_property_partner_listing_owner();

REVOKE ALL ON FUNCTION public.enforce_property_partner_listing_owner()
FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- 3. Repair and harden post_property_from_inspection
-- --------------------------------------------------------------------------
-- The live function previously:
--   * trusted browser-supplied owner_id;
--   * referenced non-existent listings columns (sub_type, contact_phone);
--   * updated non-existent inspection_requests columns
--     (listing_created, listing_id).
--
-- This replacement derives the partner owner from inspection_requests and
-- writes only columns confirmed in the live schema.

CREATE OR REPLACE FUNCTION public.post_property_from_inspection(p_data JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller RECORD;
  v_inspection RECORD;
  v_partner RECORD;
  v_listing_id UUID;
  v_listing_code TEXT;
  v_inspection_id UUID;
  v_images TEXT[];
  v_videos TEXT[];
BEGIN
  SELECT user_id, role, deleted, suspended, banned
  INTO v_caller
  FROM public.profiles
  WHERE auth_id = auth.uid()::TEXT
  LIMIT 1;

  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF v_caller.role NOT IN ('staff', 'admin', 'creator') THEN
    RAISE EXCEPTION 'WeHouse staff access required';
  END IF;

  IF COALESCE(v_caller.deleted, FALSE)
     OR COALESCE(v_caller.suspended, FALSE)
     OR COALESCE(v_caller.banned, FALSE) THEN
    RAISE EXCEPTION 'Account is not active';
  END IF;

  IF NULLIF(p_data->>'inspection_id', '') IS NULL THEN
    RAISE EXCEPTION 'inspection_id is required';
  END IF;

  v_inspection_id := (p_data->>'inspection_id')::UUID;

  SELECT *
  INTO v_inspection
  FROM public.inspection_requests
  WHERE id = v_inspection_id
  FOR UPDATE;

  IF v_inspection IS NULL THEN
    RAISE EXCEPTION 'Inspection request not found';
  END IF;

  IF v_inspection.status NOT IN ('completed', 'approved') THEN
    RAISE EXCEPTION 'Inspection must be completed or approved before listing creation';
  END IF;

  IF v_caller.role = 'staff'
     AND COALESCE(v_inspection.assigned_to, '') <> v_caller.user_id
     AND COALESCE(v_inspection.field_officer_id, '') <> v_caller.user_id
     AND COALESCE(v_inspection.assigned_field_officer_id, '') <> v_caller.user_id THEN
    RAISE EXCEPTION 'This inspection is not assigned to the current staff member';
  END IF;

  SELECT user_id, role, deleted, suspended, banned
  INTO v_partner
  FROM public.profiles
  WHERE user_id = v_inspection.owner_id
  LIMIT 1;

  IF v_partner IS NULL OR v_partner.role <> 'property_partner' THEN
    RAISE EXCEPTION 'Inspection owner is not a valid Property Partner';
  END IF;

  IF COALESCE(v_partner.deleted, FALSE)
     OR COALESCE(v_partner.suspended, FALSE)
     OR COALESCE(v_partner.banned, FALSE) THEN
    RAISE EXCEPTION 'Property Partner account is not active';
  END IF;

  IF v_inspection.draft_listing_id IS NOT NULL THEN
    RAISE EXCEPTION 'A listing has already been created from this inspection';
  END IF;

  IF NULLIF(BTRIM(p_data->>'title'), '') IS NULL THEN
    RAISE EXCEPTION 'Listing title is required';
  END IF;

  IF COALESCE((p_data->>'price')::NUMERIC, 0) <= 0 THEN
    RAISE EXCEPTION 'A valid listing price is required';
  END IF;

  v_listing_code := 'WHL-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 12));

  SELECT COALESCE(array_agg(value), ARRAY[]::TEXT[])
  INTO v_images
  FROM jsonb_array_elements_text(COALESCE(p_data->'images', '[]'::JSONB));

  SELECT COALESCE(array_agg(value), ARRAY[]::TEXT[])
  INTO v_videos
  FROM jsonb_array_elements_text(COALESCE(p_data->'videos', '[]'::JSONB));

  INSERT INTO public.listings (
    listing_id,
    title,
    description,
    price,
    currency,
    state,
    city,
    address,
    images,
    videos,
    bedrooms,
    bathrooms,
    property_type,
    availability_status,
    owner_id,
    partner_id,
    chat_agent_id,
    status,
    submitted_by_role,
    reservation_fee_paid,
    chat_unlocked,
    created_at,
    updated_at
  ) VALUES (
    v_listing_code,
    BTRIM(p_data->>'title'),
    NULLIF(BTRIM(p_data->>'description'), ''),
    (p_data->>'price')::NUMERIC,
    'NGN',
    COALESCE(NULLIF(BTRIM(p_data->>'state'), ''), v_inspection.property_state),
    COALESCE(NULLIF(BTRIM(p_data->>'city'), ''), v_inspection.property_city),
    COALESCE(NULLIF(BTRIM(p_data->>'address'), ''), v_inspection.property_address),
    v_images,
    v_videos,
    COALESCE((p_data->>'bedrooms')::INTEGER, v_inspection.bedrooms, 1),
    COALESCE((p_data->>'bathrooms')::INTEGER, v_inspection.bathrooms, 1),
    COALESCE(NULLIF(BTRIM(p_data->>'property_type'), ''), v_inspection.property_type, 'apartment'),
    'available',
    v_partner.user_id,
    v_partner.user_id,
    v_caller.user_id,
    'pending_approval',
    v_caller.role,
    FALSE,
    FALSE,
    NOW(),
    NOW()
  )
  RETURNING id INTO v_listing_id;

  UPDATE public.inspection_requests
  SET draft_listing_id = v_listing_id,
      updated_at = NOW()
  WHERE id = v_inspection_id;

  RETURN v_listing_id;
END;
$$;

REVOKE ALL ON FUNCTION public.post_property_from_inspection(JSONB)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_property_from_inspection(JSONB)
TO authenticated;

COMMIT;
