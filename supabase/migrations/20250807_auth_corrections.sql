-- ============================================================================
-- AUTHENTICATION CORRECTIONS MIGRATION
-- Date: 2026-08-07
-- Purpose: Fix all authentication requirements with proper separation of
--          suspended / banned / deleted states and LGA-scoped admin actions
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ADD SUSPENDED + BANNED FIELDS TO profiles TABLE
-- Separate states:
--   suspended = temporary admin action (can be reactivated)
--   banned    = permanent admin action (cannot be reactivated)
--   deleted   = self-deleted or admin-deleted (permanent closure)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS suspended BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS suspended_by TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS suspended_reason TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS banned BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS banned_by TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS banned_reason TEXT DEFAULT NULL;

-- Index for fast suspended-user exclusion in RLS policies
CREATE INDEX IF NOT EXISTS idx_profiles_suspended ON public.profiles(suspended)
  WHERE suspended = TRUE;

CREATE INDEX IF NOT EXISTS idx_profiles_banned ON public.profiles(banned)
  WHERE banned = TRUE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. UPDATE RLS POLICIES — exclude suspended AND banned users
-- ─────────────────────────────────────────────────────────────────────────────

-- profiles: authenticated users can read own row ONLY IF not suspended/banned
DROP POLICY IF EXISTS "profiles_self_read" ON public.profiles;
CREATE POLICY "profiles_self_read" ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth_id = auth.uid()::text AND suspended = FALSE AND banned = FALSE);

-- profiles: authenticated users can update own row ONLY IF not suspended/banned
DROP POLICY IF EXISTS "profiles_self_write" ON public.profiles;
CREATE POLICY "profiles_self_write" ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth_id = auth.uid()::text AND suspended = FALSE AND banned = FALSE)
  WITH CHECK (auth_id = auth.uid()::text AND suspended = FALSE AND banned = FALSE);

-- listings: public read only active listings by non-suspended/non-banned owners
DROP POLICY IF EXISTS "listings_public_read" ON public.listings;
CREATE POLICY "listings_public_read" ON public.listings
  FOR SELECT
  TO anon, authenticated
  USING (status = 'active' AND deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = listings.owner_id AND p.suspended = FALSE AND p.banned = FALSE));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. HELPER: Validate admin LGA scope
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._assert_admin_lga_scope(target_user_id TEXT)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role TEXT;
  v_caller_lga TEXT;
  v_target_lga TEXT;
  v_target_city TEXT;
  v_target_area TEXT;
BEGIN
  -- Get caller role
  SELECT role, assigned_lga INTO v_caller_role, v_caller_lga
  FROM public.profiles WHERE auth_id = auth.uid()::text;

  -- Creator is exempt from LGA scope
  IF v_caller_role = 'creator' THEN
    RETURN;
  END IF;

  -- Admin must have LGA scope
  IF v_caller_role = 'admin' AND v_caller_lga IS NOT NULL THEN
    -- Get target's location fields
    SELECT assigned_lga, city, area
    INTO v_target_lga, v_target_city, v_target_area
    FROM public.profiles WHERE user_id = target_user_id;

    -- Target must match caller's LGA via assigned_lga, city, or area
    IF COALESCE(v_target_lga, '') != v_caller_lga
       AND COALESCE(v_target_city, '') != v_caller_lga
       AND COALESCE(v_target_area, '') != v_caller_lga THEN
      RAISE EXCEPTION 'Admin scope violation: target is outside your assigned LGA (%)', v_caller_lga;
    END IF;
  END IF;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. UPDATE admin_suspend_user — temporary suspension with LGA scope
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_suspend_user(target_user_id TEXT, p_reason TEXT DEFAULT NULL)
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
  IF target_user_id = auth.uid()::text THEN
    RAISE EXCEPTION 'Cannot suspend yourself';
  END IF;

  -- LGA scope check
  PERFORM public._assert_admin_lga_scope(target_user_id);

  SELECT role INTO v_target_role FROM public.profiles WHERE user_id = target_user_id;
  IF v_target_role IN ('creator') THEN
    RAISE EXCEPTION 'Cannot suspend Creator';
  END IF;

  UPDATE public.profiles
  SET suspended = TRUE,
      suspended_at = NOW(),
      suspended_by = auth.uid()::text,
      suspended_reason = COALESCE(p_reason, 'Administrative suspension'),
      updated_at = NOW()
  WHERE user_id = target_user_id;

  INSERT INTO public.audit_logs (action, target_type, target_id, details, admin_id)
  VALUES ('SUSPEND', 'profiles', target_user_id,
          jsonb_build_object('reason', COALESCE(p_reason, 'Administrative suspension'))::text,
          auth.uid()::text);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. UPDATE admin_ban_user — PERMANENT ban (uses banned fields, NOT suspended)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_ban_user(target_user_id TEXT, p_reason TEXT DEFAULT NULL)
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
  IF target_user_id = auth.uid()::text THEN
    RAISE EXCEPTION 'Cannot ban yourself';
  END IF;

  -- LGA scope check
  PERFORM public._assert_admin_lga_scope(target_user_id);

  SELECT role INTO v_target_role FROM public.profiles WHERE user_id = target_user_id;
  IF v_target_role IN ('creator') THEN
    RAISE EXCEPTION 'Cannot ban Creator';
  END IF;

  -- Ban is PERMANENT: set banned = TRUE and deleted = TRUE
  -- Do NOT set suspended = TRUE (suspended is for temporary actions only)
  UPDATE public.profiles
  SET banned = TRUE,
      banned_at = NOW(),
      banned_by = auth.uid()::text,
      banned_reason = COALESCE(p_reason, 'Account permanently banned'),
      deleted = TRUE,
      deleted_at = NOW(),
      worker_status = CASE WHEN role = 'worker' THEN 'suspended' ELSE worker_status END,
      updated_at = NOW()
  WHERE user_id = target_user_id;

  INSERT INTO public.audit_logs (action, target_type, target_id, details, admin_id)
  VALUES ('BAN', 'profiles', target_user_id,
          jsonb_build_object('reason', COALESCE(p_reason, 'Account permanently banned'))::text,
          auth.uid()::text);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. UPDATE admin_reactivate_user — ONLY for suspended accounts (NOT deleted)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_reactivate_user(target_user_id TEXT)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role TEXT;
  v_target RECORD;
