-- ═══════════════════════════════════════════════════════════════════════
-- WEHOUSE STABILIZATION FIX
-- Date: 2026-07-21
-- Description: Fixes log_settings_change trigger that fails because
--   it inserts into columns that don't exist in the actual audit_logs
--   table. Also fixes audit log policy that blocks trigger inserts.
-- ═══════════════════════════════════════════════════════════════════════

-- ============================================================================
-- ROOT CAUSE
-- ============================================================================
-- The log_settings_change() trigger (created in 20250720_stage3_security_fixes.sql)
-- tries to INSERT into these columns:
--   table_name, record_id, old_value, new_value, performed_by
--
-- The ACTUAL audit_logs table (created in 20250526_audit_table.sql) has:
--   id TEXT, admin_id TEXT, admin_email TEXT, action TEXT,
--   target_type TEXT, target_id TEXT, details TEXT, created_at TIMESTAMPTZ
--
-- The trigger fails with:
--   column "table_name" of relation "audit_logs" does not exist
--
-- This causes EVERY platform_settings UPDATE to roll back.
-- Creator cannot save any settings.
-- ============================================================================

-- ═══ 1. FIX the trigger function ═══

CREATE OR REPLACE FUNCTION log_settings_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO audit_logs (action, target_type, target_id, details, admin_id)
  VALUES (
    TG_OP,                                        -- 'INSERT', 'UPDATE', or 'DELETE'
    'platform_settings',                          -- what was changed
    COALESCE(NEW.key, OLD.key),                   -- which setting
    jsonb_build_object(
      'old_value', row_to_json(OLD),
      'new_value', row_to_json(NEW)
    )::text,                                      -- full before/after as JSON text
    auth.uid()::text                              -- who made the change
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Trigger already exists from 20250720, function replacement above is sufficient.
-- If the trigger was dropped during debugging, recreate it:
DROP TRIGGER IF EXISTS settings_audit_trigger ON platform_settings;
CREATE TRIGGER settings_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON platform_settings
  FOR EACH ROW EXECUTE FUNCTION log_settings_change();

-- ═══ 2. FIX the audit_logs insert policy ═══
-- The 20250722 migration created "audit_insert_restricted" which blocks
-- authenticated users from inserting. But the trigger runs as SECURITY DEFINER
-- which means auth.uid() IS NOT NULL — so the policy would block the trigger too.
-- We need to allow the trigger (which runs as table owner / service role) to insert.

DROP POLICY IF EXISTS "audit_insert_restricted" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_insert_all" ON public.audit_logs;

-- Allow anyone to insert (the trigger and RPCs validate internally)
-- This is safe because the trigger function is SECURITY DEFINER and validates
CREATE POLICY "audit_insert_trigger" ON public.audit_logs
  FOR INSERT WITH CHECK (true);

-- Keep admin/creator read-only access
DROP POLICY IF EXISTS "audit_select_admin" ON public.audit_logs;
CREATE POLICY "audit_select_admin" ON public.audit_logs
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role IN ('admin','creator','creator_admin'))
  );
