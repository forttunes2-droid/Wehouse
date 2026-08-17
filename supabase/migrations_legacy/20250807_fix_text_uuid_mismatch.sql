-- ============================================================================
-- FIX: TEXT = UUID type mismatch in existing functions and triggers
-- Date: 2026-08-07
-- Purpose: Fix all occurrences of auth.uid() (UUID type) compared against
--          TEXT columns (auth_id, user_id) without ::text cast.
--          Also fixes privilege escalation in admin_update_role.
--          Also fixes creator_reassign_branch to not overwrite personal location.
-- ============================================================================

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. FIX lock_admin_staff_location trigger
-- ════════════════════════════════════════════════════════════════════════════
-- Trigger fires BEFORE UPDATE on profiles. During profile setup (Setup.tsx
-- calling updateProfile), this trigger evaluates OLD.auth_id = auth.uid()
-- which fails with: operator does not exist: text = uuid
-- Fix: cast auth.uid() to text.

CREATE OR REPLACE FUNCTION lock_admin_staff_location()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_self_edit BOOLEAN;
BEGIN
  v_is_self_edit := (OLD.auth_id = auth.uid()::text);
  IF v_is_self_edit AND OLD.role IN ('admin', 'staff') THEN
    IF NEW.assigned_state IS DISTINCT FROM OLD.assigned_state THEN
      RAISE EXCEPTION 'Admin and Staff cannot change their own branch assignment. Contact Creator for reassignment.';
    END IF;
    IF NEW.assigned_lga IS DISTINCT FROM OLD.assigned_lga THEN
      RAISE EXCEPTION 'Admin and Staff cannot change their own branch assignment. Contact Creator for reassignment.';
    END IF;
    IF NEW.state IS DISTINCT FROM OLD.state THEN
      RAISE EXCEPTION 'Admin and Staff cannot change their own state. Contact Creator for reassignment.';
    END IF;
    IF NEW.local_government IS DISTINCT FROM OLD.local_government THEN
      RAISE EXCEPTION 'Admin and Staff cannot change their own LGA. Contact Creator for reassignment.';
    END IF;
    IF NEW.city IS DISTINCT FROM OLD.city THEN
      RAISE EXCEPTION 'Admin and Staff cannot change their own city. Contact Creator for reassignment.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. FIX creator_reassign_branch
-- ════════════════════════════════════════════════════════════════════════════
-- Same TEXT=UUID bug: auth_id (TEXT) = auth.uid() (UUID) without cast.
-- Also fixed: only update operational fields (assigned_state, assigned_lga).
-- Do NOT overwrite personal state, local_government, city, or area.

