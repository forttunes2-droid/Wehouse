-- WEHOUSE WORKER WORKFLOW REQUIRED SETTINGS
-- Must run before 20260807_worker_workflow_hardening.sql.
-- Idempotent: existing settings are preserved and never overwritten.

BEGIN;

INSERT INTO public.platform_settings (
  key,
  value,
  category,
  label,
  description,
  data_type,
  editable,
  is_active,
  created_at,
  updated_at
)
SELECT
  'worker_commission_rate',
  '10',
  'payments',
  'Worker Commission Rate',
  'Percentage of each completed worker booking retained by WeHouse.',
  'number',
  true,
  true,
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1
  FROM public.platform_settings
  WHERE key = 'worker_commission_rate'
);

INSERT INTO public.platform_settings (
  key,
  value,
  category,
  label,
  description,
  data_type,
  editable,
  is_active,
  created_at,
  updated_at
)
SELECT
  'wallet_minimum_withdrawal',
  '1000',
  'payments',
  'Minimum Worker Withdrawal',
  'Minimum amount in naira that a worker may request for withdrawal.',
  'number',
  true,
  true,
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1
  FROM public.platform_settings
  WHERE key = 'wallet_minimum_withdrawal'
);

-- Fail safely if an existing value is empty, inactive or outside the accepted range.
DO $$
DECLARE
  v_commission NUMERIC;
  v_minimum NUMERIC;
BEGIN
  SELECT NULLIF(trim(value), '')::NUMERIC
  INTO v_commission
  FROM public.platform_settings
  WHERE key = 'worker_commission_rate'
    AND is_active = true;

  IF v_commission IS NULL OR v_commission < 0 OR v_commission > 50 THEN
    RAISE EXCEPTION 'worker_commission_rate must be active and between 0 and 50';
  END IF;

  SELECT NULLIF(trim(value), '')::NUMERIC
  INTO v_minimum
  FROM public.platform_settings
  WHERE key = 'wallet_minimum_withdrawal'
    AND is_active = true;

  IF v_minimum IS NULL OR v_minimum <= 0 THEN
    RAISE EXCEPTION 'wallet_minimum_withdrawal must be active and greater than 0';
  END IF;
END $$;

COMMIT;
