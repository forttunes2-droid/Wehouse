-- Storage holds media bytes; Postgres holds paths/URLs. Keep new public media
-- bounded even if a browser skips client-side compression.
update storage.buckets
set file_size_limit=2*1024*1024
where id in ('listing-videos','worker-showcase','listing-candidates');

-- Longer private proof videos retain enough detail for review, but no raw
-- 50-100 MB browser recording is accepted by these buckets.
update storage.buckets
set file_size_limit=13*1024*1024
where id in ('property-access-private','worker-verification-videos','worker-files');
