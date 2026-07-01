-- Phase 4 Revenue Fixes - Using existing Paystack
-- Fix reservations and bookings

-- Reservations table improvements
ALTER TABLE IF EXISTS reservations 
ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS paystack_reference TEXT;

-- Simple policy for reservations
CREATE POLICY IF NOT EXISTS "Users manage own reservations" ON reservations
FOR ALL USING (auth.uid() = user_id);

-- Link payments to unlock
COMMENT ON TABLE reservations IS 'Payment unlocks reservation - existing Paystack used';