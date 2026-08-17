BEGIN;

-- Remove all legacy Worker-document policies that conflict with the canonical
-- external-identity model. Staff must not be able to fetch raw government ID.
DROP POLICY IF EXISTS "worker-files-owner-insert" ON storage.objects;
DROP POLICY IF EXISTS "worker-files-owner-select" ON storage.objects;
DROP POLICY IF EXISTS "worker-files-reviewer-select" ON storage.objects;
DROP POLICY IF EXISTS worker_cert_owner_insert ON storage.objects;
DROP POLICY IF EXISTS worker_cert_read_own ON storage.objects;
DROP POLICY IF EXISTS worker_cert_upload_own ON storage.objects;
DROP POLICY IF EXISTS worker_gov_owner_insert ON storage.objects;
DROP POLICY IF EXISTS worker_gov_read_own ON storage.objects;
DROP POLICY IF EXISTS worker_gov_upload_own ON storage.objects;
DROP POLICY IF EXISTS worker_video_owner_insert ON storage.objects;
DROP POLICY IF EXISTS worker_video_read_own ON storage.objects;
DROP POLICY IF EXISTS worker_video_upload_own ON storage.objects;

-- Recreate only the Worker-owned private bucket rules. These policy names were
-- introduced by the preceding Phase-1 foundation migration.
DROP POLICY IF EXISTS worker_private_insert_own ON storage.objects;
DROP POLICY IF EXISTS worker_private_read_own ON storage.objects;
DROP POLICY IF EXISTS worker_private_delete_own ON storage.objects;

CREATE POLICY worker_private_insert_own ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id IN ('worker-government-ids','worker-certificates','worker-verification-videos')
    AND public.current_profile_role()='worker'
    AND (storage.foldername(name))[1]=public.current_profile_user_id()
  );
CREATE POLICY worker_private_read_own ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id IN ('worker-government-ids','worker-certificates','worker-verification-videos')
    AND public.current_profile_role()='worker'
    AND (storage.foldername(name))[1]=public.current_profile_user_id()
  );
CREATE POLICY worker_private_delete_own ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id IN ('worker-government-ids','worker-certificates','worker-verification-videos')
    AND public.current_profile_role()='worker'
    AND (storage.foldername(name))[1]=public.current_profile_user_id()
  );

UPDATE storage.buckets SET public=false
WHERE id IN ('worker-files','worker-government-ids','worker-certificates','worker-verification-videos');

COMMIT;
