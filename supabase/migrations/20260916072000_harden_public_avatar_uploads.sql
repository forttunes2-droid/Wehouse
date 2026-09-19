begin;

-- Avatars are intentionally public to read, but public readability must not
-- imply broad write authority. An old policy allowed any authenticated user to
-- insert anywhere in the bucket; PostgreSQL combines permissive policies with
-- OR, so the later owner-folder policy did not cancel that older grant.
drop policy if exists "avatars_insert_authenticated" on storage.objects;

-- Keep the canonical owner-folder write rule. The application writes avatars
-- under <auth.uid()>/avatar-*.jpg, so one signed-in account cannot choose another
-- account's folder even if it calls Storage directly instead of using the UI.
drop policy if exists "avatar_owner_insert" on storage.objects;
create policy "avatar_owner_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id='avatars'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);

-- Public avatar objects are images only. Enforce limits at the bucket boundary
-- as well as in the browser so a modified client cannot turn WeHouse into an
-- arbitrary public-file host.
update storage.buckets
set file_size_limit=5*1024*1024,
    allowed_mime_types=array['image/jpeg','image/png','image/webp']::text[]
where id='avatars';

commit;
