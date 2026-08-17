-- ═══════════════════════════════════════════════════════════════
-- SHARED SUPPORT INBOX SYSTEM
-- ═══════════════════════════════════════════════════════════════

-- 1. Create a fixed WeHouse Support user (used as participant_b in partner chats)
-- This is a special system profile that represents WeHouse as an entity
INSERT INTO profiles (user_id, auth_id, email, username, role, full_name, created_at)
VALUES ('wehouse_support', '00000000-0000-0000-0000-000000000000', 'support@wehouse.com.ng', 'wehousesupport', 'staff', 'WeHouse Support', now())
ON CONFLICT (user_id) DO NOTHING;

-- 2. RPC: Partner starts a support chat
-- Creates conversation with partner as participant_a, wehouse_support as participant_b
CREATE OR REPLACE FUNCTION public.start_partner_support_chat(p_partner_id TEXT)
RETURNS public.conversations
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  existing_conv public.conversations;
  new_conv public.conversations;
BEGIN
  -- Check if a support conversation already exists for this partner
  SELECT * INTO existing_conv FROM public.conversations
  WHERE participant_a = p_partner_id
    AND participant_b = 'wehouse_support'
    AND conversation_type = 'partner_support'
  LIMIT 1;

  IF existing_conv.id IS NOT NULL THEN
    RETURN existing_conv;
  END IF;

  -- Create new support conversation
  INSERT INTO public.conversations (
    participant_a, participant_b, status,
    conversation_type, subject
  ) VALUES (
    p_partner_id, 'wehouse_support', 'active',
    'partner_support', 'Property Partner Support'
  )
  RETURNING * INTO new_conv;

  RETURN new_conv;
END;
$$;

-- 3. RPC: Get all partner support conversations (for staff)
CREATE OR REPLACE FUNCTION public.get_partner_support_inbox()
RETURNS TABLE(
  id UUID, participant_a TEXT, participant_b TEXT,
  status TEXT, last_message TEXT, last_message_at TIMESTAMPTZ,
  unread_a INTEGER, unread_b INTEGER, created_at TIMESTAMPTZ,
  conversation_type TEXT, subject TEXT,
  partner_name TEXT, partner_email TEXT, partner_phone TEXT
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 
    c.id, c.participant_a, c.participant_b,
    c.status, c.last_message, c.last_message_at,
    c.unread_a, c.unread_b, c.created_at,
    c.conversation_type, c.subject,
    p.full_name as partner_name, p.email as partner_email, p.phone as partner_phone
  FROM public.conversations c
  LEFT JOIN public.profiles p ON p.user_id = c.participant_a
  WHERE c.conversation_type = 'partner_support'
  ORDER BY c.last_message_at DESC NULLS LAST;
$$;

-- 4. RPC: Send message in support chat (any staff can send)
CREATE OR REPLACE FUNCTION public.send_support_message(
  p_conversation_id UUID,
  p_sender_id TEXT,
  p_content TEXT
)
RETURNS public.messages
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_msg public.messages;
  conv_rec public.conversations;
BEGIN
  -- Verify this is a partner_support conversation
  SELECT * INTO conv_rec FROM public.conversations WHERE id = p_conversation_id;
  IF conv_rec.id IS NULL OR conv_rec.conversation_type != 'partner_support' THEN
    RAISE EXCEPTION 'Not a support conversation';
  END IF;

  -- Insert message
  INSERT INTO public.messages (conversation_id, sender_id, content, seen)
  VALUES (p_conversation_id, p_sender_id, p_content, false)
  RETURNING * INTO new_msg;

  -- Update conversation last_message and unread count
  UPDATE public.conversations
  SET last_message = p_content,
      last_message_at = now(),
      unread_a = CASE WHEN participant_a = p_sender_id THEN unread_a ELSE unread_a + 1 END,
      unread_b = CASE WHEN participant_b = p_sender_id THEN unread_b ELSE unread_b + 1 END
  WHERE id = p_conversation_id;

  RETURN new_msg;
END;
$$;

-- 5. Allow messages table insert for authenticated users (needed for support chat)
-- First drop existing restrictive policy
DROP POLICY IF EXISTS "messages_insert_sender" ON public.messages;

-- Create policy that allows insert if you're a participant in the conversation
CREATE POLICY "messages_insert_participant" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.participant_a = auth.uid()::text OR c.participant_b = auth.uid()::text
             OR c.conversation_type = 'partner_support')
    )
  );

-- 6. Allow messages table select for participants
DROP POLICY IF EXISTS "messages_select_participant" ON public.messages;

CREATE POLICY "messages_select_participant" ON public.messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.participant_a = auth.uid()::text OR c.participant_b = auth.uid()::text
             OR c.conversation_type = 'partner_support')
    )
  );
