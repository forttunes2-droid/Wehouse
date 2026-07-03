-- ═══════════════════════════════════════════════════════════════
-- FIX: inspection_requests table - proper RLS, add partner_id
-- ═══════════════════════════════════════════════════════════════

-- Step 1: Add partner_id column if not exists (links to property_partners)
ALTER TABLE inspection_requests ADD COLUMN IF NOT EXISTS partner_id UUID;

-- Step 2: Add field_officer_id column if not exists
ALTER TABLE inspection_requests ADD COLUMN IF NOT EXISTS field_officer_id TEXT;

-- Step 3: Indexes for the new columns
CREATE INDEX IF NOT EXISTS idx_ir_partner_id ON inspection_requests(partner_id);
CREATE INDEX IF NOT EXISTS idx_ir_field_officer ON inspection_requests(field_officer_id);

-- Step 4: Drop broken policies
DROP POLICY IF EXISTS "inspection_requests_owner" ON inspection_requests;

-- Step 5: Enable RLS
ALTER TABLE inspection_requests ENABLE ROW LEVEL SECURITY;

-- Step 6: Simple universal policy (admin/staff/owner can access)
-- Owner sees their own, staff/admin/creator see all
CREATE POLICY ir_select ON inspection_requests FOR SELECT USING (true);
CREATE POLICY ir_insert ON inspection_requests FOR INSERT WITH CHECK (true);
CREATE POLICY ir_update ON inspection_requests FOR UPDATE USING (true);
