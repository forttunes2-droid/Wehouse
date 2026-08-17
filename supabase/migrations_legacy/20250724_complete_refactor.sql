-- ═══════════════════════════════════════════════════════════════
-- WEHOUSE COMPLETE REFACTOR
-- 1. Worker Booking Negotiation Workflow
-- 2. Field Officer Auto-Link Property Partner
-- 3. Property Partner Support Conversation System
-- ═══════════════════════════════════════════════════════════════

-- ================================================================
-- PART 1: WORKER BOOKING NEGOTIATION WORKFLOW
-- ================================================================

-- 1a. Drop existing worker_bookings constraints and recreate with new statuses
ALTER TABLE worker_bookings DROP CONSTRAINT IF EXISTS worker_bookings_status_check;

-- Add booking_conversation_id column to link to booking conversation
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

-- Update status constraint with new negotiation workflow statuses
ALTER TABLE worker_bookings ADD CONSTRAINT worker_bookings_status_check 
  CHECK (status IN (
    'booking_requested',     -- Step 1: Customer clicked Book
    'negotiating',           -- Step 2-3: Both parties chatting, no payment yet
    'waiting_payment',       -- Step 4: Worker accepted, entered price, waiting customer
    'confirmed',             -- Step 5: Customer paid, booking confirmed
    'in_progress',           -- Step 6: Worker performing job
    'completed',             -- Step 7: Worker marked complete, customer confirmed
    'disputed',              -- Step 8: Customer raised dispute
    'cancelled',             -- Booking cancelled by either party
    'refunded'               -- Refund processed after dispute resolution
  ));

-- 1b. Create booking_conversations table (separate from normal chat)
CREATE TABLE IF NOT EXISTS booking_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES worker_bookings(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES profiles(user_id),
  worker_id TEXT NOT NULL REFERENCES profiles(user_id),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(booking_id)
);

CREATE INDEX IF NOT EXISTS idx_booking_conv_user ON booking_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_booking_conv_worker ON booking_conversations(worker_id);
CREATE INDEX IF NOT EXISTS idx_booking_conv_booking ON booking_conversations(booking_id);

ALTER TABLE booking_conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "booking_conv_access" ON booking_conversations;
CREATE POLICY "booking_conv_access" ON booking_conversations
  FOR ALL TO authenticated
  USING (
    user_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
    OR worker_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
    OR EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator'))
  );

