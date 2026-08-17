-- Step 4: Create ONE password function (test this alone)
CREATE OR REPLACE FUNCTION public.set_creator_auth_v2(p_user_id TEXT, p_password TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_salt TEXT;
BEGIN IF p_password IS NULL OR length(p_password) < 4 THEN RETURN FALSE; END IF;
v_salt := gen_salt('bf'); UPDATE profiles SET creator_auth_password = crypt(p_password, v_salt), creator_auth_enabled = TRUE, auth_id = COALESCE(auth_id, p_user_id) WHERE auth_id = p_user_id OR (role = 'creator' AND auth_id IS NULL); RETURN FOUND; END; $$;

SELECT set_creator_auth_v2('test-user-123', 'password123') AS result;
