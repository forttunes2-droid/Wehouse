-- WEHOUSE LEGACY WORKER RPC LOCKDOWN
-- Must run before 20260807_worker_workflow_hardening.sql.
-- Existing legacy SECURITY DEFINER overloads accept caller-controlled identity
-- values. Keep their definitions for compatibility/audit, but make them
-- unreachable by browser roles before the new auth-derived signatures are added.

BEGIN;

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