-- 1c. Create booking_messages table (separate from normal messages)
CREATE TABLE IF NOT EXISTS booking_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES booking_conversations(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,
  content TEXT NOT NULL,
  attachments TEXT[], -- URLs to attached files
  created_at TIMESTAMPTZ DEFAULT NOW(),
  is_read BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_booking_msg_conv ON booking_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_booking_msg_created ON booking_messages(created_at);

ALTER TABLE booking_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "booking_msg_access" ON booking_messages;
CREATE POLICY "booking_msg_access" ON booking_messages
  FOR ALL TO authenticated
  USING (
    conversation_id IN (
      SELECT id FROM booking_conversations 
      WHERE user_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
         OR worker_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
         OR EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator'))
    )
  );

-- ================================================================
-- PART 2: RPC FUNCTIONS FOR WORKER BOOKING NEGOTIATION
-- ================================================================

-- 2a. Create booking request (Step 1)
DROP FUNCTION IF EXISTS public.create_booking_request(TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT);
CREATE OR REPLACE FUNCTION public.create_booking_request(
  p_user_id TEXT,
  p_worker_id TEXT,
  p_service_type TEXT,
  p_description TEXT,
  p_address TEXT,
  p_scheduled_date DATE,
  p_customer_message TEXT DEFAULT NULL
)
RETURNS TABLE(booking_id UUID, conversation_id UUID, booking_code TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking_id UUID;
  v_conv_id UUID;
  v_code TEXT;
BEGIN
  -- Generate booking code
  v_code := 'WHWB-' || LPAD((SELECT COUNT(*) + 1 FROM worker_bookings)::TEXT, 5, '0');
  
  -- Create booking
  INSERT INTO worker_bookings (
    booking_code, user_id, worker_id, service_type, description, 
    address, scheduled_date, agreed_amount, wehouse_fee, worker_commission, worker_receives,
    status, customer_message, created_at, updated_at
  ) VALUES (
    v_code, p_user_id, p_worker_id, p_service_type, p_description,
    p_address, p_scheduled_date, 0, 300, 0, 0,
    'booking_requested', p_customer_message, NOW(), NOW()
  )
  RETURNING id INTO v_booking_id;
  
  -- Create booking conversation
  INSERT INTO booking_conversations (booking_id, user_id, worker_id, status, created_at, updated_at)
  VALUES (v_booking_id, p_user_id, p_worker_id, 'active', NOW(), NOW())
  RETURNING id INTO v_conv_id;
  
  -- Update booking with conversation ID
  UPDATE worker_bookings SET booking_conversation_id = v_conv_id WHERE id = v_booking_id;
  
  RETURN QUERY SELECT v_booking_id, v_conv_id, v_code;
END;
$$;

-- 2b. Get booking conversations for a user
DROP FUNCTION IF EXISTS public.get_my_booking_conversations(TEXT);
CREATE OR REPLACE FUNCTION public.get_my_booking_conversations(p_user_id TEXT)
RETURNS TABLE(
  conversation_id UUID,
  booking_id UUID,
  booking_code TEXT,
  booking_status TEXT,
  other_person_id TEXT,
  other_person_name TEXT,
  service_type TEXT,
  negotiated_amount DECIMAL,
  last_message TEXT,
  unread_count BIGINT,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    bc.id as conversation_id,
    bc.booking_id,
    wb.booking_code,
    wb.status as booking_status,
    CASE WHEN bc.user_id = p_user_id THEN bc.worker_id ELSE bc.user_id END as other_person_id,
    p.full_name as other_person_name,
    wb.service_type,
    wb.negotiated_amount,
    (SELECT content FROM booking_messages WHERE conversation_id = bc.id ORDER BY created_at DESC LIMIT 1) as last_message,
    (SELECT COUNT(*) FROM booking_messages WHERE conversation_id = bc.id AND is_read = FALSE AND sender_id != p_user_id) as unread_count,
    bc.updated_at
  FROM booking_conversations bc
  INNER JOIN worker_bookings wb ON wb.id = bc.booking_id
  INNER JOIN profiles p ON p.user_id = CASE WHEN bc.user_id = p_user_id THEN bc.worker_id ELSE bc.user_id END
  WHERE bc.user_id = p_user_id OR bc.worker_id = p_user_id
  ORDER BY bc.updated_at DESC;
$$;

-- 2c. Get booking messages
DROP FUNCTION IF EXISTS public.get_booking_messages(UUID);
CREATE OR REPLACE FUNCTION public.get_booking_messages(p_conversation_id UUID)
RETURNS TABLE(
  id UUID,
  sender_id TEXT,
  sender_name TEXT,
  sender_role TEXT,
  content TEXT,
  attachments TEXT[],
  is_read BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    bm.id,
    bm.sender_id,
    p.full_name as sender_name,
    p.role as sender_role,
    bm.content,
    bm.attachments,
    bm.is_read,
    bm.created_at
  FROM booking_messages bm
  INNER JOIN profiles p ON p.user_id = bm.sender_id
  WHERE bm.conversation_id = p_conversation_id
  ORDER BY bm.created_at ASC;
$$;

-- 2d. Send booking message
DROP FUNCTION IF EXISTS public.send_booking_message(UUID, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.send_booking_message(
  p_conversation_id UUID,
  p_sender_id TEXT,
  p_content TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_msg_id UUID;
BEGIN
  INSERT INTO booking_messages (conversation_id, sender_id, content, created_at)
  VALUES (p_conversation_id, p_sender_id, p_content, NOW())
  RETURNING id INTO v_msg_id;
  
  -- Update conversation timestamp
  UPDATE booking_conversations SET updated_at = NOW() WHERE id = p_conversation_id;
  
  RETURN v_msg_id;
END;
$$;

-- 2e. Worker accepts booking with negotiated price (Step 4)
DROP FUNCTION IF EXISTS public.worker_accept_booking(UUID, TEXT, DECIMAL);
CREATE OR REPLACE FUNCTION public.worker_accept_booking(
  p_booking_id UUID,
  p_worker_id TEXT,
  p_negotiated_amount DECIMAL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_commission DECIMAL;
  v_worker_receives DECIMAL;
BEGIN
  -- Calculate commission (12.5%)
  v_commission := p_negotiated_amount * 0.125;
  v_worker_receives := p_negotiated_amount - v_commission;
  
  UPDATE worker_bookings SET
    status = 'waiting_payment',
    negotiated_amount = p_negotiated_amount,
    agreed_amount = p_negotiated_amount,
    worker_commission = v_commission,
    worker_receives = v_worker_receives,
    worker_approved = TRUE,
    updated_at = NOW()
  WHERE id = p_booking_id AND worker_id = p_worker_id AND status = 'negotiating';
  
  RETURN FOUND;
END;
$$;

-- 2f. Customer confirms payment (Step 5)
DROP FUNCTION IF EXISTS public.customer_confirm_payment(UUID, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.customer_confirm_payment(
  p_booking_id UUID,
  p_user_id TEXT,
  p_paystack_ref TEXT,
  p_paystack_tx_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE worker_bookings SET
    status = 'confirmed',
    paystack_reference = p_paystack_ref,
    paystack_transaction_id = p_paystack_tx_id,
    updated_at = NOW()
  WHERE id = p_booking_id AND user_id = p_user_id AND status = 'waiting_payment';
  
  RETURN FOUND;
END;
$$;

-- 2g. Worker marks job as started (Step 6)
DROP FUNCTION IF EXISTS public.worker_start_job(UUID, TEXT);
CREATE OR REPLACE FUNCTION public.worker_start_job(
  p_booking_id UUID,
  p_worker_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE worker_bookings SET
    status = 'in_progress',
    started_at = NOW(),
    updated_at = NOW()
  WHERE id = p_booking_id AND worker_id = p_worker_id AND status = 'confirmed';
  
  RETURN FOUND;
END;
$$;

-- 2h. Worker marks job complete (Step 7)
DROP FUNCTION IF EXISTS public.worker_mark_complete(UUID, TEXT);
CREATE OR REPLACE FUNCTION public.worker_mark_complete(
  p_booking_id UUID,
  p_worker_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE worker_bookings SET
    status = 'completed_pending_approval',
    marked_complete_at = NOW(),
    updated_at = NOW()
  WHERE id = p_booking_id AND worker_id = p_worker_id AND status = 'in_progress';
  
  RETURN FOUND;
END;
$$;

-- 2i. Customer confirms completion and releases escrow (Step 7)
DROP FUNCTION IF EXISTS public.customer_confirm_completion(UUID, TEXT);
CREATE OR REPLACE FUNCTION public.customer_confirm_completion(
  p_booking_id UUID,
  p_user_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE worker_bookings SET
    status = 'approved_released',
    user_approved = TRUE,
    completed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_booking_id AND user_id = p_user_id AND status = 'completed_pending_approval';
  
  RETURN FOUND;
END;
$$;

-- 2j. Customer raises dispute (Step 8)
DROP FUNCTION IF EXISTS public.customer_raise_dispute(UUID, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.customer_raise_dispute(
  p_booking_id UUID,
  p_user_id TEXT,
  p_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE worker_bookings SET
    status = 'disputed',
    dispute_reason = p_reason,
    updated_at = NOW()
  WHERE id = p_booking_id AND user_id = p_user_id;
  
  RETURN FOUND;
END;
$$;

-- 2k. Cancel booking
DROP FUNCTION IF EXISTS public.cancel_booking(UUID, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.cancel_booking(
  p_booking_id UUID,
  p_canceller_id TEXT,
  p_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE worker_bookings SET
    status = 'cancelled',
    cancellation_reason = p_reason,
    updated_at = NOW()
  WHERE id = p_booking_id 
    AND (user_id = p_canceller_id OR worker_id = p_canceller_id)
    AND status IN ('booking_requested', 'negotiating', 'waiting_payment');
  
  RETURN FOUND;
END;
$$;

-- 2l. Get single booking with full details
DROP FUNCTION IF EXISTS public.get_booking_details(UUID);
CREATE OR REPLACE FUNCTION public.get_booking_details(p_booking_id UUID)
RETURNS TABLE(
  id UUID,
  booking_code TEXT,
  user_id TEXT,
  worker_id TEXT,
  service_type TEXT,
  description TEXT,
  address TEXT,
  scheduled_date DATE,
  agreed_amount DECIMAL,
  wehouse_fee DECIMAL,
  worker_commission DECIMAL,
  worker_receives DECIMAL,
  negotiated_amount DECIMAL,
  paystack_reference TEXT,
  status TEXT,
  customer_message TEXT,
  worker_approved BOOLEAN,
  user_approved BOOLEAN,
  dispute_reason TEXT,
  dispute_resolution TEXT,
  cancellation_reason TEXT,
  started_at TIMESTAMPTZ,
  marked_complete_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  booking_conversation_id UUID,
  user_name TEXT,
  worker_name TEXT,
  user_phone TEXT,
  worker_phone TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    wb.id, wb.booking_code, wb.user_id, wb.worker_id, wb.service_type,
    wb.description, wb.address, wb.scheduled_date, wb.agreed_amount,
    wb.wehouse_fee, wb.worker_commission, wb.worker_receives,
    wb.negotiated_amount, wb.paystack_reference, wb.status,
    wb.customer_message, wb.worker_approved, wb.user_approved,
    wb.dispute_reason, wb.dispute_resolution, wb.cancellation_reason,
    wb.started_at, wb.marked_complete_at, wb.completed_at, wb.created_at,
    wb.booking_conversation_id,
    u.full_name as user_name,
    w.full_name as worker_name,
    u.phone as user_phone,
    w.phone as worker_phone
  FROM worker_bookings wb
  INNER JOIN profiles u ON u.user_id = wb.user_id
  INNER JOIN profiles w ON w.user_id = wb.worker_id
  WHERE wb.id = p_booking_id;
$$;

-- ================================================================
-- PART 3: FIELD OFFICER AUTO-LINK PROPERTY PARTNER
-- ================================================================

-- 3a. Update inspection_requests to ensure owner_id is always set
ALTER TABLE inspection_requests 
  ADD COLUMN IF NOT EXISTS partner_id TEXT,
  ADD COLUMN IF NOT EXISTS property_name TEXT,
  ADD COLUMN IF NOT EXISTS rental_mode TEXT DEFAULT 'long_stay';

-- 3b. Update post_property_from_inspection to auto-link partner
DROP FUNCTION IF EXISTS public.post_property_from_inspection(JSONB);
CREATE OR REPLACE FUNCTION public.post_property_from_inspection(p_data JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_listing_id UUID;
  v_inspection RECORD;
BEGIN
  -- Try to find the inspection to get the partner_id
  SELECT * INTO v_inspection 
  FROM inspection_requests 
  WHERE id = (p_data->>'inspection_id')::UUID;
  
  -- If inspection found, auto-link the partner
  IF FOUND AND v_inspection.owner_id IS NOT NULL THEN
    p_data := jsonb_set(p_data, '{partner_id}', to_jsonb(v_inspection.owner_id));
  END IF;

  INSERT INTO public.listings (
    listing_id, title, description, price, currency,
    state, city, address, bedrooms, bathrooms,
    property_type, sub_type, images, contact_phone,
    status, submitted_by_role, owner_id, partner_id,
    availability_status, created_at, updated_at
  ) VALUES (
    COALESCE((p_data->>'listing_id')::UUID, gen_random_uuid()),
    p_data->>'title',
    p_data->>'description',
    (p_data->>'price')::INTEGER,
    'NGN',
    p_data->>'state',
    p_data->>'city',
    p_data->>'address',
    COALESCE((p_data->>'bedrooms')::INTEGER, 1),
    COALESCE((p_data->>'bathrooms')::INTEGER, 1),
    COALESCE(p_data->>'property_type', 'apartment'),
    COALESCE(p_data->>'sub_type', 'short_let'),
    ARRAY(SELECT jsonb_array_elements_text(p_data->'images')),
    p_data->>'contact_phone',
    'pending_approval',
    'staff',
    p_data->>'owner_id',
    COALESCE(NULLIF(p_data->>'partner_id', ''), v_inspection.owner_id),
    'available',
    NOW(),
    NOW()
  )
  RETURNING id INTO v_listing_id;

  -- Update inspection to link back to the listing
  IF (p_data->>'inspection_id') IS NOT NULL THEN
    UPDATE inspection_requests SET listing_created = TRUE WHERE id = (p_data->>'inspection_id')::UUID;
  END IF;

  RETURN v_listing_id;
END;
$$;

-- 3c. Add listing_created flag to inspection_requests
ALTER TABLE inspection_requests 
  ADD COLUMN IF NOT EXISTS listing_created BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS listing_id UUID;

-- ================================================================
-- PART 4: PROPERTY PARTNER SUPPORT CONVERSATION SYSTEM
-- ================================================================

-- 4a. Create partner_support_conversations table
CREATE TABLE IF NOT EXISTS partner_support_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id TEXT NOT NULL REFERENCES profiles(user_id),
  subject TEXT NOT NULL,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'in_progress', 'resolved', 'closed')),
  
  -- Property request info (embedded in conversation)
  property_name TEXT,
  property_address TEXT,
  property_city TEXT,
  property_state TEXT,
  property_type TEXT,       -- house, apartment, hotel
  rental_mode TEXT,         -- long_stay, short_let
  inspection_id UUID,       -- links to inspection request
  listing_id UUID,          -- links to created listing
  
  -- Assignment
  assigned_staff_id TEXT,   -- who is handling this
  assigned_field_officer_id TEXT, -- if field officer assigned
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_partner_conv_partner ON partner_support_conversations(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_conv_status ON partner_support_conversations(status);
CREATE INDEX IF NOT EXISTS idx_partner_conv_staff ON partner_support_conversations(assigned_staff_id);

ALTER TABLE partner_support_conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "partner_conv_access" ON partner_support_conversations;
CREATE POLICY "partner_conv_access" ON partner_support_conversations
  FOR ALL TO authenticated
  USING (
    partner_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
    OR assigned_staff_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
    OR assigned_field_officer_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
    OR EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator'))
  );

-- 4b. Create partner_support_messages table
CREATE TABLE IF NOT EXISTS partner_support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES partner_support_conversations(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,
  sender_role TEXT DEFAULT 'partner' CHECK (sender_role IN ('partner', 'staff', 'field_officer', 'creator', 'system')),
  content TEXT NOT NULL,
  
  -- Attachments
  attachments TEXT[],
  attachment_types TEXT[], -- 'photo', 'video', 'document', 'location'
  
  -- System actions (for timeline)
  action_type TEXT CHECK (action_type IN (
    'message',                    -- Regular message
    'inspection_requested',       -- Partner requested inspection
    'request_received',           -- Staff acknowledged
    'field_officer_assigned',     -- Field officer assigned
    'inspection_scheduled',       -- Inspection date set
    'inspection_completed',       -- Field officer submitted report
    'listing_created',            -- Listing created from inspection
    'listing_published',          -- Listing went live
    'status_change',              -- Status changed
    'attachment_added',           -- File uploaded
    'conversation_closed'         -- Conversation closed
  )),
  action_metadata JSONB,       -- Extra data for actions
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  is_read BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_partner_msg_conv ON partner_support_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_partner_msg_created ON partner_support_messages(created_at);

ALTER TABLE partner_support_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "partner_msg_access" ON partner_support_messages;
CREATE POLICY "partner_msg_access" ON partner_support_messages
  FOR ALL TO authenticated
  USING (
    conversation_id IN (
      SELECT id FROM partner_support_conversations 
      WHERE partner_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
         OR assigned_staff_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
         OR assigned_field_officer_id = (SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text LIMIT 1)
         OR EXISTS (SELECT 1 FROM profiles WHERE auth_id = auth.uid()::text AND role IN ('staff','admin','creator'))
    )
  );

-- ================================================================
-- PART 5: RPC FUNCTIONS FOR PARTNER SUPPORT CONVERSATION
-- ================================================================

-- 5a. Create partner support conversation (from inspection request)
DROP FUNCTION IF EXISTS public.create_partner_support_conversation(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.create_partner_support_conversation(
  p_partner_id TEXT,
  p_subject TEXT,
  p_property_name TEXT,
  p_property_address TEXT,
  p_property_city TEXT,
  p_property_state TEXT,
  p_property_type TEXT DEFAULT 'house',
  p_rental_mode TEXT DEFAULT 'long_stay'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv_id UUID;
BEGIN
  INSERT INTO partner_support_conversations (
    partner_id, subject, status,
    property_name, property_address, property_city, property_state,
    property_type, rental_mode,
    created_at, updated_at
  ) VALUES (
    p_partner_id, p_subject, 'open',
    p_property_name, p_property_address, p_property_city, p_property_state,
    p_property_type, p_rental_mode,
    NOW(), NOW()
  )
  RETURNING id INTO v_conv_id;
  
  -- Add system message: inspection requested
  INSERT INTO partner_support_messages (
    conversation_id, sender_id, sender_role, content,
    action_type, action_metadata, created_at
  ) VALUES (
    v_conv_id, p_partner_id, 'system',
    'Property inspection requested for ' || p_property_name,
    'inspection_requested',
    jsonb_build_object(
      'property_name', p_property_name,
      'property_address', p_property_address,
      'property_type', p_property_type,
      'rental_mode', p_rental_mode
    ),
    NOW()
  );
  
  RETURN v_conv_id;
END;
$$;

-- 5b. Get partner conversations
DROP FUNCTION IF EXISTS public.get_partner_conversations(TEXT);
CREATE OR REPLACE FUNCTION public.get_partner_conversations(p_partner_id TEXT)
RETURNS TABLE(
  conversation_id UUID,
  subject TEXT,
  status TEXT,
  property_name TEXT,
  property_address TEXT,
  rental_mode TEXT,
  assigned_staff_name TEXT,
  assigned_officer_name TEXT,
  last_message TEXT,
  last_message_time TIMESTAMPTZ,
  unread_count BIGINT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    psc.id as conversation_id,
    psc.subject,
    psc.status,
    psc.property_name,
    psc.property_address,
    psc.rental_mode,
    s.full_name as assigned_staff_name,
    o.full_name as assigned_officer_name,
    (SELECT content FROM partner_support_messages WHERE conversation_id = psc.id ORDER BY created_at DESC LIMIT 1) as last_message,
    (SELECT created_at FROM partner_support_messages WHERE conversation_id = psc.id ORDER BY created_at DESC LIMIT 1) as last_message_time,
    (SELECT COUNT(*) FROM partner_support_messages WHERE conversation_id = psc.id AND is_read = FALSE AND sender_role != 'partner') as unread_count,
    psc.created_at
  FROM partner_support_conversations psc
  LEFT JOIN profiles s ON s.user_id = psc.assigned_staff_id
  LEFT JOIN profiles o ON o.user_id = psc.assigned_field_officer_id
  WHERE psc.partner_id = p_partner_id
  ORDER BY psc.updated_at DESC;
$$;

-- 5c. Get staff conversations (for support staff)
DROP FUNCTION IF EXISTS public.get_staff_support_conversations(TEXT);
CREATE OR REPLACE FUNCTION public.get_staff_support_conversations(p_staff_id TEXT)
RETURNS TABLE(
  conversation_id UUID,
  partner_id TEXT,
  partner_name TEXT,
  partner_email TEXT,
  subject TEXT,
  status TEXT,
  property_name TEXT,
  property_address TEXT,
  rental_mode TEXT,
  last_message TEXT,
  last_message_time TIMESTAMPTZ,
  unread_count BIGINT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    psc.id as conversation_id,
    psc.partner_id,
    p.full_name as partner_name,
    p.email as partner_email,
    psc.subject,
    psc.status,
    psc.property_name,
    psc.property_address,
    psc.rental_mode,
    (SELECT content FROM partner_support_messages WHERE conversation_id = psc.id ORDER BY created_at DESC LIMIT 1) as last_message,
    (SELECT created_at FROM partner_support_messages WHERE conversation_id = psc.id ORDER BY created_at DESC LIMIT 1) as last_message_time,
    (SELECT COUNT(*) FROM partner_support_messages WHERE conversation_id = psc.id AND is_read = FALSE AND sender_role = 'partner') as unread_count,
    psc.created_at
  FROM partner_support_conversations psc
  INNER JOIN profiles p ON p.user_id = psc.partner_id
  WHERE psc.assigned_staff_id = p_staff_id
     OR psc.status = 'open'
     OR EXISTS (SELECT 1 FROM profiles WHERE user_id = p_staff_id AND role IN ('admin','creator'))
  ORDER BY psc.updated_at DESC;
$$;

-- 5d. Get partner support messages
DROP FUNCTION IF EXISTS public.get_partner_support_messages(UUID);
CREATE OR REPLACE FUNCTION public.get_partner_support_messages(p_conversation_id UUID)
RETURNS TABLE(
  id UUID,
  sender_id TEXT,
  sender_name TEXT,
  sender_role TEXT,
  content TEXT,
  attachments TEXT[],
  attachment_types TEXT[],
  action_type TEXT,
  action_metadata JSONB,
  is_read BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    psm.id,
    psm.sender_id,
    p.full_name as sender_name,
    psm.sender_role,
    psm.content,
    psm.attachments,
    psm.attachment_types,
    psm.action_type,
    psm.action_metadata,
    psm.is_read,
    psm.created_at
  FROM partner_support_messages psm
  LEFT JOIN profiles p ON p.user_id = psm.sender_id
  WHERE psm.conversation_id = p_conversation_id
  ORDER BY psm.created_at ASC;
$$;

-- 5e. Send partner support message
DROP FUNCTION IF EXISTS public.send_partner_support_message(UUID, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.send_partner_support_message(
  p_conversation_id UUID,
  p_sender_id TEXT,
  p_content TEXT,
  p_sender_role TEXT DEFAULT 'partner'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_msg_id UUID;
BEGIN
  INSERT INTO partner_support_messages (
    conversation_id, sender_id, sender_role, content, created_at
  ) VALUES (
    p_conversation_id, p_sender_id, p_sender_role, p_content, NOW()
  )
  RETURNING id INTO v_msg_id;
  
  UPDATE partner_support_conversations SET updated_at = NOW() WHERE id = p_conversation_id;
  
  RETURN v_msg_id;
END;
$$;

-- 5f. Add system action to conversation (for workflow timeline)
DROP FUNCTION IF EXISTS public.add_conversation_action(UUID, TEXT, TEXT, JSONB);
CREATE OR REPLACE FUNCTION public.add_conversation_action(
  p_conversation_id UUID,
  p_action_type TEXT,
  p_content TEXT,
  p_metadata JSONB DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_msg_id UUID;
  v_conv partner_support_conversations%ROWTYPE;
BEGIN
  SELECT * INTO v_conv FROM partner_support_conversations WHERE id = p_conversation_id;
  
  INSERT INTO partner_support_messages (
    conversation_id, sender_id, sender_role, content,
    action_type, action_metadata, created_at
  ) VALUES (
    p_conversation_id, 
    COALESCE(v_conv.assigned_staff_id, v_conv.partner_id),
    'system',
    p_content,
    p_action_type,
    p_metadata,
    NOW()
  )
  RETURNING id INTO v_msg_id;
  
  -- Update conversation status based on action
  CASE p_action_type
    WHEN 'field_officer_assigned' THEN
      UPDATE partner_support_conversations SET status = 'assigned', assigned_field_officer_id = p_metadata->>'officer_id', updated_at = NOW() WHERE id = p_conversation_id;
    WHEN 'inspection_scheduled' THEN
      UPDATE partner_support_conversations SET status = 'in_progress', updated_at = NOW() WHERE id = p_conversation_id;
    WHEN 'inspection_completed' THEN
      UPDATE partner_support_conversations SET status = 'in_progress', updated_at = NOW() WHERE id = p_conversation_id;
    WHEN 'listing_created' THEN
      UPDATE partner_support_conversations SET listing_id = (p_metadata->>'listing_id')::UUID, updated_at = NOW() WHERE id = p_conversation_id;
    WHEN 'listing_published' THEN
      UPDATE partner_support_conversations SET status = 'resolved', updated_at = NOW() WHERE id = p_conversation_id;
    WHEN 'conversation_closed' THEN
      UPDATE partner_support_conversations SET status = 'closed', closed_at = NOW(), updated_at = NOW() WHERE id = p_conversation_id;
    ELSE
      UPDATE partner_support_conversations SET updated_at = NOW() WHERE id = p_conversation_id;
  END CASE;
  
  RETURN v_msg_id;
END;
$$;

-- 5g. Assign field officer to conversation
DROP FUNCTION IF EXISTS public.assign_field_officer(UUID, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.assign_field_officer(
  p_conversation_id UUID,
  p_staff_id TEXT,
  p_officer_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE partner_support_conversations SET
    assigned_staff_id = p_staff_id,
    assigned_field_officer_id = p_officer_id,
    status = 'assigned',
    updated_at = NOW()
  WHERE id = p_conversation_id;
  
  -- Add system message
  INSERT INTO partner_support_messages (
    conversation_id, sender_id, sender_role, content,
    action_type, action_metadata, created_at
  ) SELECT
    p_conversation_id, p_staff_id, 'system',
    'Field officer assigned to inspect property',
    'field_officer_assigned',
    jsonb_build_object('officer_id', p_officer_id),
    NOW();
  
  RETURN FOUND;
END;
$$;

-- 5h. Mark messages as read
DROP FUNCTION IF EXISTS public.mark_partner_messages_read(UUID, TEXT);
CREATE OR REPLACE FUNCTION public.mark_partner_messages_read(
  p_conversation_id UUID,
  p_reader_role TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE partner_support_messages SET is_read = TRUE
  WHERE conversation_id = p_conversation_id
    AND sender_role != p_reader_role
    AND is_read = FALSE;
END;
$$;

-- Done!
