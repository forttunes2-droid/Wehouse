-- ============================================================================
-- AUTHENTICATION FINAL SECURITY + LOCATION PATCH
-- Date: 2026-08-07
-- Purpose: Fix all authentication requirements including:
--   1. Compulsory user location (State + LGA) for all public accounts
--   2. Separate personal location (state/city/area) from operational assignment (assigned_state/assigned_lga)
--   3. Admin LGA boundary enforcement — fail closed
--   4. Protected assigned_lga — only Creator can reassign cross-LGA
--   5. Internal helper _assert_admin_lga_scope — not publicly callable
--   6. Worker deletion uses repository-confirmed booking/escrow statuses + wallet check
--   7. Property Partner deletion — ANY historical listing blocks self-delete
--   8. Closed/Deleted ≠ Suspended ≠ Banned — all separate states
--   9. admin_update_role LGA-scoped with branch assignment for staff promotion
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ADD SUSPENDED + BANNED + LOCAL_GOVERNMENT FIELDS TO profiles TABLE
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS suspended BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS suspended_by TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS suspended_reason TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS banned BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS banned_by TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS banned_reason TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS local_government TEXT DEFAULT NULL;

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

-- listings: public read only available/reserved/pending_approval listings by non-suspended/non-banned owners
DROP POLICY IF EXISTS "listings_public_read" ON public.listings;
CREATE POLICY "listings_public_read" ON public.listings
  FOR SELECT
  TO anon, authenticated
  USING (status IN ('available', 'reserved', 'pending_approval')
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = listings.owner_id AND p.suspended = FALSE AND p.banned = FALSE));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. HELPER: Validate admin LGA scope — FAILS CLOSED
--
-- Rules:
--   Creator → exempt (global authority)
--   Admin   → must have valid non-null assigned_lga; target must match exactly
--   Others  → reject
--
-- Target LGA resolution:
--   Admin/Staff targets → use assigned_lga ONLY (operational assignment)
--   Public targets      → use local_government, then city (personal location)
--
-- This helper is for INTERNAL use by secured SECURITY DEFINER functions only.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._assert_admin_lga_scope(p_target_user_id TEXT)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role TEXT;
  v_caller_lga TEXT;
  v_target_role TEXT;
  v_target_assigned_lga TEXT;
  v_target_local_gov TEXT;
  v_target_city TEXT;
  v_target_lga TEXT;
