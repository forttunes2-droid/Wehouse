CREATE UNIQUE INDEX IF NOT EXISTS announcement_recipients_one_delivery ON public.announcement_recipients(announcement_id,user_id);
CREATE INDEX IF NOT EXISTS announcement_recipients_user_unread_delivered ON public.announcement_recipients(user_id,read_status,delivered_at DESC);
CREATE INDEX IF NOT EXISTS notifications_recipient_read_created ON public.notifications(recipient_id,read,created_at DESC);
CREATE INDEX IF NOT EXISTS messages_conversation_created ON public.messages(conversation_id,created_at DESC);
DROP INDEX IF EXISTS public.idx_messages_conversation_id;
DROP INDEX IF EXISTS public.idx_reservations_user_id;
