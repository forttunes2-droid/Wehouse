-- Sensitive Property Partner earning controls remain Admin/Creator-only,
-- but authority is derived from active workspace grants.

begin;

CREATE OR REPLACE FUNCTION public.hold_property_partner_earning(p_payment_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_actor public.profiles; v_e record; v_wallet record;
BEGIN
  v_actor:=public._current_team_actor();
  IF v_actor.role NOT IN ('admin','creator') THEN
    RAISE EXCEPTION 'Admin or Creator finance authority required';
  END IF;
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
$function$
;

CREATE OR REPLACE FUNCTION public.reverse_pending_property_partner_earning(p_payment_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_actor public.profiles; v_e record; v_wallet record; v_new_pending numeric;
BEGIN
  v_actor:=public._current_team_actor();
  IF v_actor.role NOT IN ('admin','creator') THEN
    RAISE EXCEPTION 'Admin or Creator finance authority required';
  END IF;
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
$function$
;

commit;
