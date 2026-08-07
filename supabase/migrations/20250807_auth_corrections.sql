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

-- listings: public read only admin-approved listings by non-suspended/non-banned owners
-- Reserved listings remain visible (status stays 'available'; 72h lock enforced via availability_status at app layer)
-- pending_approval and rejected listings are NEVER publicly readable
DROP POLICY IF EXISTS "listings_public_read" ON public.listings;
CREATE POLICY "listings_public_read" ON public.listings
  FOR SELECT
  TO anon, authenticated
  USING (status = 'available'
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

-- ═════════════════════════════════════════════════════════════════════════════
-- 12. WORKER WORKFLOW RPCs
-- ═════════════════════════════════════════════════════════════════════════════

-- ── set_my_worker_availability ──
-- Workers toggle their own availability. Only verified workers can be available.
CREATE OR REPLACE FUNCTION public.set_my_worker_availability(p_is_available BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile RECORD;
BEGIN
  SELECT id, user_id, role, worker_status, available INTO v_profile
  FROM public.profiles
  WHERE auth_id = auth.uid()::text;

  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF v_profile.role != 'worker' THEN
    RAISE EXCEPTION 'Only workers can set availability';
  END IF;

  -- Only verified workers can be available; others are forced to false
  IF p_is_available AND v_profile.worker_status != 'verified' THEN
    RAISE EXCEPTION 'Only verified workers can be available';
  END IF;

  UPDATE public.profiles
  SET available = p_is_available,
      updated_at = NOW()
  WHERE id = v_profile.id;
END;
$$;

-- ── send_booking_message ──
-- Derives sender from auth.uid() to prevent spoofing.
-- Stores the raw content (text or storage path).
CREATE OR REPLACE FUNCTION public.send_booking_message(
  p_conversation_id UUID,
  p_content TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender_id TEXT;
  v_booking_id UUID;
  v_msg_id UUID;
BEGIN
  -- Derive sender from authenticated user
  SELECT user_id INTO v_sender_id
  FROM public.profiles
  WHERE auth_id = auth.uid()::text;

  IF v_sender_id IS NULL THEN
    RAISE EXCEPTION 'Sender profile not found';
  END IF;

  -- Get booking_id from conversation
  SELECT booking_id INTO v_booking_id
  FROM public.booking_conversations
  WHERE id = p_conversation_id;

  IF v_booking_id IS NULL THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;

  -- Verify sender is part of this booking
  IF NOT EXISTS (
    SELECT 1 FROM public.worker_bookings
    WHERE id = v_booking_id
      AND (user_id = v_sender_id OR worker_id = v_sender_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized to send messages in this conversation';
  END IF;

  -- Insert message
  INSERT INTO public.booking_messages (conversation_id, sender_id, content)
  VALUES (p_conversation_id, v_sender_id, p_content)
  RETURNING id INTO v_msg_id;

  -- Update conversation updated_at
  UPDATE public.booking_conversations
  SET updated_at = NOW()
  WHERE id = p_conversation_id;

  RETURN v_msg_id;
END;
$$;

-- ── create_booking_request ──
-- Hardened: checks worker is verified and available.
CREATE OR REPLACE FUNCTION public.create_booking_request(
  p_user_id TEXT,
  p_worker_id TEXT,
  p_service_type TEXT,
  p_description TEXT,
  p_address TEXT,
  p_scheduled_date TEXT,
  p_customer_message TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_worker RECORD;
  v_conv_id UUID;
  v_booking_id UUID;
  v_code TEXT;
BEGIN
  -- Verify customer exists and is not suspended/banned
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = p_user_id
      AND deleted = false
      AND suspended = false
      AND banned = false
  ) THEN
    RAISE EXCEPTION 'Customer account is not active';
  END IF;

  -- Verify worker exists, is verified, available, and not suspended/banned/deleted
  SELECT id, user_id, worker_status, available, deleted, suspended, banned
  INTO v_worker
  FROM public.profiles
  WHERE user_id = p_worker_id
    AND role = 'worker';

  IF v_worker IS NULL THEN
    RAISE EXCEPTION 'Worker not found';
  END IF;

  IF v_worker.worker_status != 'verified' THEN
    RAISE EXCEPTION 'Worker is not verified';
  END IF;

  IF v_worker.available != true THEN
    RAISE EXCEPTION 'Worker is not available for bookings';
  END IF;

  IF v_worker.deleted = true OR v_worker.suspended = true OR v_worker.banned = true THEN
    RAISE EXCEPTION 'Worker account is not active';
  END IF;

  -- Prevent self-booking
  IF p_user_id = p_worker_id THEN
    RAISE EXCEPTION 'Cannot book yourself';
  END IF;

  -- Generate unique booking code
  v_code := 'WH-' || upper(substring(md5(random()::text) from 1 for 6));

  -- Create booking
  INSERT INTO public.worker_bookings (
    user_id, worker_id, status, service_type, description, address,
    scheduled_date, booking_code, created_at, updated_at
  ) VALUES (
    p_user_id, p_worker_id, 'booking_requested', p_service_type,
    p_description, p_address, p_scheduled_date, v_code, NOW(), NOW()
  )
  RETURNING id INTO v_booking_id;

  -- Create conversation
  INSERT INTO public.booking_conversations (booking_id, updated_at)
  VALUES (v_booking_id, NOW())
  RETURNING id INTO v_conv_id;

  -- Link conversation to booking
  UPDATE public.worker_bookings
  SET booking_conversation_id = v_conv_id
  WHERE id = v_booking_id;

  -- Send initial customer message if provided
  IF p_customer_message IS NOT NULL AND length(trim(p_customer_message)) > 0 THEN
    INSERT INTO public.booking_messages (conversation_id, sender_id, content)
    VALUES (v_conv_id, p_user_id, trim(p_customer_message));
  END IF;

  RETURN jsonb_build_object(
    'booking_id', v_booking_id,
    'conversation_id', v_conv_id,
    'booking_code', v_code
  );
END;
$$;

-- ── worker_accept_booking ──
-- Worker accepts a booking and sets negotiated amount.
CREATE OR REPLACE FUNCTION public.worker_accept_booking(
  p_booking_id UUID,
  p_worker_id TEXT,
  p_negotiated_amount NUMERIC
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking RECORD;
BEGIN
  SELECT id, worker_id, status INTO v_booking
  FROM public.worker_bookings
  WHERE id = p_booking_id;

  IF v_booking IS NULL THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  IF v_booking.worker_id != p_worker_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF v_booking.status NOT IN ('booking_requested', 'negotiating') THEN
    RAISE EXCEPTION 'Booking cannot be accepted in current status: %', v_booking.status;
  END IF;

  UPDATE public.worker_bookings
  SET status = 'waiting_payment',
      negotiated_amount = p_negotiated_amount,
      updated_at = NOW()
  WHERE id = p_booking_id;

  RETURN true;
END;
$$;

-- ── customer_confirm_payment ──
-- Customer confirms Paystack payment, creates escrow.
CREATE OR REPLACE FUNCTION public.customer_confirm_payment(
  p_booking_id UUID,
  p_user_id TEXT,
  p_paystack_ref TEXT,
  p_paystack_tx_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking RECORD;
  v_commission_rate NUMERIC := 0.10; -- Default 10%, overridden by settings
  v_wehouse_fee NUMERIC;
  v_worker_receives NUMERIC;
BEGIN
  SELECT id, user_id, worker_id, status, negotiated_amount INTO v_booking
  FROM public.worker_bookings
  WHERE id = p_booking_id;

  IF v_booking IS NULL THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  IF v_booking.user_id != p_user_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF v_booking.status != 'waiting_payment' THEN
    RAISE EXCEPTION 'Booking is not awaiting payment';
  END IF;

  -- Read commission rate from settings (default 10%)
  SELECT (value::numeric) INTO v_commission_rate
  FROM public.platform_settings
  WHERE key = 'worker_commission_rate';

  IF v_commission_rate IS NULL THEN
    v_commission_rate := 0.10;
  END IF;

  v_wehouse_fee := round(v_booking.negotiated_amount * v_commission_rate, 2);
  v_worker_receives := v_booking.negotiated_amount - v_wehouse_fee;

  -- Update booking
  UPDATE public.worker_bookings
  SET status = 'confirmed',
      agreed_amount = v_booking.negotiated_amount,
      wehouse_fee = v_wehouse_fee,
      worker_commission = v_wehouse_fee,
      worker_receives = v_worker_receives,
      paystack_reference = p_paystack_ref,
      paystack_transaction_id = p_paystack_tx_id,
      updated_at = NOW()
  WHERE id = p_booking_id;

  -- Create escrow
  INSERT INTO public.escrow_transactions (
    booking_id, amount, status, created_at, updated_at
  ) VALUES (
    p_booking_id, v_booking.negotiated_amount, 'held', NOW(), NOW()
  );

  RETURN true;
END;
$$;

-- ── worker_start_job ──
CREATE OR REPLACE FUNCTION public.worker_start_job(
  p_booking_id UUID,
  p_worker_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.worker_bookings
    WHERE id = p_booking_id
      AND worker_id = p_worker_id
      AND status = 'confirmed'
  ) THEN
    RAISE EXCEPTION 'Booking not found or not in confirmed status';
  END IF;

  UPDATE public.worker_bookings
  SET status = 'in_progress', updated_at = NOW()
  WHERE id = p_booking_id;

  RETURN true;
END;
$$;

-- ── worker_mark_complete ──
CREATE OR REPLACE FUNCTION public.worker_mark_complete(
  p_booking_id UUID,
  p_worker_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.worker_bookings
    WHERE id = p_booking_id
      AND worker_id = p_worker_id
      AND status = 'in_progress'
  ) THEN
    RAISE EXCEPTION 'Booking not found or not in progress';
  END IF;

  UPDATE public.worker_bookings
  SET status = 'completed_pending_approval',
      worker_approved = true,
      completed_at = NOW(),
      updated_at = NOW()
  WHERE id = p_booking_id;

  RETURN true;
END;
$$;

-- ── customer_confirm_completion ──
-- Releases escrow to worker wallet.
CREATE OR REPLACE FUNCTION public.customer_confirm_completion(
  p_booking_id UUID,
  p_user_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking RECORD;
  v_wallet_id UUID;
BEGIN
  SELECT id, user_id, worker_id, status, worker_receives INTO v_booking
  FROM public.worker_bookings
  WHERE id = p_booking_id;

  IF v_booking IS NULL OR v_booking.user_id != p_user_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF v_booking.status != 'completed_pending_approval' THEN
    RAISE EXCEPTION 'Booking is not pending approval';
  END IF;

  -- Get worker wallet
  SELECT id INTO v_wallet_id
  FROM public.wallets
  WHERE owner_id = v_booking.worker_id
    AND owner_type = 'worker';

  IF v_wallet_id IS NULL THEN
    -- Auto-create wallet
    INSERT INTO public.wallets (owner_id, owner_type)
    VALUES (v_booking.worker_id, 'worker')
    RETURNING id INTO v_wallet_id;
  END IF;

  -- Update booking
  UPDATE public.worker_bookings
  SET status = 'approved_released',
      user_approved = true,
      updated_at = NOW()
  WHERE id = p_booking_id;

  -- Release escrow
  UPDATE public.escrow_transactions
  SET status = 'released', updated_at = NOW()
  WHERE booking_id = p_booking_id;

  -- Credit wallet
  UPDATE public.wallets
  SET available_balance = available_balance + v_booking.worker_receives,
      updated_at = NOW()
  WHERE id = v_wallet_id;

  -- Log transaction
  INSERT INTO public.wallet_transactions (wallet_id, amount, type, description, reference)
  VALUES (v_wallet_id, v_booking.worker_receives, 'credit', 'Job completion payment', p_booking_id::text);

  RETURN true;
END;
$$;

-- ── customer_raise_dispute ──
CREATE OR REPLACE FUNCTION public.customer_raise_dispute(
  p_booking_id UUID,
  p_user_id TEXT,
  p_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.worker_bookings
    WHERE id = p_booking_id
      AND user_id = p_user_id
      AND status IN ('completed_pending_approval', 'in_progress', 'confirmed')
  ) THEN
    RAISE EXCEPTION 'Booking not eligible for dispute';
  END IF;

  UPDATE public.worker_bookings
  SET status = 'disputed',
      dispute_reason = p_reason,
      updated_at = NOW()
  WHERE id = p_booking_id;

  UPDATE public.escrow_transactions
  SET status = 'disputed', updated_at = NOW()
  WHERE booking_id = p_booking_id;

  RETURN true;
END;
$$;

-- ── cancel_booking ──
CREATE OR REPLACE FUNCTION public.cancel_booking(
  p_booking_id UUID,
  p_canceller_id TEXT,
  p_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking RECORD;
BEGIN
  SELECT id, user_id, worker_id, status INTO v_booking
  FROM public.worker_bookings
  WHERE id = p_booking_id;

  IF v_booking IS NULL THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  IF v_booking.user_id != p_canceller_id AND v_booking.worker_id != p_canceller_id THEN
    RAISE EXCEPTION 'Not authorized to cancel this booking';
  END IF;

  -- Can only cancel before payment (booking_requested, negotiating, waiting_payment)
  IF v_booking.status NOT IN ('booking_requested', 'negotiating', 'waiting_payment') THEN
    RAISE EXCEPTION 'Booking cannot be cancelled in current status: %', v_booking.status;
  END IF;

  UPDATE public.worker_bookings
  SET status = 'cancelled',
      cancellation_reason = p_reason,
      updated_at = NOW()
  WHERE id = p_booking_id;

  RETURN true;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 13. STORAGE RLS POLICIES for worker-files and chat-files
-- ═════════════════════════════════════════════════════════════════════════════

-- Enable RLS on buckets (idempotent)
DO $$
BEGIN
  -- worker-files bucket policies
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE name = 'worker-files') THEN
    -- Workers can upload their own verification files
    IF NOT EXISTS (
      SELECT 1 FROM storage.policies
      WHERE bucket_id = 'worker-files' AND name = 'Workers upload own files'
    ) THEN
      CREATE POLICY "Workers upload own files" ON storage.objects
        FOR INSERT TO authenticated
        WITH CHECK (bucket_id = 'worker-files' AND (storage.foldername(name))[1] = auth.uid()::text);
    END IF;

    -- Workers can read their own files
    IF NOT EXISTS (
      SELECT 1 FROM storage.policies
      WHERE bucket_id = 'worker-files' AND name = 'Workers read own files'
    ) THEN
      CREATE POLICY "Workers read own files" ON storage.objects
        FOR SELECT TO authenticated
        USING (bucket_id = 'worker-files' AND (storage.foldername(name))[1] = auth.uid()::text);
    END IF;

    -- Admins/creators can read all worker files
    IF NOT EXISTS (
      SELECT 1 FROM storage.policies
      WHERE bucket_id = 'worker-files' AND name = 'Admins read all worker files'
    ) THEN
      CREATE POLICY "Admins read all worker files" ON storage.objects
        FOR SELECT TO authenticated
        USING (bucket_id = 'worker-files' AND EXISTS (
          SELECT 1 FROM public.profiles
          WHERE auth_id = auth.uid()::text AND role IN ('admin', 'creator', 'staff')
        ));
    END IF;
  END IF;

  -- chat-files bucket policies
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE name = 'chat-files') THEN
    -- Authenticated users can upload to chat-files
    IF NOT EXISTS (
      SELECT 1 FROM storage.policies
      WHERE bucket_id = 'chat-files' AND name = 'Users upload chat images'
    ) THEN
      CREATE POLICY "Users upload chat images" ON storage.objects
        FOR INSERT TO authenticated
        WITH CHECK (bucket_id = 'chat-files');
    END IF;

    -- Authenticated users can read chat files
    IF NOT EXISTS (
      SELECT 1 FROM storage.policies
      WHERE bucket_id = 'chat-files' AND name = 'Users read chat images'
    ) THEN
      CREATE POLICY "Users read chat images" ON storage.objects
        FOR SELECT TO authenticated
        USING (bucket_id = 'chat-files');
    END IF;
  END IF;
END $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 14. GRANT EXECUTE on new worker workflow RPCs
-- ═════════════════════════════════════════════════════════════════════════════

GRANT EXECUTE ON FUNCTION public.set_my_worker_availability(BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_booking_message(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking_request(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.worker_accept_booking(UUID, TEXT, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_confirm_payment(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.worker_start_job(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.worker_mark_complete(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_confirm_completion(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_raise_dispute(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_booking(UUID, TEXT, TEXT) TO authenticated;

COMMIT;
