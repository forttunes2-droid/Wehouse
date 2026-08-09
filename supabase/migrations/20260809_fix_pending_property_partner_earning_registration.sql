-- Ensure the pending earning row is registered after the settlement trigger
-- writes payee_user_id and net_amount on an already-paid booking payment.
CREATE OR REPLACE FUNCTION public.register_pending_property_partner_earning()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE v_type TEXT;
BEGIN
  IF NEW.status NOT IN ('paid','completed') THEN RETURN NEW; END IF;
  IF NEW.purpose NOT IN ('apartment_rent','rent_plan_contribution','hotel_booking') THEN RETURN NEW; END IF;
  IF NEW.payee_user_id IS NULL OR COALESCE(NEW.net_amount,0)<=0 THEN RETURN NEW; END IF;
  v_type:=CASE
    WHEN NEW.purpose='hotel_booking' THEN 'hotel_payment'
    WHEN NEW.purpose='rent_plan_contribution' THEN 'rent_plan_contribution'
    ELSE COALESCE(NEW.metadata->>'payment_component','')
  END;
  IF v_type NOT IN ('long_stay_rent','short_stay_rent','rent_plan_contribution','hotel_payment') THEN
    RAISE EXCEPTION 'Unsupported property earning type';
  END IF;
  INSERT INTO public.property_partner_earning_releases(payment_id,partner_id,earning_type,status,net_amount)
  VALUES(NEW.id,NEW.payee_user_id,v_type,'pending',NEW.net_amount)
  ON CONFLICT(payment_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS register_pending_property_partner_earning_trigger ON public.booking_payments;
CREATE TRIGGER register_pending_property_partner_earning_trigger
AFTER INSERT OR UPDATE OF status,net_amount,payee_user_id ON public.booking_payments
FOR EACH ROW EXECUTE FUNCTION public.register_pending_property_partner_earning();