CREATE OR REPLACE FUNCTION public.get_my_announcement_inbox()
RETURNS TABLE(
  id bigint,
  announcement_id bigint,
  read_status boolean,
  delivered_at timestamptz,
  announcement jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    ar.id,
    ar.announcement_id,
    COALESCE(ar.read_status, false),
    ar.delivered_at,
    jsonb_build_object(
      'id', a.id,
      'title', a.title,
      'content', a.content,
      'sender_id', a.sender_id,
      'sender_role', a.sender_role,
      'target_type', a.target_type,
      'created_at', a.created_at
    )
  FROM public.announcement_recipients ar
  JOIN public.announcements a ON a.id = ar.announcement_id
  WHERE ar.user_id = public.current_profile_user_id()
  ORDER BY ar.delivered_at DESC, ar.id DESC;
$$;

REVOKE ALL ON FUNCTION public.get_my_announcement_inbox() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_announcement_inbox() TO authenticated, service_role;
