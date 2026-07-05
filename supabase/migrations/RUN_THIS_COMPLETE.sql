-- ═══════════════════════════════════════════════════════════════
-- WEHOUSE: COMPLETE SQL — RUN THIS ENTIRE FILE
-- Fixed get_staff_rating (Rating capital R)
-- ═══════════════════════════════════════════════════════════════

-- ============================================================
-- PART 1: STORAGE BUCKETS
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES 
  ('listing-videos', 'listing-videos', true),
  ('worker-files', 'worker-files', true),
  ('chat-files', 'chat-files', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "chat-files-upload" ON storage.objects;
CREATE POLICY "chat-files-upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'chat-files');
DROP POLICY IF EXISTS "chat-files-read" ON storage.objects;
CREATE POLICY "chat-files-read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'chat-files');

-- ============================================================
-- PART 2: TABLES
-- ============================================================
ALTER TABLE worker_bookings 
  ADD COLUMN IF NOT EXISTS booking_conversation_id UUID,
  ADD COLUMN IF NOT EXISTS negotiated_amount DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS customer_message TEXT,
  ADD COLUMN IF NOT EXISTS worker_message TEXT,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS refund_reason TEXT,
  ADD COLUMN IF NOT EXISTS refund_amount DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS marked_complete_at TIMESTAMPTZ;

ALTER TABLE worker_bookings DROP CONSTRAINT IF EXISTS worker_bookings_status_check;
ALTER TABLE worker_bookings ADD CONSTRAINT worker_bookings_status_check 
  CHECK (status IN ('booking_requested','negotiating','waiting_payment','confirmed','in_progress','completed','disputed','cancelled','refunded'));

CREATE TABLE IF NOT EXISTS booking_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES worker_bookings(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES profiles(user_id),
  worker_id TEXT NOT NULL REFERENCES profiles(user_id),
  status TEXT DEFAULT 'active' CHECK (status IN ('active','closed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(booking_id)
);
CREATE INDEX IF NOT EXISTS idx_booking_conv_user ON booking_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_booking_conv_worker ON booking_conversations(worker_id);
CREATE INDEX IF NOT EXISTS idx_booking_conv_booking ON booking_conversations(booking_id);

CREATE TABLE IF NOT EXISTS booking_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES booking_conversations(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,
  content TEXT NOT NULL,
  attachments TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  is_read BOOLEAN DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_booking_msg_conv ON booking_messages(conversation_id);

CREATE TABLE IF NOT EXISTS partner_support_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id TEXT NOT NULL REFERENCES profiles(user_id),
  subject TEXT NOT NULL,
  status TEXT DEFAULT 'open' CHECK (status IN ('open','assigned','in_progress','resolved','closed')),
  property_name TEXT,
  property_address TEXT,
  property_city TEXT,
  property_state TEXT,
  property_type TEXT,
  rental_mode TEXT,
  inspection_id UUID,
  listing_id UUID,
  assigned_staff_id TEXT,
  assigned_field_officer_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_partner_conv_partner ON partner_support_conversations(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_conv_status ON partner_support_conversations(status);

CREATE TABLE IF NOT EXISTS partner_support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES partner_support_conversations(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,
  sender_role TEXT DEFAULT 'partner' CHECK (sender_role IN ('partner','staff','field_officer','creator','system')),
  content TEXT NOT NULL,
  attachments TEXT[],
  attachment_types TEXT[],
  action_type TEXT CHECK (action_type IN ('message','inspection_requested','request_received','field_officer_assigned','inspection_scheduled','inspection_completed','listing_created','listing_published','status_change','attachment_added','conversation_closed')),
  action_metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  is_read BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS role_change_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  user_email TEXT,
  old_role TEXT NOT NULL,
  new_role TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  changed_by_email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id TEXT NOT NULL,
  sender_role TEXT DEFAULT 'admin',
  title TEXT,
  content TEXT NOT NULL,
  target_type TEXT DEFAULT 'broadcast' CHECK (target_type IN ('broadcast','users','workers','partners','staff','select')),
  recipient_count INTEGER DEFAULT 0,
  read_count INTEGER DEFAULT 0,
  scope TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS announcement_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PART 3: ADMIN/CREATOR RPC FUNCTIONS
-- ============================================================
DROP FUNCTION IF EXISTS public.admin_get_all_users();
CREATE OR REPLACE FUNCTION public.admin_get_all_users()
RETURNS SETOF profiles
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM profiles WHERE deleted = false OR deleted IS NULL ORDER BY created_at DESC;
$$;

DROP FUNCTION IF EXISTS public.admin_suspend_user(TEXT);
CREATE OR REPLACE FUNCTION public.admin_suspend_user(p_target_user_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE profiles SET suspended = true, suspended_at = NOW() WHERE user_id = p_target_user_id;
END;
$$;

DROP FUNCTION IF EXISTS public.admin_reactivate_user(TEXT);
CREATE OR REPLACE FUNCTION public.admin_reactivate_user(p_target_user_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE profiles SET suspended = false, suspended_at = null WHERE user_id = p_target_user_id;
END;
$$;

DROP FUNCTION IF EXISTS public.admin_ban_user(TEXT);
CREATE OR REPLACE FUNCTION public.admin_ban_user(p_target_user_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE profiles SET banned = true, banned_at = NOW() WHERE user_id = p_target_user_id;
END;
$$;

DROP FUNCTION IF EXISTS public.admin_update_role(TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.admin_update_role(p_target_user_id TEXT, p_new_role TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE profiles SET role = p_new_role WHERE user_id = p_target_user_id;
END;
$$;

DROP FUNCTION IF EXISTS public.admin_toggle_exempt(TEXT, BOOLEAN);
CREATE OR REPLACE FUNCTION public.admin_toggle_exempt(p_target_user_id TEXT, p_exempt BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE profiles SET maintenance_exempt = p_exempt WHERE user_id = p_target_user_id;
END;
$$;

DROP FUNCTION IF EXISTS public.admin_get_user_count(TEXT);
CREATE OR REPLACE FUNCTION public.admin_get_user_count(p_caller_role TEXT DEFAULT 'admin')
RETURNS TABLE(total BIGINT, today BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COUNT(*)::BIGINT AS total,
    COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::BIGINT AS today
  FROM profiles
  WHERE (deleted = false OR deleted IS NULL)
    AND (p_caller_role = 'creator' OR user_id != 'wehouse_support');
$$;

DROP FUNCTION IF EXISTS public.admin_get_all_workers();
CREATE OR REPLACE FUNCTION public.admin_get_all_workers()
RETURNS SETOF profiles
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM profiles WHERE role = 'worker' AND (deleted = false OR deleted IS NULL) ORDER BY created_at DESC;
$$;

DROP FUNCTION IF EXISTS public.admin_get_field_officers();
CREATE OR REPLACE FUNCTION public.admin_get_field_officers()
RETURNS SETOF profiles
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM profiles WHERE role = 'staff' AND (deleted = false OR deleted IS NULL) ORDER BY created_at DESC;
$$;

DROP FUNCTION IF EXISTS public.admin_get_partner_inspections();
CREATE OR REPLACE FUNCTION public.admin_get_partner_inspections()
RETURNS SETOF inspection_requests
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM inspection_requests ORDER BY created_at DESC;
$$;

DROP FUNCTION IF EXISTS public.admin_get_user_inspections(TEXT);
CREATE OR REPLACE FUNCTION public.admin_get_user_inspections(p_user_id TEXT)
RETURNS SETOF inspection_requests
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM inspection_requests WHERE owner_id = p_user_id OR partner_id = p_user_id ORDER BY created_at DESC;
$$;

-- FIXED: "Rating" with capital R
DROP FUNCTION IF EXISTS public.get_staff_rating(TEXT);
CREATE OR REPLACE FUNCTION public.get_staff_rating(p_staff_user_id TEXT)
RETURNS TABLE(avg_rating NUMERIC, review_count BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(AVG("Rating"), 0)::NUMERIC, COUNT(*)::BIGINT 
  FROM staff_reviews WHERE staff_id = p_staff_user_id;
$$;

-- ============================================================
-- PART 4: WORKER BOOKING FUNCTIONS
-- ============================================================
DROP FUNCTION IF EXISTS public.create_booking_request(TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT);
CREATE OR REPLACE FUNCTION public.create_booking_request(
  p_user_id TEXT, p_worker_id TEXT, p_service_type TEXT, p_description TEXT,
  p_address TEXT, p_scheduled_date DATE, p_customer_message TEXT DEFAULT NULL
)
RETURNS TABLE(booking_id UUID, conversation_id UUID, booking_code TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking_id UUID; v_conv_id UUID; v_code TEXT;
BEGIN
  v_code := 'WHWB-' || LPAD((SELECT COUNT(*) + 1 FROM worker_bookings)::TEXT, 5, '0');
  INSERT INTO worker_bookings (booking_code, user_id, worker_id, service_type, description, address, scheduled_date, agreed_amount, wehouse_fee, worker_commission, worker_receives, status, customer_message, created_at, updated_at)
  VALUES (v_code, p_user_id, p_worker_id, p_service_type, p_description, p_address, p_scheduled_date, 0, 300, 0, 0, 'booking_requested', p_customer_message, NOW(), NOW())
  RETURNING id INTO v_booking_id;
  INSERT INTO booking_conversations (booking_id, user_id, worker_id, status, created_at, updated_at)
  VALUES (v_booking_id, p_user_id, p_worker_id, 'active', NOW(), NOW())
  RETURNING id INTO v_conv_id;
  RETURN QUERY SELECT v_booking_id, v_conv_id, v_code;
END;
$$;

DROP FUNCTION IF EXISTS public.get_my_booking_conversations(TEXT);
CREATE OR REPLACE FUNCTION public.get_my_booking_conversations(p_user_id TEXT)
RETURNS TABLE(conversation_id UUID, booking_id UUID, booking_code TEXT, booking_status TEXT, other_person_id TEXT, other_person_name TEXT, service_type TEXT, negotiated_amount DECIMAL, last_message TEXT, unread_count BIGINT, updated_at TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT bc.id, bc.booking_id, wb.booking_code, wb.status,
    CASE WHEN bc.user_id = p_user_id THEN bc.worker_id ELSE bc.user_id END,
    p.full_name, wb.service_type, wb.negotiated_amount,
    (SELECT content FROM booking_messages WHERE conversation_id = bc.id ORDER BY created_at DESC LIMIT 1),
    (SELECT COUNT(*) FROM booking_messages WHERE conversation_id = bc.id AND is_read = FALSE AND sender_id != p_user_id),
    bc.updated_at
  FROM booking_conversations bc
  INNER JOIN worker_bookings wb ON wb.id = bc.booking_id
  INNER JOIN profiles p ON p.user_id = CASE WHEN bc.user_id = p_user_id THEN bc.worker_id ELSE bc.user_id END
  WHERE bc.user_id = p_user_id OR bc.worker_id = p_user_id
  ORDER BY bc.updated_at DESC;
$$;

DROP FUNCTION IF EXISTS public.get_booking_messages(UUID);
CREATE OR REPLACE FUNCTION public.get_booking_messages(p_conversation_id UUID)
RETURNS TABLE(id UUID, sender_id TEXT, sender_name TEXT, sender_role TEXT, content TEXT, attachments TEXT[], is_read BOOLEAN, created_at TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT bm.id, bm.sender_id, p.full_name, p.role, bm.content, bm.attachments, bm.is_read, bm.created_at
  FROM booking_messages bm INNER JOIN profiles p ON p.user_id = bm.sender_id
  WHERE bm.conversation_id = p_conversation_id ORDER BY bm.created_at ASC;
$$;

DROP FUNCTION IF EXISTS public.send_booking_message(UUID, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.send_booking_message(p_conversation_id UUID, p_sender_id TEXT, p_content TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_msg_id UUID;
BEGIN
  INSERT INTO booking_messages (conversation_id, sender_id, content, created_at)
  VALUES (p_conversation_id, p_sender_id, p_content, NOW()) RETURNING id INTO v_msg_id;
  UPDATE booking_conversations SET updated_at = NOW() WHERE id = p_conversation_id;
  RETURN v_msg_id;
END;
$$;

DROP FUNCTION IF EXISTS public.worker_accept_booking(UUID, TEXT, DECIMAL);
CREATE OR REPLACE FUNCTION public.worker_accept_booking(p_booking_id UUID, p_worker_id TEXT, p_negotiated_amount DECIMAL)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_commission DECIMAL; v_worker_receives DECIMAL;
BEGIN
  v_commission := p_negotiated_amount * 0.125;
  v_worker_receives := p_negotiated_amount - v_commission;
  UPDATE worker_bookings SET status = 'waiting_payment', negotiated_amount = p_negotiated_amount, agreed_amount = p_negotiated_amount, worker_commission = v_commission, worker_receives = v_worker_receives, updated_at = NOW()
  WHERE id = p_booking_id AND worker_id = p_worker_id AND status IN ('booking_requested', 'negotiating');
  RETURN FOUND;
END;
$$;

DROP FUNCTION IF EXISTS public.worker_start_job(UUID, TEXT);
CREATE OR REPLACE FUNCTION public.worker_start_job(p_booking_id UUID, p_worker_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE worker_bookings SET status = 'in_progress', started_at = NOW(), updated_at = NOW()
  WHERE id = p_booking_id AND worker_id = p_worker_id AND status = 'confirmed';
  RETURN FOUND;
END;
$$;

DROP FUNCTION IF EXISTS public.worker_mark_complete(UUID, TEXT);
CREATE OR REPLACE FUNCTION public.worker_mark_complete(p_booking_id UUID, p_worker_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE worker_bookings SET status = 'completed_pending_approval', marked_complete_at = NOW(), updated_at = NOW()
  WHERE id = p_booking_id AND worker_id = p_worker_id AND status = 'in_progress';
  RETURN FOUND;
END;
$$;

DROP FUNCTION IF EXISTS public.customer_confirm_completion(UUID, TEXT);
CREATE OR REPLACE FUNCTION public.customer_confirm_completion(p_booking_id UUID, p_user_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE worker_bookings SET status = 'approved_released', user_approved = TRUE, completed_at = NOW(), updated_at = NOW()
  WHERE id = p_booking_id AND user_id = p_user_id AND status = 'completed_pending_approval';
  RETURN FOUND;
END;
$$;

DROP FUNCTION IF EXISTS public.customer_raise_dispute(UUID, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.customer_raise_dispute(p_booking_id UUID, p_user_id TEXT, p_reason TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE worker_bookings SET status = 'disputed', dispute_reason = p_reason, updated_at = NOW()
  WHERE id = p_booking_id AND user_id = p_user_id;
  RETURN FOUND;
END;
$$;

DROP FUNCTION IF EXISTS public.cancel_booking(UUID, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.cancel_booking(p_booking_id UUID, p_canceller_id TEXT, p_reason TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE worker_bookings SET status = 'cancelled', cancellation_reason = p_reason, updated_at = NOW()
  WHERE id = p_booking_id AND (user_id = p_canceller_id OR worker_id = p_canceller_id) AND status IN ('booking_requested','negotiating','waiting_payment');
  RETURN FOUND;
END;
$$;

DROP FUNCTION IF EXISTS public.get_booking_details(UUID);
CREATE OR REPLACE FUNCTION public.get_booking_details(p_booking_id UUID)
RETURNS TABLE(id UUID, booking_code TEXT, user_id TEXT, worker_id TEXT, service_type TEXT, description TEXT, address TEXT, scheduled_date DATE, agreed_amount DECIMAL, wehouse_fee DECIMAL, worker_commission DECIMAL, worker_receives DECIMAL, negotiated_amount DECIMAL, status TEXT, customer_message TEXT, cancellation_reason TEXT, started_at TIMESTAMPTZ, marked_complete_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ, booking_conversation_id UUID, user_name TEXT, worker_name TEXT, user_phone TEXT, worker_phone TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT wb.id, wb.booking_code, wb.user_id, wb.worker_id, wb.service_type, wb.description, wb.address, wb.scheduled_date, wb.agreed_amount, wb.wehouse_fee, wb.worker_commission, wb.worker_receives, wb.negotiated_amount, wb.status, wb.customer_message, wb.cancellation_reason, wb.started_at, wb.marked_complete_at, wb.completed_at, wb.created_at, wb.booking_conversation_id, u.full_name, w.full_name, u.phone, w.phone
  FROM worker_bookings wb INNER JOIN profiles u ON u.user_id = wb.user_id INNER JOIN profiles w ON w.user_id = wb.worker_id
  WHERE wb.id = p_booking_id;
$$;

-- ============================================================
-- PART 5: PARTNER SUPPORT FUNCTIONS
-- ============================================================
DROP FUNCTION IF EXISTS public.create_partner_support_conversation(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.create_partner_support_conversation(p_partner_id TEXT, p_subject TEXT, p_property_name TEXT, p_property_address TEXT, p_property_city TEXT, p_property_state TEXT, p_property_type TEXT DEFAULT 'house', p_rental_mode TEXT DEFAULT 'long_stay')
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_conv_id UUID;
BEGIN
  INSERT INTO partner_support_conversations (partner_id, subject, status, property_name, property_address, property_city, property_state, property_type, rental_mode, created_at, updated_at)
  VALUES (p_partner_id, p_subject, 'open', p_property_name, p_property_address, p_property_city, p_property_state, p_property_type, p_rental_mode, NOW(), NOW())
  RETURNING id INTO v_conv_id;
  RETURN v_conv_id;
END;
$$;

DROP FUNCTION IF EXISTS public.get_partner_conversations(TEXT);
CREATE OR REPLACE FUNCTION public.get_partner_conversations(p_partner_id TEXT)
RETURNS TABLE(conversation_id UUID, subject TEXT, status TEXT, property_name TEXT, property_address TEXT, rental_mode TEXT, assigned_staff_name TEXT, assigned_officer_name TEXT, last_message TEXT, last_message_time TIMESTAMPTZ, unread_count BIGINT, created_at TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT psc.id, psc.subject, psc.status, psc.property_name, psc.property_address, psc.rental_mode, s.full_name, o.full_name,
    (SELECT content FROM partner_support_messages WHERE conversation_id = psc.id ORDER BY created_at DESC LIMIT 1),
    (SELECT created_at FROM partner_support_messages WHERE conversation_id = psc.id ORDER BY created_at DESC LIMIT 1),
    (SELECT COUNT(*) FROM partner_support_messages WHERE conversation_id = psc.id AND is_read = FALSE AND sender_role != 'partner'),
    psc.created_at
  FROM partner_support_conversations psc LEFT JOIN profiles s ON s.user_id = psc.assigned_staff_id LEFT JOIN profiles o ON o.user_id = psc.assigned_field_officer_id
  WHERE psc.partner_id = p_partner_id ORDER BY psc.updated_at DESC;
$$;

DROP FUNCTION IF EXISTS public.get_staff_support_conversations(TEXT);
CREATE OR REPLACE FUNCTION public.get_staff_support_conversations(p_staff_id TEXT)
RETURNS TABLE(conversation_id UUID, partner_id TEXT, partner_name TEXT, partner_email TEXT, subject TEXT, status TEXT, property_name TEXT, property_address TEXT, rental_mode TEXT, last_message TEXT, last_message_time TIMESTAMPTZ, unread_count BIGINT, created_at TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT psc.id, psc.partner_id, p.full_name, p.email, psc.subject, psc.status, psc.property_name, psc.property_address, psc.rental_mode,
    (SELECT content FROM partner_support_messages WHERE conversation_id = psc.id ORDER BY created_at DESC LIMIT 1),
    (SELECT created_at FROM partner_support_messages WHERE conversation_id = psc.id ORDER BY created_at DESC LIMIT 1),
    (SELECT COUNT(*) FROM partner_support_messages WHERE conversation_id = psc.id AND is_read = FALSE AND sender_role = 'partner'),
    psc.created_at
  FROM partner_support_conversations psc INNER JOIN profiles p ON p.user_id = psc.partner_id
  WHERE psc.assigned_staff_id = p_staff_id OR psc.status = 'open'
  ORDER BY psc.updated_at DESC;
$$;

DROP FUNCTION IF EXISTS public.get_partner_support_messages(UUID);
CREATE OR REPLACE FUNCTION public.get_partner_support_messages(p_conversation_id UUID)
RETURNS TABLE(id UUID, sender_id TEXT, sender_name TEXT, sender_role TEXT, content TEXT, attachments TEXT[], attachment_types TEXT[], action_type TEXT, action_metadata JSONB, is_read BOOLEAN, created_at TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT psm.id, psm.sender_id, p.full_name, psm.sender_role, psm.content, psm.attachments, psm.attachment_types, psm.action_type, psm.action_metadata, psm.is_read, psm.created_at
  FROM partner_support_messages psm LEFT JOIN profiles p ON p.user_id = psm.sender_id
  WHERE psm.conversation_id = p_conversation_id ORDER BY psm.created_at ASC;
$$;

DROP FUNCTION IF EXISTS public.send_partner_support_message(UUID, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.send_partner_support_message(p_conversation_id UUID, p_sender_id TEXT, p_content TEXT, p_sender_role TEXT DEFAULT 'partner')
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_msg_id UUID;
BEGIN
  INSERT INTO partner_support_messages (conversation_id, sender_id, sender_role, content, created_at)
  VALUES (p_conversation_id, p_sender_id, p_sender_role, p_content, NOW()) RETURNING id INTO v_msg_id;
  UPDATE partner_support_conversations SET updated_at = NOW() WHERE id = p_conversation_id;
  RETURN v_msg_id;
END;
$$;

DROP FUNCTION IF EXISTS public.add_conversation_action(UUID, TEXT, TEXT, JSONB);
CREATE OR REPLACE FUNCTION public.add_conversation_action(p_conversation_id UUID, p_action_type TEXT, p_content TEXT, p_metadata JSONB DEFAULT '{}')
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_msg_id UUID;
BEGIN
  INSERT INTO partner_support_messages (conversation_id, sender_id, sender_role, content, action_type, action_metadata, created_at)
  VALUES (p_conversation_id, 'system', 'system', p_content, p_action_type, p_metadata, NOW()) RETURNING id INTO v_msg_id;
  RETURN v_msg_id;
END;
$$;

DROP FUNCTION IF EXISTS public.assign_field_officer(UUID, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.assign_field_officer(p_conversation_id UUID, p_staff_id TEXT, p_officer_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE partner_support_conversations SET assigned_staff_id = p_staff_id, assigned_field_officer_id = p_officer_id, status = 'assigned', updated_at = NOW() WHERE id = p_conversation_id;
  RETURN FOUND;
END;
$$;

DROP FUNCTION IF EXISTS public.mark_partner_messages_read(UUID, TEXT);
CREATE OR REPLACE FUNCTION public.mark_partner_messages_read(p_conversation_id UUID, p_reader_role TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE partner_support_messages SET is_read = TRUE WHERE conversation_id = p_conversation_id AND sender_role != p_reader_role AND is_read = FALSE;
END;
$$;

-- ============================================================
-- PART 6: HELPER FUNCTIONS
-- ============================================================
DROP FUNCTION IF EXISTS public.worker_update_profile(TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.worker_update_profile(p_user_id TEXT, p_occupation TEXT, p_price TEXT, p_skills TEXT[], p_bio TEXT, p_status TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE profiles SET worker_occupation = p_occupation, worker_price = p_price, worker_skills = p_skills, worker_bio = p_bio, worker_status = COALESCE(p_status, worker_status) WHERE user_id = p_user_id;
END;
$$;

DROP FUNCTION IF EXISTS public.update_inspection_status(UUID, TEXT);
CREATE OR REPLACE FUNCTION public.update_inspection_status(p_inspection_id UUID, p_status TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE inspection_requests SET status = p_status WHERE id = p_inspection_id;
END;
$$;

DROP FUNCTION IF EXISTS public.credit_wallet(TEXT, DECIMAL, TEXT);
CREATE OR REPLACE FUNCTION public.credit_wallet(p_user_id TEXT, p_amount DECIMAL, p_description TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO wallet_transactions (user_id, amount, type, description, created_at) VALUES (p_user_id, p_amount, 'credit', p_description, NOW());
END;
$$;

DROP FUNCTION IF EXISTS public.release_escrow(UUID);
CREATE OR REPLACE FUNCTION public.release_escrow(p_booking_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE escrow_transactions SET status = 'released', released_at = NOW() WHERE booking_id = p_booking_id;
END;
$$;

DROP FUNCTION IF EXISTS public.refund_escrow(UUID);
CREATE OR REPLACE FUNCTION public.refund_escrow(p_booking_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE escrow_transactions SET status = 'refunded', refunded_at = NOW() WHERE booking_id = p_booking_id;
END;
$$;

-- ============================================================
-- PART 7: WORKER STATUS EXPANSION
-- ============================================================
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_worker_status_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_worker_status_check
CHECK (worker_status IN ('pending', 'approved_for_verification', 'reviewing', 'verified', 'suspended', 'rejected'));

-- ============================================================
-- DONE! All functions created. Refresh the app.
-- ============================================================
