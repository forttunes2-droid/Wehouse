-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION: booking_payments Bootstrap RLS Policy
-- Date: 2025-07-31
-- Context: Frontend must create a pending booking_payments row BEFORE
--          opening the Paystack popup. Without this row,
--          confirm_booking_payment() returns 'Payment not found'.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Ensure RLS is enabled ──
ALTER TABLE IF EXISTS booking_payments ENABLE ROW LEVEL SECURITY;

-- ── 2. Policy: Authenticated users can INSERT their own PENDING records ──
-- This is the bootstrap policy. Workers insert a pending record before
-- opening Paystack. The Edge Function (service_role) later updates it.
DROP POLICY IF EXISTS "Users can insert own pending payments" ON booking_payments;
CREATE POLICY "Users can insert own pending payments"
  ON booking_payments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (auth.uid())::text
    AND status = 'pending'
  );

-- ── 3. Policy: Authenticated users can SELECT their own records ──
-- Needed for the frontend to check if a pending record already exists
-- (idempotency when retrying after cancellation).
DROP POLICY IF EXISTS "Users can select own payments" ON booking_payments;
CREATE POLICY "Users can select own payments"
  ON booking_payments
  FOR SELECT
  TO authenticated
  USING (
    user_id = (auth.uid())::text
  );

-- ── 4. Policy: Authenticated users can UPDATE their own PENDING records ──
-- Needed if the user cancels and wants to update metadata before retry.
-- Only pending records can be updated — completed/paid records are immutable.
DROP POLICY IF EXISTS "Users can update own pending payments" ON booking_payments;
CREATE POLICY "Users can update own pending payments"
  ON booking_payments
  FOR UPDATE
  TO authenticated
  USING (
    user_id = (auth.uid())::text
    AND status = 'pending'
  )
  WITH CHECK (
    user_id = (auth.uid())::text
    AND status = 'pending'
  );

-- ── 5. Staff/Creator can SELECT all (for admin dashboards) ──
-- Uses the staff/creator role check via profiles table join
DROP POLICY IF EXISTS "Staff can select all payments" ON booking_payments;
CREATE POLICY "Staff can select all payments"
  ON booking_payments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.auth_id = auth.uid()
      AND profiles.role IN ('staff', 'admin', 'creator', 'creator_admin')
    )
  );
