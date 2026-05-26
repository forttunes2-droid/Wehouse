-- PHASE 3: Roles + Soft Delete + Role History

-- 1. Add soft delete columns to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- 2. Create role change history table
CREATE TABLE IF NOT EXISTS role_change_history (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL,
  user_email TEXT,
  old_role TEXT NOT NULL,
  new_role TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  changed_by_email TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE role_change_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rolehist_select_admin" ON role_change_history;
DROP POLICY IF EXISTS "rolehist_insert_all" ON role_change_history;

CREATE POLICY "rolehist_select_admin" ON role_change_history FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.auth_id = auth.uid()::text AND p.role IN ('creator','admin','staff'))
);

CREATE POLICY "rolehist_insert_all" ON role_change_history FOR INSERT WITH CHECK (true);
