-- Video clips are stored as objects; Postgres records only their paths.
-- A fixed 2 MB bucket spoiled longer clips. The client aims for 2 MB per
-- 15 seconds, up to 13 MB, and the bucket enforces the final upper bound.
update storage.buckets
set file_size_limit=13000000
where id in ('listing-videos','worker-showcase','listing-candidates');
