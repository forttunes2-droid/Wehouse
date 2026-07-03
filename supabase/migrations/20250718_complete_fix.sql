-- ═══════════════════════════════════════════════════════════════
-- COMPLETE FIX: Partner names in inbox + all remaining issues
-- ═══════════════════════════════════════════════════════════════

-- 1. DROP old versions first
DROP FUNCTION IF EXISTS public.admin_get_all_support_inbox();
DROP FUNCTION IF EXISTS public.get_inspection_chats();
DROP FUNCTION IF EXISTS public.get_general_support_chats();

-- 2. admin_get_all_support_inbox WITH partner details
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
  subject TEXT,
  partner_name TEXT,
  partner_email TEXT,
  partner_phone TEXT
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 
    c.id, c.participant_a, c.participant_b, c.status, c.last_message, 
    c.last_message_at, c.unread_a, c.unread_b, c.created_at, 
    c.conversation_type, c.subject,
    COALESCE(p.full_name, c.participant_a) as partner_name, 
    p.email as partner_email, 
    p.phone as partner_phone
  FROM public.conversations c
  LEFT JOIN public.profiles p ON p.user_id = c.participant_a
  WHERE c.conversation_type IN ('partner_support', 'partner_inspection', 'general_support')
  ORDER BY c.last_message_at DESC NULLS LAST;
$$;

-- 3. get_inspection_chats WITH partner details
CREATE OR REPLACE FUNCTION public.get_inspection_chats()
RETURNS TABLE(
  id UUID, participant_a TEXT, participant_b TEXT, status TEXT, 
  last_message TEXT, last_message_at TIMESTAMPTZ, unread_a INTEGER, unread_b INTEGER, 
  created_at TIMESTAMPTZ, conversation_type TEXT, subject TEXT,
  partner_name TEXT, partner_email TEXT, partner_phone TEXT
)
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT c.id, c.participant_a, c.participant_b, c.status, c.last_message, 
    c.last_message_at, c.unread_a, c.unread_b, c.created_at, 
    c.conversation_type, c.subject,
    COALESCE(p.full_name, c.participant_a) as partner_name, 
    p.email as partner_email, p.phone as partner_phone
  FROM public.conversations c
  LEFT JOIN public.profiles p ON p.user_id = c.participant_a
  WHERE c.conversation_type = 'partner_inspection'
  ORDER BY c.last_message_at DESC NULLS LAST;
$$;

-- 4. get_general_support_chats WITH partner details  
CREATE OR REPLACE FUNCTION public.get_general_support_chats()
RETURNS TABLE(
  id UUID, participant_a TEXT, participant_b TEXT, status TEXT, 
  last_message TEXT, last_message_at TIMESTAMPTZ, unread_a INTEGER, unread_b INTEGER, 
  created_at TIMESTAMPTZ, conversation_type TEXT, subject TEXT,
  partner_name TEXT, partner_email TEXT, partner_phone TEXT
)
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT c.id, c.participant_a, c.participant_b, c.status, c.last_message, 
    c.last_message_at, c.unread_a, c.unread_b, c.created_at, 
    c.conversation_type, c.subject,
    COALESCE(p.full_name, c.participant_a) as partner_name, 
    p.email as partner_email, p.phone as partner_phone
  FROM public.conversations c
  LEFT JOIN public.profiles p ON p.user_id = c.participant_a
  WHERE c.conversation_type = 'general_support'
  ORDER BY c.last_message_at DESC NULLS LAST;
$$;

-- 5. RPC: Get partner's inspection requests (for showing in chat)
CREATE OR REPLACE FUNCTION public.get_partner_inspection_requests(p_partner_id TEXT)
RETURNS TABLE(
  id UUID,
  property_address TEXT,
  property_type TEXT,
  notes TEXT,
  status TEXT,
  created_at TIMESTAMPTZ,
  field_officer_id TEXT,
  field_officer_name TEXT
)
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT 
    ir.id,
    ir.property_address,
    ir.property_type,
    ir.notes,
    ir.status,
    ir.created_at,
    ir.field_officer_id,
    p.full_name as field_officer_name
  FROM public.inspection_requests ir
  LEFT JOIN public.profiles p ON p.user_id = ir.field_officer_id
  WHERE ir.owner_id = p_partner_id
  ORDER BY ir.created_at DESC;
$$;

-- 6. RPC: Get a single inspection request with full details
CREATE OR REPLACE FUNCTION public.get_inspection_request_detail(p_request_id UUID)
RETURNS TABLE(
  id UUID,
  owner_id TEXT,
  property_address TEXT,
  property_type TEXT,
  notes TEXT,
  status TEXT,
  created_at TIMESTAMPTZ,
  field_officer_id TEXT,
  field_officer_name TEXT,
  partner_name TEXT,
  partner_email TEXT,
  partner_phone TEXT
)
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT 
    ir.id, ir.owner_id, ir.property_address, ir.property_type, ir.notes, ir.status, ir.created_at,
    ir.field_officer_id,
    fo.full_name as field_officer_name,
    p.full_name as partner_name,
    p.email as partner_email,
    p.phone as partner_phone
  FROM public.inspection_requests ir
  LEFT JOIN public.profiles p ON p.user_id = ir.owner_id
  LEFT JOIN public.profiles fo ON fo.user_id = ir.field_officer_id
  WHERE ir.id = p_request_id;
$$;

-- 7. Ensure staff_permissions RLS is correct
ALTER TABLE public.staff_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_permissions_creator_manage" ON public.staff_permissions;
CREATE POLICY "staff_permissions_creator_manage" ON public.staff_permissions
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE auth_id = auth.uid()::text AND role IN ('creator','admin','creator_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE auth_id = auth.uid()::text AND role IN ('creator','admin','creator_admin')));

DROP POLICY IF EXISTS "staff_permissions_view_own" ON public.staff_permissions;
CREATE POLICY "staff_permissions_view_own" ON public.staff_permissions
  FOR SELECT TO authenticated
  USING (staff_id = auth.uid()::text);
