-- Keeps the existing signup call working while preventing a new Partner from
-- choosing status, commission or financial values in the browser.

BEGIN;

CREATE OR REPLACE FUNCTION public.normalize_partner_self_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles;
BEGIN
  SELECT * INTO v_profile FROM public.profiles
  WHERE auth_id=auth.uid()::text AND user_id=NEW.profile_id AND role='property_partner';
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Property Partner profile required'; END IF;

  NEW.partner_code := 'WHP-' || upper(substr(md5(NEW.profile_id || clock_timestamp()::text),1,10));
  NEW.status := 'pending_verification';
  NEW.verification_notes := NULL;
  NEW.commission_rate := 0;
  NEW.total_earnings := 0;
  NEW.total_paid_out := 0;
  NEW.properties_count := 0;
  NEW.created_at := COALESCE(NEW.created_at,now());
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_partner_self_insert_trigger ON public.property_partners;
CREATE TRIGGER normalize_partner_self_insert_trigger
BEFORE INSERT ON public.property_partners
FOR EACH ROW EXECUTE FUNCTION public.normalize_partner_self_insert();

DROP POLICY IF EXISTS property_partner_owner_insert ON public.property_partners;
CREATE POLICY property_partner_owner_insert ON public.property_partners
FOR INSERT TO authenticated
WITH CHECK (
  profile_id=(SELECT p.user_id FROM public.profiles p WHERE p.auth_id=auth.uid()::text AND p.role='property_partner' LIMIT 1)
);

COMMIT;
