-- ============================================================================
-- PROPERTY PARTNER WORKFLOW — PHASE 1
-- Date: 2026-08-09
-- Scope:
--   1. Secure Property Partner inspection/listing requests.
--   2. Preserve the Property Partner as canonical listing owner when WeHouse
--      staff converts a request into a listing.
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

COMMIT;
