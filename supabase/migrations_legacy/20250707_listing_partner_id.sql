-- Add partner_id column to listings table
ALTER TABLE listings ADD COLUMN IF NOT EXISTS partner_id TEXT;

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_listings_partner_id ON listings(partner_id);
