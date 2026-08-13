CREATE OR REPLACE FUNCTION public.get_all_settings_v2()
RETURNS TABLE(id integer,key text,value text,label text,description text,category text,data_type text,is_active boolean,updated_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path=public
AS $$
  SELECT ps.id,ps.key,ps.value,ps.label,ps.description,ps.category,ps.data_type,ps.is_active,ps.updated_at
  FROM public.platform_settings ps
  WHERE ps.is_active=true
    AND ps.key NOT LIKE '%secret%'
    AND ps.key NOT LIKE '%api_key%'
    AND ps.key NOT LIKE '%private%'
    AND ps.key NOT LIKE '%password%'
    AND ps.key NOT LIKE '%token%'
    AND ps.key NOT IN (
      'commission_rate_worker','commission_worker','commission_rate_partner','partner_commission_rate',
      'property_commission','commission_rate_hotel','hotel_commission','minimum_withdrawal'
    )
  ORDER BY ps.category,ps.key;
$$;
