-- ═══════════════════════════════════════════════════════════════
-- PASSWORD FIX V3 + Missing Tables
-- 
-- The problem: Frontend couldn't look up profile because RLS blocked it.
-- The fix: Functions take Supabase UUID (auth.uid) and do lookup internally.
-- SECURITY DEFINER bypasses RLS so the lookup works.
-- ═══════════════════════════════════════════════════════════════

-- ============================================================
-- 1. DROP ALL OLD FUNCTION VERSIONS (clean slate)
-- ============================================================
DROP FUNCTION IF EXISTS public.set_creator_auth(text);
DROP FUNCTION IF EXISTS public.verify_creator_auth(text);
DROP FUNCTION IF EXISTS public.set_creator_auth(text, text);
DROP FUNCTION IF EXISTS public.verify_creator_auth(text, text);
DROP FUNCTION IF EXISTS public.get_creator_auth_status(text);
DROP FUNCTION IF EXISTS public.set_creator_auth_v2(text, text);
DROP FUNCTION IF EXISTS public.verify_creator_auth_v2(text, text);
DROP FUNCTION IF EXISTS public.get_creator_auth_status_v2(text);
DROP FUNCTION IF EXISTS public.set_admin_auth_v2(text, text);
DROP FUNCTION IF EXISTS public.verify_admin_auth_v2(text, text);
DROP FUNCTION IF EXISTS public.get_admin_auth_status_v2(text);
DROP FUNCTION IF EXISTS public.creator_auth_set_v3(text, text);
DROP FUNCTION IF EXISTS public.creator_auth_verify_v3(text, text);
DROP FUNCTION IF EXISTS public.creator_auth_status_v3(text);
DROP FUNCTION IF EXISTS public.admin_auth_set_v3(text, text);
DROP FUNCTION IF EXISTS public.admin_auth_verify_v3(text, text);
DROP FUNCTION IF EXISTS public.admin_auth_status_v3(text);

-- ============================================================
-- 2. ENABLE pgcrypto (for crypt/gen_salt)
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 3. ENSURE PASSWORD COLUMNS EXIST
-- ============================================================
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS creator_auth_password TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS creator_auth_enabled BOOLEAN DEFAULT FALSE;

-- ============================================================
-- 4. CREATOR AUTH V3 — takes Supabase UUID, finds creator internally
-- ============================================================

