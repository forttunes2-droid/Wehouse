-- ═══════════════════════════════════════════════════════════════
-- USER INSPECTION REQUESTS TABLE
-- For users who reserved a property and want inspection before paying rent
-- ═══════════════════════════════════════════════════════════════

-- Step 1: Add rental plan columns to reservations table
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS rental_plan_years INTEGER DEFAULT 1;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS rental_plan_selected_at TIMESTAMPTZ;

-- Step 2: Create user_inspection_requests table
CREATE TABLE IF NOT EXISTS user_inspection_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reservation_id UUID REFERENCES reservations(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  field_officer_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  scheduled_date TIMESTAMPTZ,
  notes TEXT,
  report TEXT,
  condition TEXT,
  photo_urls TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Step 3: Indexes
CREATE INDEX IF NOT EXISTS idx_uir_user_id ON user_inspection_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_uir_listing_id ON user_inspection_requests(listing_id);
CREATE INDEX IF NOT EXISTS idx_uir_field_officer ON user_inspection_requests(field_officer_id);
CREATE INDEX IF NOT EXISTS idx_uir_status ON user_inspection_requests(status);
CREATE INDEX IF NOT EXISTS idx_uir_reservation ON user_inspection_requests(reservation_id);

-- Step 4: Enable RLS
ALTER TABLE user_inspection_requests ENABLE ROW LEVEL SECURITY;

-- Step 5: Policies
CREATE POLICY uir_select ON user_inspection_requests FOR SELECT USING (true);
CREATE POLICY uir_insert ON user_inspection_requests FOR INSERT WITH CHECK (true);
CREATE POLICY uir_update ON user_inspection_requests FOR UPDATE USING (true);
