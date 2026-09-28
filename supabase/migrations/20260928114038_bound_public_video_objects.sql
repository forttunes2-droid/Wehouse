-- Storage holds media bytes; Postgres holds paths/URLs. Keep new public media
-- bounded even if a browser skips client-side compression.
update storage.buckets
set file_size_limit=13*1024*1024
where id in ('listing-videos','worker-showcase');
