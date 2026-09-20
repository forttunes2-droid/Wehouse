-- Read policies execute as the signed-in user, not as the migration owner.
-- Keep receipt of an official update separate from authority to read send history.
CREATE OR REPLACE FUNCTION public.current_actor_can_read_announcement_history(p_sender_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  select exists (
    select 1 from public.profiles p
    join public.workspace_role_assignments w on w.user_id=p.user_id
    where p.auth_id=(select auth.uid())::text
      and p.deleted_at is null and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false) and not coalesce(p.banned,false)
      and w.status='active' and w.revoked_at is null
      and (w.workspace_role='creator'
        or (w.workspace_role='admin' and p_sender_id=p.user_id))
  );
$function$;
REVOKE ALL ON FUNCTION public.current_actor_can_read_announcement_history(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_actor_can_read_announcement_history(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_current_announcement_sender(p_announcement_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  select exists (
    select 1 from public.announcements a
    where a.id=p_announcement_id
      and a.sender_id=public.current_profile_user_id()
      and public.current_actor_can_read_announcement_history(a.sender_id)
  );
$function$;
REVOKE ALL ON FUNCTION public.is_current_announcement_sender(bigint), public.is_current_announcement_recipient(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_current_announcement_sender(bigint), public.is_current_announcement_recipient(bigint) TO authenticated, service_role;

DROP POLICY IF EXISTS announcements_visible_to_recipient_or_sender ON public.announcements;
CREATE POLICY announcements_visible_to_recipient_or_sender ON public.announcements
FOR SELECT TO authenticated USING (
  public.current_actor_can_read_announcement_history(sender_id)
  OR public.is_current_announcement_recipient(id::bigint)
);
DROP POLICY IF EXISTS announcement_recipients_visible ON public.announcement_recipients;
CREATE POLICY announcement_recipients_visible ON public.announcement_recipients
FOR SELECT TO authenticated USING (
  user_id=public.current_profile_user_id()
  OR public.current_actor_can_read_announcement_history(null::text)
  OR public.is_current_announcement_sender(announcement_id::bigint)
);