-- SET password (first time or change)
CREATE OR REPLACE FUNCTION public.creator_auth_set_v3(p_auth_id TEXT, p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_salt TEXT; v_creator RECORD;
BEGIN
  IF p_password IS NULL OR length(p_password) < 4 THEN RETURN FALSE; END IF;
  
  -- Find creator by auth_id (bypasses RLS because SECURITY DEFINER)
  SELECT * INTO v_creator FROM profiles WHERE auth_id = p_auth_id AND role = 'creator';
  
  -- Fallback: any creator profile (for manually seeded accounts)
  IF v_creator.user_id IS NULL THEN
    SELECT * INTO v_creator FROM profiles WHERE role = 'creator' ORDER BY created_at LIMIT 1;
  END IF;
  
  IF v_creator.user_id IS NULL THEN RETURN FALSE; END IF;
  
  v_salt := gen_salt('bf');
  
  -- Save password + link auth_id if not set
  UPDATE profiles 
  SET creator_auth_password = crypt(p_password, v_salt),
      creator_auth_enabled = TRUE,
      auth_id = COALESCE(auth_id, p_auth_id)
  WHERE user_id = v_creator.user_id;
  
  RETURN FOUND;
END;
$$;

-- VERIFY password
CREATE OR REPLACE FUNCTION public.creator_auth_verify_v3(p_auth_id TEXT, p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_hash TEXT; v_found BOOLEAN := FALSE;
BEGIN
  -- Find creator's password hash
  SELECT creator_auth_password INTO v_hash 
  FROM profiles 
  WHERE (auth_id = p_auth_id AND role = 'creator') OR role = 'creator'
  ORDER BY CASE WHEN auth_id = p_auth_id THEN 0 ELSE 1 END
  LIMIT 1;
  
  IF v_hash IS NULL THEN RETURN FALSE; END IF;
  
  v_found := (v_hash = crypt(p_password, v_hash));
  
  -- Link auth_id if verified
  IF v_found THEN 
    UPDATE profiles SET auth_id = COALESCE(auth_id, p_auth_id) WHERE role = 'creator' AND auth_id IS NULL;
  END IF;
  
  RETURN v_found;
END;
$$;

-- GET status (has password?)
CREATE OR REPLACE FUNCTION public.creator_auth_status_v3(p_auth_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_password TEXT; v_enabled BOOLEAN;
BEGIN
  SELECT creator_auth_password, creator_auth_enabled 
  INTO v_password, v_enabled
  FROM profiles 
  WHERE (auth_id = p_auth_id AND role = 'creator') OR role = 'creator'
  ORDER BY CASE WHEN auth_id = p_auth_id THEN 0 ELSE 1 END
  LIMIT 1;
  
  RETURN jsonb_build_object(
    'has_password', v_password IS NOT NULL,
    'enabled', COALESCE(v_enabled, FALSE)
  );
END;
$$;

-- ============================================================
-- 5. ADMIN AUTH V3 — same pattern
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_auth_set_v3(p_auth_id TEXT, p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_salt TEXT; v_admin RECORD;
BEGIN
  IF p_password IS NULL OR length(p_password) < 4 THEN RETURN FALSE; END IF;
  SELECT * INTO v_admin FROM profiles WHERE auth_id = p_auth_id AND role IN ('admin', 'staff', 'director');
  IF v_admin.user_id IS NULL THEN SELECT * INTO v_admin FROM profiles WHERE role IN ('admin', 'staff', 'director') ORDER BY created_at LIMIT 1; END IF;
  IF v_admin.user_id IS NULL THEN RETURN FALSE; END IF;
  v_salt := gen_salt('bf');
  UPDATE profiles SET creator_auth_password = crypt(p_password, v_salt), creator_auth_enabled = TRUE, auth_id = COALESCE(auth_id, p_auth_id) WHERE user_id = v_admin.user_id;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_auth_verify_v3(p_auth_id TEXT, p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_hash TEXT;
BEGIN
  SELECT creator_auth_password INTO v_hash FROM profiles WHERE (auth_id = p_auth_id AND role IN ('admin', 'staff', 'director')) OR role IN ('admin', 'staff', 'director') ORDER BY CASE WHEN auth_id = p_auth_id THEN 0 ELSE 1 END LIMIT 1;
  IF v_hash IS NULL THEN RETURN FALSE; END IF;
  RETURN (v_hash = crypt(p_password, v_hash));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_auth_status_v3(p_auth_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_password TEXT; v_enabled BOOLEAN;
BEGIN
  SELECT creator_auth_password, creator_auth_enabled INTO v_password, v_enabled FROM profiles WHERE (auth_id = p_auth_id AND role IN ('admin', 'staff', 'director')) OR role IN ('admin', 'staff', 'director') ORDER BY CASE WHEN auth_id = p_auth_id THEN 0 ELSE 1 END LIMIT 1;
  RETURN jsonb_build_object('has_password', v_password IS NOT NULL, 'enabled', COALESCE(v_enabled, FALSE));
END;
$$;

-- ============================================================
-- 6. MISSING TABLES (booking_status_labels, worker_bookings, etc.)
-- ============================================================

CREATE TABLE IF NOT EXISTS booking_status_labels (
  status_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  color TEXT DEFAULT '#5C5E72',
  description TEXT,
  sort_order INT DEFAULT 0
);
INSERT INTO booking_status_labels (status_key, label, color, description, sort_order) VALUES
  ('pending', 'Pending', '#F59E0B', 'Booking request sent', 1),
  ('accepted', 'Accepted', '#3B82F6', 'Worker accepted', 2),
  ('awaiting_payment', 'Awaiting Payment', '#8B5CF6', 'Payment required', 3),
  ('paid', 'Paid', '#22C55E', 'Payment in escrow', 4),
  ('in_progress', 'In Progress', '#06B6D4', 'Worker on the job', 5),
  ('completed', 'Completed', '#14B8A6', 'Job done', 6),
  ('confirmed', 'Confirmed', '#10B981', 'User confirmed', 7),
  ('cancelled', 'Cancelled', '#EF4444', 'Cancelled', 8),
  ('disputed', 'Disputed', '#EC4899', 'Under dispute', 9),
  ('refunded', 'Refunded', '#6B7280', 'Refunded', 10)
ON CONFLICT (status_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS worker_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES profiles(user_id),
  worker_id TEXT NOT NULL REFERENCES profiles(user_id),
  service_type TEXT,
  agreed_price NUMERIC NOT NULL DEFAULT 0,
  wehouse_fee NUMERIC NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  commission_percent NUMERIC NOT NULL DEFAULT 10,
  status TEXT DEFAULT 'pending',
  scheduled_date DATE,
  scheduled_time TEXT,
  address TEXT,
  notes TEXT,
  paystack_reference TEXT,
  paystack_status TEXT,
  paid_at TIMESTAMPTZ,
  worker_completed_at TIMESTAMPTZ,
  user_confirmed_at TIMESTAMPTZ,
  dispute_period_ends_at TIMESTAMPTZ,
  escrow_released_at TIMESTAMPTZ,
  released_amount NUMERIC DEFAULT 0,
  cancelled_by TEXT,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS booking_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES worker_bookings(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT,
  changed_by TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES profiles(user_id),
  account_number TEXT NOT NULL,
  bank_code TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  account_name TEXT,
  paystack_recipient_code TEXT,
  is_default BOOLEAN DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, account_number, bank_code)
);

CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  user_id TEXT NOT NULL REFERENCES profiles(user_id),
  amount NUMERIC NOT NULL,
  bank_account_number TEXT,
  bank_code TEXT,
  bank_name TEXT,
  account_name TEXT,
  paystack_transfer_code TEXT,
  paystack_status TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  processed_at TIMESTAMPTZ,
  failed_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 7. PERMISSIONS
-- ============================================================
GRANT EXECUTE ON FUNCTION public.creator_auth_set_v3 TO authenticated;
GRANT EXECUTE ON FUNCTION public.creator_auth_verify_v3 TO authenticated;
GRANT EXECUTE ON FUNCTION public.creator_auth_status_v3 TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_auth_set_v3 TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_auth_verify_v3 TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_auth_status_v3 TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- DONE. Run this ENTIRE file. No function conflicts.
-- ═══════════════════════════════════════════════════════════════
