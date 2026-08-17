-- LISTING VIDEO STORAGE
-- Support for mp4, mov, webm video uploads

-- 1. Create listing-videos bucket
INSERT INTO storage.buckets (id, name, public) 
VALUES ('listing-videos', 'listing-videos', true)
ON CONFLICT (id) DO NOTHING;

UPDATE storage.buckets SET public = true WHERE id = 'listing-videos';

-- 2. RLS: Public read
DROP POLICY IF EXISTS "videos_select_public" ON storage.objects;
CREATE POLICY "videos_select_public" ON storage.objects
  FOR SELECT USING (bucket_id = 'listing-videos');

-- 3. RLS: Authenticated upload
DROP POLICY IF EXISTS "videos_insert_auth" ON storage.objects;
CREATE POLICY "videos_insert_auth" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'listing-videos');

-- 4. RLS: Authenticated update/delete
DROP POLICY IF EXISTS "videos_update_auth" ON storage.objects;
CREATE POLICY "videos_update_auth" ON storage.objects
  FOR UPDATE USING (bucket_id = 'listing-videos');
DROP POLICY IF EXISTS "videos_delete_auth" ON storage.objects;
CREATE POLICY "videos_delete_auth" ON storage.objects
  FOR DELETE USING (bucket_id = 'listing-videos');

-- 5. Add videos column to listings
ALTER TABLE listings ADD COLUMN IF NOT EXISTS videos TEXT[] DEFAULT '{}'::TEXT[];

-- 6. Create video_thumbnails bucket for generated thumbnails
INSERT INTO storage.buckets (id, name, public) 
VALUES ('video-thumbs', 'video-thumbs', true)
ON CONFLICT (id) DO NOTHING;

UPDATE storage.buckets SET public = true WHERE id = 'video-thumbs';

DROP POLICY IF EXISTS "thumbs_select_public" ON storage.objects;
CREATE POLICY "thumbs_select_public" ON storage.objects
  FOR SELECT USING (bucket_id = 'video-thumbs');
DROP POLICY IF EXISTS "thumbs_insert_auth" ON storage.objects;
CREATE POLICY "thumbs_insert_auth" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'video-thumbs');
