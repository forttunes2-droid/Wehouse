-- These four foreign keys were introduced after the canonical index pass.
-- Cover reverse lookups and referential checks without changing access rules.
-- Roll out during a quiet window; fail instead of waiting on a busy table.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE INDEX IF NOT EXISTS hotel_bookings_completed_by_idx
  ON public.hotel_bookings (completed_by);
CREATE INDEX IF NOT EXISTS reservations_caution_check_in_policy_idx
  ON public.reservations (caution_check_in_policy_version_id);
CREATE INDEX IF NOT EXISTS support_message_drafts_conversation_idx
  ON public.support_message_drafts (conversation_id);
CREATE INDEX IF NOT EXISTS support_message_drafts_message_idx
  ON public.support_message_drafts (message_id);
