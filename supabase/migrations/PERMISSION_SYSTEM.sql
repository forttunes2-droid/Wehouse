-- ═══════════════════════════════════════════════════════════════════
-- WEHOUSE PERMISSION SYSTEM (Production)
-- Based on We House Final Role & Permission Architecture
-- ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════
-- 1. STAFF PERMISSION COLUMN
-- ═══════════════════════════════════════════════════════════
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS staff_permission TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS staff_permissions JSONB DEFAULT NULL;

-- Valid staff permissions
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_staff_permission_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_staff_permission_check
  CHECK (staff_permission IS NULL OR staff_permission IN ('operations', 'finance', 'support', 'verification', 'field_officer'));

-- ═══════════════════════════════════════════════════════════
-- 2. PERMISSION-BASED ACCESS CONTROL FUNCTIONS
-- ═══════════════════════════════════════════════════════════

-- Check if user can access a module
CREATE OR REPLACE FUNCTION public.can_access_module(p_user_id TEXT, p_module TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role TEXT;
  v_staff_perm TEXT;
BEGIN
  SELECT role, staff_permission INTO v_role, v_staff_perm
  FROM profiles WHERE user_id = p_user_id;

  -- Creator sees everything
  IF v_role = 'creator' THEN RETURN TRUE; END IF;

  -- Admin sees everything except creator settings
  IF v_role = 'admin' AND p_module NOT IN ('creator_settings', 'assign_creator') THEN RETURN TRUE; END IF;

  -- Staff: check permission group
  IF v_role = 'staff' THEN
    CASE p_module
      WHEN 'inspections', 'listings', 'property_status' THEN
        RETURN v_staff_perm = 'operations' OR v_staff_perm = 'field_officer';
      WHEN 'payments', 'commissions', 'refunds', 'wallet_transactions' THEN
        RETURN v_staff_perm = 'finance';
      WHEN 'chats', 'tickets', 'disputes' THEN
        RETURN v_staff_perm = 'support';
      WHEN 'worker_applications', 'verification_videos', 'approve_workers' THEN
        RETURN v_staff_perm = 'verification';
      WHEN 'field_inspections', 'upload_reports', 'draft_listings' THEN
        RETURN v_staff_perm = 'field_officer';
      ELSE RETURN FALSE;
    END CASE;
  END IF;

  -- Workers see only their own data
  IF v_role = 'worker' THEN
    RETURN p_module IN ('bookings', 'calendar', 'wallet', 'jobs', 'reviews', 'profile');
  END IF;

  -- Property Partners see only their own data
  IF v_role = 'property_partner' THEN
    RETURN p_module IN ('properties', 'contracts', 'payouts', 'wallet', 'chat');
  END IF;

  -- Users (customers) see only public data
  IF v_role = 'user' THEN
    RETURN p_module IN ('browse', 'bookings', 'wallet', 'messages', 'saved', 'reviews');
  END IF;

  RETURN FALSE;
END;
$$;

-- Get dashboard tabs for a user based on role + permissions
CREATE OR REPLACE FUNCTION public.get_dashboard_tabs(p_user_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role TEXT;
  v_staff_perm TEXT;
  v_result JSONB;
BEGIN
  SELECT role, staff_permission INTO v_role, v_staff_perm FROM profiles WHERE user_id = p_user_id;

  CASE v_role
    WHEN 'creator' THEN
      v_result := '[
        {"id":"overview","label":"Overview","icon":"overview"},
        {"id":"users","label":"Users","icon":"users"},
        {"id":"workers","label":"Workers","icon":"workers"},
        {"id":"partners","label":"Partners","icon":"partners"},
        {"id":"staff","label":"Staff","icon":"staff"},
        {"id":"listings","label":"Listings","icon":"listings"},
        {"id":"bookings","label":"Bookings","icon":"bookings"},
        {"id":"reports","label":"Reports","icon":"reports"},
        {"id":"support","label":"Support","icon":"support"},
        {"id":"verification","label":"Verify","icon":"verification"},
        {"id":"announcements","label":"Announce","icon":"announce"},
        {"id":"settings","label":"Settings","icon":"settings"}
      ]'::JSONB;

    WHEN 'admin' THEN
      v_result := '[
        {"id":"overview","label":"Overview","icon":"overview"},
        {"id":"users","label":"Users","icon":"users"},
        {"id":"workers","label":"Workers","icon":"workers"},
        {"id":"partners","label":"Partners","icon":"partners"},
        {"id":"staff","label":"Staff","icon":"staff"},
        {"id":"listings","label":"Listings","icon":"listings"},
        {"id":"bookings","label":"Bookings","icon":"bookings"},
        {"id":"reports","label":"Reports","icon":"reports"},
        {"id":"support","label":"Support","icon":"support"},
        {"id":"verification","label":"Verify","icon":"verification"},
        {"id":"announcements","label":"Announce","icon":"announce"}
      ]'::JSONB;

    WHEN 'staff' THEN
      CASE v_staff_perm
        WHEN 'operations' THEN
          v_result := '[
            {"id":"overview","label":"Overview","icon":"overview"},
            {"id":"inspections","label":"Inspections","icon":"inspections"},
            {"id":"listings","label":"Listings","icon":"listings"},
            {"id":"reports","label":"Reports","icon":"reports"},
            {"id":"analytics","label":"Analytics","icon":"analytics"}
          ]'::JSONB;
        WHEN 'finance' THEN
          v_result := '[
            {"id":"overview","label":"Overview","icon":"overview"},
            {"id":"payments","label":"Payments","icon":"payments"},
            {"id":"commissions","label":"Commissions","icon":"commissions"},
            {"id":"refunds","label":"Refunds","icon":"refunds"},
            {"id":"wallet","label":"Wallet","icon":"wallet"},
            {"id":"analytics","label":"Analytics","icon":"analytics"}
          ]'::JSONB;
        WHEN 'support' THEN
          v_result := '[
            {"id":"overview","label":"Overview","icon":"overview"},
            {"id":"tickets","label":"Tickets","icon":"tickets"},
            {"id":"chats","label":"Chats","icon":"chats"},
            {"id":"disputes","label":"Disputes","icon":"disputes"},
            {"id":"analytics","label":"Analytics","icon":"analytics"}
          ]'::JSONB;
        WHEN 'verification' THEN
          v_result := '[
            {"id":"overview","label":"Overview","icon":"overview"},
            {"id":"applications","label":"Applications","icon":"applications"},
            {"id":"videos","label":"Videos","icon":"videos"},
            {"id":"approved","label":"Approved","icon":"approved"},
            {"id":"suspended","label":"Suspended","icon":"suspended"}
          ]'::JSONB;
        WHEN 'field_officer' THEN
          v_result := '[
            {"id":"overview","label":"Overview","icon":"overview"},
            {"id":"assignments","label":"Assignments","icon":"assignments"},
            {"id":"inspections","label":"Inspections","icon":"inspections"},
            {"id":"drafts","label":"Drafts","icon":"drafts"},
            {"id":"reports","label":"Reports","icon":"reports"}
          ]'::JSONB;
        ELSE
          v_result := '[
            {"id":"overview","label":"Overview","icon":"overview"},
            {"id":"settings","label":"Settings","icon":"settings"}
          ]'::JSONB;
      END CASE;

    WHEN 'worker' THEN
      v_result := '[
        {"id":"overview","label":"Overview","icon":"overview"},
        {"id":"bookings","label":"Bookings","icon":"bookings"},
        {"id":"calendar","label":"Calendar","icon":"calendar"},
        {"id":"wallet","label":"Wallet","icon":"wallet"},
        {"id":"services","label":"Services","icon":"services"},
        {"id":"verification","label":"Status","icon":"verification"},
        {"id":"profile","label":"Profile","icon":"profile"}
      ]'::JSONB;

    WHEN 'property_partner' THEN
      v_result := '[
        {"id":"overview","label":"Overview","icon":"overview"},
        {"id":"listings","label":"Listings","icon":"listings"},
        {"id":"bookings","label":"Bookings","icon":"bookings"},
        {"id":"analytics","label":"Analytics","icon":"analytics"},
        {"id":"profile","label":"Profile","icon":"profile"}
      ]'::JSONB;

    WHEN 'user' THEN
      v_result := '[
        {"id":"home","label":"Home","icon":"home"},
        {"id":"search","label":"Search","icon":"search"},
        {"id":"saved","label":"Saved","icon":"saved"},
        {"id":"hotels","label":"Hotels","icon":"hotels"},
        {"id":"messages","label":"Messages","icon":"messages"},
        {"id":"wallet","label":"Wallet","icon":"wallet"},
        {"id":"roommates","label":"Roommates","icon":"roommates"},
        {"id":"workers","label":"Workers","icon":"workers"},
        {"id":"profile","label":"Profile","icon":"profile"}
      ]'::JSONB;

    ELSE
      v_result := '[{"id":"home","label":"Home","icon":"home"}]'::JSONB;
  END CASE;

  RETURN v_result;
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 3. PROTECT CREATOR FROM ADMIN ACTIONS
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.can_modify_user(p_modifier_id TEXT, p_target_id TEXT, p_action TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_modifier_role TEXT;
  v_target_role TEXT;
BEGIN
  SELECT role INTO v_modifier_role FROM profiles WHERE user_id = p_modifier_id;
  SELECT role INTO v_target_role FROM profiles WHERE user_id = p_target_id;

  -- Creator cannot be modified by anyone
  IF v_target_role = 'creator' THEN
    RETURN jsonb_build_object('allowed', FALSE, 'reason', 'Creator account is protected and cannot be modified');
  END IF;

  -- Admin can only modify users below them
  IF v_modifier_role = 'admin' THEN
    IF v_target_role IN ('creator', 'admin') THEN
      RETURN jsonb_build_object('allowed', FALSE, 'reason', 'Admin cannot modify Creator or other Admin accounts');
    END IF;
    RETURN jsonb_build_object('allowed', TRUE);
  END IF;

  -- Creator can modify anyone
  IF v_modifier_role = 'creator' THEN
    RETURN jsonb_build_object('allowed', TRUE);
  END IF;

  RETURN jsonb_build_object('allowed', FALSE, 'reason', 'Insufficient permissions');
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 4. GRANT PERMISSIONS
-- ═══════════════════════════════════════════════════════════

GRANT EXECUTE ON FUNCTION public.can_access_module TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_tabs TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_modify_user TO authenticated;

-- ═══════════════════════════════════════════════════════════
-- 5. ENABLE PGCRYPTO (for password hashing)
-- ═══════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ═══════════════════════════════════════════════════════════
-- 6. CREATOR AUTH FUNCTIONS
-- ═══════════════════════════════════════════════════════════
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS creator_auth_password TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS creator_auth_enabled BOOLEAN DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.set_creator_auth_v2(p_user_id TEXT, p_password TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_salt TEXT;
BEGIN
  IF p_password IS NULL OR length(p_password) < 4 THEN RETURN FALSE; END IF;
  v_salt := gen_salt('bf');
  UPDATE profiles SET creator_auth_password = crypt(p_password, v_salt), creator_auth_enabled = TRUE, auth_id = COALESCE(auth_id, p_user_id)
  WHERE auth_id = p_user_id OR (role = 'creator' AND auth_id IS NULL);
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_creator_auth_v2(p_user_id TEXT, p_password TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_hash TEXT; v_found BOOLEAN := FALSE;
BEGIN
  SELECT creator_auth_password INTO v_hash FROM profiles WHERE auth_id = p_user_id OR (role = 'creator' AND auth_id IS NULL);
  IF v_hash IS NULL THEN RETURN FALSE; END IF;
  v_found := (v_hash = crypt(p_password, v_hash));
  IF v_found THEN UPDATE profiles SET auth_id = COALESCE(auth_id, p_user_id) WHERE role = 'creator'; END IF;
  RETURN v_found;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_creator_auth_status_v2(p_user_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_password TEXT; v_enabled BOOLEAN;
BEGIN
  SELECT creator_auth_password, creator_auth_enabled INTO v_password, v_enabled FROM profiles
  WHERE auth_id = p_user_id OR (role = 'creator' AND auth_id IS NULL);
  RETURN jsonb_build_object('has_password', v_password IS NOT NULL, 'enabled', COALESCE(v_enabled, FALSE));
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_creator_auth_v2 TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_creator_auth_v2 TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_creator_auth_status_v2 TO authenticated;
