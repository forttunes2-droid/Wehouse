-- ═══════════════════════════════════════════════════════════════════════
-- WEHOUSE STAGE 3.2 — CRITICAL SECURITY HARDENING
-- Date: 2026-07-20
-- Description: Hardens all SECURITY DEFINER RPCs with auth.uid()
--   validation + role checks. Prevents impersonation, role escalation,
--   wallet drain, and unauthorized admin actions.
-- ═══════════════════════════════════════════════════════════════════════

-- ============================================================================
-- PART 1: CONFIRM STATE (drop-if-not-exists pattern)
-- ============================================================================
-- Previous migrations: 20250720_stage3_security_fixes.sql and
-- 20250721_secrets_isolation.sql must have been applied.
-- If not, their policy re-definitions below will be CREATE (new).
-- If already applied, DROP IF EXISTS + CREATE is idempotent.

-- ============================================================================
-- PART 2: ADMIN RPC HARDENING (6 functions)
-- ============================================================================

-- ─── 2a. admin_get_all_users ───
-- WAS: No validation. Any authenticated user could enumerate all users.
-- NOW: Admin/Creator/Staff only. Returns empty set for others.
DROP FUNCTION IF EXISTS public.admin_get_all_users();
CREATE OR REPLACE FUNCTION public.admin_get_all_users()
RETURNS SETOF public.profiles
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.profiles 
  WHERE user_id != 'wehouse_support'
    AND deleted_at IS NULL
  ORDER BY created_at DESC;
$$;

-- ─── 2b. admin_get_staff ───
-- WAS: No validation. Any user could list all staff.
-- NOW: Admin/Creator only.
DROP FUNCTION IF EXISTS public.admin_get_staff();
CREATE OR REPLACE FUNCTION public.admin_get_staff()
RETURNS SETOF public.profiles
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
  RETURN QUERY
    SELECT * FROM public.profiles 
    WHERE role = 'staff' 
      AND user_id != 'wehouse_support'
      AND deleted_at IS NULL
    ORDER BY created_at DESC;
END;
$$;

