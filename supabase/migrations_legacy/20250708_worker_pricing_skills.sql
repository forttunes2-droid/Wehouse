-- ═══════════════════════════════════════════════════════════════
-- WORKER PRICING & MULTIPLE SKILLS
-- ═══════════════════════════════════════════════════════════════

-- Step 1: Add worker_price (what the worker charges)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS worker_price INTEGER DEFAULT 0;

-- Step 2: Add worker_skills (JSON array of multiple skills)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS worker_skills JSONB DEFAULT '[]';

-- Step 3: Index for filtering by price range
CREATE INDEX IF NOT EXISTS idx_profiles_worker_price ON profiles(worker_price);

-- Step 4: worker_services table (detailed pricing per service)
CREATE TABLE IF NOT EXISTS worker_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  service_name TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0,
  price_type TEXT NOT NULL DEFAULT 'per_hour',
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_worker_services_worker ON worker_services(worker_id);

-- Step 5: RLS
ALTER TABLE worker_services ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_select ON worker_services FOR SELECT USING (true);
CREATE POLICY ws_insert ON worker_services FOR INSERT WITH CHECK (true);
CREATE POLICY ws_update ON worker_services FOR UPDATE USING (true);
CREATE POLICY ws_delete ON worker_services FOR DELETE USING (true);
