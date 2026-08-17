-- ═══════════════════════════════════════════════════════════════
-- DROP ALL FIRST (required because return types changed)
-- ═══════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.admin_get_all_support_inbox();
DROP FUNCTION IF EXISTS public.get_conversation_messages(TEXT);
DROP FUNCTION IF EXISTS public.send_support_message(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.get_partner_inspection_requests(TEXT);
DROP FUNCTION IF EXISTS public.get_inspection_request_detail(UUID);

-- ═══════════════════════════════════════════════════════════════
-- 1. Support inbox — NO profiles JOIN (avoids column crash)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_get_all_support_inbox()
RETURNS TABLE(
  id UUID, participant_a TEXT, participant_b TEXT, status TEXT,
  last_message TEXT, last_message_at TIMESTAMPTZ,
  unread_a INTEGER, unread_b INTEGER,
  created_at TIMESTAMPTZ, conversation_type TEXT, subject TEXT
)
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT id, participant_a, participant_b, status, last_message,
    last_message_at, unread_a, unread_b, created_at,
    conversation_type, subject
  FROM public.conversations
  WHERE conversation_type IN ('partner_support', 'partner_inspection', 'general_support', 'worker_verification')
  ORDER BY last_message_at DESC NULLS LAST;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 2. Get conversation messages
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_conversation_messages(p_conversation_id TEXT)
RETURNS TABLE(
  id UUID, conversation_id UUID, sender_id TEXT, content TEXT,
  seen BOOLEAN, created_at TIMESTAMPTZ, edited_at TIMESTAMPTZ,
  file_url TEXT, file_name TEXT, file_type TEXT
)
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT id, conversation_id, sender_id, content, seen, created_at, edited_at, file_url, file_name, file_type
  FROM public.messages WHERE conversation_id = p_conversation_id::UUID ORDER BY created_at ASC;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 3. Send support message
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.send_support_message(
  p_conversation_id TEXT, p_sender_id TEXT, p_content TEXT
)
RETURNS public.messages
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE new_msg public.messages; conv_record public.conversations%ROWTYPE;
BEGIN
  INSERT INTO public.messages (conversation_id, sender_id, content)
  VALUES (p_conversation_id::UUID, p_sender_id, p_content) RETURNING * INTO new_msg;
  SELECT * INTO conv_record FROM public.conversations WHERE id = p_conversation_id::UUID;
  IF FOUND THEN
    UPDATE public.conversations SET last_message = p_content, last_message_at = now(),
      unread_a = CASE WHEN conv_record.participant_a = p_sender_id THEN unread_a ELSE unread_a + 1 END,
      unread_b = CASE WHEN conv_record.participant_b = p_sender_id THEN unread_b ELSE unread_b + 1 END
    WHERE id = p_conversation_id::UUID;
  END IF;
  RETURN new_msg;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 4. FIX: Staff permissions RLS — match via profiles table
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE public.staff_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_permissions_creator_manage" ON public.staff_permissions;
CREATE POLICY "staff_permissions_creator_manage" ON public.staff_permissions
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE auth_id = auth.uid()::text AND role IN ('creator','admin','creator_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE auth_id = auth.uid()::text AND role IN ('creator','admin','creator_admin')));

DROP POLICY IF EXISTS "staff_permissions_view_own" ON public.staff_permissions;
CREATE POLICY "staff_permissions_view_own" ON public.staff_permissions
  FOR SELECT TO authenticated
  USING (staff_id IN (SELECT user_id FROM public.profiles WHERE auth_id = auth.uid()::text));

-- ═══════════════════════════════════════════════════════════════
-- 5. Worker verification chat — staff can message workers
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.start_worker_verification_chat(p_worker_id TEXT)
RETURNS public.conversations
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE existing_conv public.conversations; new_conv public.conversations;
BEGIN
  SELECT * INTO existing_conv FROM public.conversations
  WHERE participant_a = p_worker_id AND participant_b = 'wehouse_support'
    AND conversation_type = 'worker_verification' LIMIT 1;
  IF existing_conv.id IS NOT NULL THEN RETURN existing_conv; END IF;
  INSERT INTO public.conversations (participant_a, participant_b, status, conversation_type, subject)
  VALUES (p_worker_id, 'wehouse_support', 'active', 'worker_verification', 'Application Review')
  RETURNING * INTO new_conv;
  RETURN new_conv;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 6. Get worker verification chats (for staff with verification permission)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_worker_verification_chats()
RETURNS TABLE(
  id UUID, participant_a TEXT, participant_b TEXT, status TEXT,
  last_message TEXT, last_message_at TIMESTAMPTZ,
  unread_a INTEGER, unread_b INTEGER,
  created_at TIMESTAMPTZ, conversation_type TEXT, subject TEXT
)
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT id, participant_a, participant_b, status, last_message,
    last_message_at, unread_a, unread_b, created_at,
    conversation_type, subject
  FROM public.conversations
  WHERE conversation_type = 'worker_verification'
  ORDER BY last_message_at DESC NULLS LAST;
$$;
