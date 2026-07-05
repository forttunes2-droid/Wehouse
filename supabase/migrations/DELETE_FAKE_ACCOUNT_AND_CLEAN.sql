-- ═══════════════════════════════════════════════════════════════
-- STEP 1: Delete the artificial wehouse_support account
-- ═══════════════════════════════════════════════════════════════
DELETE FROM profiles WHERE user_id = 'wehouse_support';

-- ═══════════════════════════════════════════════════════════════
-- STEP 2: Recreate admin functions WITHOUT wehouse_support filters
-- These functions count ALL real users (no artificial accounts)
-- ═══════════════════════════════════════════════════════════════

-- Clean admin_get_all_users — no artificial account filter
DROP FUNCTION IF EXISTS public.admin_get_all_users();
CREATE OR REPLACE FUNCTION public.admin_get_all_users()
RETURNS SETOF profiles
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM profiles WHERE deleted_at IS NULL ORDER BY created_at DESC;
$$;

-- Clean admin_get_user_count — creator sees all, admin sees all (no artificial accounts to exclude)
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
  WHERE deleted_at IS NULL;
$$;

-- Clean admin_get_all_workers
DROP FUNCTION IF EXISTS public.admin_get_all_workers();
CREATE OR REPLACE FUNCTION public.admin_get_all_workers()
RETURNS SETOF profiles
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM profiles WHERE role = 'worker' AND deleted_at IS NULL ORDER BY created_at DESC;
$$;

-- Clean admin_get_field_officers
DROP FUNCTION IF EXISTS public.admin_get_field_officers();
CREATE OR REPLACE FUNCTION public.admin_get_field_officers()
RETURNS SETOF profiles
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM profiles WHERE role = 'staff' AND deleted_at IS NULL ORDER BY created_at DESC;
$$;

-- get_staff_rating (kept as-is, just references staff_reviews table)
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

-- ═══════════════════════════════════════════════════════════════
-- STEP 3: Clean worker booking functions
-- ═══════════════════════════════════════════════════════════════

-- create_booking_request
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

-- get_my_booking_conversations
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

-- get_booking_messages
DROP FUNCTION IF EXISTS public.get_booking_messages(UUID);
CREATE OR REPLACE FUNCTION public.get_booking_messages(p_conversation_id UUID)
RETURNS TABLE(id UUID, sender_id TEXT, sender_name TEXT, sender_role TEXT, content TEXT, is_read BOOLEAN, created_at TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT bm.id, bm.sender_id, p.full_name, p.role, bm.content, bm.is_read, bm.created_at
  FROM booking_messages bm INNER JOIN profiles p ON p.user_id = bm.sender_id
  WHERE bm.conversation_id = p_conversation_id ORDER BY bm.created_at ASC;
$$;

-- send_booking_message
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

-- worker_accept_booking
DROP FUNCTION IF EXISTS public.worker_accept_booking(UUID, TEXT, DECIMAL);
CREATE OR REPLACE FUNCTION public.worker_accept_booking(p_booking_id UUID, p_worker_id TEXT, p_negotiated_amount DECIMAL)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE worker_bookings SET status = 'waiting_payment', negotiated_amount = p_negotiated_amount, agreed_amount = p_negotiated_amount, worker_commission = p_negotiated_amount * 0.125, worker_receives = p_negotiated_amount * 0.875, updated_at = NOW()
  WHERE id = p_booking_id AND worker_id = p_worker_id AND status IN ('booking_requested', 'negotiating');
  RETURN FOUND;
END;
$$;

-- worker_start_job
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

-- worker_mark_complete
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

-- customer_confirm_completion
DROP FUNCTION IF EXISTS public.customer_confirm_completion(UUID, TEXT);
CREATE OR REPLACE FUNCTION public.customer_confirm_completion(p_booking_id UUID, p_user_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE worker_bookings SET status = 'approved_released', completed_at = NOW(), updated_at = NOW()
  WHERE id = p_booking_id AND user_id = p_user_id AND status = 'completed_pending_approval';
  RETURN FOUND;
END;
$$;

-- cancel_booking
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

-- get_booking_details
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

-- ═══════════════════════════════════════════════════════════════
-- STEP 4: Admin functions
-- ═══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.admin_suspend_user(TEXT);
CREATE OR REPLACE FUNCTION public.admin_suspend_user(p_target_user_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE profiles SET suspended = true WHERE user_id = p_target_user_id;
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
  UPDATE profiles SET suspended = false WHERE user_id = p_target_user_id;
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
  UPDATE profiles SET banned = true WHERE user_id = p_target_user_id;
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

-- ═══════════════════════════════════════════════════════════════
-- DONE. No artificial accounts. No wehouse_support references.
-- ═══════════════════════════════════════════════════════════════