CREATE OR REPLACE FUNCTION public.creator_reassign_branch(
  p_target_user_id TEXT,
  p_new_state TEXT,
  p_new_lga TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role TEXT;
  v_target_role TEXT;
BEGIN
  SELECT role INTO v_caller_role
  FROM public.profiles
  WHERE auth_id = auth.uid()::text;

  IF v_caller_role NOT IN ('creator') THEN
    RAISE EXCEPTION 'Only Creator can reassign branches';
  END IF;

  SELECT role INTO v_target_role
  FROM public.profiles
  WHERE user_id = p_target_user_id;

  IF v_target_role NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Can only reassign Admin or Staff. Target is: %', v_target_role;
  END IF;

  -- Operational reassignment ONLY: assigned_state and assigned_lga
  -- Do NOT overwrite personal location fields (state, local_government, city, area)
  UPDATE public.profiles
  SET assigned_state = p_new_state,
      assigned_lga = p_new_lga,
      updated_at = NOW()
  WHERE user_id = p_target_user_id;

  INSERT INTO public.audit_logs (action, target_type, target_id, details, admin_id)
  VALUES (
    'REASSIGN', 'profiles', p_target_user_id,
    jsonb_build_object('new_branch', p_new_state || ' / ' || p_new_lga)::text,
    auth.uid()::text
  );

  RETURN TRUE;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. FIX admin_update_role (privilege escalation + TEXT=UUID bugs)
-- ════════════════════════════════════════════════════════════════════════════
-- Fixes:
--   1. TEXT=UUID: auth_id = auth.uid() now uses auth.uid()::text
--   2. Self-role-change: compare target.auth_id against auth.uid()::text
--   3. Privilege escalation: Admin can NEVER assign 'creator' or 'admin'
--   4. Only Creator can assign 'admin' role
--   5. Creator role is protected — not in general allowed list

CREATE OR REPLACE FUNCTION public.admin_update_role(
  p_target_user_id TEXT,
  p_new_role TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role TEXT;
  v_caller_lga TEXT;
  v_caller_user_id TEXT;
  v_target RECORD;
  v_target_lga TEXT;
BEGIN
  -- Fetch caller profile
  SELECT role, assigned_lga, user_id
  INTO v_caller_role, v_caller_lga, v_caller_user_id
  FROM public.profiles
  WHERE auth_id = auth.uid()::text;

  IF v_caller_role NOT IN ('admin','creator') THEN
    RAISE EXCEPTION 'Admin/Creator access required';
  END IF;

  -- Fetch target profile
  SELECT * INTO v_target
  FROM public.profiles
  WHERE user_id = p_target_user_id;

  IF v_target IS NULL THEN
    RAISE EXCEPTION 'Target user not found';
  END IF;

  -- Self-role-change guard: reject if target is the caller
  -- Compare target.auth_id (TEXT) against auth.uid()::text (TEXT)
  IF v_target.auth_id = auth.uid()::text THEN
    RAISE EXCEPTION 'Cannot modify your own role';
  END IF;

  -- Creator protection: never modify Creator role
  IF v_target.role = 'creator' THEN
    RAISE EXCEPTION 'Cannot modify Creator role';
  END IF;

  -- ═══ Privilege escalation guards ═══
  -- Admin can NEVER assign creator or admin
  IF v_caller_role = 'admin' AND p_new_role IN ('creator', 'admin') THEN
    RAISE EXCEPTION 'Admin cannot assign % role. Only Creator can.', p_new_role;
  END IF;

  -- Only Creator can assign admin
  IF p_new_role = 'admin' AND v_caller_role != 'creator' THEN
    RAISE EXCEPTION 'Only Creator can assign Admin role';
  END IF;

  -- Creator role is not assignable through this generic RPC
  IF p_new_role = 'creator' THEN
    RAISE EXCEPTION 'Creator role is not assignable through this function';
  END IF;

  -- Validate allowed roles (creator excluded from general list)
  IF p_new_role NOT IN ('user','worker','property_partner','staff','admin') THEN
    RAISE EXCEPTION 'Invalid role: %', p_new_role;
  END IF;

  -- ═══ LGA scope check for admin ═══
  IF v_caller_role = 'admin' THEN
    -- Admin must have assigned_lga
    IF v_caller_lga IS NULL OR trim(v_caller_lga) = '' THEN
      RAISE EXCEPTION 'Admin has no assigned LGA. Contact Creator to set your branch assignment.';
    END IF;

    -- Admin cannot change another Admin's role
    IF v_target.role = 'admin' THEN
      RAISE EXCEPTION 'Admin cannot modify another Admin. Contact Creator.';
    END IF;

    -- Target must be in admin's LGA
    SELECT COALESCE(NULLIF(v_target.local_government, ''), NULLIF(v_target.city, ''))
    INTO v_target_lga;

    IF v_target_lga IS NULL OR v_target_lga != v_caller_lga THEN
      RAISE EXCEPTION 'Admin scope violation: target is outside your assigned LGA (%)', v_caller_lga;
    END IF;
  END IF;

  -- ═══ Apply role change with branch assignment when promoting to staff ═══
  IF p_new_role = 'staff' THEN
    UPDATE public.profiles
    SET role = p_new_role,
        assigned_state = CASE WHEN v_caller_role = 'admin'
          THEN (SELECT assigned_state FROM public.profiles WHERE auth_id = auth.uid()::text)
          ELSE assigned_state
        END,
        assigned_lga = CASE WHEN v_caller_role = 'admin'
          THEN v_caller_lga
          ELSE assigned_lga
        END,
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
  VALUES (
    'ROLE_CHANGE', 'profiles', p_target_user_id,
    jsonb_build_object('new_role', p_new_role, 'old_role', v_target.role)::text,
    auth.uid()::text
  );
END;
$$;

COMMIT;
