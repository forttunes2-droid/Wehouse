-- ═══════════════════════════════════════════════════════════════
-- MASTER FIX: All remaining issues
-- ═══════════════════════════════════════════════════════════════

-- 1. FIX: admin_get_all_support_inbox — remove profiles JOIN that causes crash
--    Frontend will look up names separately
DROP FUNCTION IF EXISTS public.admin_get_all_support_inbox();

CREATE OR REPLACE FUNCTION public.admin_get_all_support_inbox()
RETURNS TABLE(
  id UUID, 
  participant_a TEXT, 
  participant_b TEXT, 
  status TEXT, 
  last_message TEXT, 
  last_message_at TIMESTAMPTZ, 
  unread_a INTEGER, 
  unread_b INTEGER, 
  created_at TIMESTAMPTZ, 
  conversation_type TEXT, 
  subject TEXT
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 
    c.id, c.participant_a, c.participant_b, c.status, c.last_message, 
    c.last_message_at, c.unread_a, c.unread_b, c.created_at, 
    c.conversation_type, c.subject
  FROM public.conversations c
  WHERE c.conversation_type IN ('partner_support', 'partner_inspection', 'general_support')
  ORDER BY c.last_message_at DESC NULLS LAST;
$$;

-- 2. FIX: get_conversation_messages — ensure UUID cast works
DROP FUNCTION IF EXISTS public.get_conversation_messages(TEXT);

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

-- 3. FIX: send_support_message — ensure UUID cast works
DROP FUNCTION IF EXISTS public.send_support_message(TEXT, TEXT, TEXT);

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

-- 4. FIX: staff_permissions RLS — staff can view own permissions
ALTER TABLE public.staff_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_permissions_creator_manage" ON public.staff_permissions;
CREATE POLICY "staff_permissions_creator_manage" ON public.staff_permissions
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE auth_id = auth.uid()::text AND role IN ('creator','admin','creator_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE auth_id = auth.uid()::text AND role IN ('creator','admin','creator_admin')));

-- Staff can view own: match staff_id (profiles.user_id) via profiles.auth_id → auth.uid()
DROP POLICY IF EXISTS "staff_permissions_view_own" ON public.staff_permissions;
CREATE POLICY "staff_permissions_view_own" ON public.staff_permissions
  FOR SELECT TO authenticated
  USING (staff_id IN (SELECT user_id FROM public.profiles WHERE auth_id = auth.uid()::text));

-- 5. RPC: Get partner's inspection requests
CREATE OR REPLACE FUNCTION public.get_partner_inspection_requests(p_partner_id TEXT)
RETURNS TABLE(
  id UUID,
  property_address TEXT,
  property_type TEXT,
  notes TEXT,
  status TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT 
    ir.id, ir.property_address, ir.property_type, ir.notes, ir.status, ir.created_at
  FROM public.inspection_requests ir
  WHERE ir.owner_id = p_partner_id
  ORDER BY ir.created_at DESC;
$$;

-- 5. RPC: Get inspection request detail
CREATE OR REPLACE FUNCTION public.get_inspection_request_detail(p_request_id UUID)
RETURNS TABLE(
  id UUID, owner_id TEXT, property_address TEXT, property_type TEXT,
  notes TEXT, status TEXT, created_at TIMESTAMPTZ
)
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT id, owner_id, property_address, property_type, notes, status, created_at
  FROM public.inspection_requests
  WHERE id = p_request_id;
$$;
