-- ============================================================================
-- WORKER WORKFLOW PHASE — Canonical Statuses, Public Discovery, Booking Security
-- Date: 2026-08-08
-- Purpose:
--   1. Add `available` column to profiles (worker toggle for accepting bookings)
--   2. Normalize worker_status values: migrate legacy to canonical
--   3. Harden send_booking_message: derive sender from auth.uid(), not client param
--   4. Create public_workers view for safe public discovery
--   5. Fix worker_accept_booking: single overload, harden auth
--   6. Add customer_confirm_completion and customer_raise_dispute if missing
--   7. Fix commission calculation: server-side only
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ADD available COLUMN TO profiles
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS available BOOLEAN NOT NULL DEFAULT TRUE;

-- Index for fast public worker discovery
CREATE INDEX IF NOT EXISTS idx_profiles_available_worker
  ON public.profiles(available, worker_status, worker_verified)
  WHERE role = 'worker';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. NORMALIZE EXISTING worker_status VALUES
--    approved_for_verification → verification_paid
--    declined → rejected
--    approved → pending (legacy pre-verification)
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.profiles
SET worker_status = 'verification_paid'
WHERE worker_status = 'approved_for_verification';

UPDATE public.profiles
SET worker_status = 'rejected'
WHERE worker_status = 'declined';

UPDATE public.profiles
SET worker_status = 'pending'
WHERE worker_status = 'approved';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. CREATE public_workers VIEW — safe public discovery
--    Only shows verified + available + non-suspended + non-banned + non-deleted
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.public_workers AS
SELECT
  p.user_id,
  p.username,
  p.full_name,
  p.avatar_url,
  p.worker_occupation,
  p.worker_skills,
  p.worker_price,
  p.worker_bio,
  p.bio,
  p.state,
  p.city,
  p.local_government,
  p.area,
  p.rating,
  p.review_count,
  p.worker_verified,
  p.available,
  p.created_at
FROM public.profiles p
WHERE p.role = 'worker'
  AND p.worker_status = 'verified'
  AND p.worker_verified = TRUE
  AND p.available = TRUE
  AND p.deleted = FALSE
  AND p.suspended = FALSE
  AND p.banned = FALSE;

