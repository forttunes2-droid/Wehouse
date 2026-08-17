-- ═══════════════════════════════════════════════════════════════
-- AUDIT LOGS RLS FIX — 2026-07-21
-- 
-- ROOT CAUSE: The audit_logs SELECT policy compared
--   profiles.user_id = auth.uid()::text
-- 
-- PROBLEM: profiles.user_id = 'WHU-0001' (custom format)
--          auth.uid() = 'a1b2c3d4-e5f6-...' (Supabase UUID)
--          These NEVER match. The policy blocks ALL reads.
-- 
-- FIX: Use profiles.auth_id which stores the Supabase UUID.
--   profiles.auth_id = auth.uid()
-- 
-- The original correct policy (20250526_audit_table.sql) used auth_id.
-- The 20250720 migration accidentally changed it to user_id.
-- All subsequent migrations copied this broken version.
-- ═══════════════════════════════════════════════════════════════

-- Drop the broken policy
DROP POLICY IF EXISTS "audit_select_admin" ON public.audit_logs;

-- Create the corrected policy using auth_id (UUID) not user_id (WHU-XXXXX)
CREATE POLICY "audit_select_admin" ON public.audit_logs
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.auth_id = auth.uid()
        AND profiles.role IN ('creator','creator_admin','admin')
    )
  );
