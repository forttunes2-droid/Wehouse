BEGIN;

-- Legacy admin readers now honor the same branch boundary as the rebuilt dashboard.
CREATE OR REPLACE FUNCTION public.admin_get_all_users()
RETURNS SETOF public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE v_actor public.profiles;
BEGIN
  v_actor := public._admin_dashboard_actor();
  RETURN QUERY
  SELECT p.* FROM public.profiles p
  WHERE p.deleted_at IS NULL
    AND p.role <> 'creator'
    AND (
      v_actor.role='creator'
      OR CASE WHEN p.role IN ('admin','staff')
        THEN p.assigned_state=v_actor.assigned_state AND p.assigned_lga=v_actor.assigned_lga
        ELSE p.state=v_actor.assigned_state AND COALESCE(NULLIF(p.local_government,''),NULLIF(p.city,''))=v_actor.assigned_lga
      END
    )
  ORDER BY p.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_all_workers()
RETURNS SETOF public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE v_actor public.profiles;
BEGIN
  v_actor := public._admin_dashboard_actor();
  RETURN QUERY SELECT p.* FROM public.profiles p
  WHERE p.role='worker' AND p.deleted_at IS NULL
    AND (v_actor.role='creator' OR (p.state=v_actor.assigned_state AND COALESCE(NULLIF(p.local_government,''),NULLIF(p.city,''))=v_actor.assigned_lga))
  ORDER BY p.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_field_officers()
