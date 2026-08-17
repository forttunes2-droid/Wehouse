-- Simple inspection_requests table
DROP TABLE IF EXISTS inspection_requests;

CREATE TABLE inspection_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL,
  owner_email TEXT,
  owner_phone TEXT,
  property_address TEXT NOT NULL,
  property_city TEXT NOT NULL,
  property_state TEXT,
  property_name TEXT,
  property_type TEXT DEFAULT 'house',
  bedrooms INTEGER,
  bathrooms INTEGER,
  expected_rent NUMERIC,
  description TEXT,
  notes TEXT,
  status TEXT DEFAULT 'pending',
  request_code TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE inspection_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inspection_requests_all ON inspection_requests;
CREATE POLICY inspection_requests_all ON inspection_requests FOR ALL USING (true);