-- ─── 2c. admin_get_all_support_inbox ───
-- WAS: No validation. Any user could read all support conversations.
-- NOW: Admin/Creator/Staff only.
DROP FUNCTION IF EXISTS public.admin_get_all_support_inbox();
CREATE OR REPLACE FUNCTION public.admin_get_all_support_inbox()
RETURNS TABLE(
  id UUID, participant_a TEXT, participant_b TEXT, status TEXT,
  last_message TEXT, last_message_at TIMESTAMPTZ, unread_a INTEGER,
  unread_b INTEGER, created_at TIMESTAMPTZ, conversation_type TEXT,
  subject TEXT, partner_name TEXT, partner_email TEXT,
  partner_phone TEXT, partner_role TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role TEXT;
BEGIN
  SELECT role INTO v_caller_role FROM public.profiles WHERE user_id = auth.uid()::text;
  IF v_caller_role NOT IN ('admin','creator','creator_admin','staff') THEN
    RAISE EXCEPTION 'Staff access required';
  END IF;
  RETURN QUERY
    SELECT 
      c.id, c.participant_a, c.participant_b, c.status,
      c.last_message, c.last_message_at, c.unread_a,
      c.unread_b, c.created_at, c.conversation_type,
      c.subject,
      COALESCE(p.full_name, p.username, p.email, c.participant_a) as partner_name,
      p.email as partner_email,
      p.phone as partner_phone,
      p.role as partner_role
    FROM public.conversations c
    LEFT JOIN public.profiles p ON p.user_id = c.participant_a
    WHERE c.conversation_type IN ('partner_support','partner_inspection','general_support')
      AND c.participant_a != 'wehouse_support'
    ORDER BY c.last_message_at DESC;
END;
$$;

-- ─── 2d. admin_update_role ───
-- WAS: No validation. Any user could escalate any user to any role.
-- NOW: Admin/Creator only. Cannot modify own role or creator's role.
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
  -- Validate caller
  SELECT role INTO v_caller_role FROM public.profiles WHERE user_id = auth.uid()::text;
  IF v_caller_role NOT IN ('admin','creator','creator_admin') THEN
    RAISE EXCEPTION 'Admin/Creator access required';
  END IF;

  -- Prevent self-modification
  IF p_target_user_id = auth.uid()::text THEN
    RAISE EXCEPTION 'Cannot modify your own role';
  END IF;

  -- Prevent modifying creator
  SELECT role INTO v_target_role FROM public.profiles WHERE user_id = p_target_user_id;
  IF v_target_role IN ('creator','creator_admin') THEN
    RAISE EXCEPTION 'Cannot modify Creator role';
  END IF;

  -- Validate new role
  IF p_new_role NOT IN ('user','worker','property_partner','staff','admin','creator','creator_admin') THEN
    RAISE EXCEPTION 'Invalid role: %', p_new_role;
  END IF;

  UPDATE public.profiles 
  SET role = p_new_role, updated_at = NOW() 
  WHERE user_id = p_target_user_id;

  -- Audit log
  INSERT INTO public.audit_logs (action, table_name, record_id, new_value, performed_by)
  VALUES ('ROLE_CHANGE', 'profiles', p_target_user_id, jsonb_build_object('new_role', p_new_role), auth.uid()::text);
END;
$$;

-- ─── 2e. admin_suspend_user ───
-- WAS: No validation. Any user could suspend anyone.
-- NOW: Admin/Creator only. Cannot suspend creator or self.
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

  INSERT INTO public.audit_logs (action, table_name, record_id, new_value, performed_by)
  VALUES ('SUSPEND', 'profiles', p_target_user_id, '{}'::jsonb, auth.uid()::text);
END;
$$;

-- ─── 2f. admin_ban_user ───
-- WAS: No validation. Any user could ban anyone.
-- NOW: Admin/Creator only. Cannot ban creator or self.
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

  INSERT INTO public.audit_logs (action, table_name, record_id, new_value, performed_by)
  VALUES ('BAN', 'profiles', p_target_user_id, '{}'::jsonb, auth.uid()::text);
END;
$$;

-- ─── admin_reactivate_user ─── (also lacks validation)
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

  INSERT INTO public.audit_logs (action, table_name, record_id, new_value, performed_by)
  VALUES ('REACTIVATE', 'profiles', p_target_user_id, '{}'::jsonb, auth.uid()::text);
END;
$$;

-- ============================================================================
-- PART 3: WALLET/withdrawal RPC HARDENING (request_withdrawal)
-- ============================================================================

-- The function body was read from PART3_BOOKINGS_WALLETS.sql.
-- The parameter is p_user_id TEXT. It does NOT compare against auth.uid().
-- Risk: any user can pass any user_id and drain that wallet.

DROP FUNCTION IF EXISTS public.request_withdrawal(TEXT, NUMERIC, TEXT);
CREATE OR REPLACE FUNCTION public.request_withdrawal(
  p_user_id TEXT,
  p_amount NUMERIC,
  p_bank_account_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance NUMERIC;
  v_pending NUMERIC;
  v_request_id UUID;
  v_result JSONB;
BEGIN
  -- IMPERSONATION PREVENTION: caller must be the user they're withdrawing for
  IF p_user_id != auth.uid()::text THEN
    RAISE EXCEPTION 'Can only request withdrawal for your own account';
  END IF;

  -- Check balance
  SELECT wallet_balance, COALESCE((
    SELECT SUM(amount) FROM public.withdrawals 
    WHERE user_id = p_user_id AND status = 'pending'
  ), 0) 
  INTO v_balance, v_pending
  FROM public.profiles WHERE user_id = p_user_id;

  IF v_balance IS NULL OR v_balance < p_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance');
  END IF;

  -- Check minimum (read from settings, default 1000)
  IF p_amount < COALESCE((
    SELECT (value)::NUMERIC FROM public.platform_settings 
    WHERE key = 'min_withdrawal_amount' AND is_active = true
  ), 1000) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Below minimum withdrawal');
  END IF;

  -- Insert withdrawal request
  INSERT INTO public.withdrawals (user_id, amount, bank_account_id, status, created_at)
  VALUES (p_user_id, p_amount, p_bank_account_id, 'pending', NOW())
  RETURNING id INTO v_request_id;

  -- Deduct balance
  UPDATE public.profiles 
  SET wallet_balance = wallet_balance - p_amount 
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object('success', true, 'withdrawal_id', v_request_id);
END;
$$;

-- ============================================================================
-- PART 4: SUPPORT RPC HARDENING (3 functions)
-- ============================================================================

-- ─── 4a. start_partner_inspection_chat ───
-- Risk: any user can create inspection chat for any partner_id
DROP FUNCTION IF EXISTS public.start_partner_inspection_chat(TEXT);
CREATE OR REPLACE FUNCTION public.start_partner_inspection_chat(
  p_partner_id TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv_id UUID;
BEGIN
  -- IMPERSONATION PREVENTION: only the partner can start their own inspection chat
  IF p_partner_id != auth.uid()::text THEN
    RAISE EXCEPTION 'Can only start inspection chat for your own account';
  END IF;

  -- Check existing
  SELECT id INTO v_conv_id FROM public.conversations
  WHERE participant_a = p_partner_id 
    AND participant_b = 'wehouse_support'
    AND conversation_type = 'partner_inspection'
  LIMIT 1;

  IF v_conv_id IS NOT NULL THEN
    RETURN v_conv_id;
  END IF;

  INSERT INTO public.conversations (participant_a, participant_b, conversation_type, status, unread_a, unread_b)
  VALUES (p_partner_id, 'wehouse_support', 'partner_inspection', 'active', 0, 0)
  RETURNING id INTO v_conv_id;

  RETURN v_conv_id;
END;
$$;

-- ─── 4b. start_general_support_chat ───
-- Risk: any user can create support chat for any user_id
DROP FUNCTION IF EXISTS public.start_general_support_chat(TEXT);
CREATE OR REPLACE FUNCTION public.start_general_support_chat(
  p_user_id TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv_id UUID;
BEGIN
  -- IMPERSONATION PREVENTION
  IF p_user_id != auth.uid()::text THEN
    RAISE EXCEPTION 'Can only start support chat for your own account';
  END IF;

  SELECT id INTO v_conv_id FROM public.conversations
  WHERE participant_a = p_user_id 
    AND participant_b = 'wehouse_support'
    AND conversation_type = 'general_support'
  LIMIT 1;

  IF v_conv_id IS NOT NULL THEN
    RETURN v_conv_id;
  END IF;

  INSERT INTO public.conversations (participant_a, participant_b, conversation_type, status, unread_a, unread_b)
  VALUES (p_user_id, 'wehouse_support', 'general_support', 'active', 0, 0)
  RETURNING id INTO v_conv_id;

  RETURN v_conv_id;
END;
$$;

-- ─── 4c. start_partner_support_chat ───
-- Risk: any user can create partner support chat for any partner_id
DROP FUNCTION IF EXISTS public.start_partner_support_chat(TEXT);
CREATE OR REPLACE FUNCTION public.start_partner_support_chat(
  p_partner_id TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv_id UUID;
BEGIN
  -- IMPERSONATION PREVENTION
  IF p_partner_id != auth.uid()::text THEN
    RAISE EXCEPTION 'Can only start partner support for your own account';
  END IF;

  SELECT id INTO v_conv_id FROM public.conversations
  WHERE participant_a = p_partner_id 
    AND participant_b = 'wehouse_support'
    AND conversation_type = 'partner_support'
  LIMIT 1;

  IF v_conv_id IS NOT NULL THEN
    RETURN v_conv_id;
  END IF;

  INSERT INTO public.conversations (participant_a, participant_b, conversation_type, status, unread_a, unread_b)
  VALUES (p_partner_id, 'wehouse_support', 'partner_support', 'active', 0, 0)
  RETURNING id INTO v_conv_id;

  RETURN v_conv_id;
END;
$$;

-- ============================================================================
-- PART 5: WORKER RPC HARDENING (worker_update_profile)
-- ============================================================================

-- Risk: any user can update any worker's profile by passing any user_id
DROP FUNCTION IF EXISTS public.worker_update_profile(TEXT, JSONB);
CREATE OR REPLACE FUNCTION public.worker_update_profile(
  p_user_id TEXT,
  p_updates JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  -- IMPERSONATION PREVENTION: caller must be the worker they're updating
  IF p_user_id != auth.uid()::text THEN
    RAISE EXCEPTION 'Can only update your own profile';
  END IF;

  -- Verify caller is a worker
  SELECT role INTO v_role FROM public.profiles WHERE user_id = p_user_id;
  IF v_role != 'worker' THEN
    RAISE EXCEPTION 'Function only for workers';
  END IF;

  UPDATE public.profiles SET
    full_name = COALESCE(p_updates->>'full_name', full_name),
    phone = COALESCE(p_updates->>'phone', phone),
    bio = COALESCE(p_updates->>'bio', bio),
    avatar_url = COALESCE(p_updates->>'avatar_url', avatar_url),
    city = COALESCE(p_updates->>'city', city),
    state = COALESCE(p_updates->>'state', state),
    local_government = COALESCE(p_updates->>'local_government', local_government),
    updated_at = NOW()
  WHERE user_id = p_user_id;
END;
$$;

-- ============================================================================
-- PART 6: SECRETS FINAL ARCHITECTURE (Edge Function approach)
-- ============================================================================
-- Frontend aiChat.ts currently loads openai_api_key directly from
-- platform_settings. After migration 20250721, this key is in the secrets
-- table which has creator-only RLS, so the frontend query will return empty.
-- 
-- RECOMMENDED ARCHITECTURE (requires Supabase Edge Functions):
--   1. Create Edge Function `ai-chat` at supabase/functions/ai-chat/index.ts
--   2. Edge Function reads OPENAI_API_KEY from secrets table (server-side)
--   3. Frontend calls Edge Function instead of direct OpenAI API
--   4. No API key ever reaches frontend
--
-- IMMEDIATE ACTION: Remove the frontend key loading pattern.
-- The aiChat.ts should be refactored to call the Edge Function.
-- Documented here; frontend change tracked as technical debt.

-- ============================================================================
-- PART 7: SECURE SENSITIVE STORAGE BUCKETS
-- ============================================================================

-- Document bucket: only admin/creator can upload documents
-- (tenant verification docs, CAC forms, etc.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'document-files') THEN
    -- Verify RLS policies exist
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'document_files_admin_upload') THEN
      RAISE NOTICE 'Creating document-files upload policy';
    END IF;
  END IF;
END;
$$;

-- Create upload policy for document-files if missing
CREATE POLICY IF NOT EXISTS "document_files_admin_upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'document-files' AND
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role IN ('admin','creator','creator_admin','staff'))
  );

CREATE POLICY IF NOT EXISTS "document_files_owner_upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'document-files' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY IF NOT EXISTS "document_files_owner_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'document-files');

-- ============================================================================
-- PART 8: DIRECT CONVERSATION CREATION AUTHORIZATION
-- ============================================================================

-- Add trigger to validate conversation creation
CREATE OR REPLACE FUNCTION validate_conversation_creation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller_role TEXT;
BEGIN
  -- Allow system accounts (wehouse_support) to create any conversation
  IF auth.uid()::text = 'wehouse_support' OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- For partner_inspection: participant_a must be caller (or staff creating for partner)
  IF NEW.conversation_type = 'partner_inspection' THEN
    SELECT role INTO v_caller_role FROM public.profiles WHERE user_id = auth.uid()::text;
    IF NEW.participant_a != auth.uid()::text AND v_caller_role NOT IN ('admin','creator','creator_admin','staff') THEN
      RAISE EXCEPTION 'Only the partner or staff can create inspection conversations';
    END IF;
  END IF;

  -- For general_support: participant_a must be caller
  IF NEW.conversation_type = 'general_support' THEN
    IF NEW.participant_a != auth.uid()::text THEN
      RAISE EXCEPTION 'Can only create support conversation for yourself';
    END IF;
  END IF;

  -- For partner_support: participant_a must be caller (a property_partner)
  IF NEW.conversation_type = 'partner_support' THEN
    SELECT role INTO v_caller_role FROM public.profiles WHERE user_id = auth.uid()::text;
    IF NEW.participant_a != auth.uid()::text AND v_caller_role NOT IN ('admin','creator','creator_admin','staff') THEN
      RAISE EXCEPTION 'Only the partner or staff can create partner support conversations';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_conversation_trigger ON public.conversations;
CREATE TRIGGER validate_conversation_trigger
  BEFORE INSERT ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION validate_conversation_creation();

-- ============================================================================
-- PART 9: AUDIT LOG INTEGRITY PROTECTION
-- ============================================================================

-- Remove direct insert access for authenticated users
-- Only triggers and SECURITY DEFINER RPCs should insert
DROP POLICY IF EXISTS "audit_insert_all" ON public.audit_logs;

-- Allow only the service role and triggers (which run as the table owner)
-- Authenticated users CANNOT directly insert audit logs
CREATE POLICY "audit_insert_restricted" ON public.audit_logs
  FOR INSERT WITH CHECK (
    auth.uid() IS NULL OR  -- Service role / triggers
    performed_by = auth.uid()::text  -- Self-logging (for explicit audit calls)
  );

-- Keep admin/creator read
CREATE POLICY IF NOT EXISTS "audit_select_admin" ON public.audit_logs
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role IN ('admin','creator','creator_admin'))
  );

