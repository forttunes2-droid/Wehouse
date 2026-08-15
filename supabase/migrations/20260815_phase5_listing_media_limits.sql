BEGIN;

-- Match Storage enforcement to the listing UI. Public read is intentional for
-- published property media; upload/delete authorization remains policy-driven.
UPDATE storage.buckets
SET file_size_limit = 10 * 1024 * 1024,
    allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']::text[]
WHERE id='listing-images';

UPDATE storage.buckets
SET file_size_limit = 50 * 1024 * 1024,
    allowed_mime_types = ARRAY['video/mp4','video/quicktime','video/webm']::text[]
WHERE id='listing-videos';

COMMIT;
