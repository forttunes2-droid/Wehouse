CREATE OR REPLACE FUNCTION public.start_my_roommate_search()
RETURNS public.roommate_preferences
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE v_actor public.profiles; v_row public.roommate_preferences;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor IS NULL OR v_actor.role<>'user' THEN RAISE EXCEPTION 'Roommate matching is available to regular users only'; END IF;
  IF COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN RAISE EXCEPTION 'Account is not active'; END IF;
  IF NOT COALESCE(v_actor.profile_complete,false) THEN RAISE EXCEPTION 'Complete your profile first'; END IF;
  IF NOT COALESCE(v_actor.id_verified,false) THEN RAISE EXCEPTION 'Verify your identity before starting roommate matching'; END IF;
  IF COALESCE(v_actor.privacy_search_visible,true)=false OR COALESCE(v_actor.privacy_profile_visible,true)=false THEN RAISE EXCEPTION 'Enable roommate visibility before starting a search'; END IF;
  IF NULLIF(btrim(COALESCE(v_actor.gender,'')),'') IS NULL THEN RAISE EXCEPTION 'Add your gender to your profile first'; END IF;
  IF NULLIF(btrim(COALESCE(v_actor.state,'')),'') IS NULL THEN RAISE EXCEPTION 'Add your State first'; END IF;
  SELECT * INTO v_row FROM public.roommate_preferences WHERE user_id=v_actor.user_id FOR UPDATE;
  IF v_row IS NULL THEN RAISE EXCEPTION 'Save roommate preferences first'; END IF;
  UPDATE public.roommate_preferences
  SET search_status='active',search_started_at=now(),search_expires_at=now()+interval '24 hours',search_match_count=0,active=true,updated_at=now()
  WHERE user_id=v_actor.user_id RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_my_roommate_search()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE v_actor public.profiles; v_prefs public.roommate_preferences; v_count integer:=0;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor IS NULL OR v_actor.role<>'user' THEN RAISE EXCEPTION 'Regular user required'; END IF;
  IF NOT COALESCE(v_actor.id_verified,false) THEN RAISE EXCEPTION 'Verify your identity before matching'; END IF;
  SELECT * INTO v_prefs FROM public.roommate_preferences WHERE user_id=v_actor.user_id FOR UPDATE;
  IF v_prefs IS NULL OR v_prefs.search_status<>'active' THEN RAISE EXCEPTION 'Roommate search is not active'; END IF;
  IF v_prefs.search_expires_at IS NOT NULL AND v_prefs.search_expires_at<=now() THEN
    UPDATE public.roommate_preferences SET search_status='expired',updated_at=now() WHERE user_id=v_actor.user_id;
    RETURN 0;
  END IF;

  INSERT INTO public.roommate_search_results(searcher_id,matched_user_id,match_score,status,created_at,updated_at)
  SELECT v_actor.user_id,c.user_id,
    LEAST(100,25
      +CASE WHEN lower(COALESCE(c.state,''))=lower(COALESCE(v_actor.state,'')) THEN 20 ELSE 0 END
      +CASE WHEN lower(COALESCE(NULLIF(c.local_government,''),c.city,''))=lower(COALESCE(NULLIF(v_actor.local_government,''),v_actor.city,'')) THEN 15 ELSE 0 END
      +5
      +CASE WHEN lower(COALESCE(cp.cleanliness,''))=lower(COALESCE(v_prefs.cleanliness,'')) THEN 10 ELSE 0 END
      +CASE WHEN lower(COALESCE(cp.noise_level,''))=lower(COALESCE(v_prefs.noise_level,'')) THEN 10 ELSE 0 END
      +CASE WHEN lower(COALESCE(cp.sleep_time,''))=lower(COALESCE(v_prefs.sleep_time,'')) THEN 5 ELSE 0 END
      +CASE WHEN lower(COALESCE(cp.visitors,''))=lower(COALESCE(v_prefs.visitors,'')) THEN 5 ELSE 0 END
      +CASE WHEN lower(COALESCE(cp.stay_duration,''))=lower(COALESCE(v_prefs.stay_duration,'')) THEN 5 ELSE 0 END
    )::integer,
    'new',now(),now()
  FROM public.profiles c
  JOIN public.roommate_preferences cp ON cp.user_id=c.user_id
  WHERE c.user_id<>v_actor.user_id
    AND c.role='user'
    AND COALESCE(c.profile_complete,false)=true
    AND COALESCE(c.id_verified,false)=true
    AND COALESCE(c.deleted,false)=false
    AND COALESCE(c.suspended,false)=false
    AND COALESCE(c.banned,false)=false
    AND COALESCE(c.privacy_search_visible,true)=true
    AND COALESCE(c.privacy_profile_visible,true)=true
    AND cp.active=true
    AND cp.search_status='active'
    AND (cp.search_expires_at IS NULL OR cp.search_expires_at>now())
    AND lower(COALESCE(c.state,''))=lower(COALESCE(v_actor.state,''))
    AND COALESCE(cp.budget_max,0)>=v_prefs.budget_min
    AND COALESCE(cp.budget_min,999999999)<=v_prefs.budget_max
    AND (v_prefs.gender_preference='no_preference' OR lower(COALESCE(c.gender,''))=lower(v_prefs.gender_preference))
    AND (cp.gender_preference='no_preference' OR lower(COALESCE(v_actor.gender,''))=lower(cp.gender_preference))
  ON CONFLICT(searcher_id,matched_user_id)
  DO UPDATE SET match_score=excluded.match_score,updated_at=now();

  DELETE FROM public.roommate_search_results r
  WHERE r.searcher_id=v_actor.user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id=r.matched_user_id
        AND p.role='user'
        AND COALESCE(p.id_verified,false)=true
        AND COALESCE(p.deleted,false)=false
        AND COALESCE(p.suspended,false)=false
        AND COALESCE(p.banned,false)=false
    );

  SELECT count(*) INTO v_count FROM public.roommate_search_results WHERE searcher_id=v_actor.user_id AND status<>'declined';
  UPDATE public.roommate_preferences SET search_match_count=v_count,updated_at=now() WHERE user_id=v_actor.user_id;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_roommate_matches()
