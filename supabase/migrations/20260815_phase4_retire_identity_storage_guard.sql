BEGIN;

-- No government/external identity data should be collected by the active
-- Worker verification system. Keep the legacy columns temporarily so older
-- migrations/types do not break, but prevent new writes to them.
UPDATE public.worker_verifications
SET gov_id_type=NULL,
    gov_id_number=NULL,
    gov_id_photo_url=NULL,
    selfie_photo_url=NULL,
    identity_provider=NULL,
    identity_reference=NULL,
    identity_checked_at=NULL,
    identity_failure_reason=NULL,
    identity_status='not_started'
WHERE gov_id_type IS NOT NULL
   OR gov_id_number IS NOT NULL
   OR gov_id_photo_url IS NOT NULL
   OR selfie_photo_url IS NOT NULL
   OR identity_provider IS NOT NULL
   OR identity_reference IS NOT NULL
   OR identity_checked_at IS NOT NULL
   OR identity_failure_reason IS NOT NULL
   OR identity_status IS DISTINCT FROM 'not_started';

CREATE OR REPLACE FUNCTION public.block_retired_worker_identity_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path='public'
AS $function$
BEGIN
  IF NULLIF(BTRIM(COALESCE(NEW.gov_id_type,'')),'') IS NOT NULL
    OR NULLIF(BTRIM(COALESCE(NEW.gov_id_number,'')),'') IS NOT NULL
    OR NULLIF(BTRIM(COALESCE(NEW.gov_id_photo_url,'')),'') IS NOT NULL
    OR NULLIF(BTRIM(COALESCE(NEW.selfie_photo_url,'')),'') IS NOT NULL
    OR NULLIF(BTRIM(COALESCE(NEW.identity_provider,'')),'') IS NOT NULL
    OR NULLIF(BTRIM(COALESCE(NEW.identity_reference,'')),'') IS NOT NULL
    OR NEW.identity_checked_at IS NOT NULL
    OR NULLIF(BTRIM(COALESCE(NEW.identity_failure_reason,'')),'') IS NOT NULL
    OR COALESCE(NEW.identity_status,'not_started') <> 'not_started'
  THEN
    RAISE EXCEPTION 'Government/external identity fields are retired from WeHouse Worker verification';
  END IF;

  NEW.identity_status:='not_started';
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_block_retired_worker_identity_fields ON public.worker_verifications;
CREATE TRIGGER trg_block_retired_worker_identity_fields
BEFORE INSERT OR UPDATE OF
  gov_id_type,
  gov_id_number,
  gov_id_photo_url,
  selfie_photo_url,
  identity_provider,
  identity_reference,
  identity_checked_at,
  identity_failure_reason,
  identity_status
ON public.worker_verifications
FOR EACH ROW
EXECUTE FUNCTION public.block_retired_worker_identity_fields();

COMMIT;
