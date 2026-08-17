-- ═══════════════════════════════════════════════════════════════
-- FIXES: Support account exclusion, Support Inbox, Notifications
-- ═══════════════════════════════════════════════════════════════

-- 1. FIX: Exclude wehouse_support system account from admin user queries
CREATE OR REPLACE FUNCTION public.admin_get_all_users()
RETURNS SETOF public.profiles
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT * FROM public.profiles 
  WHERE user_id != 'wehouse_support'
  ORDER BY created_at DESC;
$$;

-- 2. FIX: Update user count to exclude system account
CREATE OR REPLACE FUNCTION public.admin_get_user_count()
RETURNS TABLE(total bigint, today bigint)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 
    (SELECT COUNT(*) FROM public.profiles WHERE user_id != 'wehouse_support') as total,
    (SELECT COUNT(*) FROM public.profiles WHERE user_id != 'wehouse_support' AND created_at >= date_trunc('day', now())) as today;
$$;

-- 3. FIX: Get staff list should exclude system account
CREATE OR REPLACE FUNCTION public.admin_get_staff()
RETURNS SETOF public.profiles
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT * FROM public.profiles 
  WHERE role = 'staff' 
    AND user_id != 'wehouse_support'
    AND deleted_at IS NULL
  ORDER BY created_at DESC;
$$;

-- 4. SUPPORT INBOX: Get ALL support conversations (partner_support + partner_inspection + general_support)
--    with partner details for staff viewing
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
  partner_phone TEXT,
  partner_role TEXT
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 
    c.id, c.participant_a, c.participant_b, c.status, c.last_message, 
    c.last_message_at, c.unread_a, c.unread_b, c.created_at, 
    c.conversation_type, c.subject,
    p.full_name as partner_name, 
    p.email as partner_email, 
    p.phone as partner_phone,
    p.role as partner_role
  FROM public.conversations c
  LEFT JOIN public.profiles p ON p.user_id = c.participant_a
  WHERE c.conversation_type IN ('partner_support', 'partner_inspection', 'general_support')
  ORDER BY c.last_message_at DESC NULLS LAST;
$$;

-- 5. NOTIFICATIONS: Create notifications table
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

-- Index for fast unread queries
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications(user_id, is_read, created_at DESC);

-- RLS for notifications: users can only see their own
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid()::text);

CREATE POLICY "notifications_insert_admin" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid()::text IN (
      SELECT user_id FROM public.profiles WHERE role IN ('creator', 'admin', 'creator_admin', 'staff')
    )
  );

CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

-- 6. NOTIFICATION: Function to create notification
CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id TEXT,
  p_type TEXT,
  p_title TEXT,
  p_body TEXT,
  p_data JSONB DEFAULT '{}'
)
RETURNS public.notifications
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_notif public.notifications;
BEGIN
  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (p_user_id, p_type, p_title, p_body, p_data)
  RETURNING * INTO new_notif;
  RETURN new_notif;
END;
$$;

-- 7. NOTIFICATION: Get unread count for a user
CREATE OR REPLACE FUNCTION public.get_unread_notification_count(p_user_id TEXT)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT COUNT(*)::integer FROM public.notifications 
  WHERE user_id = p_user_id AND is_read = FALSE;
$$;

-- 8. NOTIFICATION: Mark all as read for a user
CREATE OR REPLACE FUNCTION public.mark_notifications_read(p_user_id TEXT)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE public.notifications 
  SET is_read = TRUE, read_at = now()
  WHERE user_id = p_user_id AND is_read = FALSE;
$$;

-- 9. NOTIFICATION: Auto-notify on new inspection request
CREATE OR REPLACE FUNCTION public.notify_on_inspection_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  creator_id TEXT;
  admin_ids TEXT[];
BEGIN
  -- Find creator and admins to notify
  SELECT user_id INTO creator_id FROM public.profiles WHERE role = 'creator' LIMIT 1;
  SELECT array_agg(user_id) INTO admin_ids FROM public.profiles WHERE role IN ('admin', 'creator_admin');
  
  -- Notify creator
  IF creator_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (creator_id, 'inspection_requested', 'New Inspection Request', 
      COALESCE(NEW.notes, 'A new inspection has been requested'),
      jsonb_build_object('inspection_id', NEW.id, 'requester_id', NEW.requester_id));
  END IF;
  
  -- Notify admins
  IF admin_ids IS NOT NULL THEN
    FOR i IN 1..array_length(admin_ids, 1) LOOP
      INSERT INTO public.notifications (user_id, type, title, body, data)
      VALUES (admin_ids[i], 'inspection_requested', 'New Inspection Request',
        COALESCE(NEW.notes, 'A new inspection has been requested'),
        jsonb_build_object('inspection_id', NEW.id, 'requester_id', NEW.requester_id));
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$;

-- 10. NOTIFICATION: Auto-notify on new reservation
CREATE OR REPLACE FUNCTION public.notify_on_reservation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  owner_id TEXT;
  listing_title TEXT;
BEGIN
  -- Get listing owner
  SELECT owner_id, title INTO owner_id, listing_title
  FROM public.listings WHERE id = NEW.listing_id;
  
  IF owner_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (owner_id, 'booking_received', 'New Booking Received',
      'Someone booked your property: ' || COALESCE(listing_title, 'Your listing'),
      jsonb_build_object('reservation_id', NEW.id, 'listing_id', NEW.listing_id));
  END IF;
  
  RETURN NEW;
END;
$$;

-- 11. Drop existing triggers if they exist (idempotent)
DROP TRIGGER IF EXISTS trg_notify_inspection ON public.inspection_requests;
DROP TRIGGER IF EXISTS trg_notify_reservation ON public.reservations;

-- 12. Create triggers
CREATE TRIGGER trg_notify_inspection
  AFTER INSERT ON public.inspection_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_inspection_request();

CREATE TRIGGER trg_notify_reservation
  AFTER INSERT ON public.reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_reservation();
