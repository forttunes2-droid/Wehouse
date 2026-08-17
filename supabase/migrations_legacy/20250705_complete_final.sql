-- ═══════════════════════════════════════════════════════════════
-- WEHOUSE: COMPLETE FINAL SQL
-- Includes: storage buckets + 20 functions + 5 tables + bio fix
-- Run this ENTIRE file in your Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- ================================================================
-- PART 0: STORAGE BUCKETS (fixes "unable to load bucket" errors)
-- ================================================================

-- Create listing-videos bucket for property video uploads
INSERT INTO storage.buckets (id, name, public, avif_autodetection, file_size_limit, allowed_mime_types)
VALUES ('listing-videos', 'listing-videos', true, false, 52428800, ARRAY['video/mp4', 'video/quicktime', 'video/webm'])
ON CONFLICT (id) DO NOTHING;

-- Create worker-files bucket for worker verification videos
INSERT INTO storage.buckets (id, name, public, avif_autodetection, file_size_limit, allowed_mime_types)
VALUES ('worker-files', 'worker-files', true, false, 104857600, ARRAY['video/mp4', 'video/quicktime', 'video/webm', 'image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- Create chat-files bucket for chat attachments
INSERT INTO storage.buckets (id, name, public, avif_autodetection, file_size_limit, allowed_mime_types)
VALUES ('chat-files', 'chat-files', true, false, 26214400, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'audio/mpeg', 'audio/wav', 'application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- Storage policies: allow authenticated users to upload
CREATE POLICY IF NOT EXISTS "listing-videos-public" ON storage.objects
  FOR ALL TO public USING (bucket_id = 'listing-videos') WITH CHECK (bucket_id = 'listing-videos');

CREATE POLICY IF NOT EXISTS "worker-files-public" ON storage.objects
  FOR ALL TO public USING (bucket_id = 'worker-files') WITH CHECK (bucket_id = 'worker-files');

CREATE POLICY IF NOT EXISTS "chat-files-public" ON storage.objects
  FOR ALL TO public USING (bucket_id = 'chat-files') WITH CHECK (bucket_id = 'chat-files');

-- ================================================================
-- PART 1: DATA FIX
-- ================================================================
UPDATE profiles SET bio = '🛠️STATUS:pending🛠️ sunday Joseph' WHERE user_id = 'WHU-5130';

-- ================================================================
-- PART 2: TABLES
-- ================================================================
CREATE TABLE IF NOT EXISTS worker_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_code TEXT,
  user_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  service_type TEXT,
  description TEXT,
  address TEXT,
  scheduled_date DATE,
  agreed_amount DECIMAL(12,2) DEFAULT 0,
  wehouse_fee DECIMAL(12,2) DEFAULT 300,
  worker_commission DECIMAL(12,2) DEFAULT 0,
  worker_receives DECIMAL(12,2) DEFAULT 0,
  negotiated_amount DECIMAL(12,2),
  status TEXT DEFAULT 'booking_requested',
  customer_message TEXT,
  worker_message TEXT,
  worker_approved BOOLEAN DEFAULT FALSE,
  user_approved BOOLEAN DEFAULT FALSE,
  paystack_reference TEXT,
  paystack_transaction_id TEXT,
  dispute_reason TEXT,
  dispute_resolution TEXT,
  cancellation_reason TEXT,
  refund_reason TEXT,
  refund_amount DECIMAL(12,2),
  booking_conversation_id UUID,
  started_at TIMESTAMPTZ,
  marked_complete_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wb_worker ON worker_bookings(worker_id);
CREATE INDEX IF NOT EXISTS idx_wb_user ON worker_bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_wb_status ON worker_bookings(status);

CREATE TABLE IF NOT EXISTS booking_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES worker_bookings(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(booking_id)
);
CREATE INDEX IF NOT EXISTS idx_bc_user ON booking_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_bc_worker ON booking_conversations(worker_id);

CREATE TABLE IF NOT EXISTS booking_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES booking_conversations(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,
  content TEXT NOT NULL,
  attachments TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  is_read BOOLEAN DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_bm_conv ON booking_messages(conversation_id);

CREATE TABLE IF NOT EXISTS partner_support_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'in_progress', 'resolved', 'closed')),
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
CREATE INDEX IF NOT EXISTS idx_psc_partner ON partner_support_conversations(partner_id);
CREATE INDEX IF NOT EXISTS idx_psc_status ON partner_support_conversations(status);

CREATE TABLE IF NOT EXISTS partner_support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES partner_support_conversations(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,
  sender_role TEXT DEFAULT 'partner' CHECK (sender_role IN ('partner', 'staff', 'field_officer', 'creator', 'system')),
  content TEXT NOT NULL,
  attachments TEXT[],
  attachment_types TEXT[],
  action_type TEXT CHECK (action_type IN (
    'message', 'inspection_requested', 'request_received', 'field_officer_assigned',
    'inspection_scheduled', 'inspection_completed', 'listing_created', 'listing_published',
    'status_change', 'attachment_added', 'conversation_closed'
  )),
  action_metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  is_read BOOLEAN DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_psm_conv ON partner_support_messages(conversation_id);

-- ================================================================
-- PART 3: RLS POLICIES
-- ================================================================
ALTER TABLE worker_bookings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wb_all ON worker_bookings;
CREATE POLICY wb_all ON worker_bookings FOR ALL TO authenticated USING (
  user_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
  OR worker_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
  OR EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator'))
);

ALTER TABLE booking_conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bc_all ON booking_conversations;
CREATE POLICY bc_all ON booking_conversations FOR ALL TO authenticated USING (
  user_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
  OR worker_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
  OR EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator'))
);

ALTER TABLE booking_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bm_all ON booking_messages;
CREATE POLICY bm_all ON booking_messages FOR ALL TO authenticated USING (
  conversation_id IN (
    SELECT id FROM booking_conversations
    WHERE user_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
       OR worker_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
       OR EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator'))
  )
);

ALTER TABLE partner_support_conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS psc_all ON partner_support_conversations;
CREATE POLICY psc_all ON partner_support_conversations FOR ALL TO authenticated USING (
  partner_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
  OR assigned_staff_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
  OR assigned_field_officer_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
  OR EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator'))
);

ALTER TABLE partner_support_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS psm_all ON partner_support_messages;
CREATE POLICY psm_all ON partner_support_messages FOR ALL TO authenticated USING (
  conversation_id IN (
    SELECT id FROM partner_support_conversations
    WHERE partner_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
       OR assigned_staff_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
       OR assigned_field_officer_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
       OR EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator'))
  )
);

-- ================================================================
-- PART 4: FIELD OFFICER FUNCTIONS
-- ================================================================
CREATE OR REPLACE FUNCTION public.update_inspection_status(
  p_inspection_id UUID, p_new_status TEXT, p_source TEXT DEFAULT 'user',
  p_report TEXT DEFAULT NULL, p_condition TEXT DEFAULT NULL
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE inspection_requests SET status = p_new_status, notes = COALESCE(p_report, notes), updated_at = NOW(),
    completed_at = CASE WHEN p_new_status = 'completed' THEN NOW() ELSE completed_at END
  WHERE id = p_inspection_id;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.post_property_from_inspection(p_data JSONB)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_listing_id UUID; v_inspection RECORD; v_partner_id TEXT;
BEGIN
  IF (p_data->>'inspection_id') IS NOT NULL THEN
    SELECT * INTO v_inspection FROM inspection_requests WHERE id = (p_data->>'inspection_id')::UUID;
    IF FOUND AND v_inspection.owner_id IS NOT NULL THEN v_partner_id := v_inspection.owner_id; END IF;
  END IF;
  IF v_partner_id IS NULL AND (p_data->>'partner_id') IS NOT NULL THEN v_partner_id := p_data->>'partner_id'; END IF;
  INSERT INTO listings (listing_id, title, description, price, currency, state, city, address, bedrooms, bathrooms, property_type, sub_type, images, contact_phone, status, submitted_by_role, owner_id, partner_id, availability_status, created_at, updated_at)
  VALUES (COALESCE((p_data->>'listing_id')::UUID, gen_random_uuid()), p_data->>'title', p_data->>'description', (p_data->>'price')::INTEGER, 'NGN', p_data->>'state', p_data->>'city', p_data->>'address', COALESCE((p_data->>'bedrooms')::INTEGER, 1), COALESCE((p_data->>'bathrooms')::INTEGER, 1), COALESCE(p_data->>'property_type', 'apartment'), COALESCE(p_data->>'sub_type', 'short_let'), ARRAY(SELECT jsonb_array_elements_text(p_data->'images')), p_data->>'contact_phone', 'pending_approval', 'staff', p_data->>'owner_id', v_partner_id, 'available', NOW(), NOW())
  RETURNING id INTO v_listing_id;
  IF (p_data->>'inspection_id') IS NOT NULL THEN
    UPDATE inspection_requests SET listing_created = TRUE, listing_id = v_listing_id WHERE id = (p_data->>'inspection_id')::UUID;
  END IF;
  RETURN v_listing_id;
END;
$$;

-- ================================================================
-- PART 5: WORKER BOOKING FUNCTIONS (12 functions)
-- ================================================================
CREATE OR REPLACE FUNCTION public.create_booking_request(
  p_user_id TEXT, p_worker_id TEXT, p_service_type TEXT,
  p_description TEXT, p_address TEXT, p_scheduled_date TEXT,
  p_customer_message TEXT DEFAULT NULL
)
RETURNS TABLE(booking_id UUID, conversation_id UUID, booking_code TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_booking_id UUID; v_conv_id UUID; v_code TEXT;
BEGIN
  v_code := 'WHWB-' || LPAD((SELECT COUNT(*) + 1 FROM worker_bookings)::TEXT, 5, '0');
  INSERT INTO worker_bookings (booking_code, user_id, worker_id, service_type, description, address, scheduled_date, agreed_amount, wehouse_fee, worker_commission, worker_receives, status, customer_message, created_at, updated_at)
  VALUES (v_code, p_user_id, p_worker_id, p_service_type, p_description, p_address, p_scheduled_date::DATE, 0, 300, 0, 0, 'booking_requested', p_customer_message, NOW(), NOW())
  RETURNING id INTO v_booking_id;
  INSERT INTO booking_conversations (booking_id, user_id, worker_id, status, created_at, updated_at)
  VALUES (v_booking_id, p_user_id, p_worker_id, 'active', NOW(), NOW())
  RETURNING id INTO v_conv_id;
  UPDATE worker_bookings SET booking_conversation_id = v_conv_id WHERE id = v_booking_id;
  RETURN QUERY SELECT v_booking_id, v_conv_id, v_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_booking_conversations(p_user_id TEXT)
RETURNS TABLE(conversation_id UUID, booking_id UUID, booking_code TEXT, booking_status TEXT, other_person_id TEXT, other_person_name TEXT, service_type TEXT, negotiated_amount DECIMAL, last_message TEXT, unread_count BIGINT, updated_at TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
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

CREATE OR REPLACE FUNCTION public.get_booking_messages(p_conversation_id UUID)
RETURNS TABLE(id UUID, sender_id TEXT, sender_name TEXT, sender_role TEXT, content TEXT, attachments TEXT[], is_read BOOLEAN, created_at TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT bm.id, bm.sender_id, p.full_name, p.role, bm.content, bm.attachments, bm.is_read, bm.created_at
  FROM booking_messages bm INNER JOIN profiles p ON p.user_id = bm.sender_id
  WHERE bm.conversation_id = p_conversation_id ORDER BY bm.created_at ASC;
$$;

CREATE OR REPLACE FUNCTION public.send_booking_message(p_conversation_id UUID, p_sender_id TEXT, p_content TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_msg_id UUID;
BEGIN
  INSERT INTO booking_messages (conversation_id, sender_id, content, created_at) VALUES (p_conversation_id, p_sender_id, p_content, NOW()) RETURNING id INTO v_msg_id;
  UPDATE booking_conversations SET updated_at = NOW() WHERE id = p_conversation_id;
  RETURN v_msg_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.worker_accept_booking(p_booking_id UUID, p_worker_id TEXT, p_negotiated_amount DECIMAL)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE worker_bookings SET status = 'waiting_payment', negotiated_amount = p_negotiated_amount, agreed_amount = p_negotiated_amount, worker_commission = p_negotiated_amount * 0.125, worker_receives = p_negotiated_amount * 0.875, worker_approved = TRUE, updated_at = NOW()
  WHERE id = p_booking_id AND worker_id = p_worker_id AND status IN ('booking_requested', 'negotiating');
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.customer_confirm_payment(p_booking_id UUID, p_user_id TEXT, p_paystack_ref TEXT, p_paystack_tx_id TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE worker_bookings SET status = 'confirmed', paystack_reference = p_paystack_ref, paystack_transaction_id = p_paystack_tx_id, updated_at = NOW()
  WHERE id = p_booking_id AND user_id = p_user_id AND status = 'waiting_payment';
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.worker_start_job(p_booking_id UUID, p_worker_id TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE worker_bookings SET status = 'in_progress', started_at = NOW(), updated_at = NOW()
  WHERE id = p_booking_id AND worker_id = p_worker_id AND status = 'confirmed';
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.worker_mark_complete(p_booking_id UUID, p_worker_id TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE worker_bookings SET status = 'completed_pending_approval', marked_complete_at = NOW(), updated_at = NOW()
  WHERE id = p_booking_id AND worker_id = p_worker_id AND status = 'in_progress';
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.customer_confirm_completion(p_booking_id UUID, p_user_id TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE worker_bookings SET status = 'approved_released', user_approved = TRUE, completed_at = NOW(), updated_at = NOW()
  WHERE id = p_booking_id AND user_id = p_user_id AND status = 'completed_pending_approval';
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.customer_raise_dispute(p_booking_id UUID, p_user_id TEXT, p_reason TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE worker_bookings SET status = 'disputed', dispute_reason = p_reason, updated_at = NOW()
  WHERE id = p_booking_id AND user_id = p_user_id;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_booking(p_booking_id UUID, p_canceller_id TEXT, p_reason TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE worker_bookings SET status = 'cancelled', cancellation_reason = p_reason, updated_at = NOW()
  WHERE id = p_booking_id AND (user_id = p_canceller_id OR worker_id = p_canceller_id) AND status IN ('booking_requested', 'negotiating', 'waiting_payment');
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_booking_details(p_booking_id UUID)
RETURNS TABLE(id UUID, booking_code TEXT, user_id TEXT, worker_id TEXT, service_type TEXT, description TEXT, address TEXT, scheduled_date DATE, agreed_amount DECIMAL, wehouse_fee DECIMAL, worker_commission DECIMAL, worker_receives DECIMAL, negotiated_amount DECIMAL, paystack_reference TEXT, status TEXT, customer_message TEXT, worker_approved BOOLEAN, user_approved BOOLEAN, dispute_reason TEXT, dispute_resolution TEXT, cancellation_reason TEXT, started_at TIMESTAMPTZ, marked_complete_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ, booking_conversation_id UUID, user_name TEXT, worker_name TEXT, user_phone TEXT, worker_phone TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT wb.id, wb.booking_code, wb.user_id, wb.worker_id, wb.service_type, wb.description, wb.address, wb.scheduled_date, wb.agreed_amount, wb.wehouse_fee, wb.worker_commission, wb.worker_receives, wb.negotiated_amount, wb.paystack_reference, wb.status, wb.customer_message, wb.worker_approved, wb.user_approved, wb.dispute_reason, wb.dispute_resolution, wb.cancellation_reason, wb.started_at, wb.marked_complete_at, wb.completed_at, wb.created_at, wb.booking_conversation_id, u.full_name, w.full_name, u.phone, w.phone
  FROM worker_bookings wb INNER JOIN profiles u ON u.user_id = wb.user_id INNER JOIN profiles w ON w.user_id = wb.worker_id
  WHERE wb.id = p_booking_id;
$$;

-- ================================================================
-- PART 6: PARTNER SUPPORT FUNCTIONS (8 functions)
-- ================================================================
CREATE OR REPLACE FUNCTION public.create_partner_support_conversation(
  p_partner_id TEXT, p_subject TEXT, p_property_name TEXT, p_property_address TEXT,
  p_property_city TEXT, p_property_state TEXT, p_property_type TEXT DEFAULT 'house', p_rental_mode TEXT DEFAULT 'long_stay'
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_conv_id UUID;
BEGIN
  INSERT INTO partner_support_conversations (partner_id, subject, status, property_name, property_address, property_city, property_state, property_type, rental_mode, created_at, updated_at)
  VALUES (p_partner_id, p_subject, 'open', p_property_name, p_property_address, p_property_city, p_property_state, p_property_type, p_rental_mode, NOW(), NOW())
  RETURNING id INTO v_conv_id;
  INSERT INTO partner_support_messages (conversation_id, sender_id, sender_role, content, action_type, action_metadata, created_at)
  VALUES (v_conv_id, p_partner_id, 'system', 'Property inspection requested for ' || p_property_name, 'inspection_requested', jsonb_build_object('property_name', p_property_name, 'property_address', p_property_address, 'property_type', p_property_type, 'rental_mode', p_rental_mode), NOW());
  RETURN v_conv_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_partner_conversations(p_partner_id TEXT)
RETURNS TABLE(conversation_id UUID, subject TEXT, status TEXT, property_name TEXT, property_address TEXT, rental_mode TEXT, assigned_staff_name TEXT, assigned_officer_name TEXT, last_message TEXT, last_message_time TIMESTAMPTZ, unread_count BIGINT, created_at TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT psc.id, psc.subject, psc.status, psc.property_name, psc.property_address, psc.rental_mode, s.full_name, o.full_name,
    (SELECT content FROM partner_support_messages WHERE conversation_id = psc.id ORDER BY created_at DESC LIMIT 1),
    (SELECT created_at FROM partner_support_messages WHERE conversation_id = psc.id ORDER BY created_at DESC LIMIT 1),
    (SELECT COUNT(*) FROM partner_support_messages WHERE conversation_id = psc.id AND is_read = FALSE AND sender_role != 'partner'),
    psc.created_at
  FROM partner_support_conversations psc LEFT JOIN profiles s ON s.user_id = psc.assigned_staff_id LEFT JOIN profiles o ON o.user_id = psc.assigned_field_officer_id
  WHERE psc.partner_id = p_partner_id ORDER BY psc.updated_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_staff_support_conversations(p_staff_id TEXT)
RETURNS TABLE(conversation_id UUID, partner_id TEXT, partner_name TEXT, partner_email TEXT, subject TEXT, status TEXT, property_name TEXT, property_address TEXT, rental_mode TEXT, last_message TEXT, last_message_time TIMESTAMPTZ, unread_count BIGINT, created_at TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT psc.id, psc.partner_id, p.full_name, p.email, psc.subject, psc.status, psc.property_name, psc.property_address, psc.rental_mode,
    (SELECT content FROM partner_support_messages WHERE conversation_id = psc.id ORDER BY created_at DESC LIMIT 1),
    (SELECT created_at FROM partner_support_messages WHERE conversation_id = psc.id ORDER BY created_at DESC LIMIT 1),
    (SELECT COUNT(*) FROM partner_support_messages WHERE conversation_id = psc.id AND is_read = FALSE AND sender_role = 'partner'),
    psc.created_at
  FROM partner_support_conversations psc INNER JOIN profiles p ON p.user_id = psc.partner_id
  WHERE psc.assigned_staff_id = p_staff_id OR psc.status = 'open' OR EXISTS (SELECT 1 FROM profiles WHERE user_id = p_staff_id AND role IN ('admin','creator'))
  ORDER BY psc.updated_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_partner_support_messages(p_conversation_id UUID)
RETURNS TABLE(id UUID, sender_id TEXT, sender_name TEXT, sender_role TEXT, content TEXT, attachments TEXT[], attachment_types TEXT[], action_type TEXT, action_metadata JSONB, is_read BOOLEAN, created_at TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT psm.id, psm.sender_id, COALESCE(p.full_name, 'WeHouse'), psm.sender_role, psm.content, psm.attachments, psm.attachment_types, psm.action_type, psm.action_metadata, psm.is_read, psm.created_at
  FROM partner_support_messages psm LEFT JOIN profiles p ON p.user_id = psm.sender_id
  WHERE psm.conversation_id = p_conversation_id ORDER BY psm.created_at ASC;
$$;

CREATE OR REPLACE FUNCTION public.send_partner_support_message(p_conversation_id UUID, p_sender_id TEXT, p_content TEXT, p_sender_role TEXT DEFAULT 'partner')
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_msg_id UUID;
BEGIN
  INSERT INTO partner_support_messages (conversation_id, sender_id, sender_role, content, created_at) VALUES (p_conversation_id, p_sender_id, p_sender_role, p_content, NOW()) RETURNING id INTO v_msg_id;
  UPDATE partner_support_conversations SET updated_at = NOW() WHERE id = p_conversation_id;
  RETURN v_msg_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_field_officer(p_conversation_id UUID, p_staff_id TEXT, p_officer_id TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE partner_support_conversations SET assigned_staff_id = p_staff_id, assigned_field_officer_id = p_officer_id, status = 'assigned', updated_at = NOW() WHERE id = p_conversation_id;
  INSERT INTO partner_support_messages (conversation_id, sender_id, sender_role, content, action_type, action_metadata, created_at)
  SELECT p_conversation_id, p_staff_id, 'system', 'Field officer assigned to inspect property', 'field_officer_assigned', jsonb_build_object('officer_id', p_officer_id), NOW();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_partner_messages_read(p_conversation_id UUID, p_reader_role TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE partner_support_messages SET is_read = TRUE WHERE conversation_id = p_conversation_id AND sender_role != p_reader_role AND is_read = FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_conversation_action(p_conversation_id UUID, p_action_type TEXT, p_content TEXT, p_metadata JSONB DEFAULT '{}')
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_msg_id UUID; v_conv partner_support_conversations%ROWTYPE;
BEGIN
  SELECT * INTO v_conv FROM partner_support_conversations WHERE id = p_conversation_id;
  INSERT INTO partner_support_messages (conversation_id, sender_id, sender_role, content, action_type, action_metadata, created_at)
  VALUES (p_conversation_id, COALESCE(v_conv.assigned_staff_id, v_conv.partner_id), 'system', p_content, p_action_type, p_metadata, NOW()) RETURNING id INTO v_msg_id;
  CASE p_action_type
    WHEN 'field_officer_assigned' THEN UPDATE partner_support_conversations SET status = 'assigned', assigned_field_officer_id = p_metadata->>'officer_id', updated_at = NOW() WHERE id = p_conversation_id;
    WHEN 'inspection_scheduled' THEN UPDATE partner_support_conversations SET status = 'in_progress', updated_at = NOW() WHERE id = p_conversation_id;
    WHEN 'listing_created' THEN UPDATE partner_support_conversations SET listing_id = (p_metadata->>'listing_id')::UUID, updated_at = NOW() WHERE id = p_conversation_id;
    WHEN 'listing_published' THEN UPDATE partner_support_conversations SET status = 'resolved', updated_at = NOW() WHERE id = p_conversation_id;
    WHEN 'conversation_closed' THEN UPDATE partner_support_conversations SET status = 'closed', closed_at = NOW(), updated_at = NOW() WHERE id = p_conversation_id;
    ELSE UPDATE partner_support_conversations SET updated_at = NOW() WHERE id = p_conversation_id;
  END CASE;
  RETURN v_msg_id;
END;
$$;
