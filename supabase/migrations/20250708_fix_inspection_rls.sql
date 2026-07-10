-- inspection_requests table already exists with data
-- Just fix the RLS policy so Property Partner can read/write
ALTER TABLE inspection_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inspection_requests_all ON inspection_requests;
CREATE POLICY inspection_requests_all ON inspection_requests FOR ALL USING (true);
