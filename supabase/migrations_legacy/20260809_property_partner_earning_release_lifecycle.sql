-- Property Partner earning lifecycle
-- Applied to production on 2026-08-09.

CREATE TABLE IF NOT EXISTS public.property_partner_earning_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL UNIQUE REFERENCES public.booking_payments(id) ON DELETE RESTRICT,
  partner_id TEXT NOT NULL REFERENCES public.profiles(user_id) ON DELETE RESTRICT,
  earning_type TEXT NOT NULL CHECK (earning_type IN ('long_stay_rent','short_stay_rent','rent_plan_contribution','hotel_payment')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','available','held','reversed')),
  net_amount NUMERIC NOT NULL CHECK (net_amount > 0),
  release_event TEXT,
  released_by TEXT REFERENCES public.profiles(user_id),
  released_at TIMESTAMPTZ,
  held_by TEXT REFERENCES public.profiles(user_id),
  held_at TIMESTAMPTZ,
  hold_reason TEXT,
  reversed_by TEXT REFERENCES public.profiles(user_id),
  reversed_at TIMESTAMPTZ,
  reversal_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.property_partner_earning_releases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS property_partner_earning_releases_self_read ON public.property_partner_earning_releases;
CREATE POLICY property_partner_earning_releases_self_read ON public.property_partner_earning_releases
FOR SELECT TO authenticated
USING (partner_id=(SELECT user_id FROM public.profiles WHERE auth_id=auth.uid()::TEXT LIMIT 1));

CREATE OR REPLACE FUNCTION public.register_pending_property_partner_earning()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_type TEXT;
BEGIN
 IF NEW.status NOT IN ('paid','completed') OR OLD.status IN ('paid','completed') THEN RETURN NEW; END IF;
 IF NEW.purpose NOT IN ('apartment_rent','rent_plan_contribution','hotel_booking') THEN RETURN NEW; END IF;
 IF NEW.payee_user_id IS NULL OR COALESCE(NEW.net_amount,0)<=0 THEN RETURN NEW; END IF;
 v_type:=CASE WHEN NEW.purpose='hotel_booking' THEN 'hotel_payment' WHEN NEW.purpose='rent_plan_contribution' THEN 'rent_plan_contribution' ELSE COALESCE(NEW.metadata->>'payment_component','') END;
 IF v_type NOT IN ('long_stay_rent','short_stay_rent','rent_plan_contribution','hotel_payment') THEN RAISE EXCEPTION 'Unsupported property earning type'; END IF;
 INSERT INTO public.property_partner_earning_releases(payment_id,partner_id,earning_type,status,net_amount)
 VALUES(NEW.id,NEW.payee_user_id,v_type,'pending',NEW.net_amount) ON CONFLICT(payment_id) DO NOTHING;
 RETURN NEW;
END;$$;
DROP TRIGGER IF EXISTS register_pending_property_partner_earning_trigger ON public.booking_payments;
CREATE TRIGGER register_pending_property_partner_earning_trigger AFTER UPDATE OF status ON public.booking_payments
FOR EACH ROW EXECUTE FUNCTION public.register_pending_property_partner_earning();

CREATE OR REPLACE FUNCTION public.release_property_partner_earning(p_payment_id UUID,p_release_event TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_caller TEXT;v_role TEXT;v_e RECORD;v_wallet RECORD;v_expected TEXT;v_new_pending NUMERIC;v_new_available NUMERIC;
BEGIN
 SELECT user_id,role INTO v_caller,v_role FROM public.profiles WHERE auth_id=auth.uid()::TEXT LIMIT 1;
 IF v_caller IS NULL OR v_role NOT IN ('staff','admin','creator') THEN RAISE EXCEPTION 'Authorized WeHouse staff required'; END IF;
 SELECT * INTO v_e FROM public.property_partner_earning_releases WHERE payment_id=p_payment_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Pending Property Partner earning not found'; END IF;
 IF v_e.status='available' THEN RETURN jsonb_build_object('success',true,'already_released',true); END IF;
 IF v_e.status<>'pending' THEN RAISE EXCEPTION 'Earning is not releasable from status %',v_e.status; END IF;
 v_expected:=CASE v_e.earning_type WHEN 'long_stay_rent' THEN 'long_stay_move_in_confirmed' WHEN 'rent_plan_contribution' THEN 'long_stay_installment_period_confirmed' WHEN 'short_stay_rent' THEN 'short_stay_check_in_confirmed' WHEN 'hotel_payment' THEN 'hotel_stay_completed' END;
 IF p_release_event IS DISTINCT FROM v_expected THEN RAISE EXCEPTION 'Release event must be % for %',v_expected,v_e.earning_type; END IF;
 SELECT * INTO v_wallet FROM public.wallets WHERE owner_id=v_e.partner_id AND owner_type='property_partner' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Property Partner wallet not found'; END IF;
 IF COALESCE(v_wallet.is_frozen,FALSE) THEN RAISE EXCEPTION 'Property Partner wallet is frozen'; END IF;
 IF COALESCE(v_wallet.pending_balance,0)<v_e.net_amount THEN RAISE EXCEPTION 'Pending wallet balance is inconsistent'; END IF;
 v_new_pending:=v_wallet.pending_balance-v_e.net_amount; v_new_available:=COALESCE(v_wallet.available_balance,0)+v_e.net_amount;
 UPDATE public.wallets SET pending_balance=v_new_pending,available_balance=v_new_available,updated_at=NOW() WHERE id=v_wallet.id;
 UPDATE public.property_partner_earning_releases SET status='available',release_event=p_release_event,released_by=v_caller,released_at=NOW(),updated_at=NOW() WHERE id=v_e.id;
 UPDATE public.commission_ledger SET status='settled',updated_at=NOW() WHERE payment_id=p_payment_id AND status='collected';
 UPDATE public.property_partners SET total_earnings=COALESCE(total_earnings,0)+v_e.net_amount,updated_at=NOW() WHERE profile_id=v_e.partner_id;
 INSERT INTO public.wallet_transactions(user_id,transaction_type,amount,balance_after,reference_id,reference_type,description,metadata)
 VALUES(v_e.partner_id,'property_earning_released',v_e.net_amount,v_new_available,p_payment_id::TEXT,'booking_payment','Property earnings released to available balance',jsonb_build_object('release_event',p_release_event,'earning_type',v_e.earning_type,'pending_balance_after',v_new_pending,'available_balance_after',v_new_available));
 INSERT INTO public.financial_audit_logs(event_type,user_id,target_user_id,amount,reference_id,reference_type,description,metadata)
 VALUES('escrow_credit_wallet',v_caller,v_e.partner_id,v_e.net_amount,p_payment_id::TEXT,'booking_payment','Pending Property Partner earnings released',jsonb_build_object('release_event',p_release_event,'earning_type',v_e.earning_type));
 RETURN jsonb_build_object('success',true,'partner_id',v_e.partner_id,'amount',v_e.net_amount,'status','available');
END;$$;

CREATE OR REPLACE FUNCTION public.hold_property_partner_earning(p_payment_id UUID,p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_caller TEXT;v_role TEXT;v_e RECORD;v_wallet RECORD;
BEGIN
 SELECT user_id,role INTO v_caller,v_role FROM public.profiles WHERE auth_id=auth.uid()::TEXT LIMIT 1;
 IF v_caller IS NULL OR v_role NOT IN ('staff','admin','creator') THEN RAISE EXCEPTION 'Authorized WeHouse staff required'; END IF;
 IF NULLIF(BTRIM(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Hold reason is required'; END IF;
 SELECT * INTO v_e FROM public.property_partner_earning_releases WHERE payment_id=p_payment_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Property Partner earning not found'; END IF;
 IF v_e.status='reversed' THEN RAISE EXCEPTION 'Reversed earnings cannot be held'; END IF;
 IF v_e.status='held' THEN RETURN jsonb_build_object('success',true,'already_held',true); END IF;
 SELECT * INTO v_wallet FROM public.wallets WHERE owner_id=v_e.partner_id AND owner_type='property_partner' FOR UPDATE;
 IF v_e.status='available' THEN UPDATE public.wallets SET is_frozen=TRUE,frozen_reason='Property earning dispute: '||BTRIM(p_reason),frozen_by=v_caller,frozen_at=NOW(),updated_at=NOW() WHERE id=v_wallet.id; END IF;
 UPDATE public.property_partner_earning_releases SET status='held',held_by=v_caller,held_at=NOW(),hold_reason=BTRIM(p_reason),updated_at=NOW() WHERE id=v_e.id;
 UPDATE public.commission_ledger SET status='disputed',updated_at=NOW() WHERE payment_id=p_payment_id;
 INSERT INTO public.financial_audit_logs(event_type,user_id,target_user_id,amount,reference_id,reference_type,description,metadata)
 VALUES('dispute_opened',v_caller,v_e.partner_id,v_e.net_amount,p_payment_id::TEXT,'booking_payment','Property Partner earning placed on hold',jsonb_build_object('reason',BTRIM(p_reason),'previous_status',v_e.status));
 RETURN jsonb_build_object('success',true,'status','held');
END;$$;

CREATE OR REPLACE FUNCTION public.reverse_pending_property_partner_earning(p_payment_id UUID,p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_caller TEXT;v_role TEXT;v_e RECORD;v_wallet RECORD;v_new_pending NUMERIC;
BEGIN
 SELECT user_id,role INTO v_caller,v_role FROM public.profiles WHERE auth_id=auth.uid()::TEXT LIMIT 1;
 IF v_caller IS NULL OR v_role NOT IN ('staff','admin','creator') THEN RAISE EXCEPTION 'Authorized WeHouse staff required'; END IF;
 IF NULLIF(BTRIM(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Reversal reason is required'; END IF;
 SELECT * INTO v_e FROM public.property_partner_earning_releases WHERE payment_id=p_payment_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Property Partner earning not found'; END IF;
 IF v_e.status='reversed' THEN RETURN jsonb_build_object('success',true,'already_reversed',true); END IF;
 IF v_e.status<>'pending' THEN RAISE EXCEPTION 'Only pending earnings can be automatically reversed; hold released earnings for review'; END IF;
 SELECT * INTO v_wallet FROM public.wallets WHERE owner_id=v_e.partner_id AND owner_type='property_partner' FOR UPDATE;
 IF COALESCE(v_wallet.pending_balance,0)<v_e.net_amount THEN RAISE EXCEPTION 'Pending wallet balance is inconsistent'; END IF;
 v_new_pending:=v_wallet.pending_balance-v_e.net_amount;
 UPDATE public.wallets SET pending_balance=v_new_pending,updated_at=NOW() WHERE id=v_wallet.id;
 UPDATE public.property_partner_earning_releases SET status='reversed',reversed_by=v_caller,reversed_at=NOW(),reversal_reason=BTRIM(p_reason),updated_at=NOW() WHERE id=v_e.id;
 UPDATE public.commission_ledger SET status='refunded',updated_at=NOW() WHERE payment_id=p_payment_id;
 INSERT INTO public.wallet_transactions(user_id,transaction_type,amount,balance_after,reference_id,reference_type,description,metadata)
 VALUES(v_e.partner_id,'property_earning_reversed',-v_e.net_amount,v_new_pending,p_payment_id::TEXT,'booking_payment','Pending property earnings reversed',jsonb_build_object('reason',BTRIM(p_reason),'wallet_bucket','pending'));
 INSERT INTO public.financial_audit_logs(event_type,user_id,target_user_id,amount,reference_id,reference_type,description,metadata)
 VALUES('payment_reversed',v_caller,v_e.partner_id,v_e.net_amount,p_payment_id::TEXT,'booking_payment','Pending Property Partner earning reversed',jsonb_build_object('reason',BTRIM(p_reason)));
 RETURN jsonb_build_object('success',true,'status','reversed','pending_balance',v_new_pending);
END;$$;

REVOKE ALL ON FUNCTION public.release_property_partner_earning(UUID,TEXT) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.hold_property_partner_earning(UUID,TEXT) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.reverse_pending_property_partner_earning(UUID,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.release_property_partner_earning(UUID,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hold_property_partner_earning(UUID,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_pending_property_partner_earning(UUID,TEXT) TO authenticated;