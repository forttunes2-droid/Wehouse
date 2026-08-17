-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 1: FIX ADMIN AUDIT WRITERS (2025-07-25)
--
-- PROBLEM: The admin RPCs insert into columns that do NOT exist
-- in the actual audit_logs table: table_name, record_id, etc.
--
-- ACTUAL audit_logs columns:
--   id, admin_id, admin_email, action, target_type, target_id, details, created_at
--
-- FIX: Rewrite all 4 admin RPCs to use the correct columns.
-- ═══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.admin_update_role(TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.admin_update_role(
  p_target_user_id TEXT,
  p_new_role TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role TEXT;
  v_target_role TEXT;
BEGIN
  SELECT role INTO v_caller_role FROM public.profiles WHERE user_id = auth.uid()::text;
  IF v_caller_role NOT IN ('admin','creator','creator_admin') THEN
    RAISE EXCEPTION 'Admin/Creator access required';
  END IF;

  IF p_target_user_id = auth.uid()::text THEN
    RAISE EXCEPTION 'Cannot modify your own role';
  END IF;

  SELECT role INTO v_target_role FROM public.profiles WHERE user_id = p_target_user_id;
  IF v_target_role IN ('creator','creator_admin') THEN
    RAISE EXCEPTION 'Cannot modify Creator role';
  END IF;

  IF p_new_role NOT IN ('user','worker','property_partner','staff','admin','creator','creator_admin') THEN
    RAISE EXCEPTION 'Invalid role: %', p_new_role;
  END IF;

  UPDATE public.profiles SET role = p_new_role, updated_at = NOW() WHERE user_id = p_target_user_id;

  INSERT INTO public.audit_logs (action, target_type, target_id, details, admin_id)
  VALUES (
    'ROLE_CHANGE', 'profiles', p_target_user_id,
    jsonb_build_object('new_role', p_new_role)::text,
    auth.uid()::text
  );
END;
$$;

DROP FUNCTION IF EXISTS public.admin_suspend_user(TEXT);
CREATE OR REPLACE FUNCTION public.admin_suspend_user(p_target_user_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role TEXT;
  v_target_role TEXT;
BEGIN
  SELECT role INTO v_caller_role FROM public.profiles WHERE user_id = auth.uid()::text;
  IF v_caller_role NOT IN ('admin','creator','creator_admin') THEN
    RAISE EXCEPTION 'Admin/Creator access required';
  END IF;
  IF p_target_user_id = auth.uid()::text THEN
    RAISE EXCEPTION 'Cannot suspend yourself';
  END IF;
  SELECT role INTO v_target_role FROM public.profiles WHERE user_id = p_target_user_id;
  IF v_target_role IN ('creator','creator_admin') THEN
    RAISE EXCEPTION 'Cannot suspend Creator';
  END IF;
  UPDATE public.profiles SET worker_status = 'suspended', updated_at = NOW() WHERE user_id = p_target_user_id;
  INSERT INTO public.audit_logs (action, target_type, target_id, details, admin_id)
  VALUES ('SUSPEND', 'profiles', p_target_user_id, '{}'::text, auth.uid()::text);
END;
$$;

DROP FUNCTION IF EXISTS public.admin_ban_user(TEXT);
CREATE OR REPLACE FUNCTION public.admin_ban_user(p_target_user_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role TEXT;
  v_target_role TEXT;
BEGIN
  SELECT role INTO v_caller_role FROM public.profiles WHERE user_id = auth.uid()::text;
  IF v_caller_role NOT IN ('admin','creator','creator_admin') THEN
    RAISE EXCEPTION 'Admin/Creator access required';
  END IF;
  IF p_target_user_id = auth.uid()::text THEN
    RAISE EXCEPTION 'Cannot ban yourself';
  END IF;
  SELECT role INTO v_target_role FROM public.profiles WHERE user_id = p_target_user_id;
  IF v_target_role IN ('creator','creator_admin') THEN
    RAISE EXCEPTION 'Cannot ban Creator';
  END IF;
  UPDATE public.profiles SET deleted = true, deleted_at = NOW(), worker_status = 'suspended', updated_at = NOW() WHERE user_id = p_target_user_id;
  INSERT INTO public.audit_logs (action, target_type, target_id, details, admin_id)
  VALUES ('BAN', 'profiles', p_target_user_id, '{}'::text, auth.uid()::text);
END;
$$;

DROP FUNCTION IF EXISTS public.admin_reactivate_user(TEXT);
CREATE OR REPLACE FUNCTION public.admin_reactivate_user(p_target_user_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role TEXT;
BEGIN
  SELECT role INTO v_caller_role FROM public.profiles WHERE user_id = auth.uid()::text;
  IF v_caller_role NOT IN ('admin','creator','creator_admin') THEN
    RAISE EXCEPTION 'Admin/Creator access required';
  END IF;
  UPDATE public.profiles SET deleted = false, deleted_at = NULL, worker_status = 'active', updated_at = NOW() WHERE user_id = p_target_user_id;
  INSERT INTO public.audit_logs (action, target_type, target_id, details, admin_id)
  VALUES ('REACTIVATE', 'profiles', p_target_user_id, '{}'::text, auth.uid()::text);
END;
$$;
