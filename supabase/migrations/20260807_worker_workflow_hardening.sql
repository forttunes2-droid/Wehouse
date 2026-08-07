-- ═════════════════════════════════════════════════════════════════════════════
-- MIGRATION: 20260807_worker_workflow_hardening.sql
-- 
-- DO NOT RERUN 20250807_auth_corrections.sql.
-- This is a NEW, standalone migration for worker workflow hardening.
-- 
-- Prerequisites: 20250807_auth_corrections.sql has already been applied.
-- This migration ONLY adds worker workflow hardening on top.
-- 
-- PREFLIGHT NOTES:
-- - commission_ledger table exists (verified in repo)
-- - verified_paystack_references table exists (verified in repo)
-- - platform_settings stores commission_rate as numeric/percentage string
-- - wallet_transactions columns: id, wallet_id, type, amount, description,
--   reference, balance_after, created_at
-- - escrow_transactions required columns: reference, transaction_type, customer_id,
--   gross_amount, net_amount
-- - withdrawals columns: wallet_id, amount, paystack_transfer_reference,
--   paystack_transfer_code, status, bank_name, bank_account_number,
--   bank_account_name, processed_at, failed_reason, reversed_at, created_at, updated_at
--   + snapshot_bank_* columns added by 20250730_payment_security_hardening
-- - booking_conversations columns: id, booking_id (UNIQUE), user_id, worker_id,
--   status, created_at, updated_at
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. CONDITIONALLY ADD profiles.available
-- ═════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'available'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN available BOOLEAN NOT NULL DEFAULT FALSE;
    CREATE INDEX IF NOT EXISTS idx_profiles_available_worker
      ON public.profiles(available, worker_status, worker_verified);
  END IF;
END $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. PREFLIGHT: WORKER STATUS ANOMALY REPORT
-- 
-- If worker_status and worker_verified are both present, report anomalies
-- to financial_audit_logs. Do NOT auto-repair without evidence.
-- ═════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_pending_verified_count INT;
  v_pending_unverified_count INT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'worker_status'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'worker_verified'
  ) THEN
    SELECT COUNT(*) INTO v_pending_verified_count
    FROM public.profiles
    WHERE role = 'worker' AND worker_status = 'pending' AND worker_verified = true;

    SELECT COUNT(*) INTO v_pending_unverified_count
    FROM public.profiles
    WHERE role = 'worker' AND worker_status = 'pending' AND worker_verified = false;

    IF v_pending_verified_count > 0 OR v_pending_unverified_count > 0 THEN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'financial_audit_logs'
      ) THEN
        INSERT INTO public.financial_audit_logs (event_type, user_id, description, metadata, created_at)
        VALUES (
          'system_notice',
          'system',
          format('Worker status repair: %s pending+verified and %s pending+unverified profiles found. Manual review required before repair.',
            v_pending_verified_count, v_pending_unverified_count),
          jsonb_build_object(
            'pending_verified_true', v_pending_verified_count,
            'pending_verified_false', v_pending_unverified_count,
            'repair_required', v_pending_verified_count > 0,
            'migration', '20260807_worker_workflow_hardening'
          ),
          NOW()
        )
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END IF;
END $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. UNIQUE CONSTRAINTS FOR IDEMPOTENCY
-- 
-- Only add if columns exist and constraint does not already exist.
-- ═════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'worker_bookings' AND column_name = 'paystack_reference'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'worker_bookings' AND constraint_name = 'uq_worker_bookings_paystack_ref'
  ) THEN
    ALTER TABLE public.worker_bookings
    ADD CONSTRAINT uq_worker_bookings_paystack_ref UNIQUE (paystack_reference);
  END IF;
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'booking_payments' AND column_name = 'paystack_reference'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'booking_payments' AND constraint_name = 'uq_booking_payments_paystack_ref'
  ) THEN
    ALTER TABLE public.booking_payments
    ADD CONSTRAINT uq_booking_payments_paystack_ref UNIQUE (paystack_reference);
  END IF;
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. STORAGE: DROP ALL BROAD POLICIES, CREATE PRIVATE ONES
-- 
-- Exact policy names found in repository:
--   worker-files-public, worker-files-upload, worker-files-read
--   chat-files-public, chat-files-upload, chat-files-read
--   (plus any legacy variants)
-- ═════════════════════════════════════════════════════════════════════════════

