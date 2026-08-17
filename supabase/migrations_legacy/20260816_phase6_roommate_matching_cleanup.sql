-- Phase 6 Roommate matching consolidation.
-- One matching state, no legacy id_verified gate, no automatic 24-hour expiry.
-- Compatibility score uses only visible/saved preferences.

CREATE OR REPLACE FUNCTION public.get_my_roommate_preferences()
RETURNS SETOF public.roommate_preferences
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE v_actor public.profiles;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor IS NULL OR v_actor.role<>'user' OR COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT rp.* FROM public.roommate_preferences rp WHERE rp.user_id=v_actor.user_id LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_my_roommate_preferences(
  p_gender text,
  p_gender_preference text,
  p_budget_min integer,
  p_budget_max integer,
  p_cleanliness text,
  p_noise_level text,
  p_sleep_time text,
  p_visitors text,
  p_stay_duration text,
  p_area_preference text DEFAULT NULL,
  p_bio text DEFAULT NULL,
  p_school_name text DEFAULT NULL,
  p_campus text DEFAULT NULL,
  p_level text DEFAULT NULL,
  p_department text DEFAULT NULL
)
RETURNS public.roommate_preferences
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_actor public.profiles;
  v_row public.roommate_preferences;
  v_allowed boolean;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor IS NULL OR v_actor.role<>'user' THEN RAISE EXCEPTION 'Roommate matching is available to regular users only'; END IF;
  IF COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN RAISE EXCEPTION 'Account is not active'; END IF;
  IF NOT COALESCE(v_actor.profile_complete,false) THEN RAISE EXCEPTION 'Complete your profile first'; END IF;
  IF NULLIF(BTRIM(COALESCE(p_gender,'')),'') IS NULL THEN RAISE EXCEPTION 'Gender is required'; END IF;
  IF NULLIF(BTRIM(COALESCE(v_actor.state,'')),'') IS NULL THEN RAISE EXCEPTION 'Add your State first'; END IF;
  IF p_gender_preference NOT IN ('male','female','no_preference') THEN RAISE EXCEPTION 'Invalid roommate gender preference'; END IF;
  IF p_budget_min < 180000 THEN RAISE EXCEPTION 'Minimum roommate budget is NGN 180,000'; END IF;
  IF p_budget_max < p_budget_min THEN RAISE EXCEPTION 'Maximum budget must be at least the minimum budget'; END IF;

  v_allowed := COALESCE(v_actor.privacy_search_visible,true) AND COALESCE(v_actor.privacy_profile_visible,true);

  INSERT INTO public.roommate_preferences(
    user_id,auth_id,gender,gender_preference,budget_min,budget_max,cleanliness,noise_level,sleep_time,visitors,stay_duration,
    area_preference,bio,school_name,campus,level,department,active,search_status,search_started_at,search_expires_at,created_at,updated_at
  )
  VALUES(
    v_actor.user_id,v_actor.auth_id,BTRIM(p_gender),p_gender_preference,p_budget_min,p_budget_max,p_cleanliness,p_noise_level,p_sleep_time,p_visitors,p_stay_duration,
    NULLIF(BTRIM(COALESCE(p_area_preference,'')),''),NULLIF(BTRIM(COALESCE(p_bio,'')),''),NULLIF(BTRIM(COALESCE(p_school_name,'')),''),NULLIF(BTRIM(COALESCE(p_campus,'')),''),NULLIF(BTRIM(COALESCE(p_level,'')),''),NULLIF(BTRIM(COALESCE(p_department,'')),''),
    v_allowed,CASE WHEN v_allowed THEN 'active' ELSE 'stopped' END,CASE WHEN v_allowed THEN now() ELSE NULL END,NULL,now(),now()
  )
  ON CONFLICT(user_id) DO UPDATE SET
    gender=EXCLUDED.gender,
    gender_preference=EXCLUDED.gender_preference,
    budget_min=EXCLUDED.budget_min,
    budget_max=EXCLUDED.budget_max,
    cleanliness=EXCLUDED.cleanliness,
    noise_level=EXCLUDED.noise_level,
    sleep_time=EXCLUDED.sleep_time,
    visitors=EXCLUDED.visitors,
    stay_duration=EXCLUDED.stay_duration,
    area_preference=EXCLUDED.area_preference,
    bio=EXCLUDED.bio,
    school_name=EXCLUDED.school_name,
    campus=EXCLUDED.campus,
    level=EXCLUDED.level,
    department=EXCLUDED.department,
    active=CASE WHEN public.roommate_preferences.search_status='stopped' THEN false ELSE v_allowed END,
    search_status=CASE WHEN public.roommate_preferences.search_status='stopped' THEN 'stopped' WHEN v_allowed THEN 'active' ELSE 'stopped' END,
    search_started_at=CASE WHEN public.roommate_preferences.search_status='stopped' OR NOT v_allowed THEN public.roommate_preferences.search_started_at ELSE COALESCE(public.roommate_preferences.search_started_at,now()) END,
    search_expires_at=NULL,
    updated_at=now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

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
  IF COALESCE(v_actor.privacy_search_visible,true)=false OR COALESCE(v_actor.privacy_profile_visible,true)=false THEN RAISE EXCEPTION 'Enable Roommate discovery and profile visibility first'; END IF;
  IF NULLIF(BTRIM(COALESCE(v_actor.gender,'')),'') IS NULL THEN RAISE EXCEPTION 'Add your gender first'; END IF;
  IF NULLIF(BTRIM(COALESCE(v_actor.state,'')),'') IS NULL THEN RAISE EXCEPTION 'Add your State first'; END IF;

  SELECT * INTO v_row FROM public.roommate_preferences WHERE user_id=v_actor.user_id FOR UPDATE;
  IF v_row IS NULL THEN RAISE EXCEPTION 'Save roommate preferences first'; END IF;
  IF COALESCE(v_row.school_match,false) AND NULLIF(BTRIM(COALESCE(v_row.school_name,v_actor.school,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Enter your school before using same-school matching';
  END IF;

  UPDATE public.roommate_preferences
  SET active=true,search_status='active',search_started_at=COALESCE(search_started_at,now()),search_expires_at=NULL,updated_at=now()
  WHERE user_id=v_actor.user_id RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.stop_my_roommate_search()
RETURNS public.roommate_preferences
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE v_id text; v_row public.roommate_preferences;
BEGIN
  SELECT user_id INTO v_id FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role='user' AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_id IS NULL THEN RAISE EXCEPTION 'Regular user account required'; END IF;

  UPDATE public.roommate_preferences
  SET active=false,search_status='stopped',search_expires_at=NULL,updated_at=now()
  WHERE user_id=v_id RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_my_roommate_search()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_actor public.profiles;
  v_prefs public.roommate_preferences;
  v_count integer:=0;
  v_school text;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor IS NULL OR v_actor.role<>'user' THEN RAISE EXCEPTION 'Regular user required'; END IF;
  IF COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN RAISE EXCEPTION 'Account is not active'; END IF;
  IF NOT COALESCE(v_actor.profile_complete,false) THEN RAISE EXCEPTION 'Complete your profile first'; END IF;
  IF COALESCE(v_actor.privacy_search_visible,true)=false OR COALESCE(v_actor.privacy_profile_visible,true)=false THEN RAISE EXCEPTION 'Enable Roommate discovery and profile visibility first'; END IF;

  SELECT * INTO v_prefs FROM public.roommate_preferences WHERE user_id=v_actor.user_id FOR UPDATE;
  IF v_prefs IS NULL OR v_prefs.search_status<>'active' OR COALESCE(v_prefs.active,false)=false THEN RAISE EXCEPTION 'Roommate matching is paused'; END IF;

  v_school := NULLIF(BTRIM(COALESCE(v_prefs.school_name,v_actor.school,'')),'');
  IF COALESCE(v_prefs.school_match,false) AND v_school IS NULL THEN RAISE EXCEPTION 'Enter your school before using same-school matching'; END IF;

  INSERT INTO public.roommate_search_results(searcher_id,matched_user_id,match_score,status,created_at,updated_at)
  SELECT
    v_actor.user_id,
    c.user_id,
    LEAST(100,
      ROUND(
        30 * (
          GREATEST(0, LEAST(cp.budget_max,v_prefs.budget_max) - GREATEST(cp.budget_min,v_prefs.budget_min) + 1)::numeric
          / GREATEST(1, LEAST(cp.budget_max-cp.budget_min+1,v_prefs.budget_max-v_prefs.budget_min+1))
        )
      )::integer
      + CASE WHEN NULLIF(BTRIM(COALESCE(v_actor.local_government,v_actor.city,'')),'') IS NOT NULL
                   AND lower(COALESCE(NULLIF(c.local_government,''),c.city,''))=lower(COALESCE(NULLIF(v_actor.local_government,''),v_actor.city,'')) THEN 20 ELSE 0 END
      + CASE WHEN lower(COALESCE(cp.cleanliness,''))=lower(COALESCE(v_prefs.cleanliness,'')) THEN 15 ELSE 0 END
      + CASE WHEN lower(COALESCE(cp.noise_level,''))=lower(COALESCE(v_prefs.noise_level,'')) THEN 15 ELSE 0 END
      + CASE WHEN lower(COALESCE(cp.visitors,''))=lower(COALESCE(v_prefs.visitors,'')) THEN 10 ELSE 0 END
      + CASE WHEN lower(COALESCE(cp.stay_duration,''))=lower(COALESCE(v_prefs.stay_duration,'')) THEN 10 ELSE 0 END
    )::integer,
    'new',now(),now()
  FROM public.profiles c
  JOIN public.roommate_preferences cp ON cp.user_id=c.user_id
  WHERE c.user_id<>v_actor.user_id
    AND c.role='user'
    AND COALESCE(c.profile_complete,false)=true
    AND COALESCE(c.deleted,false)=false
    AND COALESCE(c.suspended,false)=false
    AND COALESCE(c.banned,false)=false
    AND COALESCE(c.privacy_search_visible,true)=true
    AND COALESCE(c.privacy_profile_visible,true)=true
    AND cp.active=true
    AND cp.search_status='active'
    AND lower(COALESCE(c.state,''))=lower(COALESCE(v_actor.state,''))
    AND COALESCE(cp.budget_max,0)>=v_prefs.budget_min
    AND COALESCE(cp.budget_min,999999999)<=v_prefs.budget_max
    AND (v_prefs.gender_preference='no_preference' OR lower(COALESCE(c.gender,''))=lower(v_prefs.gender_preference))
    AND (cp.gender_preference='no_preference' OR lower(COALESCE(v_actor.gender,''))=lower(cp.gender_preference))
    AND (
      NOT COALESCE(v_prefs.school_match,false)
      OR lower(regexp_replace(BTRIM(COALESCE(cp.school_name,c.school,'')), '\s+', ' ', 'g'))
         = lower(regexp_replace(BTRIM(v_school), '\s+', ' ', 'g'))
    )
    AND (
      NOT COALESCE(cp.school_match,false)
      OR lower(regexp_replace(BTRIM(COALESCE(v_prefs.school_name,v_actor.school,'')), '\s+', ' ', 'g'))
         = lower(regexp_replace(BTRIM(COALESCE(cp.school_name,c.school,'')), '\s+', ' ', 'g'))
    )
  ON CONFLICT(searcher_id,matched_user_id)
  DO UPDATE SET match_score=excluded.match_score,updated_at=now();

  DELETE FROM public.roommate_search_results r
  WHERE r.searcher_id=v_actor.user_id
    AND r.status IN ('new','viewed')
    AND NOT EXISTS (
      SELECT 1
      FROM public.profiles c
      JOIN public.roommate_preferences cp ON cp.user_id=c.user_id
      WHERE c.user_id=r.matched_user_id
        AND c.role='user'
        AND COALESCE(c.profile_complete,false)=true
        AND COALESCE(c.deleted,false)=false
        AND COALESCE(c.suspended,false)=false
        AND COALESCE(c.banned,false)=false
        AND COALESCE(c.privacy_search_visible,true)=true
        AND COALESCE(c.privacy_profile_visible,true)=true
        AND cp.active=true
        AND cp.search_status='active'
        AND lower(COALESCE(c.state,''))=lower(COALESCE(v_actor.state,''))
        AND COALESCE(cp.budget_max,0)>=v_prefs.budget_min
        AND COALESCE(cp.budget_min,999999999)<=v_prefs.budget_max
        AND (v_prefs.gender_preference='no_preference' OR lower(COALESCE(c.gender,''))=lower(v_prefs.gender_preference))
        AND (cp.gender_preference='no_preference' OR lower(COALESCE(v_actor.gender,''))=lower(cp.gender_preference))
        AND (
          NOT COALESCE(v_prefs.school_match,false)
          OR lower(regexp_replace(BTRIM(COALESCE(cp.school_name,c.school,'')), '\s+', ' ', 'g'))
             = lower(regexp_replace(BTRIM(v_school), '\s+', ' ', 'g'))
        )
        AND (
          NOT COALESCE(cp.school_match,false)
          OR lower(regexp_replace(BTRIM(COALESCE(v_prefs.school_name,v_actor.school,'')), '\s+', ' ', 'g'))
             = lower(regexp_replace(BTRIM(COALESCE(cp.school_name,c.school,'')), '\s+', ' ', 'g'))
        )
    );

  SELECT count(*) INTO v_count
  FROM public.roommate_search_results
  WHERE searcher_id=v_actor.user_id AND status<>'declined';

  UPDATE public.roommate_preferences
  SET search_match_count=v_count,active=true,search_status='active',search_expires_at=NULL,updated_at=now()
  WHERE user_id=v_actor.user_id;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_roommate_matches()
RETURNS TABLE(
  id uuid,matched_user_id text,match_score integer,status text,created_at timestamptz,
  username text,full_name text,avatar_url text,gender text,city text,state text,bio text,school text,area_preference text,
  mutual_accepted boolean,conversation_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE v_actor public.profiles; v_prefs public.roommate_preferences; v_school text;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor IS NULL OR v_actor.role<>'user' THEN RAISE EXCEPTION 'Regular user required'; END IF;
  IF COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN RAISE EXCEPTION 'Account is not active'; END IF;

  SELECT * INTO v_prefs FROM public.roommate_preferences WHERE user_id=v_actor.user_id LIMIT 1;
  v_school := NULLIF(BTRIM(COALESCE(v_prefs.school_name,v_actor.school,'')),'');

  RETURN QUERY
  SELECT
    r.id,r.matched_user_id,r.match_score,r.status,r.created_at,
    p.username,p.full_name,p.avatar_url,p.gender,p.city,p.state,p.bio,
    COALESCE(rp.school_name,p.school),rp.area_preference,
    EXISTS(
      SELECT 1 FROM public.roommate_search_results rr
      WHERE rr.searcher_id=r.matched_user_id AND rr.matched_user_id=v_actor.user_id AND rr.status='accepted'
    ),
    (
      SELECT c.id FROM public.conversations c
      WHERE c.conversation_type='roommate' AND c.status='active'
        AND ((c.participant_a=v_actor.user_id AND c.participant_b=r.matched_user_id)
          OR (c.participant_b=v_actor.user_id AND c.participant_a=r.matched_user_id))
      LIMIT 1
    )
  FROM public.roommate_search_results r
  JOIN public.profiles p ON p.user_id=r.matched_user_id
  LEFT JOIN public.roommate_preferences rp ON rp.user_id=p.user_id
  WHERE r.searcher_id=v_actor.user_id
    AND COALESCE(p.deleted,false)=false
    AND COALESCE(p.suspended,false)=false
    AND COALESCE(p.banned,false)=false
    AND (
      r.status='accepted'
      OR (
        COALESCE(p.privacy_search_visible,true)=true
        AND COALESCE(p.privacy_profile_visible,true)=true
        AND COALESCE(rp.active,false)=true
        AND rp.search_status='active'
        AND (
          NOT COALESCE(v_prefs.school_match,false)
          OR lower(regexp_replace(BTRIM(COALESCE(rp.school_name,p.school,'')), '\s+', ' ', 'g'))
             = lower(regexp_replace(BTRIM(COALESCE(v_school,'')), '\s+', ' ', 'g'))
        )
      )
    )
  ORDER BY r.match_score DESC,r.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_my_roommate_match_status(p_match_id uuid,p_status text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE v_actor public.profiles; v_match public.roommate_search_results; v_reverse public.roommate_search_results; v_conv uuid;
BEGIN
  IF p_status NOT IN ('new','viewed','accepted','declined') THEN RAISE EXCEPTION 'Invalid match status'; END IF;
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor IS NULL OR v_actor.role<>'user' OR COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN RAISE EXCEPTION 'Active regular user required'; END IF;

  SELECT * INTO v_match FROM public.roommate_search_results WHERE id=p_match_id AND searcher_id=v_actor.user_id FOR UPDATE;
  IF v_match IS NULL THEN RAISE EXCEPTION 'Match not found'; END IF;

  UPDATE public.roommate_search_results SET status=p_status,updated_at=now() WHERE id=p_match_id;

  IF p_status='accepted' THEN
    SELECT * INTO v_reverse FROM public.roommate_search_results
    WHERE searcher_id=v_match.matched_user_id AND matched_user_id=v_actor.user_id AND status='accepted' LIMIT 1;
    IF v_reverse IS NOT NULL THEN
      SELECT c.id INTO v_conv FROM public.conversations c
      WHERE c.conversation_type='roommate'
        AND ((c.participant_a=v_actor.user_id AND c.participant_b=v_match.matched_user_id)
          OR (c.participant_b=v_actor.user_id AND c.participant_a=v_match.matched_user_id))
      LIMIT 1;
      IF v_conv IS NULL THEN
        INSERT INTO public.conversations(participant_a,participant_b,status,conversation_type,subject,created_at,last_message_at,unread_a,unread_b)
        VALUES(v_actor.user_id,v_match.matched_user_id,'active','roommate','Roommate Match',now(),now(),0,0)
        RETURNING id INTO v_conv;
      END IF;
    END IF;
  END IF;

  RETURN v_conv;
END;
$$;

-- Normalize older non-explicit states. A user who explicitly paused ('stopped') stays paused.
UPDATE public.roommate_preferences rp
SET active=true,
    search_status='active',
    search_started_at=COALESCE(rp.search_started_at,now()),
    search_expires_at=NULL,
    updated_at=now()
FROM public.profiles p
WHERE p.user_id=rp.user_id
  AND p.role='user'
  AND COALESCE(p.deleted,false)=false
  AND COALESCE(p.suspended,false)=false
  AND COALESCE(p.banned,false)=false
  AND COALESCE(p.profile_complete,false)=true
  AND NULLIF(BTRIM(COALESCE(p.gender,'')),'') IS NOT NULL
  AND NULLIF(BTRIM(COALESCE(p.state,'')),'') IS NOT NULL
  AND COALESCE(p.privacy_search_visible,true)=true
  AND COALESCE(p.privacy_profile_visible,true)=true
  AND COALESCE(rp.search_status,'idle') IN ('idle','expired','active');

UPDATE public.roommate_preferences
SET active=false,search_expires_at=NULL,updated_at=now()
WHERE search_status='stopped';
