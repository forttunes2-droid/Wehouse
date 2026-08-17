-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 2: ADMIN BRANCH SUPPORT + STAFF PROMOTION + LOCATION LOCK
-- Date: 2025-07-26
--
-- 1. admin_support_inbox() — Branch-scoped support inbox for Admin/Staff
-- 2. admin_promote_to_staff() — Promote User→Staff in same branch
-- 3. lock_admin_staff_location_trigger — Prevent branch-hopping
-- 4. creator_reassign_branch() — Creator can move Admin/Staff to new branch
-- ═══════════════════════════════════════════════════════════════

-- ═══ PART 1: BRANCH-SCOPED SUPPORT INBOX ═══

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
  SELECT role, assigned_state, assigned_lga
  INTO v_caller_role, v_caller_state, v_caller_lga
  FROM public.profiles
  WHERE auth_id = auth.uid();

  -- Creator sees everything
  IF v_caller_role IN ('creator', 'creator_admin') THEN
    RETURN QUERY
      SELECT c.id, c.participant_a, c.participant_b, c.status,
        c.last_message, c.last_message_at, c.unread_a,
        c.unread_b, c.created_at, c.conversation_type,
        c.subject,
        COALESCE(p.full_name, p.username, p.email) as user_name,
        p.email as user_email, p.phone as user_phone,
        p.state as user_state, COALESCE(p.local_government, p.city) as user_lga
      FROM public.conversations c
      LEFT JOIN public.profiles p ON p.user_id = c.participant_a
      WHERE c.conversation_type IN ('partner_support', 'partner_inspection', 'general_support')
        AND c.participant_a != 'wehouse_support'
      ORDER BY c.last_message_at DESC NULLS LAST;
    RETURN;
  END IF;

  -- Admin/Staff: only their branch
  IF v_caller_role IN ('admin', 'staff') THEN
    RETURN QUERY
      SELECT c.id, c.participant_a, c.participant_b, c.status,
        c.last_message, c.last_message_at, c.unread_a,
        c.unread_b, c.created_at, c.conversation_type,
        c.subject,
        COALESCE(p.full_name, p.username, p.email) as user_name,
        p.email as user_email, p.phone as user_phone,
        p.state as user_state, COALESCE(p.local_government, p.city) as user_lga
      FROM public.conversations c
      LEFT JOIN public.profiles p ON p.user_id = c.participant_a
      WHERE c.conversation_type IN ('partner_support', 'partner_inspection', 'general_support')
        AND c.participant_a != 'wehouse_support'
        AND p.state = v_caller_state
        AND COALESCE(p.local_government, p.city) = v_caller_lga
      ORDER BY c.last_message_at DESC NULLS LAST;
    RETURN;
  END IF;

  RAISE EXCEPTION 'Access denied';
END;
$$;

-- ═══ PART 2: PROMOTE USER TO STAFF ═══

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
  SELECT role, assigned_state, assigned_lga
  INTO v_caller_role, v_caller_state, v_caller_lga
  FROM public.profiles WHERE auth_id = auth.uid();

  IF v_caller_role != 'admin' THEN
    RAISE EXCEPTION 'Only Admin can promote users to Staff';
  END IF;

  SELECT role, state, COALESCE(local_government, city)
  INTO v_target_role, v_target_state, v_target_lga
  FROM public.profiles WHERE user_id = p_target_user_id;

  IF v_target_role != 'user' THEN
    RAISE EXCEPTION 'Can only promote regular users to Staff. Target is: %', v_target_role;
  END IF;

  IF v_target_state IS NULL OR v_target_lga IS NULL THEN
    RAISE EXCEPTION 'Target user has no location set';
  END IF;

  IF v_target_state != v_caller_state OR v_target_lga != v_caller_lga THEN
    RAISE EXCEPTION 'Target user is not in your branch. User: % / %, Your branch: % / %',
      v_target_state, v_target_lga, v_caller_state, v_caller_lga;
  END IF;

  UPDATE public.profiles
  SET role = 'staff', scope = 'local',
    assigned_state = v_target_state, assigned_lga = v_target_lga,
    updated_at = NOW()
  WHERE user_id = p_target_user_id;

  INSERT INTO public.audit_logs (action, target_type, target_id, details, admin_id)
  VALUES (
    'PROMOTE', 'profiles', p_target_user_id,
    jsonb_build_object('old_role', 'user', 'new_role', 'staff', 'branch', v_caller_state || ' / ' || v_caller_lga)::text,
    auth.uid()::text
  );

  RETURN TRUE;
END;
$$;

-- ═══ PART 3: LOCATION LOCK TRIGGER ═══

CREATE OR REPLACE FUNCTION lock_admin_staff_location()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_is_self_edit BOOLEAN;
BEGIN
  v_is_self_edit := (OLD.auth_id = auth.uid());
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

DROP TRIGGER IF EXISTS lock_admin_staff_location_trigger ON public.profiles;
CREATE TRIGGER lock_admin_staff_location_trigger
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION lock_admin_staff_location();

-- ═══ PART 4: CREATOR REASSIGN BRANCH ═══

DROP FUNCTION IF EXISTS public.creator_reassign_branch(TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.creator_reassign_branch(
  p_target_user_id TEXT, p_new_state TEXT, p_new_lga TEXT
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
  SELECT role INTO v_caller_role FROM public.profiles WHERE auth_id = auth.uid();
  IF v_caller_role NOT IN ('creator', 'creator_admin') THEN
    RAISE EXCEPTION 'Only Creator can reassign branches';
  END IF;

  SELECT role INTO v_target_role FROM public.profiles WHERE user_id = p_target_user_id;
  IF v_target_role NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Can only reassign Admin or Staff. Target is: %', v_target_role;
  END IF;

  UPDATE public.profiles
  SET assigned_state = p_new_state, assigned_lga = p_new_lga,
    state = p_new_state, local_government = p_new_lga, city = p_new_lga,
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
