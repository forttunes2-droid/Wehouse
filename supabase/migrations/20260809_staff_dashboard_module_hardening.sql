BEGIN;

-- Staff permissions are capability records, not a public table.
ALTER TABLE public.staff_permissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sp_all ON public.staff_permissions;
DROP POLICY IF EXISTS staff_permissions_all_access ON public.staff_permissions;
DROP POLICY IF EXISTS staff_permissions_self_read ON public.staff_permissions;
DROP POLICY IF EXISTS staff_permissions_admin_read ON public.staff_permissions;

CREATE POLICY staff_permissions_self_read ON public.staff_permissions
FOR SELECT TO authenticated
USING (staff_id = (SELECT p.user_id FROM public.profiles p WHERE p.auth_id=auth.uid()::text LIMIT 1));

CREATE POLICY staff_permissions_admin_read ON public.staff_permissions
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.auth_id=auth.uid()::text AND p.role IN ('admin','creator') AND COALESCE(p.deleted,false)=false AND COALESCE(p.suspended,false)=false AND COALESCE(p.banned,false)=false));

CREATE OR REPLACE FUNCTION public.current_staff_has_permission(p_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.staff_permissions sp ON sp.staff_id=p.user_id AND sp.permission=p_permission AND sp.is_active=true
    WHERE p.auth_id=auth.uid()::text AND p.role='staff'
      AND COALESCE(p.deleted,false)=false AND COALESCE(p.suspended,false)=false AND COALESCE(p.banned,false)=false
  ) OR EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.auth_id=auth.uid()::text AND p.role IN ('admin','creator')
      AND COALESCE(p.deleted,false)=false AND COALESCE(p.suspended,false)=false AND COALESCE(p.banned,false)=false
  );