RETURNS SETOF public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE v_actor public.profiles;
BEGIN
  v_actor := public._admin_dashboard_actor();
  RETURN QUERY SELECT p.* FROM public.profiles p
  WHERE p.role='staff' AND p.deleted_at IS NULL
    AND (v_actor.role='creator' OR (p.assigned_state=v_actor.assigned_state AND p.assigned_lga=v_actor.assigned_lga))
    AND EXISTS (SELECT 1 FROM public.staff_permissions sp WHERE sp.staff_id=p.user_id AND sp.permission='field_officer' AND sp.is_active=true)
  ORDER BY p.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_send_branch_announcement(
  p_content text,
  p_target_roles text[],
  p_recipient_ids text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE
  v_actor public.profiles;
  v_id integer;
  v_count integer;
  v_roles text[];
BEGIN
  v_actor := public._admin_dashboard_actor();
  IF v_actor.role <> 'admin' THEN RAISE EXCEPTION 'Admin account required'; END IF;
  IF NULLIF(BTRIM(COALESCE(p_content,'')),'') IS NULL THEN RAISE EXCEPTION 'Announcement content is required'; END IF;

  SELECT COALESCE(array_agg(DISTINCT r),'{}'::text[]) INTO v_roles
  FROM unnest(COALESCE(p_target_roles,'{}'::text[])) r
  WHERE r IN ('user','worker','staff','property_partner');
  IF COALESCE(array_length(v_roles,1),0)=0 THEN RAISE EXCEPTION 'Select at least one recipient type'; END IF;

  INSERT INTO public.announcements(title,content,sender_id,sender_role,target_type,scope,recipient_count,read_count,created_at)
  VALUES('Announcement',BTRIM(p_content),v_actor.user_id,'admin',CASE WHEN p_recipient_ids IS NULL THEN 'all_users' ELSE 'specific_user' END,v_actor.assigned_state||' / '||v_actor.assigned_lga,0,0,now())
  RETURNING id INTO v_id;

  INSERT INTO public.announcement_recipients(announcement_id,user_id,read_status,delivered_at)
  SELECT v_id,p.user_id,false,now()
  FROM public.profiles p
  WHERE p.user_id<>v_actor.user_id
    AND p.role=ANY(v_roles)
    AND COALESCE(p.deleted,false)=false
    AND COALESCE(p.suspended,false)=false
    AND COALESCE(p.banned,false)=false
    AND CASE WHEN p.role='staff'
      THEN p.assigned_state=v_actor.assigned_state AND p.assigned_lga=v_actor.assigned_lga
      ELSE p.state=v_actor.assigned_state AND COALESCE(NULLIF(p.local_government,''),NULLIF(p.city,''))=v_actor.assigned_lga
    END
    AND (p_recipient_ids IS NULL OR p.user_id=ANY(p_recipient_ids));

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count=0 THEN
    DELETE FROM public.announcements WHERE id=v_id;
    RAISE EXCEPTION 'No users in your branch match the selected recipients';
  END IF;
  UPDATE public.announcements SET recipient_count=v_count WHERE id=v_id;
  RETURN jsonb_build_object('id',v_id,'recipient_count',v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_count_branch_announcement_recipients(p_target_roles text[])
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE v_actor public.profiles; v_count bigint;
BEGIN
  v_actor := public._admin_dashboard_actor();
  IF v_actor.role <> 'admin' THEN RAISE EXCEPTION 'Admin account required'; END IF;
  SELECT count(*) INTO v_count FROM public.profiles p
  WHERE p.user_id<>v_actor.user_id
    AND p.role=ANY(p_target_roles)
    AND COALESCE(p.deleted,false)=false AND COALESCE(p.suspended,false)=false AND COALESCE(p.banned,false)=false
    AND CASE WHEN p.role='staff' THEN p.assigned_state=v_actor.assigned_state AND p.assigned_lga=v_actor.assigned_lga ELSE p.state=v_actor.assigned_state AND COALESCE(NULLIF(p.local_government,''),NULLIF(p.city,''))=v_actor.assigned_lga END;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_my_announcement_read(p_announcement_id integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE v_user_id text;
BEGIN
  SELECT user_id INTO v_user_id FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Profile not found'; END IF;
  UPDATE public.announcement_recipients SET read_status=true
  WHERE announcement_id=p_announcement_id AND user_id=v_user_id AND COALESCE(read_status,false)=false;
  UPDATE public.announcements a SET read_count=(SELECT count(*) FROM public.announcement_recipients ar WHERE ar.announcement_id=a.id AND ar.read_status=true)
  WHERE a.id=p_announcement_id AND EXISTS(SELECT 1 FROM public.announcement_recipients ar WHERE ar.announcement_id=a.id AND ar.user_id=v_user_id);
END;
$$;

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read announcements" ON public.announcements;
DROP POLICY IF EXISTS "Anyone can insert announcements" ON public.announcements;
DROP POLICY IF EXISTS "Anyone can update announcements" ON public.announcements;
DROP POLICY IF EXISTS "Anyone can read recipients" ON public.announcement_recipients;
DROP POLICY IF EXISTS "Anyone can insert recipients" ON public.announcement_recipients;
DROP POLICY IF EXISTS "Recipient can update read" ON public.announcement_recipients;
DROP POLICY IF EXISTS announcements_visible_to_recipient_or_sender ON public.announcements;
DROP POLICY IF EXISTS announcements_creator_insert ON public.announcements;
DROP POLICY IF EXISTS announcements_sender_delete ON public.announcements;
DROP POLICY IF EXISTS announcement_recipients_visible ON public.announcement_recipients;
DROP POLICY IF EXISTS announcement_recipients_creator_insert ON public.announcement_recipients;

CREATE POLICY announcements_visible_to_recipient_or_sender ON public.announcements FOR SELECT TO authenticated USING (
  sender_id=(SELECT p.user_id FROM public.profiles p WHERE p.auth_id=auth.uid()::text LIMIT 1)
  OR EXISTS(SELECT 1 FROM public.announcement_recipients ar WHERE ar.announcement_id=announcements.id AND ar.user_id=(SELECT p.user_id FROM public.profiles p WHERE p.auth_id=auth.uid()::text LIMIT 1))
  OR EXISTS(SELECT 1 FROM public.profiles p WHERE p.auth_id=auth.uid()::text AND p.role='creator')
);
CREATE POLICY announcements_creator_insert ON public.announcements FOR INSERT TO authenticated WITH CHECK (EXISTS(SELECT 1 FROM public.profiles p WHERE p.auth_id=auth.uid()::text AND p.role='creator'));
CREATE POLICY announcements_sender_delete ON public.announcements FOR DELETE TO authenticated USING (sender_id=(SELECT p.user_id FROM public.profiles p WHERE p.auth_id=auth.uid()::text LIMIT 1) OR EXISTS(SELECT 1 FROM public.profiles p WHERE p.auth_id=auth.uid()::text AND p.role='creator'));
CREATE POLICY announcement_recipients_visible ON public.announcement_recipients FOR SELECT TO authenticated USING (user_id=(SELECT p.user_id FROM public.profiles p WHERE p.auth_id=auth.uid()::text LIMIT 1) OR EXISTS(SELECT 1 FROM public.announcements a WHERE a.id=announcement_recipients.announcement_id AND a.sender_id=(SELECT p.user_id FROM public.profiles p WHERE p.auth_id=auth.uid()::text LIMIT 1)) OR EXISTS(SELECT 1 FROM public.profiles p WHERE p.auth_id=auth.uid()::text AND p.role='creator'));
CREATE POLICY announcement_recipients_creator_insert ON public.announcement_recipients FOR INSERT TO authenticated WITH CHECK (EXISTS(SELECT 1 FROM public.profiles p WHERE p.auth_id=auth.uid()::text AND p.role='creator'));

REVOKE ALL ON FUNCTION public.admin_send_branch_announcement(text,text[],text[]) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_count_branch_announcement_recipients(text[]) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.mark_my_announcement_read(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_send_branch_announcement(text,text[],text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_count_branch_announcement_recipients(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_my_announcement_read(integer) TO authenticated;

COMMIT;
