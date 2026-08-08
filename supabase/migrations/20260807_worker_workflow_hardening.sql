-- ═════════════════════════════════════════════════════════════════════════════
-- MIGRATION: 20260807_worker_workflow_hardening.sql
-- 
-- DO NOT RERUN 20250807_auth_corrections.sql.
-- This is a NEW, standalone migration for worker workflow hardening.
-- 
-- Prerequisites: 20250807_auth_corrections.sql has already been applied.
-- This migration ONLY adds worker workflow hardening on top.
-- 
-- LIVE SCHEMA COMPLIANCE (verified against production):
--   wallet_transactions columns:
--     id, user_id, transaction_type, amount, balance_after,
--     reference_id, reference_type, description, metadata, created_at
--   escrow_transactions columns:
--     id, booking_id, booking_type, payer_user_id, payee_user_id,
--     amount_total, amount_commission, amount_payee, commission_rate,
--     status, released_at, released_by, paystack_reference,
--     created_at, updated_at
--   wallets columns:
--     id, owner_id, owner_type, available_balance, pending_balance,
--     frozen_balance, total_withdrawn, bank_name, bank_account_number,
--     bank_account_name, paystack_recipient_code, is_frozen,
--     frozen_reason, frozen_by, frozen_at, created_at, updated_at
--   withdrawals columns:
--     id, wallet_id, amount, bank_name, bank_account_number,
--     bank_account_name, status, paystack_transfer_reference,
--     paystack_transfer_code, processed_at, failed_reason,
--     reversed_at, created_at, updated_at
--   bank_accounts columns:
--     id, user_id, account_number, bank_code, bank_name,
--     account_name, paystack_recipient_code, is_default,
--     verified_at, created_at
--   worker_bookings columns:
--     id, booking_code, user_id, worker_id, service_type, description,
--     address, scheduled_date, agreed_amount, wehouse_fee,
--     worker_commission, worker_receives, status, customer_message,
--     paystack_reference, paystack_transaction_id, worker_approved,
--     user_approved, completed_at, marked_complete_at, cancellation_reason,
--     dispute_reason, started_at, booking_conversation_id,
--     created_at, updated_at
--   booking_conversations columns:
--     id, booking_id, user_id, worker_id, status, created_at, updated_at
--   booking_messages columns:
--     id, conversation_id, sender_id, content, created_at
--   profiles columns (relevant):
--     id, user_id, auth_id, role, worker_status, worker_verified,
--     available, deleted, suspended, banned, state, city,
--     local_government, area, worker_occupation, worker_skills,
--     worker_price, worker_bio, worker_experience, rating,
--     review_count, is_online, last_seen, created_at, updated_at
--   platform_settings columns (relevant):
--     key, value, data_type, category, is_active
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
-- 3. DUPLICATE PAYSTACK REFERENCE PREFLIGHT
-- 
-- Only add unique constraints if zero duplicates exist.
-- ═════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_worker_bookings_dups INT := 0;
  v_booking_payments_dups INT := 0;
BEGIN
  -- Count duplicate paystack_reference in worker_bookings
  SELECT COUNT(*) INTO v_worker_bookings_dups
  FROM (
    SELECT paystack_reference
    FROM public.worker_bookings
    WHERE paystack_reference IS NOT NULL
    GROUP BY paystack_reference
    HAVING COUNT(*) > 1
  ) dups;

  -- Count duplicate paystack_reference in booking_payments
  SELECT COUNT(*) INTO v_booking_payments_dups
  FROM (
    SELECT paystack_reference
    FROM public.booking_payments
    WHERE paystack_reference IS NOT NULL
    GROUP BY paystack_reference
    HAVING COUNT(*) > 1
  ) dups;

  IF v_worker_bookings_dups = 0 THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'worker_bookings'
        AND constraint_name = 'uq_worker_bookings_paystack_ref'
    ) THEN
      ALTER TABLE public.worker_bookings
      ADD CONSTRAINT uq_worker_bookings_paystack_ref UNIQUE (paystack_reference);
    END IF;
  ELSE
    RAISE NOTICE 'SKIPPED: % duplicate paystack_reference values in worker_bookings', v_worker_bookings_dups;
  END IF;

  IF v_booking_payments_dups = 0 THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'booking_payments'
        AND constraint_name = 'uq_booking_payments_paystack_ref'
    ) THEN
      ALTER TABLE public.booking_payments
      ADD CONSTRAINT uq_booking_payments_paystack_ref UNIQUE (paystack_reference);
    END IF;
  ELSE
    RAISE NOTICE 'SKIPPED: % duplicate paystack_reference values in booking_payments', v_booking_payments_dups;
  END IF;
