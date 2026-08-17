BEGIN;
CREATE OR REPLACE FUNCTION public.review_my_staff_worker(p_worker_id text,p_status text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE v_actor record; v_worker record;
BEGIN
 SELECT user_id,role,assigned_state,assigned_lga,deleted,suspended,banned INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
 IF v_actor IS NULL OR COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN RAISE EXCEPTION 'Active staff account required'; END IF;
 IF v_actor.role='staff' AND NOT public.current_staff_has_permission('verification') THEN RAISE EXCEPTION 'Verification permission required'; END IF;
 IF v_actor.role NOT IN ('staff','admin','creator') THEN RAISE EXCEPTION 'Staff access required'; END IF;
 IF p_status NOT IN ('profile_under_review','verified','suspended','rejected') THEN RAISE EXCEPTION 'Invalid worker review status'; END IF;
 SELECT * INTO v_worker FROM public.profiles WHERE user_id=p_worker_id AND role='worker' FOR UPDATE;
 IF v_worker IS NULL THEN RAISE EXCEPTION 'Worker not found'; END IF;
 IF v_actor.role='staff' AND NOT (v_actor.assigned_state IS NOT NULL AND lower(v_worker.state)=lower(v_actor.assigned_state) AND (v_actor.assigned_lga IS NULL OR lower(COALESCE(v_worker.local_government,v_worker.city))=lower(v_actor.assigned_lga))) THEN RAISE EXCEPTION 'Worker is outside your assigned branch'; END IF;
 IF p_status IN ('profile_under_review','verified','rejected') AND v_worker.worker_status NOT IN ('verification_paid','profile_under_review') THEN RAISE EXCEPTION 'Worker is not in the paid verification review flow'; END IF;
 UPDATE public.profiles SET worker_status=p_status,worker_verified=(p_status='verified'),updated_at=now(),updated_by=v_actor.user_id WHERE user_id=p_worker_id;
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.review_my_staff_worker(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_my_staff_worker(text,text) TO authenticated;
COMMIT;