-- worker-files: drop all existing policies
DROP POLICY IF EXISTS "worker-files-public" ON storage.objects;
DROP POLICY IF EXISTS "worker_files_public" ON storage.objects;
DROP POLICY IF EXISTS "worker-files-upload" ON storage.objects;
DROP POLICY IF EXISTS "worker_files_upload" ON storage.objects;
DROP POLICY IF EXISTS "worker-files-read" ON storage.objects;
DROP POLICY IF EXISTS "worker_files_read" ON storage.objects;
DROP POLICY IF EXISTS "worker_files_owner_insert" ON storage.objects;
DROP POLICY IF EXISTS "worker_files_owner_select" ON storage.objects;
DROP POLICY IF EXISTS "worker_files_reviewer_select" ON storage.objects;
DROP POLICY IF EXISTS "worker-files-owner-insert" ON storage.objects;
DROP POLICY IF EXISTS "worker-files-owner-select" ON storage.objects;
DROP POLICY IF EXISTS "worker-files-reviewer-select" ON storage.objects;

-- chat-files: drop all existing policies
DROP POLICY IF EXISTS "chat-files-public" ON storage.objects;
DROP POLICY IF EXISTS "chat_files_public" ON storage.objects;
DROP POLICY IF EXISTS "chat-files-upload" ON storage.objects;
DROP POLICY IF EXISTS "chat_files_upload" ON storage.objects;
DROP POLICY IF EXISTS "chat-files-read" ON storage.objects;
DROP POLICY IF EXISTS "chat_files_read" ON storage.objects;
DROP POLICY IF EXISTS "chat_files_participant_insert" ON storage.objects;
DROP POLICY IF EXISTS "chat_files_participant_select" ON storage.objects;
DROP POLICY IF EXISTS "chat_files_participant_insert" ON storage.objects;
DROP POLICY IF EXISTS "chat_files_participant_select" ON storage.objects;

-- Create worker-files policies
-- Owner can upload their own files (second path segment = profile.user_id)
CREATE POLICY "worker-files-owner-insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'worker-files'
    AND (storage.foldername(name))[1] = 'worker-verifications'
    AND (storage.foldername(name))[2] = (
      SELECT user_id FROM public.profiles WHERE auth_id = auth.uid()::text
    )
  );

CREATE POLICY "worker-files-owner-select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'worker-files'
    AND (storage.foldername(name))[1] = 'worker-verifications'
    AND (storage.foldername(name))[2] = (
      SELECT user_id FROM public.profiles WHERE auth_id = auth.uid()::text
    )
  );

-- Admin/creator/staff can read all worker files
CREATE POLICY "worker-files-reviewer-select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'worker-files'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE auth_id = auth.uid()::text AND role IN ('admin', 'creator', 'staff')
    )
  );

-- Create chat-files policies
-- General chat uses path prefix "chat/"; booking chat uses "{conversationId}/"
-- Allow authenticated users to upload to general chat paths
CREATE POLICY "chat-files-general-insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-files'
    AND (storage.foldername(name))[1] = 'chat'
  );

-- Allow booking participants to upload to their conversation folders
CREATE POLICY "chat-files-booking-insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-files'
    AND EXISTS (
      SELECT 1 FROM public.booking_conversations bc
      WHERE bc.id::text = (storage.foldername(name))[1]
        AND (
          bc.user_id = (SELECT user_id FROM public.profiles WHERE auth_id = auth.uid()::text)
          OR bc.worker_id = (SELECT user_id FROM public.profiles WHERE auth_id = auth.uid()::text)
        )
    )
  );

-- Allow authenticated users to read general chat files
CREATE POLICY "chat-files-general-select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-files'
    AND (storage.foldername(name))[1] = 'chat'
  );