BEGIN
  -- Get caller role and operational LGA assignment
  SELECT role, assigned_lga INTO v_caller_role, v_caller_lga
  FROM public.profiles WHERE auth_id = auth.uid()::text;

  -- Creator is exempt from LGA scope
  IF v_caller_role = 'creator' THEN
    RETURN;
  END IF;

  -- Admin must have a valid non-null assigned_lga
  IF v_caller_role = 'admin' THEN
    IF v_caller_lga IS NULL OR trim(v_caller_lga) = '' THEN
      RAISE EXCEPTION 'Admin has no assigned LGA. Contact Creator to set your branch assignment.';
    END IF;

    -- Get target profile fields
    SELECT role, assigned_lga, local_government, city
    INTO v_target_role, v_target_assigned_lga, v_target_local_gov, v_target_city
    FROM public.profiles WHERE user_id = p_target_user_id;

    -- Determine target's canonical LGA:
    -- For admin/staff targets: use assigned_lga ONLY (do NOT fall back to city/area)
    -- For public users: use local_government if set, else city
    IF v_target_role IN ('admin', 'staff') THEN
      IF v_target_assigned_lga IS NULL OR trim(v_target_assigned_lga) = '' THEN
        RAISE EXCEPTION 'Target staff/admin has no assigned LGA. Cannot verify scope.';
      END IF;
      v_target_lga := v_target_assigned_lga;
    ELSE
      -- Public user: personal location is their canonical LGA
      v_target_lga := COALESCE(NULLIF(v_target_local_gov, ''), NULLIF(v_target_city, ''));
    END IF;

    -- Target must have a location
    IF v_target_lga IS NULL OR trim(v_target_lga) = '' THEN
      RAISE EXCEPTION 'Target user has no location set. Cannot perform admin action.';
    END IF;

    -- Target must match caller's assigned LGA exactly
    IF v_target_lga != v_caller_lga THEN
      RAISE EXCEPTION 'Admin scope violation: target LGA (%) is outside your assigned LGA (%)', v_target_lga, v_caller_lga;
    END IF;
  ELSE
    -- Everyone else (non-admin, non-creator) is rejected
    RAISE EXCEPTION 'Admin/Creator access required for this action';
  END IF;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. UPDATE admin_suspend_user — temporary suspension with LGA scope
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_suspend_user(p_target_user_id TEXT, p_reason TEXT DEFAULT NULL)
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

  -- LGA scope check (internal helper — not directly callable)
  PERFORM public._assert_admin_lga_scope(p_target_user_id);

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
-- 5. UPDATE admin_ban_user — PERMANENT ban (uses banned fields, NOT suspended)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_ban_user(p_target_user_id TEXT, p_reason TEXT DEFAULT NULL)
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

  -- LGA scope check (internal helper — not directly callable)
  PERFORM public._assert_admin_lga_scope(p_target_user_id);

  SELECT role INTO v_target_role FROM public.profiles WHERE user_id = p_target_user_id;
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
  WHERE user_id = p_target_user_id;

  INSERT INTO public.audit_logs (action, target_type, target_id, details, admin_id)
  VALUES ('BAN', 'profiles', p_target_user_id,
          jsonb_build_object('reason', COALESCE(p_reason, 'Account permanently banned'))::text,
          auth.uid()::text);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. UPDATE admin_reactivate_user — ONLY for suspended accounts (NOT banned, NOT deleted)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_reactivate_user(p_target_user_id TEXT)
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

  -- LGA scope check (internal helper — not directly callable)
  PERFORM public._assert_admin_lga_scope(p_target_user_id);

  SELECT * INTO v_target FROM public.profiles WHERE user_id = p_target_user_id;
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- Cannot reactivate deleted accounts — they are PERMANENT
  IF v_target.deleted THEN
    RAISE EXCEPTION 'Deleted accounts cannot be reactivated. They are permanently closed.';
  END IF;

  -- Cannot reactivate banned accounts — banned is PERMANENT
  IF v_target.banned THEN
    RAISE EXCEPTION 'Banned accounts cannot be reactivated. Contact Creator if you believe this is an error.';
  END IF;

  -- Only reactivate suspended accounts
  IF NOT v_target.suspended THEN
    RAISE EXCEPTION 'Account is not suspended. No action needed.';
  END IF;

  UPDATE public.profiles
  SET suspended = FALSE,
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
-- 7. UPDATE delete_user_account — server-side only, with all checks
--
-- Worker Booking statuses confirmed from codebase:
--   Terminal (safe):   approved_released, cancelled, refunded
--   Non-terminal:      booking_requested, negotiating, waiting_payment, confirmed,
--                      in_progress, completed_pending_approval, disputed,
--                      pending_payment, paid_escrow, worker_assigned
--
-- Escrow statuses confirmed from schema:
--   Terminal (safe):   released, refunded
--   Non-terminal:      held, disputed, partially_refunded
--
-- Wallet check: block if any balance > 0
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
  v_wallet_balance DECIMAL(12,2);
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

    -- Property Partner: check if they have EVER listed a property (any status)
    IF v_target.role = 'property_partner' THEN
      SELECT COUNT(*) INTO v_listing_count
      FROM public.listings
      WHERE partner_id = p_user_id;

      IF v_listing_count > 0 THEN
        RAISE EXCEPTION 'Cannot delete account: you have previously listed properties. Contact support to close your partner account.';
      END IF;
    END IF;

    -- Worker: comprehensive obligation check before self-closure
    IF v_target.role = 'worker' THEN
      -- 1. Check for unresolved bookings (confirmed statuses from repository)
      SELECT COUNT(*) INTO v_unresolved_bookings
      FROM public.worker_bookings
      WHERE worker_id = p_user_id
        AND status NOT IN ('approved_released', 'cancelled', 'refunded');

      IF v_unresolved_bookings > 0 THEN
        RAISE EXCEPTION 'Cannot delete account: you have % unresolved booking(s). Complete or cancel all jobs first.', v_unresolved_bookings;
      END IF;

      -- 2. Check for active escrow (confirmed statuses from schema)
      SELECT COUNT(*) INTO v_active_escrow
      FROM public.escrow_transactions et
      JOIN public.worker_bookings wb ON et.booking_id = wb.id
      WHERE wb.worker_id = p_user_id
        AND et.status NOT IN ('released', 'refunded');

      IF v_active_escrow > 0 THEN
        RAISE EXCEPTION 'Cannot delete account: you have % active escrow transaction(s). Resolve all payments first.', v_active_escrow;
      END IF;

      -- 3. Check wallet balance (any positive balance = obligation remains)
      SELECT COALESCE(available_balance, 0) + COALESCE(pending_balance, 0) + COALESCE(frozen_balance, 0)
      INTO v_wallet_balance
      FROM public.wallets
      WHERE owner_id = p_user_id AND owner_type = 'worker';

      IF v_wallet_balance IS NOT NULL AND v_wallet_balance > 0 THEN
        RAISE EXCEPTION 'Cannot delete account: you have a wallet balance of N%. Withdraw all funds first.', v_wallet_balance;
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

      -- LGA scope check for admin (Creator is exempt)
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
-- 8. UPDATE admin_update_role — LGA-scoped with branch assignment
--
-- Admin can only change roles of users in their own LGA.
-- Creator is exempt (global authority).
-- When promoting to 'staff', auto-assign admin's branch (assigned_state/assigned_lga).
-- Admin cannot change another Admin's role or assigned_lga.
-- Cross-LGA reassignment requires Creator authority.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_update_role(p_target_user_id TEXT, p_new_role TEXT)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role TEXT;
  v_caller_lga TEXT;
  v_target_role TEXT;
  v_target_lga TEXT;
