-- ═══════════════════════════════════════════════════════════════
-- FIX ALL REMAINING ISSUES
-- ═══════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- 1. staff_permissions RLS policies (permissions weren't saving!)
-- ═══════════════════════════════════════════════════════════════

-- Enable RLS
ALTER TABLE public.staff_permissions ENABLE ROW LEVEL SECURITY;

-- Creator/Admin can manage all staff permissions
DROP POLICY IF EXISTS "staff_permissions_creator_manage" ON public.staff_permissions;
CREATE POLICY "staff_permissions_creator_manage" ON public.staff_permissions
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE auth_id = auth.uid()::text AND role IN ('creator','admin','creator_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE auth_id = auth.uid()::text AND role IN ('creator','admin','creator_admin')));

-- Staff can view their own permissions
DROP POLICY IF EXISTS "staff_permissions_view_own" ON public.staff_permissions;
CREATE POLICY "staff_permissions_view_own" ON public.staff_permissions
  FOR SELECT TO authenticated
  USING (staff_id = auth.uid()::text);

-- ═══════════════════════════════════════════════════════════════
-- 2. Fix get_conversation_messages — cast text parameter to UUID
-- ═══════════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════════
-- 3. Fix send_support_message — ensure it works with correct types
-- ═══════════════════════════════════════════════════════════════
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
  -- Insert message
  INSERT INTO public.messages (conversation_id, sender_id, content)
  VALUES (p_conversation_id::UUID, p_sender_id, p_content)
  RETURNING * INTO new_msg;

  -- Update conversation last_message and timestamp
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
