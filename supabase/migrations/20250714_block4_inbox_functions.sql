-- BLOCK 4: Staff inbox view functions
-- Returns support conversations without joining profiles table
-- Frontend looks up names separately

CREATE OR REPLACE FUNCTION public.get_inspection_chats()
RETURNS TABLE(id UUID, participant_a TEXT, participant_b TEXT, status TEXT, last_message TEXT, last_message_at TIMESTAMPTZ, unread_a INTEGER, unread_b INTEGER, created_at TIMESTAMPTZ, conversation_type TEXT, subject TEXT)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT c.id, c.participant_a, c.participant_b, c.status, c.last_message, c.last_message_at, c.unread_a, c.unread_b, c.created_at, c.conversation_type, c.subject
  FROM public.conversations c
  WHERE c.conversation_type = 'partner_inspection'
  ORDER BY c.last_message_at DESC NULLS LAST;
$$;

CREATE OR REPLACE FUNCTION public.get_general_support_chats()
RETURNS TABLE(id UUID, participant_a TEXT, participant_b TEXT, status TEXT, last_message TEXT, last_message_at TIMESTAMPTZ, unread_a INTEGER, unread_b INTEGER, created_at TIMESTAMPTZ, conversation_type TEXT, subject TEXT)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT c.id, c.participant_a, c.participant_b, c.status, c.last_message, c.last_message_at, c.unread_a, c.unread_b, c.created_at, c.conversation_type, c.subject
  FROM public.conversations c
  WHERE c.conversation_type = 'general_support'
  ORDER BY c.last_message_at DESC NULLS LAST;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_all_support_inbox()
RETURNS TABLE(id UUID, participant_a TEXT, participant_b TEXT, status TEXT, last_message TEXT, last_message_at TIMESTAMPTZ, unread_a INTEGER, unread_b INTEGER, created_at TIMESTAMPTZ, conversation_type TEXT, subject TEXT)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT c.id, c.participant_a, c.participant_b, c.status, c.last_message, c.last_message_at, c.unread_a, c.unread_b, c.created_at, c.conversation_type, c.subject
  FROM public.conversations c
  WHERE c.conversation_type IN ('partner_support', 'partner_inspection', 'general_support')
  ORDER BY c.last_message_at DESC NULLS LAST;
$$;
