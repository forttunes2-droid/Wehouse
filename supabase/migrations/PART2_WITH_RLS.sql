-- ═══════════════════════════════════════════════════════════════
-- PART 2: Property Status Flow + RLS Policies
-- Run this ENTIRE file in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- Step 1: Ensure inspection_requests has status tracking
ALTER TABLE inspection_requests 
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'inspection_requested',
  ADD COLUMN IF NOT EXISTS assigned_field_officer_id TEXT,
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inspection_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inspection_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS draft_listing_id UUID,
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

-- Step 2: Status history table
CREATE TABLE IF NOT EXISTS inspection_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_request_id UUID REFERENCES inspection_requests(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT,
  changed_by TEXT,
  changed_by_role TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 3: Enable RLS on status history
ALTER TABLE inspection_status_history ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Status history viewable by creator and admin" ON inspection_status_history;
DROP POLICY IF EXISTS "Status history insertable by authenticated" ON inspection_status_history;

-- Creator and Admin can see all status history
CREATE POLICY "Status history viewable by creator and admin"
  ON inspection_status_history FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.auth_id = auth.uid()::text 
      AND profiles.role IN ('creator', 'admin')
    )
  );

-- Staff involved in the inspection can see history
CREATE POLICY "Status history viewable by assigned staff"
  ON inspection_status_history FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM inspection_requests ir
      WHERE ir.id = inspection_status_history.inspection_request_id
      AND (
        ir.assigned_field_officer_id IN (
          SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text
        )
        OR ir.owner_id IN (
          SELECT user_id FROM profiles WHERE auth_id = auth.uid()::text
        )
      )
    )
  );

-- Authenticated users can insert (the function handles validation)
CREATE POLICY "Status history insertable by authenticated"
  ON inspection_status_history FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Step 4: Status transition function (SECURITY DEFINER bypasses RLS)
CREATE OR REPLACE FUNCTION public.transition_inspection_status(
  p_inspection_id UUID,
  p_new_status TEXT,
  p_changed_by TEXT,
  p_changed_by_role TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current_status TEXT;
  v_valid_transition BOOLEAN := FALSE;
BEGIN
  SELECT status INTO v_current_status FROM inspection_requests WHERE id = p_inspection_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  
  v_valid_transition := CASE
    WHEN v_current_status = 'inspection_requested' AND p_new_status = 'inspection_assigned' THEN TRUE
    WHEN v_current_status = 'inspection_assigned' AND p_new_status = 'inspection_in_progress' THEN TRUE
    WHEN v_current_status = 'inspection_in_progress' AND p_new_status = 'inspection_completed' THEN TRUE
    WHEN v_current_status = 'inspection_completed' AND p_new_status = 'draft' THEN TRUE
    WHEN v_current_status = 'draft' AND p_new_status = 'pending_approval' THEN TRUE
    WHEN v_current_status = 'pending_approval' AND p_new_status = 'approved' THEN TRUE
    WHEN v_current_status = 'approved' AND p_new_status = 'published' THEN TRUE
    WHEN v_current_status IN ('inspection_requested','inspection_assigned','inspection_in_progress','inspection_completed','draft','pending_approval') AND p_new_status = 'rejected' THEN TRUE
    WHEN p_new_status IN ('suspended','archived') THEN TRUE
    ELSE FALSE
  END;
  
  IF NOT v_valid_transition THEN RETURN FALSE; END IF;
  
  INSERT INTO inspection_status_history (inspection_request_id, old_status, new_status, changed_by, changed_by_role, notes)
  VALUES (p_inspection_id, v_current_status, p_new_status, p_changed_by, p_changed_by_role, p_notes);
  
  UPDATE inspection_requests 
  SET status = p_new_status,
      assigned_at = CASE WHEN p_new_status = 'inspection_assigned' THEN NOW() ELSE assigned_at END,
      inspection_started_at = CASE WHEN p_new_status = 'inspection_in_progress' THEN NOW() ELSE inspection_started_at END,
      inspection_completed_at = CASE WHEN p_new_status = 'inspection_completed' THEN NOW() ELSE inspection_completed_at END,
      approved_by = CASE WHEN p_new_status = 'approved' THEN p_changed_by ELSE approved_by END,
      approved_at = CASE WHEN p_new_status = 'approved' THEN NOW() ELSE approved_at END,
      published_at = CASE WHEN p_new_status = 'published' THEN NOW() ELSE published_at END,
      updated_at = NOW()
  WHERE id = p_inspection_id;
  
  RETURN TRUE;
END;
$$;

-- Step 5: Assign field officer function
CREATE OR REPLACE FUNCTION public.assign_field_officer(
  p_inspection_id UUID,
  p_field_officer_id TEXT,
  p_assigned_by TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE inspection_requests 
  SET assigned_field_officer_id = p_field_officer_id,
      status = 'inspection_assigned',
      assigned_at = NOW(),
      updated_at = NOW()
  WHERE id = p_inspection_id;
  
  INSERT INTO inspection_status_history (inspection_request_id, old_status, new_status, changed_by, notes)
  VALUES (p_inspection_id, 'inspection_requested', 'inspection_assigned', p_assigned_by, 'Field officer assigned: ' || p_field_officer_id);
  
  RETURN FOUND;
END;
$$;

-- Step 6: Status labels for UI
CREATE TABLE IF NOT EXISTS listing_status_labels (
  status_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  color TEXT DEFAULT '#5C5E72',
  description TEXT
);

INSERT INTO listing_status_labels (status_key, label, color, description) VALUES
  ('inspection_requested', 'Inspection Requested', '#3B82F6', 'Partner has requested an inspection'),
  ('inspection_assigned', 'Inspection Assigned', '#8B5CF6', 'A field officer has been assigned'),
  ('inspection_in_progress', 'Inspection In Progress', '#F59E0B', 'Field officer is currently inspecting'),
  ('inspection_completed', 'Inspection Completed', '#10B981', 'Inspection is complete, draft being prepared'),
  ('draft', 'Draft', '#6366F1', 'Draft listing created, awaiting review'),
  ('pending_approval', 'Pending Approval', '#F97316', 'Awaiting operations/admin/creator approval'),
  ('approved', 'Approved', '#14B8A6', 'Approved, ready to publish'),
  ('published', 'Published', '#22C55E', 'Live and visible to the public'),
  ('rejected', 'Rejected', '#EF4444', 'Rejected, partner can reapply'),
  ('suspended', 'Suspended', '#EC4899', 'Temporarily suspended'),
  ('archived', 'Archived', '#6B7280', 'Permanently archived')
ON CONFLICT (status_key) DO NOTHING;

-- Enable RLS on status labels (read-only reference data)
ALTER TABLE listing_status_labels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Status labels readable by all" ON listing_status_labels;
CREATE POLICY "Status labels readable by all"
  ON listing_status_labels FOR SELECT
  TO authenticated
  USING (true);

-- Step 7: Grant permissions
GRANT EXECUTE ON FUNCTION public.transition_inspection_status TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_field_officer TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- DONE. Run this entire file in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════
