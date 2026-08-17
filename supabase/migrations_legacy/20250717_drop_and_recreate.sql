-- Drop existing functions first (required because return type changed)
DROP FUNCTION IF EXISTS public.get_conversation_messages(TEXT);
DROP FUNCTION IF EXISTS public.send_support_message(TEXT, TEXT, TEXT);

-- 1. Get messages in a conversation
CREATE OR REPLACE FUNCTION public.get_conversation_messages(p_conversation_id TEXT)
RETURNS TABLE(
  id UUID,
  conversation_id UUID,
  sender_id TEXT,
  content TEXT,
  seen BOOLEAN,
  created_at TIMESTAMPTZ,
  edited_at TIMESTAMPTZ,
  file_url TEXT,
  file_name TEXT,
  file_type TEXT
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT id, conversation_id, sender_id, content, seen, created_at, edited_at, file_url, file_name, file_type
  FROM public.messages
  WHERE conversation_id = p_conversation_id::UUID
  ORDER BY created_at ASC;
$$;

-- 2. Send a reply in a conversation
CREATE OR REPLACE FUNCTION public.send_support_message(
  p_conversation_id TEXT,
  p_sender_id TEXT,
  p_content TEXT
)
RETURNS public.messages
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_msg public.messages;
  conv_record public.conversations%ROWTYPE;
BEGIN
  INSERT INTO public.messages (conversation_id, sender_id, content)
  VALUES (p_conversation_id::UUID, p_sender_id, p_content)
  RETURNING * INTO new_msg;

  SELECT * INTO conv_record FROM public.conversations WHERE id = p_conversation_id::UUID;

  IF FOUND THEN
    UPDATE public.conversations
    SET last_message = p_content,
        last_message_at = now(),
        unread_a = CASE WHEN conv_record.participant_a = p_sender_id THEN unread_a ELSE unread_a + 1 END,
        unread_b = CASE WHEN conv_record.participant_b = p_sender_id THEN unread_b ELSE unread_b + 1 END
    WHERE id = p_conversation_id::UUID;
  END IF;

  RETURN new_msg;
END;
$$;
