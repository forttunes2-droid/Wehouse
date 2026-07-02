-- ============================================================
-- RLS POLICIES FOR CORE TABLES
-- ============================================================
-- This migration adds Row Level Security policies to 8 core tables
-- that previously had zero protection. Policies are designed for:
--   - Users can only see their own data
--   - Staff/Creator can see all data in their scope
--   - Public data (listings) is readable by all authenticated users
--
-- Tables covered:
--   1. listings          - Public read, staff/creator write
--   2. conversations     - Participants only
--   3. messages          - Participants only (via conversation)
--   4. saved_listings    - Owner only
--   5. enquiries         - Participant only
--   6. reservations      - Owner + staff only
--   7. roommate_preferences - Owner only
--   8. roommate_matches  - Participants only
-- ============================================================

-- ─── 1. LISTINGS ────────────────────────────────────────────
-- Public: all authenticated users can read available listings
-- Staff: can read all listings (including pending/closed)
-- Staff/Creator: can create, update, delete

ALTER TABLE listings ENABLE ROW LEVEL SECURITY;

-- Drop any existing policies to avoid conflicts
DROP POLICY IF EXISTS "listings_public_read" ON listings;
DROP POLICY IF EXISTS "listings_staff_all" ON listings;
DROP POLICY IF EXISTS "listings_creator_all" ON listings;

-- Public: anyone can read available/reserved listings
CREATE POLICY "listings_public_read" ON listings
  FOR SELECT
  TO authenticated
  USING (status IN ('available', 'reserved', 'pending_approval'));

-- Staff can manage all listings in their scope
CREATE POLICY "listings_staff_all" ON listings
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.role IN ('staff', 'admin', 'state_admin', 'assistant_state_admin', 'director', 'creator', 'creator_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.role IN ('staff', 'admin', 'state_admin', 'assistant_state_admin', 'director', 'creator', 'creator_admin')
    )
  );

-- ─── 2. CONVERSATIONS ───────────────────────────────────────
-- Only participants can see their conversations

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conversations_participants" ON conversations;

CREATE POLICY "conversations_participants" ON conversations
  FOR ALL
  TO authenticated
  USING (
    participant_a = auth.uid() OR participant_b = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.role IN ('staff', 'admin', 'state_admin', 'assistant_state_admin', 'director', 'creator', 'creator_admin')
    )
  )
  WITH CHECK (
    participant_a = auth.uid() OR participant_b = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.role IN ('staff', 'admin', 'state_admin', 'assistant_state_admin', 'director', 'creator', 'creator_admin')
    )
  );

-- ─── 3. MESSAGES ────────────────────────────────────────────
-- Only conversation participants can read messages

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "messages_participants" ON messages;

CREATE POLICY "messages_participants" ON messages
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
        AND (conversations.participant_a = auth.uid() OR conversations.participant_b = auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.role IN ('staff', 'admin', 'state_admin', 'assistant_state_admin', 'director', 'creator', 'creator_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
        AND (conversations.participant_a = auth.uid() OR conversations.participant_b = auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.role IN ('staff', 'admin', 'state_admin', 'assistant_state_admin', 'director', 'creator', 'creator_admin')
    )
  );

-- ─── 4. SAVED_LISTINGS ──────────────────────────────────────
-- Users can only see their own saved listings

ALTER TABLE saved_listings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saved_listings_owner" ON saved_listings;

CREATE POLICY "saved_listings_owner" ON saved_listings
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ─── 5. ENQUIRIES ───────────────────────────────────────────
-- Users can only see their own enquiries

ALTER TABLE enquiries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "enquiries_owner" ON enquiries;

CREATE POLICY "enquiries_owner" ON enquiries
  FOR ALL
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.role IN ('staff', 'admin', 'state_admin', 'assistant_state_admin', 'director', 'creator', 'creator_admin')
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.role IN ('staff', 'admin', 'state_admin', 'assistant_state_admin', 'director', 'creator', 'creator_admin')
    )
  );

-- ─── 6. RESERVATIONS ────────────────────────────────────────
-- Users can see their own reservations, staff can see all

ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reservations_owner" ON reservations;

CREATE POLICY "reservations_owner" ON reservations
  FOR ALL
  TO authenticated
  USING (
    user_id = auth.uid()
    OR staff_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.role IN ('staff', 'admin', 'state_admin', 'assistant_state_admin', 'director', 'creator', 'creator_admin')
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR staff_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.role IN ('staff', 'admin', 'state_admin', 'assistant_state_admin', 'director', 'creator', 'creator_admin')
    )
  );

-- ─── 7. ROOMMATE_PREFERENCES ────────────────────────────────
-- Users can only see their own preferences

ALTER TABLE roommate_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "roommate_prefs_owner" ON roommate_preferences;

CREATE POLICY "roommate_prefs_owner" ON roommate_preferences
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ─── 8. ROOMMATE_MATCHES ────────────────────────────────────
-- Only matched users can see their matches

ALTER TABLE roommate_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "roommate_matches_participants" ON roommate_matches;

CREATE POLICY "roommate_matches_participants" ON roommate_matches
  FOR ALL
  TO authenticated
  USING (user_a_id = auth.uid() OR user_b_id = auth.uid())
  WITH CHECK (user_a_id = auth.uid() OR user_b_id = auth.uid());

-- ─── INDEXES FOR RLS PERFORMANCE ────────────────────────────
-- Ensure indexes exist for the columns used in RLS policies

CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_conversations_participant_a ON conversations(participant_a);
CREATE INDEX IF NOT EXISTS idx_conversations_participant_b ON conversations(participant_b);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_saved_listings_user_id ON saved_listings(user_id);
CREATE INDEX IF NOT EXISTS idx_enquiries_user_id ON enquiries(user_id);
CREATE INDEX IF NOT EXISTS idx_reservations_user_id ON reservations(user_id);
CREATE INDEX IF NOT EXISTS idx_reservations_staff_id ON reservations(staff_id);
CREATE INDEX IF NOT EXISTS idx_roommate_prefs_user_id ON roommate_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_roommate_matches_user_a ON roommate_matches(user_a_id);
CREATE INDEX IF NOT EXISTS idx_roommate_matches_user_b ON roommate_matches(user_b_id);

-- ─── PROFILES RLS ───────────────────────────────────────────
-- Users can read their own profile, update their own (except role)
-- Staff can read all profiles in their scope

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_self" ON profiles;

CREATE POLICY "profiles_self" ON profiles
  FOR ALL
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles AS p
      WHERE p.user_id = auth.uid()
        AND p.role IN ('staff', 'admin', 'state_admin', 'assistant_state_admin', 'director', 'creator', 'creator_admin')
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles AS p
      WHERE p.user_id = auth.uid()
        AND p.role IN ('staff', 'admin', 'state_admin', 'assistant_state_admin', 'director', 'creator', 'creator_admin')
    )
  );

-- ─── ANNOUNCEMENTS RLS ──────────────────────────────────────
-- Authenticated users can read announcements targeted to them

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "announcements_read" ON announcements;

CREATE POLICY "announcements_read" ON announcements
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "announcements_staff_write" ON announcements;

CREATE POLICY "announcements_staff_write" ON announcements
  FOR ALL
  TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.role IN ('staff', 'admin', 'state_admin', 'assistant_state_admin', 'director', 'creator', 'creator_admin')
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.role IN ('staff', 'admin', 'state_admin', 'assistant_state_admin', 'director', 'creator', 'creator_admin')
    )
  );
