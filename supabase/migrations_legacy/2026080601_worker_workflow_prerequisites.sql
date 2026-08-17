-- WEHOUSE WORKER WORKFLOW PREREQUISITES
-- Runs before 20260807_worker_workflow_hardening.sql.
-- 1. Creates required financial settings without overwriting existing values.
-- 2. Revokes unsafe browser access to legacy caller-controlled RPC overloads.

BEGIN;

-- Required platform settings. Existing rows are preserved.
INSERT INTO public.platform_settings (
  key, value, category, label, description,
  data_type, editable, is_active, created_at, updated_at
)
SELECT
  'worker_commission_rate', '10', 'payments',
  'Worker Commission Rate',
  'Percentage of each completed worker booking retained by WeHouse.',
  'number', true, true, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM public.platform_settings
  WHERE key = 'worker_commission_rate'
);

INSERT INTO public.platform_settings (
  key, value, category, label, description,
  data_type, editable, is_active, created_at, updated_at
)
SELECT
  'wallet_minimum_withdrawal', '1000', 'payments',
  'Minimum Worker Withdrawal',
  'Minimum amount in naira that a worker may request for withdrawal.',
  'number', true, true, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM public.platform_settings
  WHERE key = 'wallet_minimum_withdrawal'
);

-- Fail safely if an existing row is inactive, empty, duplicated or invalid.
DO $$
DECLARE
  v_commission_count INTEGER;
  v_minimum_count INTEGER;
  v_commission NUMERIC;
  v_minimum NUMERIC;
BEGIN
  SELECT COUNT(*), MIN(NULLIF(trim(value), '')::NUMERIC)
  INTO v_commission_count, v_commission
  FROM public.platform_settings
  WHERE key = 'worker_commission_rate'
    AND is_active = true;

  IF v_commission_count != 1 OR v_commission IS NULL OR v_commission < 0 OR v_commission > 50 THEN
    RAISE EXCEPTION 'worker_commission_rate must have exactly one active numeric row between 0 and 50';
  END IF;

  SELECT COUNT(*), MIN(NULLIF(trim(value), '')::NUMERIC)
  INTO v_minimum_count, v_minimum
  FROM public.platform_settings
  WHERE key = 'wallet_minimum_withdrawal'
    AND is_active = true;

  IF v_minimum_count != 1 OR v_minimum IS NULL OR v_minimum <= 0 THEN
    RAISE EXCEPTION 'wallet_minimum_withdrawal must have exactly one active positive numeric row';
  END IF;
END $$;

-- Lock down legacy SECURITY DEFINER overloads that accept browser-supplied
-- caller identity. The new hardening migration creates auth-derived signatures.
REVOKE EXECUTE ON FUNCTION public.create_booking_request(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.send_booking_message(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.worker_accept_booking(UUID, TEXT, NUMERIC)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.worker_accept_booking(UUID, TEXT, NUMERIC, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.worker_start_job(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.worker_mark_complete(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.customer_confirm_completion(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.customer_raise_dispute(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_booking(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

COMMIT;
