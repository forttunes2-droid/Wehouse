BEGIN;

CREATE TABLE IF NOT EXISTS public.worker_showcase_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id text NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('story','portfolio')),
  media_type text NOT NULL CHECK (media_type IN ('image','video')),
  storage_path text NOT NULL UNIQUE,
  caption text,
  booking_id uuid REFERENCES public.worker_bookings(id) ON DELETE SET NULL,
  verified_job boolean NOT NULL DEFAULT false,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT worker_showcase_caption_length CHECK (caption IS NULL OR length(caption)<=300),
  CONSTRAINT worker_showcase_story_expiry CHECK (
    (kind='story' AND expires_at IS NOT NULL) OR (kind='portfolio' AND expires_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_worker_showcase_worker_created
  ON public.worker_showcase_posts(worker_id, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_worker_showcase_story_expiry
  ON public.worker_showcase_posts(expires_at)
  WHERE kind='story' AND deleted_at IS NULL;

ALTER TABLE public.worker_showcase_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.worker_showcase_posts FROM PUBLIC, anon;
REVOKE INSERT,UPDATE,DELETE ON public.worker_showcase_posts FROM authenticated;
GRANT SELECT ON public.worker_showcase_posts TO authenticated;

DROP POLICY IF EXISTS worker_showcase_select ON public.worker_showcase_posts;
CREATE POLICY worker_showcase_select
ON public.worker_showcase_posts
FOR SELECT TO authenticated
USING (
  deleted_at IS NULL
  AND (
    worker_id=(SELECT p.user_id FROM public.profiles p WHERE p.auth_id=auth.uid()::text LIMIT 1)
    OR (
      (kind='portfolio' OR expires_at>now())
      AND EXISTS(
        SELECT 1 FROM public.profiles p
        WHERE p.user_id=worker_showcase_posts.worker_id
          AND p.role='worker'
          AND p.worker_status='verified'
          AND COALESCE(p.worker_verified,false)=true
          AND COALESCE(p.deleted,false)=false
          AND COALESCE(p.suspended,false)=false
          AND COALESCE(p.banned,false)=false
      )
    )
  )
);

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES(
  'worker-showcase','worker-showcase',false,52428800,
  ARRAY['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime']
)
ON CONFLICT(id) DO UPDATE SET
  public=false,
  file_size_limit=EXCLUDED.file_size_limit,
  allowed_mime_types=EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS worker_showcase_object_insert ON storage.objects;
CREATE POLICY worker_showcase_object_insert
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id='worker-showcase'
  AND split_part(name,'/',1)=(SELECT p.user_id FROM public.profiles p WHERE p.auth_id=auth.uid()::text LIMIT 1)
  AND EXISTS(
    SELECT 1 FROM public.profiles p
    WHERE p.auth_id=auth.uid()::text
      AND p.role='worker'
      AND p.worker_status='verified'
      AND COALESCE(p.worker_verified,false)=true
      AND COALESCE(p.deleted,false)=false
      AND COALESCE(p.suspended,false)=false
      AND COALESCE(p.banned,false)=false
  )
);

DROP POLICY IF EXISTS worker_showcase_object_select ON storage.objects;
CREATE POLICY worker_showcase_object_select
ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id='worker-showcase'
  AND (
    split_part(name,'/',1)=(SELECT p.user_id FROM public.profiles p WHERE p.auth_id=auth.uid()::text LIMIT 1)
    OR EXISTS(
      SELECT 1
      FROM public.worker_showcase_posts s
      JOIN public.profiles p ON p.user_id=s.worker_id
      WHERE s.storage_path=storage.objects.name
        AND s.deleted_at IS NULL
        AND (s.kind='portfolio' OR s.expires_at>now())
        AND p.role='worker'
        AND p.worker_status='verified'
        AND COALESCE(p.worker_verified,false)=true
        AND COALESCE(p.deleted,false)=false
        AND COALESCE(p.suspended,false)=false
        AND COALESCE(p.banned,false)=false
    )
  )
);

DROP POLICY IF EXISTS worker_showcase_object_delete ON storage.objects;
CREATE POLICY worker_showcase_object_delete
ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id='worker-showcase'
  AND split_part(name,'/',1)=(SELECT p.user_id FROM public.profiles p WHERE p.auth_id=auth.uid()::text LIMIT 1)
  AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.auth_id=auth.uid()::text AND p.role='worker')
);

CREATE OR REPLACE FUNCTION public.create_my_worker_showcase_post(
  p_kind text,
  p_media_type text,
  p_storage_path text,
  p_caption text DEFAULT NULL,
  p_booking_id uuid DEFAULT NULL
)
RETURNS public.worker_showcase_posts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public','storage'
AS $function$
DECLARE
  v_worker public.profiles;
  v_verified_job boolean:=false;
  v_post public.worker_showcase_posts;
BEGIN
  SELECT * INTO v_worker
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND role='worker'
    AND worker_status='verified'
    AND COALESCE(worker_verified,false)=true
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_worker IS NULL THEN RAISE EXCEPTION 'Only an approved live Worker can publish Work Stories or Portfolio media'; END IF;
  IF p_kind NOT IN ('story','portfolio') THEN RAISE EXCEPTION 'Invalid showcase type'; END IF;
  IF p_media_type NOT IN ('image','video') THEN RAISE EXCEPTION 'Invalid media type'; END IF;
  IF NULLIF(BTRIM(COALESCE(p_storage_path,'')),'') IS NULL OR split_part(p_storage_path,'/',1)<>v_worker.user_id THEN RAISE EXCEPTION 'Invalid showcase storage path'; END IF;
  IF length(COALESCE(p_caption,''))>300 THEN RAISE EXCEPTION 'Caption is too long'; END IF;
  IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='worker-showcase' AND o.name=p_storage_path) THEN RAISE EXCEPTION 'Showcase media upload was not found'; END IF;

  IF p_booking_id IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM public.worker_bookings b
      WHERE b.id=p_booking_id
        AND b.worker_id=v_worker.user_id
        AND b.status='approved_released'
    ) INTO v_verified_job;
    IF NOT v_verified_job THEN RAISE EXCEPTION 'Only a completed approved WeHouse job can be linked as verified work'; END IF;
  END IF;

  INSERT INTO public.worker_showcase_posts(worker_id,kind,media_type,storage_path,caption,booking_id,verified_job,expires_at)
  VALUES(
    v_worker.user_id,p_kind,p_media_type,p_storage_path,NULLIF(BTRIM(COALESCE(p_caption,'')),''),p_booking_id,v_verified_job,
    CASE WHEN p_kind='story' THEN now()+interval '24 hours' ELSE NULL END
  )
  RETURNING * INTO v_post;
  RETURN v_post;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_my_worker_showcase_post(p_post_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $function$
DECLARE
  v_worker text;
  v_path text;
BEGIN
  SELECT p.user_id INTO v_worker FROM public.profiles p WHERE p.auth_id=auth.uid()::text AND p.role='worker' LIMIT 1;
  IF v_worker IS NULL THEN RAISE EXCEPTION 'Worker account required'; END IF;
  UPDATE public.worker_showcase_posts
  SET deleted_at=now()
  WHERE id=p_post_id AND worker_id=v_worker AND deleted_at IS NULL
  RETURNING storage_path INTO v_path;
  IF v_path IS NULL THEN RAISE EXCEPTION 'Showcase post not found'; END IF;
  RETURN v_path;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_my_worker_showcase_post(text,text,text,text,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.delete_my_worker_showcase_post(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_my_worker_showcase_post(text,text,text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_my_worker_showcase_post(uuid) TO authenticated;

COMMIT;
