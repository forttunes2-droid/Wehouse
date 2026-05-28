-- ============================================================
-- IMAGE DUPLICATE DETECTION SYSTEM
-- Supabase Edge Function + Database Setup
-- ============================================================

-- 1. Create table to store image hashes
CREATE TABLE IF NOT EXISTS listing_image_hashes (
  id SERIAL PRIMARY KEY,
  listing_id TEXT NOT NULL,
  image_url TEXT NOT NULL,
  image_hash TEXT NOT NULL,  -- 16-char hex aHash
  similarity_score NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_image_hashes_listing ON listing_image_hashes(listing_id);
CREATE INDEX IF NOT EXISTS idx_image_hashes_hash ON listing_image_hashes(image_hash);

-- 3. Open RLS (Edge Function uses service role key, but good practice)
ALTER TABLE listing_image_hashes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS "image_hashes_all" ON listing_image_hashes;
  CREATE POLICY "image_hashes_all" ON listing_image_hashes
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Policy setup: %', SQLERRM;
END $$;

-- 4. Add to realtime
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE listing_image_hashes;
EXCEPTION WHEN undefined_object THEN
  RAISE NOTICE 'Skipping realtime — add manually in Supabase dashboard if needed';
END $$;
