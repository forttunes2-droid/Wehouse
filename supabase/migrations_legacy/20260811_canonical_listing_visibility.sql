DROP POLICY IF EXISTS listings_canonical_select ON public.listings;
CREATE POLICY listings_canonical_select ON public.listings FOR SELECT TO authenticated USING (
  deleted_at IS NULL AND (
    (status='available' AND inspection_request_id IS NOT NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND EXISTS(SELECT 1 FROM public.profiles owner WHERE owner.user_id=listings.owner_id AND NOT COALESCE(owner.deleted,false) AND NOT COALESCE(owner.suspended,false) AND NOT COALESCE(owner.banned,false)))
    OR reserved_by=(SELECT p.user_id FROM public.profiles p WHERE p.auth_id=auth.uid()::text LIMIT 1)
    OR owner_id=(SELECT p.user_id FROM public.profiles p WHERE p.auth_id=auth.uid()::text LIMIT 1)
    OR EXISTS(SELECT 1 FROM public.profiles actor WHERE actor.auth_id=auth.uid()::text AND actor.role IN ('staff','admin','creator') AND NOT COALESCE(actor.deleted,false) AND NOT COALESCE(actor.suspended,false) AND NOT COALESCE(actor.banned,false))
  )
);
CREATE OR REPLACE FUNCTION public.admin_get_my_branch_listings(p_status TEXT DEFAULT 'all') RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_actor public.profiles; v_result jsonb;
BEGIN
 v_actor:=public._admin_dashboard_actor();
 SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY l.created_at DESC),'[]'::jsonb) INTO v_result FROM public.listings l WHERE l.deleted_at IS NULL AND l.inspection_request_id IS NOT NULL AND (p_status='all' OR l.status=p_status) AND (v_actor.role='creator' OR (l.state=v_actor.assigned_state AND l.city=v_actor.assigned_lga));
 RETURN v_result;
END $$;
CREATE OR REPLACE FUNCTION public.admin_review_my_branch_listing(p_listing_id UUID,p_decision TEXT,p_reason TEXT DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_actor public.profiles; v_listing public.listings;
BEGIN
 v_actor:=public._admin_dashboard_actor();
 SELECT * INTO v_listing FROM public.listings WHERE id=p_listing_id AND deleted_at IS NULL FOR UPDATE;
 IF v_listing IS NULL OR v_listing.inspection_request_id IS NULL THEN RAISE EXCEPTION 'Only inspection-linked prepared listings can be reviewed'; END IF;
 IF v_actor.role='admin' AND (v_listing.state IS DISTINCT FROM v_actor.assigned_state OR v_listing.city IS DISTINCT FROM v_actor.assigned_lga) THEN RAISE EXCEPTION 'Listing is outside your assigned branch'; END IF;
 IF p_decision='approve' THEN PERFORM public.admin_publish_inspected_listing(p_listing_id);
 ELSIF p_decision='reject' THEN IF NULLIF(BTRIM(COALESCE(p_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'Rejection reason is required'; END IF; UPDATE public.listings SET status='rejected',availability_status='rejected',rejection_reason=BTRIM(p_reason),updated_at=NOW() WHERE id=p_listing_id;
 ELSE RAISE EXCEPTION 'Decision must be approve or reject'; END IF;
END $$;