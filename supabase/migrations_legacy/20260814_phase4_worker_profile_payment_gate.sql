BEGIN;

CREATE OR REPLACE FUNCTION public.worker_professional_profile_ready(p_worker_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path='public'
AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id=p_worker_id
      AND p.role='worker'
      AND COALESCE(p.profile_complete,false)=true
      AND NULLIF(BTRIM(COALESCE(p.full_name,'')),'') IS NOT NULL
      AND NULLIF(BTRIM(COALESCE(p.worker_occupation,'')),'') IS NOT NULL
      AND jsonb_typeof(COALESCE(p.worker_skills,'[]'::jsonb))='array'
      AND jsonb_array_length(COALESCE(p.worker_skills,'[]'::jsonb))>0
      AND NULLIF(BTRIM(COALESCE(p.state,'')),'') IS NOT NULL
      AND NULLIF(BTRIM(COALESCE(p.local_government,p.city,'')),'') IS NOT NULL
      AND COALESCE(p.deleted,false)=false
      AND COALESCE(p.suspended,false)=false
      AND COALESCE(p.banned,false)=false
      AND EXISTS(
        SELECT 1 FROM public.worker_service_coverage c
        WHERE c.worker_id=p.user_id
          AND NULLIF(BTRIM(COALESCE(c.state,'')),'') IS NOT NULL
          AND NULLIF(BTRIM(COALESCE(c.lga,'')),'') IS NOT NULL
      )
  );
