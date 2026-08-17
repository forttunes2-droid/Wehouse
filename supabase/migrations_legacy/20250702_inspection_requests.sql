-- ============================================================
-- INSPECTION REQUESTS TABLE
-- Property owners submit inspection requests through the app.
-- WeHouse staff reviews, schedules, and approves them.
-- ============================================================

CREATE TABLE IF NOT EXISTS inspection_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_code TEXT UNIQUE NOT NULL,        -- e.g. "WHIR-00001"
  owner_id TEXT NOT NULL REFERENCES profiles(user_id),
  owner_email TEXT NOT NULL,
  owner_phone TEXT,
  property_address TEXT NOT NULL,
  property_city TEXT NOT NULL,
  property_state TEXT NOT NULL,
  property_type TEXT CHECK (property_type IN ('apartment', 'house', 'self_contain', 'mini_flat', 'duplex', 'bungalow', 'mansion')),
  bedrooms INTEGER,
  bathrooms INTEGER,
  expected_rent DECIMAL(12,2),
  description TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'scheduled', 'in_progress', 'approved', 'rejected', 'completed')),
  assigned_to TEXT REFERENCES profiles(user_id),  -- field officer
  scheduled_date DATE,
  completed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  notes TEXT,                                 -- staff notes
  photo_urls TEXT[] DEFAULT '{}',
  document_urls TEXT[] DEFAULT '{}',
  gps_latitude DECIMAL(10, 8),
  gps_longitude DECIMAL(11, 8),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inspection_requests_owner ON inspection_requests(owner_id);
CREATE INDEX IF NOT EXISTS idx_inspection_requests_status ON inspection_requests(status);
CREATE INDEX IF NOT EXISTS idx_inspection_requests_assigned ON inspection_requests(assigned_to);

-- RLS: owners see their own requests, staff see all
ALTER TABLE inspection_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inspection_requests_owner" ON inspection_requests;
DROP POLICY IF EXISTS "inspection_requests_staff" ON inspection_requests;
CREATE POLICY "inspection_requests_owner" ON inspection_requests
  FOR ALL TO authenticated
  USING (owner_id = auth.uid()::text OR role IN ('staff','admin','state_admin','assistant_state_admin','director','creator','creator_admin'));
