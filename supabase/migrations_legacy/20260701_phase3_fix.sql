-- Phase 3 Database Fixes
-- Audit and fixes for tables, relationships, RLS

-- 1. Fix workers table (keep separate from profiles)
ALTER TABLE IF EXISTS workers 
ADD CONSTRAINT IF NOT EXISTS fk_worker_profile 
FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- 2. Fix messages and conversations
ALTER TABLE IF EXISTS messages 
ADD CONSTRAINT IF NOT EXISTS fk_message_conversation 
FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;

-- 3. Strong security rules (RLS)
-- Listings - Admin only
CREATE POLICY IF NOT EXISTS "Staff manage listings" ON listings
FOR ALL USING (auth.role() = 'service_role' OR (auth.jwt() ->> 'user_role' = 'admin'));

-- Messages - Only participants
CREATE POLICY IF NOT EXISTS "Users see own messages" ON messages
FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

-- Workers - Public read verified, owner write
CREATE POLICY IF NOT EXISTS "Public read verified workers" ON workers
FOR SELECT USING (verification_status = 'verified');

-- Clean old stuff (if any)
DROP POLICY IF EXISTS "old_premium_policy" ON profiles;