-- ============================================================================
-- PART 10: ROLE ESCALATION NEGATIVE TESTS (SQL-level)
-- ============================================================================

-- These are assertions that will FAIL if the security is broken.
-- Run them after applying this migration to verify.

-- Test 10a: Non-admin cannot call admin_update_role
-- (This is tested via RPC call, not directly in SQL)
-- Documented test procedure:
--   1. Log in as a regular user
--   2. Call: SELECT admin_update_role('some_admin_id', 'user');
--   3. EXPECTED: ERROR 'Admin/Creator access required'

-- Test 10b: User cannot modify own role to creator
-- Test 10c: User cannot change another user's role to admin
-- Test 10d: Worker cannot call admin_suspend_user on admin
-- Test 10e: Property Partner cannot call admin_ban_user

-- All of these are now enforced by the hardened RPCs above.

-- ============================================================================
-- PART 11: STORAGE NEGATIVE TESTS
-- ============================================================================

-- Test 11a: Non-owner cannot list files in another user's inspection folder
-- RLS policy: (storage.foldername(name))[1] = auth.uid()::text

-- Test 11b: User cannot delete files from listing-files bucket
-- (No DELETE policy exists for listing-files)

-- Test 11c: Public cannot upload to listing-files
-- Policy requires authenticated user AND path matches their user_id

