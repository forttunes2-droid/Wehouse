BEGIN;

-- ============================================================
-- Phase 1: operational access foundation.
-- Creator is global; Admin/Staff are exact State + LGA; public roles are
-- participant/owner-only. Direct financial/status mutation is removed from
-- browser tables and kept behind narrow RPCs.
-- ============================================================

CREATE OR REPLACE FUNCTION public.current_actor_can_access_listing_ref(p_listing_ref text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE v_actor public.profiles; v_listing public.listings;
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RETURN false; END IF;
  IF v_actor.role='creator' THEN RETURN true; END IF;
  IF v_actor.role NOT IN ('admin','staff') THEN RETURN false; END IF;
  SELECT * INTO v_listing FROM public.listings
  WHERE id::text=p_listing_ref OR listing_id=p_listing_ref LIMIT 1;
  IF v_listing IS NULL THEN RETURN false; END IF;
  RETURN public.current_actor_in_scope(v_listing.state,v_listing.city);
END;
$$;

CREATE OR REPLACE FUNCTION public.current_actor_can_access_reservation(p_reservation_id text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE v_listing_ref text;
BEGIN
  SELECT listing_id INTO v_listing_ref FROM public.reservations WHERE id=p_reservation_id LIMIT 1;
  IF v_listing_ref IS NULL THEN RETURN false; END IF;
  RETURN public.current_actor_can_access_listing_ref(v_listing_ref);
END;
$$;

CREATE OR REPLACE FUNCTION public.current_actor_can_access_worker_booking(p_booking_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE v_actor public.profiles; v_worker public.profiles;
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RETURN false; END IF;
  IF v_actor.role='creator' THEN RETURN true; END IF;
  IF v_actor.role NOT IN ('admin','staff') THEN RETURN false; END IF;
  SELECT w.* INTO v_worker FROM public.worker_bookings b
  JOIN public.profiles w ON w.user_id=b.worker_id WHERE b.id=p_booking_id LIMIT 1;
  IF v_worker IS NULL THEN RETURN false; END IF;
  RETURN public.current_actor_in_scope(v_worker.state,COALESCE(v_worker.local_government,v_worker.city));
END;
$$;

REVOKE ALL ON FUNCTION public.current_actor_can_access_listing_ref(text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.current_actor_can_access_reservation(text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.current_actor_can_access_worker_booking(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.current_actor_can_access_listing_ref(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_actor_can_access_reservation(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_actor_can_access_worker_booking(uuid) TO authenticated;

-- Worker bookings: read only directly. Every state/price transition is RPC-owned.
DROP POLICY IF EXISTS wb_all ON public.worker_bookings;
DROP POLICY IF EXISTS worker_bookings_read_canonical ON public.worker_bookings;
CREATE POLICY worker_bookings_read_canonical ON public.worker_bookings FOR SELECT TO authenticated
USING(
  user_id=public.current_profile_user_id()
  OR worker_id=public.current_profile_user_id()
  OR (public.current_profile_role() IN ('staff','admin','creator') AND public.current_actor_can_access_worker_booking(id))
);

DROP POLICY IF EXISTS booking_history_participant_read ON public.booking_status_history;
DROP POLICY IF EXISTS booking_history_staff_write ON public.booking_status_history;
DROP POLICY IF EXISTS booking_status_history_read_canonical ON public.booking_status_history;
CREATE POLICY booking_status_history_read_canonical ON public.booking_status_history FOR SELECT TO authenticated
USING(
  EXISTS(SELECT 1 FROM public.worker_bookings b
    WHERE b.id=booking_status_history.booking_id
      AND (b.user_id=public.current_profile_user_id() OR b.worker_id=public.current_profile_user_id()))
  OR (public.current_profile_role() IN ('staff','admin','creator') AND public.current_actor_can_access_worker_booking(booking_id))
);

DROP POLICY IF EXISTS booking_status_labels_read ON public.booking_status_labels;
DROP POLICY IF EXISTS booking_status_labels_staff_write ON public.booking_status_labels;
CREATE POLICY booking_status_labels_read_canonical ON public.booking_status_labels FOR SELECT TO authenticated USING(true);
CREATE POLICY booking_status_labels_creator_write_canonical ON public.booking_status_labels FOR ALL TO authenticated
USING(public.current_profile_role()='creator') WITH CHECK(public.current_profile_role()='creator');

-- Housing reservations and customer inspections.
DROP POLICY IF EXISTS reservations_read_own_or_staff ON public.reservations;
DROP POLICY IF EXISTS reservations_staff_update ON public.reservations;
DROP POLICY IF EXISTS reservations_read_canonical ON public.reservations;
CREATE POLICY reservations_read_canonical ON public.reservations FOR SELECT TO authenticated
USING(
  user_id=public.current_profile_user_id()
  OR (public.current_profile_role() IN ('staff','admin','creator') AND public.current_actor_can_access_listing_ref(listing_id))
);

DROP POLICY IF EXISTS users_own_refunds ON public.reservation_refunds;
DROP POLICY IF EXISTS staff_admin_all_refunds ON public.reservation_refunds;
DROP POLICY IF EXISTS reservation_refunds_read_canonical ON public.reservation_refunds;
CREATE POLICY reservation_refunds_read_canonical ON public.reservation_refunds FOR SELECT TO authenticated
USING(
  user_id=public.current_profile_user_id()
  OR (public.current_profile_role() IN ('staff','admin','creator') AND public.current_actor_can_access_reservation(reservation_id))
);

DROP POLICY IF EXISTS uir_read_own_or_staff ON public.user_inspection_requests;
DROP POLICY IF EXISTS uir_staff_update ON public.user_inspection_requests;
DROP POLICY IF EXISTS user_inspection_requests_read_canonical ON public.user_inspection_requests;
CREATE POLICY user_inspection_requests_read_canonical ON public.user_inspection_requests FOR SELECT TO authenticated
USING(
  user_id=public.current_profile_user_id()
  OR field_officer_id=public.current_profile_user_id()
  OR (public.current_profile_role() IN ('staff','admin','creator') AND public.current_actor_can_access_listing_ref(listing_id))
);

DROP POLICY IF EXISTS inspection_requests_staff_read ON public.inspection_requests;
DROP POLICY IF EXISTS inspection_requests_staff_update ON public.inspection_requests;
DROP POLICY IF EXISTS inspection_requests_partner_read ON public.inspection_requests;
DROP POLICY IF EXISTS inspection_requests_read_canonical ON public.inspection_requests;
CREATE POLICY inspection_requests_read_canonical ON public.inspection_requests FOR SELECT TO authenticated
USING(
  owner_id=public.current_profile_user_id()
  OR (public.current_profile_role()='creator')
  OR (public.current_profile_role() IN ('admin','staff') AND public.current_actor_in_scope(property_state,property_city))
);

DROP POLICY IF EXISTS inspection_history_staff_read ON public.inspection_status_history;
DROP POLICY IF EXISTS inspection_history_staff_write ON public.inspection_status_history;
DROP POLICY IF EXISTS inspection_status_history_read_canonical ON public.inspection_status_history;
CREATE POLICY inspection_status_history_read_canonical ON public.inspection_status_history FOR SELECT TO authenticated
USING(
  EXISTS(SELECT 1 FROM public.inspection_requests ir
    WHERE ir.id=inspection_status_history.inspection_request_id
      AND (ir.owner_id=public.current_profile_user_id()
        OR public.current_profile_role()='creator'
        OR (public.current_profile_role() IN ('admin','staff') AND public.current_actor_in_scope(ir.property_state,ir.property_city))))
);

-- Rent-plan records: owner or branch operations read. Mutation remains RPC-only.
DROP POLICY IF EXISTS users_own_rent_plans ON public.rent_plans;
DROP POLICY IF EXISTS staff_admin_manage_rent ON public.rent_plans;
DROP POLICY IF EXISTS rent_plans_read_canonical ON public.rent_plans;
CREATE POLICY rent_plans_read_canonical ON public.rent_plans FOR SELECT TO authenticated
USING(
  user_id=public.current_profile_user_id()
  OR (public.current_profile_role() IN ('staff','admin','creator') AND public.current_actor_can_access_listing_ref(listing_id::text))
);

-- Financial records are not editable by the browser. Owners read their own;
-- Creator/Admin may read branch records. Finance Staff uses a scoped RPC below.
DROP POLICY IF EXISTS user_own_bank ON public.bank_account_history;
DROP POLICY IF EXISTS staff_admin_all_bank ON public.bank_account_history;
DROP POLICY IF EXISTS bank_account_history_read_canonical ON public.bank_account_history;
CREATE POLICY bank_account_history_read_canonical ON public.bank_account_history FOR SELECT TO authenticated
USING(
  user_id=public.current_profile_user_id()
  OR public.current_profile_role()='creator'
  OR (public.current_profile_role()='admin' AND public.can_current_actor_read_profile(user_id))
);

DROP POLICY IF EXISTS audit_log_staff ON public.financial_audit_log;
DROP POLICY IF EXISTS financial_audit_log_read_canonical ON public.financial_audit_log;
CREATE POLICY financial_audit_log_read_canonical ON public.financial_audit_log FOR SELECT TO authenticated
USING(
  public.current_profile_role()='creator'
  OR (public.current_profile_role()='admin' AND target_user_id IS NOT NULL AND public.can_current_actor_read_profile(target_user_id))
);

DROP POLICY IF EXISTS audit_staff ON public.financial_audit_logs;
DROP POLICY IF EXISTS financial_audit_logs_read_canonical ON public.financial_audit_logs;
CREATE POLICY financial_audit_logs_read_canonical ON public.financial_audit_logs FOR SELECT TO authenticated
USING(
  public.current_profile_role()='creator'
  OR (public.current_profile_role()='admin' AND target_user_id IS NOT NULL AND public.can_current_actor_read_profile(target_user_id))
);

DROP POLICY IF EXISTS wallets_staff ON public.wallets;
DROP POLICY IF EXISTS wallets_own ON public.wallets;
DROP POLICY IF EXISTS wallets_read_canonical ON public.wallets;
CREATE POLICY wallets_read_canonical ON public.wallets FOR SELECT TO authenticated
USING(
  owner_id=public.current_profile_user_id()
  OR public.current_profile_role()='creator'
  OR (public.current_profile_role()='admin' AND public.can_current_actor_read_profile(owner_id))
);

DROP POLICY IF EXISTS withdrawals_staff ON public.withdrawals;
DROP POLICY IF EXISTS withdrawals_owner ON public.withdrawals;
DROP POLICY IF EXISTS withdrawals_read_canonical ON public.withdrawals;
CREATE POLICY withdrawals_read_canonical ON public.withdrawals FOR SELECT TO authenticated
USING(EXISTS(SELECT 1 FROM public.wallets w WHERE w.id=withdrawals.wallet_id AND (
  w.owner_id=public.current_profile_user_id()
  OR public.current_profile_role()='creator'
  OR (public.current_profile_role()='admin' AND public.can_current_actor_read_profile(w.owner_id))
)));

DROP POLICY IF EXISTS escrow_participant ON public.escrow_transactions;
DROP POLICY IF EXISTS escrow_read_canonical ON public.escrow_transactions;
CREATE POLICY escrow_read_canonical ON public.escrow_transactions FOR SELECT TO authenticated
USING(
  payer_user_id=public.current_profile_user_id() OR payee_user_id=public.current_profile_user_id()
  OR public.current_profile_role()='creator'
  OR (public.current_profile_role()='admin' AND (
    public.can_current_actor_read_profile(payer_user_id) OR public.can_current_actor_read_profile(payee_user_id)))
);

DROP POLICY IF EXISTS staff_admin_reversals ON public.payment_reversals;
DROP POLICY IF EXISTS payment_reversals_read_canonical ON public.payment_reversals;
CREATE POLICY payment_reversals_read_canonical ON public.payment_reversals FOR SELECT TO authenticated
USING(
  public.current_profile_role()='creator'
  OR (public.current_profile_role()='admin' AND EXISTS(
    SELECT 1 FROM public.booking_payments bp WHERE bp.id=payment_reversals.original_payment_id
      AND (public.can_current_actor_read_profile(bp.user_id)
        OR public.can_current_actor_read_profile(bp.payer_user_id)
        OR public.can_current_actor_read_profile(bp.payee_user_id)
        OR (bp.listing_id IS NOT NULL AND public.current_actor_can_access_listing_ref(bp.listing_id::text)))
  ))
);

-- Remove obsolete Saved Listing policies that used auth UUID as WeHouse ID.
DROP POLICY IF EXISTS saved_delete ON public.saved_listings;
DROP POLICY IF EXISTS saved_insert ON public.saved_listings;
DROP POLICY IF EXISTS saved_select ON public.saved_listings;

-- Branch-scoped Staff operations list: Admin is no longer global.
CREATE OR REPLACE FUNCTION public.get_my_staff_operations_listings(p_status text DEFAULT NULL)
RETURNS SETOF public.listings LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE v_actor public.profiles;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text
    AND role IN ('staff','admin','creator') AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Active operations account required'; END IF;
  IF v_actor.role='staff' AND NOT public.current_staff_has_permission('operations') THEN RAISE EXCEPTION 'Operations permission required'; END IF;
  IF v_actor.role IN ('staff','admin') AND (v_actor.assigned_state IS NULL OR v_actor.assigned_lga IS NULL) THEN RAISE EXCEPTION 'Branch assignment required'; END IF;
  RETURN QUERY SELECT l.* FROM public.listings l
  WHERE l.deleted_at IS NULL AND (p_status IS NULL OR p_status='all' OR l.status=p_status)
    AND (v_actor.role='creator' OR (lower(COALESCE(l.state,''))=lower(v_actor.assigned_state)
      AND lower(COALESCE(l.city,''))=lower(v_actor.assigned_lga)))
  ORDER BY l.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_staff_operations_listings(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_staff_operations_listings(text) TO authenticated;

-- Safe branch finance queue. It can read privileged tables only through this
-- narrow SECURITY DEFINER response; direct browser mutation remains denied.
CREATE OR REPLACE FUNCTION public.get_my_staff_finance_queue()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_actor public.profiles; v_payments jsonb; v_withdrawals jsonb; v_commissions jsonb; v_escrow jsonb; v_refunds jsonb; v_audit jsonb;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text
    AND role IN ('staff','admin','creator') AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Active finance account required'; END IF;
  IF v_actor.role='staff' AND NOT public.current_staff_has_permission('finance') THEN RAISE EXCEPTION 'Finance permission required'; END IF;
  IF v_actor.role IN ('staff','admin') AND (v_actor.assigned_state IS NULL OR v_actor.assigned_lga IS NULL) THEN RAISE EXCEPTION 'Branch assignment required'; END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_payments FROM (
    SELECT bp.id,bp.payment_reference,bp.type,bp.booking_type,bp.amount,bp.amount_total,bp.amount_commission,bp.net_amount,bp.currency,bp.status,bp.purpose,bp.payment_method,bp.paystack_reference,bp.verified_at,bp.paid_at,bp.created_at
    FROM public.booking_payments bp
    WHERE v_actor.role='creator' OR public.can_current_actor_read_profile(bp.user_id)
      OR public.can_current_actor_read_profile(bp.payer_user_id) OR public.can_current_actor_read_profile(bp.payee_user_id)
      OR (bp.listing_id IS NOT NULL AND public.current_actor_can_access_listing_ref(bp.listing_id::text))
    ORDER BY bp.created_at DESC LIMIT 100) x;

  SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_withdrawals FROM (
    SELECT wd.id,wd.amount,wd.status,wd.snapshot_bank_name,wd.snapshot_bank_account_number,wd.snapshot_bank_account_name,wd.paystack_transfer_reference,wd.processed_at,wd.failed_reason,wd.created_at
    FROM public.withdrawals wd JOIN public.wallets w ON w.id=wd.wallet_id
    WHERE v_actor.role='creator' OR public.can_current_actor_read_profile(w.owner_id)
    ORDER BY wd.created_at DESC LIMIT 100) x;

  SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_commissions FROM (
    SELECT c.id,c.booking_type,c.commission_amount,c.commission_rate,c.gross_amount,c.description,c.paystack_reference,c.status,c.created_at
    FROM public.commission_ledger c
    WHERE v_actor.role='creator' OR public.can_current_actor_read_profile(c.source_user_id)
    ORDER BY c.created_at DESC LIMIT 100) x;

  SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_escrow FROM (
    SELECT e.id,e.booking_id,e.booking_type,e.amount_total,e.amount_commission,e.amount_payee,e.commission_rate,e.status,e.released_at,e.released_by,e.paystack_reference,e.created_at
    FROM public.escrow_transactions e
    WHERE v_actor.role='creator' OR public.can_current_actor_read_profile(e.payer_user_id) OR public.can_current_actor_read_profile(e.payee_user_id)
    ORDER BY e.created_at DESC LIMIT 100) x;

  SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_refunds FROM (
    SELECT bp.id,bp.payment_reference,bp.booking_type,bp.amount_total,bp.status,bp.refund_reason,bp.refund_processed_at,bp.refund_reference,bp.created_at
    FROM public.booking_payments bp
    WHERE (bp.refund_reason IS NOT NULL OR bp.refund_processed_at IS NOT NULL OR bp.refund_reference IS NOT NULL OR lower(COALESCE(bp.status,'')) LIKE 'refund%')
      AND (v_actor.role='creator' OR public.can_current_actor_read_profile(bp.user_id)
        OR public.can_current_actor_read_profile(bp.payer_user_id) OR public.can_current_actor_read_profile(bp.payee_user_id)
        OR (bp.listing_id IS NOT NULL AND public.current_actor_can_access_listing_ref(bp.listing_id::text)))
    ORDER BY bp.created_at DESC LIMIT 100) x;

  SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_audit FROM (
    SELECT a.id,a.action,a.actor_role,a.target_type,a.target_id,a.amount,a.commission_amount,a.description,a.status_before,a.status_after,a.failure_reason,a.created_at
    FROM public.financial_audit_log a
    WHERE v_actor.role='creator' OR (a.target_user_id IS NOT NULL AND public.can_current_actor_read_profile(a.target_user_id))
    ORDER BY a.created_at DESC LIMIT 100) x;

  RETURN jsonb_build_object('payments',v_payments,'withdrawals',v_withdrawals,'commissions',v_commissions,'escrow',v_escrow,'refunds',v_refunds,'audit',v_audit);
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_staff_finance_queue() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_staff_finance_queue() TO authenticated;

-- Old Staff listing approval path conflicts with canonical Admin/Creator approval.
REVOKE ALL ON FUNCTION public.review_my_staff_listing(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.review_my_staff_listing(uuid,text,text) TO service_role;

-- Customer inspection assignment: only Admin/Creator can assign; Field Officer
-- must be active, permissioned and in the exact property branch.
CREATE OR REPLACE FUNCTION public.staff_assign_customer_inspection(p_inspection_id uuid,p_field_officer_id text,p_scheduled_date timestamptz DEFAULT NULL)
RETURNS public.user_inspection_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_actor public.profiles; v_req public.user_inspection_requests; v_listing public.listings; v_officer public.profiles;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role IN ('admin','creator')
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Admin or Creator access required'; END IF;
  SELECT * INTO v_req FROM public.user_inspection_requests WHERE id=p_inspection_id AND status='pending' FOR UPDATE;
  IF v_req IS NULL THEN RAISE EXCEPTION 'Pending inspection request not found'; END IF;
  SELECT * INTO v_listing FROM public.listings WHERE id::text=v_req.listing_id OR listing_id=v_req.listing_id LIMIT 1;
  IF v_listing IS NULL THEN RAISE EXCEPTION 'Inspection listing not found'; END IF;
  IF v_actor.role='admin' AND NOT public.current_actor_in_scope(v_listing.state,v_listing.city) THEN RAISE EXCEPTION 'Inspection is outside your assigned branch'; END IF;
  SELECT * INTO v_officer FROM public.profiles WHERE user_id=p_field_officer_id AND role='staff'
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_officer IS NULL OR lower(COALESCE(v_officer.assigned_state,''))<>lower(COALESCE(v_listing.state,''))
    OR lower(COALESCE(v_officer.assigned_lga,''))<>lower(COALESCE(v_listing.city,''))
    OR NOT EXISTS(SELECT 1 FROM public.staff_permissions sp WHERE sp.staff_id=v_officer.user_id AND sp.permission='field_officer' AND sp.is_active=true)
  THEN RAISE EXCEPTION 'Eligible Field Officer in the listing branch is required'; END IF;
  UPDATE public.user_inspection_requests SET field_officer_id=v_officer.user_id,status='scheduled',scheduled_date=p_scheduled_date,updated_at=now()
  WHERE id=p_inspection_id RETURNING * INTO v_req;
  RETURN v_req;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_start_customer_inspection(p_inspection_id uuid)
RETURNS public.user_inspection_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_actor public.profiles; v_req public.user_inspection_requests;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role IN ('staff','admin','creator')
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Field operations access required'; END IF;
  SELECT * INTO v_req FROM public.user_inspection_requests WHERE id=p_inspection_id AND status='scheduled' FOR UPDATE;
  IF v_req IS NULL THEN RAISE EXCEPTION 'Scheduled inspection not found'; END IF;
  IF v_actor.role='staff' THEN
    IF v_req.field_officer_id<>v_actor.user_id OR NOT public.current_staff_has_permission('field_officer') THEN RAISE EXCEPTION 'Inspection is not assigned to this Field Officer'; END IF;
  ELSIF v_actor.role='admin' AND NOT public.current_actor_can_access_listing_ref(v_req.listing_id) THEN RAISE EXCEPTION 'Inspection is outside your assigned branch'; END IF;
  UPDATE public.user_inspection_requests SET status='in_progress',updated_at=now() WHERE id=p_inspection_id RETURNING * INTO v_req;
  RETURN v_req;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_complete_customer_inspection(p_inspection_id uuid,p_report text,p_condition text,p_photo_urls text[] DEFAULT ARRAY[]::text[])
RETURNS public.user_inspection_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_actor public.profiles; v_req public.user_inspection_requests;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role IN ('staff','admin','creator')
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Field operations access required'; END IF;
  IF NULLIF(BTRIM(COALESCE(p_report,'')),'') IS NULL OR NULLIF(BTRIM(COALESCE(p_condition,'')),'') IS NULL THEN RAISE EXCEPTION 'Inspection report and condition are required'; END IF;
  SELECT * INTO v_req FROM public.user_inspection_requests WHERE id=p_inspection_id AND status='in_progress' FOR UPDATE;
  IF v_req IS NULL THEN RAISE EXCEPTION 'Active inspection not found'; END IF;
  IF v_actor.role='staff' THEN
    IF v_req.field_officer_id<>v_actor.user_id OR NOT public.current_staff_has_permission('field_officer') THEN RAISE EXCEPTION 'Inspection is not assigned to this Field Officer'; END IF;
  ELSIF v_actor.role='admin' AND NOT public.current_actor_can_access_listing_ref(v_req.listing_id) THEN RAISE EXCEPTION 'Inspection is outside your assigned branch'; END IF;
  UPDATE public.user_inspection_requests SET status='completed',report=BTRIM(p_report),condition=BTRIM(p_condition),photo_urls=COALESCE(p_photo_urls,ARRAY[]::text[]),updated_at=now()
  WHERE id=p_inspection_id RETURNING * INTO v_req;
  UPDATE public.reservations SET inspection_completed=true,inspection_completed_at=now(),updated_at=now() WHERE id=v_req.reservation_id;
  RETURN v_req;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_inspection_result(p_inspection_id uuid,p_result text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_actor public.profiles; v_req public.user_inspection_requests;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role IN ('staff','admin','creator')
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Field operations access required'; END IF;
  IF p_result NOT IN ('passed','failed','customer_declined') THEN RAISE EXCEPTION 'Invalid inspection result'; END IF;
  SELECT * INTO v_req FROM public.user_inspection_requests WHERE id=p_inspection_id FOR UPDATE;
  IF v_req IS NULL THEN RAISE EXCEPTION 'Inspection not found'; END IF;
  IF v_actor.role='staff' THEN
    IF v_req.field_officer_id<>v_actor.user_id OR NOT public.current_staff_has_permission('field_officer') THEN RAISE EXCEPTION 'Inspection is not assigned to this Field Officer'; END IF;
  ELSIF v_actor.role='admin' AND NOT public.current_actor_can_access_listing_ref(v_req.listing_id) THEN RAISE EXCEPTION 'Inspection is outside your assigned branch'; END IF;
  UPDATE public.user_inspection_requests SET status='completed',condition=p_result,updated_at=now() WHERE id=p_inspection_id;
  UPDATE public.reservations SET inspection_result=p_result,inspection_completed=true,inspection_completed_at=now(),updated_at=now() WHERE id=v_req.reservation_id;
  IF p_result='customer_declined' THEN
    UPDATE public.reservations SET status='cancelled',processed_at=now(),updated_at=now() WHERE id=v_req.reservation_id;
    UPDATE public.listings SET availability_status='available',status='available',reserved_by=NULL,reservation_expiry=NULL,updated_at=now() WHERE id::text=v_req.listing_id OR listing_id=v_req.listing_id;
  END IF;
  RETURN true;
END;
$$;

-- Refund calculation can be viewed by the owner, branch Finance Staff/Admin,
-- or Creator. Actual refund processing is Admin/Creator only.
CREATE OR REPLACE FUNCTION public.calculate_reservation_refund(p_reservation_id text,p_reason_category text)
RETURNS TABLE(refund_amount numeric,wehouse_retained numeric,refund_percent numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_res public.reservations; v_actor public.profiles; v_percent numeric;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_res FROM public.reservations WHERE id=p_reservation_id;
  IF v_res IS NULL THEN RAISE EXCEPTION 'Reservation not found'; END IF;
  IF v_res.user_id<>v_actor.user_id THEN
    IF v_actor.role='staff' THEN
      IF NOT public.current_staff_has_permission('finance') OR NOT public.current_actor_can_access_listing_ref(v_res.listing_id) THEN RAISE EXCEPTION 'Finance branch access required'; END IF;
    ELSIF v_actor.role='admin' THEN
      IF NOT public.current_actor_can_access_listing_ref(v_res.listing_id) THEN RAISE EXCEPTION 'Reservation is outside your branch'; END IF;
    ELSIF v_actor.role<>'creator' THEN RAISE EXCEPTION 'Not authorized'; END IF;
  END IF;
  CASE p_reason_category
    WHEN 'expired_no_action' THEN v_percent:=0;
    WHEN 'customer_declined_inspection' THEN SELECT COALESCE(NULLIF(value,'')::numeric,50) INTO v_percent FROM public.platform_settings WHERE key='post_inspection_refund_percent';
    WHEN 'provider_failure','listing_mismatch' THEN v_percent:=100;
    ELSE RAISE EXCEPTION 'Invalid refund reason';
  END CASE;
  refund_amount:=round(v_res.amount*v_percent/100,2); wehouse_retained:=v_res.amount-refund_amount; refund_percent:=v_percent; RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_reservation_refund(p_reservation_id text,p_reason_category text,p_reason_detail text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_res public.reservations; v_calc record; v_actor public.profiles;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role IN ('admin','creator')
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Admin or Creator refund authority required'; END IF;
  SELECT * INTO v_res FROM public.reservations WHERE id=p_reservation_id FOR UPDATE;
  IF v_res IS NULL THEN RAISE EXCEPTION 'Reservation not found'; END IF;
  IF v_actor.role='admin' AND NOT public.current_actor_can_access_listing_ref(v_res.listing_id) THEN RAISE EXCEPTION 'Reservation is outside your assigned branch'; END IF;
  IF v_res.status='refunded' THEN RETURN true; END IF;
  SELECT * INTO v_calc FROM public.calculate_reservation_refund(p_reservation_id,p_reason_category);
  INSERT INTO public.reservation_refunds(reservation_id,user_id,original_amount,refund_percent,refund_amount,wehouse_retained,reason_category,reason_detail,processed_by)
  VALUES(v_res.id,v_res.user_id,v_res.amount,v_calc.refund_percent,v_calc.refund_amount,v_calc.wehouse_retained,p_reason_category,NULLIF(BTRIM(COALESCE(p_reason_detail,'')),''),v_actor.user_id);
  UPDATE public.reservations SET status='refunded',refund_amount=v_calc.refund_amount,refund_reason=p_reason_category,processed_by=v_actor.user_id,processed_at=now(),updated_at=now() WHERE id=v_res.id;
  UPDATE public.listings SET availability_status='available',status='available',reserved_by=NULL,reservation_expiry=NULL,updated_at=now() WHERE id::text=v_res.listing_id OR listing_id=v_res.listing_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_overdue_reservations()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_role text; v_count integer; v_listing_ids text[];
BEGIN
  IF auth.uid() IS NOT NULL THEN
    SELECT role INTO v_role FROM public.profiles WHERE auth_id=auth.uid()::text AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
    IF v_role<>'creator' THEN RAISE EXCEPTION 'Creator or service execution required'; END IF;
  END IF;
  SELECT array_agg(listing_id) INTO v_listing_ids FROM public.reservations WHERE status='active' AND hold_expires_at<now();
  UPDATE public.reservations SET status='expired',refund_amount=0,refund_reason='Reservation hold expired',processed_at=now(),updated_at=now() WHERE status='active' AND hold_expires_at<now();
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_listing_ids IS NOT NULL THEN UPDATE public.listings SET availability_status='available',status='available',reserved_by=NULL,reservation_expiry=NULL,updated_at=now() WHERE id::text=ANY(v_listing_ids) OR listing_id=ANY(v_listing_ids); END IF;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.staff_assign_customer_inspection(uuid,text,timestamptz) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.staff_start_customer_inspection(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.staff_complete_customer_inspection(uuid,text,text,text[]) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.complete_inspection_result(uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.calculate_reservation_refund(text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.process_reservation_refund(text,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.expire_overdue_reservations() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_assign_customer_inspection(uuid,text,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_start_customer_inspection(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_complete_customer_inspection(uuid,text,text,text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_inspection_result(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_reservation_refund(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_reservation_refund(text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expire_overdue_reservations() TO authenticated,service_role;

-- High-risk Property Partner earning mutations are Admin/Creator only and exact
-- branch for Admin. Finance Staff can view their branch queue but cannot move money.
CREATE OR REPLACE FUNCTION public.hold_property_partner_earning(p_payment_id uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_actor public.profiles; v_e record; v_wallet record;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role IN ('admin','creator')
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Admin or Creator finance authority required'; END IF;
  IF NULLIF(BTRIM(COALESCE(p_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'Hold reason is required'; END IF;
  SELECT * INTO v_e FROM public.property_partner_earning_releases WHERE payment_id=p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Property Partner earning not found'; END IF;
  IF v_actor.role='admin' AND NOT public.can_current_actor_read_profile(v_e.partner_id) THEN RAISE EXCEPTION 'Partner is outside your assigned branch'; END IF;
  IF v_e.status='reversed' THEN RAISE EXCEPTION 'Reversed earnings cannot be held'; END IF;
  IF v_e.status='held' THEN RETURN jsonb_build_object('success',true,'already_held',true); END IF;
  SELECT * INTO v_wallet FROM public.wallets WHERE owner_id=v_e.partner_id AND owner_type='property_partner' FOR UPDATE;
  IF v_e.status='available' AND v_wallet.id IS NOT NULL THEN UPDATE public.wallets SET is_frozen=true,frozen_reason='Property earning dispute: '||BTRIM(p_reason),frozen_by=v_actor.user_id,frozen_at=now(),updated_at=now() WHERE id=v_wallet.id; END IF;
  UPDATE public.property_partner_earning_releases SET status='held',held_by=v_actor.user_id,held_at=now(),hold_reason=BTRIM(p_reason),updated_at=now() WHERE id=v_e.id;
  UPDATE public.commission_ledger SET status='disputed',updated_at=now() WHERE payment_id=p_payment_id;
  INSERT INTO public.financial_audit_logs(event_type,user_id,target_user_id,amount,reference_id,reference_type,description,metadata) VALUES('dispute_opened',v_actor.user_id,v_e.partner_id,v_e.net_amount,p_payment_id::text,'booking_payment','Property Partner earning placed on hold',jsonb_build_object('reason',BTRIM(p_reason),'previous_status',v_e.status));
  RETURN jsonb_build_object('success',true,'status','held');
END;
$$;

CREATE OR REPLACE FUNCTION public.release_property_partner_earning(p_payment_id uuid,p_release_event text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_actor public.profiles; v_e record; v_wallet record; v_expected text; v_new_pending numeric; v_new_available numeric;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role IN ('admin','creator')
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Admin or Creator finance authority required'; END IF;
  SELECT * INTO v_e FROM public.property_partner_earning_releases WHERE payment_id=p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending Property Partner earning not found'; END IF;
  IF v_actor.role='admin' AND NOT public.can_current_actor_read_profile(v_e.partner_id) THEN RAISE EXCEPTION 'Partner is outside your assigned branch'; END IF;
  IF v_e.status='available' THEN RETURN jsonb_build_object('success',true,'already_released',true); END IF;
  IF v_e.status<>'pending' THEN RAISE EXCEPTION 'Earning is not releasable from status %',v_e.status; END IF;
  v_expected:=CASE v_e.earning_type WHEN 'long_stay_rent' THEN 'long_stay_move_in_confirmed' WHEN 'rent_plan_contribution' THEN 'long_stay_installment_period_confirmed' WHEN 'short_stay_rent' THEN 'short_stay_check_in_confirmed' WHEN 'hotel_payment' THEN 'hotel_stay_completed' END;
  IF p_release_event IS DISTINCT FROM v_expected THEN RAISE EXCEPTION 'Invalid release event'; END IF;
  SELECT * INTO v_wallet FROM public.wallets WHERE owner_id=v_e.partner_id AND owner_type='property_partner' FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_wallet.is_frozen,false) OR COALESCE(v_wallet.pending_balance,0)<v_e.net_amount THEN RAISE EXCEPTION 'Partner wallet is not releasable'; END IF;
  v_new_pending:=v_wallet.pending_balance-v_e.net_amount; v_new_available:=COALESCE(v_wallet.available_balance,0)+v_e.net_amount;
  UPDATE public.wallets SET pending_balance=v_new_pending,available_balance=v_new_available,updated_at=now() WHERE id=v_wallet.id;
  UPDATE public.property_partner_earning_releases SET status='available',release_event=p_release_event,released_by=v_actor.user_id,released_at=now(),updated_at=now() WHERE id=v_e.id;
  UPDATE public.commission_ledger SET status='settled',updated_at=now() WHERE payment_id=p_payment_id AND status='collected';
  UPDATE public.property_partners SET total_earnings=COALESCE(total_earnings,0)+v_e.net_amount,updated_at=now() WHERE profile_id=v_e.partner_id;
  INSERT INTO public.wallet_transactions(user_id,transaction_type,amount,balance_after,reference_id,reference_type,description,metadata) VALUES(v_e.partner_id,'property_earning_released',v_e.net_amount,v_new_available,p_payment_id::text,'booking_payment','Property earnings released to available balance',jsonb_build_object('release_event',p_release_event,'earning_type',v_e.earning_type,'pending_balance_after',v_new_pending,'available_balance_after',v_new_available));
  INSERT INTO public.financial_audit_logs(event_type,user_id,target_user_id,amount,reference_id,reference_type,description,metadata) VALUES('escrow_credit_wallet',v_actor.user_id,v_e.partner_id,v_e.net_amount,p_payment_id::text,'booking_payment','Pending Property Partner earnings released',jsonb_build_object('release_event',p_release_event,'earning_type',v_e.earning_type));
  RETURN jsonb_build_object('success',true,'partner_id',v_e.partner_id,'amount',v_e.net_amount,'status','available');
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_pending_property_partner_earning(p_payment_id uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_actor public.profiles; v_e record; v_wallet record; v_new_pending numeric;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role IN ('admin','creator')
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Admin or Creator finance authority required'; END IF;
  IF NULLIF(BTRIM(COALESCE(p_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'Reversal reason is required'; END IF;
  SELECT * INTO v_e FROM public.property_partner_earning_releases WHERE payment_id=p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Property Partner earning not found'; END IF;
  IF v_actor.role='admin' AND NOT public.can_current_actor_read_profile(v_e.partner_id) THEN RAISE EXCEPTION 'Partner is outside your assigned branch'; END IF;
  IF v_e.status='reversed' THEN RETURN jsonb_build_object('success',true,'already_reversed',true); END IF;
  IF v_e.status<>'pending' THEN RAISE EXCEPTION 'Only pending earnings can be reversed'; END IF;
  SELECT * INTO v_wallet FROM public.wallets WHERE owner_id=v_e.partner_id AND owner_type='property_partner' FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_wallet.pending_balance,0)<v_e.net_amount THEN RAISE EXCEPTION 'Pending wallet balance is inconsistent'; END IF;
  v_new_pending:=v_wallet.pending_balance-v_e.net_amount;
  UPDATE public.wallets SET pending_balance=v_new_pending,updated_at=now() WHERE id=v_wallet.id;
  UPDATE public.property_partner_earning_releases SET status='reversed',reversed_by=v_actor.user_id,reversed_at=now(),reversal_reason=BTRIM(p_reason),updated_at=now() WHERE id=v_e.id;
  UPDATE public.commission_ledger SET status='refunded',updated_at=now() WHERE payment_id=p_payment_id;
  INSERT INTO public.wallet_transactions(user_id,transaction_type,amount,balance_after,reference_id,reference_type,description,metadata) VALUES(v_e.partner_id,'property_earning_reversed',-v_e.net_amount,v_new_pending,p_payment_id::text,'booking_payment','Pending property earnings reversed',jsonb_build_object('reason',BTRIM(p_reason),'wallet_bucket','pending'));
  INSERT INTO public.financial_audit_logs(event_type,user_id,target_user_id,amount,reference_id,reference_type,description,metadata) VALUES('payment_reversed',v_actor.user_id,v_e.partner_id,v_e.net_amount,p_payment_id::text,'booking_payment','Pending Property Partner earning reversed',jsonb_build_object('reason',BTRIM(p_reason)));
  RETURN jsonb_build_object('success',true,'status','reversed','pending_balance',v_new_pending);
END;
$$;

REVOKE ALL ON FUNCTION public.hold_property_partner_earning(uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.release_property_partner_earning(uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.reverse_pending_property_partner_earning(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.hold_property_partner_earning(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_property_partner_earning(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_pending_property_partner_earning(uuid,text) TO authenticated;

COMMIT;