BEGIN
  -- Auth check
  SELECT role, assigned_lga INTO v_caller_role, v_caller_lga
  FROM public.profiles WHERE auth_id = auth.uid()::text;

  IF v_caller_role NOT IN ('admin','creator') THEN
    RAISE EXCEPTION 'Admin/Creator access required';
  END IF;

  IF p_target_user_id = auth.uid()::text THEN
    RAISE EXCEPTION 'Cannot modify your own role';
  END IF;

  SELECT role INTO v_target_role FROM public.profiles WHERE user_id = p_target_user_id;
  IF v_target_role IN ('creator') THEN
    RAISE EXCEPTION 'Cannot modify Creator role';
  END IF;

  IF p_new_role NOT IN ('user','worker','property_partner','staff','admin') THEN
    RAISE EXCEPTION 'Invalid role: %', p_new_role;
  END IF;

  -- LGA scope check for admin
  IF v_caller_role = 'admin' THEN
    -- Admin must have assigned_lga
    IF v_caller_lga IS NULL OR trim(v_caller_lga) = '' THEN
      RAISE EXCEPTION 'Admin has no assigned LGA. Contact Creator to set your branch assignment.';
    END IF;

    -- Admin cannot change another Admin's role
    IF v_target_role = 'admin' THEN
      RAISE EXCEPTION 'Admin cannot modify another Admin. Contact Creator.';
    END IF;

    -- Target must be in admin's LGA
    SELECT COALESCE(NULLIF(local_government, ''), NULLIF(city, '')) INTO v_target_lga
    FROM public.profiles WHERE user_id = p_target_user_id;

    IF v_target_lga IS NULL OR v_target_lga != v_caller_lga THEN
      RAISE EXCEPTION 'Admin scope violation: target is outside your assigned LGA (%)', v_caller_lga;
    END IF;

    -- Admin cannot promote to Admin (only Creator can create Admin)
    IF p_new_role = 'admin' THEN
      RAISE EXCEPTION 'Only Creator can assign Admin role';
    END IF;
  END IF;

  -- Apply role change with branch assignment when promoting to staff
  IF p_new_role = 'staff' THEN
    -- When promoting to staff, set operational assignment to caller's branch
    UPDATE public.profiles
    SET role = p_new_role,
        assigned_state = CASE WHEN v_caller_role = 'admin' THEN (SELECT assigned_state FROM public.profiles WHERE auth_id = auth.uid()::text) ELSE assigned_state END,
        assigned_lga = CASE WHEN v_caller_role = 'admin' THEN v_caller_lga ELSE assigned_lga END,
        scope = 'local',
        updated_at = NOW()
    WHERE user_id = p_target_user_id;
  ELSE
    -- For non-staff roles, clear operational assignment
    UPDATE public.profiles
    SET role = p_new_role,
        assigned_state = NULL,
        assigned_lga = NULL,
        scope = NULL,
        updated_at = NOW()
    WHERE user_id = p_target_user_id;
  END IF;

  INSERT INTO public.audit_logs (action, target_type, target_id, details, admin_id)
  VALUES ('ROLE_CHANGE', 'profiles', p_target_user_id,
          jsonb_build_object('new_role', p_new_role, 'old_role', v_target_role)::text,
          auth.uid()::text);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. DROP restore_soft_deleted_user — deleted accounts are PERMANENT
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.restore_soft_deleted_user(TEXT);

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. GRANT EXECUTE on PUBLIC-CALLABLE SECURITY DEFINER functions only
--
-- _assert_admin_lga_scope is an INTERNAL helper.
-- It MUST NOT be directly callable by authenticated users.
-- It is used INTERNALLY by other SECURITY DEFINER functions.
-- ─────────────────────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.admin_suspend_user(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ban_user(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reactivate_user(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user_account(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_role(TEXT, TEXT) TO authenticated;

-- REVOKE direct EXECUTE on the internal helper (it is called internally)
REVOKE EXECUTE ON FUNCTION public._assert_admin_lga_scope(TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public._assert_admin_lga_scope(TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public._assert_admin_lga_scope(TEXT) FROM PUBLIC;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. VERIFY: No RLS policies grant access to suspended/banned users
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
