-- ═══════════════════════════════════════════════════════════════
-- ADD: conversation_type column to conversations
-- ═══════════════════════════════════════════════════════════════

-- Add type column if it doesn't exist
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS conversation_type TEXT DEFAULT 'direct';

-- Add index for filtering by type
CREATE INDEX IF NOT EXISTS idx_conversations_type ON conversations(conversation_type);

-- Add subject/title for support conversations
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS subject TEXT;

-- Update existing partner support conversations (participant_a is a property_partner)
UPDATE conversations
SET conversation_type = 'partner_support'
WHERE conversation_type = 'direct'
  AND EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.user_id = conversations.participant_a
      AND p.role = 'property_partner'
  );
