-- ═══════════════════════════════════════════════════════════════════════
-- ADMIN BRANCH SUPPORT + STAFF PROMOTION + LOCATION LOCK
-- Date: 2026-07-24
-- 
-- THREE PROBLEMS FIXED:
-- 1. Admin Support was empty (SupportTabDirector was a stub)
-- 2. Admin could not promote User → Staff (no promotion UI)
-- 3. Admin/Staff could change their own location (no server-side lock)
-- ═══════════════════════════════════════════════════════════════════════

-- ============================================================================
-- PART 1: BRANCH-SCOPED SUPPORT INBOX RPC
-- ============================================================================

-- admin_get_all_support_inbox returns ALL support conversations globally.
-- Admin needs a branch-scoped version that only returns conversations
-- from users in the Admin's assigned_state + assigned_lga.

-- The branch is derived from the participant's profile (state + city/local_government).

DROP FUNCTION IF EXISTS public.admin_support_inbox();
CREATE OR REPLACE FUNCTION public.admin_support_inbox()
RETURNS TABLE(
  id UUID, participant_a TEXT, participant_b TEXT, status TEXT,
  last_message TEXT, last_message_at TIMESTAMPTZ, unread_a INTEGER,
  unread_b INTEGER, created_at TIMESTAMPTZ, conversation_type TEXT,
  subject TEXT, user_name TEXT, user_email TEXT, user_phone TEXT,
  user_state TEXT, user_lga TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role TEXT;
  v_caller_state TEXT;
  v_caller_lga TEXT;
BEGIN
  -- Get caller's role and branch assignment
  SELECT role, assigned_state, assigned_lga
  INTO v_caller_role, v_caller_state, v_caller_lga
  FROM public.profiles
  WHERE auth_id = auth.uid();

  -- Creator sees everything (no branch restriction)
  IF v_caller_role IN ('creator', 'creator_admin') THEN
    RETURN QUERY
      SELECT 
        c.id, c.participant_a, c.participant_b, c.status,
        c.last_message, c.last_message_at, c.unread_a,
        c.unread_b, c.created_at, c.conversation_type,
        c.subject,
        COALESCE(p.full_name, p.username, p.email) as user_name,
        p.email as user_email,
        p.phone as user_phone,
        p.state as user_state,
        COALESCE(p.local_government, p.city) as user_lga
      FROM public.conversations c
      LEFT JOIN public.profiles p ON p.user_id = c.participant_a
      WHERE c.conversation_type IN ('partner_support', 'partner_inspection', 'general_support')
        AND c.participant_a != 'wehouse_support'
      ORDER BY c.last_message_at DESC NULLS LAST;
    RETURN;
  END IF;

  -- Admin/Staff: only see conversations from users in their branch
  -- Branch = participant's state + local_government/city
  IF v_caller_role IN ('admin', 'staff') THEN
    RETURN QUERY
      SELECT 
        c.id, c.participant_a, c.participant_b, c.status,
        c.last_message, c.last_message_at, c.unread_a,
        c.unread_b, c.created_at, c.conversation_type,
        c.subject,
        COALESCE(p.full_name, p.username, p.email) as user_name,
        p.email as user_email,
        p.phone as user_phone,
        p.state as user_state,
        COALESCE(p.local_government, p.city) as user_lga
      FROM public.conversations c
      LEFT JOIN public.profiles p ON p.user_id = c.participant_a
      WHERE c.conversation_type IN ('partner_support', 'partner_inspection', 'general_support')
        AND c.participant_a != 'wehouse_support'
        AND p.state = v_caller_state
        AND COALESCE(p.local_government, p.city) = v_caller_lga
      ORDER BY c.last_message_at DESC NULLS LAST;
    RETURN;
  END IF;

  -- Everyone else: denied
  RAISE EXCEPTION 'Access denied';
END;
$$;

-- ============================================================================
-- PART 2: ADMIN PROMOTE USER TO STAFF RPC
-- ============================================================================

-- Admin can promote a user in their own branch to Staff.
-- Branch validation: user's state+LGA must match admin's assigned_state+assigned_lga.
-- Admin CANNOT promote to Admin, Creator, or any role above Staff.
-- Promotion preserves the user's location (state, city, local_government).

DROP FUNCTION IF EXISTS public.admin_promote_to_staff(TEXT);
CREATE OR REPLACE FUNCTION public.admin_promote_to_staff(p_target_user_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role TEXT;
  v_caller_state TEXT;
  v_caller_lga TEXT;
  v_target_role TEXT;
  v_target_state TEXT;
  v_target_lga TEXT;
BEGIN
  -- Get caller's info
  SELECT role, assigned_state, assigned_lga
  INTO v_caller_role, v_caller_state, v_caller_lga
  FROM public.profiles
  WHERE auth_id = auth.uid();

  -- Only Admin can promote (Creator uses admin_update_role instead)
  IF v_caller_role != 'admin' THEN
    RAISE EXCEPTION 'Only Admin can promote users to Staff';
  END IF;

  -- Get target user's info
  SELECT role, state, COALESCE(local_government, city)
  INTO v_target_role, v_target_state, v_target_lga
  FROM public.profiles
  WHERE user_id = p_target_user_id;

  -- Target must be a regular user
  IF v_target_role != 'user' THEN
    RAISE EXCEPTION 'Can only promote regular users to Staff. Target is: %', v_target_role;
  END IF;

  -- Branch validation: target must be in admin's branch
  IF v_target_state IS NULL OR v_target_lga IS NULL THEN
    RAISE EXCEPTION 'Target user has no location set';
  END IF;

  IF v_target_state != v_caller_state OR v_target_lga != v_caller_lga THEN
    RAISE EXCEPTION 'Target user is not in your branch. User: % / %, Your branch: % / %',
      v_target_state, v_target_lga, v_caller_state, v_caller_lga;
  END IF;

  -- Promote: role = staff, scope = local, preserve location
  UPDATE public.profiles
  SET 
    role = 'staff',
    scope = 'local',
    assigned_state = v_target_state,
    assigned_lga = v_target_lga,
    updated_at = NOW()
  WHERE user_id = p_target_user_id;

  -- Audit log
  INSERT INTO public.audit_logs (action, target_type, target_id, details, admin_id)
  VALUES (
    'PROMOTE',
    'profiles',
    p_target_user_id,
    jsonb_build_object('old_role', 'user', 'new_role', 'staff', 'branch', v_caller_state || ' / ' || v_caller_lga)::text,
    auth.uid()::text
  );

  RETURN TRUE;
END;
$$;

-- ============================================================================
-- PART 3: LOCATION LOCK TRIGGER
-- ============================================================================

-- Once a user becomes Admin or Staff, they CANNOT change their own
-- assigned_state or assigned_lga. This prevents branch-hopping.
-- 
-- The trigger fires BEFORE UPDATE on profiles and blocks the change
-- if the user is admin/staff and is trying to modify their own location.

CREATE OR REPLACE FUNCTION lock_admin_staff_location()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_is_self_edit BOOLEAN;
BEGIN
  -- Check if this is the user editing their own profile
  v_is_self_edit := (OLD.auth_id = auth.uid());

  -- If admin/staff is trying to change their own assigned_state or assigned_lga, block it
  IF v_is_self_edit AND OLD.role IN ('admin', 'staff') THEN
    IF NEW.assigned_state IS DISTINCT FROM OLD.assigned_state THEN
      RAISE EXCEPTION 'Admin and Staff cannot change their own branch assignment. Contact Creator for reassignment.';
    END IF;
    IF NEW.assigned_lga IS DISTINCT FROM OLD.assigned_lga THEN
      RAISE EXCEPTION 'Admin and Staff cannot change their own branch assignment. Contact Creator for reassignment.';
    END IF;
    -- Also block changing state/local_government/city (the residential fields)
    -- since these are the source of branch identity
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

DROP TRIGGER IF EXISTS lock_admin_staff_location_trigger ON public.profiles;
CREATE TRIGGER lock_admin_staff_location_trigger
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION lock_admin_staff_location();

-- ============================================================================
-- PART 4: CREATOR CAN REASSIGN ADMIN/STAFF BRANCH
-- ============================================================================

-- Creator needs a way to reassign Admin/Staff to a different branch.
-- This bypasses the location lock since Creator is not editing their own profile.

DROP FUNCTION IF EXISTS public.creator_reassign_branch(TEXT, TEXT, TEXT);
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
  -- Verify caller is Creator
  SELECT role INTO v_caller_role FROM public.profiles WHERE auth_id = auth.uid();
  IF v_caller_role NOT IN ('creator', 'creator_admin') THEN
    RAISE EXCEPTION 'Only Creator can reassign branches';
  END IF;

  -- Get target role
  SELECT role INTO v_target_role FROM public.profiles WHERE user_id = p_target_user_id;
  IF v_target_role NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Can only reassign Admin or Staff. Target is: %', v_target_role;
  END IF;

  -- Update all location fields
  UPDATE public.profiles
  SET 
    assigned_state = p_new_state,
    assigned_lga = p_new_lga,
    state = p_new_state,
    local_government = p_new_lga,
    city = p_new_lga,
    updated_at = NOW()
  WHERE user_id = p_target_user_id;

  -- Audit log
  INSERT INTO public.audit_logs (action, target_type, target_id, details, admin_id)
  VALUES (
    'REASSIGN',
    'profiles',
    p_target_user_id,
    jsonb_build_object('new_branch', p_new_state || ' / ' || p_new_lga)::text,
    auth.uid()::text
  );

  RETURN TRUE;
END;
$$;
