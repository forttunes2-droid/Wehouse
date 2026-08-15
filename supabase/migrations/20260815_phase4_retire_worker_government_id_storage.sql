BEGIN;

DROP POLICY IF EXISTS worker_private_insert_own ON storage.objects;
DROP POLICY IF EXISTS worker_private_read_own ON storage.objects;
DROP POLICY IF EXISTS worker_private_delete_own ON storage.objects;

CREATE POLICY worker_private_insert_own
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = ANY (ARRAY['worker-certificates'::text, 'worker-verification-videos'::text])
  AND public.current_profile_role() = 'worker'
  AND (storage.foldername(name))[1] = public.current_profile_user_id()
);

CREATE POLICY worker_private_read_own
ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = ANY (ARRAY['worker-certificates'::text, 'worker-verification-videos'::text])
  AND public.current_profile_role() = 'worker'
  AND (storage.foldername(name))[1] = public.current_profile_user_id()
);

CREATE POLICY worker_private_delete_own
ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = ANY (ARRAY['worker-certificates'::text, 'worker-verification-videos'::text])
  AND public.current_profile_role() = 'worker'
  AND (storage.foldername(name))[1] = public.current_profile_user_id()
);

COMMIT;