$$;
REVOKE ALL ON FUNCTION public.current_staff_has_permission(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.current_staff_has_permission(text) TO authenticated;

-- Operations: only assigned branch data for staff; admin/creator may see all.
CREATE OR REPLACE FUNCTION public.get_my_staff_operations_listings(p_status text DEFAULT NULL)
RETURNS SETOF public.listings LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE v_actor record;
BEGIN
 SELECT user_id,role,assigned_state,assigned_lga,deleted,suspended,banned INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
 IF v_actor IS NULL OR COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN RAISE EXCEPTION 'Active staff account required'; END IF;
 IF v_actor.role='staff' AND NOT public.current_staff_has_permission('operations') THEN RAISE EXCEPTION 'Operations permission required'; END IF;
 IF v_actor.role NOT IN ('staff','admin','creator') THEN RAISE EXCEPTION 'Staff access required'; END IF;
 RETURN QUERY SELECT l.* FROM public.listings l WHERE l.deleted_at IS NULL
   AND (p_status IS NULL OR p_status='all' OR l.status=p_status)
   AND (v_actor.role IN ('admin','creator') OR (v_actor.assigned_state IS NOT NULL AND lower(l.state)=lower(v_actor.assigned_state) AND (v_actor.assigned_lga IS NULL OR lower(l.city)=lower(v_actor.assigned_lga))))
 ORDER BY l.created_at DESC;
END; $$;

CREATE OR REPLACE FUNCTION public.review_my_staff_listing(p_listing_id uuid,p_decision text,p_reason text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE v_actor record; v_listing record;
BEGIN
 SELECT user_id,role,assigned_state,assigned_lga,deleted,suspended,banned INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
 IF v_actor IS NULL OR COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN RAISE EXCEPTION 'Active staff account required'; END IF;
 IF v_actor.role='staff' AND NOT public.current_staff_has_permission('operations') THEN RAISE EXCEPTION 'Operations permission required'; END IF;
 IF v_actor.role NOT IN ('staff','admin','creator') THEN RAISE EXCEPTION 'Staff access required'; END IF;
 SELECT * INTO v_listing FROM public.listings WHERE id=p_listing_id AND deleted_at IS NULL FOR UPDATE;
 IF v_listing IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF;
 IF v_actor.role='staff' AND NOT (v_actor.assigned_state IS NOT NULL AND lower(v_listing.state)=lower(v_actor.assigned_state) AND (v_actor.assigned_lga IS NULL OR lower(v_listing.city)=lower(v_actor.assigned_lga))) THEN RAISE EXCEPTION 'Listing is outside your assigned branch'; END IF;
 IF v_listing.status<>'pending_approval' THEN RAISE EXCEPTION 'Only pending listings can be reviewed'; END IF;
 IF p_decision='approve' THEN UPDATE public.listings SET status='available',availability_status='available',approved_by=v_actor.user_id,approved_at=now(),rejection_reason=NULL,updated_at=now() WHERE id=p_listing_id;
 ELSIF p_decision='reject' THEN IF NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Rejection reason required'; END IF; UPDATE public.listings SET status='rejected',rejection_reason=btrim(p_reason),approved_by=NULL,approved_at=NULL,updated_at=now() WHERE id=p_listing_id;
 ELSE RAISE EXCEPTION 'Invalid review decision'; END IF;
 RETURN true;
END; $$;

-- Support: use the actual support_tickets schema. Staff can work only tickets whose owner is in their branch.
CREATE OR REPLACE FUNCTION public.get_my_staff_support_tickets(p_status text DEFAULT NULL)
RETURNS SETOF public.support_tickets LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE v_actor record;
BEGIN
 SELECT user_id,role,assigned_state,assigned_lga,deleted,suspended,banned INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
 IF v_actor IS NULL OR COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN RAISE EXCEPTION 'Active staff account required'; END IF;
 IF v_actor.role='staff' AND NOT public.current_staff_has_permission('support') THEN RAISE EXCEPTION 'Support permission required'; END IF;
 IF v_actor.role NOT IN ('staff','admin','creator') THEN RAISE EXCEPTION 'Staff access required'; END IF;
 RETURN QUERY SELECT t.* FROM public.support_tickets t LEFT JOIN public.profiles u ON u.auth_id=t.user_id
 WHERE (p_status IS NULL OR p_status='all' OR t.status=p_status)
 AND (v_actor.role IN ('admin','creator') OR (v_actor.assigned_state IS NOT NULL AND lower(u.state)=lower(v_actor.assigned_state) AND (v_actor.assigned_lga IS NULL OR lower(COALESCE(u.local_government,u.city))=lower(v_actor.assigned_lga))))
 ORDER BY t.created_at DESC LIMIT 100;
END; $$;

CREATE OR REPLACE FUNCTION public.reply_my_staff_support_ticket(p_ticket_id uuid,p_reply text,p_resolve boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE v_actor record; v_ticket record; v_user record;
BEGIN
 SELECT user_id,role,assigned_state,assigned_lga,deleted,suspended,banned INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
 IF v_actor IS NULL OR COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN RAISE EXCEPTION 'Active staff account required'; END IF;
 IF v_actor.role='staff' AND NOT public.current_staff_has_permission('support') THEN RAISE EXCEPTION 'Support permission required'; END IF;
 IF v_actor.role NOT IN ('staff','admin','creator') THEN RAISE EXCEPTION 'Staff access required'; END IF;
 IF NULLIF(btrim(p_reply),'') IS NULL THEN RAISE EXCEPTION 'Reply is required'; END IF;
 SELECT * INTO v_ticket FROM public.support_tickets WHERE id=p_ticket_id FOR UPDATE; IF v_ticket IS NULL THEN RAISE EXCEPTION 'Ticket not found'; END IF;
 SELECT * INTO v_user FROM public.profiles WHERE auth_id=v_ticket.user_id LIMIT 1;
 IF v_actor.role='staff' AND NOT (v_actor.assigned_state IS NOT NULL AND lower(v_user.state)=lower(v_actor.assigned_state) AND (v_actor.assigned_lga IS NULL OR lower(COALESCE(v_user.local_government,v_user.city))=lower(v_actor.assigned_lga))) THEN RAISE EXCEPTION 'Ticket is outside your assigned branch'; END IF;
 UPDATE public.support_tickets SET reply=btrim(p_reply),status=CASE WHEN p_resolve THEN 'resolved' ELSE 'in_progress' END,updated_at=now() WHERE id=p_ticket_id;
 RETURN true;
END; $$;

-- Verification: branch-scoped worker review, never direct profile mutation from the browser.
CREATE OR REPLACE FUNCTION public.get_my_staff_worker_reviews(p_status text DEFAULT 'pending')
RETURNS SETOF public.profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE v_actor record;
BEGIN
 SELECT user_id,role,assigned_state,assigned_lga,deleted,suspended,banned INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
 IF v_actor IS NULL OR COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN RAISE EXCEPTION 'Active staff account required'; END IF;
 IF v_actor.role='staff' AND NOT public.current_staff_has_permission('verification') THEN RAISE EXCEPTION 'Verification permission required'; END IF;
 IF v_actor.role NOT IN ('staff','admin','creator') THEN RAISE EXCEPTION 'Staff access required'; END IF;
 RETURN QUERY SELECT w.* FROM public.profiles w WHERE w.role='worker' AND COALESCE(w.deleted,false)=false
 AND (p_status IS NULL OR p_status='all' OR w.worker_status=p_status)
 AND (v_actor.role IN ('admin','creator') OR (v_actor.assigned_state IS NOT NULL AND lower(w.state)=lower(v_actor.assigned_state) AND (v_actor.assigned_lga IS NULL OR lower(COALESCE(w.local_government,w.city))=lower(v_actor.assigned_lga))))
 ORDER BY w.created_at DESC;
END; $$;

CREATE OR REPLACE FUNCTION public.review_my_staff_worker(p_worker_id text,p_status text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE v_actor record; v_worker record;
BEGIN
 SELECT user_id,role,assigned_state,assigned_lga,deleted,suspended,banned INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
 IF v_actor IS NULL OR COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN RAISE EXCEPTION 'Active staff account required'; END IF;
 IF v_actor.role='staff' AND NOT public.current_staff_has_permission('verification') THEN RAISE EXCEPTION 'Verification permission required'; END IF;
 IF v_actor.role NOT IN ('staff','admin','creator') THEN RAISE EXCEPTION 'Staff access required'; END IF;
 IF p_status NOT IN ('verification_paid','suspended','rejected') THEN RAISE EXCEPTION 'Invalid worker status'; END IF;
 SELECT * INTO v_worker FROM public.profiles WHERE user_id=p_worker_id AND role='worker' FOR UPDATE; IF v_worker IS NULL THEN RAISE EXCEPTION 'Worker not found'; END IF;
 IF v_actor.role='staff' AND NOT (v_actor.assigned_state IS NOT NULL AND lower(v_worker.state)=lower(v_actor.assigned_state) AND (v_actor.assigned_lga IS NULL OR lower(COALESCE(v_worker.local_government,v_worker.city))=lower(v_actor.assigned_lga))) THEN RAISE EXCEPTION 'Worker is outside your assigned branch'; END IF;
 UPDATE public.profiles SET worker_status=p_status,worker_verified=(p_status='verification_paid'),updated_at=now(),updated_by=v_actor.user_id WHERE user_id=p_worker_id;
 RETURN true;
END; $$;

-- Finance is read-only in staff UI until the canonical transfer processor performs a withdrawal action.
CREATE OR REPLACE FUNCTION public.get_my_staff_finance_queue()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE v_actor record; v_withdrawals jsonb; v_commissions jsonb;
BEGIN
 SELECT user_id,role,deleted,suspended,banned INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
 IF v_actor IS NULL OR COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN RAISE EXCEPTION 'Active staff account required'; END IF;
 IF v_actor.role='staff' AND NOT public.current_staff_has_permission('finance') THEN RAISE EXCEPTION 'Finance permission required'; END IF;
 IF v_actor.role NOT IN ('staff','admin','creator') THEN RAISE EXCEPTION 'Staff access required'; END IF;
 SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_withdrawals FROM (SELECT w.id,w.amount,w.status,w.snapshot_bank_name,w.snapshot_bank_account_name,w.created_at FROM public.withdrawals w ORDER BY w.created_at DESC LIMIT 50) x;
 SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_commissions FROM (SELECT c.id,c.booking_type,c.commission_amount,c.gross_amount,c.status,c.created_at FROM public.commission_ledger c ORDER BY c.created_at DESC LIMIT 50) x;
 RETURN jsonb_build_object('withdrawals',v_withdrawals,'commissions',v_commissions);
END; $$;

-- Harden direct profile writes: ordinary staff must use scoped RPCs above.
DROP POLICY IF EXISTS profiles_update ON public.profiles;
CREATE POLICY profiles_update ON public.profiles FOR UPDATE TO authenticated
USING (auth_id=auth.uid()::text OR EXISTS (SELECT 1 FROM public.profiles actor WHERE actor.auth_id=auth.uid()::text AND actor.role IN ('admin','creator') AND COALESCE(actor.deleted,false)=false AND COALESCE(actor.suspended,false)=false AND COALESCE(actor.banned,false)=false))
WITH CHECK (auth_id=auth.uid()::text OR EXISTS (SELECT 1 FROM public.profiles actor WHERE actor.auth_id=auth.uid()::text AND actor.role IN ('admin','creator') AND COALESCE(actor.deleted,false)=false AND COALESCE(actor.suspended,false)=false AND COALESCE(actor.banned,false)=false));

REVOKE ALL ON FUNCTION public.get_my_staff_operations_listings(text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.review_my_staff_listing(uuid,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_my_staff_support_tickets(text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.reply_my_staff_support_ticket(uuid,text,boolean) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_my_staff_worker_reviews(text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.review_my_staff_worker(text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_my_staff_finance_queue() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_staff_operations_listings(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_my_staff_listing(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_staff_support_tickets(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reply_my_staff_support_ticket(uuid,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_staff_worker_reviews(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_my_staff_worker(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_staff_finance_queue() TO authenticated;

COMMIT;
