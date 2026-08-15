BEGIN;

CREATE OR REPLACE FUNCTION public.record_external_worker_identity_result_by_reference(
  p_provider text,
  p_reference text,
  p_status text,
  p_failure_reason text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE
  v_worker_id text;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Service-only function';
  END IF;

  IF p_status NOT IN ('verified','failed','needs_retry','pending_external') THEN
    RAISE EXCEPTION 'Invalid identity result';
  END IF;

  IF NULLIF(BTRIM(COALESCE(p_provider,'')),'') IS NULL
     OR NULLIF(BTRIM(COALESCE(p_reference,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Provider and provider reference are required';
  END IF;

  SELECT worker_id
  INTO v_worker_id
  FROM public.worker_verifications
  WHERE lower(COALESCE(identity_provider,'')) = lower(BTRIM(p_provider))
    AND identity_reference = BTRIM(p_reference)
  ORDER BY updated_at DESC, created_at DESC
  LIMIT 1;

  IF v_worker_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.worker_verifications
  SET
    identity_status = p_status,
    identity_checked_at = now(),
    identity_failure_reason = CASE
      WHEN p_status IN ('verified','pending_external') THEN NULL
      ELSE NULLIF(BTRIM(COALESCE(p_failure_reason,'')),'')
    END,
    updated_at = now()
  WHERE worker_id = v_worker_id
    AND lower(COALESCE(identity_provider,'')) = lower(BTRIM(p_provider))
    AND identity_reference = BTRIM(p_reference);

  UPDATE public.profiles
  SET id_verified = (p_status = 'verified'), updated_at = now()
  WHERE user_id = v_worker_id AND role = 'worker';

  RETURN v_worker_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_external_worker_identity_result_by_reference(text,text,text,text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_external_worker_identity_result_by_reference(text,text,text,text)
TO service_role;

COMMIT;