$$;
REVOKE ALL ON FUNCTION public.worker_professional_profile_ready(text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.update_my_profile(p_updates jsonb)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','extensions'
AS $$
DECLARE
  v_profile public.profiles;
  v_username text;
  v_state text;
  v_lga text;
  v_country text;
  v_unknown text[];
  v_complete boolean;
  v_area text;
BEGIN
  IF p_updates IS NULL OR jsonb_typeof(p_updates)<>'object' THEN RAISE EXCEPTION 'Profile updates must be an object'; END IF;
  SELECT array_agg(k) INTO v_unknown FROM jsonb_object_keys(p_updates) AS k
  WHERE k NOT IN ('username','full_name','avatar_url','bio','phone','occupation','gender','is_student','school','country','state','local_government','city','area','profile_complete','worker_occupation','worker_skills','worker_price','worker_bio','worker_experience');
  IF v_unknown IS NOT NULL THEN RAISE EXCEPTION 'Unsupported profile fields: %',array_to_string(v_unknown,', '); END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE auth_id=auth.uid()::text AND deleted=false AND suspended=false AND banned=false;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Active profile not found'; END IF;
  IF v_profile.role<>'worker' AND (p_updates ? 'worker_occupation' OR p_updates ? 'worker_skills' OR p_updates ? 'worker_price' OR p_updates ? 'worker_bio' OR p_updates ? 'worker_experience') THEN RAISE EXCEPTION 'Worker professional fields require a Worker account'; END IF;

  v_username:=lower(trim(CASE WHEN p_updates ? 'username' THEN p_updates->>'username' ELSE v_profile.username END));
  IF v_username IS NULL OR length(v_username)<3 OR length(v_username)>20 THEN RAISE EXCEPTION 'Username must contain 3 to 20 characters'; END IF;
  IF v_username !~ '^[a-z0-9_]+$' THEN RAISE EXCEPTION 'Username may contain only letters, numbers and underscores'; END IF;
  IF v_username IN ('admin','creator','support','system','api','wehouse','mod','moderator','owner','staff','help','info','null','undefined') THEN RAISE EXCEPTION 'This username is reserved'; END IF;
  IF EXISTS(SELECT 1 FROM public.profiles p WHERE lower(p.username)=v_username AND p.user_id<>v_profile.user_id) THEN RAISE EXCEPTION 'Username is already taken'; END IF;

  v_country:=CASE WHEN p_updates ? 'country' THEN nullif(trim(p_updates->>'country'),'') ELSE v_profile.country END;
  v_state:=CASE WHEN p_updates ? 'state' THEN nullif(trim(p_updates->>'state'),'') ELSE v_profile.state END;
  v_lga:=CASE WHEN p_updates ? 'local_government' THEN nullif(trim(p_updates->>'local_government'),'') WHEN p_updates ? 'city' THEN nullif(trim(p_updates->>'city'),'') ELSE COALESCE(v_profile.local_government,v_profile.city) END;
  v_area:=CASE WHEN p_updates ? 'area' THEN nullif(trim(p_updates->>'area'),'') ELSE v_profile.area END;
  v_complete:=v_profile.profile_complete OR COALESCE((p_updates->>'profile_complete')::boolean,false);
  IF v_complete AND (v_state IS NULL OR v_lga IS NULL) THEN RAISE EXCEPTION 'State and Local Government are required'; END IF;

  UPDATE public.profiles
  SET username=v_username,
      full_name=CASE WHEN p_updates ? 'full_name' THEN nullif(trim(p_updates->>'full_name'),'') ELSE full_name END,
      avatar_url=CASE WHEN p_updates ? 'avatar_url' THEN nullif(trim(p_updates->>'avatar_url'),'') ELSE avatar_url END,
      bio=CASE WHEN p_updates ? 'bio' THEN nullif(trim(p_updates->>'bio'),'') ELSE bio END,
      phone=CASE WHEN p_updates ? 'phone' THEN nullif(trim(p_updates->>'phone'),'') ELSE phone END,
      occupation=CASE WHEN p_updates ? 'worker_occupation' THEN nullif(trim(p_updates->>'worker_occupation'),'') WHEN p_updates ? 'occupation' THEN nullif(trim(p_updates->>'occupation'),'') ELSE occupation END,
      gender=CASE WHEN p_updates ? 'gender' THEN nullif(trim(p_updates->>'gender'),'') ELSE gender END,
      is_student=CASE WHEN p_updates ? 'is_student' THEN (p_updates->>'is_student')::boolean ELSE is_student END,
      school=CASE WHEN p_updates ? 'school' THEN nullif(trim(p_updates->>'school'),'') ELSE school END,
      country=v_country,
      state=v_state,
      local_government=v_lga,
      city=v_lga,
      area=v_area,
      worker_occupation=CASE WHEN p_updates ? 'worker_occupation' THEN nullif(trim(p_updates->>'worker_occupation'),'') ELSE worker_occupation END,
      worker_skills=CASE WHEN p_updates ? 'worker_skills' THEN p_updates->'worker_skills' ELSE worker_skills END,
      worker_price=CASE WHEN p_updates ? 'worker_price' THEN NULLIF(p_updates->>'worker_price','')::integer ELSE worker_price END,
      worker_bio=CASE WHEN p_updates ? 'worker_bio' THEN nullif(trim(p_updates->>'worker_bio'),'') ELSE worker_bio END,
      worker_experience=CASE WHEN p_updates ? 'worker_experience' THEN nullif(trim(p_updates->>'worker_experience'),'') ELSE worker_experience END,
      profile_complete=v_complete,
      updated_at=now()
  WHERE user_id=v_profile.user_id RETURNING * INTO v_profile;

  IF v_profile.role='worker' AND v_complete THEN
    IF NULLIF(BTRIM(COALESCE(v_profile.worker_occupation,'')),'') IS NULL THEN RAISE EXCEPTION 'Worker service category is required'; END IF;
    IF jsonb_typeof(COALESCE(v_profile.worker_skills,'[]'::jsonb))<>'array' OR jsonb_array_length(COALESCE(v_profile.worker_skills,'[]'::jsonb))=0 THEN RAISE EXCEPTION 'At least one Worker specialty is required'; END IF;
    INSERT INTO public.worker_service_coverage(worker_id,state,lga,areas,updated_at)
    VALUES(v_profile.user_id,v_state,v_lga,CASE WHEN v_area IS NULL THEN '{}'::text[] ELSE ARRAY[v_area] END,now())
    ON CONFLICT(worker_id) DO UPDATE SET state=EXCLUDED.state,lga=EXCLUDED.lga,areas=EXCLUDED.areas,updated_at=now();
  END IF;
  RETURN v_profile;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_worker_verification_payment()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE v_caller text; v_caller_role text; v_amount numeric; v_reference text; v_existing record;
BEGIN
  SELECT user_id,role INTO v_caller,v_caller_role FROM public.profiles WHERE auth_id=auth.uid()::text AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false;
  IF v_caller IS NULL THEN RETURN jsonb_build_object('success',false,'error','Not authenticated'); END IF;
  IF v_caller_role<>'worker' THEN RETURN jsonb_build_object('success',false,'error','Worker account required'); END IF;
  IF NOT public.worker_professional_profile_ready(v_caller) THEN RETURN jsonb_build_object('success',false,'error','Complete your professional profile and service coverage before payment'); END IF;
  SELECT COALESCE(NULLIF(value,'')::numeric,0) INTO v_amount FROM public.platform_settings WHERE key='worker_verification_fee';
  IF v_amount<=0 THEN RETURN jsonb_build_object('success',false,'error','Verification fee not configured'); END IF;
  UPDATE public.booking_payments SET status='expired',updated_at=now() WHERE user_id=v_caller AND purpose='worker_verification' AND status='pending' AND created_at<now()-interval '30 minutes';
  SELECT * INTO v_existing FROM public.booking_payments WHERE user_id=v_caller AND purpose='worker_verification' AND status='pending' ORDER BY created_at DESC LIMIT 1;
  IF v_existing IS NOT NULL THEN
    IF v_existing.amount_total=v_amount THEN RETURN jsonb_build_object('success',true,'reference',v_existing.paystack_reference,'amount',v_amount,'existing',true); END IF;
    UPDATE public.booking_payments SET status='expired',updated_at=now() WHERE id=v_existing.id;
  END IF;
  v_reference:='WH-'||gen_random_uuid()::text;
  INSERT INTO public.booking_payments(payment_reference,user_id,payer_user_id,payee_user_id,type,booking_type,amount,amount_total,net_amount,amount_commission,currency,status,purpose,paystack_reference,metadata,created_at,updated_at)
  VALUES(v_reference,v_caller,v_caller,v_caller,'worker_subscription','worker_subscription',v_amount,v_amount,v_amount,0,'NGN','pending','worker_verification',v_reference,jsonb_build_object('source','create_worker_verification_payment'),now(),now());
  RETURN jsonb_build_object('success',true,'reference',v_reference,'amount',v_amount,'existing',false);
EXCEPTION WHEN unique_violation THEN
  SELECT * INTO v_existing FROM public.booking_payments WHERE user_id=v_caller AND purpose='worker_verification' AND status='pending' ORDER BY created_at DESC LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN jsonb_build_object('success',true,'reference',v_existing.paystack_reference,'amount',v_existing.amount_total,'existing',true); END IF;
  RETURN jsonb_build_object('success',false,'error','Payment initialization race condition');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_worker_activation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE v_profile public.profiles; v_ver public.worker_verifications; v_payment public.booking_payments; v_test public.worker_test_attempts; v_attempts_24h integer; v_profile_ready boolean;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE auth_id=auth.uid()::text AND role='worker' LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Worker profile not found'; END IF;
  v_profile_ready:=public.worker_professional_profile_ready(v_profile.user_id);
  SELECT * INTO v_ver FROM public.worker_verifications WHERE worker_id=v_profile.user_id LIMIT 1;
  SELECT * INTO v_payment FROM public.booking_payments WHERE user_id=v_profile.user_id AND purpose='worker_verification' ORDER BY created_at DESC LIMIT 1;
  SELECT * INTO v_test FROM public.worker_test_attempts WHERE worker_id=v_profile.user_id ORDER BY started_at DESC LIMIT 1;
  SELECT count(*) INTO v_attempts_24h FROM public.worker_test_attempts WHERE worker_id=v_profile.user_id AND started_at>=now()-interval '24 hours';
  RETURN jsonb_build_object('worker_status',COALESCE(v_profile.worker_status,'pending'),'live',COALESCE(v_profile.worker_status='verified' AND v_profile.worker_verified,false),'profile_complete',v_profile_ready,'payment_status',v_payment.status,'gold_badge',COALESCE(v_payment.status IN ('paid','completed'),false),'test_passed',public.worker_test_passed(v_profile.user_id),'test_percent',v_test.percent,'test_attempts_24h',v_attempts_24h,'evidence_saved',COALESCE(NULLIF(BTRIM(COALESCE(v_ver.verification_video_url,'')),'') IS NOT NULL,false),'submitted',COALESCE(v_ver.submitted_at IS NOT NULL,false),'review_status',v_ver.status,'identity_status',COALESCE(v_ver.identity_status,'not_started'),'identity_provider',v_ver.identity_provider,'identity_checked_at',v_ver.identity_checked_at,'rejection_reason',(SELECT rejection_reason FROM public.worker_verification_reviews WHERE worker_id=v_profile.user_id ORDER BY created_at DESC LIMIT 1));
END;
$$;

COMMIT;
