CREATE OR REPLACE FUNCTION public.update_my_profile(p_updates jsonb)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public, extensions
AS $$
DECLARE
  v_profile public.profiles;
  v_username text;
  v_state text;
  v_lga text;
  v_country text;
  v_unknown text[];
  v_complete boolean;
BEGIN
  IF p_updates IS NULL OR jsonb_typeof(p_updates) <> 'object' THEN
    RAISE EXCEPTION 'Profile updates must be an object';
  END IF;

  SELECT array_agg(k) INTO v_unknown
  FROM jsonb_object_keys(p_updates) AS k
  WHERE k NOT IN (
    'username','full_name','avatar_url','bio','phone','occupation','gender',
    'is_student','school','country','state','local_government','city','area',
    'profile_complete','worker_occupation','worker_skills','worker_price','worker_bio'
  );
  IF v_unknown IS NOT NULL THEN
    RAISE EXCEPTION 'Unsupported profile fields: %', array_to_string(v_unknown, ', ');
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE auth_id = auth.uid()::text
    AND deleted = false
    AND suspended = false
    AND banned = false;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Active profile not found'; END IF;

  IF v_profile.role <> 'worker' AND (
    p_updates ? 'worker_occupation' OR p_updates ? 'worker_skills' OR
    p_updates ? 'worker_price' OR p_updates ? 'worker_bio'
  ) THEN
    RAISE EXCEPTION 'Worker professional fields require a Worker account';
  END IF;

  v_username := lower(trim(CASE WHEN p_updates ? 'username' THEN p_updates->>'username' ELSE v_profile.username END));
  IF v_username IS NULL OR length(v_username) < 3 OR length(v_username) > 20 THEN RAISE EXCEPTION 'Username must contain 3 to 20 characters'; END IF;
  IF v_username !~ '^[a-z0-9_]+$' THEN RAISE EXCEPTION 'Username may contain only letters, numbers and underscores'; END IF;
  IF v_username IN ('admin','creator','support','system','api','wehouse','mod','moderator','owner','staff','help','info','null','undefined') THEN RAISE EXCEPTION 'This username is reserved'; END IF;
  IF EXISTS(SELECT 1 FROM public.profiles p WHERE lower(p.username)=v_username AND p.user_id<>v_profile.user_id) THEN RAISE EXCEPTION 'Username is already taken'; END IF;

  v_country := CASE WHEN p_updates ? 'country' THEN nullif(trim(p_updates->>'country'),'') ELSE v_profile.country END;
  v_state := CASE WHEN p_updates ? 'state' THEN nullif(trim(p_updates->>'state'),'') ELSE v_profile.state END;
  v_lga := CASE
    WHEN p_updates ? 'local_government' THEN nullif(trim(p_updates->>'local_government'),'')
    WHEN p_updates ? 'city' THEN nullif(trim(p_updates->>'city'),'')
    ELSE COALESCE(v_profile.local_government,v_profile.city)
  END;
  v_complete := v_profile.profile_complete OR COALESCE((p_updates->>'profile_complete')::boolean,false);

  IF v_complete AND (v_state IS NULL OR v_lga IS NULL) THEN RAISE EXCEPTION 'State and Local Government are required'; END IF;

  UPDATE public.profiles
  SET username=v_username,
      full_name=CASE WHEN p_updates ? 'full_name' THEN nullif(trim(p_updates->>'full_name'),'') ELSE full_name END,
      avatar_url=CASE WHEN p_updates ? 'avatar_url' THEN nullif(trim(p_updates->>'avatar_url'),'') ELSE avatar_url END,
      bio=CASE WHEN p_updates ? 'bio' THEN nullif(trim(p_updates->>'bio'),'') ELSE bio END,
      phone=CASE WHEN p_updates ? 'phone' THEN nullif(trim(p_updates->>'phone'),'') ELSE phone END,
      occupation=CASE WHEN p_updates ? 'occupation' THEN nullif(trim(p_updates->>'occupation'),'') ELSE occupation END,
      gender=CASE WHEN p_updates ? 'gender' THEN nullif(trim(p_updates->>'gender'),'') ELSE gender END,
      is_student=CASE WHEN p_updates ? 'is_student' THEN (p_updates->>'is_student')::boolean ELSE is_student END,
      school=CASE WHEN p_updates ? 'school' THEN nullif(trim(p_updates->>'school'),'') ELSE school END,
      country=v_country,
      state=v_state,
      local_government=v_lga,
      city=v_lga,
      area=CASE WHEN p_updates ? 'area' THEN nullif(trim(p_updates->>'area'),'') ELSE area END,
      worker_occupation=CASE WHEN p_updates ? 'worker_occupation' THEN nullif(trim(p_updates->>'worker_occupation'),'') ELSE worker_occupation END,
      worker_skills=CASE WHEN p_updates ? 'worker_skills' THEN p_updates->'worker_skills' ELSE worker_skills END,
      worker_price=CASE WHEN p_updates ? 'worker_price' THEN NULLIF(p_updates->>'worker_price','')::integer ELSE worker_price END,
      worker_bio=CASE WHEN p_updates ? 'worker_bio' THEN nullif(trim(p_updates->>'worker_bio'),'') ELSE worker_bio END,
      profile_complete=v_complete,
      updated_at=now()
  WHERE user_id=v_profile.user_id
  RETURNING * INTO v_profile;

  RETURN v_profile;
END;
$$;
