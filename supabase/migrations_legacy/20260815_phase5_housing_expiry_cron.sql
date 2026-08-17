BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;

REVOKE ALL ON FUNCTION public.expire_overdue_reservations() FROM PUBLIC,anon,authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='wehouse-housing-expiry') THEN
    PERFORM cron.unschedule('wehouse-housing-expiry');
  END IF;

  PERFORM cron.schedule(
    'wehouse-housing-expiry',
    '*/5 * * * *',
    'SELECT public.expire_overdue_reservations();'
  );
END;
$$;

COMMIT;
