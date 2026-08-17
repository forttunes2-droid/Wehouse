BEGIN;

-- Admin dashboard is local to the Creator-assigned state/LGA. Creator remains global.
CREATE OR REPLACE FUNCTION public._admin_dashboard_actor()
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE v_actor public.profiles;
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id = auth.uid()::text
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_actor IS NULL OR v_actor.role NOT IN ('admin','creator') THEN
    RAISE EXCEPTION 'Admin or Creator account required';
  END IF;
  IF v_actor.role='admin' AND (
    NULLIF(BTRIM(v_actor.assigned_state),'') IS NULL OR
    NULLIF(BTRIM(v_actor.assigned_lga),'') IS NULL
  ) THEN
    RAISE EXCEPTION 'Admin branch assignment is incomplete. Contact Creator.';
  END IF;
  RETURN v_actor;
END;
$$;
REVOKE ALL ON FUNCTION public._admin_dashboard_actor() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_my_branch_profiles(p_role text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE v_actor public.profiles; v_result jsonb;
BEGIN
  v_actor := public._admin_dashboard_actor();
  SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC),'[]'::jsonb)
  INTO v_result
  FROM public.profiles p
  WHERE COALESCE(p.deleted,false)=false
    AND p.role <> 'creator'
    AND (p_role IS NULL OR p.role=p_role)
    AND (
      v_actor.role='creator'
      OR (
        CASE WHEN p.role IN ('admin','staff')
          THEN p.assigned_state=v_actor.assigned_state AND p.assigned_lga=v_actor.assigned_lga
          ELSE p.state=v_actor.assigned_state AND COALESCE(NULLIF(p.local_government,''),NULLIF(p.city,''))=v_actor.assigned_lga
        END
      )
    );
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_my_branch_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE v_actor public.profiles;
BEGIN
  v_actor := public._admin_dashboard_actor();
  RETURN jsonb_build_object(
    'users',(SELECT count(*) FROM public.profiles p WHERE p.role='user' AND COALESCE(p.deleted,false)=false AND (v_actor.role='creator' OR (p.state=v_actor.assigned_state AND COALESCE(NULLIF(p.local_government,''),NULLIF(p.city,''))=v_actor.assigned_lga))),
    'workers',(SELECT count(*) FROM public.profiles p WHERE p.role='worker' AND COALESCE(p.deleted,false)=false AND (v_actor.role='creator' OR (p.state=v_actor.assigned_state AND COALESCE(NULLIF(p.local_government,''),NULLIF(p.city,''))=v_actor.assigned_lga))),
    'partners',(SELECT count(*) FROM public.profiles p WHERE p.role='property_partner' AND COALESCE(p.deleted,false)=false AND (v_actor.role='creator' OR (p.state=v_actor.assigned_state AND COALESCE(NULLIF(p.local_government,''),NULLIF(p.city,''))=v_actor.assigned_lga))),
    'staff',(SELECT count(*) FROM public.profiles p WHERE p.role='staff' AND COALESCE(p.deleted,false)=false AND (v_actor.role='creator' OR (p.assigned_state=v_actor.assigned_state AND p.assigned_lga=v_actor.assigned_lga))),
    'listings',(SELECT count(*) FROM public.listings l WHERE l.deleted_at IS NULL AND (v_actor.role='creator' OR (l.state=v_actor.assigned_state AND l.city=v_actor.assigned_lga))),
    'pending_verifications',(SELECT count(*) FROM public.profiles p WHERE p.role='worker' AND p.worker_status='profile_under_review' AND COALESCE(p.deleted,false)=false AND (v_actor.role='creator' OR (p.state=v_actor.assigned_state AND COALESCE(NULLIF(p.local_government,''),NULLIF(p.city,''))=v_actor.assigned_lga)))
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_my_branch_listings(p_status text DEFAULT 'all')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE v_actor public.profiles; v_result jsonb;
BEGIN
  v_actor := public._admin_dashboard_actor();
  SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY l.created_at DESC),'[]'::jsonb)
  INTO v_result
  FROM public.listings l
  WHERE l.deleted_at IS NULL
    AND (p_status='all' OR l.status=p_status)
    AND (v_actor.role='creator' OR (l.state=v_actor.assigned_state AND l.city=v_actor.assigned_lga));
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_review_my_branch_listing(p_listing_id uuid,p_decision text,p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE v_actor public.profiles; v_listing public.listings;
BEGIN
  v_actor := public._admin_dashboard_actor();
  SELECT * INTO v_listing FROM public.listings WHERE id=p_listing_id AND deleted_at IS NULL FOR UPDATE;
  IF v_listing IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF;
  IF v_actor.role='admin' AND (v_listing.state IS DISTINCT FROM v_actor.assigned_state OR v_listing.city IS DISTINCT FROM v_actor.assigned_lga) THEN RAISE EXCEPTION 'Listing is outside your assigned branch'; END IF;
  IF v_listing.status <> 'pending_approval' THEN RAISE EXCEPTION 'Only pending listings can be reviewed'; END IF;
  IF p_decision='approve' THEN
    UPDATE public.listings SET status='available',availability_status='available',approved_by=v_actor.user_id,approved_at=now(),rejection_reason=NULL,updated_at=now() WHERE id=p_listing_id;
  ELSIF p_decision='reject' THEN
    IF NULLIF(BTRIM(COALESCE(p_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'Rejection reason is required'; END IF;
    UPDATE public.listings SET status='rejected',rejection_reason=BTRIM(p_reason),updated_at=now() WHERE id=p_listing_id;
  ELSE RAISE EXCEPTION 'Decision must be approve or reject';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_review_my_branch_worker(p_worker_id text,p_decision text,p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE v_actor public.profiles; v_worker public.profiles;
BEGIN
  v_actor := public._admin_dashboard_actor();
  SELECT * INTO v_worker FROM public.profiles WHERE user_id=p_worker_id AND role='worker' AND COALESCE(deleted,false)=false FOR UPDATE;
  IF v_worker IS NULL THEN RAISE EXCEPTION 'Worker not found'; END IF;
  IF v_actor.role='admin' AND (v_worker.state IS DISTINCT FROM v_actor.assigned_state OR COALESCE(NULLIF(v_worker.local_government,''),NULLIF(v_worker.city,'')) IS DISTINCT FROM v_actor.assigned_lga) THEN RAISE EXCEPTION 'Worker is outside your assigned branch'; END IF;
  IF v_worker.worker_status <> 'profile_under_review' THEN RAISE EXCEPTION 'Worker is not in the review queue'; END IF;
  IF p_decision='approve' THEN
    UPDATE public.profiles SET worker_status='verified',worker_verified=true,updated_at=now() WHERE user_id=p_worker_id;
  ELSIF p_decision='reject' THEN
    IF NULLIF(BTRIM(COALESCE(p_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'Rejection reason is required'; END IF;
    UPDATE public.profiles SET worker_status='rejected',worker_verified=false,updated_at=now() WHERE user_id=p_worker_id;
  ELSE RAISE EXCEPTION 'Decision must be approve or reject';
  END IF;
  IF to_regclass('public.worker_verification_reviews') IS NOT NULL THEN
    INSERT INTO public.worker_verification_reviews(worker_id,reviewer_id,reviewer_role,action,rejection_reason)
    VALUES(p_worker_id,v_actor.user_id,v_actor.role,CASE WHEN p_decision='approve' THEN 'approved' ELSE 'rejected' END,CASE WHEN p_decision='reject' THEN BTRIM(p_reason) ELSE NULL END);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_my_branch_worker_bookings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE v_actor public.profiles; v_result jsonb;
BEGIN
  v_actor := public._admin_dashboard_actor();
  SELECT COALESCE(jsonb_agg(to_jsonb(wb) ORDER BY wb.created_at DESC),'[]'::jsonb)
  INTO v_result
  FROM public.worker_bookings wb
  JOIN public.profiles w ON w.user_id=wb.worker_id
  WHERE (v_actor.role='creator' OR (w.state=v_actor.assigned_state AND COALESCE(NULLIF(w.local_government,''),NULLIF(w.city,''))=v_actor.assigned_lga));
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_my_branch_reports()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE v_actor public.profiles; v_result jsonb;
BEGIN
  v_actor := public._admin_dashboard_actor();
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC),'[]'::jsonb)
  INTO v_result
  FROM public.listing_reports r
  LEFT JOIN public.listings l ON (r.listing_id=l.id::text OR r.listing_id=l.listing_id)
  WHERE v_actor.role='creator' OR (l.state=v_actor.assigned_state AND l.city=v_actor.assigned_lga);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_resolve_my_branch_report(p_report_id text,p_action text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE v_actor public.profiles; v_report public.listing_reports; v_listing public.listings;
BEGIN
  v_actor := public._admin_dashboard_actor();
  SELECT * INTO v_report FROM public.listing_reports WHERE id=p_report_id FOR UPDATE;
  IF v_report IS NULL THEN RAISE EXCEPTION 'Report not found'; END IF;
  SELECT * INTO v_listing FROM public.listings WHERE id::text=v_report.listing_id OR listing_id=v_report.listing_id LIMIT 1;
  IF v_actor.role='admin' AND (v_listing IS NULL OR v_listing.state IS DISTINCT FROM v_actor.assigned_state OR v_listing.city IS DISTINCT FROM v_actor.assigned_lga) THEN RAISE EXCEPTION 'Report is outside your assigned branch'; END IF;
  IF p_action NOT IN ('resolved','dismissed') THEN RAISE EXCEPTION 'Action must be resolved or dismissed'; END IF;
  UPDATE public.listing_reports SET status=p_action,resolved_by=v_actor.user_id,resolved_at=now() WHERE id=p_report_id;
END;
$$;

-- Fix the existing branch support inbox to use the canonical TEXT auth mapping and fail closed.
CREATE OR REPLACE FUNCTION public.admin_support_inbox()
RETURNS TABLE(id uuid,participant_a text,participant_b text,status text,last_message text,last_message_at timestamptz,unread_a integer,unread_b integer,created_at timestamptz,conversation_type text,subject text,user_name text,user_email text,user_phone text,user_state text,user_lga text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public'
AS $$
DECLARE v_actor public.profiles;
BEGIN
  v_actor := public._admin_dashboard_actor();
  RETURN QUERY
  SELECT c.id,c.participant_a,c.participant_b,c.status,c.last_message,c.last_message_at,c.unread_a,c.unread_b,c.created_at,c.conversation_type,c.subject,
         COALESCE(p.full_name,p.username,p.email),p.email,p.phone,p.state,COALESCE(NULLIF(p.local_government,''),p.city)
  FROM public.conversations c
  LEFT JOIN public.profiles p ON p.user_id=c.participant_a
  WHERE c.conversation_type IN ('partner_support','partner_inspection','general_support')
    AND c.participant_a <> 'wehouse_support'
    AND (v_actor.role='creator' OR (p.state=v_actor.assigned_state AND COALESCE(NULLIF(p.local_government,''),p.city)=v_actor.assigned_lga))
  ORDER BY c.last_message_at DESC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_my_branch_profiles(text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_get_my_branch_stats() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_get_my_branch_listings(text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_review_my_branch_listing(uuid,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_review_my_branch_worker(text,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_get_my_branch_worker_bookings() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_get_my_branch_reports() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_resolve_my_branch_report(text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_support_inbox() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_get_my_branch_profiles(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_my_branch_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_my_branch_listings(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_my_branch_listing(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_my_branch_worker(text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_my_branch_worker_bookings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_my_branch_reports() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_resolve_my_branch_report(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_support_inbox() TO authenticated;

COMMIT;
