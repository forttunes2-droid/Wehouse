CREATE OR REPLACE FUNCTION public.calculate_commission(p_amount numeric,p_type text DEFAULT 'worker')
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE v_percent numeric;
BEGIN
  IF p_amount IS NULL OR p_amount<0 THEN RAISE EXCEPTION 'Amount must be zero or greater'; END IF;
  SELECT NULLIF(btrim(value),'')::numeric INTO v_percent
  FROM public.platform_settings
  WHERE key=CASE
    WHEN p_type='worker' THEN 'worker_commission_rate'
    WHEN p_type='property' THEN 'commission_apartment'
    WHEN p_type='hotel' THEN 'commission_hotel'
    ELSE 'worker_commission_rate'
  END
  AND COALESCE(is_active,true)=true
  LIMIT 1;
  v_percent:=COALESCE(v_percent,10);
  IF v_percent<0 OR v_percent>50 THEN RAISE EXCEPTION 'Invalid commission rate'; END IF;
  RETURN round(p_amount*(v_percent/100),2);
END;
$$;
