-- Worker dashboard hardening: protect the existing profiles.available mutation.
-- This is intentionally additive because 20260807_worker_workflow_hardening.sql
-- already defines the canonical auth-derived set_my_worker_availability RPC.

BEGIN;

CREATE OR REPLACE FUNCTION public.guard_worker_availability_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.available IS NOT DISTINCT FROM OLD.available THEN
    RETURN NEW;
  END IF;

  -- Creator/admin maintenance is allowed; ordinary callers may only change
  -- availability on their own worker profile.
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles actor
    WHERE actor.auth_id = auth.uid()::text
      AND actor.role IN ('creator', 'admin')
      AND actor.deleted = false
      AND actor.suspended = false
      AND actor.banned = false
  ) THEN
    IF OLD.auth_id IS DISTINCT FROM auth.uid()::text OR OLD.role <> 'worker' THEN
      RAISE EXCEPTION 'You may only change your own worker availability';
    END IF;

    IF OLD.deleted = true OR OLD.suspended = true OR OLD.banned = true THEN
      RAISE EXCEPTION 'Inactive worker accounts cannot change availability';
    END IF;

    IF NEW.available = true AND OLD.worker_status <> 'verified' THEN
      RAISE EXCEPTION 'Only verified workers can become available';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_worker_availability_update ON public.profiles;
CREATE TRIGGER trg_guard_worker_availability_update
BEFORE UPDATE OF available ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.guard_worker_availability_update();

REVOKE ALL ON FUNCTION public.guard_worker_availability_update() FROM PUBLIC, anon, authenticated;

COMMIT;
