-- WeHouse Phase 1: profile projection boundary
-- Direct profile reads are self-only; Creator remains global.
-- Admin/Staff branch reads use scoped projection RPCs so internal auth/KYC fields are not exposed.

DROP POLICY IF EXISTS profiles_read_canonical ON public.profiles;
CREATE POLICY profiles_read_canonical
ON public.profiles
FOR SELECT TO authenticated
USING (
  auth_id = auth.uid()::text
  OR public.current_profile_role() = 'creator'
);

-- Username uniqueness check without exposing another profile row.
CREATE OR REPLACE FUNCTION public.is_username_available(p_username text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL OR NULLIF(btrim(p_username),'') IS NULL THEN false
    ELSE NOT EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE lower(p.username)=lower(btrim(p_username))
        AND p.user_id<>COALESCE(public.current_profile_user_id(),'')
    )
  END;
$$;
REVOKE ALL ON FUNCTION public.is_username_available(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_username_available(text) TO authenticated;
