-- Phase 7 booking communication is private to signed-in booking participants.
-- These RPCs already validate the current actor internally; this migration also
-- removes anonymous API execution so the exposed privilege matches that contract.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.get_my_booking_conversations_v2(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_booking_conversations_v2(text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.hide_my_booking_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hide_my_booking_conversation(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.mark_my_booking_messages_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_my_booking_messages_read(uuid) TO authenticated;

COMMIT;