-- Grant SELECT on the view to authenticated and anon
GRANT SELECT ON public.public_workers TO authenticated;
GRANT SELECT ON public.public_workers TO anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. HARDEN send_booking_message — derive sender from auth, not client param
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.send_booking_message(
  p_conversation_id UUID,
  p_sender_id TEXT,        -- kept for UI convenience, but NOT trusted for auth
  p_content TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_msg_id UUID;
  v_auth_id TEXT;
  v_derived_sender_id TEXT;
  v_conv_user_id TEXT;
  v_conv_worker_id TEXT;
BEGIN
  -- Derive the real sender from the authenticated session
  v_auth_id := auth.uid()::text;

  -- Look up the caller's WeHouse user_id from their auth_id
  SELECT user_id INTO v_derived_sender_id
  FROM public.profiles
  WHERE auth_id = v_auth_id;

  IF v_derived_sender_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated user has no WeHouse profile';
  END IF;

  -- Fetch conversation participants to verify membership
  SELECT user_id, worker_id
  INTO v_conv_user_id, v_conv_worker_id
  FROM public.worker_bookings
  WHERE booking_conversation_id = p_conversation_id;

  -- Reject if caller is not a participant in this conversation
  IF v_derived_sender_id NOT IN (v_conv_user_id, v_conv_worker_id) THEN
    RAISE EXCEPTION 'Sender is not a participant in this booking conversation';
  END IF;

  -- Insert message with the DERIVED sender (ignore client-supplied p_sender_id)
  INSERT INTO booking_messages (conversation_id, sender_id, content, created_at)
  VALUES (p_conversation_id, v_derived_sender_id, p_content, NOW())
  RETURNING id INTO v_msg_id;

  UPDATE booking_conversations SET updated_at = NOW() WHERE id = p_conversation_id;

  RETURN v_msg_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. FIX worker_accept_booking — single overload, hardened auth
-- ─────────────────────────────────────────────────────────────────────────────

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
  v_auth_worker_id TEXT;
BEGIN
  -- Derive caller's worker identity from auth session
  SELECT user_id INTO v_auth_worker_id
  FROM public.profiles
  WHERE auth_id = auth.uid()::text AND role = 'worker';

  IF v_auth_worker_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated user is not a worker';
  END IF;

  -- Verify the caller is the assigned worker for this booking
  IF v_auth_worker_id != p_worker_id THEN
    RAISE EXCEPTION 'Worker ID mismatch: you are not the assigned worker for this booking';
  END IF;

  -- Commission: 12.5% to WeHouse (server-side calculation, NOT client-supplied)
  v_commission := p_negotiated_amount * 0.125;
  v_worker_receives := p_negotiated_amount - v_commission;

  UPDATE public.worker_bookings SET
    status = 'waiting_payment',
    negotiated_amount = p_negotiated_amount,
    agreed_amount = p_negotiated_amount,
    wehouse_fee = v_commission,
    worker_commission = v_commission,
    worker_receives = v_worker_receives,
    worker_approved = TRUE,
    updated_at = NOW()
  WHERE id = p_booking_id
    AND worker_id = p_worker_id
    AND status IN ('booking_requested', 'negotiating');

  RETURN FOUND;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. ENSURE customer_confirm_completion EXISTS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.customer_confirm_completion(
  p_booking_id UUID,
  p_user_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_user_id TEXT;
BEGIN
  -- Derive caller identity from auth session
  SELECT user_id INTO v_auth_user_id
  FROM public.profiles
  WHERE auth_id = auth.uid()::text;

  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated user has no WeHouse profile';
  END IF;

  -- Verify caller is the booking customer
  IF v_auth_user_id != p_user_id THEN
    RAISE EXCEPTION 'User ID mismatch: you are not the customer for this booking';
  END IF;

  UPDATE public.worker_bookings SET
    status = 'approved_released',
    user_approved = TRUE,
    completed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_booking_id
    AND user_id = p_user_id
    AND status = 'completed_pending_approval';

  RETURN FOUND;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. ENSURE customer_raise_dispute EXISTS
-- ─────────────────────────────────────────────────────────────────────────────

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
DECLARE
  v_auth_user_id TEXT;
BEGIN
  -- Derive caller identity from auth session
  SELECT user_id INTO v_auth_user_id
  FROM public.profiles
  WHERE auth_id = auth.uid()::text;

  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated user has no WeHouse profile';
  END IF;

  -- Verify caller is the booking customer
  IF v_auth_user_id != p_user_id THEN
    RAISE EXCEPTION 'User ID mismatch: you are not the customer for this booking';
  END IF;

  UPDATE public.worker_bookings SET
    status = 'disputed',
    dispute_reason = p_reason,
    updated_at = NOW()
  WHERE id = p_booking_id
    AND user_id = p_user_id;

  RETURN FOUND;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. ENSURE cancel_booking EXISTS (hardened)
-- ─────────────────────────────────────────────────────────────────────────────

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
DECLARE
  v_auth_user_id TEXT;
BEGIN
  -- Derive caller identity from auth session
  SELECT user_id INTO v_auth_user_id
  FROM public.profiles
  WHERE auth_id = auth.uid()::text;

  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated user has no WeHouse profile';
  END IF;

  -- Verify caller is the canceller
  IF v_auth_user_id != p_canceller_id THEN
    RAISE EXCEPTION 'User ID mismatch: you are not authorized to cancel this booking';
  END IF;

  UPDATE public.worker_bookings SET
    status = 'cancelled',
    cancellation_reason = p_reason,
    updated_at = NOW()
  WHERE id = p_booking_id
    AND (user_id = p_canceller_id OR worker_id = p_canceller_id)
    AND status IN ('booking_requested', 'negotiating', 'waiting_payment');

  RETURN FOUND;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. GRANT EXECUTE ON ALL WORKER RPCs
-- ─────────────────────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.send_booking_message(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.worker_accept_booking(UUID, TEXT, DECIMAL) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_confirm_completion(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_raise_dispute(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_booking(UUID, TEXT, TEXT) TO authenticated;

COMMIT;