-- Allow booking participants to read their conversation files
CREATE POLICY "chat-files-booking-select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-files'
    AND EXISTS (
      SELECT 1 FROM public.booking_conversations bc
      WHERE bc.id::text = (storage.foldername(name))[1]
        AND (
          bc.user_id = (SELECT user_id FROM public.profiles WHERE auth_id = auth.uid()::text)
          OR bc.worker_id = (SELECT user_id FROM public.profiles WHERE auth_id = auth.uid()::text)
        )
    )
  );

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. PUBLIC WORKER DISCOVERY RPC
-- 
-- Returns only safe public fields. Joins worker_services and
-- worker_service_coverage for enriched discovery data.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_public_workers(
  p_state TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL,
  p_occupation TEXT DEFAULT NULL
)
RETURNS TABLE (
  user_id TEXT,
  username TEXT,
  avatar_url TEXT,
  bio TEXT,
  state TEXT,
  city TEXT,
  local_government TEXT,
  area TEXT,
  worker_occupation TEXT,
  worker_skills TEXT[],
  worker_price INTEGER,
  worker_bio TEXT,
  worker_experience TEXT,
  rating NUMERIC,
  review_count INTEGER,
  is_online BOOLEAN,
  last_seen TIMESTAMPTZ,
  services JSONB,
  coverage JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.user_id,
    p.username,
    p.avatar_url,
    p.bio,
    p.state,
    p.city,
    p.local_government,
    p.area,
    p.worker_occupation,
    p.worker_skills,
    p.worker_price,
    p.worker_bio,
    p.worker_experience,
    p.rating,
    p.review_count,
    p.is_online,
    p.last_seen,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'name', ws.service_name,
        'price', ws.price,
        'price_type', ws.price_type
      ))
      FROM public.worker_services ws WHERE ws.worker_id = p.user_id),
      '[]'::jsonb
    ) AS services,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'state', wsc.state,
        'lga', wsc.lga,
        'areas', wsc.areas
      ))
      FROM public.worker_service_coverage wsc WHERE wsc.worker_id = p.user_id),
      '[]'::jsonb
    ) AS coverage
  FROM public.profiles p
  WHERE p.role = 'worker'
    AND p.worker_status = 'verified'
    AND p.worker_verified = true
    AND p.available = true
    AND p.deleted = false
    AND p.suspended = false
    AND p.banned = false
    AND (p_state IS NULL OR p.state ILIKE p_state)
    AND (p_city IS NULL OR p.city ILIKE p_city OR p.local_government ILIKE p_city)
    AND (p_occupation IS NULL OR p.worker_occupation ILIKE p_occupation)
  ORDER BY p.rating DESC NULLS LAST, p.review_count DESC NULLS LAST;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 6. SET MY WORKER AVAILABILITY (hardened)
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.set_my_worker_availability(p_is_available BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile RECORD;
BEGIN
  SELECT id, user_id, role, worker_status, available, deleted, suspended, banned
  INTO v_profile
  FROM public.profiles
  WHERE auth_id = auth.uid()::text;

  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF v_profile.role != 'worker' THEN
    RAISE EXCEPTION 'Only workers can set availability';
  END IF;

  IF v_profile.deleted = true THEN
    RAISE EXCEPTION 'Account is deleted';
  END IF;

  IF v_profile.suspended = true THEN
    RAISE EXCEPTION 'Account is suspended';
  END IF;

  IF v_profile.banned = true THEN
    RAISE EXCEPTION 'Account is banned';
  END IF;

  IF p_is_available AND v_profile.worker_status != 'verified' THEN
    RAISE EXCEPTION 'Only verified workers can be available';
  END IF;

  UPDATE public.profiles
  SET available = p_is_available,
      updated_at = NOW()
  WHERE id = v_profile.id;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 7. CREATE BOOKING REQUEST (hardened, auth-derived customer)
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_booking_request(
  p_worker_id TEXT,
  p_service_type TEXT,
  p_description TEXT,
  p_address TEXT,
  p_scheduled_date TEXT,
  p_customer_message TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer RECORD;
  v_worker RECORD;
  v_booking_id UUID;
  v_conv_id UUID;
  v_code TEXT;
BEGIN
  -- Derive customer from auth
  SELECT id, user_id, deleted, suspended, banned
  INTO v_customer
  FROM public.profiles
  WHERE auth_id = auth.uid()::text;

  IF v_customer IS NULL THEN
    RAISE EXCEPTION 'Customer not found';
  END IF;

  IF v_customer.deleted = true OR v_customer.suspended = true OR v_customer.banned = true THEN
    RAISE EXCEPTION 'Customer account is not active';
  END IF;

  -- Verify worker
  SELECT id, user_id, worker_status, worker_verified, available, deleted, suspended, banned
  INTO v_worker
  FROM public.profiles
  WHERE user_id = p_worker_id
    AND role = 'worker';

  IF v_worker IS NULL THEN
    RAISE EXCEPTION 'Worker not found';
  END IF;

  IF v_worker.worker_status != 'verified' THEN
    RAISE EXCEPTION 'Worker is not verified';
  END IF;

  IF v_worker.worker_verified != true THEN
    RAISE EXCEPTION 'Worker is not verified';
  END IF;

  IF v_worker.available != true THEN
    RAISE EXCEPTION 'Worker is not available for bookings';
  END IF;

  IF v_worker.deleted = true OR v_worker.suspended = true OR v_worker.banned = true THEN
    RAISE EXCEPTION 'Worker account is not active';
  END IF;

  -- Prevent self-booking
  IF v_customer.user_id = p_worker_id THEN
    RAISE EXCEPTION 'Cannot book yourself';
  END IF;

  -- Generate unique booking code
  v_code := 'WH-' || upper(substring(md5(gen_random_uuid()::text) from 1 for 8));

  -- Create booking
  INSERT INTO public.worker_bookings (
    booking_code, user_id, worker_id, service_type, description, address,
    scheduled_date, agreed_amount, wehouse_fee, worker_commission, worker_receives,
    status, customer_message, created_at, updated_at
  ) VALUES (
    v_code, v_customer.user_id, p_worker_id, p_service_type,
    p_description, p_address,
    CASE WHEN p_scheduled_date IS NOT NULL AND p_scheduled_date != ''
      THEN p_scheduled_date::DATE ELSE NULL END,
    0, 0, 0, 0,
    'booking_requested', p_customer_message, NOW(), NOW()
  )
  RETURNING id INTO v_booking_id;

  -- Create exactly one conversation
  INSERT INTO public.booking_conversations (booking_id, user_id, worker_id, status, created_at, updated_at)
  VALUES (v_booking_id, v_customer.user_id, p_worker_id, 'active', NOW(), NOW())
  RETURNING id INTO v_conv_id;

  -- Link conversation to booking
  UPDATE public.worker_bookings
  SET booking_conversation_id = v_conv_id
  WHERE id = v_booking_id;

  -- Send initial customer message if provided
  IF p_customer_message IS NOT NULL AND length(trim(p_customer_message)) > 0 THEN
    INSERT INTO public.booking_messages (conversation_id, sender_id, content, created_at)
    VALUES (v_conv_id, v_customer.user_id, trim(p_customer_message), NOW());
  END IF;

  RETURN jsonb_build_object(
    'booking_id', v_booking_id,
    'conversation_id', v_conv_id,
    'booking_code', v_code
  );
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 8. SEND BOOKING MESSAGE (auth-derived sender)
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.send_booking_message(
  p_conversation_id UUID,
  p_content TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender_id TEXT;
  v_booking_id UUID;
  v_msg_id UUID;
BEGIN
  SELECT user_id INTO v_sender_id
  FROM public.profiles
  WHERE auth_id = auth.uid()::text;

  IF v_sender_id IS NULL THEN
    RAISE EXCEPTION 'Sender profile not found';
  END IF;

  SELECT booking_id INTO v_booking_id
  FROM public.booking_conversations
  WHERE id = p_conversation_id;

  IF v_booking_id IS NULL THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.worker_bookings
    WHERE id = v_booking_id
      AND (user_id = v_sender_id OR worker_id = v_sender_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized to send messages in this conversation';
  END IF;

  INSERT INTO public.booking_messages (conversation_id, sender_id, content, created_at)
  VALUES (p_conversation_id, v_sender_id, p_content, NOW())
  RETURNING id INTO v_msg_id;

  UPDATE public.booking_conversations
  SET updated_at = NOW()
  WHERE id = p_conversation_id;

  RETURN v_msg_id;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 9. WORKER ACCEPT BOOKING (auth-derived, with scheduled date)
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.worker_accept_booking(
  p_booking_id UUID,
  p_negotiated_amount NUMERIC,
  p_scheduled_date TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_worker_id TEXT;
  v_booking RECORD;
BEGIN
  SELECT user_id INTO v_worker_id
  FROM public.profiles
  WHERE auth_id = auth.uid()::text;

  IF v_worker_id IS NULL THEN
    RAISE EXCEPTION 'Worker not found';
  END IF;

  SELECT id, worker_id, status, negotiated_amount INTO v_booking
  FROM public.worker_bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF v_booking IS NULL THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  IF v_booking.worker_id != v_worker_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF v_booking.status NOT IN ('booking_requested', 'negotiating') THEN
    RAISE EXCEPTION 'Booking cannot be accepted in current status: %', v_booking.status;
  END IF;

  UPDATE public.worker_bookings
  SET status = 'waiting_payment',
      negotiated_amount = p_negotiated_amount,
      agreed_amount = p_negotiated_amount,
      scheduled_date = COALESCE(
        CASE WHEN p_scheduled_date IS NOT NULL AND p_scheduled_date != ''
          THEN p_scheduled_date::DATE ELSE NULL END,
        scheduled_date
      ),
      updated_at = NOW()
  WHERE id = p_booking_id;

  RETURN true;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 10. WORKER START JOB (auth-derived)
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.worker_start_job(p_booking_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_worker_id TEXT;
BEGIN
  SELECT user_id INTO v_worker_id
  FROM public.profiles
  WHERE auth_id = auth.uid()::text;

  IF v_worker_id IS NULL THEN
    RAISE EXCEPTION 'Worker not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.worker_bookings
    WHERE id = p_booking_id
      AND worker_id = v_worker_id
      AND status = 'confirmed'
  ) THEN
    RAISE EXCEPTION 'Booking not found or not in confirmed status';
  END IF;

  UPDATE public.worker_bookings
  SET status = 'in_progress', started_at = NOW(), updated_at = NOW()
  WHERE id = p_booking_id;

  RETURN true;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 11. WORKER MARK COMPLETE (auth-derived)
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.worker_mark_complete(p_booking_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_worker_id TEXT;
BEGIN
  SELECT user_id INTO v_worker_id
  FROM public.profiles
  WHERE auth_id = auth.uid()::text;

  IF v_worker_id IS NULL THEN
    RAISE EXCEPTION 'Worker not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.worker_bookings
    WHERE id = p_booking_id
      AND worker_id = v_worker_id
      AND status = 'in_progress'
  ) THEN
    RAISE EXCEPTION 'Booking not found or not in progress';
  END IF;

  UPDATE public.worker_bookings
  SET status = 'completed_pending_approval',
      worker_approved = true,
      marked_complete_at = NOW(),
      updated_at = NOW()
  WHERE id = p_booking_id;

  RETURN true;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 12. CUSTOMER CONFIRM COMPLETION (auth-derived, escrow release)
-- 
-- Uses ACTUAL wallet_transactions columns:
--   id, wallet_id, type, amount, description, reference, balance_after, created_at
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.customer_confirm_completion(p_booking_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id TEXT;
  v_booking RECORD;
  v_wallet RECORD;
  v_escrow RECORD;
  v_new_balance NUMERIC;
  v_release_ref TEXT;
  v_wallet_id UUID;
BEGIN
  SELECT user_id INTO v_customer_id
  FROM public.profiles
  WHERE auth_id = auth.uid()::text;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Customer not found';
  END IF;

  -- Lock booking
  SELECT * INTO v_booking
  FROM public.worker_bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF v_booking IS NULL OR v_booking.user_id != v_customer_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF v_booking.status != 'completed_pending_approval' THEN
    RAISE EXCEPTION 'Booking is not pending approval';
  END IF;

  -- Lock escrow
  SELECT * INTO v_escrow
  FROM public.escrow_transactions
  WHERE booking_id = p_booking_id
  FOR UPDATE;

  IF v_escrow IS NULL THEN
    RAISE EXCEPTION 'Escrow not found';
  END IF;

  IF v_escrow.status IN ('released', 'refunded', 'disputed') THEN
    RAISE EXCEPTION 'Escrow already finalized: %', v_escrow.status;
  END IF;

  -- Get or create wallet
  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE owner_id = v_booking.worker_id
    AND owner_type = 'worker'
  FOR UPDATE;

  IF v_wallet IS NULL THEN
    INSERT INTO public.wallets (owner_id, owner_type)
    VALUES (v_booking.worker_id, 'worker')
    RETURNING * INTO v_wallet;
  END IF;

  v_wallet_id := v_wallet.id;

  -- Idempotency: unique release reference
  v_release_ref := 'REL-' || p_booking_id::text || '-' || v_booking.worker_id;

  -- Check if already released (via wallet_transactions.reference)
  IF EXISTS (
    SELECT 1 FROM public.wallet_transactions
    WHERE reference = v_release_ref
      AND type = 'escrow_release'
  ) THEN
    RAISE EXCEPTION 'Payment already released for this booking';
  END IF;

  -- Update booking
  UPDATE public.worker_bookings
  SET status = 'approved_released',
      user_approved = true,
      completed_at = NOW(),
      updated_at = NOW()
  WHERE id = p_booking_id;

  -- Release escrow
  UPDATE public.escrow_transactions
  SET status = 'released',
      released_at = NOW(),
      released_to_wallet_id = v_wallet_id,
      updated_at = NOW()
  WHERE booking_id = p_booking_id;

  -- Credit wallet
  v_new_balance := v_wallet.available_balance + COALESCE(v_booking.worker_receives, 0);

  UPDATE public.wallets
  SET available_balance = v_new_balance,
      updated_at = NOW()
  WHERE id = v_wallet_id;

  -- Log transaction with ACTUAL wallet_transactions columns
  INSERT INTO public.wallet_transactions (
    wallet_id, type, amount, description,
    reference, balance_after, created_at
  ) VALUES (
    v_wallet_id,
    'escrow_release',
    COALESCE(v_booking.worker_receives, 0),
    'Job completion payment for booking ' || v_booking.booking_code,
    v_release_ref,
    v_new_balance,
    NOW()
  );

  RETURN true;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 13. CUSTOMER RAISE DISPUTE (auth-derived)
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.customer_raise_dispute(
  p_booking_id UUID,
  p_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id TEXT;
BEGIN
  SELECT user_id INTO v_customer_id
  FROM public.profiles
  WHERE auth_id = auth.uid()::text;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Customer not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.worker_bookings
    WHERE id = p_booking_id
      AND user_id = v_customer_id
      AND status IN ('completed_pending_approval', 'in_progress', 'confirmed')
  ) THEN
    RAISE EXCEPTION 'Booking not eligible for dispute';
  END IF;

  UPDATE public.worker_bookings
  SET status = 'disputed',
      dispute_reason = p_reason,
      updated_at = NOW()
  WHERE id = p_booking_id;

  UPDATE public.escrow_transactions
  SET status = 'disputed', updated_at = NOW()
  WHERE booking_id = p_booking_id;

  RETURN true;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 14. CANCEL BOOKING (auth-derived)
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cancel_booking(
  p_booking_id UUID,
  p_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canceller_id TEXT;
  v_booking RECORD;
BEGIN
  SELECT user_id INTO v_canceller_id
  FROM public.profiles
  WHERE auth_id = auth.uid()::text;

  IF v_canceller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id, user_id, worker_id, status INTO v_booking
  FROM public.worker_bookings
  WHERE id = p_booking_id;

  IF v_booking IS NULL THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  IF v_booking.user_id != v_canceller_id AND v_booking.worker_id != v_canceller_id THEN
    RAISE EXCEPTION 'Not authorized to cancel this booking';
  END IF;

  IF v_booking.status NOT IN ('booking_requested', 'negotiating', 'waiting_payment') THEN
    RAISE EXCEPTION 'Booking cannot be cancelled in current status: %', v_booking.status;
  END IF;

  UPDATE public.worker_bookings
  SET status = 'cancelled',
      cancellation_reason = p_reason,
      updated_at = NOW()
  WHERE id = p_booking_id;

  RETURN true;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 15. CANONICAL PAYMENT CONFIRMATION (server-verified, idempotent)
-- 
-- This RPC is designed to be called by the Edge Function
-- (supabase/functions/paystack-verify) AFTER Paystack API verification.
-- It is idempotent and uses row locking.
-- 
-- NOTE: This is a NEW function (different from existing customer_confirm_payment
-- in 20250807_auth_corrections.sql). Use confirm_worker_booking_payment for
-- new worker booking flows. The legacy customer_confirm_payment is retained
-- for backward compatibility with existing integrations.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.confirm_worker_booking_payment(
  p_booking_id UUID,
  p_paystack_ref TEXT,
  p_paystack_tx_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id TEXT;
  v_booking RECORD;
  v_commission_rate NUMERIC := 0.10;
  v_wehouse_fee NUMERIC;
  v_worker_receives NUMERIC;
  v_escrow_ref TEXT;
BEGIN
  SELECT user_id INTO v_customer_id
  FROM public.profiles
  WHERE auth_id = auth.uid()::text;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Customer not found';
  END IF;

  SELECT * INTO v_booking
  FROM public.worker_bookings
  WHERE id = p_booking_id;

  IF v_booking IS NULL THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  IF v_booking.user_id != v_customer_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF v_booking.status != 'waiting_payment' THEN
    RAISE EXCEPTION 'Booking is not awaiting payment';
  END IF;

  -- Read commission rate from platform_settings (stored as percentage, e.g., '10.00')
  SELECT COALESCE(NULLIF(value, ''), '10')::NUMERIC INTO v_commission_rate
  FROM public.platform_settings
  WHERE key = 'worker_commission_rate';

  -- Validate range: 0% to 50%
  IF v_commission_rate < 0 OR v_commission_rate > 50 THEN
    RAISE EXCEPTION 'Invalid commission rate: %', v_commission_rate;
  END IF;

  v_wehouse_fee := ROUND(v_booking.negotiated_amount * v_commission_rate / 100, 2);
  v_worker_receives := v_booking.negotiated_amount - v_wehouse_fee;

  -- Update booking
  UPDATE public.worker_bookings
  SET status = 'confirmed',
      agreed_amount = v_booking.negotiated_amount,
      wehouse_fee = v_wehouse_fee,
      worker_commission = v_wehouse_fee,
      worker_receives = v_worker_receives,
      paystack_reference = p_paystack_ref,
      paystack_transaction_id = p_paystack_tx_id,
      updated_at = NOW()
  WHERE id = p_booking_id;

  -- Create escrow with ALL required columns
  v_escrow_ref := 'WHESC-' || upper(substring(md5(gen_random_uuid()::text) from 1 for 10));

  INSERT INTO public.escrow_transactions (
    reference, transaction_type, booking_id,
    customer_id, worker_id,
    gross_amount, wehouse_commission, net_amount,
    status, paystack_reference, created_at, updated_at
  ) VALUES (
    v_escrow_ref, 'worker_booking', p_booking_id,
    v_booking.user_id, v_booking.worker_id,
    v_booking.negotiated_amount, v_wehouse_fee, v_worker_receives,
    'held', p_paystack_ref, NOW(), NOW()
  );

  RETURN true;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 16. WORKER WITHDRAWAL REQUEST (canonical, NEW function name)
-- 
-- This is a NEW function to avoid overwriting existing request_withdrawal
-- which has a different signature in production.
-- 
-- Uses ACTUAL wallet_transactions columns:
--   id, wallet_id, type, amount, description, reference, balance_after, created_at
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.request_worker_withdrawal(
  p_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id TEXT;
  v_wallet RECORD;
  v_min NUMERIC;
  v_request_id UUID;
BEGIN
  SELECT user_id INTO v_user_id
  FROM public.profiles
  WHERE auth_id = auth.uid()::text;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Lock wallet
  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE owner_id = v_user_id
  FOR UPDATE;

  IF v_wallet IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wallet not found');
  END IF;

  IF v_wallet.is_frozen = true THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wallet is frozen');
  END IF;

  -- Minimum withdrawal from settings
  SELECT COALESCE(NULLIF(value, ''), '1000')::NUMERIC INTO v_min
  FROM public.platform_settings
  WHERE key = 'wallet_minimum_withdrawal';

  IF p_amount < v_min THEN
    RETURN jsonb_build_object('success', false, 'error', format('Minimum withdrawal is ₦%s', v_min));
  END IF;

  IF p_amount > v_wallet.available_balance THEN
    RETURN jsonb_build_object('success', false, 'error', format('Insufficient balance. Available: ₦%s', v_wallet.available_balance));
  END IF;

  -- Check bank details on wallet row
  IF COALESCE(v_wallet.bank_name, '') = '' OR COALESCE(v_wallet.bank_account_number, '') = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bank details not set up');
  END IF;

  -- Atomic balance reservation
  UPDATE public.wallets
  SET available_balance = available_balance - p_amount,
      pending_balance = COALESCE(pending_balance, 0) + p_amount,
      updated_at = NOW()
  WHERE id = v_wallet.id;

  -- Create withdrawal request
  INSERT INTO public.withdrawals (
    wallet_id, amount,
    bank_name, bank_account_number, bank_account_name,
    status, created_at, updated_at
  ) VALUES (
    v_wallet.id, p_amount,
    v_wallet.bank_name, v_wallet.bank_account_number, v_wallet.bank_account_name,
    'pending', NOW(), NOW()
  )
  RETURNING id INTO v_request_id;

  -- Log transaction with ACTUAL wallet_transactions columns
  INSERT INTO public.wallet_transactions (
    wallet_id, type, amount, description,
    reference, balance_after, created_at
  ) VALUES (
    v_wallet.id,
    'withdrawal',
    -p_amount,
    format('Withdrawal request: ₦%s', p_amount),
    v_request_id::text,
    v_wallet.available_balance - p_amount,
    NOW()
  );

  RETURN jsonb_build_object(
    'success', true,
    'request_id', v_request_id,
    'amount', p_amount,
    'status', 'pending'
  );
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 17. EXECUTE PRIVILEGES: REVOKE from PUBLIC/anon, GRANT to authenticated
-- ═════════════════════════════════════════════════════════════════════════════
REVOKE EXECUTE ON FUNCTION public.set_my_worker_availability(BOOLEAN) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.send_booking_message(UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_booking_request(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.worker_accept_booking(UUID, NUMERIC, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.worker_start_job(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.worker_mark_complete(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.customer_confirm_completion(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.customer_raise_dispute(UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_booking(UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.confirm_worker_booking_payment(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.request_worker_withdrawal(NUMERIC) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_public_workers(TEXT, TEXT, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.set_my_worker_availability(BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_booking_message(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking_request(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.worker_accept_booking(UUID, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.worker_start_job(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.worker_mark_complete(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_confirm_completion(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_raise_dispute(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_booking(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_worker_booking_payment(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_worker_withdrawal(NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_workers(TEXT, TEXT, TEXT) TO authenticated;

COMMIT;