END $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3b. ADD worker_booking_id TO booking_payments (if missing)
-- 
-- This is the canonical foreign key linking a payment record to the
-- worker_bookings table. The Edge Function derives booking_id from this
-- column (or metadata fallback), never from browser input.
-- ═════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'booking_payments'
      AND column_name = 'worker_booking_id'
  ) THEN
    ALTER TABLE public.booking_payments
    ADD COLUMN worker_booking_id UUID REFERENCES public.worker_bookings(id);
    CREATE INDEX IF NOT EXISTS idx_booking_payments_worker_booking_id
      ON public.booking_payments(worker_booking_id);
  END IF;
END $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. STORAGE: DROP DANGEROUS BROAD POLICIES, CREATE SECURE ONES
-- 
-- Exact policy names found in repository history:
--   worker-files-public, worker_files_public
--   worker-files-upload, worker_files_upload
--   worker-files-read, worker_files_read
--   chat-files-public, chat_files_public
--   chat-files-upload, chat_files_upload
--   chat-files-read, chat_files_read
--   Plus any legacy variants
-- 
-- NOTE: General chat policies (chat/ prefix) are NOT part of the worker
-- booking flow and are NOT created here. Only booking attachment policies
-- are added. If general chat policies exist, they remain untouched.
-- ═════════════════════════════════════════════════════════════════════════════

-- Drop ALL existing worker-files and chat-files policies
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

DROP POLICY IF EXISTS "chat-files-public" ON storage.objects;
DROP POLICY IF EXISTS "chat_files_public" ON storage.objects;
DROP POLICY IF EXISTS "chat-files-upload" ON storage.objects;
DROP POLICY IF EXISTS "chat_files_upload" ON storage.objects;
DROP POLICY IF EXISTS "chat-files-read" ON storage.objects;
DROP POLICY IF EXISTS "chat_files_read" ON storage.objects;
DROP POLICY IF EXISTS "chat_files_participant_insert" ON storage.objects;
DROP POLICY IF EXISTS "chat_files_participant_select" ON storage.objects;
DROP POLICY IF EXISTS "chat-files-participant-insert" ON storage.objects;
DROP POLICY IF EXISTS "chat-files-participant-select" ON storage.objects;
DROP POLICY IF EXISTS "chat-files-general-insert" ON storage.objects;
DROP POLICY IF EXISTS "chat-files-general-select" ON storage.objects;
DROP POLICY IF EXISTS "chat_files_general_insert" ON storage.objects;
DROP POLICY IF EXISTS "chat_files_general_select" ON storage.objects;

-- Create worker-files policies
-- Path format: worker-verifications/{profile.user_id}/filename
-- Segment [1] = 'worker-verifications', segment [2] = profile.user_id
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

