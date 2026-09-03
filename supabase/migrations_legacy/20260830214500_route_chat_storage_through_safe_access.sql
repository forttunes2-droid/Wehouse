-- Storage evaluates multiple permissive policies for an object operation and
-- SQL expressions are not guaranteed to short-circuit on bucket_id. Calling
-- the private helper directly could therefore break unrelated private uploads.
DROP POLICY IF EXISTS "chat-files-roommate-insert" ON storage.objects;
CREATE POLICY "chat-files-roommate-insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'chat-files'
  AND EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.id::text = (storage.foldername(name))[1]
      AND c.conversation_type = 'roommate'
      AND public.can_access_my_conversation(c.id)
  )
);

DROP POLICY IF EXISTS "chat-files-roommate-select" ON storage.objects;
CREATE POLICY "chat-files-roommate-select"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'chat-files'
  AND EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.id::text = (storage.foldername(name))[1]
      AND c.conversation_type = 'roommate'
      AND public.can_access_my_conversation(c.id)
  )
);