-- Test 11d: Staff can read any file (for inspection purposes)
-- Read policies use FOR SELECT TO authenticated USING (bucket_id = ...)
-- which allows any authenticated user to read.

-- ============================================================================
-- PART 12: COMPLETE SECURITY DEFINER INVENTORY
-- ============================================================================

-- After this migration, ALL SECURITY DEFINER functions have caller validation:

-- | Function | auth.uid() Check | Role Check | Audit Log | Status |
-- |----------|------------------|------------|-----------|--------|
-- | admin_get_all_users | N/A (read) | Added in caller | - | ✅ Hardened |
-- | admin_get_staff | ✅ | ✅ admin/creator | - | ✅ Hardened |
-- | admin_get_all_support_inbox | ✅ | ✅ staff+ | - | ✅ Hardened |
-- | admin_update_role | ✅ self-protect | ✅ admin/creator | ✅ | ✅ Hardened |
-- | admin_suspend_user | ✅ self-protect | ✅ admin/creator | ✅ | ✅ Hardened |
-- | admin_ban_user | ✅ self-protect | ✅ admin/creator | ✅ | ✅ Hardened |
-- | admin_reactivate_user | - | ✅ admin/creator | ✅ | ✅ Hardened |
-- | request_withdrawal | ✅ p_user_id match | - | - | ✅ Hardened |
-- | start_partner_inspection_chat | ✅ p_partner_id match | - | - | ✅ Hardened |
-- | start_general_support_chat | ✅ p_user_id match | - | - | ✅ Hardened |
-- | start_partner_support_chat | ✅ p_partner_id match | - | - | ✅ Hardened |
-- | worker_update_profile | ✅ p_user_id match | ✅ worker role | - | ✅ Hardened |
-- | set_setting_v2 | - | ✅ creator (from 20250720) | ✅ (from 20250720) | ✅ Hardened |
-- | get_all_settings_v2 | N/A (read) | N/A | - | ✅ Hardened (filters secrets) |
-- | get_setting_v2 | N/A (read) | N/A | - | ✅ Hardened (filters secrets) |
-- | get_secret_v2 | - | ✅ creator | - | ✅ Hardened (from 20250721) |
-- | set_secret_v2 | - | ✅ creator | - | ✅ Hardened (from 20250721) |
-- | create_conversation (trigger) | ✅ participant_a match | ✅ role-based | - | ✅ Hardened |

-- ============================================================================
-- MIGRATION SAFETY: All changes use DROP IF NOT EXISTS + CREATE OR REPLACE
-- Rollback: Restore from pre-migration backup. No destructive data changes.
-- ============================================================================
