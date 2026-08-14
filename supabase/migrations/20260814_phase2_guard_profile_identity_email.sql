CREATE OR REPLACE FUNCTION public.create_my_profile(p_email text, p_role text DEFAULT 'user'::text)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public, extensions
AS $$
DECLARE
  v_profile public.profiles;
  v_auth_id text := auth.uid()::text;
  v_email text := lower(trim(COALESCE(auth.jwt()->>'email',p_email)));
  v_user_id text;
  v_username text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_role NOT IN ('user','worker','property_partner') THEN RAISE EXCEPTION 'Invalid public account role'; END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE auth_id=v_auth_id;
  IF v_profile IS NOT NULL THEN RETURN v_profile; END IF;

  IF v_email IS NULL OR v_email='' THEN RAISE EXCEPTION 'Authenticated email is required'; END IF;
  IF EXISTS(SELECT 1 FROM public.profiles p WHERE lower(p.email)=v_email AND p.auth_id<>v_auth_id) THEN
    RAISE EXCEPTION 'This email is already linked to another WeHouse identity. Contact WeHouse Support.';
  END IF;

  v_user_id := 'WHU-' || lpad(nextval('public.wehouse_user_id_seq')::text,8,'0');
  v_username := regexp_replace(split_part(v_email,'@',1),'[^a-z0-9_]','','g');
  IF length(v_username)<3 THEN v_username:='member'; END IF;
  v_username := left(v_username,15) || substr(v_user_id,length(v_user_id)-4);

  INSERT INTO public.profiles(auth_id,email,username,role,user_id,profile_complete,worker_status)
  VALUES(v_auth_id,v_email,v_username,p_role,v_user_id,false,CASE WHEN p_role='worker' THEN 'pending' ELSE NULL END)
  RETURNING * INTO v_profile;
  RETURN v_profile;
END;
$$;
