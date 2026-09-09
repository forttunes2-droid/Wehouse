REVOKE ALL ON FUNCTION public.create_short_stay_reservation(text,date,date,integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_short_stay_reservation(text,date,date,integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_short_stay_reservation(text,date,date,integer) TO authenticated,service_role;
