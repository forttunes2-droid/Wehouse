-- ═══════════════════════════════════════════════════════════════
-- RPC: Admin role management (bypasses RLS)
-- ═══════════════════════════════════════════════════════════════

-- Function to update user role (runs as admin, bypasses RLS)
CREATE OR REPLACE FUNCTION admin_update_role(
  target_user_id TEXT,
  new_role TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE profiles SET role = new_role WHERE user_id = target_user_id;
END;
$$;

-- Function to suspend a user
CREATE OR REPLACE FUNCTION admin_suspend_user(
  target_user_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE profiles SET worker_status = 'suspended', updated_at = now() WHERE user_id = target_user_id;
END;
$$;

-- Function to ban a user
CREATE OR REPLACE FUNCTION admin_ban_user(
  target_user_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE profiles SET deleted = true, deleted_at = now(), worker_status = 'suspended', updated_at = now() WHERE user_id = target_user_id;
END;
$$;

-- Function to reactivate a user
CREATE OR REPLACE FUNCTION admin_reactivate_user(
  target_user_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE profiles SET deleted = false, deleted_at = null, worker_status = 'pending', updated_at = now() WHERE user_id = target_user_id;
END;
$$;

-- Function to toggle maintenance exempt
CREATE OR REPLACE FUNCTION admin_toggle_exempt(
  target_user_id TEXT,
  exempt BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE profiles SET maintenance_exempt = exempt, updated_at = now() WHERE user_id = target_user_id;
END;
$$;
