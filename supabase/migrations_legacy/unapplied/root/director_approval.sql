-- ═══════════════════════════════════════════════════════════
-- WeHouse: Director Role + Listing Approval System
-- Run this in your Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════

-- ─── 1. ADD NEW COLUMNS TO LISTINGS TABLE ────────────────

-- Add submitted_by_role to track who posted the listing
ALTER TABLE listings ADD COLUMN IF NOT EXISTS submitted_by_role TEXT;

-- Add approved_by to track who approved the listing
ALTER TABLE listings ADD COLUMN IF NOT EXISTS approved_by TEXT REFERENCES profiles(user_id);

-- Add approved_at timestamp
ALTER TABLE listings ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE;

-- Add rejection_reason for rejected listings
ALTER TABLE listings ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- ─── 2. UPDATE EXISTING LISTINGS ─────────────────────────
-- Set all existing listings as approved (they were posted before the system)
UPDATE listings SET submitted_by_role = 'creator', status = 'available', availability_status = 'available' WHERE submitted_by_role IS NULL;

-- ─── 3. ADD INDEXES FOR PERFORMANCE ──────────────────────
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_submitted_by_role ON listings(submitted_by_role);
CREATE INDEX IF NOT EXISTS idx_listings_approved_by ON listings(approved_by);

-- ─── 4. VERIFY COLUMNS EXIST ─────────────────────────────
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'listings' 
AND column_name IN ('submitted_by_role', 'approved_by', 'approved_at', 'rejection_reason');
