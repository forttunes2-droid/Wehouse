-- Phase 2: sessions are per device. Signing in on a new device must not
-- silently revoke every other active device session.
DROP TRIGGER IF EXISTS trg_invalidate_old_sessions ON public.user_sessions;
DROP FUNCTION IF EXISTS public.invalidate_old_sessions();
