-- ═══════════════════════════════════════════════════════════════
-- FIX ADMIN AUDIT WRITERS — 2026-07-24
--
-- PROBLEM: The admin RPCs (admin_update_role, admin_suspend_user,
-- admin_ban_user, admin_reactivate_user) from 20250722 insert into
-- columns that do NOT exist in the actual audit_logs table:
--   table_name, record_id, new_value, performed_by
--
-- ACTUAL audit_logs columns (from 20250526_audit_table.sql):
--   id, admin_id, admin_email, action, target_type, target_id, details, created_at
--
-- These admin audit INSERTs would fail at runtime because the columns
-- don't exist. Only the settings trigger was successfully writing audit
-- records (fixed in 20250723/20250724).
--
-- FIX: Rewrite all 4 admin RPCs to use the correct columns.
--   action → the action name
--   target_type → 'profiles'
--   target_id → the affected user's user_id
--   details → JSON with relevant info
--   admin_id → auth.uid()::text (the actor's Supabase UUID)
--
-- Also: admin_id stores auth.uid()::text (Supabase UUID).
-- Resolution path: audit_logs.admin_id = profiles.auth_id
-- ═══════════════════════════════════════════════════════════════

-- ═══ 1. admin_update_role ═══
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

  UPDATE public.profiles 
  SET role = p_new_role, updated_at = NOW() 
  WHERE user_id = p_target_user_id;

  -- CORRECTED: Use actual audit_logs columns
  INSERT INTO public.audit_logs (action, target_type, target_id, details, admin_id)
  VALUES (
    'ROLE_CHANGE',
    'profiles',
    p_target_user_id,
    jsonb_build_object('new_role', p_new_role)::text,
    auth.uid()::text
  );
END;
$$;

-- ═══ 2. admin_suspend_user ═══
DROP FUNCTION IF EXISTS public.admin_suspend_user(TEXT);
CREATE OR REPLACE FUNCTION public.admin_suspend_user(
  p_target_user_id TEXT
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
    RAISE EXCEPTION 'Cannot suspend yourself';
  END IF;

  SELECT role INTO v_target_role FROM public.profiles WHERE user_id = p_target_user_id;
  IF v_target_role IN ('creator','creator_admin') THEN
    RAISE EXCEPTION 'Cannot suspend Creator';
  END IF;

  UPDATE public.profiles 
  SET worker_status = 'suspended', updated_at = NOW() 
  WHERE user_id = p_target_user_id;

  -- CORRECTED: Use actual audit_logs columns
  INSERT INTO public.audit_logs (action, target_type, target_id, details, admin_id)
  VALUES (
    'SUSPEND',
    'profiles',
    p_target_user_id,
    '{}'::text,
    auth.uid()::text
  );
END;
$$;

-- ═══ 3. admin_ban_user ═══
DROP FUNCTION IF EXISTS public.admin_ban_user(TEXT);
CREATE OR REPLACE FUNCTION public.admin_ban_user(
  p_target_user_id TEXT
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
    RAISE EXCEPTION 'Cannot ban yourself';
  END IF;

  SELECT role INTO v_target_role FROM public.profiles WHERE user_id = p_target_user_id;
  IF v_target_role IN ('creator','creator_admin') THEN
    RAISE EXCEPTION 'Cannot ban Creator';
  END IF;

  UPDATE public.profiles 
  SET deleted = true, deleted_at = NOW(), worker_status = 'suspended', updated_at = NOW() 
  WHERE user_id = p_target_user_id;

  -- CORRECTED: Use actual audit_logs columns
  INSERT INTO public.audit_logs (action, target_type, target_id, details, admin_id)
  VALUES (
    'BAN',
    'profiles',
    p_target_user_id,
    '{}'::text,
    auth.uid()::text
  );
END;
$$;

-- ═══ 4. admin_reactivate_user ═══
DROP FUNCTION IF EXISTS public.admin_reactivate_user(TEXT);
CREATE OR REPLACE FUNCTION public.admin_reactivate_user(
  p_target_user_id TEXT
)
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

  UPDATE public.profiles 
  SET deleted = false, deleted_at = NULL, worker_status = 'active', updated_at = NOW() 
  WHERE user_id = p_target_user_id;

  -- CORRECTED: Use actual audit_logs columns
  INSERT INTO public.audit_logs (action, target_type, target_id, details, admin_id)
  VALUES (
    'REACTIVATE',
    'profiles',
    p_target_user_id,
    '{}'::text,
    auth.uid()::text
  );
END;
$$;