RETURNS TABLE(id uuid,matched_user_id text,match_score integer,status text,created_at timestamptz,username text,full_name text,avatar_url text,gender text,city text,state text,bio text,school text,area_preference text,mutual_accepted boolean,conversation_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE v_actor public.profiles;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor IS NULL OR v_actor.role<>'user' THEN RAISE EXCEPTION 'Regular user required'; END IF;
  IF NOT COALESCE(v_actor.id_verified,false) THEN RAISE EXCEPTION 'Verify your identity before viewing roommate matches'; END IF;
  RETURN QUERY
  SELECT r.id,r.matched_user_id,r.match_score,r.status,r.created_at,p.username,p.full_name,p.avatar_url,p.gender,p.city,p.state,p.bio,p.school,rp.area_preference,
    EXISTS(SELECT 1 FROM public.roommate_search_results rr WHERE rr.searcher_id=r.matched_user_id AND rr.matched_user_id=v_actor.user_id AND rr.status='accepted'),
    (SELECT c.id FROM public.conversations c WHERE c.conversation_type='roommate' AND c.status='active' AND ((c.participant_a=v_actor.user_id AND c.participant_b=r.matched_user_id) OR (c.participant_b=v_actor.user_id AND c.participant_a=r.matched_user_id)) LIMIT 1)
  FROM public.roommate_search_results r
  JOIN public.profiles p ON p.user_id=r.matched_user_id
  LEFT JOIN public.roommate_preferences rp ON rp.user_id=p.user_id
  WHERE r.searcher_id=v_actor.user_id
    AND COALESCE(p.id_verified,false)=true
    AND COALESCE(p.deleted,false)=false
    AND COALESCE(p.suspended,false)=false
    AND COALESCE(p.banned,false)=false
  ORDER BY r.match_score DESC,r.created_at DESC;
END;
$$;
