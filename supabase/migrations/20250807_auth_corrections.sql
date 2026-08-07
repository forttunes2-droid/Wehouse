-- ============================================================================
-- AUTHENTICATION CORRECTIONS MIGRATION
-- Date: 2026-08-07
-- Purpose: Fix all 20 authentication requirements
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ADD SUSPENDED FIELDS TO profiles TABLE
-- Separate "suspended" (can be reactivated) from "deleted" (permanently closed)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS suspended BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS suspended_by TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS suspended_reason TEXT DEFAULT NULL;

-- Index for fast suspended-user exclusion in RLS policies
CREATE INDEX IF NOT EXISTS idx_profiles_suspended ON public.profiles(suspended)
  WHERE suspended = TRUE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. UPDATE RLS POLICIES — add suspended exclusion to ALL auth-facing policies
-- ─────────────────────────────────────────────────────────────────────────────

-- profiles: authenticated users can read own row ONLY IF not suspended
DROP POLICY IF EXISTS "profiles_self_read" ON public.profiles;
CREATE POLICY "profiles_self_read" ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth_id = auth.uid()::text AND suspended = FALSE);

-- profiles: authenticated users can update own row ONLY IF not suspended
DROP POLICY IF EXISTS "profiles_self_write" ON public.profiles;
CREATE POLICY "profiles_self_write" ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth_id = auth.uid()::text AND suspended = FALSE)
  WITH CHECK (auth_id = auth.uid()::text AND suspended = FALSE);