-- Create chat-files policies for BOOKING ATTACHMENTS ONLY
-- Path format: {conversationId}/{timestamp}.jpg
-- Only booking participants can read/write their conversation files
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
  coverage JsonB
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
-- Uses LIVE wallet_transactions columns:
--   user_id, transaction_type, amount, balance_after,
--   reference_id, reference_type, description, metadata, created_at
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

  -- Check if already released (via wallet_transactions.reference_id)
  IF EXISTS (
    SELECT 1 FROM public.wallet_transactions
    WHERE reference_id = v_release_ref
      AND reference_type = 'escrow_release'
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

  -- Release escrow (using released_by instead of released_to_wallet_id)
  UPDATE public.escrow_transactions
  SET status = 'released',
      released_at = NOW(),
      released_by = v_customer_id,
      updated_at = NOW()
  WHERE booking_id = p_booking_id;

  -- Credit wallet
  v_new_balance := v_wallet.available_balance + COALESCE(v_booking.worker_receives, 0);

  UPDATE public.wallets
  SET available_balance = v_new_balance,
      total_withdrawn = COALESCE(total_withdrawn, 0),
      updated_at = NOW()
  WHERE id = v_wallet_id;

  -- Log transaction with LIVE wallet_transactions columns
  INSERT INTO public.wallet_transactions (
    user_id, transaction_type, amount, balance_after,
    reference_id, reference_type, description, metadata, created_at
  ) VALUES (
    v_booking.worker_id,
    'escrow_release',
    COALESCE(v_booking.worker_receives, 0),
    v_new_balance,
    v_release_ref,
    'escrow_release',
    'Job completion payment for booking ' || v_booking.booking_code,
    jsonb_build_object('booking_id', p_booking_id, 'escrow_id', v_escrow.id, 'customer_id', v_customer_id),
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
-- 15. CREATE WORKER BOOKING PAYMENT (initialization)
-- 
-- Called by the frontend BEFORE opening the Paystack popup.
-- Creates a canonical booking_payments row linked to the worker booking.
-- The paystack_reference returned is what the customer pays against.
-- 
-- SECURITY:
--   - Derives customer from auth.uid() (browser cannot spoof identity)
--   - Verifies the customer owns the booking
--   - Verifies booking status is 'waiting_payment' (worker has accepted)
--   - Verifies negotiated_amount > 0 (price has been agreed)
--   - Generates cryptographically secure reference
--   - Stores worker_booking_id in the payment record (canonical linkage)
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_worker_booking_payment(
  p_booking_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id TEXT;
  v_booking RECORD;
  v_amount NUMERIC;
  v_reference TEXT;
  v_existing RECORD;
BEGIN
  -- Derive customer from auth
  SELECT user_id INTO v_customer_id
  FROM public.profiles
  WHERE auth_id = auth.uid()::text;

  IF v_customer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Lock and verify booking
  SELECT * INTO v_booking
  FROM public.worker_bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF v_booking IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  IF v_booking.user_id != v_customer_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  IF v_booking.status != 'waiting_payment' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking is not waiting for payment. Status: ' || v_booking.status);
  END IF;

  v_amount := COALESCE(v_booking.negotiated_amount, v_booking.agreed_amount, 0);
  IF v_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'No agreed amount set');
  END IF;

  -- Idempotency: check for existing fresh pending payment for this booking
  SELECT * INTO v_existing
  FROM public.booking_payments
  WHERE worker_booking_id = p_booking_id
    AND status = 'pending'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    -- Reuse if amount matches and record is fresh (< 30 min)
    IF v_existing.amount_total = v_amount
       AND v_existing.created_at > NOW() - INTERVAL '30 minutes' THEN
      RETURN jsonb_build_object(
        'success', true,
        'reference', v_existing.paystack_reference,
        'amount', v_amount,
        'existing', true
      );
    END IF;
    -- Otherwise expire the stale record
    UPDATE public.booking_payments
    SET status = 'expired', updated_at = NOW()
    WHERE id = v_existing.id;
  END IF;

  -- Generate secure reference
  v_reference := 'WHBK-' || gen_random_uuid()::text;

  -- Create canonical payment record
  INSERT INTO public.booking_payments (
    payment_reference,
    user_id,
    payer_user_id,
    payee_user_id,
    amount,
    amount_total,
    net_amount,
    amount_commission,
    currency,
    status,
    purpose,
    paystack_reference,
    worker_booking_id,
    metadata,
    created_at,
    updated_at
  ) VALUES (
    v_reference,
    v_customer_id,
    v_customer_id,
    v_booking.worker_id,
    v_amount,
    v_amount,
    v_amount,
    0,
    'NGN',
    'pending',
    'worker_booking',
    v_reference,
    p_booking_id,
    jsonb_build_object('source', 'create_worker_booking_payment', 'booking_id', p_booking_id),
    NOW(),
    NOW()
  );

  RETURN jsonb_build_object(
    'success', true,
    'reference', v_reference,
    'amount', v_amount
  );
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 16. CANONICAL WORKER BOOKING PAYMENT CONFIRMATION
-- 
-- SECURITY: This function MUST NOT be callable directly by authenticated
-- frontend users. It is designed to be called by the Edge Function
-- (supabase/functions/paystack-verify) after Paystack API verification.
-- 
-- The Edge Function:
--   1. Authenticates the caller (fail closed)
--   2. Verifies the transaction with Paystack API using PAYSTACK_SECRET_KEY
--   3. Checks amount, currency (NGN), and user ownership
--   4. Derives booking_id from booking_payments.worker_booking_id (canonical)
--   5. Calls this RPC with the service_role key
-- 
-- DESIGN: booking_id is derived from the payment record (worker_booking_id
-- or metadata->>'booking_id'), NOT from a reverse lookup on worker_bookings.
-- This avoids circular dependency where the RPC itself writes paystack_reference
-- to worker_bookings.
-- 
-- This function uses LIVE escrow_transactions columns:
--   booking_id, booking_type, payer_user_id, payee_user_id,
--   amount_total, amount_commission, amount_payee, commission_rate,
--   status, paystack_reference, created_at, updated_at
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.confirm_worker_booking_payment(
  p_booking_id UUID,
  p_paystack_reference TEXT,
  p_amount_verified NUMERIC,
  p_currency TEXT DEFAULT 'NGN',
  p_transaction_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking RECORD;
  v_payment RECORD;
  v_derived_booking_id UUID;
  v_rate NUMERIC;
  v_commission NUMERIC;
  v_worker_receives NUMERIC;
  v_escrow_ref TEXT;
BEGIN
  -- Validate inputs
  IF p_paystack_reference IS NULL OR length(trim(p_paystack_reference)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Paystack reference is required');
  END IF;

  IF p_amount_verified IS NULL OR p_amount_verified <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Verified amount must be positive');
  END IF;

  IF p_currency != 'NGN' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only NGN currency is supported');
  END IF;

  -- ── Lock and find canonical payment row ──
  SELECT * INTO v_payment FROM public.booking_payments
  WHERE paystack_reference = p_paystack_reference
  FOR UPDATE SKIP LOCKED;

  IF v_payment IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment not found');
  END IF;

  -- Derive booking_id from payment record (canonical linkage)
  IF v_payment.worker_booking_id IS NOT NULL THEN
    v_derived_booking_id := v_payment.worker_booking_id;
  ELSIF v_payment.metadata ? 'booking_id' THEN
    v_derived_booking_id := (v_payment.metadata->>'booking_id')::UUID;
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'booking_id not found in payment record');
  END IF;

  -- Verify the passed booking_id matches the payment record
  IF v_derived_booking_id != p_booking_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking ID mismatch');
  END IF;

  IF v_payment.purpose IS NOT NULL AND v_payment.purpose != 'worker_booking' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Purpose mismatch: expected worker_booking, got ' || v_payment.purpose);
  END IF;

  -- ── Idempotency: already verified? ──
  IF EXISTS (
    SELECT 1 FROM public.verified_paystack_references
    WHERE paystack_reference = p_paystack_reference
  ) THEN
    RETURN jsonb_build_object('success', true, 'already_processed', true);
  END IF;

  IF v_payment.status IN ('paid', 'completed') THEN
    RETURN jsonb_build_object('success', true, 'already_processed', true);
  END IF;

  -- ── Lock and verify booking ──
  SELECT * INTO v_booking
  FROM public.worker_bookings
  WHERE id = v_derived_booking_id
  FOR UPDATE;

  IF v_booking IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  -- Only 'waiting_payment' is a legitimate state for payment.
  -- 'booking_requested' or 'negotiating' mean the worker has not yet accepted.
  IF v_booking.status != 'waiting_payment' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking is not awaiting payment. Status: ' || v_booking.status);
  END IF;

  -- ── Verify amount against BOTH canonical sources ──
  -- 1. Payment record (server-side agreed amount at initialization)
  IF COALESCE(v_payment.amount_total, v_payment.amount, 0) > 0
     AND ABS(p_amount_verified - COALESCE(v_payment.amount_total, v_payment.amount)) > 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount mismatch against payment record',
      'expected', COALESCE(v_payment.amount_total, v_payment.amount),
      'verified', p_amount_verified);
  END IF;

  -- 2. Booking record (final negotiated amount)
  IF COALESCE(v_booking.negotiated_amount, v_booking.agreed_amount, 0) > 0
     AND ABS(p_amount_verified - COALESCE(v_booking.negotiated_amount, v_booking.agreed_amount, 0)) > 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount mismatch against booking record',
      'expected', COALESCE(v_booking.negotiated_amount, v_booking.agreed_amount, 0),
      'verified', p_amount_verified);
  END IF;

  -- ── Read commission rate from platform_settings ──
  SELECT COALESCE(NULLIF(value, ''), '10')::NUMERIC INTO v_rate
  FROM public.platform_settings
  WHERE key = 'worker_commission_rate' AND is_active = true;

  -- Validate range: 0% to 50%
  IF v_rate < 0 OR v_rate > 50 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid commission rate: ' || v_rate);
  END IF;

  v_commission := ROUND((p_amount_verified * v_rate / 100)::NUMERIC, 2);
  v_worker_receives := p_amount_verified - v_commission;

  -- ── Update booking ──
  UPDATE public.worker_bookings
  SET status = 'confirmed',
      paystack_reference = p_paystack_reference,
      agreed_amount = p_amount_verified,
      wehouse_fee = v_commission,
      worker_commission = v_commission,
      worker_receives = v_worker_receives,
      updated_at = NOW()
  WHERE id = v_derived_booking_id;

  -- ── Create escrow with LIVE escrow_transactions columns ──
  v_escrow_ref := 'WHESC-' || upper(substring(md5(gen_random_uuid()::text) from 1 for 10));

  INSERT INTO public.escrow_transactions (
    booking_id, booking_type, payer_user_id, payee_user_id,
    amount_total, amount_commission, amount_payee, commission_rate,
    status, paystack_reference, created_at, updated_at
  ) VALUES (
    v_derived_booking_id, 'worker_booking',
    v_booking.user_id, v_booking.worker_id,
    p_amount_verified, v_commission, v_worker_receives, v_rate,
    'held', p_paystack_reference, NOW(), NOW()
  );

  -- ── Mark payment as paid ──
  UPDATE public.booking_payments SET
    status = 'paid',
    paystack_transaction_id = COALESCE(p_transaction_id, v_payment.paystack_transaction_id),
    verified_amount = p_amount_verified,
    verified_at = NOW(),
    verification_source = 'edge_function',
    paid_at = NOW(),
    webhook_processed = TRUE,
    updated_at = NOW()
  WHERE id = v_payment.id;

  -- ── Record verified reference (idempotent) ──
  INSERT INTO public.verified_paystack_references (
    paystack_reference, booking_payment_id, verified_amount,
    verification_source, verified_by
  ) VALUES (
    p_paystack_reference, v_payment.id, p_amount_verified,
    'edge_function', 'paystack-verify'
  )
  ON CONFLICT (paystack_reference) DO NOTHING;

  RETURN jsonb_build_object(
    'success', true,
    'escrow_reference', v_escrow_ref,
    'commission_rate', v_rate,
    'commission_amount', v_commission,
    'worker_receives', v_worker_receives
  );
END;
$$;

  -- ── Update booking ──
  UPDATE public.worker_bookings
  SET status = 'confirmed',
      paystack_reference = p_paystack_reference,
      agreed_amount = p_amount_verified,
      wehouse_fee = v_commission,
      worker_commission = v_commission,
      worker_receives = v_worker_receives,
      updated_at = NOW()
  WHERE id = p_booking_id;

  -- ── Create escrow with LIVE escrow_transactions columns ──
  v_escrow_ref := 'WHESC-' || upper(substring(md5(gen_random_uuid()::text) from 1 for 10));

  INSERT INTO public.escrow_transactions (
    booking_id, booking_type, payer_user_id, payee_user_id,
    amount_total, amount_commission, amount_payee, commission_rate,
    status, paystack_reference, created_at, updated_at
  ) VALUES (
    p_booking_id, 'worker_booking',
    v_booking.user_id, v_booking.worker_id,
    p_amount_verified, v_commission, v_worker_receives, v_rate,
    'held', p_paystack_reference, NOW(), NOW()
  );

  -- ── Mark payment as paid ──
  UPDATE public.booking_payments SET
    status = 'paid',
    paystack_transaction_id = COALESCE(p_transaction_id, v_payment.paystack_transaction_id),
    verified_amount = p_amount_verified,
    verified_at = NOW(),
    verification_source = 'edge_function',
    paid_at = NOW(),
    webhook_processed = TRUE,
    updated_at = NOW()
  WHERE id = v_payment.id;

  -- ── Record verified reference (idempotent) ──
  INSERT INTO public.verified_paystack_references (
    paystack_reference, booking_payment_id, verified_amount,
    verification_source, verified_by
  ) VALUES (
    p_paystack_reference, v_payment.id, p_amount_verified,
    'edge_function', 'paystack-verify'
  )
  ON CONFLICT (paystack_reference) DO NOTHING;

  RETURN jsonb_build_object(
    'success', true,
    'escrow_reference', v_escrow_ref,
    'commission_rate', v_rate,
    'commission_amount', v_commission,
    'worker_receives', v_worker_receives
  );
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 16. WORKER WITHDRAWAL REQUEST (canonical, auth-derived)
-- 
-- Derives caller identity from auth.uid(). Accepts amount and bank_account_id.
-- Snapshots bank details from bank_accounts at request time.
-- Atomic balance reservation with wallet row locking.
-- Logs to wallet_transactions using LIVE columns.
-- 
-- Uses LIVE wallet_transactions columns:
--   user_id, transaction_type, amount, balance_after,
--   reference_id, reference_type, description, metadata, created_at
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.request_worker_withdrawal(
  p_amount NUMERIC,
  p_bank_account_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id TEXT;
  v_wallet RECORD;
  v_bank RECORD;
  v_min NUMERIC;
  v_request_id UUID;
  v_new_balance NUMERIC;
  v_bank_name TEXT;
  v_bank_account_number TEXT;
  v_bank_account_name TEXT;
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

  -- Get bank details: from bank_accounts if ID provided, else from wallet
  IF p_bank_account_id IS NOT NULL THEN
    SELECT * INTO v_bank
    FROM public.bank_accounts
    WHERE id = p_bank_account_id
      AND user_id = v_user_id;

    IF v_bank IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Bank account not found');
    END IF;

    v_bank_name := v_bank.bank_name;
    v_bank_account_number := v_bank.account_number;
    v_bank_account_name := v_bank.account_name;
  ELSE
    -- Fallback to wallet bank details
    IF COALESCE(v_wallet.bank_name, '') = '' OR COALESCE(v_wallet.bank_account_number, '') = '' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Bank details not set up');
    END IF;

    v_bank_name := v_wallet.bank_name;
    v_bank_account_number := v_wallet.bank_account_number;
    v_bank_account_name := v_wallet.bank_account_name;
  END IF;

  -- Minimum withdrawal from settings
  SELECT COALESCE(NULLIF(value, ''), '1000')::NUMERIC INTO v_min
  FROM public.platform_settings
  WHERE key = 'wallet_minimum_withdrawal' AND is_active = true;

  IF p_amount < v_min THEN
    RETURN jsonb_build_object('success', false, 'error', format('Minimum withdrawal is ₦%s', v_min));
  END IF;

  IF p_amount > v_wallet.available_balance THEN
    RETURN jsonb_build_object('success', false, 'error', format('Insufficient balance. Available: ₦%s', v_wallet.available_balance));
  END IF;

  -- Atomic balance reservation
  v_new_balance := v_wallet.available_balance - p_amount;

  UPDATE public.wallets
  SET available_balance = v_new_balance,
      pending_balance = COALESCE(pending_balance, 0) + p_amount,
      updated_at = NOW()
  WHERE id = v_wallet.id;

  -- Create withdrawal request with snapshot bank details
  INSERT INTO public.withdrawals (
    wallet_id, amount,
    bank_name, bank_account_number, bank_account_name,
    status, created_at, updated_at
  ) VALUES (
    v_wallet.id, p_amount,
    v_bank_name, v_bank_account_number, v_bank_account_name,
    'pending', NOW(), NOW()
  )
  RETURNING id INTO v_request_id;

  -- Log transaction with LIVE wallet_transactions columns
  INSERT INTO public.wallet_transactions (
    user_id, transaction_type, amount, balance_after,
    reference_id, reference_type, description, metadata, created_at
  ) VALUES (
    v_user_id,
    'withdrawal',
    -p_amount,
    v_new_balance,
    v_request_id::text,
    'withdrawal',
    format('Withdrawal request: ₦%s to %s ending %s', p_amount, v_bank_name, right(v_bank_account_number, 4)),
    jsonb_build_object('wallet_id', v_wallet.id, 'amount', p_amount, 'bank_account_id', p_bank_account_id),
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
-- 17. EXECUTE PRIVILEGES
-- 
-- Identity-derived workflow RPCs: GRANT to authenticated only.
-- confirm_worker_booking_payment: REVOKE from everyone except service_role.
--   The Edge Function calls it with the service_role key.
-- ═════════════════════════════════════════════════════════════════════════════

-- Identity-derived RPCs: authenticated only
REVOKE EXECUTE ON FUNCTION public.set_my_worker_availability(BOOLEAN) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.send_booking_message(UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_booking_request(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.worker_accept_booking(UUID, NUMERIC, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.worker_start_job(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.worker_mark_complete(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.customer_confirm_completion(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.customer_raise_dispute(UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_booking(UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.request_worker_withdrawal(NUMERIC, UUID) FROM PUBLIC, anon;
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
GRANT EXECUTE ON FUNCTION public.request_worker_withdrawal(NUMERIC, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_workers(TEXT, TEXT, TEXT) TO authenticated;

-- create_worker_booking_payment: authenticated only (frontend calls before Paystack popup)
REVOKE EXECUTE ON FUNCTION public.create_worker_booking_payment(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_worker_booking_payment(UUID) TO authenticated;

-- confirm_worker_booking_payment: service_role ONLY
-- The Edge Function uses the service_role key to call this.
-- Signature: (UUID, TEXT, NUMERIC, TEXT, TEXT)
REVOKE EXECUTE ON FUNCTION public.confirm_worker_booking_payment(UUID, TEXT, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_worker_booking_payment(UUID, TEXT, NUMERIC, TEXT, TEXT) TO service_role;

COMMIT;
