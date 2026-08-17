BEGIN;

-- Final Staff Dashboard correction.
-- Keep staff permissions server-derived and expose the complete canonical finance picture
-- without duplicating protected payout/refund execution in the browser.

CREATE OR REPLACE FUNCTION public.get_my_staff_finance_queue()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE
  v_actor record;
  v_payments jsonb;
  v_withdrawals jsonb;
  v_commissions jsonb;
  v_escrow jsonb;
  v_refunds jsonb;
  v_audit jsonb;
BEGIN
  SELECT user_id,role,deleted,suspended,banned
  INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
  LIMIT 1;

  IF v_actor IS NULL OR COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN
    RAISE EXCEPTION 'Active staff account required';
  END IF;
  IF v_actor.role='staff' AND NOT public.current_staff_has_permission('finance') THEN
    RAISE EXCEPTION 'Finance permission required';
  END IF;
  IF v_actor.role NOT IN ('staff','admin','creator') THEN
    RAISE EXCEPTION 'Staff access required';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_payments
  FROM (
    SELECT id,payment_reference,type,booking_type,amount,amount_total,amount_commission,net_amount,currency,status,purpose,payment_method,paystack_reference,verified_at,paid_at,created_at
    FROM public.booking_payments
    ORDER BY created_at DESC LIMIT 100
  ) x;

  SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_withdrawals
  FROM (
    SELECT id,amount,status,snapshot_bank_name,snapshot_bank_account_number,snapshot_bank_account_name,paystack_transfer_reference,processed_at,failed_reason,created_at
    FROM public.withdrawals
    ORDER BY created_at DESC LIMIT 100
  ) x;

  SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_commissions
  FROM (
    SELECT id,booking_type,commission_amount,commission_rate,gross_amount,description,paystack_reference,status,created_at
    FROM public.commission_ledger
    ORDER BY created_at DESC LIMIT 100
  ) x;

  SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_escrow
  FROM (
    SELECT id,booking_id,booking_type,amount_total,amount_commission,amount_payee,commission_rate,status,released_at,released_by,paystack_reference,created_at
    FROM public.escrow_transactions
    ORDER BY created_at DESC LIMIT 100
  ) x;

  SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_refunds
  FROM (
    SELECT id,payment_reference,booking_type,amount_total,status,refund_reason,refund_processed_at,refund_reference,created_at
    FROM public.booking_payments
    WHERE refund_reason IS NOT NULL OR refund_processed_at IS NOT NULL OR refund_reference IS NOT NULL OR lower(COALESCE(status,'')) LIKE 'refund%'
    ORDER BY created_at DESC LIMIT 100
  ) x;

  SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_audit
  FROM (
    SELECT id,action,actor_role,target_type,target_id,amount,commission_amount,description,status_before,status_after,failure_reason,created_at
    FROM public.financial_audit_log
    ORDER BY created_at DESC LIMIT 100
  ) x;

  RETURN jsonb_build_object(
    'payments',v_payments,
    'withdrawals',v_withdrawals,
    'commissions',v_commissions,
    'escrow',v_escrow,
    'refunds',v_refunds,
    'audit',v_audit
  );
END;
$$;

-- The UI already uses the canonical lifecycle below. The previous RPC rejected two
-- legitimate states (profile_under_review and verified), making its buttons fail.
CREATE OR REPLACE FUNCTION public.review_my_staff_worker(p_worker_id text,p_status text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE v_actor record; v_worker record;
BEGIN
  SELECT user_id,role,assigned_state,assigned_lga,deleted,suspended,banned
  INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
  LIMIT 1;

  IF v_actor IS NULL OR COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN RAISE EXCEPTION 'Active staff account required'; END IF;
  IF v_actor.role='staff' AND NOT public.current_staff_has_permission('verification') THEN RAISE EXCEPTION 'Verification permission required'; END IF;
  IF v_actor.role NOT IN ('staff','admin','creator') THEN RAISE EXCEPTION 'Staff access required'; END IF;
  IF p_status NOT IN ('profile_under_review','verified','rejected','suspended') THEN RAISE EXCEPTION 'Invalid worker status'; END IF;

  SELECT * INTO v_worker FROM public.profiles WHERE user_id=p_worker_id AND role='worker' FOR UPDATE;
  IF v_worker IS NULL THEN RAISE EXCEPTION 'Worker not found'; END IF;
  IF v_actor.role='staff' AND NOT (
    v_actor.assigned_state IS NOT NULL
    AND lower(v_worker.state)=lower(v_actor.assigned_state)
    AND (v_actor.assigned_lga IS NULL OR lower(COALESCE(v_worker.local_government,v_worker.city))=lower(v_actor.assigned_lga))
  ) THEN RAISE EXCEPTION 'Worker is outside your assigned branch'; END IF;

  UPDATE public.profiles
  SET worker_status=p_status,
      worker_verified=(p_status='verified'),
      updated_at=now(),
      updated_by=v_actor.user_id
  WHERE user_id=p_worker_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_staff_finance_queue() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.review_my_staff_worker(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_staff_finance_queue() TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_my_staff_worker(text,text) TO authenticated;

COMMIT;
