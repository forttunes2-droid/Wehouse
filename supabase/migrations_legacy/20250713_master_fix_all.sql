-- ═══════════════════════════════════════════════════════════════
-- MASTER FIX: All issues in one SQL — Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- 1. FIX: admin_get_all_users — EXCLUDE wehouse_support system account
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_get_all_users()
RETURNS SETOF public.profiles
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT * FROM public.profiles 
  WHERE user_id != 'wehouse_support'
  ORDER BY created_at DESC;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 2. FIX: admin_get_user_count — EXCLUDE wehouse_support
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_get_user_count()
RETURNS TABLE(total bigint, today bigint)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 
    (SELECT COUNT(*) FROM public.profiles WHERE user_id != 'wehouse_support') as total,
    (SELECT COUNT(*) FROM public.profiles WHERE user_id != 'wehouse_support' AND created_at >= date_trunc('day', now())) as today;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 3. Ensure wehouse_support system profile exists
-- ═══════════════════════════════════════════════════════════════
INSERT INTO profiles (user_id, auth_id, email, username, role, full_name, created_at)
VALUES ('wehouse_support', '00000000-0000-0000-0000-000000000000', 'support@wehouse.com.ng', 'wehousupport', 'staff', 'WeHouse Support', now())
ON CONFLICT (user_id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- 4. Add file columns to messages (if not already added)
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS file_url TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS file_name TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS file_type TEXT;

-- ═══════════════════════════════════════════════════════════════
-- 5. RPC: Start partner INSPECTION chat (violet button)
--    Partner uploads property photos for inspection
-- ═══════════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════════
-- 6. RPC: Start general support chat (users/workers complaints)
-- ═══════════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════════
-- 7. RPC: Get inspection chats (staff view)
-- ═══════════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════════
-- 8. RPC: Get general support chats (staff view)
-- ═══════════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════════
-- 9. RPC: Get ALL support inbox (for Creator Dashboard Support tab)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_get_all_support_inbox()
RETURNS TABLE(id UUID, participant_a TEXT, participant_b TEXT, status TEXT, last_message TEXT, last_message_at TIMESTAMPTZ, unread_a INTEGER, unread_b INTEGER, created_at TIMESTAMPTZ, conversation_type TEXT, subject TEXT, partner_name TEXT, partner_email TEXT, partner_phone TEXT, partner_role TEXT)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT c.id, c.participant_a, c.participant_b, c.status, c.last_message, c.last_message_at, c.unread_a, c.unread_b, c.created_at, c.conversation_type, c.subject, p.full_name as partner_name, p.email as partner_email, p.phone as partner_phone, p.role as partner_role
  FROM public.conversations c
  LEFT JOIN public.profiles p ON p.user_id = c.participant_a
  WHERE c.conversation_type IN ('partner_support', 'partner_inspection', 'general_support')
  ORDER BY c.last_message_at DESC NULLS LAST;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 10. NOTIFICATIONS: Create table (if not exists)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('inspection_requested', 'new_message', 'booking_received', 'property_booked', 'inspection_assigned', 'payment_received')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications(user_id, is_read, created_at DESC);

-- Enable RLS on notifications
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid()::text);

DROP POLICY IF EXISTS "notifications_insert_admin" ON public.notifications;
CREATE POLICY "notifications_insert_admin" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid()::text IN (SELECT user_id FROM public.profiles WHERE role IN ('creator', 'admin', 'creator_admin', 'staff')));

DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE TO authenticated USING (user_id = auth.uid()::text) WITH CHECK (user_id = auth.uid()::text);

-- ═══════════════════════════════════════════════════════════════
-- 11. NOTIFICATION RPCs
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_unread_notification_count(p_user_id TEXT)
RETURNS INTEGER
LANGUAGE sql SECURITY DEFINER
AS $$ SELECT COUNT(*)::integer FROM public.notifications WHERE user_id = p_user_id AND is_read = FALSE; $$;

CREATE OR REPLACE FUNCTION public.mark_notifications_read(p_user_id TEXT)
RETURNS void
LANGUAGE sql SECURITY DEFINER
AS $$ UPDATE public.notifications SET is_read = TRUE, read_at = now() WHERE user_id = p_user_id AND is_read = FALSE; $$;

-- ═══════════════════════════════════════════════════════════════
-- 12. SERVICE CATEGORIES: RLS policies for CRUD
-- ═══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "service_categories_staff_manage" ON service_categories;
CREATE POLICY "service_categories_staff_manage" ON service_categories
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin')));

DROP POLICY IF EXISTS "service_subcategories_staff_manage" ON service_subcategories;
CREATE POLICY "service_subcategories_staff_manage" ON service_subcategories
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator','creator_admin')));

-- ═══════════════════════════════════════════════════════════════
-- 13. RPC: Delete service category (cascades to subcategories)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.delete_service_category(p_category_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$ BEGIN DELETE FROM public.service_subcategories WHERE category_id = p_category_id; DELETE FROM public.service_categories WHERE id = p_category_id; END; $$;

CREATE OR REPLACE FUNCTION public.delete_service_subcategory(p_subcategory_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$ BEGIN DELETE FROM public.service_subcategories WHERE id = p_subcategory_id; END; $$;