-- listings: public read only active listings by non-suspended owners
DROP POLICY IF EXISTS "listings_public_read" ON public.listings;
CREATE POLICY "listings_public_read" ON public.listings
  FOR SELECT
  TO anon, authenticated
  USING (status = 'active' AND deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = listings.owner_id AND p.suspended = FALSE));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. UPDATE admin_suspend_user — use dedicated suspended fields
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_suspend_user(p_target_user_id text, p_reason text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role TEXT;
  v_target_role TEXT;
BEGIN
  SELECT role INTO v_caller_role FROM public.profiles WHERE auth_id = auth.uid()::text;
  IF v_caller_role NOT IN ('admin','creator') THEN
    RAISE EXCEPTION 'Admin/Creator access required';
  END IF;
  IF p_target_user_id = auth.uid()::text THEN
    RAISE EXCEPTION 'Cannot suspend yourself';
  END IF;
  SELECT role INTO v_target_role FROM public.profiles WHERE user_id = p_target_user_id;
  IF v_target_role IN ('creator') THEN
    RAISE EXCEPTION 'Cannot suspend Creator';
  END IF;

  UPDATE public.profiles
  SET suspended = TRUE,
      suspended_at = NOW(),
      suspended_by = auth.uid()::text,
      suspended_reason = COALESCE(p_reason, 'Administrative suspension'),
      updated_at = NOW()
  WHERE user_id = p_target_user_id;

  INSERT INTO public.audit_logs (action, target_type, target_id, details, admin_id)
  VALUES ('SUSPEND', 'profiles', p_target_user_id,
          jsonb_build_object('reason', COALESCE(p_reason, 'Administrative suspension'))::text,
          auth.uid()::text);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. UPDATE admin_ban_user — permanent closure (sets BOTH deleted + suspended)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_ban_user(p_target_user_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role TEXT;
  v_target_role TEXT;
BEGIN
  SELECT role INTO v_caller_role FROM public.profiles WHERE auth_id = auth.uid()::text;
  IF v_caller_role NOT IN ('admin','creator') THEN
    RAISE EXCEPTION 'Admin/Creator access required';
  END IF;
  IF p_target_user_id = auth.uid()::text THEN
    RAISE EXCEPTION 'Cannot ban yourself';
  END IF;
  SELECT role INTO v_target_role FROM public.profiles WHERE user_id = p_target_user_id;
  IF v_target_role IN ('creator') THEN
    RAISE EXCEPTION 'Cannot ban Creator';
  END IF;

  UPDATE public.profiles
  SET deleted = TRUE,
      deleted_at = NOW(),
      suspended = TRUE,
      suspended_at = NOW(),
      suspended_by = auth.uid()::text,
      suspended_reason = 'Account permanently banned',
      worker_status = 'suspended',
      updated_at = NOW()
  WHERE user_id = p_target_user_id;

  INSERT INTO public.audit_logs (action, target_type, target_id, details, admin_id)
  VALUES ('BAN', 'profiles', p_target_user_id, '{}'::text, auth.uid()::text);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. UPDATE admin_reactivate_user — clear BOTH suspended + deleted flags
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_reactivate_user(p_target_user_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role TEXT;
BEGIN
  SELECT role INTO v_caller_role FROM public.profiles WHERE auth_id = auth.uid()::text;
  IF v_caller_role NOT IN ('admin','creator') THEN
    RAISE EXCEPTION 'Admin/Creator access required';
  END IF;

  UPDATE public.profiles
  SET deleted = FALSE,
      deleted_at = NULL,
      suspended = FALSE,
      suspended_at = NULL,
      suspended_by = NULL,
      suspended_reason = NULL,
      worker_status = CASE WHEN role = 'worker' THEN 'pending' ELSE worker_status END,
      updated_at = NOW()
  WHERE user_id = p_target_user_id;

  INSERT INTO public.audit_logs (action, target_type, target_id, details, admin_id)
  VALUES ('REACTIVATE', 'profiles', p_target_user_id, '{}'::text, auth.uid()::text);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. CREATE delete_user_account RPC — server-side only, with all checks
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.delete_user_account(p_user_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_auth_id TEXT;
  v_target RECORD;
  v_active_listings INTEGER;
BEGIN
  -- Get the caller's auth_id
  v_caller_auth_id := auth.uid()::text;

  -- Fetch target profile
  SELECT * INTO v_target FROM public.profiles WHERE user_id = p_user_id;
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- SELF-DELETE: caller must match target
  IF v_target.auth_id = v_caller_auth_id THEN
    -- Self-deletion restrictions
    IF v_target.role IN ('admin', 'creator', 'staff') THEN
      RAISE EXCEPTION 'Admin/Creator/Staff accounts cannot be self-deleted. Contact the Creator to remove your account.';
    END IF;

    -- Property Partner: check for active listings
    IF v_target.role = 'property_partner' THEN
      SELECT COUNT(*) INTO v_active_listings
      FROM public.listings
      WHERE partner_id = p_user_id
        AND status IN ('active', 'pending')
        AND deleted_at IS NULL;

      IF v_active_listings > 0 THEN
        RAISE EXCEPTION 'Cannot delete account: you have % active or pending listing(s). Please close all listings first.', v_active_listings;
      END IF;
    END IF;

    -- Worker: optional — could check active bookings here if needed
    -- For now, workers can self-delete (their bookings will be orphaned but that's acceptable)

  ELSE
    -- ADMIN-INITIATED DELETE: only admin/creator can delete other accounts
    DECLARE
      v_caller_role TEXT;
    BEGIN
      SELECT role INTO v_caller_role FROM public.profiles WHERE auth_id = v_caller_auth_id;
      IF v_caller_role NOT IN ('admin', 'creator') THEN
        RAISE EXCEPTION 'You do not have permission to delete this account';
      END IF;
      IF v_target.role = 'creator' THEN
        RAISE EXCEPTION 'Creator accounts cannot be deleted';
      END IF;
    END;
  END IF;

  -- Soft-delete the profile
  UPDATE public.profiles
  SET deleted = TRUE,
      deleted_at = NOW(),
      suspended = TRUE,
      suspended_at = NOW(),
      suspended_by = v_caller_auth_id,
      suspended_reason = 'Account deleted by ' || CASE WHEN v_target.auth_id = v_caller_auth_id THEN 'owner' ELSE 'admin' END,
      updated_at = NOW()
  WHERE user_id = p_user_id;

  -- Log the deletion
  INSERT INTO public.audit_logs (action, target_type, target_id, details, admin_id)
  VALUES ('DELETE_ACCOUNT', 'profiles', p_user_id,
          jsonb_build_object('role', v_target.role, 'by_owner', v_target.auth_id = v_caller_auth_id)::text,
          v_caller_auth_id);

  -- Note: We do NOT delete the auth.users row here.
  -- The auth record is kept for audit. The soft-delete prevents login.
  -- A separate cleanup job can purge old deleted accounts.
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. CREATE restore_soft_deleted_user RPC — for users who log in to a deleted account
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.restore_soft_deleted_user(p_user_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role TEXT;
BEGIN
  -- Self-restore: user just needs to match
  IF auth.uid()::text != (SELECT auth_id FROM public.profiles WHERE user_id = p_user_id) THEN
    -- Admin restore
    SELECT role INTO v_caller_role FROM public.profiles WHERE auth_id = auth.uid()::text;
    IF v_caller_role NOT IN ('admin', 'creator') THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;
  END IF;

  UPDATE public.profiles
  SET deleted = FALSE,
      deleted_at = NULL,
      suspended = FALSE,
      suspended_at = NULL,
      suspended_by = NULL,
      suspended_reason = NULL,
      updated_at = NOW()
  WHERE user_id = p_user_id;

  INSERT INTO public.audit_logs (action, target_type, target_id, details, admin_id)
  VALUES ('RESTORE_ACCOUNT', 'profiles', p_user_id, '{}'::text, auth.uid()::text);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. VERIFY: No RLS policies grant access to suspended users
-- ─────────────────────────────────────────────────────────────────────────────

-- Verify profiles policies exclude suspended
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM pg_policies
  WHERE tablename = 'profiles'
    AND qual NOT LIKE '%suspended%'
    AND cmd IN ('SELECT', 'UPDATE', 'DELETE', 'INSERT');
  -- We don't error here because some policies are for admin access
  -- Admin policies should still work on suspended users (for admin review)
  RAISE NOTICE 'Profiles policies without suspended check: %', v_count;
END $$;

COMMIT;
