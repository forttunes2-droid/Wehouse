BEGIN;

-- Property Partner is a valid public signup role, but financial/verification
-- metadata is server-managed. A browser must not choose its own status,
-- commission or earnings values.
DROP POLICY IF EXISTS property_partners_owner_insert_canonical ON public.property_partners;
DROP POLICY IF EXISTS property_partners_admin_update_canonical ON public.property_partners;

CREATE OR REPLACE FUNCTION public.get_or_create_my_property_partner()
RETURNS public.property_partners
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_profile public.profiles;
  v_partner public.property_partners;
  v_code text;
BEGIN
  SELECT * INTO v_profile
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND role='property_partner'
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;

  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Active Property Partner account required';
  END IF;

  SELECT * INTO v_partner
  FROM public.property_partners
  WHERE profile_id=v_profile.user_id
  LIMIT 1;

  IF v_partner IS NOT NULL THEN
    RETURN v_partner;
  END IF;

  v_code := 'WHP-' || replace(v_profile.user_id,'WHU-','') || '-' || upper(substr(md5(v_profile.user_id || clock_timestamp()::text),1,4));

  INSERT INTO public.property_partners(
    profile_id,partner_code,status,commission_rate,total_earnings,total_paid_out,properties_count,created_at,updated_at
  ) VALUES(
    v_profile.user_id,v_code,'pending_verification',0,0,0,0,now(),now()
  )
  ON CONFLICT (profile_id) DO UPDATE SET updated_at=public.property_partners.updated_at
  RETURNING * INTO v_partner;

  RETURN v_partner;
END;
$$;

REVOKE ALL ON FUNCTION public.get_or_create_my_property_partner() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_my_property_partner() TO authenticated;

-- Direct metadata changes are Creator-only. Branch verification/management
-- should use narrow RPCs instead of granting broad table UPDATE to Admin.
CREATE POLICY property_partners_creator_update_canonical
ON public.property_partners
FOR UPDATE TO authenticated
USING (public.current_profile_role()='creator')
WITH CHECK (public.current_profile_role()='creator');

COMMIT;
