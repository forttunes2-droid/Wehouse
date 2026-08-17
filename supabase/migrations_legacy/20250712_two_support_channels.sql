-- ═══════════════════════════════════════════════════════════════
-- TWO SUPPORT CHANNELS: Partner Inspection + General Support
-- ═══════════════════════════════════════════════════════════════

-- 1. Add file_url to messages (for property uploads in chat)
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS file_url TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS file_name TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS file_type TEXT;

-- 2. Update conversation_type check constraint
-- partner_inspection = Property partner uploads properties for inspection
-- general_support = Users/workers lay complaints
-- partner_support = General partner questions (existing)
-- direct = 1-on-1 user to user

-- 3. RPC: Start partner INSPECTION chat (with upload capability)
-- This is separate from general partner support
CREATE OR REPLACE FUNCTION public.start_partner_inspection_chat(p_partner_id TEXT)
RETURNS public.conversations
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  existing_conv public.conversations;
  new_conv public.conversations;
BEGIN
  SELECT * INTO existing_conv FROM public.conversations
  WHERE participant_a = p_partner_id
    AND participant_b = 'wehouse_support'
    AND conversation_type = 'partner_inspection'
  LIMIT 1;

  IF existing_conv.id IS NOT NULL THEN
    RETURN existing_conv;
  END IF;

  INSERT INTO public.conversations (participant_a, participant_b, status, conversation_type, subject)
  VALUES (p_partner_id, 'wehouse_support', 'active', 'partner_inspection', 'Property Inspection Request')
  RETURNING * INTO new_conv;

  RETURN new_conv;
END;
$$;

-- 4. RPC: Start general support chat (for users/workers)
CREATE OR REPLACE FUNCTION public.start_general_support_chat(p_user_id TEXT)
RETURNS public.conversations
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  existing_conv public.conversations;
  new_conv public.conversations;
BEGIN
  SELECT * INTO existing_conv FROM public.conversations
  WHERE participant_a = p_user_id
    AND participant_b = 'wehouse_support'
    AND conversation_type = 'general_support'
  LIMIT 1;

  IF existing_conv.id IS NOT NULL THEN
    RETURN existing_conv;
  END IF;

  INSERT INTO public.conversations (participant_a, participant_b, status, conversation_type, subject)
  VALUES (p_user_id, 'wehouse_support', 'active', 'general_support', 'General Support')
  RETURNING * INTO new_conv;

  RETURN new_conv;
END;
$$;

-- 5. RPC: Get inspection chats (for staff with inspection rights)
CREATE OR REPLACE FUNCTION public.get_inspection_chats()
RETURNS TABLE(id UUID, participant_a TEXT, participant_b TEXT, status TEXT, last_message TEXT, last_message_at TIMESTAMPTZ, unread_a INTEGER, unread_b INTEGER, created_at TIMESTAMPTZ, conversation_type TEXT, subject TEXT, partner_name TEXT, partner_email TEXT, partner_phone TEXT)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT c.id, c.participant_a, c.participant_b, c.status, c.last_message, c.last_message_at, c.unread_a, c.unread_b, c.created_at, c.conversation_type, c.subject, p.full_name as partner_name, p.email as partner_email, p.phone as partner_phone
  FROM public.conversations c
  LEFT JOIN public.profiles p ON p.user_id = c.participant_a
  WHERE c.conversation_type = 'partner_inspection'
  ORDER BY c.last_message_at DESC NULLS LAST;
$$;

-- 6. RPC: Get general support chats
CREATE OR REPLACE FUNCTION public.get_general_support_chats()
RETURNS TABLE(id UUID, participant_a TEXT, participant_b TEXT, status TEXT, last_message TEXT, last_message_at TIMESTAMPTZ, unread_a INTEGER, unread_b INTEGER, created_at TIMESTAMPTZ, conversation_type TEXT, subject TEXT, user_name TEXT, user_email TEXT, user_role TEXT)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT c.id, c.participant_a, c.participant_b, c.status, c.last_message, c.last_message_at, c.unread_a, c.unread_b, c.created_at, c.conversation_type, c.subject, p.full_name as user_name, p.email as user_email, p.role as user_role
  FROM public.conversations c
  LEFT JOIN public.profiles p ON p.user_id = c.participant_a
  WHERE c.conversation_type = 'general_support'
  ORDER BY c.last_message_at DESC NULLS LAST;
$$;

-- 7. Update messages RLS to allow file uploads in support chats
CREATE POLICY "messages_insert_file" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.participant_a = auth.uid()::text 
             OR c.participant_b = auth.uid()::text 
             OR c.conversation_type IN ('partner_support', 'partner_inspection', 'general_support'))
    )
  );
