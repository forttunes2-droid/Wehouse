-- Baseline infrastructure metadata omitted by the original schema-only dump.
-- Reviewed against Test bucket configuration on 23 October 2026. No objects,
-- customer data, grants, policies or existing bucket settings are changed.
-- Used before local migration replay; never run against a remote project here.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('avatars','avatars',true,5242880,array['image/jpeg','image/png','image/webp']),
 ('listing-images','listing-images',true,10485760,array['image/jpeg','image/png','image/webp']),
 ('listings','listings',true,36700160,array['image/jpeg','image/png','image/webp']),
 ('listing-videos','listing-videos',true,13000000,array['video/mp4','video/quicktime','video/webm']),
 ('listing-candidates','listing-candidates',false,13000000,array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm']),
 ('property-access-private','property-access-private',false,13000000,array['video/mp4','video/webm','video/quicktime']),
 ('worker-files','worker-files',false,13000000,array['video/mp4','video/quicktime','video/webm','image/jpeg','image/png','image/webp','application/pdf']),
 ('worker-showcase','worker-showcase',false,13000000,array['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime']),
 ('worker-verification-videos','worker-verification-videos',false,13000000,array['video/mp4','video/webm','video/quicktime']),
 ('worker-certificates','worker-certificates',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf']),
 ('worker-government-ids','worker-government-ids',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf']),
 ('worker-identity-private','worker-identity-private',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
