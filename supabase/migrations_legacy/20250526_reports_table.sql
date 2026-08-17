-- STEP 4: LISTING REPORTS TABLE
CREATE TABLE IF NOT EXISTS listing_reports (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  reporter_id TEXT NOT NULL,
  listing_id TEXT,
  reported_user_id TEXT,
  reason TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  resolved_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

ALTER TABLE listing_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reports_select_admin" ON listing_reports;
DROP POLICY IF EXISTS "reports_insert_all" ON listing_reports;
DROP POLICY IF EXISTS "reports_update_admin" ON listing_reports;

CREATE POLICY "reports_select_admin" ON listing_reports FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.auth_id = auth.uid()::text AND p.role IN ('creator','admin','staff'))
);

CREATE POLICY "reports_insert_all" ON listing_reports FOR INSERT WITH CHECK (true);

CREATE POLICY "reports_update_admin" ON listing_reports FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.auth_id = auth.uid()::text AND p.role IN ('creator','admin','staff'))
);
