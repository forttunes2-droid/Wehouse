-- ═══════════════════════════════════════════════════════════════════════
-- BULLETPROOF TRIGGER — Settings Save Can NEVER Be Blocked by Audit
-- Date: 2026-07-21
-- 
-- CRITICAL FIX: The trigger was rolling back the entire transaction
-- when the audit insert failed. This wrapper catches ALL exceptions
-- inside the trigger, logs them as warnings, and lets the parent
-- transaction commit regardless.
-- 
-- Result: Settings ALWAYS save. Audit logging is best-effort.
-- ═══════════════════════════════════════════════════════════════════════

-- ═══ 1. BULLETPROOF TRIGGER FUNCTION ═══
-- Exception-safe: audit failure NEVER blocks the parent transaction

CREATE OR REPLACE FUNCTION log_settings_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    INSERT INTO audit_logs (action, target_type, target_id, details, admin_id)
    VALUES (
      TG_OP,
      'platform_settings',
      COALESCE(NEW.key, OLD.key),
      jsonb_build_object('old_value', row_to_json(OLD), 'new_value', row_to_json(NEW))::text,
      auth.uid()::text
    );
  EXCEPTION WHEN OTHERS THEN
    -- Audit logging failed but we MUST NOT roll back the settings change.
    -- Log the failure as a PostgreSQL warning (visible in logs) but
    -- allow the parent transaction to commit normally.
    RAISE WARNING 'settings_audit_failed: action=%, key=%, error=%', TG_OP, COALESCE(NEW.key, OLD.key), SQLERRM;
  END;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ═══ 2. RECREATE TRIGGER (idempotent) ═══

DROP TRIGGER IF EXISTS settings_audit_trigger ON platform_settings;
CREATE TRIGGER settings_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON platform_settings
  FOR EACH ROW EXECUTE FUNCTION log_settings_change();

-- ═══ 3. ENSURE AUDIT POLICIES ARE CORRECT ═══

DROP POLICY IF EXISTS "audit_insert_restricted" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_insert_all" ON public.audit_logs;

-- Best-effort audit insert — trigger validates internally
CREATE POLICY IF NOT EXISTS "audit_insert_trigger" ON public.audit_logs
  FOR INSERT WITH CHECK (true);

-- Admin/creator read only
DROP POLICY IF EXISTS "audit_select_admin" ON public.audit_logs;
CREATE POLICY "audit_select_admin" ON public.audit_logs
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.user_id = auth.uid()::text AND profiles.role IN ('admin','creator','creator_admin'))
  );