BEGIN
  SELECT role INTO v_caller_role FROM public.profiles WHERE auth_id = auth.uid()::text;
  IF v_caller_role NOT IN ('admin','creator') THEN
    RAISE EXCEPTION 'Admin/Creator access required';
  END IF;

  -- LGA scope check
  PERFORM public._assert_admin_lga_scope(target_user_id);

  SELECT * INTO v_target FROM public.profiles WHERE user_id = target_user_id;
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- Cannot reactivate deleted accounts — they are PERMANENT
  IF v_target.deleted THEN
    RAISE EXCEPTION 'Deleted accounts cannot be reactivated. They are permanently closed.';
  END IF;

  -- Only reactivate suspended accounts
  IF NOT v_target.suspended AND NOT v_target.banned THEN
    RAISE EXCEPTION 'Account is not suspended or banned. No action needed.';
  END IF;

  UPDATE public.profiles
  SET suspended = FALSE,
      suspended_at = NULL,
      suspended_by = NULL,
      suspended_reason = NULL,
      banned = FALSE,
      banned_at = NULL,
      banned_by = NULL,
      banned_reason = NULL,
      worker_status = CASE WHEN role = 'worker' THEN 'pending' ELSE worker_status END,
      updated_at = NOW()
  WHERE user_id = target_user_id;

  INSERT INTO public.audit_logs (action, target_type, target_id, details, admin_id)
  VALUES ('REACTIVATE', 'profiles', target_user_id, '{}'::text, auth.uid()::text);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. UPDATE delete_user_account — server-side only, with all checks
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.delete_user_account(p_user_id TEXT)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_auth_id TEXT;
  v_target RECORD;
  v_listing_count INTEGER;
  v_unresolved_bookings INTEGER;
  v_active_escrow INTEGER;
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
    -- Self-deletion restrictions: Admin/Creator/Staff cannot self-delete
    IF v_target.role IN ('admin', 'creator', 'staff') THEN
      RAISE EXCEPTION 'Admin/Creator/Staff accounts cannot be self-deleted. Contact the Creator to remove your account.';
    END IF;

    -- Property Partner: check if they have EVER listed a property
    IF v_target.role = 'property_partner' THEN
      SELECT COUNT(*) INTO v_listing_count
      FROM public.listings
      WHERE partner_id = p_user_id;

      IF v_listing_count > 0 THEN
        RAISE EXCEPTION 'Cannot delete account: you have previously listed properties. Contact support to close your partner account.';
      END IF;
    END IF;

    -- Worker: check for unresolved bookings, open payments, or escrow
    IF v_target.role = 'worker' THEN
      -- Check for bookings that are NOT in terminal states
      SELECT COUNT(*) INTO v_unresolved_bookings
      FROM public.worker_bookings
      WHERE worker_id = p_user_id
        AND status NOT IN ('cancelled', 'refunded', 'approved_released');

      IF v_unresolved_bookings > 0 THEN
        RAISE EXCEPTION 'Cannot delete account: you have % unresolved booking(s). Complete or cancel all jobs first.', v_unresolved_bookings;
      END IF;

      -- Check for active escrow (funds held in escrow for this worker)
      SELECT COUNT(*) INTO v_active_escrow
      FROM public.escrow_transactions et
      JOIN public.worker_bookings wb ON et.booking_id = wb.id
      WHERE wb.worker_id = p_user_id
        AND et.status NOT IN ('released', 'refunded', 'cancelled');

      IF v_active_escrow > 0 THEN
        RAISE EXCEPTION 'Cannot delete account: you have % active escrow transaction(s). Resolve all payments first.', v_active_escrow;
      END IF;
    END IF;

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

      -- LGA scope check for admin
      PERFORM public._assert_admin_lga_scope(p_user_id);
    END;
  END IF;

  -- Soft-delete the profile
  -- NOTE: deleted and suspended are SEPARATE concepts.
  -- A deleted account is NOT automatically suspended.
  UPDATE public.profiles
  SET deleted = TRUE,
      deleted_at = NOW(),
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
-- 8. DROP restore_soft_deleted_user — deleted accounts are PERMANENT
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.restore_soft_deleted_user(TEXT);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. GRANT EXECUTE on all SECURITY DEFINER functions to authenticated users
-- ─────────────────────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.admin_suspend_user(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ban_user(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reactivate_user(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user_account(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public._assert_admin_lga_scope(TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. VERIFY: No RLS policies grant access to suspended/banned users
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM pg_policies
  WHERE tablename = 'profiles'
    AND qual NOT LIKE '%suspended%'
    AND qual NOT LIKE '%banned%'
    AND cmd IN ('SELECT', 'UPDATE', 'DELETE', 'INSERT');
  RAISE NOTICE 'Profiles policies without suspended/banned check: %', v_count;
END $$;

COMMIT;
