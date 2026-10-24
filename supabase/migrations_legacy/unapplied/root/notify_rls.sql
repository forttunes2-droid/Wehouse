-- NOTIFICATIONS — user_id is inside metadata JSONB field
-- We check if metadata->>'user_id' matches the auth user

DROP POLICY IF EXISTS "notifications_select" ON notifications;
DROP POLICY IF EXISTS "notifications_insert" ON notifications;

CREATE POLICY "notifications_select" ON notifications FOR SELECT USING (
  metadata->>'user_id' = (auth.uid())::text
  OR metadata->>'target_id' = (auth.uid())::text
  OR EXISTS (SELECT 1 FROM profiles WHERE user_id = (auth.uid())::text AND role IN ('director','creator'))
);
CREATE POLICY "notifications_insert" ON notifications FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE user_id = (auth.uid())::text AND role IN ('staff','admin','assistant_state_admin','state_admin','director','creator'))
);
