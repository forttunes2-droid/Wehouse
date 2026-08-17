--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.11 (Debian 17.11-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: private; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA private;


--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: gender_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.gender_enum AS ENUM (
    'male',
    'female',
    'other'
);


--
-- Name: message_type_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.message_type_enum AS ENUM (
    'text',
    'image',
    'file',
    'voice'
);


--
-- Name: participant_role_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.participant_role_enum AS ENUM (
    'owner',
    'admin',
    'member'
);


--
-- Name: role_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.role_enum AS ENUM (
    'user',
    'worker',
    'staff',
    'admin',
    'creator_admin'
);


--
-- Name: status_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.status_enum AS ENUM (
    'active',
    'suspended',
    'deleted'
);


--
-- Name: verification_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.verification_enum AS ENUM (
    'unverified',
    'pending',
    'verified'
);


--
-- Name: can_access_support_conversation(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.can_access_support_conversation(p_conversation_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'private'
    AS $$
declare
  v_actor public.profiles;
  v_conv public.partner_support_conversations;
  v_requester public.profiles;
  v_staff_ok boolean := false;
  v_actor_lga text;
  v_requester_lga text;
begin
  select * into v_actor from public.profiles where auth_id = auth.uid()::text limit 1;
  if v_actor.user_id is null then return false; end if;

  select * into v_conv from public.partner_support_conversations where id = p_conversation_id;
  if v_conv.id is null then return false; end if;

  if v_actor.user_id = v_conv.partner_id
     or v_actor.user_id = v_conv.assigned_staff_id
     or v_actor.user_id = v_conv.assigned_field_officer_id
     or v_actor.role = 'creator' then
    return true;
  end if;

  if v_actor.role = 'staff' then
    select exists(
      select 1 from public.staff_permissions sp
      where sp.staff_id = v_actor.user_id
        and sp.permission = 'support'
        and coalesce(sp.is_active,true) = true
        and sp.revoked_at is null
    ) into v_staff_ok;
  end if;

  if v_actor.role <> 'admin' and not v_staff_ok then return false; end if;

  select * into v_requester from public.profiles where user_id = v_conv.partner_id limit 1;
  if v_requester.user_id is null then return false; end if;

  v_actor_lga := coalesce(nullif(v_actor.assigned_lga,''), nullif(v_actor.local_government,''), nullif(v_actor.city,''));
  v_requester_lga := coalesce(nullif(v_requester.local_government,''), nullif(v_requester.city,''));

  return lower(trim(coalesce(v_requester.state,''))) = lower(trim(coalesce(v_actor.assigned_state,'')))
     and lower(trim(coalesce(v_requester_lga,''))) = lower(trim(coalesce(v_actor_lga,'')));
end;
$$;


--
-- Name: can_access_support_object(text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.can_access_support_object(p_name text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'private', 'storage'
    AS $_$
declare
  v_folder text;
  v_conversation uuid;
begin
  v_folder := (storage.foldername(p_name))[1];
  if v_folder is null or v_folder !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then return false; end if;
  v_conversation := v_folder::uuid;
  return private.can_access_support_conversation(v_conversation);
exception when others then
  return false;
end;
$_$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    auth_id text NOT NULL,
    email text NOT NULL,
    username text,
    role text DEFAULT 'user'::text NOT NULL,
    user_id text NOT NULL,
    profile_complete boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    avatar_url text,
    bio text,
    phone text,
    occupation text,
    is_student boolean DEFAULT false,
    school text,
    gender text,
    budget_min integer DEFAULT 0,
    budget_max integer DEFAULT 500000,
    preferred_location text,
    email_verified boolean DEFAULT false,
    phone_verified boolean DEFAULT false,
    id_verified boolean DEFAULT false,
    is_online boolean DEFAULT false,
    last_seen timestamp with time zone,
    worker_status text,
    full_name text,
    country text,
    state text,
    city text,
    area text,
    worker_occupation text,
    worker_bio text,
    worker_verified boolean DEFAULT false,
    deleted boolean DEFAULT false,
    deleted_at timestamp with time zone,
    assigned_state text,
    assigned_lga text,
    scope text,
    created_by text,
    updated_by text,
    maintenance_exempt boolean DEFAULT false,
    is_premium boolean DEFAULT false,
    premium_expires_at timestamp with time zone,
    worker_price integer DEFAULT 0,
    worker_skills jsonb DEFAULT '[]'::jsonb,
    creator_auth_password text,
    creator_auth_enabled boolean DEFAULT false,
    worker_experience text,
    worker_gov_id_url text,
    worker_cert_url text,
    worker_video_url text,
    pref_email_notif boolean DEFAULT true NOT NULL,
    pref_push_notif boolean DEFAULT true NOT NULL,
    suspended boolean DEFAULT false NOT NULL,
    suspended_at timestamp with time zone,
    suspended_by text,
    suspended_reason text,
    banned boolean DEFAULT false NOT NULL,
    banned_at timestamp with time zone,
    banned_by text,
    banned_reason text,
    local_government text,
    privacy_profile_visible boolean DEFAULT true NOT NULL,
    privacy_search_visible boolean DEFAULT true NOT NULL,
    privacy_activity_visible boolean DEFAULT true NOT NULL,
    privacy_email_visible boolean DEFAULT false NOT NULL,
    privacy_phone_visible boolean DEFAULT false NOT NULL,
    rating numeric DEFAULT 0 NOT NULL,
    review_count integer DEFAULT 0 NOT NULL,
    available boolean DEFAULT false NOT NULL,
    operational_latitude numeric,
    operational_longitude numeric,
    operational_location_accuracy_m numeric,
    operational_location_updated_at timestamp with time zone,
    terms_accepted_at timestamp with time zone,
    privacy_accepted_at timestamp with time zone,
    legal_accepted_version text,
    CONSTRAINT profiles_role_check CHECK ((role = ANY (ARRAY['user'::text, 'worker'::text, 'property_partner'::text, 'staff'::text, 'admin'::text, 'creator'::text]))),
    CONSTRAINT profiles_worker_status_check CHECK (((worker_status IS NULL) OR (worker_status = ANY (ARRAY['pending'::text, 'verification_paid'::text, 'profile_under_review'::text, 'verified'::text, 'suspended'::text, 'rejected'::text]))))
);


--
-- Name: _admin_dashboard_actor(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._admin_dashboard_actor() RETURNS public.profiles
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles;
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id = auth.uid()::text
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_actor IS NULL OR v_actor.role NOT IN ('admin','creator') THEN
    RAISE EXCEPTION 'Admin or Creator account required';
  END IF;
  IF v_actor.role='admin' AND (
    NULLIF(BTRIM(v_actor.assigned_state),'') IS NULL OR
    NULLIF(BTRIM(v_actor.assigned_lga),'') IS NULL
  ) THEN
    RAISE EXCEPTION 'Admin branch assignment is incomplete. Contact Creator.';
  END IF;
  RETURN v_actor;
END;
$$;


--
-- Name: _assert_admin_lga_scope(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._assert_admin_lga_scope(p_target_user_id text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ DECLARE v_actor public.profiles; v_target public.profiles; v_target_state text; v_target_lga text; BEGIN SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND NOT COALESCE(deleted,false) AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false) LIMIT 1; IF v_actor IS NULL OR v_actor.role NOT IN ('admin','creator') THEN RAISE EXCEPTION 'Admin/Creator access required'; END IF; IF v_actor.role='creator' THEN RETURN; END IF; IF NULLIF(btrim(v_actor.assigned_state),'') IS NULL OR NULLIF(btrim(v_actor.assigned_lga),'') IS NULL THEN RAISE EXCEPTION 'Admin branch assignment is incomplete. Contact Creator.'; END IF; SELECT * INTO v_target FROM public.profiles WHERE user_id=p_target_user_id LIMIT 1; IF v_target IS NULL THEN RAISE EXCEPTION 'Target user not found'; END IF; IF v_target.role IN ('admin','staff') THEN v_target_state:=NULLIF(btrim(v_target.assigned_state),''); v_target_lga:=NULLIF(btrim(v_target.assigned_lga),''); ELSE v_target_state:=NULLIF(btrim(v_target.state),''); v_target_lga:=COALESCE(NULLIF(btrim(v_target.local_government),''),NULLIF(btrim(v_target.city),'')); END IF; IF v_target_state IS NULL OR v_target_lga IS NULL THEN RAISE EXCEPTION 'Target user has no complete State/LGA location'; END IF; IF lower(v_target_state)<>lower(v_actor.assigned_state) OR lower(v_target_lga)<>lower(v_actor.assigned_lga) THEN RAISE EXCEPTION 'Admin scope violation: target is outside assigned State/LGA'; END IF; END; $$;


--
-- Name: _can_access_conversation(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._can_access_conversation(p_conversation_id uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare a public.profiles; c public.conversations;
begin
  select * into a from public.profiles where auth_id=auth.uid()::text limit 1;
  if a is null then return false; end if;
  select * into c from public.conversations where id=p_conversation_id;
  if c is null then return false; end if;
  return a.user_id in (c.participant_a,c.participant_b)
     and public._conversation_route_allowed(c.id,a.user_id);
end $$;


--
-- Name: _conversation_route_allowed(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._conversation_route_allowed(p_conversation_id uuid, p_actor_user_id text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  c public.conversations;
  a public.profiles;
  other public.profiles;
  other_id text;
begin
  select * into a from public.profiles where user_id = p_actor_user_id;
  select * into c from public.conversations where id = p_conversation_id;

  if a is null or c is null then return false; end if;
  if a.user_id not in (c.participant_a, c.participant_b) then return false; end if;
  if coalesce(c.status,'active') in ('archived','closed') then return false; end if;
  if c.conversation_type <> 'roommate' or a.role <> 'user' then return false; end if;
  if coalesce(a.deleted,false) or coalesce(a.suspended,false) or coalesce(a.banned,false) then return false; end if;

  other_id := case when c.participant_a = a.user_id then c.participant_b else c.participant_a end;
  select * into other from public.profiles where user_id = other_id;

  if other is null or other.role <> 'user'
     or coalesce(other.deleted,false)
     or coalesce(other.suspended,false)
     or coalesce(other.banned,false) then
    return false;
  end if;

  return true;
end;
$$;


--
-- Name: _current_comm_actor(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._current_comm_actor() RETURNS public.profiles
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT p FROM public.profiles p
  WHERE p.auth_id=auth.uid()::text
    AND COALESCE(p.deleted,false)=false
    AND COALESCE(p.suspended,false)=false
    AND COALESCE(p.banned,false)=false
  LIMIT 1
$$;


--
-- Name: _guard_worker_profile_state(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._guard_worker_profile_state() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$ BEGIN IF NEW.role='worker' THEN IF NEW.worker_status='approved_for_verification' THEN NEW.worker_status:='verification_paid'; ELSIF NEW.worker_status='approved' THEN NEW.worker_status:='pending'; ELSIF NEW.worker_status='declined' THEN NEW.worker_status:='rejected'; END IF; NEW.worker_verified := (NEW.worker_status='verified'); IF NEW.worker_status<>'verified' OR COALESCE(NEW.deleted,false) OR COALESCE(NEW.suspended,false) OR COALESCE(NEW.banned,false) THEN NEW.available:=false; END IF; END IF; RETURN NEW; END; $$;


--
-- Name: _sync_conversation_after_message(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._sync_conversation_after_message() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  c public.conversations;
  v_preview text;
  v_type text;
BEGIN
  SELECT * INTO c FROM public.conversations WHERE id=NEW.conversation_id FOR UPDATE;
  IF c IS NULL THEN RETURN NEW; END IF;

  IF NULLIF(BTRIM(COALESCE(NEW.content,'')),'') IS NOT NULL THEN
    v_preview:=BTRIM(NEW.content);
  ELSIF COALESCE(cardinality(NEW.attachments),0)>0 THEN
    v_type:=COALESCE(NEW.attachment_types[1],'');
    IF v_type LIKE 'image/%' THEN v_preview:='Photo';
    ELSIF v_type LIKE 'audio/%' THEN v_preview:='Voice message';
    ELSE v_preview:='Attachment';
    END IF;
  ELSIF NEW.file_name IS NOT NULL THEN
    v_preview:='Attachment · '||NEW.file_name;
  ELSE
    v_preview:='New message';
  END IF;

  UPDATE public.conversations
  SET last_message=v_preview,
      last_message_at=NEW.created_at,
      unread_a=CASE WHEN c.participant_a=NEW.sender_id THEN c.unread_a ELSE COALESCE(c.unread_a,0)+1 END,
      unread_b=CASE WHEN c.participant_b=NEW.sender_id THEN c.unread_b ELSE COALESCE(c.unread_b,0)+1 END
  WHERE id=NEW.conversation_id;
  RETURN NEW;
END;
$$;


--
-- Name: accept_current_legal(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.accept_current_legal(p_document text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  uid text;
  privacy_text text;
  terms_text text;
  privacy_changed timestamptz;
  terms_changed timestamptz;
  privacy_at timestamptz;
  terms_at timestamptz;
  version text;
begin
  select user_id into uid from public.profiles where auth_id=auth.uid()::text limit 1;
  if uid is null then raise exception 'Profile not found'; end if;
  if p_document not in ('privacy','terms') then raise exception 'Invalid legal document'; end if;

  select value,updated_at into privacy_text,privacy_changed from public.platform_settings where key='privacy_policy' and is_active=true limit 1;
  select value,updated_at into terms_text,terms_changed from public.platform_settings where key='terms_of_service' and is_active=true limit 1;

  if p_document='privacy' and nullif(btrim(coalesce(privacy_text,'')),'') is null then
    raise exception 'Privacy Policy has not been published yet';
  end if;
  if p_document='terms' and nullif(btrim(coalesce(terms_text,'')),'') is null then
    raise exception 'Terms & Conditions have not been published yet';
  end if;

  if p_document='privacy' then
    update public.profiles set privacy_accepted_at=now(),updated_at=now() where user_id=uid returning privacy_accepted_at,terms_accepted_at into privacy_at,terms_at;
  else
    update public.profiles set terms_accepted_at=now(),updated_at=now() where user_id=uid returning privacy_accepted_at,terms_accepted_at into privacy_at,terms_at;
  end if;

  select value into version from public.platform_settings where key='legal_version' and is_active=true limit 1;
  if privacy_at is not null and terms_at is not null
     and nullif(btrim(coalesce(privacy_text,'')),'') is not null
     and nullif(btrim(coalesce(terms_text,'')),'') is not null
     and privacy_at>=privacy_changed and terms_at>=terms_changed then
    update public.profiles set legal_accepted_version=version where user_id=uid;
  end if;
  return public.get_my_legal_status();
end $$;


--
-- Name: reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reservations (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    listing_id text NOT NULL,
    user_id text NOT NULL,
    user_email text,
    user_phone text,
    listing_title text,
    listing_price numeric,
    listing_location text,
    status text DEFAULT 'pending'::text,
    support_contacted boolean DEFAULT false,
    support_contact_method text DEFAULT 'whatsapp'::text,
    support_phone text DEFAULT '+2348000000000'::text,
    manual_payment_status text DEFAULT 'unpaid'::text,
    payment_reference text,
    amount numeric DEFAULT 10000,
    currency text DEFAULT 'NGN'::text,
    inspection_date timestamp with time zone,
    inspection_notes text,
    inspection_completed boolean DEFAULT false,
    staff_id text,
    staff_notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    paid_at timestamp with time zone,
    completed_at timestamp with time zone,
    rental_plan_years integer DEFAULT 1,
    rental_plan_selected_at timestamp with time zone,
    reservation_type text DEFAULT 'apartment'::text,
    hold_expires_at timestamp with time zone,
    commission_rate numeric DEFAULT 0,
    refund_amount numeric DEFAULT 0,
    refund_reason text,
    processed_by text,
    processed_at timestamp with time zone,
    inspection_requested_at timestamp with time zone,
    inspection_completed_at timestamp with time zone,
    inspection_result text,
    payment_expires_at timestamp with time zone,
    tenancy_start_date date,
    tenancy_end_date date,
    move_out_grace_until date,
    occupancy_started_at timestamp with time zone,
    annual_rent_snapshot numeric,
    contract_rent_total numeric,
    upfront_rent_required numeric,
    installment_balance numeric DEFAULT 0 NOT NULL,
    installment_count integer DEFAULT 0 NOT NULL,
    rent_payment_status text DEFAULT 'not_started'::text NOT NULL,
    rent_payment_reference text,
    rent_paid_at timestamp with time zone,
    booking_code text NOT NULL,
    stay_type text,
    stay_check_in date,
    stay_check_out date,
    stay_nights integer,
    nightly_rate_snapshot numeric,
    stay_rent_total numeric,
    security_deposit_snapshot numeric,
    security_deposit_status text DEFAULT 'not_required'::text,
    security_deposit_returned_at timestamp with time zone,
    CONSTRAINT reservations_inspection_result_check CHECK ((inspection_result = ANY (ARRAY[NULL::text, 'passed'::text, 'failed'::text, 'customer_declined'::text]))),
    CONSTRAINT reservations_installment_count_check CHECK (((installment_count >= 0) AND (installment_count <= 64))),
    CONSTRAINT reservations_rent_payment_status_check CHECK ((rent_payment_status = ANY (ARRAY['not_started'::text, 'payment_pending'::text, 'upfront_paid'::text, 'paid'::text, 'refunded'::text]))),
    CONSTRAINT reservations_reservation_type_check CHECK ((reservation_type = ANY (ARRAY['apartment'::text, 'hotel'::text]))),
    CONSTRAINT reservations_security_deposit_status_check CHECK ((security_deposit_status = ANY (ARRAY['not_required'::text, 'pending'::text, 'held'::text, 'refund_due'::text, 'returned'::text, 'review'::text]))),
    CONSTRAINT reservations_short_stay_dates_check CHECK (((stay_type IS DISTINCT FROM 'short_let'::text) OR ((stay_check_in IS NOT NULL) AND (stay_check_out IS NOT NULL) AND (stay_check_out > stay_check_in) AND (stay_nights > 0)))),
    CONSTRAINT reservations_status_check CHECK ((status = ANY (ARRAY['payment_pending'::text, 'reserved'::text, 'inspection_pending'::text, 'ready_for_move_in'::text, 'occupied'::text, 'completed'::text, 'cancelled'::text, 'expired'::text, 'refunded'::text, 'payment_conflict'::text]))),
    CONSTRAINT reservations_stay_type_check CHECK (((stay_type IS NULL) OR (stay_type = ANY (ARRAY['short_let'::text, 'long_stay'::text]))))
);


--
-- Name: activate_apartment_tenancy(text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.activate_apartment_tenancy(p_reservation_id text, p_start_date date DEFAULT CURRENT_DATE) RETURNS public.reservations
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_actor public.profiles;
  v_res public.reservations;
  v_listing public.listings;
  v_years integer;
  v_grace integer;
  v_end date;
  v_result public.reservations;
  v_rent_payment_id uuid;
  v_plan_id uuid;
  v_target_year integer;
  v_i integer;
  v_due date;
  v_base numeric;
  v_amount numeric;
  v_annual numeric;
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND role IN ('staff','admin','creator')
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_actor.user_id IS NULL THEN RAISE EXCEPTION 'Housing operations access required'; END IF;
  IF v_actor.role='staff' AND NOT public.current_staff_has_permission('operations') THEN RAISE EXCEPTION 'Operations permission required'; END IF;

  SELECT * INTO v_res FROM public.reservations WHERE id=p_reservation_id FOR UPDATE;
  IF v_res.id IS NULL THEN RAISE EXCEPTION 'Reservation not found'; END IF;
  SELECT * INTO v_listing FROM public.listings WHERE id::text=v_res.listing_id FOR UPDATE;
  IF v_listing.id IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF;
  IF COALESCE(v_listing.sub_type,'long_stay')<>'long_stay' THEN RAISE EXCEPTION 'Long-stay tenancy activation is not valid for Short Stay'; END IF;
  IF v_actor.role<>'creator' AND NOT public.current_actor_in_scope(v_listing.state,v_listing.city) THEN RAISE EXCEPTION 'Listing is outside your assigned State/LGA'; END IF;
  IF v_res.status<>'ready_for_move_in' THEN RAISE EXCEPTION 'Inspection must pass before move-in'; END IF;
  IF v_res.manual_payment_status NOT IN ('paid','completed') OR v_res.paid_at IS NULL THEN RAISE EXCEPTION 'Reservation fee is not confirmed'; END IF;
  IF v_res.rent_payment_status NOT IN ('paid','upfront_paid') OR v_res.rent_paid_at IS NULL THEN RAISE EXCEPTION 'Year 1 rent must be verified before move-in'; END IF;

  v_years:=COALESCE(v_res.rental_plan_years,1);
  IF v_years < 1 OR v_years > 5 THEN RAISE EXCEPTION 'Rental tenure must be between 1 and 5 years'; END IF;
  SELECT NULLIF(value,'')::integer INTO v_grace
  FROM public.platform_settings
  WHERE key='tenancy_grace_days' AND COALESCE(is_active,true)=true
  LIMIT 1;
  IF v_grace IS NULL OR v_grace<0 OR v_grace>30 THEN v_grace:=7; END IF;
  v_end:=(p_start_date+make_interval(years=>v_years))::date;

  UPDATE public.reservations
  SET status='occupied',tenancy_start_date=p_start_date,tenancy_end_date=v_end,
      move_out_grace_until=v_end+v_grace,occupancy_started_at=now(),updated_at=now()
  WHERE id=v_res.id
  RETURNING * INTO v_result;

  UPDATE public.listings
  SET status='occupied',availability_status='occupied',occupied_by=v_res.user_id,occupied_at=now(),tenancy_ends_at=v_end,
      reserved_by=NULL,reservation_expiry=NULL,current_reservation_id=v_res.id,updated_at=now()
  WHERE id=v_listing.id;

  UPDATE public.rent_plans
  SET tenancy_start_date=p_start_date,updated_at=now()
  WHERE reservation_id=v_res.id AND status='active';

  IF v_years>1 THEN
    SELECT id INTO v_plan_id
    FROM public.rent_plans
    WHERE reservation_id=v_res.id AND status='active'
    LIMIT 1;
    IF v_plan_id IS NULL THEN RAISE EXCEPTION 'Future-rent plan is missing'; END IF;

    v_annual:=round(COALESCE(v_res.annual_rent_snapshot,v_listing.price),2);
    v_base:=trunc(v_annual/8.0,2);

    FOR v_target_year IN 2..v_years LOOP
      FOR v_i IN 1..8 LOOP
        v_due:=(p_start_date+make_interval(years=>v_target_year-2,months=>4+v_i-1))::date;
        v_amount:=CASE WHEN v_i=8 THEN round(v_annual-(v_base*7),2) ELSE v_base END;
        INSERT INTO public.rent_plan_contributions(
          rent_plan_id,reservation_id,amount,status,target_year,installment_number,due_date,created_at,updated_at
        ) VALUES (
          v_plan_id,v_res.id,v_amount,'scheduled',v_target_year,v_i,v_due,now(),now()
        )
        ON CONFLICT (rent_plan_id,target_year,installment_number)
        DO UPDATE SET
          reservation_id=EXCLUDED.reservation_id,
          amount=CASE WHEN public.rent_plan_contributions.status IN ('paid','completed') THEN public.rent_plan_contributions.amount ELSE EXCLUDED.amount END,
          due_date=CASE WHEN public.rent_plan_contributions.status IN ('paid','completed') THEN public.rent_plan_contributions.due_date ELSE EXCLUDED.due_date END,
          updated_at=now();
      END LOOP;
    END LOOP;

    UPDATE public.rent_plans
    SET next_rent_due_date=(
          SELECT min(c.due_date) FROM public.rent_plan_contributions c
          WHERE c.rent_plan_id=v_plan_id AND c.status IN ('scheduled','payment_pending','pending')
        ),
        installment_count=8*(v_years-1),
        installment_balance=round(v_annual*(v_years-1),2),
        target_amount=round(v_annual*(v_years-1),2),
        updated_at=now()
    WHERE id=v_plan_id;
  END IF;

  SELECT id INTO v_rent_payment_id
  FROM public.booking_payments
  WHERE paystack_reference=v_res.rent_payment_reference
    AND purpose='apartment_rent'
    AND status IN ('paid','completed')
  LIMIT 1;
  IF v_rent_payment_id IS NOT NULL
     AND EXISTS(SELECT 1 FROM public.property_partner_earning_releases WHERE payment_id=v_rent_payment_id AND status='pending') THEN
    PERFORM public.release_property_partner_earning(v_rent_payment_id,'long_stay_move_in_confirmed');
  END IF;
  RETURN v_result;
END;
$$;


--
-- Name: activate_short_stay(text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.activate_short_stay(p_reservation_id text, p_actual_check_in date DEFAULT CURRENT_DATE) RETURNS public.reservations
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_actor public.profiles; v_res public.reservations; v_listing public.listings; v_result public.reservations; v_payment_id uuid;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role IN ('staff','admin','creator')
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Housing operations access required'; END IF;
  IF v_actor.role='staff' AND NOT public.current_staff_has_permission('operations') THEN RAISE EXCEPTION 'Operations permission required'; END IF;
  SELECT * INTO v_res FROM public.reservations WHERE id=p_reservation_id AND stay_type='short_let' FOR UPDATE;
  IF v_res IS NULL THEN RAISE EXCEPTION 'Short Stay reservation not found'; END IF;
  SELECT * INTO v_listing FROM public.listings WHERE id::text=v_res.listing_id FOR UPDATE;
  IF v_listing IS NULL OR v_listing.sub_type<>'short_let' THEN RAISE EXCEPTION 'Short Stay listing not found'; END IF;
  IF v_actor.role<>'creator' AND NOT public.current_actor_in_scope(v_listing.state,v_listing.city) THEN RAISE EXCEPTION 'Listing is outside your assigned State/LGA'; END IF;
  IF v_res.status<>'ready_for_move_in' OR v_res.rent_payment_status<>'paid' OR v_res.rent_paid_at IS NULL THEN RAISE EXCEPTION 'Short Stay payment must be verified before check-in'; END IF;
  IF p_actual_check_in<v_res.stay_check_in OR p_actual_check_in>=v_res.stay_check_out THEN RAISE EXCEPTION 'Check-in must fall inside the reserved stay dates'; END IF;
  IF v_listing.status='occupied' AND v_listing.current_reservation_id IS DISTINCT FROM v_res.id THEN RAISE EXCEPTION 'Property is currently occupied'; END IF;

  UPDATE public.reservations
  SET status='occupied',tenancy_start_date=p_actual_check_in,tenancy_end_date=v_res.stay_check_out,move_out_grace_until=v_res.stay_check_out,
      occupancy_started_at=now(),updated_at=now()
  WHERE id=v_res.id RETURNING * INTO v_result;
  UPDATE public.listings
  SET status='occupied',availability_status='occupied',occupied_by=v_res.user_id,occupied_at=now(),tenancy_ends_at=v_res.stay_check_out,
      reserved_by=NULL,reservation_expiry=NULL,current_reservation_id=v_res.id,updated_at=now()
  WHERE id=v_listing.id;

  SELECT id INTO v_payment_id FROM public.booking_payments
  WHERE paystack_reference=v_res.rent_payment_reference AND purpose='apartment_rent' AND status IN ('paid','completed') LIMIT 1;
  IF v_payment_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.property_partner_earning_releases WHERE payment_id=v_payment_id AND status='pending') THEN
    PERFORM public.release_property_partner_earning(v_payment_id,'short_stay_check_in_confirmed');
  END IF;
  RETURN v_result;
END;
$$;


--
-- Name: add_conversation_action(uuid, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_conversation_action(p_conversation_id uuid, p_action_type text, p_content text, p_metadata jsonb DEFAULT '{}'::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ DECLARE v_msg_id UUID; v_conv partner_support_conversations%ROWTYPE; BEGIN SELECT * INTO v_conv FROM partner_support_conversations WHERE id = p_conversation_id; INSERT INTO partner_support_messages (conversation_id, sender_id, sender_role, content, action_type, action_metadata, created_at) VALUES (p_conversation_id, COALESCE(v_conv.assigned_staff_id, v_conv.partner_id), 'system', p_content, p_action_type, p_metadata, NOW()) RETURNING id INTO v_msg_id; CASE p_action_type WHEN 'field_officer_assigned' THEN UPDATE partner_support_conversations SET status = 'assigned', assigned_field_officer_id = p_metadata->>'officer_id', updated_at = NOW() WHERE id = p_conversation_id; WHEN 'inspection_scheduled' THEN UPDATE partner_support_conversations SET status = 'in_progress', updated_at = NOW() WHERE id = p_conversation_id; WHEN 'listing_created' THEN UPDATE partner_support_conversations SET listing_id = (p_metadata->>'listing_id')::UUID, updated_at = NOW() WHERE id = p_conversation_id; WHEN 'listing_published' THEN UPDATE partner_support_conversations SET status = 'resolved', updated_at = NOW() WHERE id = p_conversation_id; WHEN 'conversation_closed' THEN UPDATE partner_support_conversations SET status = 'closed', closed_at = NOW(), updated_at = NOW() WHERE id = p_conversation_id; ELSE UPDATE partner_support_conversations SET updated_at = NOW() WHERE id = p_conversation_id; END CASE; RETURN v_msg_id; END; $$;


--
-- Name: admin_appoint_staff(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_appoint_staff(p_target_user_id text, p_module text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles; v_target public.profiles; v_limit integer:=0; v_used integer:=0;
BEGIN
  IF p_module NOT IN('operations','finance','support','verification','field_officer') THEN RAISE EXCEPTION 'A valid Staff module is required'; END IF;
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role IN('admin','creator')
    AND NOT COALESCE(deleted,false) AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false) LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Admin or Creator access required'; END IF;
  SELECT * INTO v_target FROM public.profiles WHERE user_id=p_target_user_id AND NOT COALESCE(deleted,false) FOR UPDATE;
  IF v_target IS NULL THEN RAISE EXCEPTION 'Target account not found'; END IF;
  IF v_target.role NOT IN('user','staff') THEN RAISE EXCEPTION 'Only a User or existing Staff account can be appointed'; END IF;
  IF v_actor.role='admin' THEN
    IF v_actor.assigned_state IS NULL OR v_actor.assigned_lga IS NULL THEN RAISE EXCEPTION 'Admin branch assignment is required'; END IF;
    IF lower(COALESCE(v_target.state,''))<>lower(v_actor.assigned_state)
      OR lower(COALESCE(NULLIF(v_target.local_government,''),NULLIF(v_target.city,''),''))<>lower(v_actor.assigned_lga)
    THEN RAISE EXCEPTION 'Admin can appoint only Users in the assigned branch'; END IF;
    IF v_target.role<>'staff' THEN
      v_limit:=COALESCE(public.get_admin_staff_limit_v2(),0);
      IF v_limit>0 THEN
        SELECT count(*)::integer INTO v_used
        FROM public.profiles p JOIN public.staff_trust_profiles st ON st.staff_id=p.user_id
        WHERE p.role='staff' AND NOT COALESCE(p.deleted,false) AND st.appointed_by=v_actor.user_id;
        IF v_used>=v_limit THEN
          RAISE EXCEPTION 'Staff appointment limit reached (% of %). Creator must increase the Admin Staff limit or appoint the Staff directly.',v_used,v_limit;
        END IF;
      END IF;
    END IF;
  END IF;
  IF v_target.role='user' THEN PERFORM public.admin_update_role(p_target_user_id,'staff'); END IF;
  PERFORM public.manage_staff_permission(p_target_user_id,p_module,true);
  INSERT INTO public.staff_trust_profiles(staff_id,status,appointed_by,appointed_at,trusted_by,trusted_at,supervisor_confirmed,orientation_completed,role_training_completed,code_of_conduct_confirmed,probation_observation_completed,notes,updated_at)
  VALUES(p_target_user_id,'probation',v_actor.user_id,now(),NULL,NULL,false,false,false,false,false,'Staff appointment awaiting WeHouse trust review',now())
  ON CONFLICT(staff_id) DO UPDATE SET status='probation',appointed_by=v_actor.user_id,appointed_at=now(),trusted_by=NULL,trusted_at=NULL,supervisor_confirmed=false,orientation_completed=false,role_training_completed=false,code_of_conduct_confirmed=false,probation_observation_completed=false,notes='Staff appointment awaiting WeHouse trust review',updated_at=now();
  INSERT INTO public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
  VALUES('STAFF_APPOINTMENT','profiles',p_target_user_id,
    jsonb_build_object('module',p_module,'appointed_by_role',v_actor.role,'admin_staff_limit',CASE WHEN v_actor.role='admin' THEN COALESCE(public.get_admin_staff_limit_v2(),0) ELSE NULL END,'state',COALESCE(v_target.state,v_actor.assigned_state),'lga',COALESCE(NULLIF(v_target.local_government,''),NULLIF(v_target.city,''),v_actor.assigned_lga))::text,
    v_actor.user_id,v_actor.email);
  RETURN true;
END;$$;


--
-- Name: admin_assign_field_officer(uuid, text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_assign_field_officer(p_inspection_id uuid, p_field_officer_id text, p_scheduled_date date DEFAULT NULL::date) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles; v_ir public.inspection_requests; v_officer public.profiles;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor IS NULL OR v_actor.role NOT IN ('admin','creator') THEN RAISE EXCEPTION 'Admin or Creator access required'; END IF;
  SELECT * INTO v_ir FROM public.inspection_requests WHERE id=p_inspection_id FOR UPDATE;
  IF v_ir IS NULL THEN RAISE EXCEPTION 'Inspection request not found'; END IF;
  IF v_actor.role='admin' AND (v_ir.property_state IS DISTINCT FROM v_actor.assigned_state OR v_ir.property_city IS DISTINCT FROM v_actor.assigned_lga) THEN RAISE EXCEPTION 'Inspection is outside your assigned branch'; END IF;
  SELECT * INTO v_officer FROM public.profiles WHERE user_id=p_field_officer_id;
  IF v_officer IS NULL OR v_officer.role<>'staff' OR v_officer.assigned_state IS DISTINCT FROM v_ir.property_state OR v_officer.assigned_lga IS DISTINCT FROM v_ir.property_city OR NOT EXISTS(SELECT 1 FROM public.staff_permissions sp WHERE sp.staff_id=v_officer.user_id AND sp.permission='field_officer' AND sp.is_active=true) THEN RAISE EXCEPTION 'Field Officer must be active and assigned to the same LGA as the property'; END IF;
  UPDATE public.inspection_requests SET assigned_to=v_officer.user_id,field_officer_id=v_officer.user_id,assigned_field_officer_id=v_officer.user_id,assigned_at=NOW(),scheduled_date=p_scheduled_date,status='scheduled',updated_at=NOW() WHERE id=p_inspection_id;
END $$;


--
-- Name: admin_ban_user(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_ban_user(p_target_user_id text, p_reason text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles; v_target public.profiles;
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role IN ('admin','creator')
    AND NOT COALESCE(deleted,false) AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false)
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Admin/Creator access required'; END IF;
  SELECT * INTO v_target FROM public.profiles WHERE user_id=p_target_user_id FOR UPDATE;
  IF v_target IS NULL THEN RAISE EXCEPTION 'Target account not found'; END IF;
  IF v_target.auth_id=auth.uid()::text THEN RAISE EXCEPTION 'Cannot ban your own account'; END IF;
  IF v_target.role='creator' THEN RAISE EXCEPTION 'Cannot ban Creator'; END IF;
  PERFORM public._assert_admin_lga_scope(p_target_user_id);
  UPDATE public.profiles SET banned=true,banned_at=now(),banned_by=v_actor.user_id,
    banned_reason=COALESCE(NULLIF(btrim(p_reason),''),'Account permanently banned'),
    deleted=true,deleted_at=now(),worker_status=CASE WHEN role='worker' THEN 'suspended' ELSE worker_status END,
    updated_by=v_actor.user_id,updated_at=now()
  WHERE user_id=p_target_user_id;
  INSERT INTO public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
  VALUES('BAN','profiles',p_target_user_id,jsonb_build_object('reason',COALESCE(NULLIF(btrim(p_reason),''),'Account permanently banned'))::text,v_actor.user_id,v_actor.email);
END; $$;


--
-- Name: admin_count_branch_announcement_recipients(text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_count_branch_announcement_recipients(p_target_roles text[]) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ DECLARE v_actor public.profiles;v_count bigint; BEGIN v_actor:=public._admin_dashboard_actor(); IF v_actor.role<>'admin' THEN RAISE EXCEPTION 'Admin account required'; END IF; SELECT count(*) INTO v_count FROM public.profiles p WHERE p.user_id<>v_actor.user_id AND p.role=ANY(p_target_roles) AND COALESCE(p.deleted,false)=false AND COALESCE(p.suspended,false)=false AND COALESCE(p.banned,false)=false AND CASE WHEN p.role='staff' THEN p.assigned_state=v_actor.assigned_state AND p.assigned_lga=v_actor.assigned_lga ELSE p.state=v_actor.assigned_state AND COALESCE(NULLIF(p.local_government,''),NULLIF(p.city,''))=v_actor.assigned_lga END; RETURN v_count; END; $$;


--
-- Name: admin_create_hotel_from_inspection(uuid, text, text, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_create_hotel_from_inspection(p_inspection_id uuid, p_name text, p_description text DEFAULT NULL::text, p_images text[] DEFAULT ARRAY[]::text[]) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles; v_ir public.inspection_requests; v_id INTEGER;
BEGIN
 SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
 IF v_actor IS NULL OR v_actor.role NOT IN ('admin','creator','staff') THEN RAISE EXCEPTION 'WeHouse operations access required'; END IF;
 IF v_actor.role='staff' AND NOT public.current_staff_has_permission('operations') THEN RAISE EXCEPTION 'Operations permission required'; END IF;
 SELECT * INTO v_ir FROM public.inspection_requests WHERE id=p_inspection_id FOR UPDATE;
 IF v_ir IS NULL OR v_ir.property_type<>'hotel' OR v_ir.status NOT IN ('completed','approved') THEN RAISE EXCEPTION 'Completed hotel inspection required'; END IF;
 IF v_actor.role IN ('admin','staff') AND (v_ir.property_state IS DISTINCT FROM v_actor.assigned_state OR v_ir.property_city IS DISTINCT FROM v_actor.assigned_lga) THEN RAISE EXCEPTION 'Hotel is outside your assigned branch'; END IF;
 IF v_ir.draft_hotel_id IS NOT NULL THEN RAISE EXCEPTION 'A hotel has already been prepared from this inspection'; END IF;
 IF NULLIF(BTRIM(p_name),'') IS NULL THEN RAISE EXCEPTION 'Hotel name is required'; END IF;
 INSERT INTO public.hotels(name,description,state,city,address,images,amenities,owner_id,status,featured,gps_latitude,gps_longitude,inspection_request_id,created_at,updated_at)
 VALUES(BTRIM(p_name),NULLIF(BTRIM(p_description),''),v_ir.property_state,v_ir.property_city,v_ir.property_address,COALESCE(p_images,ARRAY[]::TEXT[]),ARRAY[]::TEXT[],v_ir.owner_id,'draft',false,v_ir.gps_latitude,v_ir.gps_longitude,v_ir.id,NOW(),NOW()) RETURNING hotel_id INTO v_id;
 UPDATE public.inspection_requests SET draft_hotel_id=v_id,updated_at=NOW() WHERE id=v_ir.id;
 RETURN v_id;
END $$;


--
-- Name: admin_get_all_users(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_all_users() RETURNS SETOF public.profiles
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_actor public.profiles;
begin
  v_actor:=public._admin_dashboard_actor();
  return query
  select (jsonb_populate_record(
    null::public.profiles,
    to_jsonb(p)-array['auth_id','creator_auth_password','creator_auth_enabled','worker_gov_id_url','maintenance_exempt','created_by','updated_by']::text[]
  )).*
  from public.profiles p
  where p.deleted_at is null
    and p.role<>'creator'
    and (
      v_actor.role='creator'
      or case when p.role in ('admin','staff')
        then p.assigned_state=v_actor.assigned_state and p.assigned_lga=v_actor.assigned_lga
        else p.state=v_actor.assigned_state and coalesce(nullif(p.local_government,''),nullif(p.city,''))=v_actor.assigned_lga
      end
    )
  order by p.created_at desc;
end;
$$;


--
-- Name: admin_get_all_workers(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_all_workers() RETURNS SETOF public.profiles
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles;
BEGIN
  v_actor:=public._admin_dashboard_actor();
  RETURN QUERY
  SELECT jsonb_populate_record(NULL::public.profiles,
    to_jsonb(p)-ARRAY['auth_id','creator_auth_password','creator_auth_enabled','worker_gov_id_url','maintenance_exempt','created_by','updated_by']::text[])
  FROM public.profiles p
  WHERE p.role='worker' AND p.deleted_at IS NULL
    AND (v_actor.role='creator' OR (p.state=v_actor.assigned_state AND COALESCE(NULLIF(p.local_government,''),NULLIF(p.city,''))=v_actor.assigned_lga))
  ORDER BY p.created_at DESC;
END; $$;


--
-- Name: admin_get_field_officers(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_field_officers() RETURNS SETOF public.profiles
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles;
BEGIN
  v_actor:=public._admin_dashboard_actor();
  RETURN QUERY
  SELECT jsonb_populate_record(NULL::public.profiles,
    to_jsonb(p)-ARRAY['auth_id','creator_auth_password','creator_auth_enabled','worker_gov_id_url','maintenance_exempt','created_by','updated_by']::text[])
  FROM public.profiles p
  WHERE p.role='staff' AND p.deleted_at IS NULL
    AND (v_actor.role='creator' OR (p.assigned_state=v_actor.assigned_state AND p.assigned_lga=v_actor.assigned_lga))
    AND EXISTS(SELECT 1 FROM public.staff_permissions sp WHERE sp.staff_id=p.user_id AND sp.permission='field_officer' AND sp.is_active=true)
  ORDER BY p.created_at DESC;
END; $$;


--
-- Name: admin_get_field_officers_for_inspection(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_field_officers_for_inspection(p_inspection_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles; v_ir public.inspection_requests; v_result JSONB;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor IS NULL OR v_actor.role NOT IN ('admin','creator') THEN RAISE EXCEPTION 'Admin or Creator access required'; END IF;
  SELECT * INTO v_ir FROM public.inspection_requests WHERE id=p_inspection_id;
  IF v_ir IS NULL THEN RAISE EXCEPTION 'Inspection request not found'; END IF;
  IF v_actor.role='admin' AND (v_ir.property_state IS DISTINCT FROM v_actor.assigned_state OR v_ir.property_city IS DISTINCT FROM v_actor.assigned_lga) THEN RAISE EXCEPTION 'Inspection is outside your assigned branch'; END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'distance_km')::numeric NULLS LAST,(x->>'active_inspections')::int,COALESCE(x->>'name','')),'[]'::jsonb) INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'user_id',p.user_id,'name',COALESCE(p.full_name,p.username,p.email),'email',p.email,'assigned_state',p.assigned_state,'assigned_lga',p.assigned_lga,
      'active_inspections',(SELECT count(*) FROM public.inspection_requests q WHERE COALESCE(q.assigned_field_officer_id,q.field_officer_id,q.assigned_to)=p.user_id AND q.status IN ('scheduled','in_progress')),
      'location_captured_at',loc.captured_at,
      'distance_km',CASE WHEN v_ir.gps_latitude IS NOT NULL AND v_ir.gps_longitude IS NOT NULL AND loc.latitude IS NOT NULL AND loc.longitude IS NOT NULL AND loc.captured_at > NOW()-INTERVAL '24 hours' THEN ROUND((6371*2*ASIN(SQRT(POWER(SIN(RADIANS((loc.latitude-v_ir.gps_latitude)/2)),2)+COS(RADIANS(v_ir.gps_latitude))*COS(RADIANS(loc.latitude))*POWER(SIN(RADIANS((loc.longitude-v_ir.gps_longitude)/2)),2))))::numeric,2) ELSE NULL END
    ) x
    FROM public.profiles p
    JOIN public.staff_permissions sp ON sp.staff_id=p.user_id AND sp.permission='field_officer' AND sp.is_active=true
    LEFT JOIN public.staff_location_presence loc ON loc.staff_id=p.user_id
    WHERE p.role='staff' AND NOT COALESCE(p.deleted,false) AND NOT COALESCE(p.suspended,false) AND NOT COALESCE(p.banned,false)
      AND p.assigned_state=v_ir.property_state AND p.assigned_lga=v_ir.property_city
  ) ranked;
  RETURN v_result;
END $$;


--
-- Name: admin_get_my_branch_listings(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_my_branch_listings(p_status text DEFAULT 'all'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles; v_result jsonb;
BEGIN
 v_actor:=public._admin_dashboard_actor();
 SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY l.created_at DESC),'[]'::jsonb) INTO v_result FROM public.listings l
 WHERE l.deleted_at IS NULL AND l.inspection_request_id IS NOT NULL AND (p_status='all' OR l.status=p_status) AND (v_actor.role='creator' OR (l.state=v_actor.assigned_state AND l.city=v_actor.assigned_lga));
 RETURN v_result;
END $$;


--
-- Name: admin_get_my_branch_profiles(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_my_branch_profiles(p_role text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ DECLARE v_actor public.profiles; v_result jsonb; BEGIN v_actor:=public._admin_dashboard_actor(); IF p_role IS NOT NULL AND p_role NOT IN ('user','worker','property_partner','staff','admin') THEN RAISE EXCEPTION 'Invalid role filter'; END IF; SELECT COALESCE(jsonb_agg(to_jsonb(p)-ARRAY['auth_id','creator_auth_password','creator_auth_enabled','worker_gov_id_url','maintenance_exempt','created_by','updated_by']::text[] ORDER BY p.created_at DESC),'[]'::jsonb) INTO v_result FROM public.profiles p WHERE NOT COALESCE(p.deleted,false) AND p.role<>'creator' AND (p_role IS NULL OR p.role=p_role) AND (v_actor.role='creator' OR CASE WHEN p.role IN ('admin','staff') THEN lower(trim(COALESCE(p.assigned_state,'')))=lower(trim(COALESCE(v_actor.assigned_state,''))) AND lower(trim(COALESCE(p.assigned_lga,'')))=lower(trim(COALESCE(v_actor.assigned_lga,''))) ELSE lower(trim(COALESCE(p.state,'')))=lower(trim(COALESCE(v_actor.assigned_state,''))) AND lower(trim(COALESCE(NULLIF(p.local_government,''),NULLIF(p.city,''),'')))=lower(trim(COALESCE(v_actor.assigned_lga,''))) END); RETURN v_result; END; $$;


--
-- Name: admin_get_my_branch_reports(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_my_branch_reports() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles; v_result jsonb;
BEGIN
  v_actor := public._admin_dashboard_actor();
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC),'[]'::jsonb)
  INTO v_result
  FROM public.listing_reports r
  LEFT JOIN public.listings l ON (r.listing_id=l.id::text OR r.listing_id=l.listing_id)
  WHERE v_actor.role='creator' OR (l.state=v_actor.assigned_state AND l.city=v_actor.assigned_lga);
  RETURN v_result;
END;
$$;


--
-- Name: admin_get_my_branch_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_my_branch_stats() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles;
BEGIN
  v_actor := public._admin_dashboard_actor();
  RETURN jsonb_build_object(
    'users',(SELECT count(*) FROM public.profiles p WHERE p.role='user' AND p.deleted_at IS NULL AND COALESCE(p.deleted,false)=false AND (v_actor.role='creator' OR (p.state=v_actor.assigned_state AND COALESCE(NULLIF(p.local_government,''),NULLIF(p.city,''))=v_actor.assigned_lga))),
    'workers',(SELECT count(*) FROM public.profiles p WHERE p.role='worker' AND p.deleted_at IS NULL AND COALESCE(p.deleted,false)=false AND (v_actor.role='creator' OR (p.state=v_actor.assigned_state AND COALESCE(NULLIF(p.local_government,''),NULLIF(p.city,''))=v_actor.assigned_lga))),
    'partners',(SELECT count(*) FROM public.profiles p WHERE p.role='property_partner' AND p.deleted_at IS NULL AND COALESCE(p.deleted,false)=false AND (v_actor.role='creator' OR (p.state=v_actor.assigned_state AND COALESCE(NULLIF(p.local_government,''),NULLIF(p.city,''))=v_actor.assigned_lga))),
    'staff',(SELECT count(*) FROM public.profiles p WHERE p.deleted_at IS NULL AND COALESCE(p.deleted,false)=false AND ((v_actor.role='creator' AND p.role IN ('admin','staff')) OR (v_actor.role<>'creator' AND p.role='staff' AND p.assigned_state=v_actor.assigned_state AND p.assigned_lga=v_actor.assigned_lga))),
    'admins',(SELECT count(*) FROM public.profiles p WHERE p.role='admin' AND p.deleted_at IS NULL AND COALESCE(p.deleted,false)=false AND (v_actor.role='creator' OR (p.assigned_state=v_actor.assigned_state AND p.assigned_lga=v_actor.assigned_lga))),
    'listings',(SELECT count(*) FROM public.listings l WHERE l.deleted_at IS NULL AND l.status='available' AND (v_actor.role='creator' OR (l.state=v_actor.assigned_state AND l.city=v_actor.assigned_lga))),
    'pending_verifications',(SELECT count(*) FROM public.profiles p WHERE p.role='worker' AND p.worker_status IN ('verification_paid','profile_under_review') AND p.deleted_at IS NULL AND COALESCE(p.deleted,false)=false AND (v_actor.role='creator' OR (p.state=v_actor.assigned_state AND COALESCE(NULLIF(p.local_government,''),NULLIF(p.city,''))=v_actor.assigned_lga)))
  );
END;
$$;


--
-- Name: admin_get_my_branch_worker_booking_summaries(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_my_branch_worker_booking_summaries() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor public.profiles;
  v_result jsonb;
BEGIN
  v_actor:=public._admin_dashboard_actor();

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'booking_code',wb.booking_code,
    'service_type',wb.service_type,
    'status',wb.status,
    'negotiated_amount',coalesce(wb.negotiated_amount,wb.agreed_amount,0),
    'scheduled_date',wb.scheduled_date,
    'created_at',wb.created_at,
    'updated_at',wb.updated_at,
    'worker_name',coalesce(w.full_name,w.username,'Worker'),
    'customer_name',coalesce(c.full_name,c.username,'Customer'),
    'needs_attention',(
      wb.status IN ('booking_requested','waiting_payment','completed_pending_approval','disputed')
      OR EXISTS(
        SELECT 1 FROM public.booking_payments bp
        WHERE bp.worker_booking_id=wb.id AND bp.status='review_required'
      )
    ),
    'has_dispute',wb.status='disputed',
    'payment_review_required',EXISTS(
      SELECT 1 FROM public.booking_payments bp
      WHERE bp.worker_booking_id=wb.id AND bp.status='review_required'
    )
  ) ORDER BY wb.updated_at DESC),'[]'::jsonb)
  INTO v_result
  FROM public.worker_bookings wb
  JOIN public.profiles w ON w.user_id=wb.worker_id
  JOIN public.profiles c ON c.user_id=wb.user_id
  WHERE v_actor.role='creator'
     OR (
       lower(trim(coalesce(w.state,'')))=lower(trim(coalesce(v_actor.assigned_state,'')))
       AND lower(trim(coalesce(nullif(w.local_government,''),nullif(w.city,''),'')))=lower(trim(coalesce(v_actor.assigned_lga,'')))
     );

  RETURN v_result;
END;
$$;


--
-- Name: admin_get_my_branch_worker_bookings(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_my_branch_worker_bookings() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles; v_result jsonb;
BEGIN
  v_actor := public._admin_dashboard_actor();
  SELECT COALESCE(jsonb_agg(to_jsonb(wb) ORDER BY wb.created_at DESC),'[]'::jsonb)
  INTO v_result
  FROM public.worker_bookings wb
  JOIN public.profiles w ON w.user_id=wb.worker_id
  WHERE (v_actor.role='creator' OR (w.state=v_actor.assigned_state AND COALESCE(NULLIF(w.local_government,''),NULLIF(w.city,''))=v_actor.assigned_lga));
  RETURN v_result;
END;
$$;


--
-- Name: admin_get_partner_inspections(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_partner_inspections() RETURNS TABLE(id uuid, request_code text, owner_id text, owner_email text, owner_phone text, property_address text, property_city text, property_state text, property_type text, bedrooms integer, bathrooms integer, expected_rent numeric, description text, status text, assigned_to text, field_officer_id text, scheduled_date date, rejection_reason text, notes text, photo_urls text[], created_at timestamp with time zone, updated_at timestamp with time zone, username text, full_name text, phone text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
  SELECT ir.id, ir.request_code, ir.owner_id, ir.owner_email, ir.owner_phone,
    ir.property_address, ir.property_city, ir.property_state, ir.property_type,
    ir.bedrooms, ir.bathrooms, ir.expected_rent, ir.description,
    ir.status, ir.assigned_to, ir.field_officer_id, ir.scheduled_date,
    ir.rejection_reason, ir.notes, ir.photo_urls,
    ir.created_at, ir.updated_at, p.username, p.full_name, p.phone
  FROM public.inspection_requests ir
  LEFT JOIN public.profiles p ON p.user_id = ir.owner_id
  WHERE ir.status IN ('pending', 'scheduled', 'in_progress')
  ORDER BY ir.created_at DESC;
$$;


--
-- Name: admin_get_user_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_user_count() RETURNS TABLE(total bigint, today bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ DECLARE v_actor public.profiles; BEGIN v_actor:=public._admin_dashboard_actor(); RETURN QUERY SELECT COUNT(*)::bigint,COUNT(*) FILTER (WHERE p.created_at>=date_trunc('day',now()))::bigint FROM public.profiles p WHERE p.deleted_at IS NULL AND p.role<>'creator' AND (v_actor.role='creator' OR CASE WHEN p.role IN ('admin','staff') THEN lower(trim(COALESCE(p.assigned_state,'')))=lower(trim(COALESCE(v_actor.assigned_state,''))) AND lower(trim(COALESCE(p.assigned_lga,'')))=lower(trim(COALESCE(v_actor.assigned_lga,''))) ELSE lower(trim(COALESCE(p.state,'')))=lower(trim(COALESCE(v_actor.assigned_state,''))) AND lower(trim(COALESCE(NULLIF(p.local_government,''),NULLIF(p.city,''),'')))=lower(trim(COALESCE(v_actor.assigned_lga,''))) END); END; $$;


--
-- Name: user_inspection_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_inspection_requests (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    reservation_id text,
    listing_id text NOT NULL,
    user_id text NOT NULL,
    field_officer_id text,
    status text DEFAULT 'pending'::text NOT NULL,
    scheduled_date timestamp with time zone,
    notes text,
    report text,
    condition text,
    photo_urls text[] DEFAULT '{}'::text[],
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: admin_get_user_inspections(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_user_inspections() RETURNS SETOF public.user_inspection_requests
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
  SELECT * FROM public.user_inspection_requests 
  WHERE status IN ('pending', 'scheduled', 'in_progress')
  ORDER BY created_at DESC;
$$;


--
-- Name: inspection_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspection_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_code text NOT NULL,
    owner_id text NOT NULL,
    owner_email text NOT NULL,
    owner_phone text,
    property_address text NOT NULL,
    property_city text NOT NULL,
    property_state text NOT NULL,
    property_type text,
    bedrooms integer,
    bathrooms integer,
    expected_rent numeric(12,2),
    description text,
    status text DEFAULT 'pending'::text,
    assigned_to text,
    scheduled_date date,
    completed_at timestamp with time zone,
    rejection_reason text,
    notes text,
    photo_urls text[] DEFAULT '{}'::text[],
    document_urls text[] DEFAULT '{}'::text[],
    gps_latitude numeric(10,8),
    gps_longitude numeric(11,8),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    partner_id uuid,
    field_officer_id text,
    amenities text[] DEFAULT '{}'::text[],
    assigned_field_officer_id text,
    assigned_at timestamp with time zone,
    inspection_started_at timestamp with time zone,
    inspection_completed_at timestamp with time zone,
    draft_listing_id uuid,
    approved_by text,
    approved_at timestamp with time zone,
    published_at timestamp with time zone,
    location_accuracy_m numeric,
    draft_hotel_id integer,
    submission_batch_id uuid,
    submission_batch_position integer,
    sub_type text,
    security_deposit_amount numeric,
    CONSTRAINT inspection_requests_security_deposit_check CHECK (((security_deposit_amount IS NULL) OR (security_deposit_amount >= (0)::numeric))),
    CONSTRAINT inspection_requests_sub_type_check CHECK (((sub_type IS NULL) OR (sub_type = ANY (ARRAY['short_let'::text, 'long_stay'::text]))))
);


--
-- Name: admin_get_user_inspections(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_user_inspections(p_user_id text) RETURNS SETOF public.inspection_requests
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT * FROM inspection_requests 
  WHERE owner_id = p_user_id 
     OR partner_id::text = p_user_id 
  ORDER BY created_at DESC;
$$;


--
-- Name: admin_get_worker_review_identity_status(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_worker_review_identity_status(p_worker_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN jsonb_build_object('identity_status','verified','identity_provider',NULL,'identity_checked_at',NULL,'identity_failure_reason',NULL);
END;
$$;


--
-- Name: admin_get_worker_review_trust_status(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_worker_review_trust_status(p_worker_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles; v_worker public.profiles; v_ver public.worker_verifications; v_identity public.worker_identity_checks; v_payment boolean:=false; v_test public.worker_test_attempts;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role IN('staff','admin','creator') AND NOT COALESCE(deleted,false) AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false) LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Worker oversight access required'; END IF;
  IF v_actor.role='staff' AND NOT public.current_staff_has_permission('verification') THEN RAISE EXCEPTION 'Trusted Verification Staff permission required'; END IF;
  SELECT * INTO v_worker FROM public.profiles WHERE user_id=p_worker_id AND role='worker' LIMIT 1;
  IF v_worker IS NULL THEN RAISE EXCEPTION 'Worker not found'; END IF;
  IF v_actor.role IN('staff','admin') AND(v_actor.assigned_state IS DISTINCT FROM v_worker.state OR(v_actor.assigned_lga IS NOT NULL AND v_actor.assigned_lga IS DISTINCT FROM COALESCE(v_worker.local_government,v_worker.city))) THEN RAISE EXCEPTION 'Worker is outside your assigned branch'; END IF;
  SELECT * INTO v_ver FROM public.worker_verifications WHERE worker_id=p_worker_id LIMIT 1;
  SELECT * INTO v_identity FROM public.worker_identity_checks WHERE worker_id=p_worker_id;
  SELECT EXISTS(SELECT 1 FROM public.booking_payments WHERE user_id=p_worker_id AND purpose='worker_verification' AND status IN('paid','completed')) INTO v_payment;
  SELECT * INTO v_test FROM public.worker_test_attempts WHERE worker_id=p_worker_id AND passed=true AND submitted_at IS NOT NULL ORDER BY submitted_at DESC LIMIT 1;
  RETURN jsonb_build_object('payment_confirmed',v_payment,'identity_status',COALESCE(v_identity.status,'not_started'),'identity_captured',COALESCE(v_identity.status='passed',false),'identity_passed',COALESCE(v_identity.status='passed',false),'face_match_score',v_identity.face_match_score,'liveness_score',v_identity.liveness_score,'anti_spoof_score',v_identity.anti_spoof_score,'readiness_passed',v_test.id IS NOT NULL,'readiness_percent',v_test.percent,'evidence_saved',COALESCE(NULLIF(BTRIM(COALESCE(v_ver.verification_video_url,'')),'') IS NOT NULL,false),'submitted',COALESCE(v_ver.submitted_at IS NOT NULL,false),'review_status',v_ver.status);
END; $$;


--
-- Name: admin_promote_to_staff(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_promote_to_staff(p_target_user_id text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN RAISE EXCEPTION 'Choose a Staff operational module and use the Staff appointment flow'; END;$$;


--
-- Name: admin_publish_inspected_hotel(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_publish_inspected_hotel(p_hotel_id integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles; v_h public.hotels; v_ir public.inspection_requests; v_rooms INTEGER;
BEGIN
 SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
 IF v_actor IS NULL OR v_actor.role NOT IN ('admin','creator') THEN RAISE EXCEPTION 'Admin or Creator access required'; END IF;
 SELECT * INTO v_h FROM public.hotels WHERE hotel_id=p_hotel_id FOR UPDATE;
 IF v_h IS NULL OR v_h.inspection_request_id IS NULL THEN RAISE EXCEPTION 'Inspection-linked hotel required'; END IF;
 SELECT * INTO v_ir FROM public.inspection_requests WHERE id=v_h.inspection_request_id FOR UPDATE;
 IF v_actor.role='admin' AND (v_ir.property_state IS DISTINCT FROM v_actor.assigned_state OR v_ir.property_city IS DISTINCT FROM v_actor.assigned_lga) THEN RAISE EXCEPTION 'Hotel is outside your assigned branch'; END IF;
 SELECT count(*) INTO v_rooms FROM public.hotel_rooms WHERE hotel_id=p_hotel_id;
 IF COALESCE(array_length(v_h.images,1),0)<1 OR v_rooms<1 THEN RAISE EXCEPTION 'At least one hotel image and one room type are required before publication'; END IF;
 UPDATE public.hotels SET status='active',approved_by=v_actor.user_id,approved_at=NOW(),published_at=NOW(),updated_at=NOW() WHERE hotel_id=p_hotel_id;
 UPDATE public.inspection_requests SET status='approved',approved_by=v_actor.user_id,approved_at=NOW(),published_at=NOW(),updated_at=NOW() WHERE id=v_ir.id;
END $$;


--
-- Name: admin_publish_inspected_listing(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_publish_inspected_listing(p_listing_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles; v_listing public.listings; v_ir public.inspection_requests;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor IS NULL OR v_actor.role NOT IN ('admin','creator') THEN RAISE EXCEPTION 'Admin or Creator access required'; END IF;
  SELECT * INTO v_listing FROM public.listings WHERE id=p_listing_id AND deleted_at IS NULL FOR UPDATE;
  IF v_listing IS NULL OR v_listing.inspection_request_id IS NULL THEN RAISE EXCEPTION 'Inspection-linked listing required'; END IF;
  SELECT * INTO v_ir FROM public.inspection_requests WHERE id=v_listing.inspection_request_id FOR UPDATE;
  IF v_ir.status NOT IN ('completed','approved') THEN RAISE EXCEPTION 'Inspection is not complete'; END IF;
  IF v_actor.role='admin' AND (v_ir.property_state IS DISTINCT FROM v_actor.assigned_state OR v_ir.property_city IS DISTINCT FROM v_actor.assigned_lga) THEN RAISE EXCEPTION 'Property is outside your assigned branch'; END IF;
  IF NULLIF(BTRIM(v_listing.title),'') IS NULL OR COALESCE(v_listing.price,0)<=0 OR COALESCE(array_length(v_listing.images,1),0)<1 THEN
    RAISE EXCEPTION 'Title, valid price and at least one image are required before publication';
  END IF;
  IF COALESCE(v_listing.property_type,'apartment')='apartment' THEN
    IF v_listing.sub_type NOT IN ('short_let','long_stay') THEN RAISE EXCEPTION 'Apartment must be classified as Short Stay or Long Stay before publication'; END IF;
    IF v_listing.sub_type='short_let' AND COALESCE(v_listing.security_deposit_amount,0)<=0 THEN RAISE EXCEPTION 'Short Stay requires a refundable security deposit'; END IF;
    IF v_listing.sub_type='short_let' AND NOT ('Furnished'=ANY(COALESCE(v_listing.amenities,ARRAY[]::text[]))) THEN RAISE EXCEPTION 'Short Stay apartment must be furnished'; END IF;
  END IF;

  UPDATE public.listings
  SET status='available',availability_status='available',approved_by=v_actor.user_id,approved_at=NOW(),rejection_reason=NULL,updated_at=NOW()
  WHERE id=p_listing_id;
  UPDATE public.inspection_requests
  SET status='approved',approved_by=v_actor.user_id,approved_at=NOW(),published_at=NOW(),updated_at=NOW()
  WHERE id=v_ir.id;
END $$;


--
-- Name: admin_reactivate_user(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_reactivate_user(p_target_user_id text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles; v_target public.profiles;
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role IN ('admin','creator')
    AND NOT COALESCE(deleted,false) AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false)
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Admin/Creator access required'; END IF;
  SELECT * INTO v_target FROM public.profiles WHERE user_id=p_target_user_id FOR UPDATE;
  IF v_target IS NULL THEN RAISE EXCEPTION 'Target account not found'; END IF;
  IF v_target.auth_id=auth.uid()::text THEN RAISE EXCEPTION 'Cannot reactivate your own account'; END IF;
  IF v_target.role='creator' THEN RAISE EXCEPTION 'Cannot modify Creator'; END IF;
  PERFORM public._assert_admin_lga_scope(p_target_user_id);
  IF COALESCE(v_target.deleted,false) THEN RAISE EXCEPTION 'Deleted accounts cannot be reactivated'; END IF;
  IF COALESCE(v_target.banned,false) THEN RAISE EXCEPTION 'Banned accounts cannot be reactivated'; END IF;
  IF NOT COALESCE(v_target.suspended,false) THEN RAISE EXCEPTION 'Account is not suspended'; END IF;
  UPDATE public.profiles SET suspended=false,suspended_at=NULL,suspended_by=NULL,suspended_reason=NULL,
    worker_status=CASE WHEN role='worker' THEN 'pending' ELSE worker_status END,updated_by=v_actor.user_id,updated_at=now()
  WHERE user_id=p_target_user_id;
  INSERT INTO public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
  VALUES('REACTIVATE','profiles',p_target_user_id,'{}',v_actor.user_id,v_actor.email);
END; $$;


--
-- Name: admin_resolve_my_branch_report(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_resolve_my_branch_report(p_report_id text, p_action text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles; v_report public.listing_reports; v_listing public.listings;
BEGIN
  v_actor := public._admin_dashboard_actor();
  SELECT * INTO v_report FROM public.listing_reports WHERE id=p_report_id FOR UPDATE;
  IF v_report IS NULL THEN RAISE EXCEPTION 'Report not found'; END IF;
  SELECT * INTO v_listing FROM public.listings WHERE id::text=v_report.listing_id OR listing_id=v_report.listing_id LIMIT 1;
  IF v_actor.role='admin' AND (v_listing IS NULL OR v_listing.state IS DISTINCT FROM v_actor.assigned_state OR v_listing.city IS DISTINCT FROM v_actor.assigned_lga) THEN RAISE EXCEPTION 'Report is outside your assigned branch'; END IF;
  IF p_action NOT IN ('resolved','dismissed') THEN RAISE EXCEPTION 'Action must be resolved or dismissed'; END IF;
  UPDATE public.listing_reports SET status=p_action,resolved_by=v_actor.user_id,resolved_at=now() WHERE id=p_report_id;
END;
$$;


--
-- Name: admin_review_my_branch_listing(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_review_my_branch_listing(p_listing_id uuid, p_decision text, p_reason text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles; v_listing public.listings;
BEGIN
 v_actor:=public._admin_dashboard_actor();
 SELECT * INTO v_listing FROM public.listings WHERE id=p_listing_id AND deleted_at IS NULL FOR UPDATE;
 IF v_listing IS NULL OR v_listing.inspection_request_id IS NULL THEN RAISE EXCEPTION 'Only inspection-linked prepared listings can be reviewed'; END IF;
 IF v_actor.role='admin' AND (v_listing.state IS DISTINCT FROM v_actor.assigned_state OR v_listing.city IS DISTINCT FROM v_actor.assigned_lga) THEN RAISE EXCEPTION 'Listing is outside your assigned branch'; END IF;
 IF p_decision='approve' THEN PERFORM public.admin_publish_inspected_listing(p_listing_id);
 ELSIF p_decision='reject' THEN
   IF NULLIF(BTRIM(COALESCE(p_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'Rejection reason is required'; END IF;
   UPDATE public.listings SET status='rejected',availability_status='rejected',rejection_reason=BTRIM(p_reason),updated_at=NOW() WHERE id=p_listing_id;
 ELSE RAISE EXCEPTION 'Decision must be approve or reject'; END IF;
END $$;


--
-- Name: admin_review_my_branch_worker(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_review_my_branch_worker(p_worker_id text, p_decision text, p_reason text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles; v_worker public.profiles; v_ver public.worker_verifications;
BEGIN
  v_actor:=public._admin_dashboard_actor();
  SELECT * INTO v_worker FROM public.profiles WHERE user_id=p_worker_id AND role='worker' AND COALESCE(deleted,false)=false FOR UPDATE;
  IF v_worker IS NULL THEN RAISE EXCEPTION 'Worker not found'; END IF;
  IF v_actor.role='admin' AND(v_worker.state IS DISTINCT FROM v_actor.assigned_state OR COALESCE(NULLIF(v_worker.local_government,''),NULLIF(v_worker.city,'')) IS DISTINCT FROM v_actor.assigned_lga) THEN RAISE EXCEPTION 'Worker is outside your assigned branch'; END IF;
  IF v_worker.worker_status<>'profile_under_review' THEN RAISE EXCEPTION 'Worker is not in the review queue'; END IF;
  SELECT * INTO v_ver FROM public.worker_verifications WHERE worker_id=p_worker_id LIMIT 1;
  IF p_decision='approve' THEN
    IF NOT public.worker_test_passed(p_worker_id) THEN RAISE EXCEPTION 'Worker readiness check has not been passed'; END IF;
    IF v_ver IS NULL OR NULLIF(BTRIM(COALESCE(v_ver.verification_video_url,'')),'') IS NULL THEN RAISE EXCEPTION 'Professional work evidence is incomplete'; END IF;
    UPDATE public.profiles SET worker_status='verified',worker_verified=true,available=true,updated_at=now(),updated_by=v_actor.user_id WHERE user_id=p_worker_id;
    UPDATE public.worker_verifications SET status='verified',reviewed_by=v_actor.user_id,reviewed_at=now(),updated_at=now() WHERE id=v_ver.id;
  ELSIF p_decision='reject' THEN
    IF NULLIF(BTRIM(COALESCE(p_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'Rejection reason is required'; END IF;
    UPDATE public.profiles SET worker_status='rejected',worker_verified=false,available=false,updated_at=now(),updated_by=v_actor.user_id WHERE user_id=p_worker_id;
    UPDATE public.worker_verifications SET status='rejected',reviewed_by=v_actor.user_id,review_notes=BTRIM(p_reason),reviewed_at=now(),updated_at=now() WHERE id=v_ver.id;
  ELSE RAISE EXCEPTION 'Decision must be approve or reject'; END IF;
  INSERT INTO public.worker_verification_reviews(worker_id,reviewer_id,reviewer_role,action,rejection_reason)
  VALUES(p_worker_id,v_actor.user_id,v_actor.role,CASE WHEN p_decision='approve' THEN 'approved' ELSE 'rejected' END,CASE WHEN p_decision='reject' THEN BTRIM(p_reason) ELSE NULL END);
END;
$$;


--
-- Name: admin_send_branch_announcement(text, text, text[], text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_send_branch_announcement(p_title text, p_content text, p_target_roles text[], p_recipient_ids text[] DEFAULT NULL::text[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_actor public.profiles;
  v_id integer;
  v_count integer;
  v_roles text[];
begin
  v_actor:=public._admin_dashboard_actor();
  if v_actor.role<>'admin' then raise exception 'Admin account required'; end if;
  if nullif(btrim(coalesce(p_title,'')),'') is null then raise exception 'Announcement title is required'; end if;
  if nullif(btrim(coalesce(p_content,'')),'') is null then raise exception 'Announcement content is required'; end if;
  select coalesce(array_agg(distinct r),'{}'::text[]) into v_roles
  from unnest(coalesce(p_target_roles,'{}'::text[])) r
  where r in ('user','worker','staff','property_partner');
  if coalesce(array_length(v_roles,1),0)=0 then raise exception 'Select at least one recipient type'; end if;

  insert into public.announcements(title,content,sender_id,sender_role,target_type,scope,recipient_count,read_count,created_at)
  values(
    btrim(p_title),btrim(p_content),v_actor.user_id,'admin',
    case when p_recipient_ids is null then 'all_users' else 'specific_user' end,
    v_actor.assigned_state||' / '||v_actor.assigned_lga,0,0,now()
  ) returning id into v_id;

  insert into public.announcement_recipients(announcement_id,user_id,read_status,delivered_at)
  select v_id,p.user_id,false,now()
  from public.profiles p
  where p.user_id<>v_actor.user_id
    and p.role=any(v_roles)
    and coalesce(p.deleted,false)=false
    and coalesce(p.suspended,false)=false
    and coalesce(p.banned,false)=false
    and case when p.role='staff'
      then p.assigned_state=v_actor.assigned_state and p.assigned_lga=v_actor.assigned_lga
      else p.state=v_actor.assigned_state and coalesce(nullif(p.local_government,''),nullif(p.city,''))=v_actor.assigned_lga
    end
    and (p_recipient_ids is null or p.user_id=any(p_recipient_ids));

  get diagnostics v_count=row_count;
  if v_count=0 then
    delete from public.announcements where id=v_id;
    raise exception 'No users in your branch match the selected recipients';
  end if;
  update public.announcements set recipient_count=v_count where id=v_id;
  return jsonb_build_object('id',v_id,'recipient_count',v_count);
end;
$$;


--
-- Name: admin_suspend_user(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_suspend_user(p_target_user_id text, p_reason text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles; v_target public.profiles;
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role IN ('admin','creator')
    AND NOT COALESCE(deleted,false) AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false)
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Admin/Creator access required'; END IF;
  SELECT * INTO v_target FROM public.profiles WHERE user_id=p_target_user_id FOR UPDATE;
  IF v_target IS NULL THEN RAISE EXCEPTION 'Target account not found'; END IF;
  IF v_target.auth_id=auth.uid()::text THEN RAISE EXCEPTION 'Cannot suspend your own account'; END IF;
  IF v_target.role='creator' THEN RAISE EXCEPTION 'Cannot suspend Creator'; END IF;
  PERFORM public._assert_admin_lga_scope(p_target_user_id);
  UPDATE public.profiles SET suspended=true,suspended_at=now(),suspended_by=v_actor.user_id,
    suspended_reason=COALESCE(NULLIF(btrim(p_reason),''),'Administrative suspension'),updated_by=v_actor.user_id,updated_at=now()
  WHERE user_id=p_target_user_id;
  INSERT INTO public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
  VALUES('SUSPEND','profiles',p_target_user_id,jsonb_build_object('reason',COALESCE(NULLIF(btrim(p_reason),''),'Administrative suspension'))::text,v_actor.user_id,v_actor.email);
END; $$;


--
-- Name: admin_toggle_exempt(text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_toggle_exempt(target_user_id text, exempt boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles;
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role='creator'
    AND NOT COALESCE(deleted,false) AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false)
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Creator access required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE user_id=target_user_id AND role<>'creator') THEN
    RAISE EXCEPTION 'Target account not found or protected';
  END IF;
  UPDATE public.profiles SET maintenance_exempt=exempt,updated_by=v_actor.user_id,updated_at=now()
  WHERE user_id=target_user_id AND role<>'creator';
  INSERT INTO public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
  VALUES('MAINTENANCE_EXEMPT','profiles',target_user_id,jsonb_build_object('exempt',exempt)::text,v_actor.user_id,v_actor.email);
END; $$;


--
-- Name: admin_update_role(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_update_role(p_target_user_id text, p_new_role text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ DECLARE v_actor public.profiles; v_target public.profiles; BEGIN SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND NOT COALESCE(deleted,false) AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false) LIMIT 1; IF v_actor IS NULL OR v_actor.role<>'admin' THEN RAISE EXCEPTION 'Admin access required. Creator must use Team management.'; END IF; SELECT * INTO v_target FROM public.profiles WHERE user_id=p_target_user_id FOR UPDATE; IF v_target IS NULL THEN RAISE EXCEPTION 'Target user not found'; END IF; IF v_target.auth_id=auth.uid()::text THEN RAISE EXCEPTION 'Cannot modify your own role'; END IF; IF v_target.role NOT IN ('user','staff') OR p_new_role NOT IN ('user','staff') THEN RAISE EXCEPTION 'Admin can manage only User and Staff roles'; END IF; PERFORM public._assert_admin_lga_scope(p_target_user_id); IF p_new_role='staff' THEN UPDATE public.profiles SET role='staff',assigned_state=v_actor.assigned_state,assigned_lga=v_actor.assigned_lga,scope='local',updated_by=v_actor.user_id,updated_at=now() WHERE user_id=p_target_user_id; ELSE UPDATE public.profiles SET role='user',assigned_state=NULL,assigned_lga=NULL,scope=NULL,updated_by=v_actor.user_id,updated_at=now() WHERE user_id=p_target_user_id; UPDATE public.staff_permissions SET is_active=false,revoked_at=now() WHERE staff_id=p_target_user_id AND is_active=true; END IF; INSERT INTO public.role_change_history(user_id,user_email,old_role,new_role,changed_by,changed_by_email) VALUES(p_target_user_id,v_target.email,v_target.role,p_new_role,v_actor.user_id,v_actor.email); INSERT INTO public.audit_logs(action,target_type,target_id,details,admin_id,admin_email) VALUES('ROLE_CHANGE','profiles',p_target_user_id,jsonb_build_object('old_role',v_target.role,'new_role',p_new_role,'state',v_actor.assigned_state,'lga',v_actor.assigned_lga)::text,v_actor.user_id,v_actor.email); END; $$;


--
-- Name: listings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    listing_id text NOT NULL,
    title text NOT NULL,
    description text,
    price numeric DEFAULT 0 NOT NULL,
    currency text DEFAULT 'NGN'::text NOT NULL,
    state text,
    city text,
    address text,
    images text[] DEFAULT '{}'::text[],
    bedrooms integer DEFAULT 1,
    bathrooms integer DEFAULT 1,
    availability_status text DEFAULT 'available'::text NOT NULL,
    owner_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'available'::text,
    reserved_by text,
    reservation_expiry timestamp with time zone,
    reservation_fee_paid boolean DEFAULT false,
    chat_unlocked boolean DEFAULT false,
    videos text[] DEFAULT '{}'::text[],
    chat_agent_id text,
    property_type text,
    submitted_by_role text,
    approved_by text,
    approved_at timestamp with time zone,
    rejection_reason text,
    security_deposit_amount numeric(12,2) DEFAULT NULL::numeric,
    partner_id text,
    deleted_at timestamp with time zone,
    sub_type text,
    contact_phone text,
    amenities text[] DEFAULT '{}'::text[],
    inspection_request_id uuid,
    gps_latitude numeric,
    gps_longitude numeric,
    location_accuracy_m numeric,
    current_reservation_id text,
    occupied_by text,
    occupied_at timestamp with time zone,
    tenancy_ends_at date,
    CONSTRAINT listings_availability_status_check CHECK ((availability_status = ANY (ARRAY['pending_approval'::text, 'available'::text, 'reserved'::text, 'occupied'::text, 'maintenance'::text, 'closed'::text, 'rejected'::text]))),
    CONSTRAINT listings_status_check CHECK ((status = ANY (ARRAY['pending_approval'::text, 'available'::text, 'reserved'::text, 'occupied'::text, 'maintenance'::text, 'closed'::text, 'rejected'::text]))),
    CONSTRAINT listings_sub_type_check CHECK (((sub_type IS NULL) OR (sub_type = ANY (ARRAY['short_let'::text, 'long_stay'::text]))))
);


--
-- Name: approve_listing_internal(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_listing_internal(p_listing_id uuid) RETURNS public.listings
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$ DECLARE v_actor public.profiles; v_listing public.listings; BEGIN SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role IN ('admin','creator') AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1; IF v_actor IS NULL THEN RAISE EXCEPTION 'Admin or Creator approval required'; END IF; SELECT * INTO v_listing FROM public.listings WHERE id=p_listing_id AND deleted_at IS NULL FOR UPDATE; IF v_listing IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF; IF v_listing.status<>'pending_approval' THEN RAISE EXCEPTION 'Only pending listings can be approved'; END IF; IF v_actor.role='admin' THEN IF COALESCE(v_listing.submitted_by_role,'') NOT IN ('staff','property_partner') THEN RAISE EXCEPTION 'Admin cannot approve this submission type'; END IF; IF NOT public.current_actor_in_scope(v_listing.state,v_listing.city) THEN RAISE EXCEPTION 'Listing is outside your assigned branch'; END IF; END IF; UPDATE public.listings SET status='available',availability_status='available',approved_by=v_actor.user_id,approved_at=now(),rejection_reason=NULL WHERE id=p_listing_id RETURNING * INTO v_listing; RETURN v_listing; END; $$;


--
-- Name: approve_withdrawal_v2(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_withdrawal_v2(p_withdrawal_id uuid, p_approved_by text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE v_withdrawal RECORD; v_wallet RECORD;
BEGIN
  SELECT * INTO v_withdrawal FROM withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Withdrawal not found'; END IF;
  IF v_withdrawal.status NOT IN ('pending', 'processing') THEN RAISE EXCEPTION 'Cannot be approved'; END IF;
  SELECT * INTO v_wallet FROM wallets WHERE id = v_withdrawal.wallet_id FOR UPDATE;
  IF v_wallet.owner_id = p_approved_by THEN RAISE EXCEPTION 'Cannot approve own withdrawal'; END IF;
  UPDATE wallets SET frozen_balance = GREATEST(0, frozen_balance - v_withdrawal.amount), total_withdrawn = total_withdrawn + v_withdrawal.amount, updated_at = NOW() WHERE id = v_withdrawal.wallet_id;
  UPDATE withdrawals SET status = 'successful', processed_at = NOW(), updated_at = NOW() WHERE id = p_withdrawal_id;
  RETURN TRUE;
END;
$$;


--
-- Name: assign_field_officer(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assign_field_officer(p_conversation_id uuid, p_staff_id text, p_officer_id text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ BEGIN UPDATE partner_support_conversations SET assigned_staff_id = p_staff_id, assigned_field_officer_id = p_officer_id, status = 'assigned', updated_at = NOW() WHERE id = p_conversation_id; INSERT INTO partner_support_messages (conversation_id, sender_id, sender_role, content, action_type, action_metadata, created_at) SELECT p_conversation_id, p_staff_id, 'system', 'Field officer assigned to inspect property', 'field_officer_assigned', jsonb_build_object('officer_id', p_officer_id), NOW(); RETURN FOUND; END; $$;


--
-- Name: assign_partner_inspection(uuid, text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assign_partner_inspection(p_inspection_id uuid, p_field_officer_id text, p_scheduled_date date) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_actor record; v_req record; v_officer record;
begin
 select user_id,role,assigned_state,assigned_lga,deleted,suspended,banned into v_actor from public.profiles where auth_id=auth.uid()::text limit 1;
 if v_actor is null or v_actor.role not in ('admin','creator') or coalesce(v_actor.deleted,false) or coalesce(v_actor.suspended,false) or coalesce(v_actor.banned,false) then raise exception 'Admin or Creator access required'; end if;
 select * into v_req from public.inspection_requests where id=p_inspection_id for update;
 if v_req is null then raise exception 'Inspection request not found'; end if;
 if v_req.status not in ('pending','scheduled') then raise exception 'Inspection cannot be assigned at this stage'; end if;
 if v_actor.role='admin' and (lower(coalesce(v_actor.assigned_state,''))<>lower(coalesce(v_req.property_state,'')) or lower(coalesce(v_actor.assigned_lga,''))<>lower(coalesce(v_req.property_city,''))) then raise exception 'Inspection is outside your assigned branch'; end if;
 select p.user_id,p.assigned_state,p.assigned_lga into v_officer from public.profiles p where p.user_id=p_field_officer_id and p.role='staff' and coalesce(p.deleted,false)=false and coalesce(p.suspended,false)=false and coalesce(p.banned,false)=false and exists(select 1 from public.staff_permissions sp where sp.staff_id=p.user_id and sp.permission='field_officer' and sp.is_active=true);
 if v_officer is null then raise exception 'Eligible Field Officer not found'; end if;
 if lower(coalesce(v_officer.assigned_state,''))<>lower(coalesce(v_req.property_state,'')) or lower(coalesce(v_officer.assigned_lga,''))<>lower(coalesce(v_req.property_city,'')) then raise exception 'Field Officer must belong to the property branch'; end if;
 update public.inspection_requests set assigned_to=p_field_officer_id,field_officer_id=p_field_officer_id,assigned_field_officer_id=p_field_officer_id,assigned_at=now(),scheduled_date=p_scheduled_date,status='scheduled',updated_at=now() where id=p_inspection_id;
end $$;


--
-- Name: attach_property_partner_to_inspection(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.attach_property_partner_to_inspection() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.partner_id IS NULL AND NEW.owner_id IS NOT NULL THEN
    SELECT pp.id INTO NEW.partner_id
    FROM public.property_partners pp
    WHERE pp.profile_id=NEW.owner_id
    ORDER BY pp.created_at DESC
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: block_retired_worker_identity_fields(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.block_retired_worker_identity_fields() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NULLIF(BTRIM(COALESCE(NEW.gov_id_type,'')),'') IS NOT NULL
    OR NULLIF(BTRIM(COALESCE(NEW.gov_id_number,'')),'') IS NOT NULL
    OR NULLIF(BTRIM(COALESCE(NEW.gov_id_photo_url,'')),'') IS NOT NULL
    OR NULLIF(BTRIM(COALESCE(NEW.selfie_photo_url,'')),'') IS NOT NULL
    OR NULLIF(BTRIM(COALESCE(NEW.identity_provider,'')),'') IS NOT NULL
    OR NULLIF(BTRIM(COALESCE(NEW.identity_reference,'')),'') IS NOT NULL
    OR NEW.identity_checked_at IS NOT NULL
    OR NULLIF(BTRIM(COALESCE(NEW.identity_failure_reason,'')),'') IS NOT NULL
    OR COALESCE(NEW.identity_status,'not_started')<>'not_started'
  THEN RAISE EXCEPTION 'Government/external identity fields are retired from WeHouse Worker verification'; END IF;
  NEW.identity_status:='not_started';
  RETURN NEW;
END;
$$;


--
-- Name: bump_legal_version(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bump_legal_version() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if new.key in ('privacy_policy','terms_of_service') and (tg_op='INSERT' or new.value is distinct from old.value) then
    insert into public.platform_settings(key,value,label,description,category,data_type,is_active,updated_at)
    values('legal_version',extract(epoch from clock_timestamp())::bigint::text,'Legal version','Automatically changes when Privacy Policy or Terms & Conditions change.','platform','text',true,now())
    on conflict (key) do update set value=excluded.value,updated_at=excluded.updated_at,is_active=true;
  end if;
  return new;
end $$;


--
-- Name: calculate_commission(numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_commission(p_amount numeric, p_type text DEFAULT 'worker'::text) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: calculate_reservation_refund(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_reservation_refund(p_reservation_id text, p_reason_category text) RETURNS TABLE(refund_amount numeric, wehouse_retained numeric, refund_percent numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE v_res public.reservations; v_actor public.profiles; v_percent numeric;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_res FROM public.reservations WHERE id=p_reservation_id;
  IF v_res IS NULL THEN RAISE EXCEPTION 'Reservation not found'; END IF;
  IF v_res.user_id<>v_actor.user_id THEN
    IF v_actor.role='staff' THEN
      IF NOT public.current_staff_has_permission('finance') OR NOT public.current_actor_can_access_listing_ref(v_res.listing_id) THEN RAISE EXCEPTION 'Finance branch access required'; END IF;
    ELSIF v_actor.role='admin' THEN
      IF NOT public.current_actor_can_access_listing_ref(v_res.listing_id) THEN RAISE EXCEPTION 'Reservation is outside your branch'; END IF;
    ELSIF v_actor.role<>'creator' THEN RAISE EXCEPTION 'Not authorized'; END IF;
  END IF;
  CASE p_reason_category
    WHEN 'expired_no_action' THEN v_percent:=0;
    WHEN 'customer_declined_inspection' THEN SELECT COALESCE(NULLIF(value,'')::numeric,50) INTO v_percent FROM public.platform_settings WHERE key='post_inspection_refund_percent';
    WHEN 'provider_failure','listing_mismatch' THEN v_percent:=100;
    ELSE RAISE EXCEPTION 'Invalid refund reason';
  END CASE;
  refund_amount:=round(v_res.amount*v_percent/100,2); wehouse_retained:=v_res.amount-refund_amount; refund_percent:=v_percent; RETURN NEXT;
END;
$$;


--
-- Name: can_current_actor_read_profile(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_current_actor_read_profile(p_target_user_id text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$ DECLARE v_actor public.profiles; v_target public.profiles; BEGIN IF auth.uid() IS NULL OR p_target_user_id IS NULL THEN RETURN false; END IF; SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1; IF v_actor IS NULL THEN RETURN false; END IF; IF v_actor.user_id=p_target_user_id OR v_actor.role='creator' THEN RETURN true; END IF; IF v_actor.role NOT IN ('admin','staff') THEN RETURN false; END IF; SELECT * INTO v_target FROM public.profiles WHERE user_id=p_target_user_id LIMIT 1; IF v_target IS NULL THEN RETURN false; END IF; RETURN public.current_actor_in_scope(COALESCE(NULLIF(v_target.assigned_state,''),NULLIF(v_target.state,'')),COALESCE(NULLIF(v_target.assigned_lga,''),NULLIF(v_target.local_government,''),NULLIF(v_target.city,''))); END; $$;


--
-- Name: cancel_booking(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_booking(p_booking_id uuid, p_reason text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor public.profiles;
  v_booking public.worker_bookings;
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND coalesce(deleted,false)=false
    AND coalesce(suspended,false)=false
    AND coalesce(banned,false)=false
  LIMIT 1;

  IF v_actor IS NULL OR v_actor.role NOT IN ('user','worker') THEN RAISE EXCEPTION 'Active booking participant required'; END IF;
  IF nullif(trim(coalesce(p_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'Cancellation reason is required'; END IF;

  SELECT * INTO v_booking FROM public.worker_bookings WHERE id=p_booking_id FOR UPDATE;
  IF v_booking IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF v_actor.user_id NOT IN (v_booking.user_id,v_booking.worker_id) THEN RAISE EXCEPTION 'Not authorized to cancel this booking'; END IF;
  IF v_booking.status NOT IN ('booking_requested','negotiating','waiting_payment') THEN RAISE EXCEPTION 'Booking cannot be cancelled in current status: %',v_booking.status; END IF;

  IF EXISTS(
    SELECT 1
    FROM public.booking_payments bp
    WHERE bp.worker_booking_id=p_booking_id
      AND bp.status='review_required'
  ) THEN
    RAISE EXCEPTION 'This booking has a verified payment awaiting WeHouse review and cannot be cancelled yet';
  END IF;

  UPDATE public.worker_bookings
  SET status='cancelled',cancellation_reason=trim(p_reason),cancelled_by=v_actor.user_id,updated_at=now()
  WHERE id=p_booking_id;
  RETURN true;
END;
$$;


--
-- Name: cancel_my_apartment_reservation(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_my_apartment_reservation(p_reservation_id text) RETURNS public.reservations
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_user_id text; v_res public.reservations; v_result public.reservations;
BEGIN
  SELECT user_id INTO v_user_id FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_res FROM public.reservations WHERE id=p_reservation_id AND user_id=v_user_id FOR UPDATE;
  IF v_res IS NULL THEN RAISE EXCEPTION 'Reservation not found'; END IF;
  IF v_res.status NOT IN ('payment_pending','reserved','inspection_pending','ready_for_move_in') THEN
    RAISE EXCEPTION 'Reservation can no longer be cancelled here';
  END IF;
  IF v_res.manual_payment_status IN ('paid','completed') OR v_res.paid_at IS NOT NULL THEN
    RAISE EXCEPTION 'Paid reservations must be handled by support';
  END IF;
  UPDATE public.reservations SET status='cancelled',processed_at=now(),updated_at=now()
  WHERE id=v_res.id RETURNING * INTO v_result;
  UPDATE public.booking_payments SET status='cancelled',updated_at=now()
  WHERE paystack_reference=v_res.payment_reference AND status='pending';
  UPDATE public.listings
  SET status='available',availability_status='available',reserved_by=NULL,reservation_expiry=NULL,
      reservation_fee_paid=false,chat_unlocked=false,current_reservation_id=NULL,updated_at=now()
  WHERE id::text=v_res.listing_id AND current_reservation_id=v_res.id;
  RETURN v_result;
END;
$$;


--
-- Name: cancel_my_hotel_booking(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_my_hotel_booking(p_booking_id integer) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE v_user_id text;v_changed integer;
BEGIN
  SELECT p.user_id INTO v_user_id
  FROM public.profiles p
  WHERE p.auth_id=auth.uid()::text AND p.role='user'
    AND NOT COALESCE(p.deleted,false) AND NOT COALESCE(p.suspended,false) AND NOT COALESCE(p.banned,false)
  LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Active User account required'; END IF;

  UPDATE public.hotel_bookings
  SET status='cancelled',payment_status=CASE WHEN payment_status='paid' THEN payment_status ELSE 'expired' END,updated_at=now()
  WHERE booking_id=p_booking_id AND user_id=v_user_id AND status='pending' AND payment_status<>'paid';
  GET DIAGNOSTICS v_changed=ROW_COUNT;
  IF v_changed=0 THEN RAISE EXCEPTION 'Only your unpaid pending hotel booking can be cancelled'; END IF;

  UPDATE public.booking_payments bp
  SET status='cancelled',updated_at=now()
  WHERE bp.hotel_booking_id=p_booking_id AND bp.user_id=v_user_id AND bp.purpose='hotel_booking' AND bp.status='pending';
  RETURN true;
END;
$$;


--
-- Name: cancel_my_inspection_request(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_my_inspection_request(p_inspection_id uuid) RETURNS public.user_inspection_requests
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_user_id text; v_result public.user_inspection_requests;
BEGIN
  SELECT user_id INTO v_user_id FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  UPDATE public.user_inspection_requests SET status='cancelled',updated_at=now()
  WHERE id=p_inspection_id AND user_id=v_user_id AND status IN ('pending','scheduled')
  RETURNING * INTO v_result;
  IF v_result IS NULL THEN RAISE EXCEPTION 'Inspection request cannot be cancelled'; END IF;
  UPDATE public.reservations SET status='active',updated_at=now() WHERE id=v_result.reservation_id AND status='inspection_pending';
  RETURN v_result;
END;
$$;


--
-- Name: cancel_rent_plan(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_rent_plan(p_plan_id uuid, p_reason text DEFAULT NULL::text, p_reason_category text DEFAULT 'voluntary'::text) RETURNS TABLE(refund_amount numeric, fee_amount numeric, total_contributed numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE v_plan RECORD; v_fee_amount NUMERIC; v_refund_amount NUMERIC;
BEGIN
  SELECT * INTO v_plan FROM rent_plans WHERE id = p_plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rent plan not found'; END IF;
  IF v_plan.status = 'cancelled' THEN RAISE EXCEPTION 'Already cancelled'; END IF;
  IF p_reason_category = 'provider_failure' THEN v_fee_amount := 0; v_refund_amount := v_plan.total_contributed;
  ELSE v_fee_amount := ROUND(v_plan.total_contributed * v_plan.cancellation_fee_percent / 100, 2); v_refund_amount := v_plan.total_contributed - v_fee_amount; END IF;
  INSERT INTO rent_plan_cancellations (rent_plan_id, user_id, total_contributed, cancellation_fee_percent, cancellation_fee_amount, refund_amount, reason, reason_category)
  VALUES (p_plan_id, v_plan.user_id, v_plan.total_contributed, v_plan.cancellation_fee_percent, v_fee_amount, v_refund_amount, p_reason, p_reason_category);
  UPDATE rent_plans SET status = 'cancelled', total_paid_out = v_refund_amount, updated_at = NOW() WHERE id = p_plan_id;
  refund_amount := v_refund_amount; fee_amount := v_fee_amount; total_contributed := v_plan.total_contributed;
  RETURN NEXT;
END;
$$;


--
-- Name: complete_apartment_tenancy(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_apartment_tenancy(p_reservation_id text, p_next_status text DEFAULT 'maintenance'::text) RETURNS public.reservations
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_actor public.profiles;
  v_res public.reservations;
  v_listing public.listings;
  v_result public.reservations;
BEGIN
  IF p_next_status NOT IN ('maintenance','available','closed') THEN RAISE EXCEPTION 'Invalid next property status'; END IF;
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND role IN ('staff','admin','creator')
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Housing operations access required'; END IF;
  IF v_actor.role='staff' AND NOT public.current_staff_has_permission('operations') THEN RAISE EXCEPTION 'Operations permission required'; END IF;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE id=p_reservation_id AND status='occupied'
  FOR UPDATE;
  IF v_res IS NULL THEN RAISE EXCEPTION 'Occupied reservation not found'; END IF;
  IF COALESCE(v_res.stay_type,'long_stay')<>'long_stay' THEN
    RAISE EXCEPTION 'Short Stay checkout uses the Short Stay operations workflow';
  END IF;

  SELECT * INTO v_listing FROM public.listings WHERE id::text=v_res.listing_id FOR UPDATE;
  IF v_listing IS NULL OR v_listing.sub_type<>'long_stay' THEN RAISE EXCEPTION 'Long Stay listing not found'; END IF;
  IF v_actor.role<>'creator' AND NOT public.current_actor_in_scope(v_listing.state,v_listing.city) THEN
    RAISE EXCEPTION 'Listing is outside your assigned State/LGA';
  END IF;

  UPDATE public.reservations
  SET status='completed',completed_at=now(),processed_by=v_actor.user_id,processed_at=now(),updated_at=now()
  WHERE id=v_res.id
  RETURNING * INTO v_result;

  UPDATE public.listings
  SET status=p_next_status,availability_status=p_next_status,occupied_by=NULL,occupied_at=NULL,tenancy_ends_at=NULL,
      reserved_by=NULL,reservation_expiry=NULL,reservation_fee_paid=false,chat_unlocked=false,current_reservation_id=NULL,updated_at=now()
  WHERE id=v_listing.id;
  RETURN v_result;
END;
$$;


--
-- Name: complete_inspection_result(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_inspection_result(p_inspection_id uuid, p_result text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE v_actor public.profiles; v_req public.user_inspection_requests; v_res public.reservations;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role IN ('staff','admin','creator')
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Field operations access required'; END IF;
  IF p_result NOT IN ('passed','failed','customer_declined') THEN RAISE EXCEPTION 'Invalid inspection result'; END IF;
  SELECT * INTO v_req FROM public.user_inspection_requests WHERE id=p_inspection_id FOR UPDATE;
  IF v_req IS NULL THEN RAISE EXCEPTION 'Inspection not found'; END IF;
  IF v_actor.role='staff' THEN
    IF v_req.field_officer_id<>v_actor.user_id OR NOT public.current_staff_has_permission('field_officer') THEN RAISE EXCEPTION 'Inspection is not assigned to this Field Officer'; END IF;
  ELSIF v_actor.role='admin' AND NOT public.current_actor_can_access_listing_ref(v_req.listing_id) THEN
    RAISE EXCEPTION 'Inspection is outside your assigned branch';
  END IF;
  SELECT * INTO v_res FROM public.reservations WHERE id=v_req.reservation_id FOR UPDATE;
  UPDATE public.user_inspection_requests SET status='completed',condition=p_result,updated_at=now() WHERE id=p_inspection_id;
  UPDATE public.reservations SET inspection_result=p_result,inspection_completed=true,inspection_completed_at=now(),updated_at=now() WHERE id=v_req.reservation_id;
  IF p_result='passed' THEN
    UPDATE public.reservations SET status='ready_for_move_in',updated_at=now() WHERE id=v_req.reservation_id;
  ELSIF p_result='customer_declined' THEN
    UPDATE public.reservations SET status='cancelled',processed_at=now(),updated_at=now() WHERE id=v_req.reservation_id;
    UPDATE public.listings SET status='available',availability_status='available',reserved_by=NULL,reservation_expiry=NULL,
      reservation_fee_paid=false,chat_unlocked=false,current_reservation_id=NULL,updated_at=now()
    WHERE id::text=v_req.listing_id AND current_reservation_id=v_req.reservation_id;
  ELSE
    UPDATE public.reservations SET status='cancelled',refund_reason='provider_failure',processed_at=now(),updated_at=now() WHERE id=v_req.reservation_id;
    UPDATE public.listings SET status='maintenance',availability_status='maintenance',reserved_by=NULL,reservation_expiry=NULL,
      chat_unlocked=false,current_reservation_id=NULL,updated_at=now()
    WHERE id::text=v_req.listing_id AND current_reservation_id=v_req.reservation_id;
  END IF;
  RETURN true;
END;
$$;


--
-- Name: complete_my_worker_identity_check(text, numeric, numeric, numeric, jsonb, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_my_worker_identity_check(p_photo_path text, p_face_match_score numeric, p_liveness_score numeric, p_anti_spoof_score numeric, p_challenge_result jsonb, p_consent boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_actor public.profiles;
  v_existing public.worker_identity_checks;
  v_attempts integer;
  v_is_renewal boolean:=false;
  v_anchor_similarity numeric;
  v_recent_similarity numeric;
  v_best_similarity numeric;
begin
  select * into v_actor
  from public.profiles
  where auth_id=auth.uid()::text
    and role='worker'
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor is null then raise exception 'Active Worker account required'; end if;
  if coalesce(p_consent,false)=false then raise exception 'Private face-check consent is required'; end if;

  select * into v_existing from public.worker_identity_checks where worker_id=v_actor.user_id;
  v_is_renewal:=v_existing.worker_id is not null and nullif(btrim(coalesce(v_existing.enrollment_photo_path,'')),'') is not null;

  if nullif(btrim(coalesce(p_photo_path,'')),'') is null or p_photo_path not like v_actor.user_id||'/%' then
    raise exception 'Invalid private face reference path';
  end if;
  if not exists(select 1 from storage.objects where bucket_id='worker-identity-private' and name=p_photo_path) then
    raise exception 'Private identity reference was not found';
  end if;

  if p_face_match_score is null or p_face_match_score<0 or p_face_match_score>1
     or p_liveness_score is null or p_liveness_score<0 or p_liveness_score>1
     or p_anti_spoof_score is null or p_anti_spoof_score<0 or p_anti_spoof_score>1 then
    raise exception 'Invalid automatic face-check score';
  end if;

  if coalesce((p_challenge_result->>'automatic')::boolean,false)=false
     or coalesce((p_challenge_result->>'center_start')::boolean,false)=false
     or coalesce((p_challenge_result->>'side_one')::boolean,false)=false
     or coalesce((p_challenge_result->>'side_two')::boolean,false)=false
     or coalesce((p_challenge_result->>'center_end')::boolean,false)=false
     or coalesce((p_challenge_result->>'recorded_video')::boolean,true)=true then
    raise exception 'Automatic head-movement challenge is incomplete';
  end if;

  v_anchor_similarity := case
    when coalesce(p_challenge_result->>'anchor_similarity','') ~ '^(0([.][0-9]+)?|1([.]0+)?)$'
      then (p_challenge_result->>'anchor_similarity')::numeric
    else null
  end;
  v_recent_similarity := case
    when coalesce(p_challenge_result->>'recent_similarity','') ~ '^(0([.][0-9]+)?|1([.]0+)?)$'
      then (p_challenge_result->>'recent_similarity')::numeric
    else null
  end;
  v_best_similarity := greatest(coalesce(v_anchor_similarity,0),coalesce(v_recent_similarity,0),p_face_match_score);

  if v_is_renewal then
    if v_anchor_similarity is null then raise exception 'Original identity anchor score is required'; end if;
    if v_anchor_similarity < 0.50 then raise exception 'Your current face changed too much from the original Worker identity. WeHouse review is required'; end if;
    if greatest(v_anchor_similarity,coalesce(v_recent_similarity,0)) < 0.55 then raise exception 'Your live face did not match the trusted Worker references closely enough'; end if;
  elsif p_face_match_score < 0.55 then
    raise exception 'Live face did not match the enrolled Worker closely enough';
  end if;

  if p_liveness_score<0.50 then raise exception 'Automatic liveness check did not pass'; end if;
  if p_anti_spoof_score<0.50 then raise exception 'Automatic anti-spoof check did not pass'; end if;

  v_attempts:=coalesce(v_existing.attempt_count,0)+1;

  insert into public.worker_identity_checks(
    worker_id,status,enrollment_photo_path,latest_reference_photo_path,latest_reference_at,
    challenge_version,face_match_score,liveness_score,anti_spoof_score,challenge_result,
    consent_at,captured_at,attempt_count,updated_at
  ) values(
    v_actor.user_id,'passed',p_photo_path,p_photo_path,now(),
    'human-3.3.6-head-turn-v3-adaptive',v_best_similarity,p_liveness_score,p_anti_spoof_score,p_challenge_result,
    now(),now(),v_attempts,now()
  )
  on conflict(worker_id) do update set
    status='passed',
    enrollment_photo_path=coalesce(worker_identity_checks.enrollment_photo_path,excluded.enrollment_photo_path),
    latest_reference_photo_path=excluded.latest_reference_photo_path,
    latest_reference_at=excluded.latest_reference_at,
    challenge_version=excluded.challenge_version,
    face_match_score=excluded.face_match_score,
    liveness_score=excluded.liveness_score,
    anti_spoof_score=excluded.anti_spoof_score,
    challenge_result=excluded.challenge_result,
    consent_at=excluded.consent_at,
    captured_at=excluded.captured_at,
    attempt_count=v_attempts,
    updated_at=now();

  insert into public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
  values(
    case when v_is_renewal then 'WORKER_ADAPTIVE_IDENTITY_RECHECK_PASSED' else 'WORKER_AUTOMATIC_FACE_CHECK_PASSED' end,
    'profiles',v_actor.user_id,
    jsonb_build_object(
      'challenge_version','human-3.3.6-head-turn-v3-adaptive',
      'face_match_score',v_best_similarity,
      'anchor_similarity',v_anchor_similarity,
      'recent_similarity',v_recent_similarity,
      'liveness_score',p_liveness_score,
      'anti_spoof_score',p_anti_spoof_score,
      'adaptive_reference',v_is_renewal,
      'original_anchor_preserved',v_is_renewal,
      'liveness_video_recorded',false,
      'private_selfie',true
    )::text,
    v_actor.user_id,v_actor.email
  );

  return jsonb_build_object(
    'status','passed',
    'captured_at',now(),
    'attempt_count',v_attempts,
    'adaptive_reference',v_is_renewal,
    'anchor_preserved',v_is_renewal
  );
end; $_$;


--
-- Name: complete_short_stay(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_short_stay(p_reservation_id text, p_next_status text DEFAULT 'maintenance'::text) RETURNS public.reservations
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE v_actor public.profiles; v_res public.reservations; v_listing public.listings; v_result public.reservations;
BEGIN
  IF p_next_status NOT IN ('maintenance','available','closed') THEN RAISE EXCEPTION 'Invalid next property status'; END IF;
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role IN ('staff','admin','creator')
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Housing operations access required'; END IF;
  IF v_actor.role='staff' AND NOT public.current_staff_has_permission('operations') THEN RAISE EXCEPTION 'Operations permission required'; END IF;
  SELECT * INTO v_res FROM public.reservations WHERE id=p_reservation_id AND stay_type='short_let' AND status='occupied' FOR UPDATE;
  IF v_res IS NULL THEN RAISE EXCEPTION 'Active Short Stay not found'; END IF;
  SELECT * INTO v_listing FROM public.listings WHERE id::text=v_res.listing_id FOR UPDATE;
  IF v_actor.role<>'creator' AND NOT public.current_actor_in_scope(v_listing.state,v_listing.city) THEN RAISE EXCEPTION 'Listing is outside your assigned State/LGA'; END IF;
  UPDATE public.reservations
  SET status='completed',completed_at=now(),processed_by=v_actor.user_id,processed_at=now(),
      security_deposit_status=CASE WHEN COALESCE(security_deposit_snapshot,0)>0 THEN 'refund_due' ELSE 'not_required' END,updated_at=now()
  WHERE id=v_res.id RETURNING * INTO v_result;
  UPDATE public.listings
  SET status=p_next_status,availability_status=p_next_status,occupied_by=NULL,occupied_at=NULL,tenancy_ends_at=NULL,
      reserved_by=NULL,reservation_expiry=NULL,reservation_fee_paid=false,chat_unlocked=false,current_reservation_id=NULL,updated_at=now()
  WHERE id=v_listing.id;
  RETURN v_result;
END;
$$;


--
-- Name: confirm_booking_payment(text, text, numeric, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.confirm_booking_payment(p_reference text, p_transaction_id text DEFAULT NULL::text, p_verified_amount numeric DEFAULT NULL::numeric, p_verification_source text DEFAULT 'webhook'::text, p_purpose text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
                                                                                                                                                                                                                                                                                              DECLARE
                                                                                                                                                                                                                                                                                                v_payment RECORD;
                                                                                                                                                                                                                                                                                                  v_updated INTEGER;
                                                                                                                                                                                                                                                                                                    v_payment_user_id TEXT;
                                                                                                                                                                                                                                                                                                    BEGIN
                                                                                                                                                                                                                                                                                                      IF auth.uid() IS NOT NULL THEN
                                                                                                                                                                                                                                                                                                          RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
                                                                                                                                                                                                                                                                                                            END IF;

                                                                                                                                                                                                                                                                                                              IF p_verified_amount IS NULL THEN
                                                                                                                                                                                                                                                                                                                  RETURN jsonb_build_object('success', false, 'error', 'Verified amount required');
                                                                                                                                                                                                                                                                                                                    END IF;

                                                                                                                                                                                                                                                                                                                      SELECT * INTO v_payment FROM booking_payments
                                                                                                                                                                                                                                                                                                                        WHERE paystack_reference = p_reference
                                                                                                                                                                                                                                                                                                                          FOR UPDATE SKIP LOCKED;

                                                                                                                                                                                                                                                                                                                            IF v_payment IS NULL THEN
                                                                                                                                                                                                                                                                                                                                RETURN jsonb_build_object('success', false, 'error', 'Payment not found');
                                                                                                                                                                                                                                                                                                                                  END IF;

                                                                                                                                                                                                                                                                                                                                    IF EXISTS (SELECT 1 FROM verified_paystack_references WHERE paystack_reference = p_reference) THEN
                                                                                                                                                                                                                                                                                                                                        RETURN jsonb_build_object('success', true, 'already_processed', true);
                                                                                                                                                                                                                                                                                                                                          END IF;

                                                                                                                                                                                                                                                                                                                                            IF v_payment.status IN ('paid', 'completed') THEN
                                                                                                                                                                                                                                                                                                                                                RETURN jsonb_build_object('success', true, 'already_processed', true);
                                                                                                                                                                                                                                                                                                                                                  END IF;

                                                                                                                                                                                                                                                                                                                                                    IF COALESCE(v_payment.amount_total, v_payment.amount, 0) > 0
                                                                                                                                                                                                                                                                                                                                                         AND ABS(p_verified_amount - COALESCE(v_payment.amount_total, v_payment.amount)) > 1 THEN
                                                                                                                                                                                                                                                                                                                                                             RETURN jsonb_build_object('success', false, 'error', 'Amount mismatch',
                                                                                                                                                                                                                                                                                                                                                                   'expected', COALESCE(v_payment.amount_total, v_payment.amount),
                                                                                                                                                                                                                                                                                                                                                                         'verified', p_verified_amount);
                                                                                                                                                                                                                                                                                                                                                                           END IF;

                                                                                                                                                                                                                                                                                                                                                                             IF p_purpose IS NOT NULL AND v_payment.purpose IS NOT NULL AND p_purpose != v_payment.purpose THEN
                                                                                                                                                                                                                                                                                                                                                                                 RETURN jsonb_build_object('success', false, 'error', 'Purpose mismatch');
                                                                                                                                                                                                                                                                                                                                                                                   END IF;

                                                                                                                                                                                                                                                                                                                                                                                     v_payment_user_id := v_payment.user_id;

                                                                                                                                                                                                                                                                                                                                                                                       UPDATE booking_payments SET
                                                                                                                                                                                                                                                                                                                                                                                           status = 'paid',
                                                                                                                                                                                                                                                                                                                                                                                               paystack_transaction_id = COALESCE(p_transaction_id, paystack_transaction_id),
                                                                                                                                                                                                                                                                                                                                                                                                   verified_amount = p_verified_amount,
                                                                                                                                                                                                                                                                                                                                                                                                       verified_at = NOW(),
                                                                                                                                                                                                                                                                                                                                                                                                           verification_source = p_verification_source,
                                                                                                                                                                                                                                                                                                                                                                                                               paid_at = NOW(),
                                                                                                                                                                                                                                                                                                                                                                                                                   webhook_processed = TRUE,
                                                                                                                                                                                                                                                                                                                                                                                                                       updated_at = NOW()
                                                                                                                                                                                                                                                                                                                                                                                                                         WHERE id = v_payment.id;

                                                                                                                                                                                                                                                                                                                                                                                                                           INSERT INTO verified_paystack_references (
                                                                                                                                                                                                                                                                                                                                                                                                                               paystack_reference, booking_payment_id, verified_amount,
                                                                                                                                                                                                                                                                                                                                                                                                                                   verification_source, verified_by
                                                                                                                                                                                                                                                                                                                                                                                                                                     ) VALUES (p_reference, v_payment.id, p_verified_amount, p_verification_source, 'paystack-verify')
                                                                                                                                                                                                                                                                                                                                                                                                                                       ON CONFLICT (paystack_reference) DO NOTHING;

                                                                                                                                                                                                                                                                                                                                                                                                                                         IF v_payment.amount_commission IS NOT NULL AND v_payment.amount_commission > 0 THEN
                                                                                                                                                                                                                                                                                                                                                                                                                                             INSERT INTO commission_ledger (
                                                                                                                                                                                                                                                                                                                                                                                                                                                   payment_id, booking_type, source_user_id,
                                                                                                                                                                                                                                                                                                                                                                                                                                                         commission_amount, commission_rate, gross_amount,
                                                                                                                                                                                                                                                                                                                                                                                                                                                               description, paystack_reference
                                                                                                                                                                                                                                                                                                                                                                                                                                                                   ) VALUES (
                                                                                                                                                                                                                                                                                                                                                                                                                                                                         v_payment.id,
                                                                                                                                                                                                                                                                                                                                                                                                                                                                               COALESCE(v_payment.booking_type, v_payment.type, 'unknown'),
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     COALESCE(v_payment.payee_user_id, v_payment.user_id),
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           v_payment.amount_commission,
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 COALESCE(v_payment.commission_rate, 0),
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       COALESCE(v_payment.amount_total, v_payment.amount, 0),
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             format('Commission from %s (N%s)',
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     COALESCE(v_payment.booking_type, v_payment.type, 'unknown'),
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             COALESCE(v_payment.amount_total, v_payment.amount, 0)::text),
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   p_reference
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       );
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         END IF;

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           IF v_payment.purpose = 'worker_verification' THEN
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               UPDATE profiles SET
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     worker_status = 'approved_for_verification',
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           updated_at = NOW()
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               WHERE user_id = v_payment_user_id
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     AND worker_status = 'pending';

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         GET DIAGNOSTICS v_updated = ROW_COUNT;

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             IF v_updated = 0 THEN
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   UPDATE profiles SET
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           worker_status = 'approved_for_verification',
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   updated_at = NOW()
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         WHERE user_id = v_payment_user_id
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 AND worker_status = 'rejected';

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       GET DIAGNOSTICS v_updated = ROW_COUNT;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           END IF;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             END IF;

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               INSERT INTO financial_audit_logs (
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   event_type, user_id, amount, reference_id, reference_type, description
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     ) VALUES (
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         CASE WHEN v_payment.purpose = 'worker_verification'
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  THEN 'worker_verification_payment'
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           ELSE 'customer_payment' END,
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               v_payment_user_id,
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   p_verified_amount,
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       v_payment.id::text,
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           'booking_payment',
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               format('Payment confirmed via %s: %s', p_verification_source, p_reference)
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 );

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   RETURN jsonb_build_object('success', true, 'payment_id', v_payment.id);
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   END;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   $$;


--
-- Name: confirm_worker_booking_payment(uuid, text, numeric, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.confirm_worker_booking_payment(p_booking_id uuid, p_paystack_reference text, p_amount_verified numeric, p_currency text DEFAULT 'NGN'::text, p_transaction_id text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE b public.worker_bookings; pay public.booking_payments; w public.profiles; rate numeric; commission numeric; receives numeric;
BEGIN
  IF NULLIF(trim(p_paystack_reference),'') IS NULL THEN RETURN jsonb_build_object('success',false,'error','Paystack reference is required'); END IF;
  IF p_amount_verified IS NULL OR p_amount_verified<=0 THEN RETURN jsonb_build_object('success',false,'error','Verified amount must be positive'); END IF;
  IF p_currency<>'NGN' THEN RETURN jsonb_build_object('success',false,'error','Only NGN currency is supported'); END IF;
  SELECT * INTO pay FROM public.booking_payments WHERE paystack_reference=p_paystack_reference FOR UPDATE;
  IF pay IS NULL OR pay.purpose IS DISTINCT FROM 'worker_booking' OR pay.worker_booking_id IS NULL OR pay.worker_booking_id<>p_booking_id THEN RETURN jsonb_build_object('success',false,'error','Payment record mismatch'); END IF;
  IF EXISTS(SELECT 1 FROM public.verified_paystack_references WHERE paystack_reference=p_paystack_reference) OR pay.status IN ('paid','completed') THEN RETURN jsonb_build_object('success',true,'already_processed',true); END IF;
  SELECT * INTO b FROM public.worker_bookings WHERE id=p_booking_id FOR UPDATE;
  IF b IS NULL OR b.status<>'waiting_payment' THEN RETURN jsonb_build_object('success',false,'error','Booking is not awaiting payment'); END IF;
  SELECT * INTO w FROM public.profiles WHERE user_id=b.worker_id AND role='worker';
  IF w IS NULL OR w.worker_status<>'verified' OR w.worker_verified IS DISTINCT FROM true OR COALESCE(w.deleted,false) OR COALESCE(w.suspended,false) OR COALESCE(w.banned,false) THEN RETURN jsonb_build_object('success',false,'error','Worker is no longer eligible for payment'); END IF;
  IF pay.payer_user_id<>b.user_id THEN RETURN jsonb_build_object('success',false,'error','Payment payer does not match booking customer'); END IF;
  IF round(COALESCE(pay.amount_total,pay.amount,0)::numeric,2)<>round(p_amount_verified,2) OR round(COALESCE(b.negotiated_amount,b.agreed_amount,0)::numeric,2)<>round(p_amount_verified,2) THEN RETURN jsonb_build_object('success',false,'error','Amount mismatch'); END IF;
  SELECT NULLIF(trim(value),'')::numeric INTO rate FROM public.platform_settings WHERE key='worker_commission_rate' AND is_active=true;
  IF rate IS NULL OR rate<0 OR rate>50 THEN RETURN jsonb_build_object('success',false,'error','Invalid commission rate'); END IF;
  commission:=round((p_amount_verified*rate/100)::numeric,2); receives:=round(p_amount_verified,2)-commission;
  IF EXISTS(SELECT 1 FROM public.escrow_transactions WHERE booking_id=p_booking_id AND booking_type='worker_booking') THEN RETURN jsonb_build_object('success',false,'error','Escrow already exists for this booking'); END IF;
  UPDATE public.worker_bookings SET status='confirmed',paystack_reference=p_paystack_reference,paystack_transaction_id=p_transaction_id,agreed_amount=round(p_amount_verified,2),wehouse_fee=commission,worker_commission=commission,worker_receives=receives,updated_at=now() WHERE id=p_booking_id;
  INSERT INTO public.escrow_transactions(booking_id,booking_type,payer_user_id,payee_user_id,amount_total,amount_commission,amount_payee,commission_rate,status,paystack_reference,created_at,updated_at)
  VALUES(p_booking_id,'worker_booking',b.user_id,b.worker_id,round(p_amount_verified,2),commission,receives,rate,'held',p_paystack_reference,now(),now());
  UPDATE public.booking_payments SET status='paid',paystack_transaction_id=COALESCE(p_transaction_id,paystack_transaction_id),verified_amount=round(p_amount_verified,2),verified_at=now(),verification_source='edge_function',paid_at=now(),webhook_processed=true,updated_at=now() WHERE id=pay.id;
  INSERT INTO public.verified_paystack_references(paystack_reference,booking_payment_id,verified_amount,verification_source,verified_by)
  VALUES(p_paystack_reference,pay.id,round(p_amount_verified,2),'edge_function','paystack-verify') ON CONFLICT(paystack_reference) DO NOTHING;
  RETURN jsonb_build_object('success',true,'commission_rate',rate,'commission_amount',commission,'worker_receives',receives);
END $$;


--
-- Name: create_apartment_rent_payment(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_apartment_rent_payment(p_reservation_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_user_id text; v_res public.reservations; v_listing public.listings; v_reference text; v_pending public.booking_payments;
  v_annual numeric; v_total numeric; v_upfront numeric; v_balance numeric; v_count integer; v_years integer;
BEGIN
  SELECT user_id INTO v_user_id FROM public.profiles
  WHERE auth_id=auth.uid()::text AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_res FROM public.reservations WHERE id=p_reservation_id AND user_id=v_user_id FOR UPDATE;
  IF v_res.id IS NULL THEN RAISE EXCEPTION 'Reservation not found'; END IF;
  IF v_res.status='inspection_pending' THEN RAISE EXCEPTION 'Complete the requested inspection before paying Long Stay rent'; END IF;
  IF v_res.status NOT IN ('reserved','ready_for_move_in') THEN RAISE EXCEPTION 'Reservation is not ready for Long Stay rent payment'; END IF;
  IF v_res.manual_payment_status NOT IN ('paid','completed') OR v_res.paid_at IS NULL THEN RAISE EXCEPTION 'Reservation fee must be confirmed first'; END IF;
  IF v_res.rent_payment_status IN ('paid','upfront_paid') THEN RETURN jsonb_build_object('success',true,'already_paid',true,'status',v_res.rent_payment_status); END IF;
  SELECT * INTO v_listing FROM public.listings WHERE id::text=v_res.listing_id FOR SHARE;
  IF v_listing.id IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF;
  IF v_listing.sub_type<>'long_stay' THEN RAISE EXCEPTION 'Short Stay uses a date-based stay payment workflow'; END IF;

  v_years:=COALESCE(v_res.rental_plan_years,1);
  IF v_years<1 OR v_years>5 THEN RAISE EXCEPTION 'Reservation tenure must be between 1 and 5 years'; END IF;
  v_annual:=round(COALESCE(v_res.annual_rent_snapshot,v_listing.price),2);
  IF v_annual<=0 THEN RAISE EXCEPTION 'Required Year 1 rent is invalid'; END IF;
  v_total:=round(v_annual*v_years,2); v_upfront:=v_annual; v_balance:=round(v_annual*GREATEST(v_years-1,0),2); v_count:=8*GREATEST(v_years-1,0);

  SELECT * INTO v_pending FROM public.booking_payments
  WHERE user_id=v_user_id AND purpose='apartment_rent' AND status='pending' AND metadata->>'reservation_id'=v_res.id
    AND round(COALESCE(amount_total,amount),2)=round(v_upfront,2)
  ORDER BY created_at DESC LIMIT 1;
  IF v_pending.id IS NOT NULL THEN
    UPDATE public.reservations SET rent_payment_status='payment_pending',rent_payment_reference=v_pending.paystack_reference,updated_at=now() WHERE id=v_res.id;
    RETURN jsonb_build_object('success',true,'reference',v_pending.paystack_reference,'amount',COALESCE(v_pending.amount_total,v_pending.amount),'existing',true);
  END IF;

  v_reference:='WHRENT-'||upper(replace(gen_random_uuid()::text,'-',''));
  INSERT INTO public.booking_payments(payment_reference,user_id,payer_user_id,type,booking_type,listing_id,amount,amount_total,currency,status,purpose,payment_method,paystack_reference,metadata,created_at,updated_at)
  VALUES(v_reference,v_user_id,v_user_id,'apartment','apartment',v_listing.id::text,v_upfront,v_upfront,'NGN','pending','apartment_rent','paystack',v_reference,
    jsonb_build_object('reservation_id',v_res.id,'listing_id',v_listing.id::text,'tenure_years',v_years,'total_contract_rent',v_total,'year_one_upfront',v_upfront,'future_rent_balance',v_balance,'contribution_count',v_count,'contribution_months_per_year',8,'start_after_months',4,'payment_component','long_stay_rent','security_deposit_amount',0,'eligible_partner_amount',v_upfront),now(),now());
  UPDATE public.reservations
  SET stay_type='long_stay',annual_rent_snapshot=v_annual,contract_rent_total=v_total,upfront_rent_required=v_upfront,installment_balance=v_balance,installment_count=v_count,
      rent_payment_status='payment_pending',rent_payment_reference=v_reference,updated_at=now()
  WHERE id=v_res.id;
  RETURN jsonb_build_object('success',true,'reference',v_reference,'amount',v_upfront,'existing',false);
END;
$$;


--
-- Name: create_apartment_reservation(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_apartment_reservation(p_listing_id text) RETURNS public.reservations
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_profile public.profiles;
  v_listing public.listings;
  v_existing public.reservations;
  v_created public.reservations;
  v_fee numeric;
  v_checkout_minutes integer;
  v_checkout_expires timestamptz;
  v_reference text;
BEGIN
  SELECT * INTO v_profile FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF v_profile.role NOT IN ('user','worker','property_partner') THEN RAISE EXCEPTION 'This account cannot create customer reservations'; END IF;

  SELECT * INTO v_listing FROM public.listings
  WHERE (id::text=p_listing_id OR listing_id=p_listing_id) AND deleted_at IS NULL
  LIMIT 1 FOR UPDATE;
  IF v_listing IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF;
  IF COALESCE(v_listing.sub_type,'')<>'long_stay' THEN
    RAISE EXCEPTION 'Short Stay requires check-in and check-out dates';
  END IF;

  SELECT * INTO v_existing FROM public.reservations
  WHERE listing_id=v_listing.id::text AND user_id=v_profile.user_id
    AND status = ANY (ARRAY['payment_pending','reserved','inspection_pending','ready_for_move_in','occupied']::text[])
  ORDER BY created_at DESC LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  IF v_listing.status<>'available' OR v_listing.availability_status<>'available' THEN RAISE EXCEPTION 'Listing is not available'; END IF;

  SELECT NULLIF(value,'')::numeric INTO v_fee FROM public.platform_settings WHERE key='reservation_fee' AND COALESCE(is_active,true)=true LIMIT 1;
  IF v_fee IS NULL OR v_fee<=0 THEN RAISE EXCEPTION 'Reservation fee is not configured'; END IF;
  SELECT NULLIF(value,'')::integer INTO v_checkout_minutes FROM public.platform_settings WHERE key='apartment_payment_hold_minutes' AND COALESCE(is_active,true)=true LIMIT 1;
  IF v_checkout_minutes IS NULL OR v_checkout_minutes<5 OR v_checkout_minutes>120 THEN v_checkout_minutes:=30; END IF;
  v_checkout_expires:=now()+make_interval(mins=>v_checkout_minutes);
  v_reference:='WHAPT-'||upper(replace(gen_random_uuid()::text,'-',''));

  INSERT INTO public.reservations(
    listing_id,user_id,user_email,user_phone,listing_title,listing_price,listing_location,
    status,manual_payment_status,payment_reference,amount,currency,reservation_type,stay_type,
    payment_expires_at,hold_expires_at,created_at,updated_at
  ) VALUES (
    v_listing.id::text,v_profile.user_id,v_profile.email,v_profile.phone,v_listing.title,v_listing.price,
    concat_ws(', ',v_listing.city,v_listing.state),'payment_pending','unpaid',v_reference,v_fee,'NGN','apartment','long_stay',
    v_checkout_expires,NULL,now(),now()
  ) RETURNING * INTO v_created;

  INSERT INTO public.booking_payments(
    payment_reference,user_id,payer_user_id,type,booking_type,listing_id,amount,amount_total,currency,status,purpose,payment_method,paystack_reference,metadata,created_at,updated_at
  ) VALUES (
    v_reference,v_profile.user_id,v_profile.user_id,'apartment','apartment',v_listing.id::text,v_fee,v_fee,'NGN','pending',
    'apartment_reservation','paystack',v_reference,jsonb_build_object('reservation_id',v_created.id,'listing_id',v_listing.id::text,'stay_type','long_stay','source','create_apartment_reservation'),now(),now()
  );

  UPDATE public.listings
  SET status='reserved',availability_status='reserved',reserved_by=v_profile.user_id,reservation_expiry=v_checkout_expires,
      reservation_fee_paid=false,chat_unlocked=false,current_reservation_id=v_created.id,updated_at=now()
  WHERE id=v_listing.id;
  RETURN v_created;
END;
$$;


--
-- Name: create_booking_request(text, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_booking_request(p_worker_id text, p_service_type text, p_description text, p_address text, p_scheduled_date text, p_customer_message text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_customer public.profiles;v_worker public.profiles;v_booking_id uuid;v_conv_id uuid;v_code text;v_date date;v_service text:=trim(coalesce(p_service_type,''));v_service_ok boolean:=false;v_has_specific_services boolean:=false;
begin
  select * into v_customer from public.profiles where auth_id=auth.uid()::text limit 1;
  if v_customer is null or v_customer.role<>'user' then raise exception 'Regular user account required'; end if;
  if coalesce(v_customer.deleted,false) or coalesce(v_customer.suspended,false) or coalesce(v_customer.banned,false) then raise exception 'Customer account is not active'; end if;
  if v_service='' then raise exception 'Choose a service'; end if;
  if nullif(trim(coalesce(p_description,'')),'') is null then raise exception 'Describe the work you need'; end if;
  if nullif(trim(coalesce(p_address,'')),'') is null then raise exception 'Job location is required'; end if;
  if nullif(trim(coalesce(p_scheduled_date,'')),'') is not null then v_date:=p_scheduled_date::date; if v_date<current_date then raise exception 'Schedule date cannot be in the past'; end if; end if;
  select * into v_worker from public.profiles where user_id=p_worker_id and role='worker' limit 1;
  if v_worker is null then raise exception 'Worker not found'; end if;
  if v_worker.worker_status<>'verified' or v_worker.worker_verified is distinct from true then raise exception 'Worker is not verified'; end if;
  if not public.worker_identity_is_current(v_worker.user_id) then raise exception 'This Worker is temporarily unavailable while identity is re-checked'; end if;
  if v_worker.available is distinct from true then raise exception 'Worker is not accepting new bookings'; end if;
  if coalesce(v_worker.deleted,false) or coalesce(v_worker.suspended,false) or coalesce(v_worker.banned,false) then raise exception 'Worker account is not active'; end if;
  if v_customer.user_id=p_worker_id then raise exception 'Cannot book yourself'; end if;
  v_has_specific_services:=exists(select 1 from public.worker_services ws where ws.worker_id=v_worker.user_id) or (jsonb_typeof(v_worker.worker_skills)='array' and jsonb_array_length(v_worker.worker_skills)>0);
  v_service_ok:=exists(select 1 from public.worker_services ws where ws.worker_id=v_worker.user_id and lower(trim(ws.service_name))=lower(v_service)) or exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(v_worker.worker_skills)='array' then v_worker.worker_skills else '[]'::jsonb end) skill(value) where lower(trim(skill.value))=lower(v_service)) or (not v_has_specific_services and lower(trim(coalesce(v_worker.worker_occupation,'')))=lower(v_service));
  if not v_service_ok then raise exception 'This Worker does not offer the selected service'; end if;
  v_code:='WH-'||upper(substring(md5(gen_random_uuid()::text) from 1 for 8));
  insert into public.worker_bookings(booking_code,user_id,worker_id,service_type,description,address,scheduled_date,agreed_amount,wehouse_fee,worker_commission,worker_receives,status,customer_message,created_at,updated_at)
  values(v_code,v_customer.user_id,v_worker.user_id,v_service,trim(p_description),trim(p_address),v_date,0,0,0,0,'booking_requested',nullif(trim(coalesce(p_customer_message,'')),''),now(),now()) returning id into v_booking_id;
  insert into public.booking_conversations(booking_id,user_id,worker_id,status,created_at,updated_at) values(v_booking_id,v_customer.user_id,v_worker.user_id,'active',now(),now()) returning id into v_conv_id;
  update public.worker_bookings set booking_conversation_id=v_conv_id where id=v_booking_id;
  if nullif(trim(coalesce(p_customer_message,'')),'') is not null then insert into public.booking_messages(conversation_id,sender_id,content,created_at) values(v_conv_id,v_customer.user_id,trim(p_customer_message),now()); end if;
  return jsonb_build_object('booking_id',v_booking_id,'conversation_id',v_conv_id,'booking_code',v_code);
end;
$$;


--
-- Name: create_hotel_booking_payment(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_hotel_booking_payment(p_booking_id integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_user_id text;
  v_booking public.hotel_bookings;
  v_hotel public.hotels;
  v_reference text;
  v_pending public.booking_payments;
BEGIN
  SELECT user_id INTO v_user_id
  FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role='user'
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Active User account required'; END IF;

  SELECT * INTO v_booking
  FROM public.hotel_bookings
  WHERE booking_id=p_booking_id AND user_id=v_user_id
  FOR UPDATE;
  IF v_booking.booking_id IS NULL THEN RAISE EXCEPTION 'Hotel booking not found'; END IF;
  IF v_booking.status='confirmed' AND v_booking.payment_status='paid' THEN
    RETURN jsonb_build_object('success',true,'already_paid',true,'booking_code',v_booking.booking_code);
  END IF;
  IF v_booking.status<>'pending' THEN RAISE EXCEPTION 'Hotel booking is no longer awaiting payment'; END IF;
  IF v_booking.payment_expires_at IS NULL OR v_booking.payment_expires_at<=now() THEN
    UPDATE public.hotel_bookings SET status='expired',payment_status='expired',updated_at=now() WHERE booking_id=v_booking.booking_id;
    RAISE EXCEPTION 'Hotel checkout hold has expired. Choose the room again.';
  END IF;
  IF COALESCE(v_booking.total_price,0)<=0 THEN RAISE EXCEPTION 'Hotel booking amount is invalid'; END IF;

  SELECT * INTO v_hotel FROM public.hotels WHERE hotel_id=v_booking.hotel_id;
  IF v_hotel.hotel_id IS NULL THEN RAISE EXCEPTION 'Hotel not found'; END IF;

  SELECT * INTO v_pending
  FROM public.booking_payments
  WHERE user_id=v_user_id AND purpose='hotel_booking' AND hotel_booking_id=v_booking.booking_id AND status='pending'
    AND round(COALESCE(amount_total,amount),2)=round(v_booking.total_price,2)
  ORDER BY created_at DESC LIMIT 1;
  IF v_pending.id IS NOT NULL THEN
    UPDATE public.hotel_bookings SET payment_status='payment_pending',payment_reference=v_pending.paystack_reference,updated_at=now() WHERE booking_id=v_booking.booking_id;
    RETURN jsonb_build_object('success',true,'reference',v_pending.paystack_reference,'amount',COALESCE(v_pending.amount_total,v_pending.amount),'existing',true,'booking_code',v_booking.booking_code);
  END IF;

  v_reference:='WHHOTEL-'||upper(replace(gen_random_uuid()::text,'-',''));
  INSERT INTO public.booking_payments(
    payment_reference,user_id,payer_user_id,type,booking_type,hotel_booking_id,amount,amount_total,currency,status,
    purpose,payment_method,paystack_reference,metadata,created_at,updated_at
  ) VALUES (
    v_reference,v_user_id,v_user_id,'hotel','hotel',v_booking.booking_id,v_booking.total_price,v_booking.total_price,'NGN','pending',
    'hotel_booking','paystack',v_reference,
    jsonb_build_object(
      'hotel_booking_id',v_booking.booking_id,
      'hotel_id',v_booking.hotel_id,
      'room_id',v_booking.room_id,
      'booking_code',v_booking.booking_code,
      'check_in',v_booking.check_in,
      'check_out',v_booking.check_out,
      'eligible_partner_amount',v_booking.total_price
    ),now(),now()
  );
  UPDATE public.hotel_bookings
  SET payment_status='payment_pending',payment_reference=v_reference,updated_at=now()
  WHERE booking_id=v_booking.booking_id;
  RETURN jsonb_build_object('success',true,'reference',v_reference,'amount',v_booking.total_price,'existing',false,'booking_code',v_booking.booking_code);
END;
$$;


--
-- Name: create_internal_listing(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_internal_listing(p_data jsonb) RETURNS public.listings
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$ DECLARE v_actor public.profiles; v_initial_status text; v_listing public.listings; BEGIN SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role IN ('property_partner','staff','admin','creator') AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1; IF v_actor IS NULL THEN RAISE EXCEPTION 'Listing submission is not allowed for this account'; END IF; IF NULLIF(BTRIM(p_data->>'title'),'') IS NULL THEN RAISE EXCEPTION 'Listing title is required'; END IF; IF COALESCE((p_data->>'price')::numeric,0)<=0 THEN RAISE EXCEPTION 'Listing price must be greater than zero'; END IF; IF NULLIF(BTRIM(p_data->>'state'),'') IS NULL OR NULLIF(BTRIM(p_data->>'city'),'') IS NULL THEN RAISE EXCEPTION 'Listing State and LGA are required'; END IF; IF v_actor.role IN ('admin','staff') AND NOT public.current_actor_in_scope(p_data->>'state',p_data->>'city') THEN RAISE EXCEPTION 'Listing is outside your assigned branch'; END IF; v_initial_status:=CASE WHEN v_actor.role='creator' THEN 'available' ELSE 'pending_approval' END; INSERT INTO public.listings(listing_id,title,description,price,currency,state,city,address,images,videos,property_type,sub_type,bedrooms,bathrooms,status,availability_status,owner_id,partner_id,chat_agent_id,submitted_by_role,reserved_by,reservation_expiry,reservation_fee_paid,chat_unlocked,security_deposit_amount,contact_phone,amenities) VALUES(gen_random_uuid()::text,BTRIM(p_data->>'title'),NULLIF(BTRIM(p_data->>'description'),''),(p_data->>'price')::numeric,COALESCE(NULLIF(BTRIM(p_data->>'currency'),''),'NGN'),BTRIM(p_data->>'state'),BTRIM(p_data->>'city'),NULLIF(BTRIM(p_data->>'address'),''),COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_data->'images','[]'::jsonb))),ARRAY[]::text[]),COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_data->'videos','[]'::jsonb))),ARRAY[]::text[]),NULLIF(BTRIM(p_data->>'property_type'),''),NULLIF(BTRIM(p_data->>'sub_type'),''),COALESCE((p_data->>'bedrooms')::int,1),COALESCE((p_data->>'bathrooms')::int,1),v_initial_status,v_initial_status,v_actor.user_id,NULL,CASE WHEN v_actor.role='staff' THEN v_actor.user_id ELSE NULL END,v_actor.role,NULL,NULL,false,false,NULLIF(p_data->>'security_deposit_amount','')::numeric,NULLIF(BTRIM(p_data->>'contact_phone'),''),COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_data->'amenities','[]'::jsonb))),ARRAY[]::text[])) RETURNING * INTO v_listing; RETURN v_listing; END; $$;


--
-- Name: hotel_bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hotel_bookings (
    booking_id integer NOT NULL,
    hotel_id integer NOT NULL,
    room_id integer NOT NULL,
    user_id text NOT NULL,
    check_in date NOT NULL,
    check_out date NOT NULL,
    guest_count integer DEFAULT 1,
    total_nights integer NOT NULL,
    total_price integer NOT NULL,
    status text DEFAULT 'pending'::text,
    guest_name text,
    guest_phone text,
    special_requests text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    booking_code text NOT NULL,
    payment_status text DEFAULT 'unpaid'::text NOT NULL,
    payment_reference text,
    payment_expires_at timestamp with time zone,
    paid_at timestamp with time zone,
    confirmed_at timestamp with time zone,
    CONSTRAINT hotel_bookings_payment_status_check CHECK ((payment_status = ANY (ARRAY['unpaid'::text, 'payment_pending'::text, 'paid'::text, 'refunded'::text, 'failed'::text, 'expired'::text]))),
    CONSTRAINT hotel_bookings_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'checked_in'::text, 'checked_out'::text, 'cancelled'::text, 'completed'::text, 'refunded'::text, 'expired'::text, 'payment_conflict'::text])))
);


--
-- Name: create_my_hotel_booking(integer, integer, date, date, integer, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_my_hotel_booking(p_hotel_id integer, p_room_id integer, p_check_in date, p_check_out date, p_guest_count integer, p_guest_name text, p_guest_phone text, p_special_requests text DEFAULT NULL::text) RETURNS public.hotel_bookings
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_actor public.profiles;
  v_hotel public.hotels;
  v_room public.hotel_rooms;
  v_nights integer;
  v_reserved integer;
  v_result public.hotel_bookings;
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role='user'
    AND NOT COALESCE(deleted,false) AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false)
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Active User account required'; END IF;
  IF p_check_in IS NULL OR p_check_out IS NULL OR p_check_in<=CURRENT_DATE OR p_check_out<=p_check_in THEN RAISE EXCEPTION 'Choose valid future check-in and check-out dates'; END IF;
  IF COALESCE(p_guest_count,0)<1 THEN RAISE EXCEPTION 'At least one guest is required'; END IF;
  IF NULLIF(btrim(p_guest_name),'') IS NULL OR NULLIF(btrim(p_guest_phone),'') IS NULL THEN RAISE EXCEPTION 'Guest name and phone are required'; END IF;

  SELECT * INTO v_hotel FROM public.hotels
  WHERE hotel_id=p_hotel_id AND status='active' AND approved_at IS NOT NULL AND published_at IS NOT NULL;
  IF v_hotel IS NULL THEN RAISE EXCEPTION 'Hotel is not available for booking'; END IF;

  SELECT * INTO v_room FROM public.hotel_rooms WHERE room_id=p_room_id AND hotel_id=p_hotel_id FOR UPDATE;
  IF v_room IS NULL THEN RAISE EXCEPTION 'Room type not found for this hotel'; END IF;
  IF p_guest_count>COALESCE(v_room.max_guests,2) THEN RAISE EXCEPTION 'Guest count exceeds this room type capacity'; END IF;
  IF COALESCE(v_room.total_rooms,0)<1 OR COALESCE(v_room.price_per_night,0)<=0 THEN RAISE EXCEPTION 'Room type is not available for booking'; END IF;

  SELECT count(*)::integer INTO v_reserved
  FROM public.hotel_bookings hb
  WHERE hb.room_id=p_room_id
    AND hb.check_in<p_check_out AND hb.check_out>p_check_in
    AND (
      hb.status IN ('confirmed','checked_in')
      OR (hb.status='pending' AND COALESCE(hb.payment_expires_at,hb.created_at+interval '30 minutes')>now())
    );
  IF v_reserved>=v_room.total_rooms THEN RAISE EXCEPTION 'This room type is fully booked for those dates'; END IF;

  v_nights:=p_check_out-p_check_in;
  INSERT INTO public.hotel_bookings(
    hotel_id,room_id,user_id,check_in,check_out,guest_count,total_nights,total_price,status,
    guest_name,guest_phone,special_requests,payment_status,payment_expires_at,created_at,updated_at
  ) VALUES (
    p_hotel_id,p_room_id,v_actor.user_id,p_check_in,p_check_out,p_guest_count,v_nights,v_nights*v_room.price_per_night,'pending',
    btrim(p_guest_name),btrim(p_guest_phone),NULLIF(btrim(p_special_requests),''),'unpaid',now()+interval '30 minutes',now(),now()
  ) RETURNING * INTO v_result;
  RETURN v_result;
END;
$$;


--
-- Name: create_my_profile(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_my_profile(p_email text, p_role text DEFAULT 'user'::text) RETURNS public.profiles
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE
  v_profile public.profiles;
  v_auth_id text := auth.uid()::text;
  v_email text := lower(trim(COALESCE(auth.jwt()->>'email', p_email)));
  v_user_id text;
  v_username text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_role NOT IN ('user','worker','property_partner') THEN RAISE EXCEPTION 'Invalid public account role'; END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE auth_id=v_auth_id;
  IF v_profile IS NOT NULL THEN RETURN v_profile; END IF;

  IF v_email IS NULL OR v_email='' THEN RAISE EXCEPTION 'Authenticated email is required'; END IF;
  IF EXISTS(
    SELECT 1 FROM public.profiles p
    WHERE lower(p.email)=v_email AND p.auth_id<>v_auth_id
  ) THEN
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


--
-- Name: create_my_property_inspection_batch(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_my_property_inspection_batch(p_items jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_profile record;
  v_batch_id uuid := gen_random_uuid();
  v_item jsonb;
  v_position integer;
  v_request_id uuid;
  v_request_code text;
  v_results jsonb := '[]'::jsonb;
  v_photo_urls text[];
  v_amenities text[];
  v_lat numeric;
  v_lng numeric;
  v_accuracy numeric;
  v_address text;
  v_city text;
  v_state text;
  v_type text;
  v_sub_type text;
  v_deposit numeric;
BEGIN
  SELECT user_id,email,phone,role,deleted,suspended,banned
  INTO v_profile
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
  LIMIT 1;

  IF v_profile IS NULL THEN RAISE EXCEPTION 'Profile not found'; END IF;
  IF v_profile.role <> 'property_partner' THEN RAISE EXCEPTION 'Property Partner account required'; END IF;
  IF COALESCE(v_profile.deleted,false) OR COALESCE(v_profile.suspended,false) OR COALESCE(v_profile.banned,false) THEN
    RAISE EXCEPTION 'Account is not active';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'Property batch must be an array'; END IF;
  IF jsonb_array_length(p_items) < 1 THEN RAISE EXCEPTION 'Add at least one property'; END IF;
  IF jsonb_array_length(p_items) > 25 THEN RAISE EXCEPTION 'A batch can contain at most 25 properties'; END IF;

  FOR v_item, v_position IN
    SELECT value, ordinality::integer
    FROM jsonb_array_elements(p_items) WITH ORDINALITY
  LOOP
    v_address := NULLIF(BTRIM(v_item->>'property_address'),'');
    v_city := NULLIF(BTRIM(v_item->>'property_city'),'');
    v_state := NULLIF(BTRIM(v_item->>'property_state'),'');
    v_type := NULLIF(BTRIM(v_item->>'property_type'),'');
    v_sub_type := NULLIF(BTRIM(v_item->>'sub_type'),'');
    v_deposit := NULLIF(v_item->>'security_deposit_amount','')::numeric;

    IF v_address IS NULL THEN RAISE EXCEPTION 'Property %: address is required', v_position; END IF;
    IF v_city IS NULL THEN RAISE EXCEPTION 'Property %: city/LGA is required', v_position; END IF;
    IF v_state IS NULL THEN RAISE EXCEPTION 'Property %: state is required', v_position; END IF;
    IF v_type NOT IN ('apartment','hotel') THEN RAISE EXCEPTION 'Property %: choose Apartment or Hotel', v_position; END IF;

    IF v_type='apartment' AND v_sub_type IS NOT NULL AND v_sub_type NOT IN ('short_let','long_stay') THEN
      RAISE EXCEPTION 'Property %: invalid apartment stay type', v_position;
    END IF;
    IF v_type='hotel' THEN
      v_sub_type := NULL;
      v_deposit := NULL;
    ELSIF v_sub_type='short_let' AND COALESCE(v_deposit,0)<=0 THEN
      RAISE EXCEPTION 'Property %: Short Stay requires a refundable security deposit', v_position;
    ELSIF v_sub_type='long_stay' THEN
      v_deposit := NULL;
    END IF;

    v_lat := NULLIF(v_item->>'gps_latitude','')::numeric;
    v_lng := NULLIF(v_item->>'gps_longitude','')::numeric;
    v_accuracy := NULLIF(v_item->>'location_accuracy_m','')::numeric;
    IF (v_lat IS NULL) <> (v_lng IS NULL) THEN RAISE EXCEPTION 'Property %: latitude and longitude must be supplied together', v_position; END IF;
    IF v_lat IS NOT NULL AND (v_lat NOT BETWEEN -90 AND 90 OR v_lng NOT BETWEEN -180 AND 180) THEN
      RAISE EXCEPTION 'Property %: invalid coordinates', v_position;
    END IF;

    SELECT COALESCE(array_agg(value), ARRAY[]::text[])
    INTO v_photo_urls
    FROM jsonb_array_elements_text(COALESCE(v_item->'photo_urls','[]'::jsonb));

    SELECT COALESCE(array_agg(DISTINCT value), ARRAY[]::text[])
    INTO v_amenities
    FROM jsonb_array_elements_text(COALESCE(v_item->'amenities','[]'::jsonb));

    IF v_sub_type='short_let' AND NOT ('Furnished'=ANY(COALESCE(v_amenities,ARRAY[]::text[]))) THEN
      v_amenities := array_append(COALESCE(v_amenities,ARRAY[]::text[]),'Furnished');
    END IF;

    v_request_code := 'WHIR-' || upper(substring(replace(gen_random_uuid()::text,'-','') from 1 for 10));

    INSERT INTO public.inspection_requests(
      request_code, owner_id, owner_email, owner_phone,
      property_address, property_city, property_state, property_type, sub_type,
      bedrooms, bathrooms, expected_rent, security_deposit_amount, amenities,
      description, photo_urls,
      gps_latitude, gps_longitude, location_accuracy_m,
      submission_batch_id, submission_batch_position,
      status, created_at, updated_at
    ) VALUES (
      v_request_code, v_profile.user_id, v_profile.email,
      COALESCE(NULLIF(BTRIM(v_item->>'owner_phone'),''),v_profile.phone),
      v_address, v_city, v_state, v_type, v_sub_type,
      NULLIF(v_item->>'bedrooms','')::integer,
      NULLIF(v_item->>'bathrooms','')::integer,
      NULLIF(v_item->>'expected_rent','')::numeric,
      v_deposit, v_amenities,
      NULLIF(BTRIM(v_item->>'description'),''),
      v_photo_urls,
      v_lat, v_lng,
      CASE WHEN v_accuracy IS NULL OR v_accuracy < 0 THEN NULL ELSE v_accuracy END,
      v_batch_id, v_position,
      'pending', now(), now()
    ) RETURNING id INTO v_request_id;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'id', v_request_id,
      'request_code', v_request_code,
      'position', v_position
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'batch_id', v_batch_id,
    'count', jsonb_array_length(v_results),
    'requests', v_results
  );
END;
$$;


--
-- Name: create_my_property_inspection_request(text, text, text, text, integer, integer, numeric, text, text, text[], numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_my_property_inspection_request(p_property_address text, p_property_city text, p_property_state text, p_property_type text, p_bedrooms integer DEFAULT NULL::integer, p_bathrooms integer DEFAULT NULL::integer, p_expected_rent numeric DEFAULT NULL::numeric, p_description text DEFAULT NULL::text, p_owner_phone text DEFAULT NULL::text, p_photo_urls text[] DEFAULT ARRAY[]::text[], p_gps_latitude numeric DEFAULT NULL::numeric, p_gps_longitude numeric DEFAULT NULL::numeric) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_profile RECORD; v_request_id UUID; v_request_code TEXT;
BEGIN
  SELECT user_id,email,phone,role,deleted,suspended,banned INTO v_profile
  FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_profile IS NULL OR v_profile.role<>'property_partner' THEN RAISE EXCEPTION 'Property Partner account required'; END IF;
  IF COALESCE(v_profile.deleted,false) OR COALESCE(v_profile.suspended,false) OR COALESCE(v_profile.banned,false) THEN RAISE EXCEPTION 'Account is not active'; END IF;
  IF NULLIF(BTRIM(p_property_address),'') IS NULL OR NULLIF(BTRIM(p_property_city),'') IS NULL OR NULLIF(BTRIM(p_property_state),'') IS NULL THEN RAISE EXCEPTION 'Property address, state and LGA are required'; END IF;
  IF p_gps_latitude IS NOT NULL AND (p_gps_latitude < -90 OR p_gps_latitude > 90) THEN RAISE EXCEPTION 'Invalid latitude'; END IF;
  IF p_gps_longitude IS NOT NULL AND (p_gps_longitude < -180 OR p_gps_longitude > 180) THEN RAISE EXCEPTION 'Invalid longitude'; END IF;
  v_request_code := 'WHIR-'||UPPER(SUBSTRING(REPLACE(gen_random_uuid()::text,'-','') FROM 1 FOR 10));
  INSERT INTO public.inspection_requests(request_code,owner_id,owner_email,owner_phone,property_address,property_city,property_state,property_type,bedrooms,bathrooms,expected_rent,description,photo_urls,gps_latitude,gps_longitude,status,created_at,updated_at)
  VALUES(v_request_code,v_profile.user_id,v_profile.email,COALESCE(NULLIF(BTRIM(p_owner_phone),''),v_profile.phone),BTRIM(p_property_address),BTRIM(p_property_city),BTRIM(p_property_state),BTRIM(p_property_type),p_bedrooms,p_bathrooms,p_expected_rent,NULLIF(BTRIM(p_description),''),COALESCE(p_photo_urls,ARRAY[]::text[]),p_gps_latitude,p_gps_longitude,'pending',NOW(),NOW())
  RETURNING id INTO v_request_id;
  RETURN v_request_id;
END $$;


--
-- Name: create_my_property_inspection_request_v2(text, text, text, text, integer, integer, numeric, text, text, text[], numeric, numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_my_property_inspection_request_v2(p_property_address text, p_property_city text, p_property_state text, p_property_type text, p_bedrooms integer DEFAULT NULL::integer, p_bathrooms integer DEFAULT NULL::integer, p_expected_rent numeric DEFAULT NULL::numeric, p_description text DEFAULT NULL::text, p_owner_phone text DEFAULT NULL::text, p_photo_urls text[] DEFAULT ARRAY[]::text[], p_gps_latitude numeric DEFAULT NULL::numeric, p_gps_longitude numeric DEFAULT NULL::numeric, p_location_accuracy_m numeric DEFAULT NULL::numeric) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_profile record; v_request_id uuid; v_request_code text;
begin
 select user_id,email,phone,role,deleted,suspended,banned into v_profile from public.profiles where auth_id=auth.uid()::text limit 1;
 if v_profile is null then raise exception 'Profile not found'; end if;
 if v_profile.role<>'property_partner' then raise exception 'Property Partner account required'; end if;
 if coalesce(v_profile.deleted,false) or coalesce(v_profile.suspended,false) or coalesce(v_profile.banned,false) then raise exception 'Account is not active'; end if;
 if nullif(btrim(p_property_address),'') is null then raise exception 'Property address is required'; end if;
 if nullif(btrim(p_property_city),'') is null then raise exception 'Property city/LGA is required'; end if;
 if nullif(btrim(p_property_state),'') is null then raise exception 'Property state is required'; end if;
 if nullif(btrim(p_property_type),'') is null then raise exception 'Property type is required'; end if;
 if (p_gps_latitude is null) <> (p_gps_longitude is null) then raise exception 'Both latitude and longitude are required together'; end if;
 if p_gps_latitude is not null and (p_gps_latitude not between -90 and 90 or p_gps_longitude not between -180 and 180) then raise exception 'Invalid property coordinates'; end if;
 v_request_code:='WHIR-'||upper(substring(replace(gen_random_uuid()::text,'-','') from 1 for 10));
 insert into public.inspection_requests(request_code,owner_id,owner_email,owner_phone,property_address,property_city,property_state,property_type,bedrooms,bathrooms,expected_rent,description,photo_urls,gps_latitude,gps_longitude,location_accuracy_m,status,created_at,updated_at)
 values(v_request_code,v_profile.user_id,v_profile.email,coalesce(nullif(btrim(p_owner_phone),''),v_profile.phone),btrim(p_property_address),btrim(p_property_city),btrim(p_property_state),btrim(p_property_type),p_bedrooms,p_bathrooms,p_expected_rent,nullif(btrim(p_description),''),coalesce(p_photo_urls,array[]::text[]),p_gps_latitude,p_gps_longitude,case when p_location_accuracy_m is null or p_location_accuracy_m<0 then null else p_location_accuracy_m end,'pending',now(),now()) returning id into v_request_id;
 return v_request_id;
end $$;


--
-- Name: worker_showcase_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.worker_showcase_posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    worker_id text NOT NULL,
    kind text NOT NULL,
    media_type text NOT NULL,
    storage_path text NOT NULL,
    caption text,
    booking_id uuid,
    verified_job boolean DEFAULT false NOT NULL,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT worker_showcase_caption_length CHECK (((caption IS NULL) OR (length(caption) <= 300))),
    CONSTRAINT worker_showcase_posts_kind_check CHECK ((kind = ANY (ARRAY['story'::text, 'portfolio'::text]))),
    CONSTRAINT worker_showcase_posts_media_type_check CHECK ((media_type = ANY (ARRAY['image'::text, 'video'::text]))),
    CONSTRAINT worker_showcase_story_expiry CHECK ((((kind = 'story'::text) AND (expires_at IS NOT NULL)) OR ((kind = 'portfolio'::text) AND (expires_at IS NULL))))
);


--
-- Name: create_my_worker_showcase_post(text, text, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_my_worker_showcase_post(p_kind text, p_media_type text, p_storage_path text, p_caption text DEFAULT NULL::text, p_booking_id uuid DEFAULT NULL::uuid) RETURNS public.worker_showcase_posts
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'storage'
    AS $$ declare v_worker public.profiles;v_verified_job boolean:=false;v_post public.worker_showcase_posts;begin
 select * into v_worker from public.profiles where auth_id=auth.uid()::text and role='worker' and worker_status='verified' and coalesce(worker_verified,false)=true and coalesce(deleted,false)=false and coalesce(suspended,false)=false and coalesce(banned,false)=false limit 1;
 if v_worker is null then raise exception 'Only an approved live Worker can publish Work Stories or Portfolio media'; end if;
 if not public.worker_identity_is_current(v_worker.user_id) then raise exception 'Repeat your WeHouse identity check before publishing new work'; end if;
 if p_kind not in ('story','portfolio') then raise exception 'Invalid showcase type'; end if;
 if p_media_type not in ('image','video') then raise exception 'Invalid media type'; end if;
 if nullif(btrim(coalesce(p_storage_path,'')),'') is null or split_part(p_storage_path,'/',1)<>v_worker.user_id then raise exception 'Invalid showcase storage path'; end if;
 if length(coalesce(p_caption,''))>300 then raise exception 'Caption is too long'; end if;
 if not exists(select 1 from storage.objects o where o.bucket_id='worker-showcase' and o.name=p_storage_path) then raise exception 'Showcase media upload was not found'; end if;
 if p_booking_id is not null then select exists(select 1 from public.worker_bookings b where b.id=p_booking_id and b.worker_id=v_worker.user_id and b.status='approved_released') into v_verified_job; if not v_verified_job then raise exception 'Only a completed approved WeHouse job can be linked as verified work'; end if; end if;
 insert into public.worker_showcase_posts(worker_id,kind,media_type,storage_path,caption,booking_id,verified_job,expires_at) values(v_worker.user_id,p_kind,p_media_type,p_storage_path,nullif(btrim(coalesce(p_caption,'')),''),p_booking_id,v_verified_job,case when p_kind='story' then now()+interval '24 hours' else null end) returning * into v_post;
 return v_post;
end; $$;


--
-- Name: create_rent_plan(text, uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_rent_plan(p_user_id text, p_listing_id uuid, p_target_amount numeric) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE v_plan_id UUID; v_start_months INTEGER; v_cancel_percent NUMERIC;
BEGIN
  SELECT COALESCE(NULLIF(value, '')::INTEGER, 4) INTO v_start_months FROM platform_settings WHERE key = 'rent_plan_start_after_months';
  SELECT COALESCE(NULLIF(value, '')::NUMERIC, 10) INTO v_cancel_percent FROM platform_settings WHERE key = 'rent_plan_cancellation_fee_percent';
  INSERT INTO rent_plans (user_id, listing_id, target_amount, start_after_months, cancellation_fee_percent, accepted_terms, status, tenancy_start_date)
  VALUES (p_user_id, p_listing_id, p_target_amount, v_start_months, v_cancel_percent,
    jsonb_build_object('start_after_months', v_start_months, 'cancellation_fee_percent', v_cancel_percent, 'snapshot_at', NOW())::text,
    'active', CURRENT_DATE) RETURNING id INTO v_plan_id;
  RETURN v_plan_id;
END;
$$;


--
-- Name: create_rent_plan_contribution_payment(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_rent_plan_contribution_payment(p_contribution_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_user_id text;
  v_contribution public.rent_plan_contributions;
  v_plan public.rent_plans;
  v_res public.reservations;
  v_reference text;
  v_pending public.booking_payments;
BEGIN
  SELECT user_id INTO v_user_id
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_contribution
  FROM public.rent_plan_contributions
  WHERE id=p_contribution_id
  FOR UPDATE;
  IF v_contribution.id IS NULL THEN RAISE EXCEPTION 'Rent contribution not found'; END IF;

  SELECT * INTO v_plan
  FROM public.rent_plans
  WHERE id=v_contribution.rent_plan_id AND user_id=v_user_id
  FOR UPDATE;
  IF v_plan.id IS NULL THEN RAISE EXCEPTION 'Rent plan not found'; END IF;
  IF v_plan.status<>'active' THEN RAISE EXCEPTION 'Rent plan is not active'; END IF;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE id=v_plan.reservation_id AND user_id=v_user_id
  FOR SHARE;
  IF v_res.id IS NULL OR v_res.status<>'occupied' THEN RAISE EXCEPTION 'Active tenancy required'; END IF;

  IF v_contribution.status IN ('paid','completed') THEN
    RETURN jsonb_build_object('success',true,'already_paid',true,'contribution_id',v_contribution.id);
  END IF;
  IF v_contribution.status NOT IN ('scheduled','payment_pending','pending') THEN
    RAISE EXCEPTION 'This contribution cannot be paid';
  END IF;
  IF COALESCE(v_contribution.amount,0)<=0 THEN RAISE EXCEPTION 'Contribution amount is invalid'; END IF;

  SELECT * INTO v_pending
  FROM public.booking_payments
  WHERE user_id=v_user_id
    AND purpose='rent_plan_contribution'
    AND status='pending'
    AND metadata->>'contribution_id'=v_contribution.id::text
    AND round(COALESCE(amount_total,amount),2)=round(v_contribution.amount,2)
  ORDER BY created_at DESC
  LIMIT 1;
  IF v_pending.id IS NOT NULL THEN
    UPDATE public.rent_plan_contributions
    SET status='payment_pending',payment_reference=v_pending.payment_reference,paystack_reference=v_pending.paystack_reference,updated_at=now()
    WHERE id=v_contribution.id;
    RETURN jsonb_build_object('success',true,'reference',v_pending.paystack_reference,'amount',COALESCE(v_pending.amount_total,v_pending.amount),'existing',true);
  END IF;

  v_reference:='WHNEXT-'||upper(replace(gen_random_uuid()::text,'-',''));
  INSERT INTO public.booking_payments(
    payment_reference,user_id,payer_user_id,type,booking_type,listing_id,amount,amount_total,currency,status,
    purpose,payment_method,paystack_reference,metadata,created_at,updated_at
  ) VALUES (
    v_reference,v_user_id,v_user_id,'apartment','apartment',v_plan.listing_id::text,v_contribution.amount,v_contribution.amount,'NGN','pending',
    'rent_plan_contribution','paystack',v_reference,
    jsonb_build_object(
      'reservation_id',v_res.id,
      'listing_id',v_plan.listing_id::text,
      'rent_plan_id',v_plan.id::text,
      'contribution_id',v_contribution.id::text,
      'target_year',v_contribution.target_year,
      'installment_number',v_contribution.installment_number,
      'due_date',v_contribution.due_date,
      'payment_component','rent_plan_contribution',
      'security_deposit_amount',0,
      'eligible_partner_amount',v_contribution.amount
    ),
    now(),now()
  );

  UPDATE public.rent_plan_contributions
  SET status='payment_pending',payment_reference=v_reference,paystack_reference=v_reference,updated_at=now()
  WHERE id=v_contribution.id;

  RETURN jsonb_build_object('success',true,'reference',v_reference,'amount',v_contribution.amount,'existing',false);
END;
$$;


--
-- Name: create_short_stay_payment(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_short_stay_payment(p_reservation_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_user_id text; v_res public.reservations; v_listing public.listings; v_reference text; v_pending public.booking_payments;
  v_rent numeric; v_deposit numeric; v_total numeric;
BEGIN
  SELECT user_id INTO v_user_id FROM public.profiles
  WHERE auth_id=auth.uid()::text AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_res FROM public.reservations WHERE id=p_reservation_id AND user_id=v_user_id FOR UPDATE;
  IF v_res IS NULL THEN RAISE EXCEPTION 'Reservation not found'; END IF;
  IF v_res.stay_type<>'short_let' THEN RAISE EXCEPTION 'This is not a Short Stay reservation'; END IF;
  IF v_res.status='inspection_pending' THEN RAISE EXCEPTION 'Complete the requested inspection before paying for the Short Stay'; END IF;
  IF v_res.status NOT IN ('reserved','ready_for_move_in') THEN RAISE EXCEPTION 'Short Stay reservation is not ready for payment'; END IF;
  IF v_res.manual_payment_status NOT IN ('paid','completed') OR v_res.paid_at IS NULL THEN RAISE EXCEPTION 'Reservation fee must be confirmed first'; END IF;
  IF v_res.rent_payment_status='paid' THEN RETURN jsonb_build_object('success',true,'already_paid',true,'status','paid'); END IF;
  SELECT * INTO v_listing FROM public.listings WHERE id::text=v_res.listing_id AND sub_type='short_let' FOR SHARE;
  IF v_listing IS NULL THEN RAISE EXCEPTION 'Short Stay listing not found'; END IF;
  IF v_res.stay_check_out<=CURRENT_DATE THEN RAISE EXCEPTION 'This Short Stay has already ended'; END IF;

  v_rent:=round(COALESCE(v_res.stay_rent_total,v_res.nightly_rate_snapshot*v_res.stay_nights),2);
  v_deposit:=round(COALESCE(v_res.security_deposit_snapshot,v_listing.security_deposit_amount,0),2);
  v_total:=round(v_rent+v_deposit,2);
  IF v_rent<=0 OR v_deposit<=0 THEN RAISE EXCEPTION 'Short Stay amount or refundable deposit is invalid'; END IF;

  SELECT * INTO v_pending FROM public.booking_payments
  WHERE user_id=v_user_id AND purpose='apartment_rent' AND status='pending' AND metadata->>'reservation_id'=v_res.id
    AND metadata->>'payment_component'='short_stay_rent'
  ORDER BY created_at DESC LIMIT 1;
  IF v_pending.id IS NOT NULL THEN
    UPDATE public.reservations SET rent_payment_status='payment_pending',rent_payment_reference=v_pending.paystack_reference,updated_at=now() WHERE id=v_res.id;
    RETURN jsonb_build_object('success',true,'reference',v_pending.paystack_reference,'amount',COALESCE(v_pending.amount_total,v_pending.amount),'existing',true);
  END IF;

  v_reference:='WHSTAY-'||upper(replace(gen_random_uuid()::text,'-',''));
  INSERT INTO public.booking_payments(payment_reference,user_id,payer_user_id,type,booking_type,listing_id,amount,amount_total,currency,status,purpose,payment_method,paystack_reference,metadata,created_at,updated_at)
  VALUES(v_reference,v_user_id,v_user_id,'apartment','apartment',v_listing.id::text,v_total,v_total,'NGN','pending','apartment_rent','paystack',v_reference,
    jsonb_build_object('reservation_id',v_res.id,'listing_id',v_listing.id::text,'payment_component','short_stay_rent','check_in',v_res.stay_check_in,'check_out',v_res.stay_check_out,'nights',v_res.stay_nights,'nightly_rate',v_res.nightly_rate_snapshot,'stay_rent_total',v_rent,'security_deposit_amount',v_deposit,'eligible_partner_amount',v_rent),now(),now());
  UPDATE public.reservations
  SET stay_rent_total=v_rent,security_deposit_snapshot=v_deposit,security_deposit_status='pending',rent_payment_status='payment_pending',rent_payment_reference=v_reference,updated_at=now()
  WHERE id=v_res.id;
  RETURN jsonb_build_object('success',true,'reference',v_reference,'amount',v_total,'rent',v_rent,'security_deposit',v_deposit,'existing',false);
END;
$$;


--
-- Name: create_short_stay_reservation(text, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_short_stay_reservation(p_listing_id text, p_check_in date, p_check_out date) RETURNS public.reservations
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_profile public.profiles;
  v_listing public.listings;
  v_created public.reservations;
  v_fee numeric;
  v_checkout_minutes integer;
  v_checkout_expires timestamptz;
  v_reference text;
  v_min_nights integer;
  v_max_nights integer;
  v_nights integer;
  v_rate numeric;
  v_rent numeric;
  v_deposit numeric;
BEGIN
  SELECT * INTO v_profile FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF v_profile.role NOT IN ('user','worker','property_partner') THEN RAISE EXCEPTION 'This account cannot create customer reservations'; END IF;

  SELECT * INTO v_listing FROM public.listings
  WHERE (id::text=p_listing_id OR listing_id=p_listing_id)
    AND deleted_at IS NULL AND sub_type='short_let'
  LIMIT 1 FOR SHARE;
  IF v_listing IS NULL THEN RAISE EXCEPTION 'Short Stay listing not found'; END IF;
  IF v_listing.status IN ('maintenance','closed','rejected','pending_approval') THEN RAISE EXCEPTION 'This Short Stay is not bookable'; END IF;
  IF p_check_in IS NULL OR p_check_out IS NULL OR p_check_in<CURRENT_DATE OR p_check_out<=p_check_in THEN
    RAISE EXCEPTION 'Choose valid future check-in and check-out dates';
  END IF;

  SELECT COALESCE(NULLIF(value,'')::integer,1) INTO v_min_nights FROM public.platform_settings WHERE key='short_stay_min_nights' AND COALESCE(is_active,true)=true LIMIT 1;
  SELECT COALESCE(NULLIF(value,'')::integer,90) INTO v_max_nights FROM public.platform_settings WHERE key='short_stay_max_nights' AND COALESCE(is_active,true)=true LIMIT 1;
  v_min_nights:=GREATEST(COALESCE(v_min_nights,1),1);
  v_max_nights:=GREATEST(COALESCE(v_max_nights,90),v_min_nights);
  v_nights:=p_check_out-p_check_in;
  IF v_nights<v_min_nights OR v_nights>v_max_nights THEN RAISE EXCEPTION 'Short Stay must be between % and % nights',v_min_nights,v_max_nights; END IF;

  IF EXISTS (
    SELECT 1 FROM public.reservations r
    WHERE r.listing_id=v_listing.id::text
      AND r.status = ANY (ARRAY['payment_pending','reserved','inspection_pending','ready_for_move_in','occupied']::text[])
      AND (COALESCE(r.stay_type,'long_stay')<>'short_let' OR daterange(r.stay_check_in,r.stay_check_out,'[)') && daterange(p_check_in,p_check_out,'[)'))
  ) THEN RAISE EXCEPTION 'Those Short Stay dates are no longer available'; END IF;

  v_rate:=round(COALESCE(v_listing.price,0),2);
  v_deposit:=round(COALESCE(v_listing.security_deposit_amount,0),2);
  IF v_rate<=0 THEN RAISE EXCEPTION 'Nightly rate is not configured'; END IF;
  IF v_deposit<=0 THEN RAISE EXCEPTION 'Refundable security deposit is not configured'; END IF;
  v_rent:=round(v_rate*v_nights,2);

  SELECT NULLIF(value,'')::numeric INTO v_fee FROM public.platform_settings WHERE key='reservation_fee' AND COALESCE(is_active,true)=true LIMIT 1;
  IF v_fee IS NULL OR v_fee<=0 THEN RAISE EXCEPTION 'Reservation fee is not configured'; END IF;
  SELECT NULLIF(value,'')::integer INTO v_checkout_minutes FROM public.platform_settings WHERE key='apartment_payment_hold_minutes' AND COALESCE(is_active,true)=true LIMIT 1;
  IF v_checkout_minutes IS NULL OR v_checkout_minutes<5 OR v_checkout_minutes>120 THEN v_checkout_minutes:=30; END IF;
  v_checkout_expires:=now()+make_interval(mins=>v_checkout_minutes);
  v_reference:='WHAPT-'||upper(replace(gen_random_uuid()::text,'-',''));

  INSERT INTO public.reservations(
    listing_id,user_id,user_email,user_phone,listing_title,listing_price,listing_location,
    status,manual_payment_status,payment_reference,amount,currency,reservation_type,stay_type,
    stay_check_in,stay_check_out,stay_nights,nightly_rate_snapshot,stay_rent_total,security_deposit_snapshot,security_deposit_status,
    payment_expires_at,hold_expires_at,created_at,updated_at
  ) VALUES (
    v_listing.id::text,v_profile.user_id,v_profile.email,v_profile.phone,v_listing.title,v_listing.price,
    concat_ws(', ',v_listing.city,v_listing.state),'payment_pending','unpaid',v_reference,v_fee,'NGN','apartment','short_let',
    p_check_in,p_check_out,v_nights,v_rate,v_rent,v_deposit,'pending',v_checkout_expires,NULL,now(),now()
  ) RETURNING * INTO v_created;

  INSERT INTO public.booking_payments(
    payment_reference,user_id,payer_user_id,type,booking_type,listing_id,amount,amount_total,currency,status,purpose,payment_method,paystack_reference,metadata,created_at,updated_at
  ) VALUES (
    v_reference,v_profile.user_id,v_profile.user_id,'apartment','apartment',v_listing.id::text,v_fee,v_fee,'NGN','pending',
    'apartment_reservation','paystack',v_reference,
    jsonb_build_object('reservation_id',v_created.id,'listing_id',v_listing.id::text,'stay_type','short_let','check_in',p_check_in,'check_out',p_check_out,'source','create_short_stay_reservation'),now(),now()
  );

  RETURN v_created;
END;
$$;


--
-- Name: create_support_conversation(text, text, text, text, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_support_conversation(p_subject text, p_category text DEFAULT 'general'::text, p_context_type text DEFAULT 'general'::text, p_context_id text DEFAULT NULL::text, p_context_snapshot jsonb DEFAULT '{}'::jsonb, p_priority text DEFAULT 'normal'::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles; v_id uuid;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor.user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF v_actor.role NOT IN ('user','worker','property_partner') THEN
    RAISE EXCEPTION 'Human support is available to User, Worker and Property Partner accounts';
  END IF;
  IF COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN
    RAISE EXCEPTION 'Account is not active';
  END IF;

  SELECT id INTO v_id
  FROM public.partner_support_conversations
  WHERE partner_id=v_actor.user_id
  ORDER BY created_at
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.partner_support_conversations(
      partner_id,requester_role,subject,status,category,context_type,context_id,context_snapshot,priority,
      property_name,property_address,property_city,property_state,property_type,rental_mode,created_at,updated_at
    ) VALUES (
      v_actor.user_id,v_actor.role,'WeHouse Support','open',COALESCE(NULLIF(BTRIM(p_category),''),'general'),
      COALESCE(NULLIF(BTRIM(p_context_type),''),'general'),NULLIF(BTRIM(p_context_id),''),COALESCE(p_context_snapshot,'{}'::jsonb),
      CASE WHEN p_priority IN ('low','normal','high','urgent') THEN p_priority ELSE 'normal' END,
      NULLIF(p_context_snapshot->>'property_name',''),NULLIF(p_context_snapshot->>'property_address',''),
      COALESCE(NULLIF(p_context_snapshot->>'city',''),NULLIF(v_actor.local_government,''),v_actor.city),v_actor.state,
      NULLIF(p_context_snapshot->>'property_type',''),NULLIF(p_context_snapshot->>'rental_mode',''),NOW(),NOW()
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.partner_support_conversations
    SET requester_role=v_actor.role,
        status='open',
        subject='WeHouse Support',
        category=COALESCE(NULLIF(BTRIM(p_category),''),category,'general'),
        context_type=CASE WHEN NULLIF(BTRIM(p_context_type),'') IS NOT NULL AND p_context_type<>'general' THEN p_context_type ELSE context_type END,
        context_id=COALESCE(NULLIF(BTRIM(p_context_id),''),context_id),
        context_snapshot=CASE WHEN COALESCE(p_context_snapshot,'{}'::jsonb)<>'{}'::jsonb THEN p_context_snapshot ELSE context_snapshot END,
        updated_at=NOW(),
        resolved_at=NULL,
        closed_at=NULL
    WHERE id=v_id;
  END IF;
  RETURN v_id;
END $$;


--
-- Name: create_user_inspection_request(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_user_inspection_request(p_reservation_id text, p_notes text DEFAULT NULL::text) RETURNS public.user_inspection_requests
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_user_id text; v_res public.reservations; v_existing public.user_inspection_requests; v_created public.user_inspection_requests;
BEGIN
  SELECT user_id INTO v_user_id FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_res FROM public.reservations WHERE id=p_reservation_id AND user_id=v_user_id FOR UPDATE;
  IF v_res IS NULL THEN RAISE EXCEPTION 'Reservation not found'; END IF;
  IF v_res.manual_payment_status NOT IN ('paid','completed') OR v_res.paid_at IS NULL THEN
    RAISE EXCEPTION 'Pay the reservation fee before requesting inspection';
  END IF;
  IF v_res.status NOT IN ('reserved','inspection_pending') THEN RAISE EXCEPTION 'Reservation is not eligible for inspection'; END IF;
  SELECT * INTO v_existing FROM public.user_inspection_requests
  WHERE reservation_id=p_reservation_id AND status IN ('pending','scheduled','in_progress')
  ORDER BY created_at DESC LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  INSERT INTO public.user_inspection_requests(reservation_id,listing_id,user_id,notes,status,created_at,updated_at)
  VALUES(v_res.id,v_res.listing_id,v_user_id,NULLIF(btrim(p_notes),''),'pending',now(),now()) RETURNING * INTO v_created;
  UPDATE public.reservations SET status='inspection_pending',inspection_requested_at=now(),updated_at=now() WHERE id=v_res.id;
  RETURN v_created;
END;
$$;


--
-- Name: create_worker_booking_payment(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_worker_booking_payment(p_booking_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  customer public.profiles;
  b public.worker_bookings;
  w public.profiles;
  amt numeric;
  ref text;
  existing public.booking_payments;
BEGIN
  SELECT * INTO customer FROM public.profiles WHERE auth_id=auth.uid()::text;
  IF customer IS NULL OR COALESCE(customer.deleted,false) OR COALESCE(customer.suspended,false) OR COALESCE(customer.banned,false) THEN
    RETURN jsonb_build_object('success',false,'error','Active customer account required');
  END IF;

  SELECT * INTO b FROM public.worker_bookings WHERE id=p_booking_id FOR UPDATE;
  IF b IS NULL THEN RETURN jsonb_build_object('success',false,'error','Booking not found'); END IF;
  IF b.user_id<>customer.user_id THEN RETURN jsonb_build_object('success',false,'error','Not authorized'); END IF;
  IF b.status<>'waiting_payment' THEN RETURN jsonb_build_object('success',false,'error','Booking is not waiting for payment'); END IF;

  IF EXISTS(
    SELECT 1
    FROM public.booking_payments bp
    WHERE bp.worker_booking_id=p_booking_id
      AND bp.status='review_required'
  ) THEN
    RETURN jsonb_build_object(
      'success',false,
      'requires_review',true,
      'error','A verified payment for this booking needs WeHouse review. Do not pay again.'
    );
  END IF;

  SELECT * INTO w FROM public.profiles WHERE user_id=b.worker_id AND role='worker';
  IF w IS NULL OR w.worker_status<>'verified' OR w.worker_verified IS DISTINCT FROM true OR COALESCE(w.deleted,false) OR COALESCE(w.suspended,false) OR COALESCE(w.banned,false) THEN
    RETURN jsonb_build_object('success',false,'error','Worker is no longer eligible for this booking');
  END IF;

  amt:=COALESCE(b.negotiated_amount,b.agreed_amount,0);
  IF amt<=0 THEN RETURN jsonb_build_object('success',false,'error','No agreed amount set'); END IF;

  SELECT * INTO existing
  FROM public.booking_payments
  WHERE worker_booking_id=p_booking_id AND status='pending'
  ORDER BY created_at DESC
  LIMIT 1;

  IF existing IS NOT NULL THEN
    IF round(existing.amount_total,2)=round(amt,2) AND existing.created_at>now()-interval '30 minutes' THEN
      RETURN jsonb_build_object('success',true,'reference',existing.paystack_reference,'amount',amt,'existing',true);
    END IF;
    UPDATE public.booking_payments SET status='expired',updated_at=now() WHERE id=existing.id;
  END IF;

  ref:='WHBK-'||gen_random_uuid()::text;
  INSERT INTO public.booking_payments(
    payment_reference,user_id,payer_user_id,payee_user_id,amount,amount_total,net_amount,
    amount_commission,currency,status,purpose,paystack_reference,worker_booking_id,metadata,created_at,updated_at
  ) VALUES(
    ref,customer.user_id,customer.user_id,b.worker_id,amt,amt,amt,0,'NGN','pending','worker_booking',ref,p_booking_id,
    jsonb_build_object('source','create_worker_booking_payment','booking_id',p_booking_id),now(),now()
  );
  RETURN jsonb_build_object('success',true,'reference',ref,'amount',amt);
END;
$$;


--
-- Name: create_worker_booking_v2(text, text, numeric, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_worker_booking_v2(p_user_id text, p_worker_id text, p_agreed_price numeric, p_service_type text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_notes text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE v_booking_id UUID; v_commission_percent NUMERIC; v_wehouse_fee NUMERIC;
BEGIN
  SELECT COALESCE(NULLIF(value, '')::NUMERIC, 15) INTO v_commission_percent FROM platform_settings WHERE key = 'commission_worker';
  v_wehouse_fee := ROUND(p_agreed_price * v_commission_percent / 100, 2);
  INSERT INTO worker_bookings (user_id, worker_id, service_type, agreed_amount, worker_receives, status, address, notes)
  VALUES (p_user_id, p_worker_id, p_service_type, p_agreed_price, p_agreed_price - v_wehouse_fee, 'pending', p_address, p_notes) RETURNING id INTO v_booking_id;
  RETURN v_booking_id;
END;
$$;


--
-- Name: create_worker_verification_payment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_worker_verification_payment() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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
  IF v_existing IS NOT NULL THEN IF v_existing.amount_total=v_amount THEN RETURN jsonb_build_object('success',true,'reference',v_existing.paystack_reference,'amount',v_amount,'existing',true); END IF; UPDATE public.booking_payments SET status='expired',updated_at=now() WHERE id=v_existing.id; END IF;
  v_reference:='WH-'||gen_random_uuid()::text;
  INSERT INTO public.booking_payments(payment_reference,user_id,payer_user_id,payee_user_id,type,booking_type,amount,amount_total,net_amount,amount_commission,currency,status,purpose,paystack_reference,metadata,created_at,updated_at) VALUES(v_reference,v_caller,v_caller,v_caller,'worker_subscription','worker_subscription',v_amount,v_amount,v_amount,0,'NGN','pending','worker_verification',v_reference,jsonb_build_object('source','create_worker_verification_payment'),now(),now());
  RETURN jsonb_build_object('success',true,'reference',v_reference,'amount',v_amount,'existing',false);
EXCEPTION WHEN unique_violation THEN
  SELECT * INTO v_existing FROM public.booking_payments WHERE user_id=v_caller AND purpose='worker_verification' AND status='pending' ORDER BY created_at DESC LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN jsonb_build_object('success',true,'reference',v_existing.paystack_reference,'amount',v_existing.amount_total,'existing',true); END IF;
  RETURN jsonb_build_object('success',false,'error','Payment initialization race condition');
END;
$$;


--
-- Name: creator_action_password_set(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.creator_action_password_set(p_new_password text, p_current_password text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $_$
DECLARE
  v_creator public.profiles;
  v_current_ok boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_new_password IS NULL OR length(p_new_password) < 8 THEN
    RAISE EXCEPTION 'Authorization password must be at least 8 characters';
  END IF;

  SELECT * INTO v_creator
  FROM public.profiles
  WHERE auth_id = auth.uid()::text
    AND role = 'creator'
    AND COALESCE(deleted,false) = false
    AND COALESCE(suspended,false) = false
    AND COALESCE(banned,false) = false
  FOR UPDATE;

  IF v_creator IS NULL THEN
    RAISE EXCEPTION 'Creator account required';
  END IF;

  IF v_creator.creator_auth_password IS NOT NULL THEN
    IF p_current_password IS NULL THEN
      RAISE EXCEPTION 'Current authorization password is required';
    END IF;

    IF v_creator.creator_auth_password LIKE '$2%' THEN
      v_current_ok := extensions.crypt(p_current_password, v_creator.creator_auth_password) = v_creator.creator_auth_password;
    ELSE
      v_current_ok := v_creator.creator_auth_password = md5(v_creator.auth_id || p_current_password);
    END IF;

    IF NOT v_current_ok THEN
      RAISE EXCEPTION 'Current authorization password is incorrect';
    END IF;
  END IF;

  UPDATE public.profiles
  SET creator_auth_password = extensions.crypt(p_new_password, extensions.gen_salt('bf', 12)),
      creator_auth_enabled = true,
      updated_at = now()
  WHERE id = v_creator.id;

  RETURN true;
END;
$_$;


--
-- Name: creator_action_password_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.creator_action_password_status() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN public.creator_auth_status_v3(auth.uid()::text);
END;
$$;


--
-- Name: creator_action_password_verify(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.creator_action_password_verify(p_password text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN public.creator_auth_verify_v3(auth.uid()::text, p_password);
END;
$$;


--
-- Name: creator_auth_set_v3(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.creator_auth_set_v3(p_auth_id text, p_password text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  v_creator public.profiles;
BEGIN
  IF auth.uid() IS NULL OR p_auth_id IS DISTINCT FROM auth.uid()::text THEN
    RETURN false;
  END IF;
  IF p_password IS NULL OR length(p_password) < 8 THEN
    RAISE EXCEPTION 'Authorization password must be at least 8 characters';
  END IF;

  SELECT * INTO v_creator
  FROM public.profiles
  WHERE auth_id = auth.uid()::text
    AND role = 'creator'
    AND COALESCE(deleted,false) = false
    AND COALESCE(suspended,false) = false
    AND COALESCE(banned,false) = false
  FOR UPDATE;

  IF v_creator IS NULL THEN
    RETURN false;
  END IF;
  IF v_creator.creator_auth_password IS NOT NULL THEN
    RAISE EXCEPTION 'Use the secure password-change flow';
  END IF;

  UPDATE public.profiles
  SET creator_auth_password = extensions.crypt(p_password, extensions.gen_salt('bf', 12)),
      creator_auth_enabled = true,
      updated_at = now()
  WHERE id = v_creator.id;

  RETURN true;
END;
$$;


--
-- Name: creator_auth_status_v3(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.creator_auth_status_v3(p_auth_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $_$
DECLARE
  v_creator public.profiles;
BEGIN
  IF auth.uid() IS NULL OR p_auth_id IS DISTINCT FROM auth.uid()::text THEN
    RAISE EXCEPTION 'Creator authentication required';
  END IF;

  SELECT * INTO v_creator
  FROM public.profiles
  WHERE auth_id = auth.uid()::text
    AND role = 'creator'
    AND COALESCE(deleted,false) = false
    AND COALESCE(suspended,false) = false
    AND COALESCE(banned,false) = false
  LIMIT 1;

  IF v_creator IS NULL THEN
    RAISE EXCEPTION 'Creator account required';
  END IF;

  RETURN jsonb_build_object(
    'has_password', v_creator.creator_auth_password IS NOT NULL,
    'enabled', COALESCE(v_creator.creator_auth_enabled,false),
    'legacy', v_creator.creator_auth_password IS NOT NULL
              AND v_creator.creator_auth_password NOT LIKE '$2%'
  );
END;
$_$;


--
-- Name: creator_auth_verify_v3(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.creator_auth_verify_v3(p_auth_id text, p_password text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $_$
DECLARE
  v_creator public.profiles;
BEGIN
  IF auth.uid() IS NULL OR p_auth_id IS DISTINCT FROM auth.uid()::text THEN
    RETURN false;
  END IF;

  SELECT * INTO v_creator
  FROM public.profiles
  WHERE auth_id = auth.uid()::text
    AND role = 'creator'
    AND COALESCE(deleted,false) = false
    AND COALESCE(suspended,false) = false
    AND COALESCE(banned,false) = false
  LIMIT 1;

  IF v_creator IS NULL
     OR COALESCE(v_creator.creator_auth_enabled,false) = false
     OR v_creator.creator_auth_password IS NULL
     OR p_password IS NULL THEN
    RETURN false;
  END IF;

  IF v_creator.creator_auth_password LIKE '$2%' THEN
    RETURN extensions.crypt(p_password, v_creator.creator_auth_password) = v_creator.creator_auth_password;
  END IF;

  RETURN v_creator.creator_auth_password = md5(v_creator.auth_id || p_password);
END;
$_$;


--
-- Name: creator_get_change_history(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.creator_get_change_history(p_search text DEFAULT NULL::text, p_limit integer DEFAULT 150) RETURNS TABLE(event_id text, actor_name text, actor_role text, action_label text, area_label text, subject_label text, occurred_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor public.profiles;
  v_limit integer:=least(greatest(coalesce(p_limit,150),1),250);
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND role='creator'
    AND coalesce(deleted,false)=false
    AND coalesce(suspended,false)=false
    AND coalesce(banned,false)=false
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Creator access required'; END IF;

  RETURN QUERY
  WITH projected AS (
    SELECT
      md5(coalesce(a.id,'')||':'||a.created_at::text) AS event_id,
      coalesce(actor.full_name,actor.username,CASE WHEN a.admin_id IS NULL THEN 'WeHouse System' ELSE 'WeHouse team' END) AS actor_name,
      coalesce(actor.role,'system')::text AS actor_role,
      CASE upper(coalesce(a.action,''))
        WHEN 'INSERT' THEN 'Created'
        WHEN 'UPDATE' THEN 'Updated'
        WHEN 'DELETE' THEN 'Removed'
        WHEN 'REASSIGN' THEN 'Reassigned'
        WHEN 'APPROVE' THEN 'Approved'
        WHEN 'REJECT' THEN 'Rejected'
        WHEN 'SUSPEND' THEN 'Suspended'
        WHEN 'RESTORE' THEN 'Restored'
        ELSE initcap(replace(lower(coalesce(a.action,'changed')),'_',' '))
      END::text AS action_label,
      CASE lower(coalesce(a.target_type,''))
        WHEN 'platform_settings' THEN 'Settings'
        WHEN 'profiles' THEN 'Team & accounts'
        WHEN 'worker_bookings' THEN 'Worker bookings'
        WHEN 'worker_verifications' THEN 'Workers'
        WHEN 'listings' THEN 'Properties'
        WHEN 'inspection_requests' THEN 'Properties'
        WHEN 'listing_reports' THEN 'Moderation'
        WHEN 'withdrawals' THEN 'Finance'
        WHEN 'wallets' THEN 'Finance'
        ELSE 'Platform'
      END::text AS area_label,
      CASE lower(coalesce(a.target_type,''))
        WHEN 'platform_settings' THEN coalesce(ps.label,initcap(replace(coalesce(a.target_id,'Platform setting'),'_',' ')))
        WHEN 'profiles' THEN coalesce(target_profile.full_name,target_profile.username,'WeHouse account')
        WHEN 'worker_bookings' THEN 'Worker service booking'
        WHEN 'worker_verifications' THEN 'Worker review'
        WHEN 'listings' THEN 'Property listing'
        WHEN 'inspection_requests' THEN 'Property inspection'
        WHEN 'listing_reports' THEN 'Listing report'
        WHEN 'withdrawals' THEN 'Payout request'
        ELSE initcap(replace(coalesce(nullif(a.target_type,''),'platform'),'_',' '))
      END::text AS subject_label,
      a.created_at AS occurred_at
    FROM public.audit_logs a
    LEFT JOIN LATERAL (
      SELECT p.full_name,p.username,p.role
      FROM public.profiles p
      WHERE p.user_id=a.admin_id
         OR p.auth_id=a.admin_id
         OR (a.admin_email IS NOT NULL AND lower(p.email)=lower(a.admin_email))
      ORDER BY CASE WHEN p.user_id=a.admin_id THEN 0 WHEN p.auth_id=a.admin_id THEN 1 ELSE 2 END
      LIMIT 1
    ) actor ON true
    LEFT JOIN public.platform_settings ps ON a.target_type='platform_settings' AND ps.key=a.target_id
    LEFT JOIN public.profiles target_profile ON a.target_type='profiles' AND target_profile.user_id=a.target_id
  )
  SELECT p.event_id,p.actor_name,p.actor_role,p.action_label,p.area_label,p.subject_label,p.occurred_at
  FROM projected p
  WHERE nullif(trim(coalesce(p_search,'')),'') IS NULL
     OR lower(concat_ws(' ',p.actor_name,p.actor_role,p.action_label,p.area_label,p.subject_label)) LIKE '%'||lower(trim(p_search))||'%'
  ORDER BY p.occurred_at DESC
  LIMIT v_limit;
END;
$$;


--
-- Name: creator_get_platform_analytics(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.creator_get_platform_analytics(p_days integer DEFAULT 30) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor public.profiles;
  v_days integer := LEAST(90, GREATEST(7, COALESCE(p_days,30)));
  v_start date;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor.user_id IS NULL OR v_actor.role<>'creator' OR COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN
    RAISE EXCEPTION 'Creator access required';
  END IF;
  v_start := CURRENT_DATE-(v_days-1);

  RETURN jsonb_build_object(
    'days',v_days,
    'period_start',v_start,
    'period_end',CURRENT_DATE,
    'summary',jsonb_build_object(
      'new_users',(SELECT count(*) FROM public.profiles WHERE role='user' AND created_at>=v_start AND deleted_at IS NULL),
      'new_workers',(SELECT count(*) FROM public.profiles WHERE role='worker' AND created_at>=v_start AND deleted_at IS NULL),
      'new_partners',(SELECT count(*) FROM public.profiles WHERE role='property_partner' AND created_at>=v_start AND deleted_at IS NULL),
      'published_listings',(SELECT count(*) FROM public.listings WHERE deleted_at IS NULL AND approved_at>=v_start AND status IN ('available','reserved','closed')),
      'worker_bookings',(SELECT count(*) FROM public.worker_bookings WHERE created_at>=v_start),
      'verified_payments',(SELECT count(*) FROM public.booking_payments WHERE verified_at>=v_start),
      'verified_payment_volume',(SELECT COALESCE(sum(COALESCE(amount_total,amount,0)),0) FROM public.booking_payments WHERE verified_at>=v_start),
      'commission_earned',(SELECT COALESCE(sum(commission_amount),0) FROM public.commission_ledger WHERE created_at>=v_start)
    ),
    'daily',(
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'date',d::date,
        'signups',(SELECT count(*) FROM public.profiles p WHERE p.created_at>=d AND p.created_at<d+interval '1 day' AND p.deleted_at IS NULL),
        'published_listings',(SELECT count(*) FROM public.listings l WHERE l.approved_at>=d AND l.approved_at<d+interval '1 day' AND l.deleted_at IS NULL AND l.status IN ('available','reserved','closed')),
        'worker_bookings',(SELECT count(*) FROM public.worker_bookings w WHERE w.created_at>=d AND w.created_at<d+interval '1 day'),
        'verified_payments',(SELECT count(*) FROM public.booking_payments bp WHERE bp.verified_at>=d AND bp.verified_at<d+interval '1 day')
      ) ORDER BY d),'[]'::jsonb)
      FROM generate_series(v_start::timestamp,CURRENT_DATE::timestamp,interval '1 day') d
    ),
    'listing_pipeline',(
      SELECT COALESCE(jsonb_object_agg(status,cnt),'{}'::jsonb)
      FROM (SELECT COALESCE(status,'unknown') status,count(*) cnt FROM public.listings WHERE deleted_at IS NULL GROUP BY status) s
    ),
    'worker_pipeline',(
      SELECT COALESCE(jsonb_object_agg(worker_status,cnt),'{}'::jsonb)
      FROM (SELECT COALESCE(worker_status,'unknown') worker_status,count(*) cnt FROM public.profiles WHERE role='worker' AND deleted_at IS NULL GROUP BY worker_status) s
    ),
    'top_markets',(
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.available_listings DESC,x.state,x.lga),'[]'::jsonb)
      FROM (
        SELECT COALESCE(state,'Unknown') state,COALESCE(city,'Unknown') lga,count(*) available_listings
        FROM public.listings
        WHERE deleted_at IS NULL AND status='available'
        GROUP BY state,city
        ORDER BY count(*) DESC,state,city
        LIMIT 8
      ) x
    ),
    'activity',(
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC),'[]'::jsonb)
      FROM (
        SELECT a.id,a.action,a.target_type,a.target_id,a.details,a.created_at,a.admin_id,p.username AS actor_username,p.role AS actor_role
        FROM public.audit_logs a
        LEFT JOIN public.profiles p ON p.user_id=a.admin_id
        ORDER BY a.created_at DESC
        LIMIT 40
      ) x
    )
  );
END;
$$;


--
-- Name: creator_reassign_branch(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.creator_reassign_branch(p_target_user_id text, p_new_state text, p_new_lga text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_caller_role TEXT;
  v_target_role TEXT;
BEGIN
  SELECT role INTO v_caller_role
  FROM public.profiles
  WHERE auth_id = auth.uid()::text;

  IF v_caller_role NOT IN ('creator') THEN
    RAISE EXCEPTION 'Only Creator can reassign branches';
  END IF;

  SELECT role INTO v_target_role
  FROM public.profiles
  WHERE user_id = p_target_user_id;

  IF v_target_role NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Can only reassign Admin or Staff. Target is: %', v_target_role;
  END IF;

  -- Operational reassignment ONLY: assigned_state and assigned_lga
  -- Do NOT overwrite personal location fields (state, local_government, city, area)
  UPDATE public.profiles
  SET assigned_state = p_new_state,
      assigned_lga = p_new_lga,
      updated_at = NOW()
  WHERE user_id = p_target_user_id;

  INSERT INTO public.audit_logs (action, target_type, target_id, details, admin_id)
  VALUES (
    'REASSIGN', 'profiles', p_target_user_id,
    jsonb_build_object('new_branch', p_new_state || ' / ' || p_new_lga)::text,
    auth.uid()::text
  );

  RETURN TRUE;
END;
$$;


--
-- Name: creator_send_announcement(text, text, text[], text[], text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.creator_send_announcement(p_title text, p_content text, p_target_roles text[], p_recipient_ids text[] DEFAULT NULL::text[], p_scope_state text DEFAULT NULL::text, p_scope_lga text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_actor public.profiles;
  v_id integer;
  v_count integer;
  v_roles text[];
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text limit 1;
  if v_actor.user_id is null or v_actor.role<>'creator' then raise exception 'Creator account required'; end if;
  if nullif(btrim(coalesce(p_title,'')),'') is null then raise exception 'Announcement title is required'; end if;
  if nullif(btrim(coalesce(p_content,'')),'') is null then raise exception 'Announcement content is required'; end if;
  select coalesce(array_agg(distinct r),'{}'::text[]) into v_roles
  from unnest(coalesce(p_target_roles,'{}'::text[])) r
  where r in ('user','worker','staff','property_partner','admin');
  if coalesce(array_length(v_roles,1),0)=0 then raise exception 'Select at least one recipient type'; end if;

  insert into public.announcements(title,content,sender_id,sender_role,target_type,scope,recipient_count,read_count,created_at)
  values(
    btrim(p_title),btrim(p_content),v_actor.user_id,'creator',
    case when p_recipient_ids is null then 'all_users' else 'specific_user' end,
    case when nullif(p_scope_state,'') is not null and nullif(p_scope_lga,'') is not null then p_scope_state||' / '||p_scope_lga else null end,
    0,0,now()
  ) returning id into v_id;

  insert into public.announcement_recipients(announcement_id,user_id,read_status,delivered_at)
  select v_id,p.user_id,false,now()
  from public.profiles p
  where p.user_id<>v_actor.user_id
    and p.role=any(v_roles)
    and coalesce(p.deleted,false)=false
    and coalesce(p.suspended,false)=false
    and coalesce(p.banned,false)=false
    and (p_recipient_ids is null or p.user_id=any(p_recipient_ids))
    and (nullif(p_scope_state,'') is null or coalesce(nullif(p.state,''),nullif(p.assigned_state,''))=p_scope_state)
    and (nullif(p_scope_lga,'') is null or coalesce(nullif(p.local_government,''),nullif(p.city,''),nullif(p.assigned_lga,''))=p_scope_lga);

  get diagnostics v_count=row_count;
  if v_count=0 then
    delete from public.announcements where id=v_id;
    raise exception 'No users match the selected recipients';
  end if;
  update public.announcements set recipient_count=v_count where id=v_id;
  return jsonb_build_object('id',v_id,'recipient_count',v_count);
end;
$$;


--
-- Name: creator_set_team_role(text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.creator_set_team_role(p_target_user_id text, p_new_role text, p_state text DEFAULT NULL::text, p_lga text DEFAULT NULL::text, p_module text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor public.profiles;
  v_target public.profiles;
  v_state text := NULLIF(btrim(p_state),'');
  v_lga text := NULLIF(btrim(p_lga),'');
  v_module text := NULLIF(btrim(p_module),'');
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND role='creator'
    AND NOT COALESCE(deleted,false)
    AND NOT COALESCE(suspended,false)
    AND NOT COALESCE(banned,false)
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Creator access required'; END IF;

  SELECT * INTO v_target FROM public.profiles WHERE user_id=p_target_user_id FOR UPDATE;
  IF v_target IS NULL THEN RAISE EXCEPTION 'Target account not found'; END IF;
  IF v_target.user_id=v_actor.user_id OR v_target.role='creator' THEN RAISE EXCEPTION 'Creator role cannot be modified'; END IF;
  IF p_new_role NOT IN ('admin','staff','user') THEN RAISE EXCEPTION 'Invalid team role'; END IF;

  IF p_new_role IN ('admin','staff') THEN
    IF v_target.role NOT IN ('user','admin','staff') THEN RAISE EXCEPTION 'Only User, Admin or Staff accounts can enter Team management'; END IF;
    IF v_state IS NULL OR v_lga IS NULL THEN RAISE EXCEPTION 'State and LGA are required'; END IF;
    IF p_new_role='staff' AND (v_module IS NULL OR v_module NOT IN ('operations','finance','support','verification','field_officer')) THEN
      RAISE EXCEPTION 'A valid Staff module is required';
    END IF;

    UPDATE public.profiles
    SET role=p_new_role,
        assigned_state=v_state,
        assigned_lga=v_lga,
        scope='local',
        updated_by=v_actor.user_id,
        updated_at=now()
    WHERE user_id=p_target_user_id;

    UPDATE public.staff_permissions
    SET is_active=false,revoked_at=now()
    WHERE staff_id=p_target_user_id AND is_active=true;

    IF p_new_role='staff' THEN
      INSERT INTO public.staff_permissions(staff_id,permission,granted_by,granted_at,revoked_at,is_active)
      VALUES(p_target_user_id,v_module,v_actor.user_id,now(),NULL,true)
      ON CONFLICT(staff_id,permission) DO UPDATE SET granted_by=EXCLUDED.granted_by,granted_at=now(),revoked_at=NULL,is_active=true;
    END IF;
  ELSE
    IF v_target.role NOT IN ('admin','staff') THEN RAISE EXCEPTION 'Only Admin or Staff can be returned to User'; END IF;
    UPDATE public.profiles
    SET role='user',assigned_state=NULL,assigned_lga=NULL,scope=NULL,updated_by=v_actor.user_id,updated_at=now()
    WHERE user_id=p_target_user_id;
    UPDATE public.staff_permissions SET is_active=false,revoked_at=now() WHERE staff_id=p_target_user_id AND is_active=true;
  END IF;

  INSERT INTO public.audit_logs(action,target_type,target_id,details,admin_id)
  VALUES('ROLE_CHANGE','profiles',p_target_user_id,jsonb_build_object('old_role',v_target.role,'new_role',p_new_role,'assigned_state',v_state,'assigned_lga',v_lga,'staff_module',CASE WHEN p_new_role='staff' THEN v_module ELSE NULL END)::text,v_actor.user_id);
  RETURN true;
END;
$$;


--
-- Name: credit_wallet(uuid, numeric, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.credit_wallet(p_wallet_id uuid, p_amount numeric, p_description text, p_reference text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_wallet RECORD;
  v_caller TEXT;
  v_caller_role TEXT;
  v_new_balance NUMERIC;
BEGIN
  -- ── AUTH: Identify caller ──
  SELECT user_id, role INTO v_caller, v_caller_role
  FROM profiles WHERE auth_id = auth.uid()::text;

  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  -- ── AUTHORIZATION: staff/admin/creator only ──
  IF v_caller_role NOT IN ('staff','admin','creator') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  SELECT * INTO v_wallet FROM wallets WHERE id = p_wallet_id FOR UPDATE;

  IF v_wallet IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wallet not found');
  END IF;

  IF v_wallet.is_frozen THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wallet is frozen');
  END IF;

  v_new_balance := v_wallet.available_balance + p_amount;

  UPDATE wallets SET
    available_balance = v_new_balance,
    updated_at = NOW()
  WHERE id = p_wallet_id;

  INSERT INTO wallet_transactions (
    user_id, transaction_type, amount, description,
    reference_id, reference_type, balance_after
  ) VALUES (
    v_wallet.owner_id, 'credit', p_amount, p_description,
    p_reference, 'wallet_credit', v_new_balance
  );

  RETURN jsonb_build_object('success', true, 'new_balance', v_new_balance);
END;
$$;


--
-- Name: current_actor_can_access_listing_ref(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_actor_can_access_listing_ref(p_listing_ref text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE v_actor public.profiles; v_listing public.listings;
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RETURN false; END IF;
  IF v_actor.role='creator' THEN RETURN true; END IF;
  IF v_actor.role NOT IN ('admin','staff') THEN RETURN false; END IF;
  SELECT * INTO v_listing FROM public.listings
  WHERE id::text=p_listing_ref OR listing_id=p_listing_ref LIMIT 1;
  IF v_listing IS NULL THEN RETURN false; END IF;
  RETURN public.current_actor_in_scope(v_listing.state,v_listing.city);
END;
$$;


--
-- Name: current_actor_can_access_reservation(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_actor_can_access_reservation(p_reservation_id text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE v_listing_ref text;
BEGIN
  SELECT listing_id INTO v_listing_ref FROM public.reservations WHERE id=p_reservation_id LIMIT 1;
  IF v_listing_ref IS NULL THEN RETURN false; END IF;
  RETURN public.current_actor_can_access_listing_ref(v_listing_ref);
END;
$$;


--
-- Name: current_actor_can_access_worker_booking(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_actor_can_access_worker_booking(p_booking_id uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE v_actor public.profiles; v_worker public.profiles;
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RETURN false; END IF;
  IF v_actor.role='creator' THEN RETURN true; END IF;
  IF v_actor.role NOT IN ('admin','staff') THEN RETURN false; END IF;
  SELECT w.* INTO v_worker FROM public.worker_bookings b
  JOIN public.profiles w ON w.user_id=b.worker_id WHERE b.id=p_booking_id LIMIT 1;
  IF v_worker IS NULL THEN RETURN false; END IF;
  RETURN public.current_actor_in_scope(v_worker.state,COALESCE(v_worker.local_government,v_worker.city));
END;
$$;


--
-- Name: current_actor_in_scope(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_actor_in_scope(p_state text, p_lga text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$ DECLARE v_actor public.profiles; BEGIN SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1; IF v_actor IS NULL THEN RETURN false; END IF; IF v_actor.role='creator' THEN RETURN true; END IF; IF v_actor.role NOT IN ('admin','staff') THEN RETURN false; END IF; IF NULLIF(BTRIM(COALESCE(v_actor.assigned_state,'')),'') IS NULL OR NULLIF(BTRIM(COALESCE(v_actor.assigned_lga,'')),'') IS NULL OR NULLIF(BTRIM(COALESCE(p_state,'')),'') IS NULL OR NULLIF(BTRIM(COALESCE(p_lga,'')),'') IS NULL THEN RETURN false; END IF; RETURN lower(BTRIM(v_actor.assigned_state))=lower(BTRIM(p_state)) AND lower(BTRIM(v_actor.assigned_lga))=lower(BTRIM(p_lga)); END; $$;


--
-- Name: current_profile_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_profile_role() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$ SELECT p.role FROM public.profiles p WHERE p.auth_id=auth.uid()::text AND COALESCE(p.deleted,false)=false AND COALESCE(p.suspended,false)=false AND COALESCE(p.banned,false)=false LIMIT 1 $$;


--
-- Name: current_profile_user_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_profile_user_id() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$ SELECT p.user_id FROM public.profiles p WHERE p.auth_id=auth.uid()::text AND COALESCE(p.deleted,false)=false AND COALESCE(p.suspended,false)=false AND COALESCE(p.banned,false)=false LIMIT 1 $$;


--
-- Name: current_staff_can_review_worker(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_staff_can_review_worker(p_worker_id text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$ DECLARE v_actor public.profiles; v_worker public.profiles; BEGIN SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role='staff' AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1; IF v_actor IS NULL OR NOT public.current_staff_has_permission('verification') THEN RETURN false; END IF; IF NULLIF(BTRIM(COALESCE(v_actor.assigned_state,'')),'') IS NULL OR NULLIF(BTRIM(COALESCE(v_actor.assigned_lga,'')),'') IS NULL THEN RETURN false; END IF; SELECT * INTO v_worker FROM public.profiles WHERE user_id=p_worker_id AND role='worker' LIMIT 1; IF v_worker IS NULL THEN RETURN false; END IF; RETURN lower(BTRIM(COALESCE(v_worker.state,'')))=lower(BTRIM(v_actor.assigned_state)) AND lower(BTRIM(COALESCE(v_worker.local_government,v_worker.city,'')))=lower(BTRIM(v_actor.assigned_lga)); END; $$;


--
-- Name: current_staff_has_permission(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_staff_has_permission(p_permission text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.profiles p
    JOIN public.staff_permissions sp ON sp.staff_id=p.user_id AND sp.permission=p_permission AND sp.is_active=true
    JOIN public.staff_trust_profiles st ON st.staff_id=p.user_id AND st.status='trusted'
    WHERE p.auth_id=auth.uid()::text AND p.role='staff'
      AND NOT COALESCE(p.deleted,false) AND NOT COALESCE(p.suspended,false) AND NOT COALESCE(p.banned,false)
  ) OR EXISTS(
    SELECT 1 FROM public.profiles p
    WHERE p.auth_id=auth.uid()::text AND p.role IN('admin','creator')
      AND NOT COALESCE(p.deleted,false) AND NOT COALESCE(p.suspended,false) AND NOT COALESCE(p.banned,false)
  );
$$;


--
-- Name: current_user_is_staff(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_user_is_staff() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$ SELECT EXISTS(SELECT 1 FROM public.profiles p WHERE p.auth_id=auth.uid()::text AND p.role IN ('staff','admin','creator') AND COALESCE(p.deleted,false)=false AND COALESCE(p.suspended,false)=false AND COALESCE(p.banned,false)=false) $$;


--
-- Name: customer_confirm_completion(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.customer_confirm_completion(p_booking_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_customer public.profiles;v_booking public.worker_bookings;v_wallet public.wallets;v_escrow public.escrow_transactions;v_new_balance numeric;v_release_ref text;
BEGIN
  SELECT * INTO v_customer FROM public.profiles WHERE auth_id=auth.uid()::text AND role='user' AND coalesce(deleted,false)=false AND coalesce(suspended,false)=false AND coalesce(banned,false)=false LIMIT 1;
  IF v_customer IS NULL THEN RAISE EXCEPTION 'Active customer account required'; END IF;
  SELECT * INTO v_booking FROM public.worker_bookings WHERE id=p_booking_id FOR UPDATE;
  IF v_booking IS NULL OR v_booking.user_id<>v_customer.user_id THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF v_booking.status<>'completed_pending_approval' THEN RAISE EXCEPTION 'Booking is not pending approval'; END IF;
  SELECT * INTO v_escrow FROM public.escrow_transactions WHERE booking_id=p_booking_id AND booking_type='worker_booking' FOR UPDATE;
  IF v_escrow IS NULL THEN RAISE EXCEPTION 'Escrow not found'; END IF;
  IF v_escrow.status IN ('released','refunded','disputed') THEN RAISE EXCEPTION 'Escrow already finalized: %',v_escrow.status; END IF;
  SELECT * INTO v_wallet FROM public.wallets WHERE owner_id=v_booking.worker_id AND owner_type='worker' FOR UPDATE;
  IF v_wallet IS NULL THEN INSERT INTO public.wallets(owner_id,owner_type) VALUES(v_booking.worker_id,'worker') RETURNING * INTO v_wallet; END IF;
  v_release_ref:='REL-'||p_booking_id::text||'-'||v_booking.worker_id;
  IF EXISTS(SELECT 1 FROM public.wallet_transactions WHERE reference_id=v_release_ref AND reference_type='escrow_release') THEN RAISE EXCEPTION 'Payment already released for this booking'; END IF;
  v_new_balance:=coalesce(v_wallet.available_balance,0)+coalesce(v_booking.worker_receives,0);
  UPDATE public.worker_bookings SET status='approved_released',user_approved=true,completed_at=now(),updated_at=now() WHERE id=p_booking_id;
  UPDATE public.escrow_transactions SET status='released',released_at=now(),released_by=v_customer.user_id,updated_at=now() WHERE booking_id=p_booking_id AND booking_type='worker_booking';
  UPDATE public.wallets SET available_balance=v_new_balance,updated_at=now() WHERE id=v_wallet.id;
  INSERT INTO public.wallet_transactions(user_id,transaction_type,amount,balance_after,reference_id,reference_type,description,metadata,created_at) VALUES(v_booking.worker_id,'escrow_release',coalesce(v_booking.worker_receives,0),v_new_balance,v_release_ref,'escrow_release','Job completion payment for booking '||v_booking.booking_code,jsonb_build_object('booking_id',p_booking_id,'escrow_id',v_escrow.id,'customer_id',v_customer.user_id),now());
  RETURN true;
END;
$$;


--
-- Name: customer_confirm_payment(uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.customer_confirm_payment(p_booking_id uuid, p_user_id text, p_paystack_ref text, p_paystack_tx_id text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_caller TEXT;
  v_caller_role TEXT;
BEGIN
  SELECT user_id, role INTO v_caller, v_caller_role
  FROM profiles WHERE auth_id = auth.uid()::text;

  IF v_caller IS NULL THEN RETURN FALSE; END IF;

  IF v_caller != p_user_id AND v_caller_role NOT IN ('staff','admin','creator') THEN
    RETURN FALSE;
  END IF;

  -- Require server-verified payment reference
  IF NOT EXISTS (
    SELECT 1 FROM verified_paystack_references WHERE paystack_reference = p_paystack_ref
  ) THEN
    RETURN FALSE;
  END IF;

  UPDATE worker_bookings SET
    status = 'confirmed',
    paystack_reference = p_paystack_ref,
    paystack_transaction_id = p_paystack_tx_id,
    updated_at = NOW()
  WHERE id = p_booking_id AND user_id = p_user_id AND status = 'waiting_payment';

  RETURN FOUND;
END;
$$;


--
-- Name: customer_raise_dispute(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.customer_raise_dispute(p_booking_id uuid, p_reason text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_customer public.profiles;v_booking public.worker_bookings;
BEGIN
  SELECT * INTO v_customer FROM public.profiles WHERE auth_id=auth.uid()::text AND role='user' AND coalesce(deleted,false)=false AND coalesce(suspended,false)=false AND coalesce(banned,false)=false LIMIT 1;
  IF v_customer IS NULL THEN RAISE EXCEPTION 'Active customer account required'; END IF;
  IF length(trim(coalesce(p_reason,'')))<5 THEN RAISE EXCEPTION 'Please explain the dispute'; END IF;
  SELECT * INTO v_booking FROM public.worker_bookings WHERE id=p_booking_id FOR UPDATE;
  IF v_booking IS NULL OR v_booking.user_id<>v_customer.user_id OR v_booking.status NOT IN ('completed_pending_approval','in_progress','confirmed') THEN RAISE EXCEPTION 'Booking not eligible for dispute'; END IF;
  UPDATE public.worker_bookings SET status='disputed',dispute_reason=trim(p_reason),updated_at=now() WHERE id=p_booking_id;
  UPDATE public.escrow_transactions SET status='disputed',updated_at=now() WHERE booking_id=p_booking_id AND booking_type='worker_booking' AND status NOT IN ('released','refunded');
  RETURN true;
END;
$$;


--
-- Name: delete_my_worker_showcase_post(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_my_worker_showcase_post(p_post_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ DECLARE v_worker text; v_path text; BEGIN SELECT p.user_id INTO v_worker FROM public.profiles p WHERE p.auth_id=auth.uid()::text AND p.role='worker' LIMIT 1; IF v_worker IS NULL THEN RAISE EXCEPTION 'Worker account required'; END IF; UPDATE public.worker_showcase_posts SET deleted_at=now() WHERE id=p_post_id AND worker_id=v_worker AND deleted_at IS NULL RETURNING storage_path INTO v_path; IF v_path IS NULL THEN RAISE EXCEPTION 'Showcase post not found'; END IF; RETURN v_path; END; $$;


--
-- Name: delete_service_category(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_service_category(p_category_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$ BEGIN DELETE FROM public.service_subcategories WHERE category_id = p_category_id; DELETE FROM public.service_categories WHERE id = p_category_id; END; $$;


--
-- Name: delete_service_subcategory(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_service_subcategory(p_subcategory_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$ BEGIN DELETE FROM public.service_subcategories WHERE id = p_subcategory_id; END; $$;


--
-- Name: delete_user_account(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_user_account(p_user_id text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_caller_auth_id TEXT;
  v_target RECORD;
  v_listing_count INTEGER;
  v_unresolved_bookings INTEGER;
  v_active_escrow INTEGER;
  v_wallet_balance DECIMAL(12,2);
BEGIN
  -- Get the caller's auth_id
  v_caller_auth_id := auth.uid()::text;

  -- Fetch target profile
  SELECT * INTO v_target FROM public.profiles WHERE user_id = p_user_id;
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- SELF-DELETE: caller must match target
  IF v_target.auth_id = v_caller_auth_id THEN
    -- Self-deletion restrictions: Admin/Creator/Staff cannot self-delete
    IF v_target.role IN ('admin', 'creator', 'staff') THEN
      RAISE EXCEPTION 'Admin/Creator/Staff accounts cannot be self-deleted. Contact the Creator to remove your account.';
    END IF;

    -- Property Partner: check if they have EVER listed a property (any status)
    IF v_target.role = 'property_partner' THEN
      SELECT COUNT(*) INTO v_listing_count
      FROM public.listings
      WHERE partner_id = p_user_id;

      IF v_listing_count > 0 THEN
        RAISE EXCEPTION 'Cannot delete account: you have previously listed properties. Contact support to close your partner account.';
      END IF;
    END IF;

    -- Worker: comprehensive obligation check before self-closure
    IF v_target.role = 'worker' THEN
      -- 1. Check for unresolved bookings (confirmed statuses from repository)
      SELECT COUNT(*) INTO v_unresolved_bookings
      FROM public.worker_bookings
      WHERE worker_id = p_user_id
        AND status NOT IN ('approved_released', 'cancelled', 'refunded');

      IF v_unresolved_bookings > 0 THEN
        RAISE EXCEPTION 'Cannot delete account: you have % unresolved booking(s). Complete or cancel all jobs first.', v_unresolved_bookings;
      END IF;

      -- 2. Check for active escrow (confirmed statuses from schema)
      SELECT COUNT(*) INTO v_active_escrow
      FROM public.escrow_transactions et
      JOIN public.worker_bookings wb ON et.booking_id = wb.id
      WHERE wb.worker_id = p_user_id
        AND et.status NOT IN ('released', 'refunded');

      IF v_active_escrow > 0 THEN
        RAISE EXCEPTION 'Cannot delete account: you have % active escrow transaction(s). Resolve all payments first.', v_active_escrow;
      END IF;

      -- 3. Check wallet balance (any positive balance = obligation remains)
      SELECT COALESCE(available_balance, 0) + COALESCE(pending_balance, 0) + COALESCE(frozen_balance, 0)
      INTO v_wallet_balance
      FROM public.wallets
      WHERE owner_id = p_user_id AND owner_type = 'worker';

      IF v_wallet_balance IS NOT NULL AND v_wallet_balance > 0 THEN
        RAISE EXCEPTION 'Cannot delete account: you have a wallet balance of N%. Withdraw all funds first.', v_wallet_balance;
      END IF;
    END IF;

  ELSE
    -- ADMIN-INITIATED DELETE: only admin/creator can delete other accounts
    DECLARE
      v_caller_role TEXT;
    BEGIN
      SELECT role INTO v_caller_role FROM public.profiles WHERE auth_id = v_caller_auth_id;
      IF v_caller_role NOT IN ('admin', 'creator') THEN
        RAISE EXCEPTION 'You do not have permission to delete this account';
      END IF;
      IF v_target.role = 'creator' THEN
        RAISE EXCEPTION 'Creator accounts cannot be deleted';
      END IF;

      -- LGA scope check for admin (Creator is exempt)
      PERFORM public._assert_admin_lga_scope(p_user_id);
    END;
  END IF;

  -- Soft-delete the profile
  -- NOTE: deleted and suspended are SEPARATE concepts.
  -- A deleted account is NOT automatically suspended.
  UPDATE public.profiles
  SET deleted = TRUE,
      deleted_at = NOW(),
      updated_at = NOW()
  WHERE user_id = p_user_id;

  -- Log the deletion
  INSERT INTO public.audit_logs (action, target_type, target_id, details, admin_id)
  VALUES ('DELETE_ACCOUNT', 'profiles', p_user_id,
          jsonb_build_object('role', v_target.role, 'by_owner', v_target.auth_id = v_caller_auth_id)::text,
          v_caller_auth_id);

  -- Note: We do NOT delete the auth.users row here.
  -- The auth record is kept for audit. The soft-delete prevents login.
  -- A separate cleanup job can purge old deleted accounts.
END;
$$;


--
-- Name: disable_creator_auth(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.disable_creator_auth(p_password text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
                                            DECLARE v_hash TEXT;
                                            BEGIN
                                              SELECT value INTO v_hash FROM platform_settings WHERE key = 'creator_auth_hash';
                                                IF v_hash IS NULL OR v_hash = '' THEN RETURN FALSE; END IF;
                                                  IF v_hash != crypt(p_password, v_hash) THEN RETURN FALSE; END IF;
                                                    UPDATE platform_settings SET value = 'false', updated_at = NOW() WHERE key = 'creator_auth_enabled';
                                                      RETURN TRUE;
                                                      END;
                                                      $$;


--
-- Name: edit_my_booking_message(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.edit_my_booking_message(p_message_id uuid, p_content text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_user_id text; v_row public.booking_messages;
begin
  select user_id into v_user_id from public.profiles where auth_id=auth.uid()::text limit 1;
  if v_user_id is null then raise exception 'Authenticated profile required'; end if;
  update public.booking_messages set content=coalesce(p_content,'') where id=p_message_id and sender_id=v_user_id returning * into v_row;
  if v_row.id is null then raise exception 'Message not found or not yours'; end if;
  return jsonb_build_object('id',v_row.id,'content',v_row.content,'edited_at',v_row.edited_at);
end;
$$;


--
-- Name: edit_my_roommate_message(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.edit_my_roommate_message(p_message_id uuid, p_content text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_user_id text; v_row public.messages;
begin
  select user_id into v_user_id from public.profiles where auth_id=auth.uid()::text limit 1;
  if v_user_id is null then raise exception 'Authenticated profile required'; end if;
  update public.messages set content=coalesce(p_content,'') where id=p_message_id and sender_id=v_user_id returning * into v_row;
  if v_row.id is null then raise exception 'Message not found or not yours'; end if;
  return jsonb_build_object('id',v_row.id,'content',v_row.content,'edited_at',v_row.edited_at);
end;
$$;


--
-- Name: end_private_call(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.end_private_call(p_call_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_me text:=public.current_profile_user_id(); v_call public.private_calls;
begin
 select * into v_call from public.private_calls where id=p_call_id for update;
 if v_call is null or v_me not in (v_call.caller_id,v_call.callee_id) then raise exception 'Call not found'; end if;
 if v_call.status in ('ringing','accepted') then update public.private_calls set status=case when v_call.status='ringing' then 'missed' else 'ended' end,ended_at=now() where id=p_call_id; end if;
 return public.get_private_call_details(p_call_id);
end; $$;


--
-- Name: enforce_chat_message_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_chat_message_update() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user_id text;
  v_window interval:=make_interval(mins=>public.message_edit_window_minutes());
begin
  if current_setting('request.jwt.claim.role',true)='service_role' then return new; end if;
  select user_id into v_user_id from public.profiles where auth_id=auth.uid()::text limit 1;
  if v_user_id is null then raise exception 'Authenticated profile required'; end if;

  if tg_table_name='messages' then
    if new.id is distinct from old.id or new.conversation_id is distinct from old.conversation_id or new.sender_id is distinct from old.sender_id or new.created_at is distinct from old.created_at or new.attachments is distinct from old.attachments or new.attachment_types is distinct from old.attachment_types or new.file_url is distinct from old.file_url or new.file_name is distinct from old.file_name or new.file_type is distinct from old.file_type then
      raise exception 'Message metadata cannot be changed';
    end if;
    if new.seen is distinct from old.seen then
      if old.sender_id=v_user_id then raise exception 'You cannot change the read receipt on your own sent message'; end if;
      if old.seen=true or new.seen<>true then raise exception 'Read receipts can only move from unread to read'; end if;
    end if;
    if new.content is distinct from old.content then
      if old.sender_id<>v_user_id then raise exception 'You can only edit your own messages'; end if;
      if now()>old.created_at+v_window then raise exception 'This message can no longer be edited'; end if;
      if nullif(btrim(coalesce(new.content,'')),'') is null and coalesce(array_length(old.attachments,1),0)=0 and nullif(btrim(coalesce(old.file_url,'')),'') is null then raise exception 'Message cannot be empty'; end if;
      new.content:=btrim(coalesce(new.content,''));
      new.edited_at:=now();
    else
      new.edited_at:=old.edited_at;
    end if;
    return new;
  end if;

  if tg_table_name='booking_messages' then
    if new.id is distinct from old.id or new.conversation_id is distinct from old.conversation_id or new.sender_id is distinct from old.sender_id or new.created_at is distinct from old.created_at or new.attachments is distinct from old.attachments then
      raise exception 'Message metadata cannot be changed';
    end if;
    if new.is_read is distinct from old.is_read then
      if old.sender_id=v_user_id then raise exception 'You cannot change the read receipt on your own sent message'; end if;
      if old.is_read=true or new.is_read<>true then raise exception 'Read receipts can only move from unread to read'; end if;
    end if;
    if new.content is distinct from old.content then
      if old.sender_id<>v_user_id then raise exception 'You can only edit your own messages'; end if;
      if now()>old.created_at+v_window then raise exception 'This message can no longer be edited'; end if;
      if nullif(btrim(coalesce(new.content,'')),'') is null and coalesce(array_length(old.attachments,1),0)=0 then raise exception 'Message cannot be empty'; end if;
      new.content:=btrim(coalesce(new.content,''));
      new.edited_at:=now();
    else
      new.edited_at:=old.edited_at;
    end if;
    return new;
  end if;

  return new;
end;
$$;


--
-- Name: enforce_hotel_booking_integrity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_hotel_booking_integrity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_actor public.profiles;
  v_hotel public.hotels;
  v_room public.hotel_rooms;
  v_reserved integer;
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND NOT COALESCE(deleted,false)
    AND NOT COALESCE(suspended,false)
    AND NOT COALESCE(banned,false)
  LIMIT 1;

  IF TG_OP='INSERT' THEN
    IF v_actor IS NULL OR v_actor.role<>'user' THEN RAISE EXCEPTION 'Active User account required'; END IF;
    NEW.user_id:=v_actor.user_id;
    NEW.status:='pending';
    NEW.payment_status:='unpaid';
    NEW.payment_expires_at:=COALESCE(NEW.payment_expires_at,now()+interval '30 minutes');
    IF NEW.check_in IS NULL OR NEW.check_out IS NULL OR NEW.check_in<=CURRENT_DATE OR NEW.check_out<=NEW.check_in THEN RAISE EXCEPTION 'Choose valid future check-in and check-out dates'; END IF;
    IF COALESCE(NEW.guest_count,0)<1 THEN RAISE EXCEPTION 'At least one guest is required'; END IF;
    IF NULLIF(btrim(NEW.guest_name),'') IS NULL OR NULLIF(btrim(NEW.guest_phone),'') IS NULL THEN RAISE EXCEPTION 'Guest name and phone are required'; END IF;

    SELECT * INTO v_hotel
    FROM public.hotels
    WHERE hotel_id=NEW.hotel_id AND status='active' AND approved_at IS NOT NULL AND published_at IS NOT NULL;
    IF v_hotel IS NULL THEN RAISE EXCEPTION 'Hotel is not available for booking'; END IF;

    SELECT * INTO v_room
    FROM public.hotel_rooms
    WHERE room_id=NEW.room_id AND hotel_id=NEW.hotel_id
    FOR UPDATE;
    IF v_room IS NULL THEN RAISE EXCEPTION 'Room type not found for this hotel'; END IF;
    IF NEW.guest_count>COALESCE(v_room.max_guests,2) THEN RAISE EXCEPTION 'Guest count exceeds this room type capacity'; END IF;
    IF COALESCE(v_room.total_rooms,0)<1 OR COALESCE(v_room.price_per_night,0)<=0 THEN RAISE EXCEPTION 'Room type is not available for booking'; END IF;

    SELECT count(*)::integer INTO v_reserved
    FROM public.hotel_bookings hb
    WHERE hb.room_id=NEW.room_id
      AND hb.check_in<NEW.check_out AND hb.check_out>NEW.check_in
      AND (
        hb.status IN ('confirmed','checked_in')
        OR (hb.status='pending' AND COALESCE(hb.payment_expires_at,hb.created_at+interval '30 minutes')>now())
      );
    IF v_reserved>=v_room.total_rooms THEN RAISE EXCEPTION 'This room type is fully booked for those dates'; END IF;

    NEW.total_nights:=NEW.check_out-NEW.check_in;
    NEW.total_price:=NEW.total_nights*v_room.price_per_night;
    NEW.created_at:=COALESCE(NEW.created_at,now());
    NEW.updated_at:=now();
    RETURN NEW;
  END IF;

  IF TG_OP='UPDATE' THEN
    -- Trusted SECURITY DEFINER payment/operations functions own lifecycle updates.
    IF current_user NOT IN ('anon','authenticated') THEN
      NEW.updated_at:=now();
      RETURN NEW;
    END IF;
    IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
    IF v_actor.role='creator' THEN NEW.updated_at:=now(); RETURN NEW; END IF;
    IF v_actor.role<>'user' OR OLD.user_id IS DISTINCT FROM v_actor.user_id THEN RAISE EXCEPTION 'Booking owner access required'; END IF;
    IF OLD.status<>'pending' OR NEW.status<>'cancelled' OR OLD.payment_status='paid' THEN
      RAISE EXCEPTION 'Customers can only cancel their own unpaid pending booking';
    END IF;
    NEW.hotel_id:=OLD.hotel_id; NEW.room_id:=OLD.room_id; NEW.user_id:=OLD.user_id;
    NEW.check_in:=OLD.check_in; NEW.check_out:=OLD.check_out; NEW.guest_count:=OLD.guest_count;
    NEW.total_nights:=OLD.total_nights; NEW.total_price:=OLD.total_price;
    NEW.guest_name:=OLD.guest_name; NEW.guest_phone:=OLD.guest_phone; NEW.special_requests:=OLD.special_requests;
    NEW.payment_reference:=OLD.payment_reference; NEW.paid_at:=OLD.paid_at; NEW.confirmed_at:=OLD.confirmed_at;
    NEW.created_at:=OLD.created_at; NEW.updated_at:=now();
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: enforce_property_partner_listing_owner(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_property_partner_listing_owner() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_partner_role TEXT;
BEGIN
  IF NEW.partner_id IS NOT NULL AND BTRIM(NEW.partner_id) <> '' THEN
    SELECT role INTO v_partner_role
    FROM public.profiles
    WHERE user_id = NEW.partner_id
    LIMIT 1;

    IF v_partner_role IS NULL THEN RAISE EXCEPTION 'Assigned Property Partner profile was not found'; END IF;
    IF v_partner_role <> 'property_partner' THEN RAISE EXCEPTION 'Assigned listing partner must have property_partner role'; END IF;
    NEW.owner_id := NEW.partner_id;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: ensure_my_property_partner_wallet(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ensure_my_property_partner_wallet() RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_user_id TEXT; v_role TEXT; v_wallet_id UUID;
BEGIN
  SELECT user_id, role INTO v_user_id, v_role
  FROM public.profiles WHERE auth_id = auth.uid()::TEXT LIMIT 1;
  IF v_user_id IS NULL OR v_role <> 'property_partner' THEN
    RAISE EXCEPTION 'Property Partner account required';
  END IF;
  INSERT INTO public.wallets (owner_id, owner_type, available_balance, pending_balance, frozen_balance, total_withdrawn)
  VALUES (v_user_id, 'property_partner', 0, 0, 0, 0)
  ON CONFLICT (owner_id, owner_type) DO NOTHING;
  SELECT id INTO v_wallet_id FROM public.wallets
  WHERE owner_id = v_user_id AND owner_type = 'property_partner';
  RETURN v_wallet_id;
END;
$$;


--
-- Name: expire_old_searches(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.expire_old_searches() RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
                      DECLARE
                        updated_count INTEGER;
                        BEGIN
                          UPDATE roommate_preferences
                            SET search_status = 'expired'
                              WHERE search_status = 'active'
                                  AND search_expires_at < NOW();
                                    GET DIAGNOSTICS updated_count = ROW_COUNT;
                                      RETURN updated_count;
                                      END;
                                      $$;


--
-- Name: expire_overdue_reservations(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.expire_overdue_reservations() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE v_role text; v_count integer:=0; v_row record;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    SELECT role INTO v_role FROM public.profiles WHERE auth_id=auth.uid()::text AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
    IF v_role<>'creator' THEN RAISE EXCEPTION 'Creator or service execution required'; END IF;
  END IF;
  FOR v_row IN
    SELECT r.id,r.listing_id,r.status,r.payment_reference
    FROM public.reservations r
    WHERE (r.status='payment_pending' AND r.payment_expires_at<now())
       OR (r.status IN ('reserved','inspection_pending','ready_for_move_in') AND r.hold_expires_at<now())
    FOR UPDATE
  LOOP
    IF v_row.status='payment_pending' AND EXISTS(
      SELECT 1 FROM public.booking_payments bp WHERE bp.paystack_reference=v_row.payment_reference AND bp.status IN ('paid','completed')
    ) THEN CONTINUE; END IF;
    UPDATE public.reservations SET status='expired',refund_amount=0,refund_reason='Reservation hold expired',processed_at=now(),updated_at=now() WHERE id=v_row.id;
    UPDATE public.booking_payments SET status='expired',updated_at=now() WHERE paystack_reference=v_row.payment_reference AND status='pending';
    UPDATE public.listings SET status='available',availability_status='available',reserved_by=NULL,reservation_expiry=NULL,
      reservation_fee_paid=false,chat_unlocked=false,current_reservation_id=NULL,updated_at=now()
    WHERE id::text=v_row.listing_id AND current_reservation_id=v_row.id;
    v_count:=v_count+1;
  END LOOP;
  RETURN v_count;
END;
$$;


--
-- Name: expire_stale_hotel_booking_holds(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.expire_stale_hotel_booking_holds() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE v_count integer;
BEGIN
  WITH expired AS (
    UPDATE public.hotel_bookings hb
    SET status='expired',payment_status='expired',updated_at=now()
    WHERE hb.status='pending'
      AND hb.payment_status IN ('unpaid','payment_pending')
      AND hb.payment_expires_at IS NOT NULL
      AND hb.payment_expires_at<now()
      AND NOT EXISTS (
        SELECT 1 FROM public.booking_payments bp
        WHERE bp.hotel_booking_id=hb.booking_id AND bp.purpose='hotel_booking' AND bp.status IN ('paid','completed')
      )
    RETURNING hb.booking_id
  )
  SELECT count(*)::integer INTO v_count FROM expired;

  UPDATE public.booking_payments bp
  SET status='expired',updated_at=now()
  WHERE bp.purpose='hotel_booking' AND bp.status='pending'
    AND EXISTS (
      SELECT 1 FROM public.hotel_bookings hb
      WHERE hb.booking_id=bp.hotel_booking_id AND hb.status='expired'
    );
  RETURN COALESCE(v_count,0);
END;
$$;


--
-- Name: fail_withdrawal(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fail_withdrawal(p_withdrawal_id uuid, p_reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor public.profiles;
  v_is_service boolean:=COALESCE(current_setting('request.jwt.claim.role',true),'')='service_role';
  v_withdrawal public.withdrawals;
  v_wallet public.wallets;
  v_new_balance numeric;
BEGIN
  IF NOT v_is_service THEN
    SELECT * INTO v_actor FROM public.profiles
    WHERE auth_id=auth.uid()::text
      AND NOT COALESCE(deleted,false)
      AND NOT COALESCE(suspended,false)
      AND NOT COALESCE(banned,false)
    LIMIT 1;
    IF v_actor IS NULL OR NOT (
      v_actor.role='creator' OR
      (v_actor.role='staff' AND EXISTS(
        SELECT 1 FROM public.staff_permissions sp
        WHERE sp.staff_id=v_actor.user_id AND sp.permission='finance' AND sp.is_active=true
      ))
    ) THEN
      RAISE EXCEPTION 'Finance authority required';
    END IF;
  END IF;

  SELECT * INTO v_withdrawal FROM public.withdrawals WHERE id=p_withdrawal_id FOR UPDATE;
  IF v_withdrawal IS NULL THEN RETURN jsonb_build_object('success',false,'error','Withdrawal not found'); END IF;
  IF v_withdrawal.status NOT IN('pending','processing') THEN RETURN jsonb_build_object('success',false,'error','Cannot fail this withdrawal'); END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE id=v_withdrawal.wallet_id FOR UPDATE;
  IF v_wallet IS NULL THEN RETURN jsonb_build_object('success',false,'error','Wallet not found'); END IF;

  v_new_balance:=COALESCE(v_wallet.available_balance,0)+v_withdrawal.amount;
  UPDATE public.wallets
  SET available_balance=v_new_balance,
      pending_balance=CASE WHEN owner_type='worker' THEN GREATEST(COALESCE(pending_balance,0)-v_withdrawal.amount,0) ELSE pending_balance END,
      frozen_balance=CASE WHEN owner_type='property_partner' THEN GREATEST(COALESCE(frozen_balance,0)-v_withdrawal.amount,0) ELSE frozen_balance END,
      updated_at=now()
  WHERE id=v_wallet.id;

  UPDATE public.withdrawals
  SET status='failed',failed_reason=NULLIF(btrim(p_reason),''),updated_at=now()
  WHERE id=p_withdrawal_id;

  INSERT INTO public.wallet_transactions(user_id,transaction_type,amount,balance_after,reference_id,reference_type,description,metadata,created_at)
  VALUES(v_wallet.owner_id,'withdrawal_reversal',v_withdrawal.amount,v_new_balance,p_withdrawal_id::text,'withdrawal','Withdrawal failed; held funds returned',jsonb_build_object('wallet_id',v_wallet.id,'owner_type',v_wallet.owner_type,'reason',NULLIF(btrim(p_reason),'')),now());

  INSERT INTO public.financial_audit_logs(event_type,user_id,amount,reference_id,reference_type,description,metadata)
  VALUES('withdrawal_failed',v_wallet.owner_id,v_withdrawal.amount,p_withdrawal_id::text,'withdrawal','Withdrawal failed and held funds returned',jsonb_build_object('reason',NULLIF(btrim(p_reason),''),'actor',CASE WHEN v_is_service THEN 'service_role' ELSE v_actor.user_id END));

  RETURN jsonb_build_object('success',true,'amount_returned',v_withdrawal.amount,'new_balance',v_new_balance);
END;
$$;


--
-- Name: field_officer_update_inspection_location(uuid, numeric, numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.field_officer_update_inspection_location(p_inspection_id uuid, p_latitude numeric, p_longitude numeric, p_accuracy_m numeric DEFAULT NULL::numeric) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles; v_ir public.inspection_requests;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor.user_id IS NULL OR v_actor.role<>'staff' OR NOT public.current_staff_has_permission('field_officer') THEN
    RAISE EXCEPTION 'Field Officer permission required';
  END IF;
  IF p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180 THEN RAISE EXCEPTION 'Invalid coordinates'; END IF;
  IF p_accuracy_m IS NOT NULL AND p_accuracy_m<0 THEN RAISE EXCEPTION 'Invalid location accuracy'; END IF;

  SELECT * INTO v_ir FROM public.inspection_requests WHERE id=p_inspection_id FOR UPDATE;
  IF v_ir.id IS NULL THEN RAISE EXCEPTION 'Property inspection not found'; END IF;
  IF COALESCE(v_ir.assigned_field_officer_id,v_ir.field_officer_id,v_ir.assigned_to) IS DISTINCT FROM v_actor.user_id THEN
    RAISE EXCEPTION 'This inspection is not assigned to you';
  END IF;
  IF v_ir.published_at IS NOT NULL THEN RAISE EXCEPTION 'Published property location must be corrected by Property Operations'; END IF;

  UPDATE public.inspection_requests
  SET gps_latitude=p_latitude,gps_longitude=p_longitude,location_accuracy_m=p_accuracy_m,updated_at=NOW()
  WHERE id=p_inspection_id;

  IF v_ir.draft_listing_id IS NOT NULL THEN
    UPDATE public.listings
    SET gps_latitude=p_latitude,gps_longitude=p_longitude,updated_at=NOW()
    WHERE id=v_ir.draft_listing_id AND deleted_at IS NULL;
  END IF;
  RETURN true;
END $$;


--
-- Name: freeze_wallet(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.freeze_wallet(p_wallet_id uuid, p_reason text, p_frozen_by text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor public.profiles;
  v_is_service boolean:=COALESCE(current_setting('request.jwt.claim.role',true),'')='service_role';
  v_actor_id text;
  v_wallet public.wallets;
BEGIN
  IF v_is_service THEN
    v_actor_id:='service_role';
  ELSE
    SELECT * INTO v_actor FROM public.profiles
    WHERE auth_id=auth.uid()::text
      AND NOT COALESCE(deleted,false)
      AND NOT COALESCE(suspended,false)
      AND NOT COALESCE(banned,false)
    LIMIT 1;
    IF v_actor IS NULL OR NOT (
      v_actor.role='creator' OR
      (v_actor.role='staff' AND EXISTS(
        SELECT 1 FROM public.staff_permissions sp
        WHERE sp.staff_id=v_actor.user_id AND sp.permission='finance' AND sp.is_active=true
      ))
    ) THEN
      RAISE EXCEPTION 'Finance authority required';
    END IF;
    v_actor_id:=v_actor.user_id;
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE id=p_wallet_id FOR UPDATE;
  IF v_wallet IS NULL THEN RETURN jsonb_build_object('success',false,'error','Wallet not found'); END IF;
  IF COALESCE(v_wallet.is_frozen,false) THEN RETURN jsonb_build_object('success',true,'already_frozen',true); END IF;

  UPDATE public.wallets
  SET is_frozen=true,
      frozen_reason=NULLIF(btrim(p_reason),''),
      frozen_by=v_actor_id,
      frozen_at=now(),
      frozen_balance=COALESCE(frozen_balance,0)+COALESCE(available_balance,0),
      available_balance=0,
      updated_at=now()
  WHERE id=p_wallet_id;

  INSERT INTO public.financial_audit_logs(event_type,user_id,amount,reference_id,reference_type,description,metadata)
  VALUES('wallet_frozen',v_wallet.owner_id,COALESCE(v_wallet.available_balance,0),p_wallet_id::text,'wallet',COALESCE(NULLIF(btrim(p_reason),''),'Wallet frozen'),jsonb_build_object('actor',v_actor_id));

  RETURN jsonb_build_object('success',true);
END;
$$;


--
-- Name: fulfill_apartment_rent_payment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fulfill_apartment_rent_payment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_res public.reservations; v_listing public.listings; v_start_months integer:=4; v_installment_amount numeric; v_upfront_percent numeric;
  v_expected numeric;
BEGIN
  IF NEW.purpose<>'apartment_rent' OR NEW.status NOT IN ('paid','completed') THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.status IN ('paid','completed') THEN RETURN NEW; END IF;
  SELECT * INTO v_res FROM public.reservations WHERE id=NEW.metadata->>'reservation_id' AND user_id=COALESCE(NEW.payer_user_id,NEW.user_id) FOR UPDATE;
  IF v_res IS NULL THEN RAISE EXCEPTION 'Apartment payment has no matching reservation'; END IF;
  SELECT * INTO v_listing FROM public.listings WHERE id::text=v_res.listing_id FOR SHARE;
  IF v_listing IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF;
  IF v_res.rent_payment_reference IS DISTINCT FROM NEW.paystack_reference THEN RAISE EXCEPTION 'Apartment payment reference mismatch'; END IF;

  IF COALESCE(v_res.stay_type,v_listing.sub_type)='short_let' THEN
    IF NEW.metadata->>'payment_component'<>'short_stay_rent' THEN RAISE EXCEPTION 'Short Stay payment component mismatch'; END IF;
    IF v_res.status NOT IN ('reserved','ready_for_move_in') THEN RAISE EXCEPTION 'Short Stay reservation is not ready for settlement'; END IF;
    v_expected:=round(COALESCE(v_res.stay_rent_total,0)+COALESCE(v_res.security_deposit_snapshot,0),2);
    IF round(COALESCE(NEW.verified_amount,NEW.amount_total,NEW.amount),2)<>v_expected THEN RAISE EXCEPTION 'Short Stay payment amount mismatch'; END IF;
    UPDATE public.reservations
    SET rent_payment_status='paid',rent_paid_at=COALESCE(rent_paid_at,now()),security_deposit_status='held',
        status=CASE WHEN status='reserved' THEN 'ready_for_move_in' ELSE status END,updated_at=now()
    WHERE id=v_res.id;
    RETURN NEW;
  END IF;

  IF NEW.metadata->>'payment_component'<>'long_stay_rent' THEN RAISE EXCEPTION 'Long Stay payment component mismatch'; END IF;
  IF v_res.status NOT IN ('reserved','ready_for_move_in') THEN RAISE EXCEPTION 'Long Stay reservation is not ready for rent settlement'; END IF;
  IF round(COALESCE(NEW.verified_amount,NEW.amount_total,NEW.amount),2)<>round(COALESCE(v_res.annual_rent_snapshot,v_res.upfront_rent_required,0),2) THEN RAISE EXCEPTION 'Year 1 rent payment amount mismatch'; END IF;
  UPDATE public.reservations
  SET rent_payment_status=CASE WHEN installment_balance>0 THEN 'upfront_paid' ELSE 'paid' END,rent_paid_at=COALESCE(rent_paid_at,now()),
      status=CASE WHEN status='reserved' THEN 'ready_for_move_in' ELSE status END,updated_at=now()
  WHERE id=v_res.id;

  IF COALESCE(v_res.installment_balance,0)>0 THEN
    SELECT COALESCE(NULLIF(value,'')::integer,4) INTO v_start_months FROM public.platform_settings WHERE key='rent_plan_start_after_months' AND COALESCE(is_active,true)=true LIMIT 1;
    IF v_start_months IS NULL OR v_start_months<>4 THEN v_start_months:=4; END IF;
    v_installment_amount:=round(COALESCE(v_res.annual_rent_snapshot,0)/8.0,2);
    v_upfront_percent:=round(100.0/GREATEST(COALESCE(v_res.rental_plan_years,1),1),2);
    INSERT INTO public.rent_plans(user_id,listing_id,reservation_id,target_amount,start_after_months,cancellation_fee_percent,accepted_terms,status,total_contract_rent,upfront_percent,upfront_amount,installment_count,installment_amount,installment_balance,paid_installments,created_at,updated_at)
    VALUES(v_res.user_id,v_res.listing_id::uuid,v_res.id,v_res.installment_balance,v_start_months,
      COALESCE((SELECT NULLIF(value,'')::numeric FROM public.platform_settings WHERE key='rent_plan_cancellation_fee_percent' LIMIT 1),10),
      jsonb_build_object('tenure_years',v_res.rental_plan_years,'annual_rent',v_res.annual_rent_snapshot,'year_one_paid_in_full',true,'year_one_upfront',v_res.upfront_rent_required,'future_rent_balance',v_res.installment_balance,'start_after_months',4,'contributions_per_future_year',8,'future_years',GREATEST(COALESCE(v_res.rental_plan_years,1)-1,0),'snapshot_at',now())::text,
      'active',v_res.contract_rent_total,v_upfront_percent,v_res.upfront_rent_required,v_res.installment_count,v_installment_amount,v_res.installment_balance,0,now(),now())
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: fulfill_apartment_reservation_payment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fulfill_apartment_reservation_payment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_res public.reservations;
  v_listing public.listings;
  v_hold_days integer;
  v_hold_expires timestamptz;
  v_is_short boolean;
BEGIN
  IF NEW.purpose<>'apartment_reservation' OR NEW.status NOT IN ('paid','completed') THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.status IN ('paid','completed') THEN RETURN NEW; END IF;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE payment_reference=NEW.paystack_reference
  LIMIT 1
  FOR UPDATE;
  IF v_res IS NULL THEN RAISE EXCEPTION 'Apartment reservation payment has no reservation'; END IF;
  IF v_res.user_id IS DISTINCT FROM COALESCE(NEW.payer_user_id,NEW.user_id) THEN
    RAISE EXCEPTION 'Apartment reservation payment owner mismatch';
  END IF;

  SELECT * INTO v_listing
  FROM public.listings
  WHERE id::text=v_res.listing_id
  LIMIT 1
  FOR UPDATE;
  IF v_listing IS NULL THEN RAISE EXCEPTION 'Apartment reservation listing not found'; END IF;
  v_is_short := COALESCE(v_res.stay_type,v_listing.sub_type,'long_stay')='short_let';

  IF v_is_short THEN
    IF EXISTS (
      SELECT 1
      FROM public.reservations r
      WHERE r.listing_id=v_res.listing_id
        AND r.id<>v_res.id
        AND r.status = ANY (ARRAY['payment_pending','reserved','inspection_pending','ready_for_move_in','occupied']::text[])
        AND (
          COALESCE(r.stay_type,'long_stay')<>'short_let'
          OR daterange(r.stay_check_in,r.stay_check_out,'[)') && daterange(v_res.stay_check_in,v_res.stay_check_out,'[)')
        )
    ) THEN
      UPDATE public.reservations
      SET status='payment_conflict',manual_payment_status='paid',paid_at=COALESCE(paid_at,now()),
          refund_reason='Payment completed after the selected dates became unavailable',processed_at=now(),updated_at=now()
      WHERE id=v_res.id;
      RETURN NEW;
    END IF;
  ELSE
    IF v_listing.current_reservation_id IS DISTINCT FROM v_res.id AND v_listing.status<>'available' THEN
      UPDATE public.reservations
      SET status='payment_conflict',manual_payment_status='paid',paid_at=COALESCE(paid_at,now()),
          refund_reason='Payment completed after the property was assigned elsewhere',processed_at=now(),updated_at=now()
      WHERE id=v_res.id;
      RETURN NEW;
    END IF;
  END IF;

  SELECT NULLIF(value,'')::integer INTO v_hold_days
  FROM public.platform_settings
  WHERE key='apartment_reservation_hold_days' AND COALESCE(is_active,true)=true
  LIMIT 1;
  IF v_hold_days IS NULL OR v_hold_days<1 OR v_hold_days>30 THEN v_hold_days:=3; END IF;
  v_hold_expires:=now()+make_interval(days=>v_hold_days);

  UPDATE public.reservations
  SET status=CASE WHEN status='payment_pending' THEN 'reserved' ELSE status END,
      manual_payment_status='paid',
      paid_at=COALESCE(paid_at,now()),
      payment_expires_at=NULL,
      hold_expires_at=CASE WHEN v_is_short THEN NULL ELSE v_hold_expires END,
      updated_at=now()
  WHERE id=v_res.id;

  IF NOT v_is_short THEN
    UPDATE public.listings
    SET status='reserved',availability_status='reserved',reserved_by=v_res.user_id,
        reservation_expiry=v_hold_expires,reservation_fee_paid=true,chat_unlocked=true,
        current_reservation_id=v_res.id,updated_at=now()
    WHERE id=v_listing.id;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: fulfill_hotel_booking_payment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fulfill_hotel_booking_payment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_booking public.hotel_bookings;
  v_room public.hotel_rooms;
  v_reserved integer;
BEGIN
  IF NEW.purpose<>'hotel_booking' OR NEW.status NOT IN ('paid','completed') THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.status IN ('paid','completed') THEN RETURN NEW; END IF;

  SELECT * INTO v_booking
  FROM public.hotel_bookings
  WHERE booking_id=NEW.hotel_booking_id
    AND user_id=COALESCE(NEW.payer_user_id,NEW.user_id)
  FOR UPDATE;
  IF v_booking.booking_id IS NULL THEN RAISE EXCEPTION 'Hotel payment has no matching booking'; END IF;
  IF v_booking.payment_reference IS DISTINCT FROM NEW.paystack_reference THEN RAISE EXCEPTION 'Hotel payment reference mismatch'; END IF;
  IF round(v_booking.total_price,2)<>round(COALESCE(NEW.amount_total,NEW.amount),2) THEN RAISE EXCEPTION 'Hotel payment amount mismatch'; END IF;
  IF v_booking.status='confirmed' AND v_booking.payment_status='paid' THEN RETURN NEW; END IF;

  SELECT * INTO v_room FROM public.hotel_rooms WHERE room_id=v_booking.room_id AND hotel_id=v_booking.hotel_id FOR UPDATE;
  IF v_room.room_id IS NULL THEN RAISE EXCEPTION 'Hotel room no longer exists'; END IF;

  SELECT count(*)::integer INTO v_reserved
  FROM public.hotel_bookings hb
  WHERE hb.room_id=v_booking.room_id
    AND hb.booking_id<>v_booking.booking_id
    AND hb.check_in<v_booking.check_out AND hb.check_out>v_booking.check_in
    AND hb.status IN ('confirmed','checked_in');

  IF v_reserved>=v_room.total_rooms THEN
    UPDATE public.hotel_bookings
    SET status='payment_conflict',payment_status='paid',paid_at=COALESCE(paid_at,now()),updated_at=now()
    WHERE booking_id=v_booking.booking_id;
    RETURN NEW;
  END IF;

  UPDATE public.hotel_bookings
  SET status='confirmed',payment_status='paid',paid_at=COALESCE(paid_at,now()),confirmed_at=COALESCE(confirmed_at,now()),updated_at=now()
  WHERE booking_id=v_booking.booking_id;
  RETURN NEW;
END;
$$;


--
-- Name: fulfill_rent_plan_contribution_payment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fulfill_rent_plan_contribution_payment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_contribution public.rent_plan_contributions;
  v_plan public.rent_plans;
  v_paid_total numeric;
  v_paid_count integer;
  v_remaining integer;
  v_next_due date;
BEGIN
  IF NEW.purpose<>'rent_plan_contribution' OR NEW.status NOT IN ('paid','completed') THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.status IN ('paid','completed') THEN RETURN NEW; END IF;

  SELECT * INTO v_contribution
  FROM public.rent_plan_contributions
  WHERE id=(NEW.metadata->>'contribution_id')::uuid
  FOR UPDATE;
  IF v_contribution.id IS NULL THEN RAISE EXCEPTION 'Rent contribution payment has no schedule row'; END IF;
  IF v_contribution.paystack_reference IS DISTINCT FROM NEW.paystack_reference THEN RAISE EXCEPTION 'Rent contribution reference mismatch'; END IF;
  IF round(v_contribution.amount,2)<>round(COALESCE(NEW.amount_total,NEW.amount),2) THEN RAISE EXCEPTION 'Rent contribution amount mismatch'; END IF;

  UPDATE public.rent_plan_contributions
  SET status='paid',paid_at=COALESCE(paid_at,now()),completed_at=COALESCE(completed_at,now()),updated_at=now()
  WHERE id=v_contribution.id;

  SELECT * INTO v_plan
  FROM public.rent_plans
  WHERE id=v_contribution.rent_plan_id
  FOR UPDATE;
  IF v_plan.id IS NULL THEN RAISE EXCEPTION 'Rent plan not found'; END IF;

  SELECT COALESCE(sum(amount),0),count(*)::integer
  INTO v_paid_total,v_paid_count
  FROM public.rent_plan_contributions
  WHERE rent_plan_id=v_plan.id AND status IN ('paid','completed');

  SELECT count(*)::integer,min(due_date)
  INTO v_remaining,v_next_due
  FROM public.rent_plan_contributions
  WHERE rent_plan_id=v_plan.id AND status IN ('scheduled','payment_pending','pending');

  UPDATE public.rent_plans
  SET total_contributed=v_paid_total,
      paid_installments=v_paid_count,
      installment_balance=GREATEST(COALESCE(target_amount,0)-v_paid_total,0),
      last_contribution_at=now(),
      next_rent_due_date=v_next_due,
      status=CASE WHEN v_remaining=0 THEN 'completed' ELSE 'active' END,
      updated_at=now()
  WHERE id=v_plan.id;

  IF v_remaining=0 THEN
    UPDATE public.reservations
    SET rent_payment_status='paid',updated_at=now()
    WHERE id=v_plan.reservation_id;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: generate_user_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_user_id() RETURNS character varying
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
                                                  DECLARE
                                                    current_year VARCHAR(4);
                                                      next_num INTEGER;
                                                        new_id VARCHAR(20);
                                                        BEGIN
                                                          current_year := TO_CHAR(NOW(), 'YYYY');
                                                            UPDATE user_ids SET last_number = last_number + 1, updated_at = NOW()
                                                              WHERE year = current_year RETURNING last_number INTO next_num;
                                                                IF next_num IS NULL THEN
                                                                    INSERT INTO user_ids (year, last_number) VALUES (current_year, 1)
                                                                        ON CONFLICT (year) DO UPDATE SET last_number = user_ids.last_number + 1
                                                                            RETURNING user_ids.last_number INTO next_num;
                                                                              END IF;
                                                                                new_id := 'WHU-' || current_year || '-' || LPAD(next_num::TEXT, 6, '0');
                                                                                  RETURN new_id;
                                                                                  END;
                                                                                  $$;


--
-- Name: generate_user_id_simple(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_user_id_simple() RETURNS text
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$ DECLARE next_num INTEGER; BEGIN UPDATE user_id_counter SET last_number = last_number + 1 RETURNING last_number INTO next_num; RETURN 'WHU-' || LPAD(next_num::TEXT, 3, '0'); END; $$;


--
-- Name: get_admin_staff_limit_v2(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_admin_staff_limit_v2() RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
  SELECT GREATEST(0,COALESCE(CASE WHEN value ~ '^\d+$' THEN value::integer ELSE 0 END,0))
  FROM public.platform_settings WHERE key='admin_staff_limit' AND is_active=true LIMIT 1;
$_$;


--
-- Name: get_all_settings_v2(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_all_settings_v2() RETURNS TABLE(id integer, key text, value text, label text, description text, category text, data_type text, is_active boolean, updated_at timestamp with time zone)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: get_booking_details(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_booking_details(p_booking_id uuid) RETURNS TABLE(id uuid, booking_code text, user_id text, worker_id text, service_type text, description text, address text, scheduled_date date, agreed_amount numeric, wehouse_fee numeric, worker_commission numeric, worker_receives numeric, negotiated_amount numeric, paystack_reference text, status text, customer_message text, worker_approved boolean, user_approved boolean, dispute_reason text, dispute_resolution text, cancellation_reason text, started_at timestamp with time zone, marked_complete_at timestamp with time zone, completed_at timestamp with time zone, created_at timestamp with time zone, booking_conversation_id uuid, user_name text, worker_name text, user_phone text, worker_phone text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ SELECT wb.id, wb.booking_code, wb.user_id, wb.worker_id, wb.service_type, wb.description, wb.address, wb.scheduled_date, wb.agreed_amount, wb.wehouse_fee, wb.worker_commission, wb.worker_receives, wb.negotiated_amount, wb.paystack_reference, wb.status, wb.customer_message, wb.worker_approved, wb.user_approved, wb.dispute_reason, wb.dispute_resolution, wb.cancellation_reason, wb.started_at, wb.marked_complete_at, wb.completed_at, wb.created_at, wb.booking_conversation_id, u.full_name, w.full_name, u.phone, w.phone FROM worker_bookings wb INNER JOIN profiles u ON u.user_id = wb.user_id INNER JOIN profiles w ON w.user_id = wb.worker_id WHERE wb.id = p_booking_id; $$;


--
-- Name: get_booking_messages(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_booking_messages(p_conversation_id uuid) RETURNS TABLE(id uuid, sender_id text, sender_name text, sender_role text, content text, attachments text[], is_read boolean, created_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE a public.profiles; bc public.booking_conversations;
BEGIN
  a:=public._current_comm_actor();
  IF a IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO bc FROM public.booking_conversations WHERE id=p_conversation_id;
  IF bc IS NULL OR a.user_id NOT IN (bc.user_id,bc.worker_id) THEN RAISE EXCEPTION 'Not authorized for this booking conversation'; END IF;
  RETURN QUERY SELECT bm.id,bm.sender_id,p.full_name,p.role,bm.content,bm.attachments,bm.is_read,bm.created_at
  FROM public.booking_messages bm JOIN public.profiles p ON p.user_id=bm.sender_id
  WHERE bm.conversation_id=p_conversation_id ORDER BY bm.created_at ASC;
END;
$$;


--
-- Name: get_chat_peer_presence(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_chat_peer_presence(p_peer_user_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor public.profiles;
  v_peer public.profiles;
  v_related boolean:=false;
  v_online boolean:=false;
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_peer_user_id IS NULL OR p_peer_user_id=v_actor.user_id THEN RAISE EXCEPTION 'Peer required'; END IF;

  SELECT EXISTS(
    SELECT 1
    FROM public.conversations c
    WHERE c.conversation_type='roommate'
      AND ((c.participant_a=v_actor.user_id AND c.participant_b=p_peer_user_id)
        OR (c.participant_b=v_actor.user_id AND c.participant_a=p_peer_user_id))
      AND public._can_access_conversation(c.id)
  ) OR EXISTS(
    SELECT 1
    FROM public.booking_conversations bc
    WHERE (bc.user_id=v_actor.user_id AND bc.worker_id=p_peer_user_id)
       OR (bc.worker_id=v_actor.user_id AND bc.user_id=p_peer_user_id)
  ) INTO v_related;

  IF NOT v_related THEN RAISE EXCEPTION 'Chat relationship required'; END IF;

  SELECT * INTO v_peer
  FROM public.profiles
  WHERE user_id=p_peer_user_id
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;

  IF v_peer IS NULL THEN
    RETURN jsonb_build_object('visible',false,'online',false,'last_seen',NULL);
  END IF;

  IF COALESCE(v_peer.privacy_activity_visible,true)=false THEN
    RETURN jsonb_build_object('visible',false,'online',false,'last_seen',NULL);
  END IF;

  v_online:=COALESCE(v_peer.is_online,false)
    AND v_peer.last_seen IS NOT NULL
    AND v_peer.last_seen >= now()-interval '90 seconds';

  RETURN jsonb_build_object(
    'visible',true,
    'online',v_online,
    'last_seen',v_peer.last_seen
  );
END;
$$;


--
-- Name: get_conversation_messages(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_conversation_messages(p_conversation_id text) RETURNS TABLE(id uuid, conversation_id uuid, sender_id text, content text, seen boolean, created_at timestamp with time zone, edited_at timestamp with time zone, file_url text, file_name text, file_type text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE cid uuid:=p_conversation_id::uuid;
BEGIN
  IF NOT public._can_access_conversation(cid) THEN RAISE EXCEPTION 'Not authorized for this conversation'; END IF;
  RETURN QUERY SELECT m.id,m.conversation_id,m.sender_id,m.content,m.seen,m.created_at,m.edited_at,m.file_url,m.file_name,m.file_type
  FROM public.messages m WHERE m.conversation_id=cid ORDER BY m.created_at ASC;
END;
$$;


--
-- Name: get_inspection_field_officer_candidates(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_inspection_field_officer_candidates(p_inspection_id uuid) RETURNS TABLE(user_id text, full_name text, username text, assigned_state text, assigned_lga text, active_inspections bigint, distance_km numeric, location_accuracy_m numeric, location_updated_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_actor record; v_req record;
begin
 select user_id,role,assigned_state,assigned_lga,deleted,suspended,banned into v_actor from public.profiles where auth_id=auth.uid()::text limit 1;
 if v_actor is null or v_actor.role not in ('admin','creator') or coalesce(v_actor.deleted,false) or coalesce(v_actor.suspended,false) or coalesce(v_actor.banned,false) then raise exception 'Admin or Creator access required'; end if;
 select id,property_state,property_city,gps_latitude,gps_longitude into v_req from public.inspection_requests where id=p_inspection_id;
 if v_req is null then raise exception 'Inspection request not found'; end if;
 if v_actor.role='admin' and (lower(coalesce(v_actor.assigned_state,''))<>lower(coalesce(v_req.property_state,'')) or lower(coalesce(v_actor.assigned_lga,''))<>lower(coalesce(v_req.property_city,''))) then raise exception 'Inspection is outside your assigned branch'; end if;
 return query select p.user_id,p.full_name,p.username,p.assigned_state,p.assigned_lga,
   (select count(*) from public.inspection_requests ir where coalesce(ir.assigned_field_officer_id,ir.field_officer_id,ir.assigned_to)=p.user_id and ir.status in ('scheduled','in_progress')),
   case when v_req.gps_latitude is not null and v_req.gps_longitude is not null and p.operational_latitude is not null and p.operational_longitude is not null then round((6371*2*asin(sqrt(power(sin(radians((p.operational_latitude-v_req.gps_latitude)/2)),2)+cos(radians(v_req.gps_latitude))*cos(radians(p.operational_latitude))*power(sin(radians((p.operational_longitude-v_req.gps_longitude)/2)),2))))::numeric,2) else null end,
   p.operational_location_accuracy_m,p.operational_location_updated_at
 from public.profiles p
 where p.role='staff' and coalesce(p.deleted,false)=false and coalesce(p.suspended,false)=false and coalesce(p.banned,false)=false
   and lower(coalesce(p.assigned_state,''))=lower(coalesce(v_req.property_state,'')) and lower(coalesce(p.assigned_lga,''))=lower(coalesce(v_req.property_city,''))
   and exists(select 1 from public.staff_permissions sp where sp.staff_id=p.user_id and sp.permission='field_officer' and sp.is_active=true)
 order by distance_km asc nulls last, active_inspections asc, coalesce(p.full_name,p.username,p.user_id);
end $$;


--
-- Name: get_my_active_private_calls(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_active_private_calls() RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
 select coalesce(jsonb_agg(public.get_private_call_details(c.id) order by c.created_at desc),'[]'::jsonb) from public.private_calls c where public.current_profile_user_id() in (c.caller_id,c.callee_id) and c.status in ('ringing','accepted');
$$;


--
-- Name: get_my_admin_staff_capacity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_admin_staff_capacity() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles; v_limit integer:=0; v_used integer:=0;
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role IN('admin','creator')
    AND NOT COALESCE(deleted,false) AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false) LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Admin or Creator access required'; END IF;
  v_limit:=COALESCE(public.get_admin_staff_limit_v2(),0);
  IF v_actor.role='admin' THEN
    SELECT count(*)::integer INTO v_used
    FROM public.profiles p JOIN public.staff_trust_profiles st ON st.staff_id=p.user_id
    WHERE p.role='staff' AND NOT COALESCE(p.deleted,false) AND st.appointed_by=v_actor.user_id;
  END IF;
  RETURN jsonb_build_object('limit',v_limit,'used',v_used,'remaining',CASE WHEN v_limit=0 THEN NULL ELSE GREATEST(0,v_limit-v_used) END,'unlimited',(v_limit=0));
END;$$;


--
-- Name: get_my_assigned_inspection_location(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_assigned_inspection_location(p_inspection_id uuid) RETURNS TABLE(gps_latitude numeric, gps_longitude numeric, location_accuracy_m numeric, property_address text, property_city text, property_state text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_actor record;
begin
 select user_id,role into v_actor from public.profiles where auth_id=auth.uid()::text limit 1;
 if v_actor is null or v_actor.role not in ('staff','admin','creator') then raise exception 'WeHouse access required'; end if;
 return query select ir.gps_latitude,ir.gps_longitude,ir.location_accuracy_m,ir.property_address,ir.property_city,ir.property_state from public.inspection_requests ir where ir.id=p_inspection_id and (v_actor.role in ('admin','creator') or coalesce(ir.assigned_field_officer_id,ir.field_officer_id,ir.assigned_to)=v_actor.user_id);
end $$;


--
-- Name: get_my_booking_conversations(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_booking_conversations(p_user_id text) RETURNS TABLE(conversation_id uuid, booking_id uuid, booking_code text, booking_status text, other_person_id text, other_person_name text, service_type text, negotiated_amount numeric, last_message text, unread_count bigint, updated_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE a public.profiles;
BEGIN
  a:=public._current_comm_actor();
  IF a IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_user_id IS DISTINCT FROM a.user_id THEN RAISE EXCEPTION 'User identity mismatch'; END IF;
  RETURN QUERY SELECT bc.id,bc.booking_id,wb.booking_code,wb.status,
    CASE WHEN bc.user_id=a.user_id THEN bc.worker_id ELSE bc.user_id END,
    p.full_name,wb.service_type,wb.negotiated_amount,
    (SELECT bm.content FROM public.booking_messages bm WHERE bm.conversation_id=bc.id ORDER BY bm.created_at DESC LIMIT 1),
    (SELECT count(*) FROM public.booking_messages bm WHERE bm.conversation_id=bc.id AND COALESCE(bm.is_read,false)=false AND bm.sender_id<>a.user_id),bc.updated_at
  FROM public.booking_conversations bc
  JOIN public.worker_bookings wb ON wb.id=bc.booking_id
  JOIN public.profiles p ON p.user_id=CASE WHEN bc.user_id=a.user_id THEN bc.worker_id ELSE bc.user_id END
  WHERE bc.user_id=a.user_id OR bc.worker_id=a.user_id
  ORDER BY bc.updated_at DESC;
END;
$$;


--
-- Name: get_my_booking_conversations_v2(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_booking_conversations_v2(p_user_id text) RETURNS TABLE(conversation_id uuid, booking_id uuid, booking_code text, booking_status text, service_type text, negotiated_amount numeric, other_person_id text, other_person_name text, other_person_avatar text, last_message text, last_message_time timestamp with time zone, unread_count bigint, updated_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE a public.profiles;
BEGIN
  a:=public._current_comm_actor();
  IF a IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_user_id IS DISTINCT FROM a.user_id THEN RAISE EXCEPTION 'User identity mismatch'; END IF;

  RETURN QUERY
  SELECT
    bc.id,
    bc.booking_id,
    wb.booking_code,
    wb.status,
    wb.service_type,
    wb.negotiated_amount,
    CASE WHEN bc.user_id=a.user_id THEN bc.worker_id ELSE bc.user_id END,
    COALESCE(p.full_name,p.username,'WeHouse member'),
    p.avatar_url,
    CASE
      WHEN NULLIF(BTRIM(COALESCE(lm.content,'')),'') IS NOT NULL THEN lm.content
      WHEN COALESCE(cardinality(lm.attachments),0)>0 AND lm.attachments[1] ~* '\.(webm|m4a|mp3|wav|ogg)(\?|$)' THEN 'Voice message'
      WHEN COALESCE(cardinality(lm.attachments),0)>0 AND lm.attachments[1] ~* '\.(jpg|jpeg|png|gif|webp)(\?|$)' THEN 'Photo'
      WHEN COALESCE(cardinality(lm.attachments),0)>0 THEN 'Attachment'
      ELSE NULL
    END,
    lm.created_at,
    COALESCE(unread.count,0),
    GREATEST(bc.updated_at,COALESCE(lm.created_at,bc.updated_at))
  FROM public.booking_conversations bc
  JOIN public.worker_bookings wb ON wb.id=bc.booking_id
  JOIN public.profiles p ON p.user_id=CASE WHEN bc.user_id=a.user_id THEN bc.worker_id ELSE bc.user_id END
  LEFT JOIN LATERAL (
    SELECT bm.content,bm.attachments,bm.created_at
    FROM public.booking_messages bm
    WHERE bm.conversation_id=bc.id
    ORDER BY bm.created_at DESC
    LIMIT 1
  ) lm ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::bigint AS count
    FROM public.booking_messages bm
    WHERE bm.conversation_id=bc.id
      AND COALESCE(bm.is_read,false)=false
      AND bm.sender_id<>a.user_id
  ) unread ON true
  WHERE (bc.user_id=a.user_id OR bc.worker_id=a.user_id)
    AND (
      (bc.user_id=a.user_id AND (bc.hidden_at_user IS NULL OR lm.created_at>bc.hidden_at_user))
      OR
      (bc.worker_id=a.user_id AND (bc.hidden_at_worker IS NULL OR lm.created_at>bc.hidden_at_worker))
    )
  ORDER BY GREATEST(bc.updated_at,COALESCE(lm.created_at,bc.updated_at)) DESC;
END;
$_$;


--
-- Name: get_my_housing_operations(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_housing_operations() RETURNS TABLE(listing_id text, listing_title text, listing_status text, property_type text, sub_type text, state text, lga text, address text, annual_rent numeric, current_reservation_id text, reservation_status text, customer_user_id text, customer_name text, customer_username text, reservation_fee_paid boolean, payment_status text, rental_plan_years integer, contract_rent_total numeric, upfront_rent_required numeric, installment_balance numeric, installment_count integer, rent_payment_status text, rent_paid_at timestamp with time zone, hold_expires_at timestamp with time zone, tenancy_start_date date, tenancy_end_date date, move_out_grace_until date, occupied_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE v_actor public.profiles;
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND role IN ('staff','admin','creator')
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Housing operations access required'; END IF;
  IF v_actor.role='staff' AND NOT public.current_staff_has_permission('operations') THEN
    RAISE EXCEPTION 'Operations permission required';
  END IF;

  RETURN QUERY
  SELECT
    l.id::text,l.title,l.status,l.property_type,l.sub_type,l.state,l.city,l.address,l.price,
    l.current_reservation_id,r.status,r.user_id,COALESCE(p.full_name,p.username,p.email),p.username,
    COALESCE(l.reservation_fee_paid,false),r.manual_payment_status,r.rental_plan_years,
    r.contract_rent_total,r.upfront_rent_required,r.installment_balance,r.installment_count,
    r.rent_payment_status,r.rent_paid_at,r.hold_expires_at,r.tenancy_start_date,r.tenancy_end_date,
    r.move_out_grace_until,l.occupied_at
  FROM public.listings l
  LEFT JOIN public.reservations r ON r.id=l.current_reservation_id
  LEFT JOIN public.profiles p ON p.user_id=r.user_id
  WHERE l.deleted_at IS NULL
    AND COALESCE(l.property_type,'apartment')='apartment'
    AND l.sub_type='long_stay'
    AND l.status IN ('available','reserved','occupied','maintenance','closed')
    AND (v_actor.role='creator' OR public.current_actor_in_scope(l.state,l.city))
  ORDER BY CASE l.status WHEN 'reserved' THEN 1 WHEN 'occupied' THEN 2 WHEN 'maintenance' THEN 3 WHEN 'available' THEN 4 ELSE 5 END,l.updated_at DESC;
END;
$$;


--
-- Name: get_my_inspections(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_inspections(p_field_officer_id text) RETURNS TABLE(id uuid, inspection_code text, property_address text, property_city text, property_state text, property_type text, status text, owner_id text, owner_name text, owner_email text, owner_phone text, notes text, field_officer_id text, partner_id text, scheduled_date timestamp with time zone, completed_at timestamp with time zone, created_at timestamp with time zone, photo_urls text[], document_urls text[], _source text, gps_latitude numeric, gps_longitude numeric, location_accuracy_m numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor IS NULL OR v_actor.role<>'staff' OR v_actor.user_id<>p_field_officer_id OR NOT public.current_staff_has_permission('field_officer') THEN
    RAISE EXCEPTION 'Field Officer access required';
  END IF;

  RETURN QUERY
  SELECT
    ir.id,
    ir.request_code,
    ir.property_address,
    ir.property_city,
    ir.property_state,
    ir.property_type,
    ir.status,
    ir.owner_id,
    COALESCE(p.full_name,p.username,p.email),
    ir.owner_email,
    ir.owner_phone,
    ir.notes,
    COALESCE(ir.assigned_field_officer_id,ir.field_officer_id,ir.assigned_to),
    ir.partner_id::text,
    ir.scheduled_date::timestamptz,
    ir.completed_at,
    ir.created_at,
    ir.photo_urls,
    ir.document_urls,
    'partner'::text,
    ir.gps_latitude,
    ir.gps_longitude,
    ir.location_accuracy_m
  FROM public.inspection_requests ir
  LEFT JOIN public.profiles p ON p.user_id=ir.owner_id
  WHERE COALESCE(ir.assigned_field_officer_id,ir.field_officer_id,ir.assigned_to)=v_actor.user_id

  UNION ALL

  SELECT
    ur.id,
    COALESCE(ur.reservation_id,ur.id::text),
    COALESCE(l.address,l.title,'Reserved property'),
    l.city,
    l.state,
    l.property_type::text,
    ur.status,
    ur.user_id,
    COALESCE(u.full_name,u.username,u.email),
    u.email,
    u.phone,
    ur.notes,
    ur.field_officer_id,
    NULL::text,
    ur.scheduled_date,
    NULL::timestamptz,
    ur.created_at,
    ur.photo_urls,
    ARRAY[]::text[],
    'user'::text,
    l.gps_latitude,
    l.gps_longitude,
    NULL::numeric
  FROM public.user_inspection_requests ur
  LEFT JOIN public.listings l ON l.listing_id=ur.listing_id OR l.id::text=ur.listing_id
  LEFT JOIN public.profiles u ON u.user_id=ur.user_id
  WHERE ur.field_officer_id=v_actor.user_id
  ORDER BY created_at DESC;
END
$$;


--
-- Name: get_my_legal_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_legal_status() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  p public.profiles;
  privacy_changed timestamptz;
  terms_changed timestamptz;
  version text;
begin
  select * into p from public.profiles where auth_id=auth.uid()::text limit 1;
  if p.user_id is null then raise exception 'Profile not found'; end if;
  select updated_at into privacy_changed from public.platform_settings where key='privacy_policy' and is_active=true limit 1;
  select updated_at into terms_changed from public.platform_settings where key='terms_of_service' and is_active=true limit 1;
  select value into version from public.platform_settings where key='legal_version' and is_active=true limit 1;
  return jsonb_build_object(
    'privacy_accepted', p.privacy_accepted_at is not null and (privacy_changed is null or p.privacy_accepted_at >= privacy_changed),
    'terms_accepted', p.terms_accepted_at is not null and (terms_changed is null or p.terms_accepted_at >= terms_changed),
    'privacy_accepted_at', p.privacy_accepted_at,
    'terms_accepted_at', p.terms_accepted_at,
    'legal_version', version
  );
end $$;


--
-- Name: get_my_private_call_preferences(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_private_call_preferences() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_me text:=public.current_profile_user_id(); v_pref public.private_call_preferences;
begin
 if v_me is null then raise exception 'Authenticated profile required'; end if;
 select * into v_pref from public.private_call_preferences where user_id=v_me;
 return jsonb_build_object('allow_audio_calls',coalesce(v_pref.allow_audio_calls,true),'allow_video_calls',coalesce(v_pref.allow_video_calls,false));
end; $$;


--
-- Name: get_my_property_partner_finance(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_property_partner_finance() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user_id TEXT; v_role TEXT; v_wallet RECORD; v_min NUMERIC:=5000;
  v_apartment_rate NUMERIC; v_hotel_rate NUMERIC;
  v_total_earnings NUMERIC:=0;
BEGIN
  SELECT user_id,role INTO v_user_id,v_role FROM public.profiles WHERE auth_id=auth.uid()::TEXT LIMIT 1;
  IF v_user_id IS NULL OR v_role<>'property_partner' THEN RAISE EXCEPTION 'Property Partner account required'; END IF;
  PERFORM public.ensure_my_property_partner_wallet();
  SELECT * INTO v_wallet FROM public.wallets WHERE owner_id=v_user_id AND owner_type='property_partner';
  SELECT COALESCE(NULLIF(value,'')::NUMERIC,5000) INTO v_min FROM public.platform_settings WHERE key='min_withdrawal' AND COALESCE(is_active,TRUE)=TRUE LIMIT 1;
  SELECT NULLIF(value,'')::NUMERIC INTO v_apartment_rate FROM public.platform_settings WHERE key='commission_apartment' AND COALESCE(is_active,TRUE)=TRUE LIMIT 1;
  SELECT NULLIF(value,'')::NUMERIC INTO v_hotel_rate FROM public.platform_settings WHERE key='commission_hotel' AND COALESCE(is_active,TRUE)=TRUE LIMIT 1;
  SELECT COALESCE(SUM(amount),0) INTO v_total_earnings FROM public.wallet_transactions WHERE user_id=v_user_id AND transaction_type IN ('property_earning_pending','property_earning_released');
  RETURN jsonb_build_object(
    'wallet_id',v_wallet.id,
    'available_balance',COALESCE(v_wallet.available_balance,0),
    'pending_balance',COALESCE(v_wallet.pending_balance,0),
    'frozen_balance',COALESCE(v_wallet.frozen_balance,0),
    'total_withdrawn',COALESCE(v_wallet.total_withdrawn,0),
    'is_frozen',COALESCE(v_wallet.is_frozen,FALSE),
    'apartment_commission_rate',COALESCE(v_apartment_rate,0),
    'hotel_commission_rate',COALESCE(v_hotel_rate,0),
    'total_earnings',v_total_earnings,
    'minimum_withdrawal',COALESCE(v_min,5000)
  );
END;
$$;


--
-- Name: get_my_property_pipeline(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_property_pipeline(p_stage text DEFAULT 'all'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles; v_result JSONB;
BEGIN
 SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
 IF v_actor IS NULL OR v_actor.role NOT IN ('admin','creator','staff') THEN RAISE EXCEPTION 'WeHouse operations access required'; END IF;
 IF v_actor.role='staff' AND NOT public.current_staff_has_permission('operations') THEN RAISE EXCEPTION 'Operations permission required'; END IF;
 IF v_actor.role IN ('admin','staff') AND (v_actor.assigned_state IS NULL OR v_actor.assigned_lga IS NULL) THEN RAISE EXCEPTION 'Branch assignment required'; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'id',ir.id,'request_code',ir.request_code,'owner_id',ir.owner_id,
   'owner_name',COALESCE(owner.full_name,owner.username,owner.email),'owner_email',ir.owner_email,'owner_phone',ir.owner_phone,
   'property_address',ir.property_address,'property_city',ir.property_city,'property_state',ir.property_state,
   'property_type',ir.property_type,'sub_type',ir.sub_type,'bedrooms',ir.bedrooms,'bathrooms',ir.bathrooms,
   'expected_rent',ir.expected_rent,'security_deposit_amount',ir.security_deposit_amount,'amenities',ir.amenities,
   'description',ir.description,'status',ir.status,'scheduled_date',ir.scheduled_date,
   'assigned_field_officer_id',COALESCE(ir.assigned_field_officer_id,ir.field_officer_id,ir.assigned_to),
   'field_officer_name',COALESCE(officer.full_name,officer.username,officer.email),'notes',ir.notes,
   'photo_urls',ir.photo_urls,'document_urls',ir.document_urls,'gps_latitude',ir.gps_latitude,'gps_longitude',ir.gps_longitude,
   'draft_listing_id',ir.draft_listing_id,'draft_hotel_id',ir.draft_hotel_id,'approved_by',ir.approved_by,'approved_at',ir.approved_at,'published_at',ir.published_at,
   'listing',CASE WHEN l.id IS NULL THEN NULL ELSE jsonb_build_object(
     'id',l.id,'listing_id',l.listing_id,'title',l.title,'price',l.price,'status',l.status,'availability_status',l.availability_status,
     'sub_type',l.sub_type,'security_deposit_amount',l.security_deposit_amount,'amenities',l.amenities,'images',l.images,'created_at',l.created_at
   ) END,
   'hotel',CASE WHEN h.hotel_id IS NULL THEN NULL ELSE jsonb_build_object('hotel_id',h.hotel_id,'name',h.name,'status',h.status,'images',h.images,'created_at',h.created_at) END,
   'created_at',ir.created_at
 ) ORDER BY ir.created_at DESC),'[]'::jsonb) INTO v_result
 FROM public.inspection_requests ir
 LEFT JOIN public.profiles owner ON owner.user_id=ir.owner_id
 LEFT JOIN public.profiles officer ON officer.user_id=COALESCE(ir.assigned_field_officer_id,ir.field_officer_id,ir.assigned_to)
 LEFT JOIN public.listings l ON l.id=ir.draft_listing_id AND l.deleted_at IS NULL
 LEFT JOIN public.hotels h ON h.hotel_id=ir.draft_hotel_id
 WHERE (v_actor.role='creator' OR (ir.property_state=v_actor.assigned_state AND ir.property_city=v_actor.assigned_lga))
   AND (p_stage='all'
     OR (p_stage='new' AND ir.status='pending' AND COALESCE(ir.assigned_field_officer_id,ir.field_officer_id,ir.assigned_to) IS NULL)
     OR (p_stage='inspection' AND ir.status IN ('pending','scheduled','in_progress') AND COALESCE(ir.assigned_field_officer_id,ir.field_officer_id,ir.assigned_to) IS NOT NULL)
     OR (p_stage='ready' AND ir.status IN ('completed','approved') AND ir.draft_listing_id IS NULL AND ir.draft_hotel_id IS NULL)
     OR (p_stage='preparing' AND (ir.draft_listing_id IS NOT NULL OR ir.draft_hotel_id IS NOT NULL) AND ir.published_at IS NULL)
     OR (p_stage='published' AND ir.published_at IS NOT NULL)
     OR (p_stage='rejected' AND ir.status='rejected'));
 RETURN v_result;
END $$;


--
-- Name: get_my_reservation_for_listing(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_reservation_for_listing(p_listing_id text) RETURNS public.reservations
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_user_id text; v_listing_id text; v_result public.reservations;
BEGIN
  SELECT user_id INTO v_user_id FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT id::text INTO v_listing_id FROM public.listings WHERE id::text=p_listing_id OR listing_id=p_listing_id LIMIT 1;
  IF v_listing_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_result FROM public.reservations
  WHERE listing_id=v_listing_id AND user_id=v_user_id
    AND status = ANY (ARRAY['payment_pending','reserved','inspection_pending','ready_for_move_in','occupied']::text[])
  ORDER BY created_at DESC LIMIT 1;
  RETURN v_result;
END;
$$;


--
-- Name: get_my_roommate_conversation_people(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_roommate_conversation_people() RETURNS TABLE(conversation_id uuid, user_id text, full_name text, username text, avatar_url text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  a public.profiles;
begin
  select * into a
  from public.profiles
  where auth_id = auth.uid()::text
  limit 1;

  if a is null or a.role <> 'user'
     or coalesce(a.deleted,false)
     or coalesce(a.suspended,false)
     or coalesce(a.banned,false) then
    raise exception 'Active regular user required';
  end if;

  return query
  select
    c.id,
    p.user_id,
    p.full_name,
    p.username,
    p.avatar_url
  from public.conversations c
  join public.profiles p
    on p.user_id = case when c.participant_a = a.user_id then c.participant_b else c.participant_a end
  where c.conversation_type = 'roommate'
    and coalesce(c.status,'active') = 'active'
    and a.user_id in (c.participant_a,c.participant_b)
    and coalesce(p.deleted,false)=false
    and coalesce(p.suspended,false)=false
    and coalesce(p.banned,false)=false
    and p.role='user'
    and public._conversation_route_allowed(c.id,a.user_id)
  order by c.last_message_at desc nulls last, c.created_at desc;
end;
$$;


--
-- Name: get_my_roommate_matches(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_roommate_matches() RETURNS TABLE(id uuid, matched_user_id text, match_score integer, status text, created_at timestamp with time zone, username text, full_name text, avatar_url text, gender text, city text, state text, bio text, school text, area_preference text, mutual_accepted boolean, conversation_id uuid)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select * from public.get_my_roommate_matches_page(24,0);
$$;


--
-- Name: get_my_roommate_matches_page(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_roommate_matches_page(p_limit integer DEFAULT 24, p_offset integer DEFAULT 0) RETURNS TABLE(id uuid, matched_user_id text, match_score integer, status text, created_at timestamp with time zone, username text, full_name text, avatar_url text, gender text, city text, state text, bio text, school text, area_preference text, mutual_accepted boolean, conversation_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_actor public.profiles;
  v_prefs public.roommate_preferences;
  v_school text;
  v_limit integer:=greatest(1,least(coalesce(p_limit,24),50));
  v_offset integer:=greatest(0,coalesce(p_offset,0));
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text limit 1;
  if v_actor is null or v_actor.role<>'user' then raise exception 'Regular user required'; end if;
  if coalesce(v_actor.deleted,false) or coalesce(v_actor.suspended,false) or coalesce(v_actor.banned,false) then raise exception 'Account is not active'; end if;
  select * into v_prefs from public.roommate_preferences where user_id=v_actor.user_id limit 1;
  v_school:=nullif(btrim(coalesce(v_prefs.school_name,v_actor.school,'')),'');
  return query
  select r.id,r.matched_user_id,r.match_score,r.status,r.created_at,p.username,p.full_name,p.avatar_url,p.gender,p.city,p.state,p.bio,coalesce(rp.school_name,p.school),rp.area_preference,
    exists(select 1 from public.roommate_search_results rr where rr.searcher_id=r.matched_user_id and rr.matched_user_id=v_actor.user_id and rr.status='accepted'),
    (select c.id from public.conversations c where c.conversation_type='roommate' and c.status='active' and ((c.participant_a=v_actor.user_id and c.participant_b=r.matched_user_id) or (c.participant_b=v_actor.user_id and c.participant_a=r.matched_user_id)) limit 1)
  from public.roommate_search_results r
  join public.profiles p on p.user_id=r.matched_user_id
  left join public.roommate_preferences rp on rp.user_id=p.user_id
  where r.searcher_id=v_actor.user_id and r.status<>'declined'
    and coalesce(p.deleted,false)=false and coalesce(p.suspended,false)=false and coalesce(p.banned,false)=false
    and (r.status='accepted' or (coalesce(p.privacy_search_visible,true)=true and coalesce(p.privacy_profile_visible,true)=true and coalesce(rp.active,false)=true and rp.search_status='active' and (not coalesce(v_prefs.school_match,false) or lower(regexp_replace(btrim(coalesce(rp.school_name,p.school,'')),'\s+',' ','g'))=lower(regexp_replace(btrim(coalesce(v_school,'')),'\s+',' ','g')))))
  order by r.match_score desc,r.created_at desc,r.id
  limit v_limit offset v_offset;
end;
$$;


--
-- Name: roommate_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roommate_preferences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    auth_id text NOT NULL,
    gender text NOT NULL,
    gender_preference text DEFAULT 'no_preference'::text NOT NULL,
    budget_min integer DEFAULT 0,
    budget_max integer DEFAULT 500000,
    study_level text,
    noise_level text DEFAULT 'moderate'::text,
    cleanliness text DEFAULT 'moderate'::text,
    sleep_time text DEFAULT '11pm-12am'::text,
    visitors text DEFAULT 'sometimes'::text,
    stay_duration text DEFAULT '1_year'::text,
    area_preference text,
    bio text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    search_status text DEFAULT 'idle'::text NOT NULL,
    search_started_at timestamp with time zone,
    search_expires_at timestamp with time zone,
    search_match_count integer DEFAULT 0 NOT NULL,
    campus text,
    school_name text,
    level text,
    department text,
    school_match boolean DEFAULT false NOT NULL,
    CONSTRAINT roommate_preferences_search_status_check CHECK ((search_status = ANY (ARRAY['idle'::text, 'active'::text, 'expired'::text, 'stopped'::text])))
);


--
-- Name: get_my_roommate_preferences(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_roommate_preferences() RETURNS SETOF public.roommate_preferences
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor IS NULL OR v_actor.role<>'user' OR COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT rp.* FROM public.roommate_preferences rp WHERE rp.user_id=v_actor.user_id LIMIT 1;
END;
$$;


--
-- Name: get_my_short_stay_operations(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_short_stay_operations() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE v_actor public.profiles; v_result jsonb;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role IN ('staff','admin','creator')
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Housing operations access required'; END IF;
  IF v_actor.role='staff' AND NOT public.current_staff_has_permission('operations') THEN RAISE EXCEPTION 'Operations permission required'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'reservation_id',r.id,'booking_code',r.booking_code,'status',r.status,'payment_status',r.rent_payment_status,
    'check_in',r.stay_check_in,'check_out',r.stay_check_out,'nights',r.stay_nights,'nightly_rate',r.nightly_rate_snapshot,
    'stay_rent_total',r.stay_rent_total,'security_deposit',r.security_deposit_snapshot,'security_deposit_status',r.security_deposit_status,
    'customer_user_id',r.user_id,'customer_name',COALESCE(p.full_name,p.username,p.email),'customer_phone',p.phone,
    'listing_id',l.id,'listing_title',l.title,'state',l.state,'lga',l.city,'address',l.address,'listing_status',l.status
  ) ORDER BY r.stay_check_in ASC,r.created_at ASC),'[]'::jsonb) INTO v_result
  FROM public.reservations r
  JOIN public.listings l ON l.id::text=r.listing_id
  LEFT JOIN public.profiles p ON p.user_id=r.user_id
  WHERE r.stay_type='short_let'
    AND r.status IN ('payment_pending','reserved','inspection_pending','ready_for_move_in','occupied')
    AND (v_actor.role='creator' OR public.current_actor_in_scope(l.state,l.city));
  RETURN v_result;
END;
$$;


--
-- Name: get_my_staff_finance_queue(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_staff_finance_queue() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE v_actor public.profiles; v_payments jsonb; v_withdrawals jsonb; v_commissions jsonb; v_escrow jsonb; v_refunds jsonb; v_audit jsonb;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text
    AND role IN ('staff','admin','creator') AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Active finance account required'; END IF;
  IF v_actor.role='staff' AND NOT public.current_staff_has_permission('finance') THEN RAISE EXCEPTION 'Finance permission required'; END IF;
  IF v_actor.role IN ('staff','admin') AND (v_actor.assigned_state IS NULL OR v_actor.assigned_lga IS NULL) THEN RAISE EXCEPTION 'Branch assignment required'; END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_payments FROM (
    SELECT bp.id,bp.payment_reference,bp.type,bp.booking_type,bp.amount,bp.amount_total,bp.amount_commission,bp.net_amount,bp.currency,bp.status,bp.purpose,bp.payment_method,bp.paystack_reference,bp.verified_at,bp.paid_at,bp.created_at
    FROM public.booking_payments bp
    WHERE v_actor.role='creator' OR public.can_current_actor_read_profile(bp.user_id)
      OR public.can_current_actor_read_profile(bp.payer_user_id) OR public.can_current_actor_read_profile(bp.payee_user_id)
      OR (bp.listing_id IS NOT NULL AND public.current_actor_can_access_listing_ref(bp.listing_id))
    ORDER BY bp.created_at DESC LIMIT 100) x;

  SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_withdrawals FROM (
    SELECT wd.id,wd.amount,wd.status,wd.snapshot_bank_name,wd.snapshot_bank_account_number,wd.snapshot_bank_account_name,wd.paystack_transfer_reference,wd.processed_at,wd.failed_reason,wd.created_at
    FROM public.withdrawals wd JOIN public.wallets w ON w.id=wd.wallet_id
    WHERE v_actor.role='creator' OR public.can_current_actor_read_profile(w.owner_id)
    ORDER BY wd.created_at DESC LIMIT 100) x;

  SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_commissions FROM (
    SELECT c.id,c.booking_type,c.commission_amount,c.commission_rate,c.gross_amount,c.description,c.paystack_reference,c.status,c.created_at
    FROM public.commission_ledger c
    WHERE v_actor.role='creator' OR public.can_current_actor_read_profile(c.source_user_id)
    ORDER BY c.created_at DESC LIMIT 100) x;

  SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_escrow FROM (
    SELECT e.id,e.booking_id,e.booking_type,e.amount_total,e.amount_commission,e.amount_payee,e.commission_rate,e.status,e.released_at,e.released_by,e.paystack_reference,e.created_at
    FROM public.escrow_transactions e
    WHERE v_actor.role='creator' OR public.can_current_actor_read_profile(e.payer_user_id) OR public.can_current_actor_read_profile(e.payee_user_id)
    ORDER BY e.created_at DESC LIMIT 100) x;

  SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_refunds FROM (
    SELECT bp.id,bp.payment_reference,bp.booking_type,bp.amount_total,bp.status,bp.refund_reason,bp.refund_processed_at,bp.refund_reference,bp.created_at
    FROM public.booking_payments bp
    WHERE (bp.refund_reason IS NOT NULL OR bp.refund_processed_at IS NOT NULL OR bp.refund_reference IS NOT NULL OR lower(COALESCE(bp.status,'')) LIKE 'refund%')
      AND (v_actor.role='creator' OR public.can_current_actor_read_profile(bp.user_id)
        OR public.can_current_actor_read_profile(bp.payer_user_id) OR public.can_current_actor_read_profile(bp.payee_user_id)
        OR (bp.listing_id IS NOT NULL AND public.current_actor_can_access_listing_ref(bp.listing_id)))
    ORDER BY bp.created_at DESC LIMIT 100) x;

  SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_audit FROM (
    SELECT a.id,a.action,a.actor_role,a.target_type,a.target_id,a.amount,a.commission_amount,a.description,a.status_before,a.status_after,a.failure_reason,a.created_at
    FROM public.financial_audit_log a
    WHERE v_actor.role='creator' OR (a.target_user_id IS NOT NULL AND public.can_current_actor_read_profile(a.target_user_id))
    ORDER BY a.created_at DESC LIMIT 100) x;

  RETURN jsonb_build_object('payments',v_payments,'withdrawals',v_withdrawals,'commissions',v_commissions,'escrow',v_escrow,'refunds',v_refunds,'audit',v_audit);
END;
$$;


--
-- Name: get_my_staff_operations_listings(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_staff_operations_listings(p_status text DEFAULT NULL::text) RETURNS SETOF public.listings
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE v_actor public.profiles;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text
    AND role IN ('staff','admin','creator') AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Active operations account required'; END IF;
  IF v_actor.role='staff' AND NOT public.current_staff_has_permission('operations') THEN RAISE EXCEPTION 'Operations permission required'; END IF;
  IF v_actor.role IN ('staff','admin') AND (v_actor.assigned_state IS NULL OR v_actor.assigned_lga IS NULL) THEN RAISE EXCEPTION 'Branch assignment required'; END IF;
  RETURN QUERY SELECT l.* FROM public.listings l
  WHERE l.deleted_at IS NULL AND (p_status IS NULL OR p_status='all' OR l.status=p_status)
    AND (v_actor.role='creator' OR (lower(COALESCE(l.state,''))=lower(v_actor.assigned_state)
      AND lower(COALESCE(l.city,''))=lower(v_actor.assigned_lga)))
  ORDER BY l.created_at DESC;
END;
$$;


--
-- Name: get_my_staff_trust_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_staff_trust_status() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_staff public.profiles; v_trust public.staff_trust_profiles;
BEGIN
  SELECT * INTO v_staff FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role='staff'
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_staff IS NULL THEN RAISE EXCEPTION 'Active Staff account required'; END IF;
  SELECT * INTO v_trust FROM public.staff_trust_profiles WHERE staff_id=v_staff.user_id;
  IF v_trust IS NULL THEN
    INSERT INTO public.staff_trust_profiles(staff_id,status,appointed_at,notes)
    VALUES(v_staff.user_id,'probation',now(),'Staff trust record created automatically') RETURNING * INTO v_trust;
  END IF;
  RETURN jsonb_build_object('status',v_trust.status,'notes',v_trust.notes,'appointed_at',v_trust.appointed_at,'trusted_at',v_trust.trusted_at);
END;
$$;


--
-- Name: get_my_staff_worker_review_detail(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_staff_worker_review_detail(p_worker_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$ DECLARE v_ver jsonb; v_history jsonb; BEGIN IF NOT public.current_staff_can_review_worker(p_worker_id) THEN RAISE EXCEPTION 'Worker is outside your verification scope'; END IF; SELECT jsonb_build_object('certificate_path',v.certificate_path,'verification_video_url',v.verification_video_url,'years_of_experience',v.years_of_experience,'identity_status',COALESCE(v.identity_status,'not_started'),'identity_provider',v.identity_provider,'identity_reference',v.identity_reference,'identity_checked_at',v.identity_checked_at,'identity_failure_reason',v.identity_failure_reason) INTO v_ver FROM public.worker_verifications v WHERE v.worker_id=p_worker_id ORDER BY v.created_at DESC LIMIT 1; SELECT COALESCE(jsonb_agg(jsonb_build_object('id',r.id,'action',r.action,'rejection_reason',r.rejection_reason,'notes',r.notes,'reviewer_role',r.reviewer_role,'created_at',r.created_at) ORDER BY r.created_at DESC),'[]'::jsonb) INTO v_history FROM (SELECT * FROM public.worker_verification_reviews WHERE worker_id=p_worker_id ORDER BY created_at DESC LIMIT 12) r; RETURN jsonb_build_object('verification',COALESCE(v_ver,'{}'::jsonb),'history',COALESCE(v_history,'[]'::jsonb)); END; $$;


--
-- Name: get_my_staff_worker_review_queue(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_staff_worker_review_queue(p_status text DEFAULT 'profile_under_review'::text) RETURNS TABLE(user_id text, username text, full_name text, worker_occupation text, worker_experience text, worker_cert_url text, worker_video_url text, state text, local_government text, city text, worker_status text, avatar_url text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$ DECLARE v_actor public.profiles; BEGIN SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role='staff' AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1; IF v_actor IS NULL OR NOT public.current_staff_has_permission('verification') THEN RAISE EXCEPTION 'Verification Staff access required'; END IF; IF v_actor.assigned_state IS NULL OR v_actor.assigned_lga IS NULL THEN RAISE EXCEPTION 'Staff branch assignment required'; END IF; RETURN QUERY SELECT w.user_id,w.username,w.full_name,w.worker_occupation,w.worker_experience,w.worker_cert_url,w.worker_video_url,w.state,w.local_government,w.city,w.worker_status,w.avatar_url FROM public.profiles w WHERE w.role='worker' AND COALESCE(w.deleted,false)=false AND COALESCE(w.suspended,false)=false AND COALESCE(w.banned,false)=false AND (p_status IS NULL OR p_status='all' OR w.worker_status=p_status) AND lower(COALESCE(w.state,''))=lower(v_actor.assigned_state) AND lower(COALESCE(w.local_government,w.city,''))=lower(v_actor.assigned_lga) ORDER BY w.created_at DESC; END; $$;


--
-- Name: get_my_staff_worker_reviews(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_staff_worker_reviews(p_status text DEFAULT 'pending'::text) RETURNS SETOF public.profiles
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ DECLARE v_actor record; BEGIN SELECT user_id,role,assigned_state,assigned_lga,deleted,suspended,banned INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1; IF v_actor IS NULL OR COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN RAISE EXCEPTION 'Active staff account required'; END IF; IF v_actor.role='staff' AND NOT public.current_staff_has_permission('verification') THEN RAISE EXCEPTION 'Verification permission required'; END IF; IF v_actor.role NOT IN('staff','admin','creator') THEN RAISE EXCEPTION 'Staff access required'; END IF; RETURN QUERY SELECT w.* FROM public.profiles w WHERE w.role='worker' AND NOT COALESCE(w.deleted,false) AND (p_status IS NULL OR p_status='all' OR w.worker_status=p_status) AND (v_actor.role IN('admin','creator') OR (v_actor.assigned_state IS NOT NULL AND lower(w.state)=lower(v_actor.assigned_state) AND (v_actor.assigned_lga IS NULL OR lower(COALESCE(w.local_government,w.city))=lower(v_actor.assigned_lga)))) ORDER BY w.created_at DESC; END; $$;


--
-- Name: get_my_support_conversations(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_support_conversations() RETURNS TABLE(conversation_id uuid, subject text, status text, category text, context_type text, context_id text, context_snapshot jsonb, priority text, assigned_staff_name text, last_message text, last_message_time timestamp with time zone, unread_count bigint, created_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles;
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
  LIMIT 1;

  IF v_actor.user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    'WeHouse Support'::text,
    c.status,
    c.category,
    c.context_type,
    c.context_id,
    c.context_snapshot,
    c.priority,
    COALESCE(s.full_name,s.username),
    (
      SELECT CASE
        WHEN NULLIF(BTRIM(m.content),'') IS NOT NULL THEN m.content
        WHEN COALESCE(cardinality(m.attachments),0)>0 THEN 'Attachment'
        ELSE ''
      END
      FROM public.partner_support_messages m
      WHERE m.conversation_id=c.id
      ORDER BY m.created_at DESC
      LIMIT 1
    ),
    (
      SELECT m.created_at
      FROM public.partner_support_messages m
      WHERE m.conversation_id=c.id
      ORDER BY m.created_at DESC
      LIMIT 1
    ),
    (
      SELECT COUNT(*)
      FROM public.partner_support_messages m
      WHERE m.conversation_id=c.id
        AND COALESCE(m.is_read,false)=false
        AND m.sender_id<>v_actor.user_id
    ),
    c.created_at
  FROM public.partner_support_conversations c
  LEFT JOIN public.profiles s ON s.user_id=c.assigned_staff_id
  WHERE c.partner_id=v_actor.user_id
    AND EXISTS (
      SELECT 1
      FROM public.partner_support_messages first_message
      WHERE first_message.conversation_id=c.id
    )
  ORDER BY c.updated_at DESC
  LIMIT 1;
END
$$;


--
-- Name: get_my_worker_activation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_worker_activation() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_profile public.profiles; v_ver public.worker_verifications; v_payment public.booking_payments; v_test public.worker_test_attempts; v_identity public.worker_identity_checks;
  v_attempts_24h integer:=0; v_profile_ready boolean:=false; v_paid boolean:=false; v_days integer:=public.worker_identity_recheck_days(); v_identity_current boolean:=false; v_due_at timestamptz; v_days_remaining integer;
begin
  select * into v_profile from public.profiles where auth_id=auth.uid()::text and role='worker' limit 1;
  if v_profile is null then raise exception 'Worker profile not found'; end if;
  v_profile_ready:=public.worker_professional_profile_ready(v_profile.user_id);
  select * into v_ver from public.worker_verifications where worker_id=v_profile.user_id limit 1;
  select * into v_payment from public.booking_payments where user_id=v_profile.user_id and purpose='worker_verification' order by created_at desc limit 1;
  select * into v_test from public.worker_test_attempts where worker_id=v_profile.user_id order by started_at desc limit 1;
  select * into v_identity from public.worker_identity_checks where worker_id=v_profile.user_id;
  select count(*) into v_attempts_24h from public.worker_test_attempts where worker_id=v_profile.user_id and started_at>=now()-interval '24 hours';
  v_paid:=coalesce(v_payment.status in('paid','completed'),false);
  if v_identity.status='passed' and v_identity.captured_at is not null then
    v_due_at:=v_identity.captured_at+make_interval(days=>v_days);
    v_identity_current:=v_due_at>now();
    v_days_remaining:=greatest(0,ceil(extract(epoch from (v_due_at-now()))/86400.0)::integer);
  end if;
  return jsonb_build_object(
    'worker_status',coalesce(v_profile.worker_status,'pending'),
    'live',coalesce(v_profile.worker_status='verified' and v_profile.worker_verified and v_identity_current,false),
    'profile_complete',v_profile_ready,
    'payment_status',v_payment.status,'payment_confirmed',v_paid,'gold_badge',v_paid,
    'identity_required',true,
    'identity_status',case when v_identity.status='passed' and not v_identity_current then 'expired' else coalesce(v_identity.status,'not_started') end,
    'identity_captured',coalesce(v_identity.status='passed',false),
    'identity_passed',v_identity_current,
    'identity_current',v_identity_current,
    'identity_captured_at',v_identity.captured_at,
    'identity_due_at',v_due_at,
    'identity_recheck_days',v_days,
    'identity_days_remaining',v_days_remaining,
    'test_passed',public.worker_test_passed(v_profile.user_id),'test_percent',v_test.percent,'test_attempts_24h',v_attempts_24h,
    'evidence_saved',coalesce(nullif(btrim(coalesce(v_ver.verification_video_url,'')),'') is not null,false),
    'submitted',coalesce(v_ver.submitted_at is not null,false),'review_status',v_ver.status,
    'rejection_reason',(select rejection_reason from public.worker_verification_reviews where worker_id=v_profile.user_id order by created_at desc limit 1)
  );
end;
$$;


--
-- Name: get_my_worker_booking_details(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_worker_booking_details(p_booking_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor public.profiles;
  v_booking public.worker_bookings;
  v_customer public.profiles;
  v_worker public.profiles;
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_booking FROM public.worker_bookings WHERE id=p_booking_id;
  IF v_booking IS NULL THEN RETURN NULL; END IF;
  IF v_actor.user_id IS DISTINCT FROM v_booking.user_id
     AND v_actor.user_id IS DISTINCT FROM v_booking.worker_id THEN
    RAISE EXCEPTION 'Booking participant access required';
  END IF;

  SELECT * INTO v_customer FROM public.profiles WHERE user_id=v_booking.user_id LIMIT 1;
  SELECT * INTO v_worker FROM public.profiles WHERE user_id=v_booking.worker_id LIMIT 1;

  RETURN jsonb_build_object(
    'id',v_booking.id,
    'booking_code',v_booking.booking_code,
    'status',v_booking.status,
    'service_type',v_booking.service_type,
    'description',v_booking.description,
    'address',v_booking.address,
    'negotiated_amount',v_booking.negotiated_amount,
    'agreed_amount',v_booking.agreed_amount,
    'scheduled_date',v_booking.scheduled_date,
    'created_at',v_booking.created_at,
    'updated_at',v_booking.updated_at,
    'user_id',v_booking.user_id,
    'worker_id',v_booking.worker_id,
    'user_name',COALESCE(v_customer.full_name,v_customer.username,'Customer'),
    'customer_username',v_customer.username,
    'user_avatar',v_customer.avatar_url,
    'worker_name',COALESCE(v_worker.full_name,v_worker.username,'Worker'),
    'worker_avatar',v_worker.avatar_url
  );
END;
$$;


--
-- Name: get_my_worker_identity_check(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_worker_identity_check() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles; v_check public.worker_identity_checks;
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role='worker' AND NOT COALESCE(deleted,false) AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false) LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Active Worker account required'; END IF;
  SELECT * INTO v_check FROM public.worker_identity_checks WHERE worker_id=v_actor.user_id;
  RETURN jsonb_build_object('status',COALESCE(v_check.status,'not_started'),'has_private_selfie',COALESCE(NULLIF(BTRIM(COALESCE(v_check.enrollment_photo_path,'')),'') IS NOT NULL,false),'face_match_score',v_check.face_match_score,'liveness_score',v_check.liveness_score,'anti_spoof_score',v_check.anti_spoof_score,'challenge_version',v_check.challenge_version,'captured_at',v_check.captured_at,'attempt_count',COALESCE(v_check.attempt_count,0));
END; $$;


--
-- Name: get_my_worker_identity_reference(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_worker_identity_reference() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_actor public.profiles;
  v_identity public.worker_identity_checks;
begin
  select * into v_actor
  from public.profiles
  where auth_id=auth.uid()::text
    and role='worker'
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor is null then raise exception 'Active Worker account required'; end if;

  select * into v_identity from public.worker_identity_checks where worker_id=v_actor.user_id;

  return jsonb_build_object(
    'has_reference',coalesce(nullif(btrim(coalesce(v_identity.enrollment_photo_path,'')),'') is not null,false),
    'photo_path',v_identity.enrollment_photo_path,
    'anchor_photo_path',v_identity.enrollment_photo_path,
    'recent_photo_path',coalesce(v_identity.latest_reference_photo_path,v_identity.enrollment_photo_path),
    'recent_reference_at',v_identity.latest_reference_at,
    'captured_at',v_identity.captured_at,
    'status',coalesce(v_identity.status,'not_started')
  );
end; $$;


--
-- Name: property_partners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.property_partners (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    profile_id text NOT NULL,
    partner_code text NOT NULL,
    status text DEFAULT 'pending_verification'::text NOT NULL,
    verification_notes text,
    commission_rate numeric DEFAULT 0,
    total_earnings numeric DEFAULT 0,
    total_paid_out numeric DEFAULT 0,
    properties_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: get_or_create_my_property_partner(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_or_create_my_property_partner() RETURNS public.property_partners
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$ DECLARE v_profile public.profiles; v_partner public.property_partners; v_code text; BEGIN SELECT * INTO v_profile FROM public.profiles WHERE auth_id=auth.uid()::text AND role='property_partner' AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1; IF v_profile IS NULL THEN RAISE EXCEPTION 'Active Property Partner account required'; END IF; SELECT * INTO v_partner FROM public.property_partners WHERE profile_id=v_profile.user_id LIMIT 1; IF v_partner IS NOT NULL THEN RETURN v_partner; END IF; v_code:='WHP-'||replace(v_profile.user_id,'WHU-','')||'-'||upper(substr(md5(v_profile.user_id||clock_timestamp()::text),1,4)); INSERT INTO public.property_partners(profile_id,partner_code,status,commission_rate,total_earnings,total_paid_out,properties_count,created_at,updated_at) VALUES(v_profile.user_id,v_code,'pending_verification',0,0,0,0,now(),now()) ON CONFLICT(profile_id) DO UPDATE SET updated_at=public.property_partners.updated_at RETURNING * INTO v_partner; RETURN v_partner; END; $$;


--
-- Name: get_platform_setting(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_platform_setting(p_key text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE v_value TEXT; BEGIN SELECT ps.value INTO v_value FROM platform_settings ps WHERE ps.key = p_key; RETURN v_value; END;
$$;


--
-- Name: get_platform_settings(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_platform_settings(p_category text DEFAULT NULL::text) RETURNS TABLE(key text, value text, category text, label text, description text, data_type text, editable boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
BEGIN
  IF p_category IS NOT NULL THEN
    RETURN QUERY SELECT ps.key::TEXT, ps.value::TEXT, ps.category::TEXT, ps.label::TEXT, ps.description::TEXT, ps.data_type::TEXT, ps.editable FROM platform_settings ps WHERE ps.category = p_category ORDER BY ps.category, ps.key;
  ELSE
    RETURN QUERY SELECT ps.key::TEXT, ps.value::TEXT, ps.category::TEXT, ps.label::TEXT, ps.description::TEXT, ps.data_type::TEXT, ps.editable FROM platform_settings ps ORDER BY ps.category, ps.key;
  END IF;
END;
$$;


--
-- Name: get_private_call_capabilities(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_private_call_capabilities(p_context_type text, p_context_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_me text:=public.current_profile_user_id(); v_peer text; v_profile public.profiles; v_pref public.private_call_preferences;
begin
 if v_me is null then raise exception 'Authenticated profile required'; end if;
 if p_context_type='roommate' then
   select case when c.participant_a=v_me then c.participant_b else c.participant_a end into v_peer from public.conversations c where c.id=p_context_id and c.conversation_type='roommate' and v_me in (c.participant_a,c.participant_b) limit 1;
 elsif p_context_type='worker_booking' then
   select case when c.user_id=v_me then c.worker_id else c.user_id end into v_peer from public.booking_conversations c where c.id=p_context_id and v_me in (c.user_id,c.worker_id) limit 1;
 else raise exception 'Unsupported call context'; end if;
 if v_peer is null then raise exception 'Private conversation not found'; end if;
 select * into v_profile from public.profiles where user_id=v_peer and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
 if v_profile is null or v_profile.role not in ('user','worker') then raise exception 'This person cannot receive private calls'; end if;
 select * into v_pref from public.private_call_preferences where user_id=v_peer;
 return jsonb_build_object('peer_id',v_peer,'peer_name',coalesce(v_profile.full_name,v_profile.username,'WeHouse member'),'peer_avatar',v_profile.avatar_url,'allow_audio_calls',coalesce(v_pref.allow_audio_calls,true),'allow_video_calls',coalesce(v_pref.allow_video_calls,false));
end; $$;


--
-- Name: get_private_call_details(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_private_call_details(p_call_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_me text:=public.current_profile_user_id(); v_call public.private_calls; v_peer text; v_profile public.profiles;
begin
 select * into v_call from public.private_calls where id=p_call_id and v_me in (caller_id,callee_id) limit 1;
 if v_call is null then raise exception 'Call not found'; end if;
 v_peer:=case when v_call.caller_id=v_me then v_call.callee_id else v_call.caller_id end;
 select * into v_profile from public.profiles where user_id=v_peer limit 1;
 return to_jsonb(v_call)||jsonb_build_object('peer_id',v_peer,'peer_name',coalesce(v_profile.full_name,v_profile.username,'WeHouse member'),'peer_avatar',v_profile.avatar_url,'incoming',v_call.callee_id=v_me);
end; $$;


--
-- Name: get_property_pipeline_requests(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_property_pipeline_requests() RETURNS TABLE(id uuid, request_code text, owner_id text, owner_name text, owner_email text, owner_phone text, property_address text, property_city text, property_state text, property_type text, bedrooms integer, bathrooms integer, expected_rent numeric, description text, status text, assigned_field_officer_id text, scheduled_date date, rejection_reason text, notes text, photo_urls text[], gps_latitude numeric, gps_longitude numeric, location_accuracy_m numeric, draft_listing_id text, published_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_actor record;
begin
 select user_id,role,assigned_state,assigned_lga,deleted,suspended,banned into v_actor from public.profiles where auth_id=auth.uid()::text limit 1;
 if v_actor is null or v_actor.role not in ('admin','creator') or coalesce(v_actor.deleted,false) or coalesce(v_actor.suspended,false) or coalesce(v_actor.banned,false) then raise exception 'Admin or Creator access required'; end if;
 return query
 select ir.id,ir.request_code,ir.owner_id,coalesce(p.full_name,p.username,p.email),ir.owner_email,ir.owner_phone,ir.property_address,ir.property_city,ir.property_state,ir.property_type,ir.bedrooms,ir.bathrooms,ir.expected_rent,ir.description,ir.status,coalesce(ir.assigned_field_officer_id,ir.field_officer_id,ir.assigned_to),ir.scheduled_date,ir.rejection_reason,ir.notes,ir.photo_urls,ir.gps_latitude,ir.gps_longitude,ir.location_accuracy_m,ir.draft_listing_id::text,ir.published_at,ir.created_at,ir.updated_at
 from public.inspection_requests ir left join public.profiles p on p.user_id=ir.owner_id
 where v_actor.role='creator' or (lower(coalesce(ir.property_state,''))=lower(coalesce(v_actor.assigned_state,'')) and lower(coalesce(ir.property_city,''))=lower(coalesce(v_actor.assigned_lga,'')))
 order by ir.created_at desc;
end $$;


--
-- Name: get_public_workers(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_public_workers(p_state text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_occupation text DEFAULT NULL::text) RETURNS TABLE(user_id text, username text, avatar_url text, bio text, state text, city text, local_government text, area text, worker_occupation text, worker_skills jsonb, worker_price integer, worker_bio text, worker_experience text, rating numeric, review_count integer, is_online boolean, last_seen timestamp with time zone, services jsonb, coverage jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
return query select p.user_id,p.username,p.avatar_url,p.bio,p.state,p.city,p.local_government,p.area,p.worker_occupation,p.worker_skills,p.worker_price,p.worker_bio,p.worker_experience,p.rating,p.review_count,p.is_online,p.last_seen,
coalesce((select jsonb_agg(jsonb_build_object('name',ws.service_name,'price',ws.price,'price_type',ws.price_type)) from public.worker_services ws where ws.worker_id=p.user_id),'[]'::jsonb),
coalesce((select jsonb_agg(jsonb_build_object('state',wsc.state,'lga',wsc.lga,'areas',wsc.areas)) from public.worker_service_coverage wsc where wsc.worker_id=p.user_id),'[]'::jsonb)
from public.profiles p where p.role='worker' and p.worker_status='verified' and p.worker_verified=true and p.available=true and p.deleted=false and p.suspended=false and p.banned=false and public.worker_identity_is_current(p.user_id) and (p_state is null or p.state ilike p_state) and (p_city is null or p.city ilike p_city or p.local_government ilike p_city) and (p_occupation is null or p.worker_occupation ilike p_occupation)
order by p.rating desc nulls last,p.review_count desc nulls last;
end; $$;


--
-- Name: get_roommate_messages_v2(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_roommate_messages_v2(p_conversation_id uuid) RETURNS TABLE(id uuid, conversation_id uuid, sender_id text, content text, seen boolean, created_at timestamp with time zone, edited_at timestamp with time zone, file_url text, file_name text, file_type text, attachments text[], attachment_types text[])
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public._can_access_conversation(p_conversation_id) THEN
    RAISE EXCEPTION 'Not authorized for this conversation';
  END IF;

  RETURN QUERY
  SELECT m.id,m.conversation_id,m.sender_id,m.content,m.seen,m.created_at,m.edited_at,
         m.file_url,m.file_name,m.file_type,m.attachments,m.attachment_types
  FROM public.messages m
  WHERE m.conversation_id=p_conversation_id
  ORDER BY m.created_at ASC;
END;
$$;


--
-- Name: get_secret_v2(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_secret_v2(p_key text) RETURNS TABLE(key text, value text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ begin
  if not public.is_current_creator() then raise exception 'Creator account required'; end if;
  return query select s.key,s.value from public.secrets s where s.key=p_key;
end $$;


--
-- Name: get_setting_v2(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_setting_v2(p_key text) RETURNS TABLE(id integer, key text, value text, label text, description text, category text, data_type text, is_active boolean, updated_at timestamp with time zone)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
                                                                                                                                                SELECT 
                                                                                                                                                    ps.id,
                                                                                                                                                        ps.key,
                                                                                                                                                            ps.value,
                                                                                                                                                                ps.label,
                                                                                                                                                                    ps.description,
                                                                                                                                                                        ps.category,
                                                                                                                                                                            ps.data_type,
                                                                                                                                                                                ps.is_active,
                                                                                                                                                                                    ps.updated_at
                                                                                                                                                                                      FROM platform_settings ps
                                                                                                                                                                                        WHERE ps.key = p_key
                                                                                                                                                                                            AND ps.is_active = true
                                                                                                                                                                                                AND ps.key NOT LIKE '%secret%'
                                                                                                                                                                                                    AND ps.key NOT LIKE '%api_key%'
                                                                                                                                                                                                        AND ps.key NOT LIKE '%private%'
                                                                                                                                                                                                            AND ps.key NOT LIKE '%password%'
                                                                                                                                                                                                                AND ps.key NOT LIKE '%token%'
                                                                                                                                                                                                                  LIMIT 1;
                                                                                                                                                                                                                  $$;


--
-- Name: get_short_stay_unavailable_listing_ids(date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_short_stay_unavailable_listing_ids(p_check_in date, p_check_out date) RETURNS TABLE(listing_id text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_check_in IS NULL OR p_check_out IS NULL OR p_check_out<=p_check_in THEN RAISE EXCEPTION 'Valid dates required'; END IF;
  RETURN QUERY
  SELECT DISTINCT r.listing_id
  FROM public.reservations r
  JOIN public.listings l ON l.id::text=r.listing_id
  WHERE l.sub_type='short_let'
    AND r.stay_type='short_let'
    AND r.status = ANY (ARRAY['payment_pending','reserved','inspection_pending','ready_for_move_in','occupied']::text[])
    AND daterange(r.stay_check_in,r.stay_check_out,'[)') && daterange(p_check_in,p_check_out,'[)');
END;
$$;


--
-- Name: get_staff_rating(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_staff_rating(p_staff_user_id text) RETURNS TABLE(avg_rating numeric, review_count bigint)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE(AVG("Rating"), 0)::NUMERIC, COUNT(*)::BIGINT 
  FROM staff_reviews WHERE staff_id = p_staff_user_id;
$$;


--
-- Name: get_staff_worker_identity_check(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_staff_worker_identity_check(p_worker_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_check public.worker_identity_checks;
BEGIN
  IF NOT public.current_staff_can_review_worker(p_worker_id) THEN RAISE EXCEPTION 'Worker is outside your verification scope'; END IF;
  SELECT * INTO v_check FROM public.worker_identity_checks WHERE worker_id=p_worker_id;
  RETURN jsonb_build_object('status',COALESCE(v_check.status,'not_started'),'face_match_score',v_check.face_match_score,'liveness_score',v_check.liveness_score,'anti_spoof_score',v_check.anti_spoof_score,'challenge_version',v_check.challenge_version,'captured_at',v_check.captured_at,'attempt_count',COALESCE(v_check.attempt_count,0));
END; $$;


--
-- Name: get_support_messages(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_support_messages(p_conversation_id uuid) RETURNS TABLE(id uuid, sender_id text, sender_name text, sender_role text, content text, attachments text[], attachment_types text[], action_type text, action_metadata jsonb, is_read boolean, created_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_actor public.profiles;
  v_conv public.partner_support_conversations;
  v_staff_ok boolean:=false;
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text limit 1;
  if v_actor.user_id is null then raise exception 'Authentication required'; end if;
  select * into v_conv from public.partner_support_conversations where id=p_conversation_id;
  if v_conv.id is null then raise exception 'Conversation not found'; end if;
  if v_actor.role='staff' then
    select exists(select 1 from public.staff_permissions sp where sp.staff_id=v_actor.user_id and sp.permission='support' and coalesce(sp.is_active,true)=true and sp.revoked_at is null) into v_staff_ok;
  end if;
  if not (
    v_actor.user_id=v_conv.partner_id
    or v_actor.user_id=v_conv.assigned_staff_id
    or v_actor.user_id=v_conv.assigned_field_officer_id
    or v_actor.role in ('admin','creator')
    or (v_staff_ok and v_conv.assigned_staff_id is null)
  ) then raise exception 'Not authorised'; end if;
  return query
  select m.id,m.sender_id,coalesce(p.full_name,p.username,'WeHouse'),m.sender_role,m.content,m.attachments,m.attachment_types,m.action_type,m.action_metadata,m.is_read,m.created_at
  from public.partner_support_messages m
  left join public.profiles p on p.user_id=m.sender_id
  where m.conversation_id=p_conversation_id
  order by m.created_at;
end;
$$;


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    participant_a text NOT NULL,
    participant_b text NOT NULL,
    listing_id text,
    last_message text,
    last_message_at timestamp with time zone DEFAULT now(),
    unread_a integer DEFAULT 0,
    unread_b integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    status text DEFAULT 'pending'::text,
    conversation_type text DEFAULT 'direct'::text,
    subject text,
    hidden_at_a timestamp with time zone,
    hidden_at_b timestamp with time zone
);


--
-- Name: get_user_conversations(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_conversations(p_user_id text) RETURNS SETOF public.conversations
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE a public.profiles;
BEGIN
  a:=public._current_comm_actor();
  IF a IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_user_id IS DISTINCT FROM a.user_id THEN RAISE EXCEPTION 'User identity mismatch'; END IF;

  RETURN QUERY
    SELECT c.*
    FROM public.conversations c
    WHERE (c.participant_a=a.user_id OR c.participant_b=a.user_id)
      AND public._can_access_conversation(c.id)
      AND public._conversation_route_allowed(c.id,a.user_id)
      AND (
        (c.participant_a=a.user_id AND (c.hidden_at_a IS NULL OR c.last_message_at>c.hidden_at_a))
        OR
        (c.participant_b=a.user_id AND (c.hidden_at_b IS NULL OR c.last_message_at>c.hidden_at_b))
      )
    ORDER BY c.last_message_at DESC NULLS LAST,c.created_at DESC;
END;
$$;


--
-- Name: get_worker_marketplace_trust(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_worker_marketplace_trust(p_worker_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_worker public.profiles; v_identity public.worker_identity_checks; v_enabled boolean:=false; v_min_jobs integer:=5; v_min_rating numeric:=4.5; v_max_cancel numeric:=20; v_block_disputes boolean:=true; v_completed integer:=0; v_worker_cancelled integer:=0; v_open_disputes integer:=0; v_cancel_rate numeric:=0; v_trusted boolean:=false;
BEGIN
  SELECT * INTO v_worker FROM public.profiles
  WHERE user_id=p_worker_id AND role='worker' AND worker_status='verified' AND worker_verified=true AND available=true AND NOT COALESCE(deleted,false) AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false) LIMIT 1;
  IF v_worker IS NULL THEN RETURN jsonb_build_object('reviewed',false,'trusted',false); END IF;
  SELECT * INTO v_identity FROM public.worker_identity_checks WHERE worker_id=p_worker_id;
  SELECT COALESCE(lower(value) IN('true','1','yes','on'),false) INTO v_enabled FROM public.platform_settings WHERE key='worker_trust_enabled' AND is_active=true LIMIT 1;
  SELECT COALESCE(NULLIF(value,''),'5')::integer INTO v_min_jobs FROM public.platform_settings WHERE key='worker_trusted_min_completed_jobs' AND is_active=true LIMIT 1;
  SELECT COALESCE(NULLIF(value,''),'4.5')::numeric INTO v_min_rating FROM public.platform_settings WHERE key='worker_trusted_min_rating' AND is_active=true LIMIT 1;
  SELECT COALESCE(NULLIF(value,''),'20')::numeric INTO v_max_cancel FROM public.platform_settings WHERE key='worker_trusted_max_cancel_rate' AND is_active=true LIMIT 1;
  SELECT COALESCE(lower(value) IN('true','1','yes','on'),true) INTO v_block_disputes FROM public.platform_settings WHERE key='worker_trusted_block_open_disputes' AND is_active=true LIMIT 1;
  SELECT count(*) INTO v_completed FROM public.worker_bookings WHERE worker_id=p_worker_id AND status='approved_released';
  SELECT count(*) INTO v_worker_cancelled FROM public.worker_bookings WHERE worker_id=p_worker_id AND status='cancelled' AND cancelled_by=p_worker_id;
  SELECT count(*) INTO v_open_disputes FROM public.worker_bookings WHERE worker_id=p_worker_id AND status='disputed';
  IF v_completed+v_worker_cancelled>0 THEN v_cancel_rate:=round((v_worker_cancelled::numeric*100)/(v_completed+v_worker_cancelled),2); END IF;
  v_trusted:=COALESCE(v_enabled,false) AND COALESCE(v_identity.status='passed',false) AND v_completed>=COALESCE(v_min_jobs,5) AND COALESCE(v_worker.rating,0)>=COALESCE(v_min_rating,4.5) AND v_cancel_rate<=COALESCE(v_max_cancel,20) AND (NOT COALESCE(v_block_disputes,true) OR v_open_disputes=0);
  RETURN jsonb_build_object('reviewed',true,'face_check_passed',COALESCE(v_identity.status='passed',false),'trusted',v_trusted,'trusted_enabled',COALESCE(v_enabled,false),'completed_jobs',v_completed,'rating',COALESCE(v_worker.rating,0),'review_count',COALESCE(v_worker.review_count,0),'worker_cancel_rate',v_cancel_rate,'open_disputes',v_open_disputes,'label',CASE WHEN v_trusted THEN 'WeHouse Trusted' ELSE 'WeHouse Reviewed' END);
END; $$;


--
-- Name: get_worker_verification_chats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_worker_verification_chats() RETURNS TABLE(id uuid, participant_a text, participant_b text, status text, last_message text, last_message_at timestamp with time zone, unread_a integer, unread_b integer, created_at timestamp with time zone, conversation_type text, subject text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
  SELECT id, participant_a, participant_b, status, last_message,
    last_message_at, unread_a, unread_b, created_at,
    conversation_type, subject
  FROM public.conversations
  WHERE conversation_type = 'worker_verification'
  ORDER BY last_message_at DESC NULLS LAST;
$$;


--
-- Name: guard_inspected_public_hotel(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_inspected_public_hotel() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
 IF NEW.status='active' AND (NEW.inspection_request_id IS NULL OR NEW.approved_by IS NULL OR NEW.approved_at IS NULL) THEN RAISE EXCEPTION 'Public hotels must come through the inspection publication workflow'; END IF;
 RETURN NEW;
END $$;


--
-- Name: guard_inspected_public_listing(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_inspected_public_listing() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE v_status TEXT;
BEGIN
  IF NEW.status='available' OR NEW.availability_status='available' THEN
    IF NEW.inspection_request_id IS NULL OR NEW.approved_by IS NULL OR NEW.approved_at IS NULL THEN RAISE EXCEPTION 'Public listings must come through the completed inspection publication workflow'; END IF;
    SELECT status INTO v_status FROM public.inspection_requests WHERE id=NEW.inspection_request_id;
    IF v_status NOT IN ('completed','approved') THEN RAISE EXCEPTION 'Linked inspection must be complete before publication'; END IF;
  END IF;
  RETURN NEW;
END $$;


--
-- Name: guard_retired_worker_identity_fields(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_retired_worker_identity_fields() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NULLIF(BTRIM(COALESCE(NEW.gov_id_type,'')),'') IS NOT NULL OR NULLIF(BTRIM(COALESCE(NEW.gov_id_number,'')),'') IS NOT NULL OR NULLIF(BTRIM(COALESCE(NEW.gov_id_photo_url,'')),'') IS NOT NULL OR NULLIF(BTRIM(COALESCE(NEW.selfie_photo_url,'')),'') IS NOT NULL OR NULLIF(BTRIM(COALESCE(NEW.identity_provider,'')),'') IS NOT NULL OR NULLIF(BTRIM(COALESCE(NEW.identity_reference,'')),'') IS NOT NULL THEN RAISE EXCEPTION 'Government/external identity fields are retired. Use the private WeHouse automatic face check.'; END IF;
  RETURN NEW;
END; $$;


--
-- Name: hide_my_booking_conversation(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hide_my_booking_conversation(p_conversation_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor public.profiles;
  v_conv public.booking_conversations;
BEGIN
  v_actor:=public._current_comm_actor();
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_conv FROM public.booking_conversations WHERE id=p_conversation_id FOR UPDATE;
  IF v_conv IS NULL OR v_actor.user_id NOT IN (v_conv.user_id,v_conv.worker_id) THEN
    RAISE EXCEPTION 'Not authorized for this booking conversation';
  END IF;

  UPDATE public.booking_messages
  SET is_read=true
  WHERE conversation_id=p_conversation_id AND sender_id<>v_actor.user_id;

  IF v_conv.user_id=v_actor.user_id THEN
    UPDATE public.booking_conversations SET hidden_at_user=now() WHERE id=p_conversation_id;
  ELSE
    UPDATE public.booking_conversations SET hidden_at_worker=now() WHERE id=p_conversation_id;
  END IF;

  RETURN true;
END;
$$;


--
-- Name: hide_my_roommate_conversation(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hide_my_roommate_conversation(p_conversation_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor public.profiles;
  v_conv public.conversations;
BEGIN
  v_actor:=public._current_comm_actor();
  IF v_actor IS NULL OR v_actor.role<>'user' THEN RAISE EXCEPTION 'Regular user account required'; END IF;

  SELECT * INTO v_conv
  FROM public.conversations
  WHERE id=p_conversation_id AND conversation_type='roommate'
  FOR UPDATE;

  IF v_conv IS NULL OR v_actor.user_id NOT IN (v_conv.participant_a,v_conv.participant_b)
     OR NOT public._can_access_conversation(p_conversation_id) THEN
    RAISE EXCEPTION 'Roommate conversation unavailable';
  END IF;

  UPDATE public.messages
  SET seen=true
  WHERE conversation_id=p_conversation_id AND sender_id<>v_actor.user_id;

  IF v_conv.participant_a=v_actor.user_id THEN
    UPDATE public.conversations SET hidden_at_a=now(),unread_a=0 WHERE id=p_conversation_id;
  ELSE
    UPDATE public.conversations SET hidden_at_b=now(),unread_b=0 WHERE id=p_conversation_id;
  END IF;

  RETURN true;
END;
$$;


--
-- Name: hold_property_partner_earning(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hold_property_partner_earning(p_payment_id uuid, p_reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE v_actor public.profiles; v_e record; v_wallet record;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role IN ('admin','creator')
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Admin or Creator finance authority required'; END IF;
  IF NULLIF(BTRIM(COALESCE(p_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'Hold reason is required'; END IF;
  SELECT * INTO v_e FROM public.property_partner_earning_releases WHERE payment_id=p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Property Partner earning not found'; END IF;
  IF v_actor.role='admin' AND NOT public.can_current_actor_read_profile(v_e.partner_id) THEN RAISE EXCEPTION 'Partner is outside your assigned branch'; END IF;
  IF v_e.status='reversed' THEN RAISE EXCEPTION 'Reversed earnings cannot be held'; END IF;
  IF v_e.status='held' THEN RETURN jsonb_build_object('success',true,'already_held',true); END IF;
  SELECT * INTO v_wallet FROM public.wallets WHERE owner_id=v_e.partner_id AND owner_type='property_partner' FOR UPDATE;
  IF v_e.status='available' AND v_wallet.id IS NOT NULL THEN UPDATE public.wallets SET is_frozen=true,frozen_reason='Property earning dispute: '||BTRIM(p_reason),frozen_by=v_actor.user_id,frozen_at=now(),updated_at=now() WHERE id=v_wallet.id; END IF;
  UPDATE public.property_partner_earning_releases SET status='held',held_by=v_actor.user_id,held_at=now(),hold_reason=BTRIM(p_reason),updated_at=now() WHERE id=v_e.id;
  UPDATE public.commission_ledger SET status='disputed',updated_at=now() WHERE payment_id=p_payment_id;
  INSERT INTO public.financial_audit_logs(event_type,user_id,target_user_id,amount,reference_id,reference_type,description,metadata) VALUES('dispute_opened',v_actor.user_id,v_e.partner_id,v_e.net_amount,p_payment_id::text,'booking_payment','Property Partner earning placed on hold',jsonb_build_object('reason',BTRIM(p_reason),'previous_status',v_e.status));
  RETURN jsonb_build_object('success',true,'status','held');
END;
$$;


--
-- Name: increment_unread(integer, character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_unread(p_room_id integer, p_user_id character varying) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
                                                                                                                                                                                  BEGIN
                                                                                                                                                                                    UPDATE chat_participants SET unread_count = unread_count + 1
                                                                                                                                                                                      WHERE room_id = p_room_id AND user_id = p_user_id;
                                                                                                                                                                                      END;
                                                                                                                                                                                      $$;


--
-- Name: is_current_announcement_recipient(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_current_announcement_recipient(p_announcement_id bigint) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.announcement_recipients ar
    where ar.announcement_id = p_announcement_id
      and ar.user_id = public.current_profile_user_id()
  )
$$;


--
-- Name: is_current_announcement_sender(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_current_announcement_sender(p_announcement_id bigint) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.announcements a
    where a.id = p_announcement_id
      and a.sender_id = public.current_profile_user_id()
  )
$$;


--
-- Name: is_current_creator(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_current_creator() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists(
    select 1 from public.profiles p
    where p.auth_id=auth.uid()::text
      and p.role='creator'
      and coalesce(p.deleted,false)=false
      and coalesce(p.suspended,false)=false
      and coalesce(p.banned,false)=false
  );
$$;


--
-- Name: is_staff_or_creator(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_staff_or_creator(uid text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.auth_id = uid
      AND p.role IN ('staff','admin','creator')
      AND COALESCE(p.deleted,false)=false
      AND COALESCE(p.suspended,false)=false
      AND COALESCE(p.banned,false)=false
  );
$$;


--
-- Name: is_username_available(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_username_available(p_username text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL OR NULLIF(btrim(p_username),'') IS NULL THEN false
    ELSE NOT EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE lower(p.username)=lower(btrim(p_username))
        AND p.user_id<>COALESCE(public.current_profile_user_id(),'')
    )
  END;
$$;


--
-- Name: lga_booking_prefix(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.lga_booking_prefix(p_lga text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE v_letters text;
BEGIN
  v_letters := upper(regexp_replace(COALESCE(p_lga,''), '[^A-Za-z]', '', 'g'));
  IF length(v_letters) < 3 THEN v_letters := rpad(v_letters, 3, 'X'); END IF;
  IF v_letters = '' THEN v_letters := 'GEN'; END IF;
  RETURN substr(v_letters, 1, 3) || 'WH';
END; $$;


--
-- Name: lock_admin_staff_location(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.lock_admin_staff_location() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF OLD.auth_id = auth.uid()::text AND OLD.role IN ('admin', 'staff') THEN
    IF NEW.assigned_state IS DISTINCT FROM OLD.assigned_state OR NEW.assigned_lga IS DISTINCT FROM OLD.assigned_lga OR NEW.scope IS DISTINCT FROM OLD.scope THEN
      RAISE EXCEPTION 'Operational assignment cannot be changed from Profile. Contact Creator for reassignment.';
    END IF;
  END IF;
  RETURN NEW;
END;$$;


--
-- Name: log_settings_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_settings_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_key text;
  v_old jsonb;
  v_new jsonb;
  v_sensitive boolean;
  v_actor public.profiles;
BEGIN
  v_key := CASE WHEN TG_OP='DELETE' THEN OLD.key ELSE NEW.key END;
  v_old := CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  v_new := CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  v_sensitive := lower(coalesce(v_key,'')) ~ '(secret|password|private[_-]?key|access[_-]?token|refresh[_-]?token|service[_-]?role|webhook[_-]?secret|api[_-]?secret)';

  IF v_sensitive THEN
    IF v_old IS NOT NULL THEN v_old := v_old || jsonb_build_object('value','[REDACTED]'); END IF;
    IF v_new IS NOT NULL THEN v_new := v_new || jsonb_build_object('value','[REDACTED]'); END IF;
  END IF;

  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  BEGIN
    INSERT INTO public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
    VALUES(TG_OP,'platform_settings',v_key,jsonb_build_object('old_value',v_old,'new_value',v_new)::text,v_actor.user_id,v_actor.email);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'settings_audit_failed: action=%, key=%, error=%',TG_OP,v_key,SQLERRM;
  END;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;


--
-- Name: manage_staff_permission(text, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.manage_staff_permission(p_staff_id text, p_permission text, p_enabled boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ DECLARE v_actor public.profiles; v_target public.profiles; BEGIN SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND deleted=false AND suspended=false AND banned=false; SELECT * INTO v_target FROM public.profiles WHERE user_id=p_staff_id AND role='staff' AND deleted=false; IF v_actor.role NOT IN('creator','admin') THEN RAISE EXCEPTION 'Not authorized'; END IF; IF v_target IS NULL THEN RAISE EXCEPTION 'Staff profile not found'; END IF; IF p_permission NOT IN('operations','finance','support','verification','field_officer') THEN RAISE EXCEPTION 'Invalid staff module'; END IF; IF v_actor.role='admin' AND(v_actor.assigned_state IS DISTINCT FROM v_target.assigned_state OR v_actor.assigned_lga IS DISTINCT FROM v_target.assigned_lga) THEN RAISE EXCEPTION 'Admin can manage only staff in the same assigned LGA'; END IF; IF p_enabled THEN UPDATE public.staff_permissions SET is_active=false,revoked_at=now() WHERE staff_id=p_staff_id AND is_active=true AND permission<>p_permission; END IF; INSERT INTO public.staff_permissions(staff_id,permission,granted_by,granted_at,revoked_at,is_active) VALUES(p_staff_id,p_permission,v_actor.user_id,CASE WHEN p_enabled THEN now() ELSE NULL END,CASE WHEN p_enabled THEN NULL ELSE now() END,p_enabled) ON CONFLICT(staff_id,permission) DO UPDATE SET granted_by=EXCLUDED.granted_by,granted_at=CASE WHEN EXCLUDED.is_active THEN now() ELSE staff_permissions.granted_at END,revoked_at=CASE WHEN EXCLUDED.is_active THEN NULL ELSE now() END,is_active=EXCLUDED.is_active; END; $$;


--
-- Name: mark_my_announcement_read(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_my_announcement_read(p_announcement_id integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ DECLARE v_user_id text; BEGIN SELECT user_id INTO v_user_id FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1; IF v_user_id IS NULL THEN RAISE EXCEPTION 'Profile not found'; END IF; UPDATE public.announcement_recipients SET read_status=true WHERE announcement_id=p_announcement_id AND user_id=v_user_id AND COALESCE(read_status,false)=false; UPDATE public.announcements a SET read_count=(SELECT count(*) FROM public.announcement_recipients ar WHERE ar.announcement_id=a.id AND ar.read_status=true) WHERE a.id=p_announcement_id AND EXISTS(SELECT 1 FROM public.announcement_recipients ar WHERE ar.announcement_id=a.id AND ar.user_id=v_user_id); END; $$;


--
-- Name: mark_my_booking_messages_read(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_my_booking_messages_read(p_conversation_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor public.profiles;
  v_conv public.booking_conversations;
BEGIN
  v_actor:=public._current_comm_actor();
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_conv
  FROM public.booking_conversations
  WHERE id=p_conversation_id;

  IF v_conv IS NULL OR v_actor.user_id NOT IN (v_conv.user_id,v_conv.worker_id) THEN
    RAISE EXCEPTION 'Not authorized for this booking conversation';
  END IF;

  UPDATE public.booking_messages
  SET is_read=true
  WHERE conversation_id=p_conversation_id
    AND sender_id<>v_actor.user_id
    AND COALESCE(is_read,false)=false;
END;
$$;


--
-- Name: mark_my_conversation_seen(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_my_conversation_seen(p_conversation_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE a public.profiles; c public.conversations;
BEGIN
  SELECT * INTO a FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF a IS NULL OR NOT public._can_access_conversation(p_conversation_id) THEN
    RAISE EXCEPTION 'Not authorized for this conversation';
  END IF;

  SELECT * INTO c FROM public.conversations WHERE id=p_conversation_id FOR UPDATE;

  UPDATE public.messages
  SET seen=true
  WHERE conversation_id=p_conversation_id
    AND sender_id<>a.user_id
    AND COALESCE(seen,false)=false;

  IF c.participant_a=a.user_id AND COALESCE(c.unread_a,0)<>0 THEN
    UPDATE public.conversations SET unread_a=0 WHERE id=p_conversation_id;
  ELSIF c.participant_b=a.user_id AND COALESCE(c.unread_b,0)<>0 THEN
    UPDATE public.conversations SET unread_b=0 WHERE id=p_conversation_id;
  END IF;
END;
$$;


--
-- Name: mark_my_reservation_support_contacted(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_my_reservation_support_contacted(p_reservation_id text) RETURNS public.reservations
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_user_id text; v_result public.reservations;
BEGIN
  SELECT user_id INTO v_user_id FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  UPDATE public.reservations SET support_contacted=true,updated_at=now()
  WHERE id=p_reservation_id AND user_id=v_user_id
  RETURNING * INTO v_result;
  IF v_result IS NULL THEN RAISE EXCEPTION 'Reservation not found'; END IF;
  RETURN v_result;
END;
$$;


--
-- Name: mark_support_messages_read(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_support_messages_read(p_conversation_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_actor public.profiles;
  v_conv public.partner_support_conversations;
  v_staff_ok boolean:=false;
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text limit 1;
  select * into v_conv from public.partner_support_conversations where id=p_conversation_id;
  if v_actor.user_id is null or v_conv.id is null then raise exception 'Conversation not found'; end if;
  if v_actor.role='staff' then
    select exists(select 1 from public.staff_permissions sp where sp.staff_id=v_actor.user_id and sp.permission='support' and coalesce(sp.is_active,true)=true and sp.revoked_at is null) into v_staff_ok;
  end if;
  if not (
    v_actor.user_id=v_conv.partner_id
    or v_actor.user_id=v_conv.assigned_staff_id
    or v_actor.user_id=v_conv.assigned_field_officer_id
    or v_actor.role in ('admin','creator')
    or (v_staff_ok and v_conv.assigned_staff_id is null)
  ) then raise exception 'Not authorised'; end if;
  update public.partner_support_messages
  set is_read=true
  where conversation_id=p_conversation_id
    and sender_id<>v_actor.user_id
    and coalesce(is_read,false)=false;
end;
$$;


--
-- Name: message_edit_window_minutes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.message_edit_window_minutes() RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
  select greatest(1,least(60,coalesce((select case when trim(value) ~ '^[0-9]+$' then trim(value)::integer end from public.platform_settings where key='message_edit_window_minutes' and is_active=true limit 1),10)));
$_$;


--
-- Name: post_property_from_inspection(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.post_property_from_inspection(p_data jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_caller public.profiles;
  v_ir public.inspection_requests;
  v_partner public.profiles;
  v_listing_id uuid;
  v_code text;
  v_images text[];
  v_videos text[];
  v_amenities text[];
  v_sub_type text;
  v_deposit numeric;
BEGIN
  SELECT * INTO v_caller FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_caller IS NULL OR v_caller.role NOT IN ('staff','admin','creator') THEN RAISE EXCEPTION 'WeHouse operations access required'; END IF;
  IF v_caller.role='staff' AND NOT public.current_staff_has_permission('operations') THEN RAISE EXCEPTION 'Operations permission required'; END IF;

  SELECT * INTO v_ir FROM public.inspection_requests WHERE id=(p_data->>'inspection_id')::uuid FOR UPDATE;
  IF v_ir IS NULL OR v_ir.status NOT IN ('completed','approved') THEN RAISE EXCEPTION 'Inspection must be completed before listing preparation'; END IF;
  IF v_caller.role IN ('admin','staff') AND (v_ir.property_state IS DISTINCT FROM v_caller.assigned_state OR v_ir.property_city IS DISTINCT FROM v_caller.assigned_lga) THEN RAISE EXCEPTION 'Property is outside your assigned branch'; END IF;
  IF v_ir.draft_listing_id IS NOT NULL THEN RAISE EXCEPTION 'A listing has already been prepared from this inspection'; END IF;
  IF v_ir.property_type='hotel' THEN RAISE EXCEPTION 'Hotels use the hotel preparation workflow'; END IF;

  SELECT * INTO v_partner FROM public.profiles WHERE user_id=v_ir.owner_id AND role='property_partner';
  IF v_partner IS NULL THEN RAISE EXCEPTION 'Valid Property Partner owner required'; END IF;
  IF NULLIF(BTRIM(p_data->>'title'),'') IS NULL OR COALESCE((p_data->>'price')::numeric,0)<=0 THEN RAISE EXCEPTION 'Listing title and valid price are required'; END IF;

  v_sub_type := COALESCE(NULLIF(BTRIM(p_data->>'sub_type'),''),v_ir.sub_type);
  IF v_sub_type NOT IN ('short_let','long_stay') THEN RAISE EXCEPTION 'Choose Short Stay or Long Stay before preparing this apartment'; END IF;
  v_deposit := COALESCE(NULLIF(p_data->>'security_deposit_amount','')::numeric,v_ir.security_deposit_amount);
  IF v_sub_type='short_let' AND COALESCE(v_deposit,0)<=0 THEN RAISE EXCEPTION 'Short Stay requires a refundable security deposit'; END IF;
  IF v_sub_type='long_stay' THEN v_deposit:=NULL; END IF;

  SELECT COALESCE(array_agg(value),ARRAY[]::text[]) INTO v_images
  FROM jsonb_array_elements_text(COALESCE(p_data->'images','[]'::jsonb));
  SELECT COALESCE(array_agg(value),ARRAY[]::text[]) INTO v_videos
  FROM jsonb_array_elements_text(COALESCE(p_data->'videos','[]'::jsonb));
  SELECT COALESCE(array_agg(DISTINCT value),ARRAY[]::text[]) INTO v_amenities
  FROM jsonb_array_elements_text(COALESCE(p_data->'amenities',to_jsonb(COALESCE(v_ir.amenities,ARRAY[]::text[]))));
  IF v_sub_type='short_let' AND NOT ('Furnished'=ANY(COALESCE(v_amenities,ARRAY[]::text[]))) THEN
    v_amenities:=array_append(COALESCE(v_amenities,ARRAY[]::text[]),'Furnished');
  END IF;

  v_code := 'WHL-'||UPPER(SUBSTRING(REPLACE(gen_random_uuid()::text,'-','') FROM 1 FOR 12));
  INSERT INTO public.listings(
    listing_id,title,description,price,currency,state,city,address,images,videos,bedrooms,bathrooms,
    property_type,sub_type,security_deposit_amount,amenities,
    availability_status,owner_id,partner_id,chat_agent_id,status,submitted_by_role,reservation_fee_paid,chat_unlocked,
    gps_latitude,gps_longitude,inspection_request_id,created_at,updated_at
  ) VALUES(
    v_code,BTRIM(p_data->>'title'),NULLIF(BTRIM(p_data->>'description'),''),(p_data->>'price')::numeric,'NGN',
    v_ir.property_state,v_ir.property_city,v_ir.property_address,v_images,v_videos,
    COALESCE((p_data->>'bedrooms')::int,v_ir.bedrooms,1),COALESCE((p_data->>'bathrooms')::int,v_ir.bathrooms,1),
    COALESCE(NULLIF(BTRIM(p_data->>'property_type'),''),v_ir.property_type,'apartment'),v_sub_type,v_deposit,v_amenities,
    'pending_approval',v_partner.user_id,v_partner.user_id,v_caller.user_id,'pending_approval','property_partner',false,false,
    v_ir.gps_latitude,v_ir.gps_longitude,v_ir.id,NOW(),NOW()
  ) RETURNING id INTO v_listing_id;

  UPDATE public.inspection_requests
  SET draft_listing_id=v_listing_id,sub_type=v_sub_type,security_deposit_amount=v_deposit,amenities=v_amenities,updated_at=NOW()
  WHERE id=v_ir.id;
  RETURN v_listing_id;
END $$;


--
-- Name: prevent_double_reservation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_double_reservation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
  IF NEW.status <> ALL (ARRAY['payment_pending','reserved','inspection_pending','ready_for_move_in','occupied']::text[]) THEN
    RETURN NEW;
  END IF;

  IF NEW.stay_type='short_let' THEN
    IF NEW.stay_check_in IS NULL OR NEW.stay_check_out IS NULL OR NEW.stay_check_out<=NEW.stay_check_in THEN
      RAISE EXCEPTION 'Short Stay requires valid check-in and check-out dates';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.reservations r
      WHERE r.listing_id=NEW.listing_id
        AND r.id<>NEW.id
        AND r.status = ANY (ARRAY['payment_pending','reserved','inspection_pending','ready_for_move_in','occupied']::text[])
        AND (
          COALESCE(r.stay_type,'long_stay')<>'short_let'
          OR daterange(r.stay_check_in,r.stay_check_out,'[)') && daterange(NEW.stay_check_in,NEW.stay_check_out,'[)')
        )
    ) THEN
      RAISE EXCEPTION 'Those Short Stay dates are no longer available';
    END IF;
  ELSIF EXISTS (
    SELECT 1 FROM public.reservations r
    WHERE r.listing_id=NEW.listing_id
      AND r.id<>NEW.id
      AND r.status = ANY (ARRAY['payment_pending','reserved','inspection_pending','ready_for_move_in','occupied']::text[])
  ) THEN
    RAISE EXCEPTION 'This property is already held or occupied by another customer';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: process_booking_payment(uuid, text, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.process_booking_payment(p_booking_id uuid, p_paystack_reference text, p_amount numeric) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_booking RECORD; v_wallet RECORD;
BEGIN
  SELECT * INTO v_booking FROM worker_bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  UPDATE worker_bookings SET status = 'paid', paystack_reference = p_paystack_reference,
    paystack_status = 'success', paid_at = NOW(),
    dispute_period_ends_at = NOW() + INTERVAL '48 hours', updated_at = NOW() WHERE id = p_booking_id;
  INSERT INTO booking_status_history (booking_id, old_status, new_status, changed_by, notes)
  VALUES (p_booking_id, v_booking.status, 'paid', 'system', 'Paystack: ' || p_paystack_reference);
  SELECT * INTO v_wallet FROM wallets WHERE owner_id = v_booking.worker_id;
  IF v_wallet.id IS NULL THEN
    INSERT INTO wallets (owner_id, owner_type, pending_balance) VALUES (v_booking.worker_id, 'worker', p_amount);
  ELSE
    UPDATE wallets SET pending_balance = COALESCE(pending_balance, 0) + p_amount, updated_at = NOW() WHERE id = v_wallet.id;
  END IF;
  RETURN TRUE;
END;
$$;


--
-- Name: process_reservation_refund(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.process_reservation_refund(p_reservation_id text, p_reason_category text, p_reason_detail text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE v_res public.reservations; v_calc record; v_actor public.profiles;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role IN ('admin','creator')
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Admin or Creator refund authority required'; END IF;
  SELECT * INTO v_res FROM public.reservations WHERE id=p_reservation_id FOR UPDATE;
  IF v_res IS NULL THEN RAISE EXCEPTION 'Reservation not found'; END IF;
  IF v_actor.role='admin' AND NOT public.current_actor_can_access_listing_ref(v_res.listing_id) THEN RAISE EXCEPTION 'Reservation is outside your assigned branch'; END IF;
  IF v_res.status='refunded' THEN RETURN true; END IF;
  SELECT * INTO v_calc FROM public.calculate_reservation_refund(p_reservation_id,p_reason_category);
  INSERT INTO public.reservation_refunds(reservation_id,user_id,original_amount,refund_percent,refund_amount,wehouse_retained,reason_category,reason_detail,processed_by)
  VALUES(v_res.id,v_res.user_id,v_res.amount,v_calc.refund_percent,v_calc.refund_amount,v_calc.wehouse_retained,p_reason_category,NULLIF(BTRIM(COALESCE(p_reason_detail,'')),''),v_actor.user_id);
  UPDATE public.reservations SET status='refunded',refund_amount=v_calc.refund_amount,refund_reason=p_reason_category,processed_by=v_actor.user_id,processed_at=now(),updated_at=now() WHERE id=v_res.id;
  UPDATE public.listings SET availability_status='available',status='available',reserved_by=NULL,reservation_expiry=NULL,updated_at=now() WHERE id::text=v_res.listing_id OR listing_id=v_res.listing_id;
  RETURN true;
END;
$$;


--
-- Name: process_withdrawal(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.process_withdrawal(p_withdrawal_id uuid, p_paystack_transfer_code text, p_paystack_reference text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_withdrawal RECORD;
  v_wallet RECORD;
  v_caller TEXT;
  v_caller_role TEXT;
BEGIN
  -- ── AUTH: Identify caller ──
  SELECT user_id, role INTO v_caller, v_caller_role
  FROM profiles WHERE auth_id = auth.uid()::text;

  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  -- ── AUTHORIZATION: staff/admin/creator only ──
  IF v_caller_role NOT IN ('staff','admin','creator') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  SELECT * INTO v_withdrawal FROM withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF v_withdrawal IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Withdrawal not found');
  END IF;

  IF v_withdrawal.status != 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Withdrawal not pending');
  END IF;

  SELECT * INTO v_wallet FROM wallets WHERE id = v_withdrawal.wallet_id;
  IF v_wallet IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wallet not found');
  END IF;

  UPDATE withdrawals SET
    status = 'processing',
    paystack_transfer_code = p_paystack_transfer_code,
    paystack_transfer_reference = p_paystack_reference,
    processed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_withdrawal_id;

  RETURN jsonb_build_object('success', true, 'status', 'processing');
END;
$$;


--
-- Name: protect_privileged_profile_fields(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_privileged_profile_fields() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF current_user IN ('anon','authenticated') AND OLD.auth_id = auth.uid()::text THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.auth_id IS DISTINCT FROM OLD.auth_id
      OR NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.email IS DISTINCT FROM OLD.email
      OR NEW.role IS DISTINCT FROM OLD.role
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.email_verified IS DISTINCT FROM OLD.email_verified
      OR NEW.phone_verified IS DISTINCT FROM OLD.phone_verified
      OR NEW.id_verified IS DISTINCT FROM OLD.id_verified
      OR NEW.assigned_state IS DISTINCT FROM OLD.assigned_state
      OR NEW.assigned_lga IS DISTINCT FROM OLD.assigned_lga
      OR NEW.scope IS DISTINCT FROM OLD.scope
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.updated_by IS DISTINCT FROM OLD.updated_by
      OR NEW.maintenance_exempt IS DISTINCT FROM OLD.maintenance_exempt
      OR NEW.is_premium IS DISTINCT FROM OLD.is_premium
      OR NEW.premium_expires_at IS DISTINCT FROM OLD.premium_expires_at
      OR NEW.worker_verified IS DISTINCT FROM OLD.worker_verified
      OR NEW.worker_status IS DISTINCT FROM OLD.worker_status
      OR NEW.deleted IS DISTINCT FROM OLD.deleted
      OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
      OR NEW.suspended IS DISTINCT FROM OLD.suspended
      OR NEW.suspended_at IS DISTINCT FROM OLD.suspended_at
      OR NEW.suspended_by IS DISTINCT FROM OLD.suspended_by
      OR NEW.suspended_reason IS DISTINCT FROM OLD.suspended_reason
      OR NEW.banned IS DISTINCT FROM OLD.banned
      OR NEW.banned_at IS DISTINCT FROM OLD.banned_at
      OR NEW.banned_by IS DISTINCT FROM OLD.banned_by
      OR NEW.banned_reason IS DISTINCT FROM OLD.banned_reason
      OR NEW.rating IS DISTINCT FROM OLD.rating
      OR NEW.review_count IS DISTINCT FROM OLD.review_count
      OR NEW.creator_auth_password IS DISTINCT FROM OLD.creator_auth_password
      OR NEW.creator_auth_enabled IS DISTINCT FROM OLD.creator_auth_enabled
      OR NEW.terms_accepted_at IS DISTINCT FROM OLD.terms_accepted_at
      OR NEW.privacy_accepted_at IS DISTINCT FROM OLD.privacy_accepted_at
      OR NEW.legal_accepted_version IS DISTINCT FROM OLD.legal_accepted_version
    THEN
      RAISE EXCEPTION 'This field cannot be changed from Profile.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: record_bank_account_change(text, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_bank_account_change(p_user_id text, p_bank_name text, p_bank_code text, p_bank_account_number text, p_bank_account_name text, p_verified_account_name text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_changed_by TEXT;
  v_changed_by_role TEXT;
BEGIN
  -- ── AUTH ──
  SELECT user_id, role INTO v_changed_by, v_changed_by_role
  FROM profiles WHERE auth_id = auth.uid()::text;

  -- Self or staff only
  IF v_changed_by != p_user_id AND v_changed_by_role NOT IN ('staff','admin','creator') THEN
    RETURN FALSE;
  END IF;

  -- ── This function ONLY inserts into bank_account_history ──
  -- It does NOT modify wallets, withdrawals, or withdrawal_requests.
  -- Changing the bank account on a pending withdrawal requires
  -- a separate workflow (cancel + re-create, or admin override).

  INSERT INTO bank_account_history (
    user_id, bank_name, bank_code, bank_account_number,
    bank_account_name, verified_account_name,
    is_verified, changed_by
  ) VALUES (
    p_user_id, p_bank_name, p_bank_code, p_bank_account_number,
    p_bank_account_name, p_verified_account_name,
    p_verified_account_name IS NOT NULL, v_changed_by
  );

  INSERT INTO financial_audit_logs (
    event_type, user_id, reference_id, reference_type, description
  ) VALUES (
    'bank_account_change', p_user_id, p_user_id, 'profile',
    'Bank changed to: ' || p_bank_name || ' / ' || p_bank_account_number
  );

  RETURN TRUE;
END;
$$;


--
-- Name: record_worker_verification_payment(text, text, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_worker_verification_payment(p_user_id text, p_reference text, p_amount numeric) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_caller TEXT;
  v_caller_role TEXT;
  v_expected_amount NUMERIC;
  v_payment_id UUID;
  v_verified_ref RECORD;
BEGIN
  -- ── AUTH: Identify caller ──
  SELECT user_id, role INTO v_caller, v_caller_role
  FROM profiles WHERE auth_id = auth.uid()::text;

  IF v_caller IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Only the user themselves or staff can record
  IF v_caller != p_user_id AND v_caller_role NOT IN ('staff','admin','creator') THEN
    RETURN FALSE;
  END IF;

  IF p_reference IS NULL OR p_reference = '' THEN
    RETURN FALSE;
  END IF;

  -- ── REQUIRE: reference must have been independently server-verified ──
  -- This function CONSUMES verification state, never creates it.
  SELECT * INTO v_verified_ref
  FROM verified_paystack_references
  WHERE paystack_reference = p_reference;

  IF v_verified_ref IS NULL THEN
    RETURN FALSE; -- Reference was never server-verified
  END IF;

  -- ── Ownership: verified reference must belong to this user ──
  SELECT bp.user_id INTO v_payment_id FROM booking_payments bp
  WHERE bp.id = v_verified_ref.booking_payment_id;

  -- Note: booking_payments row must exist with correct payer_user_id
  IF NOT EXISTS (
    SELECT 1 FROM booking_payments
    WHERE id = v_verified_ref.booking_payment_id
    AND (payer_user_id = p_user_id OR user_id = p_user_id)
  ) THEN
    RETURN FALSE; -- Verified reference belongs to another user
  END IF;

  -- ── Derive expected amount from settings (NOT browser) ──
  SELECT COALESCE(NULLIF(value, '')::NUMERIC, 0) INTO v_expected_amount
  FROM platform_settings WHERE key = 'worker_verification_fee';

  IF v_expected_amount <= 0 THEN
    RETURN FALSE;
  END IF;

  -- ── Idempotency: already recorded? ──
  IF EXISTS (
    SELECT 1 FROM booking_payments
    WHERE paystack_reference = p_reference AND purpose = 'worker_verification'
  ) THEN
    RETURN TRUE;
  END IF;

  -- ── Record payment in booking_payments ──
  INSERT INTO booking_payments (
    payment_reference, user_id, type,
    payer_user_id, payee_user_id,
    amount, amount_total, commission_amount, net_amount,
    currency, status, purpose,
    paystack_reference,
    paid_at, webhook_processed,
    metadata
  ) VALUES (
    'WHWV_' || p_reference, p_user_id, 'worker_subscription',
    p_user_id, p_user_id,
    v_expected_amount, v_expected_amount, 0, v_expected_amount,
    'NGN', 'completed', 'worker_verification',
    p_reference,
    NOW(), TRUE,
    jsonb_build_object('recorded_by', v_caller, 'expected_amount', v_expected_amount, 'submitted_amount', p_amount, 'verified_by', v_verified_ref.verified_by, 'verified_at', v_verified_ref.verified_at)
  )
  RETURNING id INTO v_payment_id;

  -- ── Audit log ──
  INSERT INTO financial_audit_logs (
    event_type, user_id, amount, reference_id, reference_type, description
  ) VALUES (
    'worker_verification_payment', p_user_id, v_expected_amount,
    v_payment_id::text, 'booking_payment',
    'Worker verification payment recorded (post-verify): ' || p_reference
  );

  RETURN TRUE;
END;
$$;


--
-- Name: refresh_my_roommate_search(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_my_roommate_search() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_actor public.profiles;
  v_prefs public.roommate_preferences;
  v_count integer := 0;
  v_school text;
begin
  select * into v_actor
  from public.profiles
  where auth_id = auth.uid()::text
  limit 1;

  if v_actor is null or v_actor.role <> 'user' then
    raise exception 'Regular user required';
  end if;
  if coalesce(v_actor.deleted,false) or coalesce(v_actor.suspended,false) or coalesce(v_actor.banned,false) then
    raise exception 'Account is not active';
  end if;
  if not coalesce(v_actor.profile_complete,false) then
    raise exception 'Complete your profile first';
  end if;
  if coalesce(v_actor.privacy_search_visible,true)=false or coalesce(v_actor.privacy_profile_visible,true)=false then
    raise exception 'Enable Roommate discovery and profile visibility first';
  end if;

  select * into v_prefs
  from public.roommate_preferences
  where user_id = v_actor.user_id
  for update;

  if v_prefs is null or v_prefs.search_status <> 'active' or coalesce(v_prefs.active,false)=false then
    raise exception 'Roommate matching is paused';
  end if;

  v_school := nullif(btrim(coalesce(v_prefs.school_name,v_actor.school,'')),'');
  if coalesce(v_prefs.school_match,false) and v_school is null then
    raise exception 'Enter your school before using same-school matching';
  end if;

  delete from public.roommate_search_results
  where searcher_id = v_actor.user_id
    and status in ('new','viewed');

  with ranked_candidates as (
    select
      c.user_id,
      least(100,
        round(30 * (
          greatest(0, least(cp.budget_max,v_prefs.budget_max) - greatest(cp.budget_min,v_prefs.budget_min) + 1)::numeric
          / greatest(1, least(cp.budget_max-cp.budget_min+1, v_prefs.budget_max-v_prefs.budget_min+1))
        ))::integer
        + case when nullif(btrim(coalesce(v_actor.local_government,v_actor.city,'')),'') is not null
            and lower(coalesce(nullif(c.local_government,''),c.city,'')) = lower(coalesce(nullif(v_actor.local_government,''),v_actor.city,'')) then 20 else 0 end
        + case when lower(coalesce(cp.cleanliness,'')) = lower(coalesce(v_prefs.cleanliness,'')) then 15 else 0 end
        + case when lower(coalesce(cp.noise_level,'')) = lower(coalesce(v_prefs.noise_level,'')) then 15 else 0 end
        + case when lower(coalesce(cp.visitors,'')) = lower(coalesce(v_prefs.visitors,'')) then 10 else 0 end
        + case when lower(coalesce(cp.stay_duration,'')) = lower(coalesce(v_prefs.stay_duration,'')) then 10 else 0 end
      )::integer as score
    from public.profiles c
    join public.roommate_preferences cp on cp.user_id = c.user_id
    where c.user_id <> v_actor.user_id
      and c.role = 'user'
      and coalesce(c.profile_complete,false)=true
      and coalesce(c.deleted,false)=false
      and coalesce(c.suspended,false)=false
      and coalesce(c.banned,false)=false
      and coalesce(c.privacy_search_visible,true)=true
      and coalesce(c.privacy_profile_visible,true)=true
      and cp.active=true
      and cp.search_status='active'
      and lower(coalesce(c.state,'')) = lower(coalesce(v_actor.state,''))
      and coalesce(cp.budget_max,0) >= v_prefs.budget_min
      and coalesce(cp.budget_min,999999999) <= v_prefs.budget_max
      and (v_prefs.gender_preference='no_preference' or lower(coalesce(c.gender,''))=lower(v_prefs.gender_preference))
      and (cp.gender_preference='no_preference' or lower(coalesce(v_actor.gender,''))=lower(cp.gender_preference))
      and (not coalesce(v_prefs.school_match,false)
        or lower(regexp_replace(btrim(coalesce(cp.school_name,c.school,'')),'\s+',' ','g')) = lower(regexp_replace(btrim(v_school),'\s+',' ','g')))
      and (not coalesce(cp.school_match,false)
        or lower(regexp_replace(btrim(coalesce(v_prefs.school_name,v_actor.school,'')),'\s+',' ','g')) = lower(regexp_replace(btrim(coalesce(cp.school_name,c.school,'')),'\s+',' ','g')))
      and not exists (
        select 1
        from public.roommate_search_results existing
        where existing.searcher_id = v_actor.user_id
          and existing.matched_user_id = c.user_id
          and existing.status in ('accepted','declined')
      )
      and not exists (
        select 1
        from public.conversations existing_conv
        where existing_conv.conversation_type='roommate'
          and coalesce(existing_conv.status,'active')='active'
          and ((existing_conv.participant_a=v_actor.user_id and existing_conv.participant_b=c.user_id)
            or (existing_conv.participant_b=v_actor.user_id and existing_conv.participant_a=c.user_id))
      )
    order by score desc, c.user_id
    limit 120
  )
  insert into public.roommate_search_results(searcher_id,matched_user_id,match_score,status,created_at,updated_at)
  select v_actor.user_id, rc.user_id, rc.score, 'new', now(), now()
  from ranked_candidates rc
  on conflict(searcher_id,matched_user_id) do update
    set match_score = excluded.match_score,
        updated_at = now();

  select count(*) into v_count
  from public.roommate_search_results
  where searcher_id = v_actor.user_id
    and status <> 'declined';

  update public.roommate_preferences
  set search_match_count = v_count,
      active = true,
      search_status = 'active',
      search_expires_at = null,
      updated_at = now()
  where user_id = v_actor.user_id;

  return v_count;
end;
$$;


--
-- Name: refund_escrow(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refund_escrow(p_escrow_id uuid, p_reason text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_escrow RECORD;
  v_caller TEXT;
  v_caller_role TEXT;
BEGIN
  -- ── AUTH: Identify caller ──
  SELECT user_id, role INTO v_caller, v_caller_role
  FROM profiles WHERE auth_id = auth.uid()::text;

  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  -- ── AUTHORIZATION: staff/admin/creator only ──
  IF v_caller_role NOT IN ('staff','admin','creator') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  SELECT * INTO v_escrow FROM escrow_transactions WHERE id = p_escrow_id FOR UPDATE;

  IF v_escrow IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Escrow not found');
  END IF;

  IF v_escrow.status NOT IN ('holding', 'disputed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Escrow cannot be refunded');
  END IF;

  UPDATE escrow_transactions SET
    status = 'refunded',
    updated_at = NOW()
  WHERE id = p_escrow_id;

  RETURN jsonb_build_object('success', true, 'amount_refunded', v_escrow.amount_total);
END;
$$;


--
-- Name: register_pending_property_partner_earning(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.register_pending_property_partner_earning() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: reject_listing_internal(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_listing_internal(p_listing_id uuid, p_reason text) RETURNS public.listings
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$ DECLARE v_actor public.profiles; v_listing public.listings; BEGIN SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role IN ('admin','creator') AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1; IF v_actor IS NULL THEN RAISE EXCEPTION 'Admin or Creator rejection authority required'; END IF; IF NULLIF(BTRIM(COALESCE(p_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'Rejection reason is required'; END IF; SELECT * INTO v_listing FROM public.listings WHERE id=p_listing_id AND deleted_at IS NULL FOR UPDATE; IF v_listing IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF; IF v_listing.status<>'pending_approval' THEN RAISE EXCEPTION 'Only pending listings can be rejected'; END IF; IF v_actor.role='admin' THEN IF COALESCE(v_listing.submitted_by_role,'') NOT IN ('staff','property_partner') THEN RAISE EXCEPTION 'Admin cannot reject this submission type'; END IF; IF NOT public.current_actor_in_scope(v_listing.state,v_listing.city) THEN RAISE EXCEPTION 'Listing is outside your assigned branch'; END IF; END IF; UPDATE public.listings SET status='rejected',availability_status='rejected',approved_by=v_actor.user_id,approved_at=now(),rejection_reason=BTRIM(p_reason) WHERE id=p_listing_id RETURNING * INTO v_listing; RETURN v_listing; END; $$;


--
-- Name: reject_withdrawal_v2(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_withdrawal_v2(p_withdrawal_id uuid, p_reason text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE v_withdrawal RECORD; v_wallet RECORD;
BEGIN
  SELECT * INTO v_withdrawal FROM withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Withdrawal not found'; END IF;
  IF v_withdrawal.status NOT IN ('pending', 'processing') THEN RAISE EXCEPTION 'Cannot be rejected'; END IF;
  SELECT * INTO v_wallet FROM wallets WHERE id = v_withdrawal.wallet_id FOR UPDATE;
  UPDATE wallets SET frozen_balance = GREATEST(0, frozen_balance - v_withdrawal.amount), available_balance = available_balance + v_withdrawal.amount, updated_at = NOW() WHERE id = v_withdrawal.wallet_id;
  UPDATE withdrawals SET status = 'failed', failed_reason = p_reason, updated_at = NOW() WHERE id = p_withdrawal_id;
  RETURN TRUE;
END;
$$;


--
-- Name: release_escrow(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.release_escrow(p_booking_id uuid, p_released_by text DEFAULT 'system'::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_escrow RECORD;
  v_wallet RECORD;
  v_caller TEXT;
  v_caller_role TEXT;
  v_new_balance NUMERIC;
BEGIN
  -- ── AUTH: Identify caller ──
  SELECT user_id, role INTO v_caller, v_caller_role
  FROM profiles WHERE auth_id = auth.uid()::text;

  IF v_caller IS NULL THEN
    RETURN FALSE;
  END IF;

  -- ── AUTHORIZATION: staff/admin/creator only ──
  IF v_caller_role NOT IN ('staff','admin','creator') THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO v_escrow
  FROM escrow_transactions
  WHERE booking_id = p_booking_id AND status = 'holding'
  FOR UPDATE;

  IF v_escrow IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO v_wallet
  FROM wallets
  WHERE owner_id = v_escrow.payee_user_id
  FOR UPDATE;

  IF v_wallet IS NULL THEN
    RETURN FALSE;
  END IF;

  IF v_wallet.is_frozen THEN
    RETURN FALSE;
  END IF;

  -- Amount derived server-side from escrow.amount_payee
  v_new_balance := v_wallet.available_balance + v_escrow.amount_payee;

  UPDATE wallets SET
    available_balance = v_new_balance,
    updated_at = NOW()
  WHERE id = v_wallet.id;

  UPDATE escrow_transactions SET
    status = 'released',
    released_at = NOW(),
    released_by = COALESCE(p_released_by, v_caller),
    updated_at = NOW()
  WHERE id = v_escrow.id;

  INSERT INTO wallet_transactions (
    user_id, transaction_type, amount, description,
    reference_id, reference_type, balance_after
  ) VALUES (
    v_wallet.owner_id, 'escrow_release', v_escrow.amount_payee,
    'Escrow released for booking ' || p_booking_id::text,
    v_escrow.id::text, 'escrow', v_new_balance
  );

  RETURN TRUE;
END;
$$;


--
-- Name: release_property_partner_earning(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.release_property_partner_earning(p_payment_id uuid, p_release_event text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_actor public.profiles; v_e record; v_wallet record; v_expected text; v_new_pending numeric; v_new_available numeric;
  v_listing_state text; v_listing_lga text;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text
    AND role IN ('staff','admin','creator') AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authorized WeHouse operations or finance account required'; END IF;
  IF v_actor.role='staff' AND (NOT public.current_staff_has_permission('operations') OR p_release_event NOT IN ('long_stay_move_in_confirmed','short_stay_check_in_confirmed')) THEN
    RAISE EXCEPTION 'Staff may release property earnings only through a confirmed housing arrival event';
  END IF;

  SELECT * INTO v_e FROM public.property_partner_earning_releases WHERE payment_id=p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending Property Partner earning not found'; END IF;
  SELECT l.state,l.city INTO v_listing_state,v_listing_lga
  FROM public.booking_payments bp JOIN public.listings l ON l.id::text=bp.listing_id
  WHERE bp.id=p_payment_id LIMIT 1;
  IF v_actor.role='admin' AND NOT public.can_current_actor_read_profile(v_e.partner_id) THEN RAISE EXCEPTION 'Partner is outside your assigned branch'; END IF;
  IF v_actor.role='staff' AND (v_listing_state IS NULL OR NOT public.current_actor_in_scope(v_listing_state,v_listing_lga)) THEN RAISE EXCEPTION 'Property is outside your assigned branch'; END IF;
  IF v_e.status='available' THEN RETURN jsonb_build_object('success',true,'already_released',true); END IF;
  IF v_e.status<>'pending' THEN RAISE EXCEPTION 'Earning is not releasable from status %',v_e.status; END IF;
  v_expected:=CASE v_e.earning_type WHEN 'long_stay_rent' THEN 'long_stay_move_in_confirmed' WHEN 'rent_plan_contribution' THEN 'long_stay_installment_period_confirmed' WHEN 'short_stay_rent' THEN 'short_stay_check_in_confirmed' WHEN 'hotel_payment' THEN 'hotel_stay_completed' END;
  IF p_release_event IS DISTINCT FROM v_expected THEN RAISE EXCEPTION 'Invalid release event'; END IF;
  SELECT * INTO v_wallet FROM public.wallets WHERE owner_id=v_e.partner_id AND owner_type='property_partner' FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_wallet.is_frozen,false) OR COALESCE(v_wallet.pending_balance,0)<v_e.net_amount THEN RAISE EXCEPTION 'Partner wallet is not releasable'; END IF;
  v_new_pending:=v_wallet.pending_balance-v_e.net_amount; v_new_available:=COALESCE(v_wallet.available_balance,0)+v_e.net_amount;
  UPDATE public.wallets SET pending_balance=v_new_pending,available_balance=v_new_available,updated_at=now() WHERE id=v_wallet.id;
  UPDATE public.property_partner_earning_releases SET status='available',release_event=p_release_event,released_by=v_actor.user_id,released_at=now(),updated_at=now() WHERE id=v_e.id;
  UPDATE public.commission_ledger SET status='settled',updated_at=now() WHERE payment_id=p_payment_id AND status='collected';
  UPDATE public.property_partners SET total_earnings=COALESCE(total_earnings,0)+v_e.net_amount,updated_at=now() WHERE profile_id=v_e.partner_id;
  INSERT INTO public.wallet_transactions(user_id,transaction_type,amount,balance_after,reference_id,reference_type,description,metadata)
  VALUES(v_e.partner_id,'property_earning_released',v_e.net_amount,v_new_available,p_payment_id::text,'booking_payment','Property earnings released to available balance',jsonb_build_object('release_event',p_release_event,'earning_type',v_e.earning_type,'pending_balance_after',v_new_pending,'available_balance_after',v_new_available));
  INSERT INTO public.financial_audit_logs(event_type,user_id,target_user_id,amount,reference_id,reference_type,description,metadata)
  VALUES('escrow_credit_wallet',v_actor.user_id,v_e.partner_id,v_e.net_amount,p_payment_id::text,'booking_payment','Pending Property Partner earnings released',jsonb_build_object('release_event',p_release_event,'earning_type',v_e.earning_type));
  RETURN jsonb_build_object('success',true,'partner_id',v_e.partner_id,'amount',v_e.net_amount,'status','available');
END;
$$;


--
-- Name: request_inspection_pause_expiry(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.request_inspection_pause_expiry() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
BEGIN
  UPDATE reservations SET status = 'inspection_pending', inspection_requested_at = NOW()
  WHERE id = NEW.reservation_id AND status IN ('active', 'inspection_pending');
  RETURN NEW;
END;
$$;


--
-- Name: request_my_property_partner_withdrawal(numeric, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.request_my_property_partner_withdrawal(p_amount numeric, p_bank_account_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user_id text;
  v_wallet public.wallets;
  v_bank public.bank_accounts;
  v_withdrawal_id uuid;
  v_min numeric:=5000;
BEGIN
  SELECT user_id INTO v_user_id
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND role='property_partner'
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Property Partner account required'; END IF;
  IF p_amount IS NULL OR p_amount<=0 THEN RAISE EXCEPTION 'Amount must be greater than 0'; END IF;

  SELECT * INTO v_bank
  FROM public.bank_accounts
  WHERE id=p_bank_account_id AND user_id=v_user_id AND verified_at IS NOT NULL
  LIMIT 1;
  IF v_bank IS NULL THEN RAISE EXCEPTION 'Choose one of your saved verified payout accounts'; END IF;

  SELECT NULLIF(trim(value),'')::numeric INTO v_min
  FROM public.platform_settings
  WHERE key IN ('wallet_minimum_withdrawal','min_withdrawal')
    AND COALESCE(is_active,true)=true
  ORDER BY CASE key WHEN 'wallet_minimum_withdrawal' THEN 0 ELSE 1 END
  LIMIT 1;
  v_min:=COALESCE(v_min,5000);
  IF p_amount<v_min THEN RAISE EXCEPTION 'Minimum withdrawal is N%',v_min; END IF;

  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE owner_id=v_user_id AND owner_type='property_partner'
  FOR UPDATE;
  IF v_wallet IS NULL THEN RAISE EXCEPTION 'Wallet not found'; END IF;
  IF COALESCE(v_wallet.is_frozen,false) THEN RAISE EXCEPTION 'Wallet is frozen'; END IF;
  IF p_amount>COALESCE(v_wallet.available_balance,0) THEN RAISE EXCEPTION 'Insufficient available balance'; END IF;

  UPDATE public.wallets
  SET available_balance=available_balance-p_amount,
      frozen_balance=COALESCE(frozen_balance,0)+p_amount,
      updated_at=now()
  WHERE id=v_wallet.id;

  INSERT INTO public.withdrawals(
    wallet_id,amount,status,bank_name,bank_account_number,bank_account_name,
    bank_account_id,payout_recipient_code,
    snapshot_bank_name,snapshot_bank_account_number,snapshot_bank_account_name,snapshot_bank_code,
    created_at,updated_at
  ) VALUES (
    v_wallet.id,p_amount,'pending',v_bank.bank_name,v_bank.account_number,v_bank.account_name,
    v_bank.id,v_bank.paystack_recipient_code,
    v_bank.bank_name,v_bank.account_number,v_bank.account_name,v_bank.bank_code,now(),now()
  ) RETURNING id INTO v_withdrawal_id;

  INSERT INTO public.wallet_transactions(
    user_id,transaction_type,amount,balance_after,reference_id,reference_type,description,metadata
  ) VALUES (
    v_user_id,'withdrawal',-p_amount,(v_wallet.available_balance-p_amount),v_withdrawal_id::text,'withdrawal',
    'Withdrawal requested; funds held pending approval',
    jsonb_build_object('status','pending','bank_account_id',v_bank.id)
  );

  RETURN v_withdrawal_id;
END;
$$;


--
-- Name: request_withdrawal(text, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.request_withdrawal(p_user_id text, p_amount numeric) RETURNS TABLE(withdrawal_id uuid, paystack_kobo integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_wallet RECORD; v_bank RECORD;
BEGIN
  SELECT * INTO v_wallet FROM wallets WHERE owner_id = p_user_id;
  IF NOT FOUND OR COALESCE(v_wallet.available_balance, 0) < p_amount THEN RETURN; END IF;
  SELECT * INTO v_bank FROM bank_accounts WHERE user_id = p_user_id ORDER BY is_default DESC, created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE wallets SET available_balance = COALESCE(available_balance, 0) - p_amount,
    total_withdrawn = COALESCE(total_withdrawn, 0) + p_amount, updated_at = NOW() WHERE id = v_wallet.id;
  RETURN QUERY INSERT INTO withdrawal_requests (wallet_id, user_id, amount, bank_account_number, bank_code, bank_name, account_name)
  VALUES (v_wallet.id, p_user_id, p_amount, v_bank.account_number, v_bank.bank_code, v_bank.bank_name, v_bank.account_name)
  RETURNING id, (p_amount * 100)::INT;
END;
$$;


--
-- Name: request_withdrawal_v2(uuid, numeric, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.request_withdrawal_v2(p_wallet_id uuid, p_amount numeric, p_bank_account_number text, p_bank_code text, p_bank_name text, p_account_name text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE v_wallet RECORD; v_withdrawal_id UUID; v_min_withdrawal NUMERIC;
BEGIN
  SELECT COALESCE(NULLIF(value, '')::NUMERIC, 5000) INTO v_min_withdrawal FROM platform_settings WHERE key = 'min_withdrawal';
  SELECT * INTO v_wallet FROM wallets WHERE id = p_wallet_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet not found'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be greater than 0'; END IF;
  IF p_amount < v_min_withdrawal THEN RAISE EXCEPTION 'Minimum withdrawal is N%', v_min_withdrawal; END IF;
  IF p_amount > v_wallet.available_balance THEN RAISE EXCEPTION 'Insufficient balance. Available: N%', v_wallet.available_balance; END IF;
  UPDATE wallets SET available_balance = available_balance - p_amount, frozen_balance = frozen_balance + p_amount, updated_at = NOW() WHERE id = p_wallet_id;
  INSERT INTO withdrawals (wallet_id, amount, bank_account_number, bank_code, bank_name, account_name, status)
  VALUES (p_wallet_id, p_amount, p_bank_account_number, p_bank_code, p_bank_name, p_account_name, 'pending') RETURNING id INTO v_withdrawal_id;
  RETURN v_withdrawal_id;
END;
$$;


--
-- Name: request_worker_withdrawal(numeric, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.request_worker_withdrawal(p_amount numeric, p_bank_account_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user_id text;
  v_wallet public.wallets;
  v_bank public.bank_accounts;
  v_min numeric;
  v_request_id uuid;
  v_new_balance numeric;
BEGIN
  SELECT user_id INTO v_user_id
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND role='worker'
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('success',false,'error','Worker account required'); END IF;
  IF p_amount IS NULL OR p_amount<=0 THEN RETURN jsonb_build_object('success',false,'error','Amount must be positive'); END IF;

  IF p_bank_account_id IS NOT NULL THEN
    SELECT * INTO v_bank
    FROM public.bank_accounts
    WHERE id=p_bank_account_id AND user_id=v_user_id AND verified_at IS NOT NULL;
  ELSE
    SELECT * INTO v_bank
    FROM public.bank_accounts
    WHERE user_id=v_user_id AND verified_at IS NOT NULL
    ORDER BY is_default DESC,created_at ASC
    LIMIT 1;
  END IF;
  IF v_bank IS NULL THEN RETURN jsonb_build_object('success',false,'error','Choose one of your saved verified payout accounts'); END IF;

  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE owner_id=v_user_id AND owner_type='worker'
  FOR UPDATE;
  IF v_wallet IS NULL THEN RETURN jsonb_build_object('success',false,'error','Wallet not found'); END IF;
  IF COALESCE(v_wallet.is_frozen,false) THEN RETURN jsonb_build_object('success',false,'error','Wallet is frozen'); END IF;

  SELECT NULLIF(trim(value),'')::numeric INTO v_min
  FROM public.platform_settings
  WHERE key IN ('wallet_minimum_withdrawal','min_withdrawal')
    AND COALESCE(is_active,true)=true
  ORDER BY CASE key WHEN 'wallet_minimum_withdrawal' THEN 0 ELSE 1 END
  LIMIT 1;
  IF v_min IS NULL THEN RETURN jsonb_build_object('success',false,'error','Minimum withdrawal setting is missing'); END IF;
  IF p_amount<v_min THEN RETURN jsonb_build_object('success',false,'error',format('Minimum withdrawal is ₦%s',v_min)); END IF;
  IF p_amount>COALESCE(v_wallet.available_balance,0) THEN RETURN jsonb_build_object('success',false,'error','Insufficient balance'); END IF;

  v_new_balance:=v_wallet.available_balance-p_amount;
  UPDATE public.wallets
  SET available_balance=v_new_balance,
      pending_balance=COALESCE(pending_balance,0)+p_amount,
      updated_at=now()
  WHERE id=v_wallet.id;

  INSERT INTO public.withdrawals(
    wallet_id,amount,bank_name,bank_account_number,bank_account_name,
    bank_account_id,payout_recipient_code,status,created_at,updated_at
  ) VALUES (
    v_wallet.id,p_amount,v_bank.bank_name,v_bank.account_number,v_bank.account_name,
    v_bank.id,v_bank.paystack_recipient_code,'pending',now(),now()
  ) RETURNING id INTO v_request_id;

  INSERT INTO public.wallet_transactions(
    user_id,transaction_type,amount,balance_after,reference_id,reference_type,description,metadata,created_at
  ) VALUES (
    v_user_id,'withdrawal',-p_amount,v_new_balance,v_request_id::text,'withdrawal',
    format('Withdrawal request: ₦%s to %s ending %s',p_amount,v_bank.bank_name,right(v_bank.account_number,4)),
    jsonb_build_object('wallet_id',v_wallet.id,'amount',p_amount,'bank_account_id',v_bank.id),now()
  );

  RETURN jsonb_build_object('success',true,'request_id',v_request_id,'amount',p_amount,'status','pending','bank_account_id',v_bank.id);
END;
$$;


--
-- Name: reserve_lga_booking_code(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reserve_lga_booking_code(p_lga text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE v_prefix text := public.lga_booking_prefix(p_lga); v_code text; v_attempt integer := 0;
BEGIN
  LOOP
    v_attempt := v_attempt + 1;
    IF v_attempt > 100 THEN RAISE EXCEPTION 'Could not allocate a unique booking code'; END IF;
    v_code := v_prefix || lpad(floor(random() * 100000)::integer::text, 5, '0');
    INSERT INTO public.booking_code_registry(code) VALUES (v_code) ON CONFLICT DO NOTHING;
    IF FOUND THEN RETURN v_code; END IF;
  END LOOP;
END; $$;


--
-- Name: reserve_listing_on_activation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reserve_listing_on_activation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
BEGIN
  IF NEW.status = 'active' AND OLD.status != 'active' THEN
    UPDATE listings SET availability_status = 'reserved', reserved_by = NEW.user_id, reserved_at = NOW()
    WHERE id = NEW.listing_id AND availability_status = 'available';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: respond_private_call(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.respond_private_call(p_call_id uuid, p_accept boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_me text:=public.current_profile_user_id(); v_call public.private_calls;
begin
 select * into v_call from public.private_calls where id=p_call_id for update;
 if v_call is null or v_call.callee_id<>v_me then raise exception 'Incoming call not found'; end if;
 if v_call.status<>'ringing' then return public.get_private_call_details(p_call_id); end if;
 update public.private_calls set status=case when p_accept then 'accepted' else 'declined' end,answered_at=case when p_accept then now() else null end,ended_at=case when p_accept then null else now() end where id=p_call_id;
 return public.get_private_call_details(p_call_id);
end; $$;


--
-- Name: reverse_payment(uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reverse_payment(p_payment_id uuid, p_reversal_type text, p_reason text DEFAULT NULL::text, p_reversal_reference text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_payment RECORD;
  v_processed_by TEXT;
  v_processed_by_role TEXT;
  v_net NUMERIC;
BEGIN
  -- ── AUTH ──
  SELECT user_id, role INTO v_processed_by, v_processed_by_role
  FROM profiles WHERE auth_id = auth.uid()::text;

  -- Staff/admin/creator only
  IF v_processed_by_role NOT IN ('staff','admin','creator') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_payment FROM booking_payments WHERE id = p_payment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF v_payment.status IN ('refunded', 'disputed') THEN RAISE EXCEPTION 'Already reversed'; END IF;

  v_net := 0;

  INSERT INTO payment_reversals (
    original_payment_id, original_reference, reversal_type,
    original_amount, reversal_amount, net_after_reversal,
    reason, processed_by, reversal_reference
  ) VALUES (
    p_payment_id, v_payment.paystack_reference, p_reversal_type,
    COALESCE(v_payment.amount_total, v_payment.amount, 0),
    COALESCE(v_payment.amount_total, v_payment.amount, 0),
    v_net, p_reason, v_processed_by, p_reversal_reference
  );

  UPDATE booking_payments
  SET status = 'refunded', updated_at = NOW()
  WHERE id = p_payment_id;

  UPDATE commission_ledger
  SET status = 'refunded', updated_at = NOW()
  WHERE payment_id = p_payment_id;

  RETURN TRUE;
END;
$$;


--
-- Name: reverse_pending_property_partner_earning(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reverse_pending_property_partner_earning(p_payment_id uuid, p_reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE v_actor public.profiles; v_e record; v_wallet record; v_new_pending numeric;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role IN ('admin','creator')
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Admin or Creator finance authority required'; END IF;
  IF NULLIF(BTRIM(COALESCE(p_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'Reversal reason is required'; END IF;
  SELECT * INTO v_e FROM public.property_partner_earning_releases WHERE payment_id=p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Property Partner earning not found'; END IF;
  IF v_actor.role='admin' AND NOT public.can_current_actor_read_profile(v_e.partner_id) THEN RAISE EXCEPTION 'Partner is outside your assigned branch'; END IF;
  IF v_e.status='reversed' THEN RETURN jsonb_build_object('success',true,'already_reversed',true); END IF;
  IF v_e.status<>'pending' THEN RAISE EXCEPTION 'Only pending earnings can be reversed'; END IF;
  SELECT * INTO v_wallet FROM public.wallets WHERE owner_id=v_e.partner_id AND owner_type='property_partner' FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_wallet.pending_balance,0)<v_e.net_amount THEN RAISE EXCEPTION 'Pending wallet balance is inconsistent'; END IF;
  v_new_pending:=v_wallet.pending_balance-v_e.net_amount;
  UPDATE public.wallets SET pending_balance=v_new_pending,updated_at=now() WHERE id=v_wallet.id;
  UPDATE public.property_partner_earning_releases SET status='reversed',reversed_by=v_actor.user_id,reversed_at=now(),reversal_reason=BTRIM(p_reason),updated_at=now() WHERE id=v_e.id;
  UPDATE public.commission_ledger SET status='refunded',updated_at=now() WHERE payment_id=p_payment_id;
  INSERT INTO public.wallet_transactions(user_id,transaction_type,amount,balance_after,reference_id,reference_type,description,metadata) VALUES(v_e.partner_id,'property_earning_reversed',-v_e.net_amount,v_new_pending,p_payment_id::text,'booking_payment','Pending property earnings reversed',jsonb_build_object('reason',BTRIM(p_reason),'wallet_bucket','pending'));
  INSERT INTO public.financial_audit_logs(event_type,user_id,target_user_id,amount,reference_id,reference_type,description,metadata) VALUES('payment_reversed',v_actor.user_id,v_e.partner_id,v_e.net_amount,p_payment_id::text,'booking_payment','Pending Property Partner earning reversed',jsonb_build_object('reason',BTRIM(p_reason)));
  RETURN jsonb_build_object('success',true,'status','reversed','pending_balance',v_new_pending);
END;
$$;


--
-- Name: review_my_staff_listing(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.review_my_staff_listing(p_listing_id uuid, p_decision text, p_reason text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ DECLARE v_actor record; v_listing record; BEGIN SELECT user_id,role,assigned_state,assigned_lga,deleted,suspended,banned INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1; IF v_actor IS NULL OR COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN RAISE EXCEPTION 'Active staff account required'; END IF; IF v_actor.role='staff' AND NOT public.current_staff_has_permission('operations') THEN RAISE EXCEPTION 'Operations permission required'; END IF; IF v_actor.role NOT IN('staff','admin','creator') THEN RAISE EXCEPTION 'Staff access required'; END IF; SELECT * INTO v_listing FROM public.listings WHERE id=p_listing_id AND deleted_at IS NULL FOR UPDATE; IF v_listing IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF; IF v_actor.role='staff' AND NOT(v_actor.assigned_state IS NOT NULL AND lower(v_listing.state)=lower(v_actor.assigned_state) AND (v_actor.assigned_lga IS NULL OR lower(v_listing.city)=lower(v_actor.assigned_lga))) THEN RAISE EXCEPTION 'Listing is outside your assigned branch'; END IF; IF v_listing.status<>'pending_approval' THEN RAISE EXCEPTION 'Only pending listings can be reviewed'; END IF; IF p_decision='approve' THEN UPDATE public.listings SET status='available',availability_status='available',approved_by=v_actor.user_id,approved_at=now(),rejection_reason=NULL,updated_at=now() WHERE id=p_listing_id; ELSIF p_decision='reject' THEN IF NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Rejection reason required'; END IF; UPDATE public.listings SET status='rejected',rejection_reason=btrim(p_reason),approved_by=NULL,approved_at=NULL,updated_at=now() WHERE id=p_listing_id; ELSE RAISE EXCEPTION 'Invalid review decision'; END IF; RETURN true; END; $$;


--
-- Name: review_my_staff_worker_v2(text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.review_my_staff_worker_v2(p_worker_id text, p_status text, p_reason text DEFAULT NULL::text, p_notes text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles; v_worker public.profiles; v_ver public.worker_verifications; v_identity public.worker_identity_checks;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor IS NULL OR v_actor.role<>'staff' OR COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN RAISE EXCEPTION 'Active Staff account required'; END IF;
  IF NOT public.current_staff_has_permission('verification') THEN RAISE EXCEPTION 'Trusted Verification Staff permission required'; END IF;
  IF p_status NOT IN('verified','rejected') THEN RAISE EXCEPTION 'Invalid review outcome'; END IF;
  IF p_status='rejected' AND NULLIF(BTRIM(COALESCE(p_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'Rejection reason is required'; END IF;
  SELECT * INTO v_worker FROM public.profiles WHERE user_id=p_worker_id AND role='worker' FOR UPDATE;
  IF v_worker IS NULL THEN RAISE EXCEPTION 'Worker not found'; END IF;
  IF v_actor.assigned_state IS NULL OR lower(COALESCE(v_worker.state,''))<>lower(v_actor.assigned_state) OR(v_actor.assigned_lga IS NOT NULL AND lower(COALESCE(v_worker.local_government,v_worker.city,''))<>lower(v_actor.assigned_lga)) THEN RAISE EXCEPTION 'Worker is outside your assigned branch'; END IF;
  SELECT * INTO v_ver FROM public.worker_verifications WHERE worker_id=p_worker_id LIMIT 1;
  IF p_status='verified' THEN
    IF v_worker.worker_status<>'profile_under_review' THEN RAISE EXCEPTION 'Worker is not in the review queue'; END IF;
    SELECT * INTO v_identity FROM public.worker_identity_checks WHERE worker_id=p_worker_id;
    IF v_identity IS NULL OR v_identity.status<>'passed' THEN RAISE EXCEPTION 'Automatic private face check has not passed'; END IF;
    IF NOT public.worker_test_passed(p_worker_id) THEN RAISE EXCEPTION 'Worker readiness check has not been passed'; END IF;
    IF v_ver IS NULL OR NULLIF(BTRIM(COALESCE(v_ver.verification_video_url,'')),'') IS NULL THEN RAISE EXCEPTION 'Professional work evidence is incomplete'; END IF;
  END IF;
  UPDATE public.profiles SET worker_status=p_status,worker_verified=(p_status='verified'),available=(p_status='verified'),updated_at=now(),updated_by=v_actor.user_id WHERE user_id=p_worker_id;
  UPDATE public.worker_verifications SET status=p_status,reviewed_by=v_actor.user_id,review_notes=COALESCE(NULLIF(BTRIM(p_notes),''),NULLIF(BTRIM(p_reason),'')),reviewed_at=now(),updated_at=now() WHERE id=v_ver.id;
  INSERT INTO public.worker_verification_reviews(worker_id,reviewer_id,reviewer_role,action,rejection_reason,notes,created_at)
  VALUES(p_worker_id,v_actor.user_id,v_actor.role,p_status,CASE WHEN p_status='rejected' THEN BTRIM(p_reason) ELSE NULL END,NULLIF(BTRIM(COALESCE(p_notes,'')),''),now());
  RETURN true;
END; $$;


--
-- Name: save_my_roommate_preferences(text, text, integer, integer, text, text, text, text, text, text, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_my_roommate_preferences(p_gender text, p_gender_preference text, p_budget_min integer, p_budget_max integer, p_cleanliness text, p_noise_level text, p_sleep_time text, p_visitors text, p_stay_duration text, p_area_preference text DEFAULT NULL::text, p_bio text DEFAULT NULL::text, p_school_name text DEFAULT NULL::text, p_campus text DEFAULT NULL::text, p_level text DEFAULT NULL::text, p_department text DEFAULT NULL::text) RETURNS public.roommate_preferences
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles; v_row public.roommate_preferences; v_allowed boolean;
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
  INSERT INTO public.roommate_preferences(user_id,auth_id,gender,gender_preference,budget_min,budget_max,cleanliness,noise_level,sleep_time,visitors,stay_duration,area_preference,bio,school_name,campus,level,department,active,search_status,search_started_at,search_expires_at,created_at,updated_at)
  VALUES(v_actor.user_id,v_actor.auth_id,BTRIM(p_gender),p_gender_preference,p_budget_min,p_budget_max,p_cleanliness,p_noise_level,p_sleep_time,p_visitors,p_stay_duration,NULLIF(BTRIM(COALESCE(p_area_preference,'')),''),NULLIF(BTRIM(COALESCE(p_bio,'')),''),NULLIF(BTRIM(COALESCE(p_school_name,'')),''),NULLIF(BTRIM(COALESCE(p_campus,'')),''),NULLIF(BTRIM(COALESCE(p_level,'')),''),NULLIF(BTRIM(COALESCE(p_department,'')),''),v_allowed,CASE WHEN v_allowed THEN 'active' ELSE 'stopped' END,CASE WHEN v_allowed THEN now() ELSE NULL END,NULL,now(),now())
  ON CONFLICT(user_id) DO UPDATE SET gender=EXCLUDED.gender,gender_preference=EXCLUDED.gender_preference,budget_min=EXCLUDED.budget_min,budget_max=EXCLUDED.budget_max,cleanliness=EXCLUDED.cleanliness,noise_level=EXCLUDED.noise_level,sleep_time=EXCLUDED.sleep_time,visitors=EXCLUDED.visitors,stay_duration=EXCLUDED.stay_duration,area_preference=EXCLUDED.area_preference,bio=EXCLUDED.bio,school_name=EXCLUDED.school_name,campus=EXCLUDED.campus,level=EXCLUDED.level,department=EXCLUDED.department,active=CASE WHEN public.roommate_preferences.search_status='stopped' THEN false ELSE v_allowed END,search_status=CASE WHEN public.roommate_preferences.search_status='stopped' THEN 'stopped' WHEN v_allowed THEN 'active' ELSE 'stopped' END,search_started_at=CASE WHEN public.roommate_preferences.search_status='stopped' OR NOT v_allowed THEN public.roommate_preferences.search_started_at ELSE COALESCE(public.roommate_preferences.search_started_at,now()) END,search_expires_at=NULL,updated_at=now()
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;


--
-- Name: save_my_worker_professional_evidence(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_my_worker_professional_evidence(p_certificate_path text, p_video_path text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_profile public.profiles; v_paid boolean; v_id uuid;
BEGIN
 SELECT * INTO v_profile FROM public.profiles WHERE auth_id=auth.uid()::text AND role='worker' AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
 IF v_profile IS NULL THEN RAISE EXCEPTION 'Active Worker account required'; END IF;
 IF v_profile.worker_status='verified' THEN RAISE EXCEPTION 'Live Worker evidence changes require a new review process'; END IF;
 IF NOT COALESCE(v_profile.profile_complete,false) THEN RAISE EXCEPTION 'Complete your professional profile first'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.worker_service_coverage WHERE worker_id=v_profile.user_id) THEN RAISE EXCEPTION 'Complete your service coverage first'; END IF;
 SELECT EXISTS(SELECT 1 FROM public.booking_payments WHERE user_id=v_profile.user_id AND purpose='worker_verification' AND status IN ('paid','completed')) INTO v_paid;
 IF NOT v_paid THEN RAISE EXCEPTION 'Verified Paystack payment is required first'; END IF;
 IF NOT public.worker_test_passed(v_profile.user_id) THEN RAISE EXCEPTION 'Pass the Worker readiness test first'; END IF;
 IF NULLIF(BTRIM(COALESCE(p_video_path,'')),'') IS NULL THEN RAISE EXCEPTION 'Skill demonstration video is required'; END IF;
 IF split_part(p_video_path,'/',1)<>v_profile.user_id THEN RAISE EXCEPTION 'Invalid Worker video path'; END IF;
 IF NULLIF(BTRIM(COALESCE(p_certificate_path,'')),'') IS NOT NULL AND split_part(p_certificate_path,'/',1)<>v_profile.user_id THEN RAISE EXCEPTION 'Invalid Worker certificate path'; END IF;
 INSERT INTO public.worker_verifications(worker_id,certificate_path,verification_video_url,status,identity_provider,identity_status,submitted_at,created_at,updated_at,gov_id_type,gov_id_number,gov_id_photo_url,selfie_photo_url)
 VALUES(v_profile.user_id,NULLIF(BTRIM(COALESCE(p_certificate_path,'')),''),BTRIM(p_video_path),'evidence_ready','youverify','ready_for_external',NULL,now(),now(),NULL,NULL,NULL,NULL)
 ON CONFLICT(worker_id) DO UPDATE SET certificate_path=EXCLUDED.certificate_path,verification_video_url=EXCLUDED.verification_video_url,status='evidence_ready',identity_provider=CASE WHEN worker_verifications.identity_status='verified' THEN worker_verifications.identity_provider ELSE 'youverify' END,identity_status=CASE WHEN worker_verifications.identity_status='verified' THEN 'verified' ELSE 'ready_for_external' END,identity_reference=CASE WHEN worker_verifications.identity_status='verified' THEN worker_verifications.identity_reference ELSE NULL END,identity_checked_at=CASE WHEN worker_verifications.identity_status='verified' THEN worker_verifications.identity_checked_at ELSE NULL END,identity_failure_reason=NULL,submitted_at=NULL,reviewed_by=NULL,review_notes=NULL,reviewed_at=NULL,gov_id_type=NULL,gov_id_number=NULL,gov_id_photo_url=NULL,selfie_photo_url=NULL,updated_at=now() RETURNING id INTO v_id;
 UPDATE public.profiles SET worker_status='verification_paid',worker_verified=false,available=false,worker_cert_url=NULLIF(BTRIM(COALESCE(p_certificate_path,'')),''),worker_video_url=BTRIM(p_video_path),updated_at=now() WHERE user_id=v_profile.user_id;
 RETURN v_id;
END; $$;


--
-- Name: save_verified_payout_account(text, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_verified_payout_account(p_user_id text, p_bank_code text, p_bank_name text, p_account_number text, p_account_name text, p_recipient_code text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE
  v_claim_role text:=COALESCE(current_setting('request.jwt.claim.role',true),'');
  v_profile public.profiles;
  v_account public.bank_accounts;
  v_existing_count integer:=0;
  v_profile_tokens text[];
  v_account_tokens text[];
  v_match_count integer:=0;
  v_is_first boolean:=false;
BEGIN
  IF v_claim_role<>'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE user_id=p_user_id
    AND role IN ('worker','property_partner')
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  FOR UPDATE;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Active Worker or Property Partner account required'; END IF;

  IF COALESCE(BTRIM(p_bank_code),'')='' OR COALESCE(BTRIM(p_bank_name),'')='' THEN RAISE EXCEPTION 'Verified bank is required'; END IF;
  IF COALESCE(BTRIM(p_account_number),'') !~ '^[0-9]{10}$' THEN RAISE EXCEPTION 'Bank account number must contain 10 digits'; END IF;
  IF COALESCE(BTRIM(p_account_name),'')='' THEN RAISE EXCEPTION 'Verified account name is required'; END IF;

  -- An already accepted destination remains accepted. Re-saving it never makes
  -- the user pass the later-account name rule again.
  SELECT * INTO v_account
  FROM public.bank_accounts
  WHERE user_id=p_user_id
    AND bank_code=BTRIM(p_bank_code)
    AND account_number=BTRIM(p_account_number)
  LIMIT 1;

  IF v_account IS NOT NULL THEN
    UPDATE public.bank_accounts
    SET bank_name=BTRIM(p_bank_name),
        account_name=BTRIM(p_account_name),
        paystack_recipient_code=COALESCE(NULLIF(BTRIM(COALESCE(p_recipient_code,'')),''),paystack_recipient_code),
        verified_at=COALESCE(verified_at,now())
    WHERE id=v_account.id
    RETURNING * INTO v_account;

    RETURN jsonb_build_object(
      'success',true,
      'already_saved',true,
      'first_account',COALESCE(v_account.is_default,false),
      'additional_account',NOT COALESCE(v_account.is_default,false),
      'name_match_count',NULL,
      'account',jsonb_build_object(
        'id',v_account.id,
        'bank_name',v_account.bank_name,
        'bank_code',v_account.bank_code,
        'account_number',v_account.account_number,
        'account_name',v_account.account_name,
        'is_default',COALESCE(v_account.is_default,false),
        'verified_at',v_account.verified_at
      )
    );
  END IF;

  SELECT count(*)::integer INTO v_existing_count
  FROM public.bank_accounts
  WHERE user_id=p_user_id;
  v_is_first:=v_existing_count=0;

  IF NOT v_is_first THEN
    IF COALESCE(BTRIM(v_profile.full_name),'')='' THEN
      RAISE EXCEPTION 'Complete your WeHouse full name before adding another payout account';
    END IF;

    SELECT ARRAY(
      SELECT DISTINCT token
      FROM unnest(regexp_split_to_array(
        lower(regexp_replace(v_profile.full_name,'[^a-zA-Z0-9 ]',' ','g')),
        '\s+'
      )) token
      WHERE length(token)>1
        AND token NOT IN ('mr','mrs','miss','ms','dr','chief','alhaji','hajiya','hon','prof','sir','madam')
    ) INTO v_profile_tokens;

    SELECT ARRAY(
      SELECT DISTINCT token
      FROM unnest(regexp_split_to_array(
        lower(regexp_replace(p_account_name,'[^a-zA-Z0-9 ]',' ','g')),
        '\s+'
      )) token
      WHERE length(token)>1
        AND token NOT IN ('mr','mrs','miss','ms','dr','chief','alhaji','hajiya','hon','prof','sir','madam')
    ) INTO v_account_tokens;

    IF COALESCE(cardinality(v_profile_tokens),0)<2 THEN
      RAISE EXCEPTION 'Your WeHouse full name must contain at least two names before adding another payout account';
    END IF;

    SELECT count(DISTINCT token)::integer INTO v_match_count
    FROM unnest(v_profile_tokens) token
    WHERE token=ANY(v_account_tokens);

    IF v_match_count<2 THEN
      RAISE EXCEPTION 'The verified bank account name must match at least two names from your WeHouse full name';
    END IF;
  END IF;

  INSERT INTO public.bank_accounts(
    user_id,account_number,bank_code,bank_name,account_name,
    paystack_recipient_code,is_default,verified_at,created_at
  ) VALUES (
    p_user_id,BTRIM(p_account_number),BTRIM(p_bank_code),BTRIM(p_bank_name),BTRIM(p_account_name),
    NULLIF(BTRIM(COALESCE(p_recipient_code,'')),''),v_is_first,now(),now()
  ) RETURNING * INTO v_account;

  -- Legacy wallet fields mirror only the first/default account. Withdrawal RPCs
  -- use the selected saved bank_accounts row, so old accounts never stop working.
  IF v_is_first THEN
    UPDATE public.wallets
    SET bank_name=v_account.bank_name,
        bank_account_number=v_account.account_number,
        bank_account_name=v_account.account_name,
        paystack_recipient_code=v_account.paystack_recipient_code,
        updated_at=now()
    WHERE owner_id=p_user_id AND owner_type=v_profile.role;
  END IF;

  INSERT INTO public.bank_account_history(
    user_id,bank_name,bank_code,bank_account_number,bank_account_name,
    verified_account_name,is_verified,changed_at,changed_by
  ) VALUES (
    p_user_id,v_account.bank_name,v_account.bank_code,v_account.account_number,
    v_account.account_name,v_account.account_name,true,now(),p_user_id
  );

  INSERT INTO public.financial_audit_logs(
    event_type,user_id,target_user_id,reference_id,reference_type,description,metadata,created_at
  ) VALUES (
    CASE WHEN v_is_first THEN 'payout_account_added' ELSE 'additional_payout_account_added' END,
    p_user_id,p_user_id,v_account.id::text,'bank_account',
    CASE WHEN v_is_first THEN 'First verified payout account added' ELSE 'Additional verified payout account added' END,
    jsonb_build_object(
      'bank_name',v_account.bank_name,
      'account_last4',RIGHT(v_account.account_number,4),
      'account_name',v_account.account_name,
      'first_account',v_is_first,
      'matching_name_tokens',CASE WHEN v_is_first THEN NULL ELSE v_match_count END
    ),now()
  );

  RETURN jsonb_build_object(
    'success',true,
    'already_saved',false,
    'first_account',v_is_first,
    'additional_account',NOT v_is_first,
    'name_match_count',v_match_count,
    'account',jsonb_build_object(
      'id',v_account.id,
      'bank_name',v_account.bank_name,
      'bank_code',v_account.bank_code,
      'account_number',v_account.account_number,
      'account_name',v_account.account_name,
      'is_default',v_account.is_default,
      'verified_at',v_account.verified_at
    )
  );
END;
$_$;


--
-- Name: send_booking_message(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.send_booking_message(p_conversation_id uuid, p_content text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_sender_id TEXT;v_booking_id UUID;v_msg_id UUID;
BEGIN
SELECT user_id INTO v_sender_id FROM public.profiles WHERE auth_id=auth.uid()::text;
IF v_sender_id IS NULL THEN RAISE EXCEPTION 'Sender profile not found'; END IF;
SELECT booking_id INTO v_booking_id FROM public.booking_conversations WHERE id=p_conversation_id;
IF v_booking_id IS NULL THEN RAISE EXCEPTION 'Conversation not found'; END IF;
IF NOT EXISTS(SELECT 1 FROM public.worker_bookings WHERE id=v_booking_id AND (user_id=v_sender_id OR worker_id=v_sender_id)) THEN RAISE EXCEPTION 'Not authorized to send messages in this conversation'; END IF;
INSERT INTO public.booking_messages(conversation_id,sender_id,content,created_at) VALUES(p_conversation_id,v_sender_id,p_content,NOW()) RETURNING id INTO v_msg_id;
UPDATE public.booking_conversations SET updated_at=NOW() WHERE id=p_conversation_id;
RETURN v_msg_id;
END; $$;


--
-- Name: send_booking_message_v2(uuid, text, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.send_booking_message_v2(p_conversation_id uuid, p_content text DEFAULT ''::text, p_attachments text[] DEFAULT '{}'::text[]) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles;v_conv public.booking_conversations;v_booking public.worker_bookings;v_msg_id uuid;v_path text;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND coalesce(deleted,false)=false AND coalesce(suspended,false)=false AND coalesce(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_conv FROM public.booking_conversations WHERE id=p_conversation_id;
  IF v_conv IS NULL THEN RAISE EXCEPTION 'Conversation not found'; END IF;
  IF v_actor.user_id NOT IN (v_conv.user_id,v_conv.worker_id) THEN RAISE EXCEPTION 'Not authorized to send messages in this conversation'; END IF;
  SELECT * INTO v_booking FROM public.worker_bookings WHERE id=v_conv.booking_id FOR UPDATE;
  IF v_booking IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF v_booking.status IN ('approved_released','cancelled','refunded') THEN RAISE EXCEPTION 'This job conversation is closed'; END IF;
  IF nullif(btrim(coalesce(p_content,'')),'') IS NULL AND coalesce(cardinality(p_attachments),0)=0 THEN RAISE EXCEPTION 'Message or attachment is required'; END IF;
  IF coalesce(cardinality(p_attachments),0)>6 THEN RAISE EXCEPTION 'A maximum of 6 attachments can be sent at once'; END IF;
  FOREACH v_path IN ARRAY coalesce(p_attachments,'{}'::text[]) LOOP IF position(p_conversation_id::text||'/' IN coalesce(v_path,''))<>1 THEN RAISE EXCEPTION 'Invalid attachment path'; END IF; END LOOP;
  INSERT INTO public.booking_messages(conversation_id,sender_id,content,attachments,created_at) VALUES(p_conversation_id,v_actor.user_id,coalesce(btrim(p_content),''),coalesce(p_attachments,'{}'::text[]),now()) RETURNING id INTO v_msg_id;
  IF v_actor.user_id=v_conv.worker_id AND v_booking.status='booking_requested' THEN UPDATE public.worker_bookings SET status='negotiating',updated_at=now() WHERE id=v_booking.id; END IF;
  UPDATE public.booking_conversations SET updated_at=now() WHERE id=p_conversation_id;
  RETURN v_msg_id;
END;
$$;


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    sender_id text NOT NULL,
    content text NOT NULL,
    seen boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    edited_at timestamp with time zone,
    file_url text,
    file_name text,
    file_type text,
    attachments text[] DEFAULT '{}'::text[] NOT NULL,
    attachment_types text[] DEFAULT '{}'::text[] NOT NULL
);


--
-- Name: send_my_roommate_message(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.send_my_roommate_message(p_conversation_id uuid, p_content text) RETURNS public.messages
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare a public.profiles; m public.messages;
begin
  select * into a from public.profiles where auth_id=auth.uid()::text limit 1;
  if a is null or a.role<>'user' then raise exception 'Regular user account required'; end if;
  if not public._can_access_conversation(p_conversation_id) then raise exception 'Roommate conversation unavailable'; end if;
  if nullif(btrim(p_content),'') is null then raise exception 'Message is required'; end if;
  insert into public.messages(conversation_id,sender_id,content,seen,created_at)
  values(p_conversation_id,a.user_id,btrim(p_content),false,now()) returning * into m;
  return m;
end $$;


--
-- Name: send_my_roommate_message_v2(uuid, text, text[], text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.send_my_roommate_message_v2(p_conversation_id uuid, p_content text DEFAULT ''::text, p_attachments text[] DEFAULT '{}'::text[], p_attachment_types text[] DEFAULT '{}'::text[]) RETURNS public.messages
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor public.profiles;
  v_conv public.conversations;
  v_message public.messages;
  v_path text;
  v_type text;
  v_i integer;
BEGIN
  v_actor:=public._current_comm_actor();
  IF v_actor IS NULL OR v_actor.role<>'user' THEN RAISE EXCEPTION 'Regular user account required'; END IF;

  SELECT * INTO v_conv FROM public.conversations WHERE id=p_conversation_id;
  IF v_conv IS NULL OR v_conv.conversation_type<>'roommate'
     OR v_actor.user_id NOT IN (v_conv.participant_a,v_conv.participant_b)
     OR NOT public._can_access_conversation(p_conversation_id) THEN
    RAISE EXCEPTION 'Roommate conversation unavailable';
  END IF;

  IF NULLIF(BTRIM(COALESCE(p_content,'')),'') IS NULL AND COALESCE(cardinality(p_attachments),0)=0 THEN
    RAISE EXCEPTION 'Message, photo or voice note is required';
  END IF;
  IF COALESCE(cardinality(p_attachments),0)>6 THEN RAISE EXCEPTION 'A maximum of 6 attachments can be sent at once'; END IF;
  IF COALESCE(cardinality(p_attachments),0)<>COALESCE(cardinality(p_attachment_types),0) THEN
    RAISE EXCEPTION 'Attachment metadata mismatch';
  END IF;

  IF COALESCE(cardinality(p_attachments),0)>0 THEN
    FOR v_i IN 1..cardinality(p_attachments) LOOP
      v_path:=p_attachments[v_i];
      v_type:=COALESCE(p_attachment_types[v_i],'');
      IF v_path IS NULL OR v_path NOT LIKE p_conversation_id::text||'/%' THEN
        RAISE EXCEPTION 'Invalid attachment path';
      END IF;
      IF v_type NOT LIKE 'image/%' AND v_type NOT LIKE 'audio/%' THEN
        RAISE EXCEPTION 'Roommate chat supports photos and voice notes only';
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.messages(conversation_id,sender_id,content,seen,created_at,attachments,attachment_types)
  VALUES(
    p_conversation_id,
    v_actor.user_id,
    COALESCE(BTRIM(p_content),''),
    false,
    now(),
    COALESCE(p_attachments,'{}'::text[]),
    COALESCE(p_attachment_types,'{}'::text[])
  )
  RETURNING * INTO v_message;

  RETURN v_message;
END;
$$;


--
-- Name: send_support_message(uuid, text, text[], text[], text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.send_support_message(p_conversation_id uuid, p_content text DEFAULT ''::text, p_attachments text[] DEFAULT '{}'::text[], p_attachment_types text[] DEFAULT '{}'::text[], p_action_type text DEFAULT NULL::text, p_action_metadata jsonb DEFAULT '{}'::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor public.profiles;
  v_conv public.partner_support_conversations;
  v_id uuid;
  v_staff_ok boolean:=false;
  v_sender_role text;
  v_context_id text;
  v_snapshot jsonb;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor.user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN RAISE EXCEPTION 'Account is not active'; END IF;
  SELECT * INTO v_conv FROM public.partner_support_conversations WHERE id=p_conversation_id FOR UPDATE;
  IF v_conv.id IS NULL THEN RAISE EXCEPTION 'Conversation not found'; END IF;

  IF v_actor.role='staff' THEN
    SELECT EXISTS(
      SELECT 1 FROM public.staff_permissions sp
      WHERE sp.staff_id=v_actor.user_id AND sp.permission='support'
        AND COALESCE(sp.is_active,true)=true AND sp.revoked_at IS NULL
    ) INTO v_staff_ok;
  END IF;

  IF v_staff_ok THEN
    IF v_conv.assigned_staff_id IS NULL THEN
      UPDATE public.partner_support_conversations
      SET assigned_staff_id=v_actor.user_id,updated_at=NOW()
      WHERE id=p_conversation_id AND assigned_staff_id IS NULL;
      SELECT * INTO v_conv FROM public.partner_support_conversations WHERE id=p_conversation_id;
    ELSIF v_conv.assigned_staff_id<>v_actor.user_id THEN
      RAISE EXCEPTION 'This conversation is being handled by another support team member';
    END IF;
  END IF;

  IF NOT (
    v_actor.user_id=v_conv.partner_id
    OR v_actor.user_id=v_conv.assigned_staff_id
    OR v_actor.user_id=v_conv.assigned_field_officer_id
    OR v_actor.role IN ('admin','creator')
  ) THEN RAISE EXCEPTION 'Not authorised'; END IF;

  IF NULLIF(BTRIM(COALESCE(p_content,'')),'') IS NULL AND COALESCE(cardinality(p_attachments),0)=0 THEN
    RAISE EXCEPTION 'Message or attachment is required';
  END IF;
  IF COALESCE(cardinality(p_attachments),0)<>COALESCE(cardinality(p_attachment_types),0) THEN
    RAISE EXCEPTION 'Attachment metadata mismatch';
  END IF;

  v_sender_role:=CASE
    WHEN v_actor.user_id=v_conv.partner_id THEN COALESCE(v_conv.requester_role,v_actor.role)
    WHEN v_actor.user_id=v_conv.assigned_field_officer_id THEN 'field_officer'
    WHEN v_actor.role='creator' THEN 'creator'
    WHEN v_actor.role='admin' THEN 'admin'
    ELSE 'support'
  END;

  INSERT INTO public.partner_support_messages(
    conversation_id,sender_id,sender_role,content,attachments,attachment_types,action_type,action_metadata,created_at
  ) VALUES (
    p_conversation_id,v_actor.user_id,v_sender_role,COALESCE(BTRIM(p_content),''),COALESCE(p_attachments,'{}'),
    COALESCE(p_attachment_types,'{}'),NULLIF(BTRIM(COALESCE(p_action_type,'')),''),COALESCE(p_action_metadata,'{}'::jsonb),NOW()
  ) RETURNING id INTO v_id;

  IF v_actor.user_id=v_conv.partner_id THEN
    v_context_id:=NULLIF(BTRIM(COALESCE(p_action_metadata->>'context_id','')),'');
    v_snapshot:=COALESCE(p_action_metadata->'context_snapshot','{}'::jsonb);
    UPDATE public.partner_support_conversations
    SET status='open',resolved_at=NULL,closed_at=NULL,updated_at=NOW(),
        category=COALESCE(NULLIF(BTRIM(COALESCE(p_action_metadata->>'category','')),''),category),
        context_type=COALESCE(NULLIF(BTRIM(COALESCE(p_action_metadata->>'context_type','')),''),NULLIF(BTRIM(COALESCE(p_action_type,'')),''),context_type),
        context_id=COALESCE(v_context_id,context_id),
        context_snapshot=CASE WHEN v_snapshot<>'{}'::jsonb THEN v_snapshot ELSE context_snapshot END
    WHERE id=p_conversation_id;
  ELSE
    UPDATE public.partner_support_conversations SET updated_at=NOW() WHERE id=p_conversation_id;
  END IF;
  RETURN v_id;
END $$;


--
-- Name: set_apartment_commission_on_reservation(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_apartment_commission_on_reservation(p_reservation_id text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE v_rate NUMERIC;
BEGIN
  SELECT COALESCE(NULLIF(value, '')::NUMERIC, 10) INTO v_rate FROM platform_settings WHERE key = 'commission_apartment';
  UPDATE reservations SET commission_rate = v_rate WHERE id = p_reservation_id;
  RETURN TRUE;
END;
$$;


--
-- Name: set_hotel_booking_code(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_hotel_booking_code() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE v_lga text;
BEGIN
  IF TG_OP='UPDATE' THEN NEW.booking_code := OLD.booking_code; RETURN NEW; END IF;
  IF NULLIF(btrim(COALESCE(NEW.booking_code,'')),'') IS NOT NULL THEN
    INSERT INTO public.booking_code_registry(code) VALUES (upper(btrim(NEW.booking_code))) ON CONFLICT DO NOTHING;
    NEW.booking_code := upper(btrim(NEW.booking_code)); RETURN NEW;
  END IF;
  SELECT COALESCE(NULLIF(btrim(h.city),''), NULLIF(btrim(h.state),''), 'General') INTO v_lga
  FROM public.hotels h WHERE h.hotel_id=NEW.hotel_id LIMIT 1;
  NEW.booking_code := public.reserve_lga_booking_code(COALESCE(v_lga,'General'));
  RETURN NEW;
END; $$;


--
-- Name: set_listing_status_internal(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_listing_status_internal(p_listing_id text, p_status text) RETURNS public.listings
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles; v_listing public.listings;
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role IN ('staff','admin','creator')
    AND NOT COALESCE(deleted,false) AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false)
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Listing operations access required'; END IF;
  IF v_actor.role='staff' AND NOT public.current_staff_has_permission('operations') THEN RAISE EXCEPTION 'Operations Staff permission required'; END IF;
  IF p_status NOT IN ('available','maintenance','closed') THEN
    RAISE EXCEPTION 'Reserved and occupied states are controlled by reservation/tenancy workflows';
  END IF;
  SELECT * INTO v_listing FROM public.listings
  WHERE (listing_id=p_listing_id OR id::text=p_listing_id) AND deleted_at IS NULL FOR UPDATE;
  IF v_listing IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF;
  IF v_actor.role<>'creator' AND NOT public.current_actor_in_scope(v_listing.state,v_listing.city) THEN RAISE EXCEPTION 'Listing is outside your assigned State/LGA'; END IF;
  IF v_listing.status IN ('pending_approval','rejected') THEN RAISE EXCEPTION 'Approval state must be resolved first'; END IF;
  IF v_listing.status IN ('reserved','occupied') OR v_listing.current_reservation_id IS NOT NULL THEN
    RAISE EXCEPTION 'Resolve the active reservation/tenancy instead of manually changing this property';
  END IF;
  UPDATE public.listings SET status=p_status,availability_status=p_status,updated_at=now() WHERE id=v_listing.id RETURNING * INTO v_listing;
  RETURN v_listing;
END;
$$;


--
-- Name: set_my_private_call_preferences(boolean, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_my_private_call_preferences(p_allow_audio boolean, p_allow_video boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_me text:=public.current_profile_user_id(); v_role text:=public.current_profile_role();
begin
 if v_me is null or v_role not in ('user','worker') then raise exception 'Calls are available to Users and Workers'; end if;
 insert into public.private_call_preferences(user_id,allow_audio_calls,allow_video_calls,updated_at) values(v_me,coalesce(p_allow_audio,true),coalesce(p_allow_video,false),now()) on conflict(user_id) do update set allow_audio_calls=excluded.allow_audio_calls,allow_video_calls=excluded.allow_video_calls,updated_at=now();
 return public.get_my_private_call_preferences();
end; $$;


--
-- Name: set_my_roommate_school_filter(boolean, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_my_roommate_school_filter(p_school_match boolean, p_school_name text DEFAULT NULL::text, p_campus text DEFAULT NULL::text) RETURNS public.roommate_preferences
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor public.profiles;
  v_row public.roommate_preferences;
  v_school text;
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
  LIMIT 1;

  IF v_actor IS NULL OR v_actor.role<>'user' THEN
    RAISE EXCEPTION 'Roommate matching is available to regular users only';
  END IF;
  IF COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN
    RAISE EXCEPTION 'Account is not active';
  END IF;

  SELECT * INTO v_row
  FROM public.roommate_preferences
  WHERE user_id=v_actor.user_id
  FOR UPDATE;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'Save roommate preferences first';
  END IF;

  v_school := NULLIF(BTRIM(COALESCE(p_school_name,v_row.school_name,v_actor.school,'')),'');
  IF COALESCE(p_school_match,false) AND v_school IS NULL THEN
    RAISE EXCEPTION 'Enter your school before enabling same-school matching';
  END IF;

  UPDATE public.roommate_preferences
  SET school_name=v_school,
      campus=NULLIF(BTRIM(COALESCE(p_campus,campus,'')),''),
      school_match=COALESCE(p_school_match,false),
      updated_at=now()
  WHERE user_id=v_actor.user_id
  RETURNING * INTO v_row;

  DELETE FROM public.roommate_search_results r
  WHERE r.searcher_id=v_actor.user_id
    AND r.status IN ('new','viewed')
    AND (
      COALESCE(v_row.school_match,false)
      AND NOT EXISTS (
        SELECT 1
        FROM public.profiles candidate
        LEFT JOIN public.roommate_preferences candidate_prefs ON candidate_prefs.user_id=candidate.user_id
        WHERE candidate.user_id=r.matched_user_id
          AND lower(regexp_replace(BTRIM(COALESCE(candidate_prefs.school_name,candidate.school,'')), '\s+', ' ', 'g'))
              = lower(regexp_replace(BTRIM(v_row.school_name), '\s+', ' ', 'g'))
      )
    );

  RETURN v_row;
END
$$;


--
-- Name: set_my_worker_availability(boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_my_worker_availability(p_is_available boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare w public.profiles;
begin
  select * into w from public.profiles where auth_id=auth.uid()::text for update;
  if w is null or w.role<>'worker' then raise exception 'Worker account required'; end if;
  if coalesce(w.deleted,false) or coalesce(w.suspended,false) or coalesce(w.banned,false) then raise exception 'Worker account is not active'; end if;
  if p_is_available and (w.worker_status<>'verified' or w.worker_verified is distinct from true) then raise exception 'Only verified workers can become available'; end if;
  if p_is_available and not public.worker_identity_is_current(w.user_id) then raise exception 'Repeat your WeHouse identity check before going available'; end if;
  update public.profiles set available=p_is_available,updated_at=now() where id=w.id;
end $$;


--
-- Name: set_property_inspection_stay_type(uuid, text, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_property_inspection_stay_type(p_inspection_id uuid, p_sub_type text, p_security_deposit_amount numeric DEFAULT NULL::numeric) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_actor public.profiles;
  v_ir public.inspection_requests;
  v_amenities text[];
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND role IN ('staff','admin','creator')
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'WeHouse operations access required'; END IF;
  IF v_actor.role='staff' AND NOT public.current_staff_has_permission('operations') THEN
    RAISE EXCEPTION 'Operations permission required';
  END IF;
  IF p_sub_type NOT IN ('short_let','long_stay') THEN RAISE EXCEPTION 'Choose Short Stay or Long Stay'; END IF;

  SELECT * INTO v_ir FROM public.inspection_requests WHERE id=p_inspection_id FOR UPDATE;
  IF v_ir IS NULL THEN RAISE EXCEPTION 'Property request not found'; END IF;
  IF v_ir.property_type<>'apartment' THEN RAISE EXCEPTION 'Stay type applies to apartments only'; END IF;
  IF v_ir.published_at IS NOT NULL THEN RAISE EXCEPTION 'Published property classification cannot be changed here'; END IF;
  IF v_actor.role<>'creator' AND NOT public.current_actor_in_scope(v_ir.property_state,v_ir.property_city) THEN
    RAISE EXCEPTION 'Property is outside your assigned State/LGA';
  END IF;
  IF p_sub_type='short_let' AND COALESCE(p_security_deposit_amount,0)<=0 THEN
    RAISE EXCEPTION 'Short Stay requires a refundable security deposit';
  END IF;

  v_amenities := COALESCE(v_ir.amenities,ARRAY[]::text[]);
  IF p_sub_type='short_let' AND NOT ('Furnished'=ANY(v_amenities)) THEN
    v_amenities := array_append(v_amenities,'Furnished');
  END IF;

  UPDATE public.inspection_requests
  SET sub_type=p_sub_type,
      security_deposit_amount=CASE WHEN p_sub_type='short_let' THEN p_security_deposit_amount ELSE NULL END,
      amenities=v_amenities,
      updated_at=now()
  WHERE id=p_inspection_id;

  RETURN jsonb_build_object(
    'success',true,
    'sub_type',p_sub_type,
    'security_deposit_amount',CASE WHEN p_sub_type='short_let' THEN p_security_deposit_amount ELSE NULL END
  );
END;
$$;


--
-- Name: set_reservation_booking_code(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_reservation_booking_code() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE v_lga text;
BEGIN
  IF TG_OP='UPDATE' THEN NEW.booking_code := OLD.booking_code; RETURN NEW; END IF;
  IF NULLIF(btrim(COALESCE(NEW.booking_code,'')),'') IS NOT NULL THEN
    INSERT INTO public.booking_code_registry(code) VALUES (upper(btrim(NEW.booking_code))) ON CONFLICT DO NOTHING;
    NEW.booking_code := upper(btrim(NEW.booking_code)); RETURN NEW;
  END IF;
  SELECT COALESCE(NULLIF(btrim(l.city),''), NULLIF(btrim(l.state),''), 'General') INTO v_lga
  FROM public.listings l WHERE l.id::text=NEW.listing_id OR l.listing_id=NEW.listing_id LIMIT 1;
  NEW.booking_code := public.reserve_lga_booking_code(COALESCE(v_lga,'General'));
  RETURN NEW;
END; $$;


--
-- Name: set_reservation_expiry(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_reservation_expiry() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
DECLARE v_hold_days INTEGER;
BEGIN
  IF NEW.status = 'active' AND OLD.status != 'active' THEN
    SELECT COALESCE(NULLIF(value, '')::INTEGER, 3) INTO v_hold_days FROM platform_settings WHERE key = 'apartment_reservation_hold_days';
    IF v_hold_days IS NULL THEN v_hold_days := 3; END IF;
    NEW.hold_expires_at := NOW() + (v_hold_days || ' days')::INTERVAL;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: set_secret_v2(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_secret_v2(p_key text, p_value text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ begin
  if not public.is_current_creator() then raise exception 'Creator account required'; end if;
  if nullif(btrim(coalesce(p_key,'')),'') is null then raise exception 'Secret key is required'; end if;
  insert into public.secrets(key,value,updated_at,updated_by)
  values(btrim(p_key),coalesce(p_value,''),now(),auth.uid()::text)
  on conflict(key) do update set value=excluded.value,updated_at=now(),updated_by=auth.uid()::text;
  return true;
end $$;


--
-- Name: set_setting_v2(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_setting_v2(p_key text, p_value text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
                                        DECLARE
                                          v_role TEXT;
                                          BEGIN
                                            -- Validate caller is creator
                                              SELECT role INTO v_role FROM profiles WHERE user_id = auth.uid()::text;
                                                IF v_role NOT IN ('creator') THEN
                                                    RAISE EXCEPTION 'Only Creator can modify settings';
                                                      END IF;
                                                        
                                                          INSERT INTO platform_settings (key, value, updated_at)
                                                            VALUES (p_key, p_value, NOW())
                                                              ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
                                                                RETURN TRUE;
                                                                END;
                                                                $$;


--
-- Name: set_staff_trust_status(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_staff_trust_status(p_staff_id text, p_status text, p_notes text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles; v_target public.profiles; v_trust public.staff_trust_profiles; v_previous text;
BEGIN
  IF p_status NOT IN('probation','trusted','restricted','revoked') THEN RAISE EXCEPTION 'Invalid Staff trust status'; END IF;
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role IN('admin','creator')
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Admin or Creator access required'; END IF;
  SELECT * INTO v_target FROM public.profiles WHERE user_id=p_staff_id AND role='staff' AND COALESCE(deleted,false)=false LIMIT 1;
  IF v_target IS NULL THEN RAISE EXCEPTION 'Staff profile not found'; END IF;
  IF v_actor.role='admin' AND (v_actor.assigned_state IS DISTINCT FROM v_target.assigned_state OR v_actor.assigned_lga IS DISTINCT FROM v_target.assigned_lga) THEN
    RAISE EXCEPTION 'Admin can review only Staff in the same assigned branch';
  END IF;
  SELECT * INTO v_trust FROM public.staff_trust_profiles WHERE staff_id=p_staff_id; v_previous:=v_trust.status;
  IF p_status='trusted' THEN
    IF v_trust IS NULL THEN RAISE EXCEPTION 'Complete the Staff trust checklist first'; END IF;
    IF NOT(v_trust.supervisor_confirmed AND v_trust.orientation_completed AND v_trust.role_training_completed AND v_trust.code_of_conduct_confirmed AND v_trust.probation_observation_completed) THEN
      RAISE EXCEPTION 'Complete every WeHouse Staff trust check before marking this Staff member trusted';
    END IF;
  END IF;
  UPDATE public.staff_trust_profiles SET
    status=p_status,
    trusted_by=CASE WHEN p_status='trusted' THEN v_actor.user_id ELSE trusted_by END,
    trusted_at=CASE WHEN p_status='trusted' THEN now() ELSE trusted_at END,
    notes=COALESCE(NULLIF(BTRIM(COALESCE(p_notes,'')),''),notes),updated_at=now()
  WHERE staff_id=p_staff_id;
  IF NOT FOUND THEN
    INSERT INTO public.staff_trust_profiles(staff_id,status,appointed_by,appointed_at,notes,updated_at)
    VALUES(p_staff_id,p_status,v_actor.user_id,now(),NULLIF(BTRIM(COALESCE(p_notes,'')),''),now());
  END IF;
  INSERT INTO public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
  VALUES('STAFF_TRUST_CHANGE','profiles',p_staff_id,jsonb_build_object('previous_status',COALESCE(v_previous,'none'),'new_status',p_status,'notes',NULLIF(BTRIM(COALESCE(p_notes,'')),''),'state',v_target.assigned_state,'lga',v_target.assigned_lga)::text,v_actor.user_id,v_actor.email);
  RETURN true;
END;
$$;


--
-- Name: settle_verified_property_partner_payment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.settle_verified_property_partner_payment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_partner_id text;
  v_partner_role text;
  v_commission_key text;
  v_commission_rate numeric;
  v_verified_total numeric;
  v_eligible_gross numeric;
  v_security_deposit numeric:=0;
  v_commission numeric;
  v_partner_net numeric;
  v_wallet record;
  v_new_pending numeric;
  v_payment_component text;
BEGIN
  IF NEW.status NOT IN ('paid','completed') OR OLD.status IN ('paid','completed') THEN RETURN NEW; END IF;
  IF NEW.purpose IN ('apartment_reservation','hotel_reservation') THEN RETURN NEW; END IF;
  IF NEW.purpose NOT IN ('apartment_rent','rent_plan_contribution','hotel_booking') THEN RETURN NEW; END IF;
  IF NEW.paystack_reference IS NULL THEN RAISE EXCEPTION 'Verified property payment requires a Paystack reference'; END IF;
  IF EXISTS (SELECT 1 FROM public.commission_ledger WHERE paystack_reference=NEW.paystack_reference) THEN RETURN NEW; END IF;

  IF NEW.purpose='hotel_booking' AND NOT EXISTS (
    SELECT 1 FROM public.hotel_bookings hb
    WHERE hb.booking_id=NEW.hotel_booking_id AND hb.status='confirmed' AND hb.payment_status='paid'
  ) THEN
    INSERT INTO public.financial_audit_logs(event_type,user_id,amount,reference_id,reference_type,description,metadata)
    VALUES('hotel_payment_fulfillment_review',NEW.user_id,COALESCE(NEW.verified_amount,NEW.amount_total,NEW.amount,0),NEW.id::text,'booking_payment',
      'Verified hotel payment withheld from partner settlement until booking fulfillment is confirmed',
      jsonb_build_object('hotel_booking_id',NEW.hotel_booking_id,'paystack_reference',NEW.paystack_reference));
    RETURN NEW;
  END IF;

  v_verified_total:=round(COALESCE(NEW.verified_amount,NEW.amount_total,NEW.amount,0)::numeric,2);
  IF v_verified_total<=0 THEN RAISE EXCEPTION 'Verified property payment amount must be greater than zero'; END IF;

  IF NEW.purpose IN ('apartment_rent','rent_plan_contribution') THEN
    SELECT COALESCE(l.partner_id,l.owner_id) INTO v_partner_id
    FROM public.listings l
    WHERE l.id::text=NEW.listing_id OR l.listing_id=NEW.listing_id
    LIMIT 1;
    v_commission_key:='commission_apartment';
    v_payment_component:=COALESCE(NEW.metadata->>'payment_component',CASE WHEN NEW.purpose='rent_plan_contribution' THEN 'rent_plan_contribution' ELSE NULL END);
    IF v_payment_component IS NULL OR v_payment_component NOT IN ('long_stay_rent','short_stay_rent','rent_plan_contribution') THEN RAISE EXCEPTION 'Apartment payment must identify a supported payment component'; END IF;
    v_security_deposit:=round(COALESCE(NULLIF(NEW.metadata->>'security_deposit_amount','')::numeric,0),2);
    IF v_security_deposit<0 OR v_security_deposit>v_verified_total THEN RAISE EXCEPTION 'Invalid security deposit amount'; END IF;
    IF v_payment_component='short_stay_rent' AND NOT (NEW.metadata ? 'security_deposit_amount') THEN RAISE EXCEPTION 'Short Stay payment must store security_deposit_amount separately'; END IF;
    v_eligible_gross:=round(COALESCE(NULLIF(NEW.metadata->>'eligible_partner_amount','')::numeric,v_verified_total-v_security_deposit),2);
  ELSE
    SELECT h.owner_id INTO v_partner_id
    FROM public.hotel_bookings hb
    JOIN public.hotels h ON h.hotel_id=hb.hotel_id
    WHERE hb.booking_id=NEW.hotel_booking_id
    LIMIT 1;
    v_commission_key:='commission_hotel';
    v_payment_component:='hotel_payment';
    v_eligible_gross:=v_verified_total;
  END IF;

  IF v_partner_id IS NULL THEN RETURN NEW; END IF;
  SELECT role INTO v_partner_role
  FROM public.profiles
  WHERE user_id=v_partner_id
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_partner_role IS DISTINCT FROM 'property_partner' THEN RETURN NEW; END IF;

  IF v_eligible_gross<=0 OR v_eligible_gross>v_verified_total THEN RAISE EXCEPTION 'Invalid eligible Property Partner amount'; END IF;
  SELECT NULLIF(value,'')::numeric INTO v_commission_rate
  FROM public.platform_settings
  WHERE key=v_commission_key AND COALESCE(is_active,true)=true
  LIMIT 1;
  IF v_commission_rate IS NULL OR v_commission_rate<0 OR v_commission_rate>50 THEN RAISE EXCEPTION 'Creator commission setting is missing or invalid'; END IF;

  v_commission:=round(v_eligible_gross*v_commission_rate/100,2);
  v_partner_net:=round(v_eligible_gross-v_commission,2);
  INSERT INTO public.wallets(owner_id,owner_type,available_balance,pending_balance,frozen_balance,total_withdrawn)
  VALUES(v_partner_id,'property_partner',0,0,0,0)
  ON CONFLICT(owner_id,owner_type) DO NOTHING;
  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE owner_id=v_partner_id AND owner_type='property_partner'
  FOR UPDATE;
  IF COALESCE(v_wallet.is_frozen,false) THEN RAISE EXCEPTION 'Property Partner wallet is frozen'; END IF;

  v_new_pending:=COALESCE(v_wallet.pending_balance,0)+v_partner_net;
  UPDATE public.wallets SET pending_balance=v_new_pending,updated_at=now() WHERE id=v_wallet.id;
  UPDATE public.booking_payments
  SET payee_user_id=v_partner_id,commission_rate=v_commission_rate,amount_commission=v_commission,net_amount=v_partner_net,updated_at=now()
  WHERE id=NEW.id;

  INSERT INTO public.commission_ledger(payment_id,booking_type,source_user_id,commission_amount,commission_rate,gross_amount,description,paystack_reference,status,created_at,updated_at)
  VALUES(NEW.id,CASE WHEN NEW.purpose='hotel_booking' THEN 'hotel' ELSE 'apartment' END,v_partner_id,v_commission,v_commission_rate,v_eligible_gross,
    format('%s commission from verified %s payment',CASE WHEN NEW.purpose='hotel_booking' THEN 'Hotel' ELSE 'Apartment' END,v_payment_component),NEW.paystack_reference,'collected',now(),now());
  INSERT INTO public.wallet_transactions(user_id,transaction_type,amount,balance_after,reference_id,reference_type,description,metadata,created_at)
  VALUES(v_partner_id,'property_earning_pending',v_partner_net,v_new_pending,NEW.id::text,'booking_payment',format('Pending net earnings from %s',replace(v_payment_component,'_',' ')),
    jsonb_build_object('paystack_reference',NEW.paystack_reference,'purpose',NEW.purpose,'gross_eligible_amount',v_eligible_gross,'security_deposit_amount',v_security_deposit,'commission_rate',v_commission_rate,'commission_amount',v_commission,'net_amount',v_partner_net,'wallet_bucket','pending'),now());
  INSERT INTO public.financial_audit_logs(event_type,user_id,target_user_id,amount,reference_id,reference_type,description,metadata)
  VALUES('commission_deducted',NEW.user_id,v_partner_id,v_partner_net,NEW.id::text,'booking_payment','Verified property payment recorded as pending partner earnings',jsonb_build_object('purpose',NEW.purpose,'commission_key',v_commission_key,'commission_amount',v_commission));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    INSERT INTO public.financial_audit_logs(event_type,user_id,amount,reference_id,reference_type,description,metadata)
    VALUES('property_settlement_review',NEW.user_id,COALESCE(NEW.verified_amount,NEW.amount_total,NEW.amount,0),NEW.id::text,'booking_payment',
      'Verified property payment requires Finance settlement review',
      jsonb_build_object('purpose',NEW.purpose,'paystack_reference',NEW.paystack_reference,'reason',SQLERRM));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$$;


--
-- Name: soft_delete_listing_internal(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.soft_delete_listing_internal(p_listing_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE v_actor public.profiles; v_listing public.listings;
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role IN ('staff','admin','creator')
    AND NOT COALESCE(deleted,false) AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false)
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'WeHouse operations access required'; END IF;
  IF v_actor.role='staff' AND NOT EXISTS(
    SELECT 1 FROM public.staff_permissions sp WHERE sp.staff_id=v_actor.user_id AND sp.permission='operations' AND sp.is_active=true
  ) THEN RAISE EXCEPTION 'Operations Staff permission required'; END IF;
  SELECT * INTO v_listing FROM public.listings WHERE id=p_listing_id AND deleted_at IS NULL FOR UPDATE;
  IF v_listing IS NULL THEN RETURN false; END IF;
  IF v_actor.role<>'creator' AND NOT public.current_actor_in_scope(v_listing.state,v_listing.city) THEN
    RAISE EXCEPTION 'Listing is outside your assigned State/LGA';
  END IF;
  UPDATE public.listings SET status='closed',availability_status='closed',deleted_at=now() WHERE id=p_listing_id;
  RETURN true;
END; $$;


--
-- Name: staff_assign_customer_inspection(uuid, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_assign_customer_inspection(p_inspection_id uuid, p_field_officer_id text, p_scheduled_date timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS public.user_inspection_requests
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE v_actor public.profiles; v_req public.user_inspection_requests; v_listing public.listings; v_officer public.profiles;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role IN ('admin','creator')
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Admin or Creator access required'; END IF;
  SELECT * INTO v_req FROM public.user_inspection_requests WHERE id=p_inspection_id AND status='pending' FOR UPDATE;
  IF v_req IS NULL THEN RAISE EXCEPTION 'Pending inspection request not found'; END IF;
  SELECT * INTO v_listing FROM public.listings WHERE id::text=v_req.listing_id OR listing_id=v_req.listing_id LIMIT 1;
  IF v_listing IS NULL THEN RAISE EXCEPTION 'Inspection listing not found'; END IF;
  IF v_actor.role='admin' AND NOT public.current_actor_in_scope(v_listing.state,v_listing.city) THEN RAISE EXCEPTION 'Inspection is outside your assigned branch'; END IF;
  SELECT * INTO v_officer FROM public.profiles WHERE user_id=p_field_officer_id AND role='staff'
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_officer IS NULL OR lower(COALESCE(v_officer.assigned_state,''))<>lower(COALESCE(v_listing.state,''))
    OR lower(COALESCE(v_officer.assigned_lga,''))<>lower(COALESCE(v_listing.city,''))
    OR NOT EXISTS(SELECT 1 FROM public.staff_permissions sp WHERE sp.staff_id=v_officer.user_id AND sp.permission='field_officer' AND sp.is_active=true)
  THEN RAISE EXCEPTION 'Eligible Field Officer in the listing branch is required'; END IF;
  UPDATE public.user_inspection_requests SET field_officer_id=v_officer.user_id,status='scheduled',scheduled_date=p_scheduled_date,updated_at=now()
  WHERE id=p_inspection_id RETURNING * INTO v_req;
  RETURN v_req;
END;
$$;


--
-- Name: staff_branch_analytics(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_branch_analytics(p_staff_user_id text) RETURNS TABLE(metric text, value integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_staff RECORD; v_permission TEXT;
BEGIN
  SELECT assigned_state,assigned_lga,scope INTO v_staff FROM public.profiles WHERE user_id=p_staff_user_id AND role='staff';
  IF v_staff.assigned_state IS NULL OR v_staff.assigned_lga IS NULL THEN
    metric:='unassigned'; value:=1; RETURN NEXT; RETURN;
  END IF;
  SELECT permission INTO v_permission FROM public.staff_permissions WHERE staff_id=p_staff_user_id AND is_active=true LIMIT 1;
  IF v_permission='field_officer' THEN
    metric:='inspections';
    SELECT COUNT(*)::INTEGER INTO value FROM public.user_inspection_requests uir JOIN public.listings l ON l.id=uir.listing_id WHERE l.state=v_staff.assigned_state AND COALESCE(l.city,l.local_government)=v_staff.assigned_lga AND uir.field_officer_id=p_staff_user_id AND uir.status IN ('scheduled','in_progress');
    RETURN NEXT;
  END IF;
  IF v_permission='support' THEN
    metric:='open_conversations';
    SELECT COUNT(*)::INTEGER INTO value
    FROM public.partner_support_conversations c
    JOIN public.profiles p ON p.user_id=c.partner_id
    WHERE c.status NOT IN ('resolved','closed')
      AND p.state=v_staff.assigned_state
      AND COALESCE(NULLIF(p.local_government,''),p.city)=v_staff.assigned_lga;
    RETURN NEXT;
  END IF;
  IF v_permission='operations' THEN
    metric:='pending_listings';
    SELECT COUNT(*)::INTEGER INTO value FROM public.listings WHERE status='pending_approval' AND state=v_staff.assigned_state AND COALESCE(city,local_government)=v_staff.assigned_lga;
    RETURN NEXT;
  END IF;
  IF v_permission='verification' THEN
    metric:='pending_workers';
    SELECT COUNT(*)::INTEGER INTO value FROM public.profiles WHERE role='worker' AND worker_status='pending' AND state=v_staff.assigned_state AND COALESCE(local_government,city)=v_staff.assigned_lga;
    RETURN NEXT;
  END IF;
  IF v_permission='finance' THEN
    metric:='pending_withdrawals';
    SELECT COUNT(*)::INTEGER INTO value FROM public.withdrawals w JOIN public.wallets wl ON wl.id=w.wallet_id JOIN public.profiles p ON p.user_id=wl.owner_id WHERE w.status='pending' AND p.state=v_staff.assigned_state AND COALESCE(p.local_government,p.city)=v_staff.assigned_lga;
    RETURN NEXT;
  END IF;
END;
$$;


--
-- Name: staff_complete_customer_inspection(uuid, text, text, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_complete_customer_inspection(p_inspection_id uuid, p_report text, p_condition text, p_photo_urls text[] DEFAULT ARRAY[]::text[]) RETURNS public.user_inspection_requests
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE v_actor public.profiles; v_req public.user_inspection_requests;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role IN ('staff','admin','creator')
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Field operations access required'; END IF;
  IF NULLIF(BTRIM(COALESCE(p_report,'')),'') IS NULL OR NULLIF(BTRIM(COALESCE(p_condition,'')),'') IS NULL THEN RAISE EXCEPTION 'Inspection report and condition are required'; END IF;
  SELECT * INTO v_req FROM public.user_inspection_requests WHERE id=p_inspection_id AND status='in_progress' FOR UPDATE;
  IF v_req IS NULL THEN RAISE EXCEPTION 'Active inspection not found'; END IF;
  IF v_actor.role='staff' THEN
    IF v_req.field_officer_id<>v_actor.user_id OR NOT public.current_staff_has_permission('field_officer') THEN RAISE EXCEPTION 'Inspection is not assigned to this Field Officer'; END IF;
  ELSIF v_actor.role='admin' AND NOT public.current_actor_can_access_listing_ref(v_req.listing_id) THEN RAISE EXCEPTION 'Inspection is outside your assigned branch'; END IF;
  UPDATE public.user_inspection_requests SET status='completed',report=BTRIM(p_report),condition=BTRIM(p_condition),photo_urls=COALESCE(p_photo_urls,ARRAY[]::text[]),updated_at=now()
  WHERE id=p_inspection_id RETURNING * INTO v_req;
  UPDATE public.reservations SET inspection_completed=true,inspection_completed_at=now(),updated_at=now() WHERE id=v_req.reservation_id;
  RETURN v_req;
END;
$$;


--
-- Name: staff_start_customer_inspection(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_start_customer_inspection(p_inspection_id uuid) RETURNS public.user_inspection_requests
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE v_actor public.profiles; v_req public.user_inspection_requests;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role IN ('staff','admin','creator')
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Field operations access required'; END IF;
  SELECT * INTO v_req FROM public.user_inspection_requests WHERE id=p_inspection_id AND status='scheduled' FOR UPDATE;
  IF v_req IS NULL THEN RAISE EXCEPTION 'Scheduled inspection not found'; END IF;
  IF v_actor.role='staff' THEN
    IF v_req.field_officer_id<>v_actor.user_id OR NOT public.current_staff_has_permission('field_officer') THEN RAISE EXCEPTION 'Inspection is not assigned to this Field Officer'; END IF;
  ELSIF v_actor.role='admin' AND NOT public.current_actor_can_access_listing_ref(v_req.listing_id) THEN RAISE EXCEPTION 'Inspection is outside your assigned branch'; END IF;
  UPDATE public.user_inspection_requests SET status='in_progress',updated_at=now() WHERE id=p_inspection_id RETURNING * INTO v_req;
  RETURN v_req;
END;
$$;


--
-- Name: start_my_roommate_search(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.start_my_roommate_search() RETURNS public.roommate_preferences
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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
  IF COALESCE(v_row.school_match,false) AND NULLIF(BTRIM(COALESCE(v_row.school_name,v_actor.school,'')),'') IS NULL THEN RAISE EXCEPTION 'Enter your school before using same-school matching'; END IF;
  UPDATE public.roommate_preferences SET active=true,search_status='active',search_started_at=COALESCE(search_started_at,now()),search_expires_at=NULL,updated_at=now() WHERE user_id=v_actor.user_id RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;


--
-- Name: start_my_worker_test(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.start_my_worker_test() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_profile public.profiles; v_paid boolean; v_attempt public.worker_test_attempts; v_ids uuid[]; v_questions jsonb; v_recent_failed integer;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE auth_id=auth.uid()::text AND role='worker' AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Active Worker account required'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.booking_payments WHERE user_id=v_profile.user_id AND purpose='worker_verification' AND status IN ('paid','completed')) INTO v_paid;
  IF NOT v_paid THEN RAISE EXCEPTION 'Verified Paystack payment is required before the Worker test'; END IF;
  IF public.worker_test_passed(v_profile.user_id) THEN
    SELECT * INTO v_attempt FROM public.worker_test_attempts WHERE worker_id=v_profile.user_id AND passed=true ORDER BY submitted_at DESC LIMIT 1;
    RETURN jsonb_build_object('already_passed',true,'passed',true,'score',v_attempt.score,'total',v_attempt.total_questions,'percent',v_attempt.percent,'pass_percent',80);
  END IF;
  UPDATE public.worker_test_attempts SET submitted_at=now(),score=0,percent=0,passed=false,answers='{}'::jsonb WHERE worker_id=v_profile.user_id AND submitted_at IS NULL AND started_at < now()-interval '45 minutes';
  SELECT count(*) INTO v_recent_failed FROM public.worker_test_attempts WHERE worker_id=v_profile.user_id AND submitted_at IS NOT NULL AND submitted_at >= now()-interval '24 hours' AND passed=false;
  IF v_recent_failed>=5 THEN RAISE EXCEPTION 'Daily Worker test attempt limit reached. Try again after 24 hours'; END IF;
  SELECT * INTO v_attempt FROM public.worker_test_attempts WHERE worker_id=v_profile.user_id AND submitted_at IS NULL ORDER BY started_at DESC LIMIT 1;
  IF v_attempt IS NULL THEN
    SELECT array_agg(id) INTO v_ids FROM (SELECT id FROM public.worker_test_questions WHERE is_active=true AND (category IS NULL OR lower(category)=lower(COALESCE(v_profile.worker_occupation,''))) ORDER BY CASE WHEN category IS NULL THEN 1 ELSE 0 END, random() LIMIT 8) q;
    IF COALESCE(array_length(v_ids,1),0)<5 THEN RAISE EXCEPTION 'Worker test question bank is not configured'; END IF;
    INSERT INTO public.worker_test_attempts(worker_id,question_ids,total_questions) VALUES(v_profile.user_id,v_ids,array_length(v_ids,1)) RETURNING * INTO v_attempt;
  ELSE v_ids:=v_attempt.question_ids; END IF;
  SELECT jsonb_agg(jsonb_build_object('id',q.id,'question',q.question,'options',q.options) ORDER BY u.ord) INTO v_questions FROM unnest(v_ids) WITH ORDINALITY AS u(id,ord) JOIN public.worker_test_questions q ON q.id=u.id;
  RETURN jsonb_build_object('already_passed',false,'attempt_id',v_attempt.id,'questions',COALESCE(v_questions,'[]'::jsonb),'pass_percent',80,'expires_at',v_attempt.started_at+interval '45 minutes');
END; $$;


--
-- Name: start_private_call(text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.start_private_call(p_context_type text, p_context_id uuid, p_call_type text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_me text:=public.current_profile_user_id(); v_cap jsonb; v_peer text; v_call public.private_calls;
begin
 if v_me is null then raise exception 'Authenticated profile required'; end if;
 if p_call_type not in ('audio','video') then raise exception 'Invalid call type'; end if;
 v_cap:=public.get_private_call_capabilities(p_context_type,p_context_id); v_peer:=v_cap->>'peer_id';
 if p_call_type='audio' and coalesce((v_cap->>'allow_audio_calls')::boolean,false)=false then raise exception 'This person is not accepting audio calls'; end if;
 if p_call_type='video' and coalesce((v_cap->>'allow_video_calls')::boolean,false)=false then raise exception 'This person is not accepting video calls'; end if;
 if exists(select 1 from public.private_calls c where c.status in ('ringing','accepted') and (v_me in (c.caller_id,c.callee_id) or v_peer in (c.caller_id,c.callee_id))) then raise exception 'One of you is already in a call'; end if;
 insert into public.private_calls(context_type,context_id,caller_id,callee_id,call_type,status) values(p_context_type,p_context_id,v_me,v_peer,p_call_type,'ringing') returning * into v_call;
 return to_jsonb(v_call)||jsonb_build_object('peer_name',v_cap->>'peer_name','peer_avatar',v_cap->>'peer_avatar');
end; $$;


--
-- Name: stop_my_roommate_search(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.stop_my_roommate_search() RETURNS public.roommate_preferences
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_id text; v_row public.roommate_preferences;
BEGIN
  SELECT user_id INTO v_id FROM public.profiles WHERE auth_id=auth.uid()::text AND role='user' AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_id IS NULL THEN RAISE EXCEPTION 'Regular user account required'; END IF;
  UPDATE public.roommate_preferences SET active=false,search_status='stopped',search_expires_at=NULL,updated_at=now() WHERE user_id=v_id RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;


--
-- Name: submit_my_worker_test(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.submit_my_worker_test(p_attempt_id uuid, p_answers jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE v_profile public.profiles; v_attempt public.worker_test_attempts; v_total integer; v_answered integer; v_score integer; v_percent integer; v_passed boolean;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE auth_id=auth.uid()::text AND role='worker' AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Active Worker account required'; END IF;
  IF jsonb_typeof(COALESCE(p_answers,'{}'::jsonb))<>'object' THEN RAISE EXCEPTION 'Invalid answers'; END IF;
  SELECT * INTO v_attempt FROM public.worker_test_attempts WHERE id=p_attempt_id AND worker_id=v_profile.user_id FOR UPDATE;
  IF v_attempt IS NULL THEN RAISE EXCEPTION 'Worker test attempt not found'; END IF;
  IF v_attempt.submitted_at IS NOT NULL THEN RETURN jsonb_build_object('score',v_attempt.score,'total',v_attempt.total_questions,'percent',v_attempt.percent,'passed',v_attempt.passed,'already_submitted',true); END IF;
  IF v_attempt.started_at < now()-interval '45 minutes' THEN RAISE EXCEPTION 'Worker test attempt expired'; END IF;
  SELECT count(*),count(*) FILTER (WHERE p_answers ? q.id::text),count(*) FILTER (WHERE p_answers ? q.id::text AND (p_answers->>q.id::text) ~ '^[0-9]+$' AND (p_answers->>q.id::text)::integer=q.correct_index)
  INTO v_total,v_answered,v_score FROM unnest(v_attempt.question_ids) AS ids(id) JOIN public.worker_test_questions q ON q.id=ids.id;
  IF v_answered<>v_total THEN RAISE EXCEPTION 'Answer every Worker test question before submitting'; END IF;
  v_percent:=CASE WHEN v_total>0 THEN floor((v_score::numeric*100)/v_total)::integer ELSE 0 END; v_passed:=v_percent>=80;
  UPDATE public.worker_test_attempts SET answers=p_answers,score=v_score,total_questions=v_total,percent=v_percent,passed=v_passed,submitted_at=now() WHERE id=v_attempt.id;
  RETURN jsonb_build_object('score',v_score,'total',v_total,'percent',v_percent,'passed',v_passed,'pass_percent',80,'already_submitted',false);
END; $_$;


--
-- Name: submit_my_worker_verification(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.submit_my_worker_verification() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_profile public.profiles; v_ver public.worker_verifications; v_identity public.worker_identity_checks; v_paid boolean:=false;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE auth_id=auth.uid()::text AND role='worker' AND NOT COALESCE(deleted,false) AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false) LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Active Worker account required'; END IF;
  IF NOT public.worker_professional_profile_ready(v_profile.user_id) THEN RAISE EXCEPTION 'Complete your professional profile and service coverage first'; END IF;
  SELECT * INTO v_identity FROM public.worker_identity_checks WHERE worker_id=v_profile.user_id;
  IF v_identity IS NULL OR v_identity.status<>'passed' THEN RAISE EXCEPTION 'Pass the automatic private WeHouse face check before submission'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.booking_payments WHERE user_id=v_profile.user_id AND purpose='worker_verification' AND status IN('paid','completed')) INTO v_paid;
  IF NOT v_paid THEN RAISE EXCEPTION 'Confirmed Paystack payment is required before submission'; END IF;
  IF NOT public.worker_test_passed(v_profile.user_id) THEN RAISE EXCEPTION 'Pass the Worker readiness check before submission'; END IF;
  SELECT * INTO v_ver FROM public.worker_verifications WHERE worker_id=v_profile.user_id LIMIT 1;
  IF v_ver IS NULL OR NULLIF(BTRIM(COALESCE(v_ver.verification_video_url,'')),'') IS NULL THEN RAISE EXCEPTION 'A work demonstration video is required before review'; END IF;
  UPDATE public.worker_verifications SET status='profile_under_review',submitted_at=now(),updated_at=now() WHERE id=v_ver.id;
  UPDATE public.profiles SET worker_status='profile_under_review',worker_verified=false,available=false,updated_at=now() WHERE user_id=v_profile.user_id;
END; $$;


--
-- Name: support_inbox(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.support_inbox() RETURNS TABLE(conversation_id uuid, requester_id text, requester_role text, requester_name text, requester_email text, requester_state text, requester_lga text, subject text, status text, category text, context_type text, context_id text, context_snapshot jsonb, priority text, assigned_staff_id text, assigned_staff_name text, last_message text, last_message_time timestamp with time zone, unread_count bigint, created_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles; v_staff_ok boolean:=false;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor.user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  IF v_actor.role='staff' THEN
    SELECT EXISTS(
      SELECT 1 FROM public.staff_permissions sp
      WHERE sp.staff_id=v_actor.user_id
        AND sp.permission='support'
        AND COALESCE(sp.is_active,true)=true
        AND sp.revoked_at IS NULL
    ) INTO v_staff_ok;
  END IF;

  IF v_actor.role NOT IN ('admin','creator') AND NOT v_staff_ok THEN
    RAISE EXCEPTION 'Support team access required';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.partner_id,
    COALESCE(c.requester_role,p.role),
    COALESCE(p.full_name,p.username,p.email),
    p.email,
    p.state,
    COALESCE(NULLIF(p.local_government,''),p.city),
    'WeHouse Support'::text,
    c.status,
    c.category,
    c.context_type,
    c.context_id,
    c.context_snapshot,
    c.priority,
    c.assigned_staff_id,
    COALESCE(s.full_name,s.username),
    (
      SELECT CASE
        WHEN NULLIF(BTRIM(m.content),'') IS NOT NULL THEN m.content
        WHEN COALESCE(cardinality(m.attachments),0)>0 THEN 'Attachment'
        ELSE '' END
      FROM public.partner_support_messages m
      WHERE m.conversation_id=c.id
      ORDER BY m.created_at DESC LIMIT 1
    ),
    (
      SELECT m.created_at FROM public.partner_support_messages m
      WHERE m.conversation_id=c.id
      ORDER BY m.created_at DESC LIMIT 1
    ),
    (
      SELECT COUNT(*) FROM public.partner_support_messages m
      WHERE m.conversation_id=c.id
        AND COALESCE(m.is_read,false)=false
        AND m.sender_id<>v_actor.user_id
    ),
    c.created_at
  FROM public.partner_support_conversations c
  JOIN public.profiles p ON p.user_id=c.partner_id
  LEFT JOIN public.profiles s ON s.user_id=c.assigned_staff_id
  WHERE EXISTS (
      SELECT 1 FROM public.partner_support_messages first_message
      WHERE first_message.conversation_id=c.id
    )
    AND (v_actor.role='creator' OR (p.state=v_actor.assigned_state AND COALESCE(NULLIF(p.local_government,''),p.city)=v_actor.assigned_lga))
    AND (v_actor.role<>'staff' OR c.assigned_staff_id IS NULL OR c.assigned_staff_id=v_actor.user_id)
  ORDER BY
    CASE WHEN c.assigned_staff_id=v_actor.user_id THEN 0 WHEN c.assigned_staff_id IS NULL THEN 1 ELSE 2 END,
    (SELECT MAX(m.created_at) FROM public.partner_support_messages m WHERE m.conversation_id=c.id) DESC NULLS LAST,
    c.updated_at DESC;
END
$$;


--
-- Name: sync_listing_lifecycle(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_listing_lifecycle() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status := COALESCE(NEW.status, NEW.availability_status, 'pending_approval');
    NEW.availability_status := NEW.status;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.availability_status := NEW.status;
  ELSIF NEW.availability_status IS DISTINCT FROM OLD.availability_status THEN
    NEW.status := NEW.availability_status;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;


--
-- Name: sync_staff_trust_on_role_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_staff_trust_on_role_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE v_actor text; v_needs_review boolean:=false;
BEGIN
  IF TG_OP='INSERT' THEN
    v_actor:=NEW.updated_by;
    v_needs_review:=(NEW.role='staff');
  ELSE
    v_actor:=COALESCE(NEW.updated_by,OLD.updated_by);
    v_needs_review:=(NEW.role='staff' AND (OLD.role IS DISTINCT FROM 'staff' OR OLD.assigned_state IS DISTINCT FROM NEW.assigned_state OR OLD.assigned_lga IS DISTINCT FROM NEW.assigned_lga));
  END IF;
  IF v_needs_review THEN
    INSERT INTO public.staff_trust_profiles(
      staff_id,status,appointed_by,appointed_at,trusted_by,trusted_at,
      supervisor_confirmed,orientation_completed,role_training_completed,code_of_conduct_confirmed,probation_observation_completed,
      notes,updated_at
    ) VALUES(NEW.user_id,'probation',v_actor,now(),NULL,NULL,false,false,false,false,false,'Staff role or branch assignment changed; WeHouse trust review required',now())
    ON CONFLICT(staff_id) DO UPDATE SET
      status='probation',appointed_by=COALESCE(v_actor,staff_trust_profiles.appointed_by),appointed_at=now(),trusted_by=NULL,trusted_at=NULL,
      supervisor_confirmed=false,orientation_completed=false,role_training_completed=false,code_of_conduct_confirmed=false,probation_observation_completed=false,
      notes='Staff role or branch assignment changed; WeHouse trust review required',updated_at=now();
  ELSIF TG_OP='UPDATE' AND OLD.role='staff' AND NEW.role<>'staff' THEN
    UPDATE public.staff_trust_profiles SET status='revoked',notes='Staff role removed',updated_at=now() WHERE staff_id=NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: touch_my_presence(boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_my_presence(p_online boolean DEFAULT true) RETURNS timestamp with time zone
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor public.profiles;
  v_now timestamptz:=now();
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;

  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  UPDATE public.profiles
  SET is_online=COALESCE(p_online,true),last_seen=v_now,updated_at=now()
  WHERE user_id=v_actor.user_id;

  RETURN v_now;
END;
$$;


--
-- Name: transition_inspection_status(uuid, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.transition_inspection_status(p_inspection_id uuid, p_new_status text, p_changed_by text, p_changed_by_role text, p_notes text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_current_status TEXT; v_valid BOOLEAN := FALSE;
BEGIN
  SELECT status INTO v_current_status FROM inspection_requests WHERE id = p_inspection_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  v_valid := CASE
    WHEN v_current_status = 'inspection_requested' AND p_new_status = 'inspection_assigned' THEN TRUE
    WHEN v_current_status = 'inspection_assigned' AND p_new_status = 'inspection_in_progress' THEN TRUE
    WHEN v_current_status = 'inspection_in_progress' AND p_new_status = 'inspection_completed' THEN TRUE
    WHEN v_current_status = 'inspection_completed' AND p_new_status = 'draft' THEN TRUE
    WHEN v_current_status = 'draft' AND p_new_status = 'pending_approval' THEN TRUE
    WHEN v_current_status = 'pending_approval' AND p_new_status = 'approved' THEN TRUE
    WHEN v_current_status = 'approved' AND p_new_status = 'published' THEN TRUE
    WHEN v_current_status IN ('inspection_requested','inspection_assigned','inspection_in_progress','inspection_completed','draft','pending_approval') AND p_new_status = 'rejected' THEN TRUE
    WHEN p_new_status IN ('suspended','archived') THEN TRUE
    ELSE FALSE
  END;
  IF NOT v_valid THEN RETURN FALSE; END IF;
  INSERT INTO inspection_status_history (inspection_request_id, old_status, new_status, changed_by, changed_by_role, notes)
  VALUES (p_inspection_id, v_current_status, p_new_status, p_changed_by, p_changed_by_role, p_notes);
  UPDATE inspection_requests SET status = p_new_status, updated_at = NOW()
  WHERE id = p_inspection_id;
  RETURN TRUE;
END;
$$;


--
-- Name: unfreeze_wallet(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.unfreeze_wallet(p_wallet_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_wallet RECORD;
  v_caller TEXT;
  v_caller_role TEXT;
BEGIN
  -- ── AUTH: Identify caller ──
  SELECT user_id, role INTO v_caller, v_caller_role
  FROM profiles WHERE auth_id = auth.uid()::text;

  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  -- ── AUTHORIZATION: staff/admin/creator only ──
  IF v_caller_role NOT IN ('staff','admin','creator') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  UPDATE wallets SET
    is_frozen = FALSE,
    frozen_reason = NULL,
    frozen_by = NULL,
    frozen_at = NULL,
    updated_at = NOW()
  WHERE id = p_wallet_id;

  RETURN jsonb_build_object('success', true);
END;
$$;


--
-- Name: update_inspection_status(uuid, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_inspection_status(p_inspection_id uuid, p_new_status text, p_source text DEFAULT 'user'::text, p_report text DEFAULT NULL::text, p_condition text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor record;
  v_updated boolean := false;
BEGIN
  SELECT user_id, role, deleted, suspended, banned
  INTO v_actor
  FROM public.profiles
  WHERE auth_id = auth.uid()::text
  LIMIT 1;

  IF v_actor IS NULL
     OR COALESCE(v_actor.deleted,false)
     OR COALESCE(v_actor.suspended,false)
     OR COALESCE(v_actor.banned,false) THEN
    RAISE EXCEPTION 'Active WeHouse account required';
  END IF;

  IF v_actor.role = 'staff' AND NOT public.current_staff_has_permission('field_officer') THEN
    RAISE EXCEPTION 'Field Officer permission required';
  END IF;

  IF v_actor.role NOT IN ('staff','admin','creator') THEN
    RAISE EXCEPTION 'Field Officer access required';
  END IF;

  IF p_source NOT IN ('user','partner') THEN
    RAISE EXCEPTION 'Invalid inspection source';
  END IF;

  IF p_new_status NOT IN ('in_progress','completed') THEN
    RAISE EXCEPTION 'Field Officer can only start or complete an inspection';
  END IF;

  IF p_new_status = 'completed' AND NULLIF(BTRIM(COALESCE(p_report,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Inspection report is required before completion';
  END IF;

  IF p_source = 'partner' THEN
    UPDATE public.inspection_requests
    SET status = p_new_status,
        completed_at = CASE WHEN p_new_status='completed' THEN now() ELSE completed_at END,
        notes = CASE WHEN p_new_status='completed' THEN BTRIM(p_report) ELSE notes END,
        updated_at = now()
    WHERE id = p_inspection_id
      AND (
        v_actor.role IN ('admin','creator')
        OR assigned_to = v_actor.user_id
      );
    v_updated := FOUND;
  ELSE
    UPDATE public.user_inspection_requests
    SET status = p_new_status,
        completed_at = CASE WHEN p_new_status='completed' THEN now() ELSE completed_at END,
        report = CASE WHEN p_new_status='completed' THEN BTRIM(p_report) ELSE report END,
        condition = CASE WHEN p_new_status='completed' THEN NULLIF(BTRIM(COALESCE(p_condition,'')),'') ELSE condition END,
        updated_at = now()
    WHERE id = p_inspection_id
      AND (
        v_actor.role IN ('admin','creator')
        OR field_officer_id = v_actor.user_id
      );
    v_updated := FOUND;
  END IF;

  IF NOT v_updated THEN
    RAISE EXCEPTION 'Inspection not found or not assigned to this account';
  END IF;

  RETURN true;
END;
$$;


--
-- Name: update_my_field_location(numeric, numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_my_field_location(p_latitude numeric, p_longitude numeric, p_accuracy_m numeric DEFAULT NULL::numeric) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor IS NULL OR v_actor.role<>'staff' OR NOT public.current_staff_has_permission('field_officer') THEN RAISE EXCEPTION 'Field Officer permission required'; END IF;
  IF p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180 THEN RAISE EXCEPTION 'Invalid coordinates'; END IF;
  INSERT INTO public.staff_location_presence(staff_id,latitude,longitude,accuracy_m,captured_at)
  VALUES(v_actor.user_id,p_latitude,p_longitude,p_accuracy_m,NOW())
  ON CONFLICT(staff_id) DO UPDATE SET latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,accuracy_m=EXCLUDED.accuracy_m,captured_at=NOW();
END $$;


--
-- Name: update_my_field_officer_location(numeric, numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_my_field_officer_location(p_latitude numeric, p_longitude numeric, p_accuracy_m numeric DEFAULT NULL::numeric) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_actor record;
begin
 select user_id,role,deleted,suspended,banned into v_actor from public.profiles where auth_id=auth.uid()::text limit 1;
 if v_actor is null or v_actor.role<>'staff' or coalesce(v_actor.deleted,false) or coalesce(v_actor.suspended,false) or coalesce(v_actor.banned,false) then raise exception 'Active Staff account required'; end if;
 if not exists(select 1 from public.staff_permissions where staff_id=v_actor.user_id and permission='field_officer' and is_active=true) then raise exception 'Field Officer permission required'; end if;
 if p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then raise exception 'Invalid coordinates'; end if;
 update public.profiles set operational_latitude=p_latitude,operational_longitude=p_longitude,operational_location_accuracy_m=case when p_accuracy_m is null or p_accuracy_m<0 then null else p_accuracy_m end,operational_location_updated_at=now(),updated_at=now() where user_id=v_actor.user_id;
 return true;
end $$;


--
-- Name: update_my_privacy(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_my_privacy(p_updates jsonb) RETURNS public.profiles
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ DECLARE v_profile public.profiles; v_unknown text[]; BEGIN SELECT array_agg(k) INTO v_unknown FROM jsonb_object_keys(p_updates) AS k WHERE k NOT IN ('privacy_profile_visible','privacy_search_visible','privacy_activity_visible','privacy_email_visible','privacy_phone_visible'); IF v_unknown IS NOT NULL THEN RAISE EXCEPTION 'Unsupported privacy fields'; END IF; UPDATE public.profiles SET privacy_profile_visible=CASE WHEN p_updates?'privacy_profile_visible' THEN (p_updates->>'privacy_profile_visible')::boolean ELSE privacy_profile_visible END,privacy_search_visible=CASE WHEN p_updates?'privacy_search_visible' THEN (p_updates->>'privacy_search_visible')::boolean ELSE privacy_search_visible END,privacy_activity_visible=CASE WHEN p_updates?'privacy_activity_visible' THEN (p_updates->>'privacy_activity_visible')::boolean ELSE privacy_activity_visible END,privacy_email_visible=CASE WHEN p_updates?'privacy_email_visible' THEN (p_updates->>'privacy_email_visible')::boolean ELSE privacy_email_visible END,privacy_phone_visible=CASE WHEN p_updates?'privacy_phone_visible' THEN (p_updates->>'privacy_phone_visible')::boolean ELSE privacy_phone_visible END,updated_at=now() WHERE auth_id=auth.uid()::text AND deleted=false AND suspended=false AND banned=false RETURNING * INTO v_profile; IF v_profile IS NULL THEN RAISE EXCEPTION 'Active profile not found'; END IF; RETURN v_profile; END; $$;


--
-- Name: update_my_profile(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_my_profile(p_updates jsonb) RETURNS public.profiles
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $_$
DECLARE v_profile public.profiles; v_username text; v_state text; v_lga text; v_country text; v_unknown text[]; v_complete boolean; v_area text;
BEGIN
  IF p_updates IS NULL OR jsonb_typeof(p_updates)<>'object' THEN RAISE EXCEPTION 'Profile updates must be an object'; END IF;
  SELECT array_agg(k) INTO v_unknown FROM jsonb_object_keys(p_updates) AS k WHERE k NOT IN ('username','full_name','avatar_url','bio','phone','occupation','gender','is_student','school','country','state','local_government','city','area','profile_complete','worker_occupation','worker_skills','worker_price','worker_bio','worker_experience');
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
  UPDATE public.profiles SET username=v_username,full_name=CASE WHEN p_updates ? 'full_name' THEN nullif(trim(p_updates->>'full_name'),'') ELSE full_name END,avatar_url=CASE WHEN p_updates ? 'avatar_url' THEN nullif(trim(p_updates->>'avatar_url'),'') ELSE avatar_url END,bio=CASE WHEN p_updates ? 'bio' THEN nullif(trim(p_updates->>'bio'),'') ELSE bio END,phone=CASE WHEN p_updates ? 'phone' THEN nullif(trim(p_updates->>'phone'),'') ELSE phone END,occupation=CASE WHEN p_updates ? 'worker_occupation' THEN nullif(trim(p_updates->>'worker_occupation'),'') WHEN p_updates ? 'occupation' THEN nullif(trim(p_updates->>'occupation'),'') ELSE occupation END,gender=CASE WHEN p_updates ? 'gender' THEN nullif(trim(p_updates->>'gender'),'') ELSE gender END,is_student=CASE WHEN p_updates ? 'is_student' THEN (p_updates->>'is_student')::boolean ELSE is_student END,school=CASE WHEN p_updates ? 'school' THEN nullif(trim(p_updates->>'school'),'') ELSE school END,country=v_country,state=v_state,local_government=v_lga,city=v_lga,area=v_area,worker_occupation=CASE WHEN p_updates ? 'worker_occupation' THEN nullif(trim(p_updates->>'worker_occupation'),'') ELSE worker_occupation END,worker_skills=CASE WHEN p_updates ? 'worker_skills' THEN p_updates->'worker_skills' ELSE worker_skills END,worker_price=CASE WHEN p_updates ? 'worker_price' THEN NULLIF(p_updates->>'worker_price','')::integer ELSE worker_price END,worker_bio=CASE WHEN p_updates ? 'worker_bio' THEN nullif(trim(p_updates->>'worker_bio'),'') ELSE worker_bio END,worker_experience=CASE WHEN p_updates ? 'worker_experience' THEN nullif(trim(p_updates->>'worker_experience'),'') ELSE worker_experience END,profile_complete=v_complete,updated_at=now() WHERE user_id=v_profile.user_id RETURNING * INTO v_profile;
  IF v_profile.role='worker' AND v_complete THEN
    IF NULLIF(BTRIM(COALESCE(v_profile.worker_occupation,'')),'') IS NULL THEN RAISE EXCEPTION 'Worker service category is required'; END IF;
    IF jsonb_typeof(COALESCE(v_profile.worker_skills,'[]'::jsonb))<>'array' OR jsonb_array_length(COALESCE(v_profile.worker_skills,'[]'::jsonb))=0 THEN RAISE EXCEPTION 'At least one Worker specialty is required'; END IF;
    INSERT INTO public.worker_service_coverage(worker_id,state,lga,areas,updated_at) VALUES(v_profile.user_id,v_state,v_lga,CASE WHEN v_area IS NULL THEN '{}'::text[] ELSE ARRAY[v_area] END,now()) ON CONFLICT(worker_id) DO UPDATE SET state=EXCLUDED.state,lga=EXCLUDED.lga,areas=EXCLUDED.areas,updated_at=now();
  END IF;
  RETURN v_profile;
END;
$_$;


--
-- Name: update_my_reservation_plan(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_my_reservation_plan(p_reservation_id text, p_plan_years integer) RETURNS public.reservations
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_user_id text;
  v_res public.reservations;
  v_listing public.listings;
  v_annual numeric;
  v_total numeric;
  v_upfront numeric;
  v_balance numeric;
  v_count integer;
BEGIN
  SELECT user_id INTO v_user_id
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_plan_years < 1 OR p_plan_years > 5 THEN RAISE EXCEPTION 'Choose a supported 1 to 5 year tenure'; END IF;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE id=p_reservation_id
    AND user_id=v_user_id
    AND status = ANY (ARRAY['payment_pending','reserved','inspection_pending','ready_for_move_in']::text[])
  FOR UPDATE;
  IF v_res IS NULL THEN RAISE EXCEPTION 'Active reservation not found'; END IF;
  IF v_res.rent_payment_status NOT IN ('not_started','payment_pending') THEN
    RAISE EXCEPTION 'Tenure cannot change after Year 1 rent has been paid';
  END IF;
  IF v_res.rent_payment_status='payment_pending' AND EXISTS (
    SELECT 1 FROM public.booking_payments bp
    WHERE bp.paystack_reference=v_res.rent_payment_reference AND bp.status='pending'
  ) THEN
    RAISE EXCEPTION 'Complete the current rent checkout before changing tenure';
  END IF;

  SELECT * INTO v_listing
  FROM public.listings
  WHERE id::text=v_res.listing_id
  FOR SHARE;
  IF v_listing IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF;
  IF COALESCE(v_listing.sub_type,'long_stay')<>'long_stay' THEN
    RAISE EXCEPTION 'Yearly tenure plans apply to Long Stay apartments only';
  END IF;
  IF COALESCE(v_listing.price,0)<=0 THEN RAISE EXCEPTION 'Listing rent is invalid'; END IF;

  v_annual:=round(v_listing.price,2);
  v_total:=round(v_annual*p_plan_years,2);
  v_upfront:=v_annual;
  v_balance:=round(v_annual*GREATEST(p_plan_years-1,0),2);
  v_count:=8*GREATEST(p_plan_years-1,0);

  UPDATE public.reservations
  SET rental_plan_years=p_plan_years,
      rental_plan_selected_at=now(),
      annual_rent_snapshot=v_annual,
      contract_rent_total=v_total,
      upfront_rent_required=v_upfront,
      installment_balance=v_balance,
      installment_count=v_count,
      rent_payment_status='not_started',
      rent_payment_reference=NULL,
      updated_at=now()
  WHERE id=v_res.id
  RETURNING * INTO v_res;
  RETURN v_res;
END;
$$;


--
-- Name: update_my_roommate_match_status(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_my_roommate_match_status(p_match_id uuid, p_status text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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
    SELECT * INTO v_reverse FROM public.roommate_search_results WHERE searcher_id=v_match.matched_user_id AND matched_user_id=v_actor.user_id AND status='accepted' LIMIT 1;
    IF v_reverse IS NOT NULL THEN
      SELECT c.id INTO v_conv FROM public.conversations c WHERE c.conversation_type='roommate' AND ((c.participant_a=v_actor.user_id AND c.participant_b=v_match.matched_user_id) OR (c.participant_b=v_actor.user_id AND c.participant_a=v_match.matched_user_id)) LIMIT 1;
      IF v_conv IS NULL THEN INSERT INTO public.conversations(participant_a,participant_b,status,conversation_type,subject,created_at,last_message_at,unread_a,unread_b) VALUES(v_actor.user_id,v_match.matched_user_id,'active','roommate','Roommate Match',now(),now(),0,0) RETURNING id INTO v_conv; END IF;
    END IF;
  END IF;
  RETURN v_conv;
END;
$$;


--
-- Name: update_platform_setting(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_platform_setting(p_key text, p_value text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
declare v_actor public.profiles;
begin
 select * into v_actor from public.profiles where auth_id=auth.uid()::text and deleted_at is null limit 1;
 if v_actor is null or v_actor.role<>'creator' then raise exception 'Only Creator can update global platform settings'; end if;
 update public.platform_settings set value=p_value,updated_at=now() where key=p_key and editable=true;
 if found then insert into public.audit_logs(action,target_type,target_id,details,admin_id,admin_email) values('PLATFORM_SETTING_UPDATED','platform_settings',p_key,jsonb_build_object('key',p_key)::text,v_actor.user_id,v_actor.email); end if;
 return found;
end;
$$;


--
-- Name: update_staff_trust_checklist(text, boolean, boolean, boolean, boolean, boolean, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_staff_trust_checklist(p_staff_id text, p_supervisor_confirmed boolean, p_orientation_completed boolean, p_role_training_completed boolean, p_code_of_conduct_confirmed boolean, p_probation_observation_completed boolean, p_notes text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles; v_target public.profiles;
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role IN('admin','creator')
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Admin or Creator access required'; END IF;
  SELECT * INTO v_target FROM public.profiles WHERE user_id=p_staff_id AND role='staff' AND COALESCE(deleted,false)=false LIMIT 1;
  IF v_target IS NULL THEN RAISE EXCEPTION 'Staff profile not found'; END IF;
  IF v_actor.role='admin' AND (v_actor.assigned_state IS DISTINCT FROM v_target.assigned_state OR v_actor.assigned_lga IS DISTINCT FROM v_target.assigned_lga) THEN
    RAISE EXCEPTION 'Admin can review only Staff in the same assigned branch';
  END IF;
  INSERT INTO public.staff_trust_profiles(
    staff_id,status,appointed_by,appointed_at,supervisor_confirmed,orientation_completed,role_training_completed,code_of_conduct_confirmed,probation_observation_completed,notes,updated_at
  ) VALUES(
    p_staff_id,'probation',v_actor.user_id,now(),p_supervisor_confirmed,p_orientation_completed,p_role_training_completed,p_code_of_conduct_confirmed,p_probation_observation_completed,NULLIF(BTRIM(COALESCE(p_notes,'')),''),now()
  ) ON CONFLICT(staff_id) DO UPDATE SET
    supervisor_confirmed=EXCLUDED.supervisor_confirmed,orientation_completed=EXCLUDED.orientation_completed,role_training_completed=EXCLUDED.role_training_completed,
    code_of_conduct_confirmed=EXCLUDED.code_of_conduct_confirmed,probation_observation_completed=EXCLUDED.probation_observation_completed,notes=EXCLUDED.notes,updated_at=now();
  INSERT INTO public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
  VALUES('STAFF_TRUST_CHECKLIST','profiles',p_staff_id,jsonb_build_object(
    'supervisor_confirmed',p_supervisor_confirmed,'orientation_completed',p_orientation_completed,'role_training_completed',p_role_training_completed,
    'code_of_conduct_confirmed',p_code_of_conduct_confirmed,'probation_observation_completed',p_probation_observation_completed,
    'state',v_target.assigned_state,'lga',v_target.assigned_lga
  )::text,v_actor.user_id,v_actor.email);
  RETURN true;
END;
$$;


--
-- Name: bank_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    account_number text NOT NULL,
    bank_code text NOT NULL,
    bank_name text NOT NULL,
    account_name text,
    paystack_recipient_code text,
    is_default boolean DEFAULT false,
    verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: upsert_my_bank_account(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_my_bank_account(p_bank_name text, p_account_number text, p_account_name text) RETURNS public.bank_accounts
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$ DECLARE v_user_id text; v_account public.bank_accounts; BEGIN SELECT user_id INTO v_user_id FROM public.profiles WHERE auth_id=auth.uid()::text AND role IN ('worker','property_partner') AND deleted=false AND suspended=false AND banned=false; IF v_user_id IS NULL THEN RAISE EXCEPTION 'Payout account is available only to active workers and property partners'; END IF; IF p_account_number !~ '^[0-9]{10}$' THEN RAISE EXCEPTION 'Bank account number must contain 10 digits'; END IF; UPDATE public.bank_accounts SET is_default=false WHERE user_id=v_user_id; INSERT INTO public.bank_accounts(user_id,bank_name,account_number,account_name,is_default) VALUES(v_user_id,trim(p_bank_name),p_account_number,trim(p_account_name),true) RETURNING * INTO v_account; RETURN v_account; END; $_$;


--
-- Name: verify_branch_booking_code(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.verify_branch_booking_code(p_code text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
DECLARE v_actor public.profiles; v_code text := upper(btrim(COALESCE(p_code,''))); v_result jsonb; v_state text; v_lga text;
BEGIN
  IF v_code !~ '^[A-Z]{3}WH[0-9]{5}$' THEN RAISE EXCEPTION 'Enter a valid WeHouse booking code'; END IF;
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role IN ('staff','admin','creator')
    AND NOT COALESCE(deleted,false) AND NOT COALESCE(suspended,false) AND NOT COALESCE(banned,false) LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Operations access required'; END IF;
  IF v_actor.role='staff' AND NOT public.current_staff_has_permission('operations') THEN RAISE EXCEPTION 'Operations module required'; END IF;

  SELECT jsonb_build_object('kind','housing','code',r.booking_code,'status',r.status,'payment_status',r.manual_payment_status,
      'customer_name',COALESCE(p.full_name,p.username,r.user_email),'customer_phone',COALESCE(p.phone,r.user_phone),
      'property_name',COALESCE(l.title,r.listing_title),'state',l.state,'lga',l.city,'reservation_id',r.id,
      'listing_id',r.listing_id,'tenancy_start_date',r.tenancy_start_date,'tenancy_end_date',r.tenancy_end_date), l.state, l.city
  INTO v_result,v_state,v_lga FROM public.reservations r
  JOIN public.listings l ON l.id::text=r.listing_id OR l.listing_id=r.listing_id
  LEFT JOIN public.profiles p ON p.user_id=r.user_id WHERE r.booking_code=v_code LIMIT 1;

  IF v_result IS NULL THEN
    SELECT jsonb_build_object('kind','hotel','code',hb.booking_code,'status',hb.status,'payment_status',hb.payment_status,
        'customer_name',COALESCE(p.full_name,p.username,hb.guest_name),'customer_phone',COALESCE(p.phone,hb.guest_phone),
        'property_name',h.name,'state',h.state,'lga',h.city,'booking_id',hb.booking_id,'hotel_id',hb.hotel_id,
        'check_in',hb.check_in,'check_out',hb.check_out,'guest_count',hb.guest_count), h.state, h.city
    INTO v_result,v_state,v_lga FROM public.hotel_bookings hb JOIN public.hotels h ON h.hotel_id=hb.hotel_id
    LEFT JOIN public.profiles p ON p.user_id=hb.user_id WHERE hb.booking_code=v_code LIMIT 1;
  END IF;
  IF v_result IS NULL THEN RETURN NULL; END IF;
  IF v_actor.role<>'creator' THEN
    IF lower(btrim(COALESCE(v_actor.assigned_state,v_actor.state,''))) <> lower(btrim(COALESCE(v_state,'')))
       OR lower(btrim(COALESCE(v_actor.assigned_lga,v_actor.local_government,v_actor.city,''))) <> lower(btrim(COALESCE(v_lga,''))) THEN
      RAISE EXCEPTION 'This booking belongs to another WeHouse branch';
    END IF;
  END IF;
  RETURN v_result;
END; $_$;


--
-- Name: worker_accept_booking(uuid, numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.worker_accept_booking(p_booking_id uuid, p_negotiated_amount numeric, p_scheduled_date text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare w public.profiles;b public.worker_bookings;v_date date;
begin
  select * into w from public.profiles where auth_id=auth.uid()::text for update;
  if w is null or w.role<>'worker' then raise exception 'Worker account required'; end if;
  if w.worker_status<>'verified' or w.worker_verified is distinct from true then raise exception 'Verified Worker account required'; end if;
  if not public.worker_identity_is_current(w.user_id) then raise exception 'Repeat your WeHouse identity check before accepting new work'; end if;
  if coalesce(w.deleted,false) or coalesce(w.suspended,false) or coalesce(w.banned,false) then raise exception 'Worker account is not active'; end if;
  if p_negotiated_amount is null or p_negotiated_amount<=0 then raise exception 'Agreed amount must be positive'; end if;
  if nullif(trim(coalesce(p_scheduled_date,'')),'') is not null then v_date:=p_scheduled_date::date; if v_date<current_date then raise exception 'Schedule date cannot be in the past'; end if; end if;
  select * into b from public.worker_bookings where id=p_booking_id for update;
  if b is null then raise exception 'Booking not found'; end if;
  if b.worker_id<>w.user_id then raise exception 'Not authorized'; end if;
  if b.status not in ('booking_requested','negotiating') then raise exception 'Booking cannot be accepted in current status: %',b.status; end if;
  update public.worker_bookings set status='waiting_payment',negotiated_amount=round(p_negotiated_amount,2),agreed_amount=round(p_negotiated_amount,2),scheduled_date=coalesce(v_date,scheduled_date),updated_at=now() where id=p_booking_id;
  return true;
end;
$$;


--
-- Name: worker_identity_is_current(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.worker_identity_is_current(p_worker_id text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists(
    select 1 from public.worker_identity_checks wic
    where wic.worker_id=p_worker_id
      and wic.status='passed'
      and wic.captured_at is not null
      and wic.captured_at + make_interval(days=>public.worker_identity_recheck_days()) > now()
  );
$$;


--
-- Name: worker_identity_recheck_days(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.worker_identity_recheck_days() RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
  select greatest(1,least(90,coalesce((select case when trim(value) ~ '^[0-9]+$' then trim(value)::integer end from public.platform_settings where key='worker_identity_recheck_days' and is_active=true limit 1),14)));
$_$;


--
-- Name: worker_mark_complete(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.worker_mark_complete(p_booking_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE w public.profiles;b public.worker_bookings;
BEGIN
  SELECT * INTO w FROM public.profiles WHERE auth_id=auth.uid()::text;
  IF w IS NULL OR w.role<>'worker' OR coalesce(w.deleted,false) OR coalesce(w.suspended,false) OR coalesce(w.banned,false) THEN RAISE EXCEPTION 'Active Worker account required'; END IF;
  SELECT * INTO b FROM public.worker_bookings WHERE id=p_booking_id FOR UPDATE;
  IF b IS NULL OR b.worker_id<>w.user_id OR b.status<>'in_progress' THEN RAISE EXCEPTION 'Booking not found or not in progress'; END IF;
  UPDATE public.worker_bookings SET status='completed_pending_approval',worker_approved=true,marked_complete_at=now(),updated_at=now() WHERE id=p_booking_id;
  RETURN true;
END;
$$;


--
-- Name: worker_professional_profile_ready(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.worker_professional_profile_ready(p_worker_id text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.profiles p
    WHERE p.user_id=p_worker_id AND p.role='worker'
      AND COALESCE(p.profile_complete,false)=true
      AND NULLIF(BTRIM(COALESCE(p.full_name,'')),'') IS NOT NULL
      AND NULLIF(BTRIM(COALESCE(p.worker_occupation,'')),'') IS NOT NULL
      AND jsonb_typeof(COALESCE(p.worker_skills,'[]'::jsonb))='array'
      AND jsonb_array_length(COALESCE(p.worker_skills,'[]'::jsonb))>0
      AND NULLIF(BTRIM(COALESCE(p.state,'')),'') IS NOT NULL
      AND NULLIF(BTRIM(COALESCE(p.local_government,p.city,'')),'') IS NOT NULL
      AND COALESCE(p.deleted,false)=false AND COALESCE(p.suspended,false)=false AND COALESCE(p.banned,false)=false
      AND EXISTS(SELECT 1 FROM public.worker_service_coverage c WHERE c.worker_id=p.user_id AND NULLIF(BTRIM(COALESCE(c.state,'')),'') IS NOT NULL AND NULLIF(BTRIM(COALESCE(c.lga,'')),'') IS NOT NULL)
  );
$$;


--
-- Name: worker_start_job(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.worker_start_job(p_booking_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare w public.profiles; b public.worker_bookings;
begin
 select * into w from public.profiles where auth_id=auth.uid()::text;
 if w is null or w.role<>'worker' or w.worker_status<>'verified' or w.worker_verified is distinct from true or coalesce(w.deleted,false) or coalesce(w.suspended,false) or coalesce(w.banned,false) then raise exception 'Active verified worker required'; end if;
 if not public.worker_identity_is_current(w.user_id) then raise exception 'Repeat your WeHouse identity check before starting new work'; end if;
 select * into b from public.worker_bookings where id=p_booking_id for update;
 if b is null or b.worker_id<>w.user_id or b.status<>'confirmed' then raise exception 'Booking not found or not ready to start'; end if;
 update public.worker_bookings set status='in_progress',started_at=now(),updated_at=now() where id=p_booking_id; return true;
end $$;


--
-- Name: worker_test_passed(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.worker_test_passed(p_worker_id text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS(SELECT 1 FROM public.worker_test_attempts WHERE worker_id=p_worker_id AND passed=true AND submitted_at IS NOT NULL);
$$;


--
-- Name: activity_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_logs (
    id integer NOT NULL,
    user_id character varying(20),
    action character varying(100) NOT NULL,
    email character varying(320),
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: activity_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.activity_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: activity_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.activity_logs_id_seq OWNED BY public.activity_logs.id;


--
-- Name: admin_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_id text NOT NULL,
    admin_email text,
    action text NOT NULL,
    target_type text NOT NULL,
    target_id text,
    details text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: admin_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_logs (
    id integer NOT NULL,
    admin_id integer NOT NULL,
    action character varying(100) NOT NULL,
    target_type character varying(50) NOT NULL,
    target_id integer,
    details text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: admin_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.admin_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: admin_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.admin_logs_id_seq OWNED BY public.admin_logs.id;


--
-- Name: announcement_recipients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.announcement_recipients (
    id integer NOT NULL,
    announcement_id integer NOT NULL,
    user_id text NOT NULL,
    read_status boolean DEFAULT false,
    delivered_at timestamp with time zone DEFAULT now()
);


--
-- Name: announcement_recipients_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.announcement_recipients_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: announcement_recipients_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.announcement_recipients_id_seq OWNED BY public.announcement_recipients.id;


--
-- Name: announcements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.announcements (
    id integer NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    sender_id text NOT NULL,
    sender_name text DEFAULT 'Admin'::text,
    sender_role text DEFAULT 'creator'::text,
    target_type text DEFAULT 'all_users'::text NOT NULL,
    target_state text,
    target_lga text,
    recipient_count integer DEFAULT 0,
    read_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: announcements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.announcements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: announcements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.announcements_id_seq OWNED BY public.announcements.id;


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    admin_id text,
    admin_email text,
    action text NOT NULL,
    target_type text,
    target_id text,
    details text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: bank_account_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank_account_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    bank_name text NOT NULL,
    bank_code text,
    bank_account_number text NOT NULL,
    bank_account_name text NOT NULL,
    verified_account_name text,
    is_verified boolean DEFAULT false NOT NULL,
    changed_at timestamp with time zone DEFAULT now(),
    changed_by text
);


--
-- Name: blocked_workers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blocked_workers (
    id integer NOT NULL,
    user_id integer NOT NULL,
    worker_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: blocked_workers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.blocked_workers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: blocked_workers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.blocked_workers_id_seq OWNED BY public.blocked_workers.id;


--
-- Name: blue_badge_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blue_badge_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    worker_id text NOT NULL,
    status text DEFAULT 'inactive'::text,
    started_at timestamp with time zone,
    expires_at timestamp with time zone,
    paystack_reference text,
    paystack_subscription_code text,
    amount_paid numeric(12,2) DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT blue_badge_subscriptions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'expired'::text, 'cancelled'::text])))
);


--
-- Name: booking_code_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_code_registry (
    code text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: booking_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid NOT NULL,
    user_id text NOT NULL,
    worker_id text NOT NULL,
    status text DEFAULT 'active'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    hidden_at_user timestamp with time zone,
    hidden_at_worker timestamp with time zone,
    CONSTRAINT booking_conversations_status_check CHECK ((status = ANY (ARRAY['active'::text, 'closed'::text])))
);


--
-- Name: booking_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    sender_id text NOT NULL,
    content text NOT NULL,
    attachments text[],
    created_at timestamp with time zone DEFAULT now(),
    is_read boolean DEFAULT false,
    edited_at timestamp with time zone
);


--
-- Name: booking_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_reference text NOT NULL,
    user_id text,
    payer_user_id text,
    payee_user_id text,
    type text,
    booking_type text,
    listing_id text,
    hotel_booking_id integer,
    amount numeric(12,2),
    amount_total numeric(12,2),
    amount_commission numeric(12,2),
    amount_worker numeric(12,2),
    commission_rate numeric(5,2),
    net_amount numeric(12,2),
    currency text DEFAULT 'NGN'::text,
    status text DEFAULT 'pending'::text,
    purpose text,
    payment_method text,
    paystack_reference text,
    paystack_transaction_id text,
    paystack_subaccount_code text,
    verified_amount numeric(12,2),
    verified_at timestamp with time zone,
    verification_source text,
    paid_at timestamp with time zone,
    webhook_processed boolean DEFAULT false NOT NULL,
    webhook_attempts integer DEFAULT 0 NOT NULL,
    refund_reason text,
    refund_processed_at timestamp with time zone,
    refund_reference text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    worker_booking_id uuid,
    CONSTRAINT booking_payments_purpose_check CHECK ((purpose = ANY (ARRAY['apartment_reservation'::text, 'apartment_rent'::text, 'worker_booking'::text, 'hotel_reservation'::text, 'hotel_booking'::text, 'rent_plan_contribution'::text, 'worker_verification'::text, 'other'::text]))),
    CONSTRAINT booking_payments_verification_source_check CHECK ((verification_source = ANY (ARRAY['webhook'::text, 'edge_function'::text, 'manual'::text])))
);


--
-- Name: booking_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_status_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid,
    old_status text,
    new_status text,
    changed_by text,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: booking_status_labels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_status_labels (
    status_key text NOT NULL,
    label text NOT NULL,
    color text DEFAULT '#5C5E72'::text,
    description text,
    sort_order integer DEFAULT 0
);


--
-- Name: chat_photo_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_photo_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: chat_rooms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_rooms (
    id integer NOT NULL,
    room_id character varying(50) NOT NULL,
    type character varying(20) DEFAULT 'private'::character varying,
    created_by character varying(20),
    participant_1 character varying(20),
    participant_2 character varying(20),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: chat_rooms_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chat_rooms_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chat_rooms_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chat_rooms_id_seq OWNED BY public.chat_rooms.id;


--
-- Name: chat_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    date date DEFAULT CURRENT_DATE NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: commission_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commission_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_id uuid,
    booking_type text,
    source_user_id text,
    commission_amount numeric(12,2),
    commission_rate numeric(5,2),
    gross_amount numeric(12,2),
    description text,
    paystack_reference text,
    status text DEFAULT 'collected'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT commission_ledger_status_check CHECK ((status = ANY (ARRAY['collected'::text, 'settled'::text, 'refunded'::text, 'disputed'::text])))
);


--
-- Name: escrow_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.escrow_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid NOT NULL,
    booking_type text DEFAULT 'worker'::text NOT NULL,
    payer_user_id text NOT NULL,
    payee_user_id text NOT NULL,
    amount_total numeric(12,2) NOT NULL,
    amount_commission numeric(12,2) NOT NULL,
    amount_payee numeric(12,2) NOT NULL,
    commission_rate numeric(5,2) NOT NULL,
    status text DEFAULT 'holding'::text NOT NULL,
    released_at timestamp with time zone,
    released_by text,
    paystack_reference text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: favorites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.favorites (
    id integer NOT NULL,
    user_id integer NOT NULL,
    hostel_id integer,
    worker_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: favorites_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.favorites_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: favorites_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.favorites_id_seq OWNED BY public.favorites.id;


--
-- Name: financial_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.financial_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    action text NOT NULL,
    actor_id text,
    actor_role text,
    target_user_id text,
    target_type text,
    target_id text,
    amount numeric(12,2),
    balance_before numeric(12,2),
    balance_after numeric(12,2),
    commission_amount numeric(12,2),
    description text NOT NULL,
    paystack_reference text,
    paystack_transfer_code text,
    bank_details jsonb,
    status_before text,
    status_after text,
    failure_reason text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: financial_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.financial_audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type text NOT NULL,
    user_id text,
    target_user_id text,
    amount numeric(12,2),
    reference_id text,
    reference_type text,
    description text,
    metadata jsonb DEFAULT '{}'::jsonb,
    ip_address text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT financial_audit_logs_event_type_check CHECK ((event_type = ANY (ARRAY['customer_payment'::text, 'escrow_created'::text, 'escrow_released'::text, 'escrow_refunded'::text, 'withdrawal_requested'::text, 'withdrawal_processing'::text, 'withdrawal_successful'::text, 'withdrawal_failed'::text, 'withdrawal_reversed'::text, 'wallet_frozen'::text, 'wallet_unfrozen'::text, 'commission_deducted'::text, 'security_deposit_held'::text, 'security_deposit_released'::text, 'security_deposit_claimed'::text, 'blue_badge_purchased'::text, 'blue_badge_renewed'::text, 'dispute_opened'::text, 'dispute_resolved'::text, 'manual_adjustment'::text, 'bank_account_change'::text, 'payment_reversed'::text, 'worker_verification_payment'::text, 'withdrawal_snapshot'::text, 'escrow_credit_wallet'::text])))
);


--
-- Name: hotel_bookings_booking_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.hotel_bookings_booking_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: hotel_bookings_booking_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.hotel_bookings_booking_id_seq OWNED BY public.hotel_bookings.booking_id;


--
-- Name: hotel_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hotel_reviews (
    review_id integer NOT NULL,
    hotel_id integer NOT NULL,
    user_id text NOT NULL,
    rating integer NOT NULL,
    comment text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT hotel_reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);


--
-- Name: hotel_reviews_review_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.hotel_reviews_review_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: hotel_reviews_review_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.hotel_reviews_review_id_seq OWNED BY public.hotel_reviews.review_id;


--
-- Name: hotel_rooms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hotel_rooms (
    room_id integer NOT NULL,
    hotel_id integer NOT NULL,
    room_type text NOT NULL,
    description text,
    price_per_night integer NOT NULL,
    max_guests integer DEFAULT 2,
    bed_type text,
    images text[] DEFAULT '{}'::text[],
    amenities text[] DEFAULT '{}'::text[],
    total_rooms integer DEFAULT 1,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: hotel_rooms_room_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.hotel_rooms_room_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: hotel_rooms_room_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.hotel_rooms_room_id_seq OWNED BY public.hotel_rooms.room_id;


--
-- Name: hotels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hotels (
    hotel_id integer NOT NULL,
    name text NOT NULL,
    description text,
    state text NOT NULL,
    city text NOT NULL,
    area text,
    address text,
    images text[] DEFAULT '{}'::text[],
    amenities text[] DEFAULT '{}'::text[],
    owner_id text NOT NULL,
    status text DEFAULT 'active'::text,
    rating numeric(2,1) DEFAULT 0,
    review_count integer DEFAULT 0,
    featured boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    inspection_request_id uuid,
    gps_latitude numeric,
    gps_longitude numeric,
    approved_by text,
    approved_at timestamp with time zone,
    published_at timestamp with time zone,
    CONSTRAINT hotels_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
);


--
-- Name: hotels_hotel_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.hotels_hotel_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: hotels_hotel_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.hotels_hotel_id_seq OWNED BY public.hotels.hotel_id;


--
-- Name: inspection_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspection_status_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inspection_request_id uuid,
    old_status text,
    new_status text,
    changed_by text,
    changed_by_role text,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: listing_image_hashes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_image_hashes (
    id integer NOT NULL,
    listing_id text NOT NULL,
    image_url text NOT NULL,
    image_hash text NOT NULL,
    similarity_score numeric DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: listing_image_hashes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.listing_image_hashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_image_hashes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.listing_image_hashes_id_seq OWNED BY public.listing_image_hashes.id;


--
-- Name: listing_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reporter_id text NOT NULL,
    listing_id text NOT NULL,
    reason text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    resolved_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone
);


--
-- Name: message_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_requests (
    id integer NOT NULL,
    sender_id character varying(20) NOT NULL,
    receiver_id character varying(20) NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying,
    message text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: message_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.message_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: message_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.message_requests_id_seq OWNED BY public.message_requests.id;


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    recipient_id text NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    message text,
    read boolean DEFAULT false NOT NULL,
    related_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: partner_support_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.partner_support_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    partner_id text NOT NULL,
    subject text NOT NULL,
    status text DEFAULT 'open'::text,
    property_name text,
    property_address text,
    property_city text,
    property_state text,
    property_type text,
    rental_mode text,
    inspection_id uuid,
    listing_id uuid,
    assigned_staff_id text,
    assigned_field_officer_id text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    resolved_at timestamp with time zone,
    closed_at timestamp with time zone,
    requester_role text,
    category text DEFAULT 'general'::text NOT NULL,
    context_type text DEFAULT 'general'::text NOT NULL,
    context_id text,
    context_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    priority text DEFAULT 'normal'::text NOT NULL,
    CONSTRAINT partner_support_conversations_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text]))),
    CONSTRAINT partner_support_conversations_requester_role_check CHECK (((requester_role IS NULL) OR (requester_role = ANY (ARRAY['user'::text, 'worker'::text, 'property_partner'::text])))),
    CONSTRAINT partner_support_conversations_status_check CHECK ((status = ANY (ARRAY['open'::text, 'assigned'::text, 'in_progress'::text, 'resolved'::text, 'closed'::text])))
);


--
-- Name: partner_support_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.partner_support_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    sender_id text NOT NULL,
    sender_role text DEFAULT 'partner'::text,
    content text NOT NULL,
    attachments text[],
    attachment_types text[],
    action_type text,
    action_metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    is_read boolean DEFAULT false,
    CONSTRAINT partner_support_messages_action_type_check CHECK ((action_type = ANY (ARRAY['message'::text, 'inspection_requested'::text, 'request_received'::text, 'field_officer_assigned'::text, 'inspection_scheduled'::text, 'inspection_completed'::text, 'listing_created'::text, 'listing_published'::text, 'status_change'::text, 'attachment_added'::text, 'conversation_closed'::text]))),
    CONSTRAINT partner_support_messages_sender_role_check CHECK ((sender_role = ANY (ARRAY['partner'::text, 'staff'::text, 'field_officer'::text, 'creator'::text, 'system'::text])))
);


--
-- Name: payment_reversals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_reversals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    original_payment_id uuid NOT NULL,
    original_reference text NOT NULL,
    reversal_type text NOT NULL,
    original_amount numeric NOT NULL,
    reversal_amount numeric NOT NULL,
    net_after_reversal numeric NOT NULL,
    reason text,
    processed_by text,
    reversal_reference text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT payment_reversals_reversal_type_check CHECK ((reversal_type = ANY (ARRAY['refund'::text, 'chargeback'::text, 'admin_reversal'::text])))
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id integer NOT NULL,
    booking_id integer,
    user_id integer NOT NULL,
    worker_id integer,
    amount numeric(12,2) NOT NULL,
    status character varying(50) DEFAULT 'pending'::character varying NOT NULL,
    reference character varying(255),
    paystack_ref character varying(255),
    paid_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payments_id_seq OWNED BY public.payments.id;


--
-- Name: platform_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_settings (
    id integer NOT NULL,
    key character varying(255) NOT NULL,
    value text,
    category character varying(50) NOT NULL,
    label character varying(255) NOT NULL,
    description text,
    data_type character varying(20) DEFAULT 'string'::character varying NOT NULL,
    editable boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean DEFAULT true
);


--
-- Name: platform_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.platform_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: platform_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.platform_settings_id_seq OWNED BY public.platform_settings.id;


--
-- Name: private_call_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.private_call_preferences (
    user_id text NOT NULL,
    allow_audio_calls boolean DEFAULT true NOT NULL,
    allow_video_calls boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: private_call_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.private_call_signals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    call_id uuid NOT NULL,
    sender_id text NOT NULL,
    signal_type text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT private_call_signals_signal_type_check CHECK ((signal_type = ANY (ARRAY['offer'::text, 'answer'::text, 'ice'::text])))
);


--
-- Name: private_calls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.private_calls (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    context_type text NOT NULL,
    context_id uuid NOT NULL,
    caller_id text NOT NULL,
    callee_id text NOT NULL,
    call_type text NOT NULL,
    status text DEFAULT 'ringing'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    answered_at timestamp with time zone,
    ended_at timestamp with time zone,
    CONSTRAINT private_calls_call_type_check CHECK ((call_type = ANY (ARRAY['audio'::text, 'video'::text]))),
    CONSTRAINT private_calls_context_type_check CHECK ((context_type = ANY (ARRAY['roommate'::text, 'worker_booking'::text]))),
    CONSTRAINT private_calls_not_self CHECK ((caller_id <> callee_id)),
    CONSTRAINT private_calls_status_check CHECK ((status = ANY (ARRAY['ringing'::text, 'accepted'::text, 'declined'::text, 'missed'::text, 'ended'::text, 'failed'::text])))
);


--
-- Name: property_partner_earning_releases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.property_partner_earning_releases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_id uuid NOT NULL,
    partner_id text NOT NULL,
    earning_type text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    net_amount numeric NOT NULL,
    release_event text,
    released_by text,
    released_at timestamp with time zone,
    held_by text,
    held_at timestamp with time zone,
    hold_reason text,
    reversed_by text,
    reversed_at timestamp with time zone,
    reversal_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT property_partner_earning_releases_earning_type_check CHECK ((earning_type = ANY (ARRAY['long_stay_rent'::text, 'short_stay_rent'::text, 'rent_plan_contribution'::text, 'hotel_payment'::text]))),
    CONSTRAINT property_partner_earning_releases_net_amount_check CHECK ((net_amount > (0)::numeric)),
    CONSTRAINT property_partner_earning_releases_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'available'::text, 'held'::text, 'reversed'::text])))
);


--
-- Name: property_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.property_types (
    id integer NOT NULL,
    name text NOT NULL,
    icon text DEFAULT 'house'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: property_types_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.property_types_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: property_types_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.property_types_id_seq OWNED BY public.property_types.id;


--
-- Name: registered_institutions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.registered_institutions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    canonical_name text NOT NULL,
    institution_type text NOT NULL,
    state text NOT NULL,
    local_government text,
    regulator text NOT NULL,
    aliases text[] DEFAULT '{}'::text[] NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT registered_institutions_institution_type_check CHECK ((institution_type = ANY (ARRAY['university'::text, 'polytechnic'::text, 'college'::text]))),
    CONSTRAINT registered_institutions_regulator_check CHECK ((regulator = ANY (ARRAY['NUC'::text, 'NBTE'::text, 'NCCE'::text])))
);


--
-- Name: rent_plan_cancellations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rent_plan_cancellations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rent_plan_id uuid NOT NULL,
    user_id text NOT NULL,
    total_contributed numeric NOT NULL,
    cancellation_fee_percent numeric NOT NULL,
    cancellation_fee_amount numeric NOT NULL,
    refund_amount numeric NOT NULL,
    reason text,
    reason_category text,
    processed_by text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT rent_plan_cancellations_reason_category_check CHECK ((reason_category = ANY (ARRAY['voluntary'::text, 'provider_failure'::text, 'other'::text])))
);


--
-- Name: rent_plan_contributions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rent_plan_contributions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rent_plan_id uuid NOT NULL,
    amount numeric NOT NULL,
    payment_reference text,
    paystack_reference text,
    status text DEFAULT 'scheduled'::text,
    created_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    reservation_id text,
    target_year integer,
    installment_number integer,
    due_date date,
    paid_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rent_plan_contributions_installment_number_check CHECK (((installment_number IS NULL) OR ((installment_number >= 1) AND (installment_number <= 8)))),
    CONSTRAINT rent_plan_contributions_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'payment_pending'::text, 'paid'::text, 'pending'::text, 'completed'::text, 'failed'::text, 'reversed'::text, 'waived'::text]))),
    CONSTRAINT rent_plan_contributions_target_year_check CHECK (((target_year IS NULL) OR ((target_year >= 2) AND (target_year <= 20))))
);


--
-- Name: rent_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rent_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    listing_id uuid,
    target_amount numeric NOT NULL,
    start_after_months integer DEFAULT 4 NOT NULL,
    cancellation_fee_percent numeric DEFAULT 10 NOT NULL,
    accepted_terms text,
    status text DEFAULT 'active'::text,
    total_contributed numeric DEFAULT 0 NOT NULL,
    total_paid_out numeric DEFAULT 0 NOT NULL,
    last_contribution_at timestamp with time zone,
    tenancy_start_date date,
    next_rent_due_date date,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    reservation_id text,
    total_contract_rent numeric,
    upfront_percent numeric,
    upfront_amount numeric,
    installment_count integer DEFAULT 0 NOT NULL,
    installment_amount numeric,
    installment_balance numeric,
    paid_installments integer DEFAULT 0 NOT NULL,
    CONSTRAINT rent_plans_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'completed'::text, 'cancelled'::text])))
);


--
-- Name: reservation_refunds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reservation_refunds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reservation_id text NOT NULL,
    user_id text NOT NULL,
    original_amount numeric NOT NULL,
    refund_percent numeric NOT NULL,
    refund_amount numeric NOT NULL,
    wehouse_retained numeric DEFAULT 0 NOT NULL,
    reason_category text NOT NULL,
    reason_detail text,
    processed_by text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT reservation_refunds_reason_category_check CHECK ((reason_category = ANY (ARRAY['expired_no_action'::text, 'customer_declined_inspection'::text, 'provider_failure'::text, 'listing_mismatch'::text])))
);


--
-- Name: reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reviews (
    id integer NOT NULL,
    booking_id integer NOT NULL,
    user_id integer NOT NULL,
    worker_id integer NOT NULL,
    rating integer NOT NULL,
    comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: reviews_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reviews_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reviews_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reviews_id_seq OWNED BY public.reviews.id;


--
-- Name: role_change_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_change_history (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    user_id text NOT NULL,
    user_email text,
    old_role text NOT NULL,
    new_role text NOT NULL,
    changed_by text NOT NULL,
    changed_by_email text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: roommate_matches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roommate_matches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_a_id text NOT NULL,
    user_b_id text NOT NULL,
    match_score integer DEFAULT 0 NOT NULL,
    match_level text DEFAULT 'low'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: roommate_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roommate_profiles (
    id integer NOT NULL,
    user_id character varying(20) NOT NULL,
    gender character varying(20) NOT NULL,
    age integer DEFAULT 22 NOT NULL,
    budget_min integer DEFAULT 50000,
    budget_max integer DEFAULT 150000,
    area character varying(100),
    city character varying(100),
    gender_preference character varying(20) DEFAULT 'no_preference'::character varying NOT NULL,
    noise_tolerance integer DEFAULT 5 NOT NULL,
    sleep_schedule integer DEFAULT 5 NOT NULL,
    cooking integer DEFAULT 5 NOT NULL,
    visitors integer DEFAULT 5 NOT NULL,
    smoking integer DEFAULT 1 NOT NULL,
    cleanliness integer DEFAULT 7 NOT NULL,
    stay_duration integer DEFAULT 12 NOT NULL,
    personality_type character varying(20) DEFAULT 'ambivert'::character varying,
    study_habits integer DEFAULT 7 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: roommate_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.roommate_profiles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: roommate_profiles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.roommate_profiles_id_seq OWNED BY public.roommate_profiles.id;


--
-- Name: roommate_search_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roommate_search_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    searcher_id text NOT NULL,
    matched_user_id text NOT NULL,
    match_score integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'new'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT roommate_search_results_status_check CHECK ((status = ANY (ARRAY['new'::text, 'viewed'::text, 'accepted'::text, 'declined'::text])))
);


--
-- Name: saved_listings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saved_listings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    listing_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: secrets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.secrets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    value text DEFAULT ''::text NOT NULL,
    description text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by text
);


--
-- Name: service_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    icon text DEFAULT ''::text,
    sort_order integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_by text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: service_subcategories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_subcategories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category_id uuid NOT NULL,
    name text NOT NULL,
    icon text DEFAULT ''::text,
    sort_order integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: staff_location_presence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_location_presence (
    staff_id text NOT NULL,
    latitude numeric NOT NULL,
    longitude numeric NOT NULL,
    accuracy_m numeric,
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT staff_location_presence_latitude_check CHECK (((latitude >= ('-90'::integer)::numeric) AND (latitude <= (90)::numeric))),
    CONSTRAINT staff_location_presence_longitude_check CHECK (((longitude >= ('-180'::integer)::numeric) AND (longitude <= (180)::numeric)))
);


--
-- Name: staff_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    staff_id text NOT NULL,
    permission text NOT NULL,
    granted_by text NOT NULL,
    granted_at timestamp with time zone DEFAULT now(),
    revoked_at timestamp with time zone,
    is_active boolean DEFAULT true
);


--
-- Name: staff_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_reviews (
    reviewer_id text NOT NULL,
    staff_id text NOT NULL,
    booking_id integer NOT NULL,
    "Rating" integer NOT NULL,
    "Comment" text NOT NULL,
    "Created_at" timestamp with time zone NOT NULL
);


--
-- Name: staff_trust_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_trust_profiles (
    staff_id text NOT NULL,
    status text DEFAULT 'probation'::text NOT NULL,
    appointed_by text,
    appointed_at timestamp with time zone DEFAULT now() NOT NULL,
    trusted_by text,
    trusted_at timestamp with time zone,
    notes text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    supervisor_confirmed boolean DEFAULT false NOT NULL,
    orientation_completed boolean DEFAULT false NOT NULL,
    role_training_completed boolean DEFAULT false NOT NULL,
    code_of_conduct_confirmed boolean DEFAULT false NOT NULL,
    probation_observation_completed boolean DEFAULT false NOT NULL,
    CONSTRAINT staff_trust_profiles_status_check CHECK ((status = ANY (ARRAY['probation'::text, 'trusted'::text, 'restricted'::text, 'revoked'::text])))
);


--
-- Name: system_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    value text,
    updated_by text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_activity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_activity (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    auth_id text,
    action_type text NOT NULL,
    details jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_counters (
    id integer NOT NULL,
    role character varying(20) NOT NULL,
    last_number integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_counters_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_counters_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_counters_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_counters_id_seq OWNED BY public.user_counters.id;


--
-- Name: user_id_counter; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_id_counter (
    id integer NOT NULL,
    last_number integer DEFAULT 0
);


--
-- Name: user_id_counter_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_id_counter_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_id_counter_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_id_counter_id_seq OWNED BY public.user_id_counter.id;


--
-- Name: user_ids; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_ids (
    year character varying(4) NOT NULL,
    last_number integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    auth_id text NOT NULL,
    device text,
    browser text,
    os text,
    ip_address text,
    is_active boolean DEFAULT true,
    is_current boolean DEFAULT true,
    login_time timestamp with time zone DEFAULT now() NOT NULL,
    last_seen timestamp with time zone DEFAULT now() NOT NULL,
    logout_time timestamp with time zone
);


--
-- Name: verified_paystack_references; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.verified_paystack_references (
    paystack_reference text NOT NULL,
    booking_payment_id uuid NOT NULL,
    verified_at timestamp with time zone DEFAULT now(),
    verified_amount numeric(12,2),
    verification_source text,
    verified_by text,
    CONSTRAINT verified_paystack_references_verification_source_check CHECK ((verification_source = ANY (ARRAY['webhook'::text, 'edge_function'::text, 'manual'::text])))
);


--
-- Name: wallet_balances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallet_balances (
    user_id text NOT NULL,
    available_balance numeric(12,2) DEFAULT 0 NOT NULL,
    pending_balance numeric(12,2) DEFAULT 0 NOT NULL,
    total_earned numeric(12,2) DEFAULT 0 NOT NULL,
    total_withdrawn numeric(12,2) DEFAULT 0 NOT NULL,
    frozen boolean DEFAULT false NOT NULL,
    frozen_reason text,
    frozen_by text,
    frozen_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: wallet_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallet_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    transaction_type text NOT NULL,
    amount numeric(12,2) NOT NULL,
    balance_after numeric(12,2) NOT NULL,
    reference_id text,
    reference_type text,
    description text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: wallets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id text NOT NULL,
    owner_type text NOT NULL,
    available_balance numeric(12,2) DEFAULT 0,
    pending_balance numeric(12,2) DEFAULT 0,
    frozen_balance numeric(12,2) DEFAULT 0,
    total_withdrawn numeric(12,2) DEFAULT 0,
    bank_name text,
    bank_account_number text,
    bank_account_name text,
    paystack_recipient_code text,
    is_frozen boolean DEFAULT false,
    frozen_reason text,
    frozen_by text,
    frozen_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT wallets_owner_type_check CHECK ((owner_type = ANY (ARRAY['worker'::text, 'property_partner'::text])))
);


--
-- Name: wehouse_user_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wehouse_user_id_seq
    START WITH 10000001
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: withdrawal_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.withdrawal_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    user_role text NOT NULL,
    amount_requested numeric(12,2) NOT NULL,
    withdrawal_fee numeric(12,2) DEFAULT 0 NOT NULL,
    amount_paid numeric(12,2),
    status text DEFAULT 'pending'::text NOT NULL,
    bank_name text NOT NULL,
    bank_code text NOT NULL,
    bank_account_number text NOT NULL,
    bank_account_name text,
    paystack_transfer_code text,
    failure_reason text,
    processed_at timestamp with time zone,
    completed_at timestamp with time zone,
    retry_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    snapshot_bank_name text,
    snapshot_bank_account_number text,
    snapshot_bank_account_name text,
    snapshot_bank_code text
);


--
-- Name: withdrawals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.withdrawals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    wallet_id uuid NOT NULL,
    amount numeric(12,2) NOT NULL,
    paystack_transfer_reference text,
    paystack_transfer_code text,
    status text DEFAULT 'pending'::text,
    bank_name text,
    bank_account_number text,
    bank_account_name text,
    processed_at timestamp with time zone,
    failed_reason text,
    reversed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    snapshot_bank_name text,
    snapshot_bank_account_number text,
    snapshot_bank_account_name text,
    snapshot_bank_code text,
    bank_account_id uuid,
    payout_recipient_code text,
    CONSTRAINT withdrawals_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'successful'::text, 'failed'::text, 'reversed'::text])))
);


--
-- Name: worker_bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.worker_bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_code text,
    user_id text NOT NULL,
    worker_id text NOT NULL,
    service_type text,
    description text,
    address text,
    scheduled_date date,
    agreed_amount numeric(12,2) DEFAULT 0,
    wehouse_fee numeric(12,2) DEFAULT 300,
    worker_commission numeric(12,2) DEFAULT 0,
    worker_receives numeric(12,2) DEFAULT 0,
    negotiated_amount numeric(12,2),
    status text DEFAULT 'booking_requested'::text,
    customer_message text,
    worker_message text,
    worker_approved boolean DEFAULT false,
    user_approved boolean DEFAULT false,
    paystack_reference text,
    paystack_transaction_id text,
    dispute_reason text,
    dispute_resolution text,
    cancellation_reason text,
    refund_reason text,
    refund_amount numeric(12,2),
    booking_conversation_id uuid,
    started_at timestamp with time zone,
    marked_complete_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    cancelled_by text
);


--
-- Name: worker_identity_checks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.worker_identity_checks (
    worker_id text NOT NULL,
    status text DEFAULT 'not_started'::text NOT NULL,
    enrollment_photo_path text,
    challenge_version text DEFAULT 'human-3.3.6-head-turn-v1'::text NOT NULL,
    face_match_score numeric,
    liveness_score numeric,
    anti_spoof_score numeric,
    challenge_result jsonb DEFAULT '{}'::jsonb NOT NULL,
    consent_at timestamp with time zone,
    captured_at timestamp with time zone,
    attempt_count integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    latest_reference_photo_path text,
    latest_reference_at timestamp with time zone,
    CONSTRAINT worker_identity_checks_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT worker_identity_checks_status_check CHECK ((status = ANY (ARRAY['not_started'::text, 'passed'::text, 'failed'::text])))
);


--
-- Name: worker_service_coverage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.worker_service_coverage (
    worker_id text NOT NULL,
    state text NOT NULL,
    lga text NOT NULL,
    areas text[] DEFAULT '{}'::text[] NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: worker_services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.worker_services (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    worker_id text NOT NULL,
    service_name text NOT NULL,
    price integer DEFAULT 0 NOT NULL,
    price_type text DEFAULT 'per_hour'::text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: worker_test_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.worker_test_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    worker_id text NOT NULL,
    question_ids uuid[] NOT NULL,
    answers jsonb DEFAULT '{}'::jsonb NOT NULL,
    score integer,
    total_questions integer NOT NULL,
    percent integer,
    passed boolean DEFAULT false NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    submitted_at timestamp with time zone
);


--
-- Name: worker_test_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.worker_test_questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    category text,
    question text NOT NULL,
    options jsonb NOT NULL,
    correct_index integer NOT NULL,
    explanation text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT worker_test_correct_index_nonnegative CHECK ((correct_index >= 0)),
    CONSTRAINT worker_test_question_options_array CHECK ((jsonb_typeof(options) = 'array'::text))
);


--
-- Name: worker_verification_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.worker_verification_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    worker_id text NOT NULL,
    reviewer_id text NOT NULL,
    reviewer_role text NOT NULL,
    action text NOT NULL,
    rejection_reason text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT worker_verification_reviews_action_check CHECK ((action = ANY (ARRAY['profile_under_review'::text, 'verified'::text, 'rejected'::text, 'approved'::text])))
);


--
-- Name: worker_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.worker_verifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    worker_id text NOT NULL,
    gov_id_type text,
    gov_id_number text,
    gov_id_photo_url text,
    selfie_photo_url text,
    verification_video_url text,
    years_of_experience integer DEFAULT 0,
    service_category_id uuid,
    service_subcategory_id uuid,
    status text DEFAULT 'pending'::text,
    reviewed_by text,
    review_notes text,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    certificate_path text,
    submitted_at timestamp with time zone,
    identity_provider text,
    identity_status text DEFAULT 'not_started'::text NOT NULL,
    identity_reference text,
    identity_checked_at timestamp with time zone,
    identity_failure_reason text,
    CONSTRAINT worker_verifications_status_check CHECK (((status IS NULL) OR (status = ANY (ARRAY['draft'::text, 'pending'::text, 'verification_paid'::text, 'evidence_ready'::text, 'profile_under_review'::text, 'verified'::text, 'rejected'::text]))))
);


--
-- Name: workers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workers (
    id integer NOT NULL,
    user_id integer NOT NULL,
    skill_type character varying(100) NOT NULL,
    years_experience integer DEFAULT 0,
    state character varying(100) NOT NULL,
    city character varying(100) NOT NULL,
    service_area text,
    id_document_url text,
    id_document_verified boolean DEFAULT false NOT NULL,
    bio text,
    verification_status character varying(50) DEFAULT 'pending'::character varying NOT NULL,
    is_verified boolean DEFAULT false NOT NULL,
    is_hidden boolean DEFAULT false NOT NULL,
    is_available boolean DEFAULT true NOT NULL,
    rejection_reason text,
    suspension_reason text,
    verified_by integer,
    verified_at timestamp with time zone,
    rating numeric(2,1) DEFAULT 0.0,
    total_reviews integer DEFAULT 0,
    total_bookings integer DEFAULT 0,
    completed_bookings integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    profile_id uuid,
    trust_scores numeric DEFAULT 0,
    worker_level text DEFAULT 'new worker'::text,
    response_time_minutes integer DEFAULT 0,
    trust_score numeric DEFAULT 0
);


--
-- Name: workers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.workers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: workers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.workers_id_seq OWNED BY public.workers.id;


--
-- Name: activity_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_logs ALTER COLUMN id SET DEFAULT nextval('public.activity_logs_id_seq'::regclass);


--
-- Name: admin_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_logs ALTER COLUMN id SET DEFAULT nextval('public.admin_logs_id_seq'::regclass);


--
-- Name: announcement_recipients id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_recipients ALTER COLUMN id SET DEFAULT nextval('public.announcement_recipients_id_seq'::regclass);


--
-- Name: announcements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements ALTER COLUMN id SET DEFAULT nextval('public.announcements_id_seq'::regclass);


--
-- Name: blocked_workers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blocked_workers ALTER COLUMN id SET DEFAULT nextval('public.blocked_workers_id_seq'::regclass);


--
-- Name: chat_rooms id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_rooms ALTER COLUMN id SET DEFAULT nextval('public.chat_rooms_id_seq'::regclass);


--
-- Name: favorites id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites ALTER COLUMN id SET DEFAULT nextval('public.favorites_id_seq'::regclass);


--
-- Name: hotel_bookings booking_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hotel_bookings ALTER COLUMN booking_id SET DEFAULT nextval('public.hotel_bookings_booking_id_seq'::regclass);


--
-- Name: hotel_reviews review_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hotel_reviews ALTER COLUMN review_id SET DEFAULT nextval('public.hotel_reviews_review_id_seq'::regclass);


--
-- Name: hotel_rooms room_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hotel_rooms ALTER COLUMN room_id SET DEFAULT nextval('public.hotel_rooms_room_id_seq'::regclass);


--
-- Name: hotels hotel_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hotels ALTER COLUMN hotel_id SET DEFAULT nextval('public.hotels_hotel_id_seq'::regclass);


--
-- Name: listing_image_hashes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_image_hashes ALTER COLUMN id SET DEFAULT nextval('public.listing_image_hashes_id_seq'::regclass);


--
-- Name: message_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_requests ALTER COLUMN id SET DEFAULT nextval('public.message_requests_id_seq'::regclass);


--
-- Name: payments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments ALTER COLUMN id SET DEFAULT nextval('public.payments_id_seq'::regclass);


--
-- Name: platform_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_settings ALTER COLUMN id SET DEFAULT nextval('public.platform_settings_id_seq'::regclass);


--
-- Name: property_types id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_types ALTER COLUMN id SET DEFAULT nextval('public.property_types_id_seq'::regclass);


--
-- Name: reviews id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews ALTER COLUMN id SET DEFAULT nextval('public.reviews_id_seq'::regclass);


--
-- Name: roommate_profiles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roommate_profiles ALTER COLUMN id SET DEFAULT nextval('public.roommate_profiles_id_seq'::regclass);


--
-- Name: user_counters id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_counters ALTER COLUMN id SET DEFAULT nextval('public.user_counters_id_seq'::regclass);


--
-- Name: user_id_counter id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_id_counter ALTER COLUMN id SET DEFAULT nextval('public.user_id_counter_id_seq'::regclass);


--
-- Name: workers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workers ALTER COLUMN id SET DEFAULT nextval('public.workers_id_seq'::regclass);


--
-- Name: activity_logs activity_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_logs
    ADD CONSTRAINT activity_logs_pkey PRIMARY KEY (id);


--
-- Name: admin_audit_log admin_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_log
    ADD CONSTRAINT admin_audit_log_pkey PRIMARY KEY (id);


--
-- Name: admin_logs admin_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_logs
    ADD CONSTRAINT admin_logs_pkey PRIMARY KEY (id);


--
-- Name: announcement_recipients announcement_recipients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_recipients
    ADD CONSTRAINT announcement_recipients_pkey PRIMARY KEY (id);


--
-- Name: announcements announcements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: bank_account_history bank_account_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_account_history
    ADD CONSTRAINT bank_account_history_pkey PRIMARY KEY (id);


--
-- Name: bank_accounts bank_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_accounts
    ADD CONSTRAINT bank_accounts_pkey PRIMARY KEY (id);


--
-- Name: bank_accounts bank_accounts_user_id_account_number_bank_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_accounts
    ADD CONSTRAINT bank_accounts_user_id_account_number_bank_code_key UNIQUE (user_id, account_number, bank_code);


--
-- Name: blocked_workers blocked_workers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blocked_workers
    ADD CONSTRAINT blocked_workers_pkey PRIMARY KEY (id);


--
-- Name: blue_badge_subscriptions blue_badge_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_badge_subscriptions
    ADD CONSTRAINT blue_badge_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: booking_code_registry booking_code_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_code_registry
    ADD CONSTRAINT booking_code_registry_pkey PRIMARY KEY (code);


--
-- Name: booking_conversations booking_conversations_booking_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_conversations
    ADD CONSTRAINT booking_conversations_booking_id_key UNIQUE (booking_id);


--
-- Name: booking_conversations booking_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_conversations
    ADD CONSTRAINT booking_conversations_pkey PRIMARY KEY (id);


--
-- Name: booking_messages booking_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_messages
    ADD CONSTRAINT booking_messages_pkey PRIMARY KEY (id);


--
-- Name: booking_payments booking_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_payments
    ADD CONSTRAINT booking_payments_pkey PRIMARY KEY (id);


--
-- Name: booking_status_history booking_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_status_history
    ADD CONSTRAINT booking_status_history_pkey PRIMARY KEY (id);


--
-- Name: booking_status_labels booking_status_labels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_status_labels
    ADD CONSTRAINT booking_status_labels_pkey PRIMARY KEY (status_key);


--
-- Name: chat_photo_usage chat_photo_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_photo_usage
    ADD CONSTRAINT chat_photo_usage_pkey PRIMARY KEY (id);


--
-- Name: chat_rooms chat_rooms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_rooms
    ADD CONSTRAINT chat_rooms_pkey PRIMARY KEY (id);


--
-- Name: chat_rooms chat_rooms_room_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_rooms
    ADD CONSTRAINT chat_rooms_room_id_key UNIQUE (room_id);


--
-- Name: chat_usage chat_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_usage
    ADD CONSTRAINT chat_usage_pkey PRIMARY KEY (id);


--
-- Name: commission_ledger commission_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_ledger
    ADD CONSTRAINT commission_ledger_pkey PRIMARY KEY (id);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: escrow_transactions escrow_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escrow_transactions
    ADD CONSTRAINT escrow_transactions_pkey PRIMARY KEY (id);


--
-- Name: favorites favorites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_pkey PRIMARY KEY (id);


--
-- Name: financial_audit_log financial_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_audit_log
    ADD CONSTRAINT financial_audit_log_pkey PRIMARY KEY (id);


--
-- Name: financial_audit_logs financial_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_audit_logs
    ADD CONSTRAINT financial_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: hotel_bookings hotel_bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hotel_bookings
    ADD CONSTRAINT hotel_bookings_pkey PRIMARY KEY (booking_id);


--
-- Name: hotel_reviews hotel_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hotel_reviews
    ADD CONSTRAINT hotel_reviews_pkey PRIMARY KEY (review_id);


--
-- Name: hotel_rooms hotel_rooms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hotel_rooms
    ADD CONSTRAINT hotel_rooms_pkey PRIMARY KEY (room_id);


--
-- Name: hotels hotels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hotels
    ADD CONSTRAINT hotels_pkey PRIMARY KEY (hotel_id);


--
-- Name: inspection_requests inspection_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_requests
    ADD CONSTRAINT inspection_requests_pkey PRIMARY KEY (id);


--
-- Name: inspection_requests inspection_requests_request_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_requests
    ADD CONSTRAINT inspection_requests_request_code_key UNIQUE (request_code);


--
-- Name: inspection_status_history inspection_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_status_history
    ADD CONSTRAINT inspection_status_history_pkey PRIMARY KEY (id);


--
-- Name: listing_image_hashes listing_image_hashes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_image_hashes
    ADD CONSTRAINT listing_image_hashes_pkey PRIMARY KEY (id);


--
-- Name: listing_reports listing_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_reports
    ADD CONSTRAINT listing_reports_pkey PRIMARY KEY (id);


--
-- Name: listings listings_listing_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listings
    ADD CONSTRAINT listings_listing_id_key UNIQUE (listing_id);


--
-- Name: listings listings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listings
    ADD CONSTRAINT listings_pkey PRIMARY KEY (id);


--
-- Name: message_requests message_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_requests
    ADD CONSTRAINT message_requests_pkey PRIMARY KEY (id);


--
-- Name: message_requests message_requests_sender_id_receiver_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_requests
    ADD CONSTRAINT message_requests_sender_id_receiver_id_key UNIQUE (sender_id, receiver_id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: partner_support_conversations partner_support_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_support_conversations
    ADD CONSTRAINT partner_support_conversations_pkey PRIMARY KEY (id);


--
-- Name: partner_support_messages partner_support_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_support_messages
    ADD CONSTRAINT partner_support_messages_pkey PRIMARY KEY (id);


--
-- Name: payment_reversals payment_reversals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_reversals
    ADD CONSTRAINT payment_reversals_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: platform_settings platform_settings_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_settings
    ADD CONSTRAINT platform_settings_key_key UNIQUE (key);


--
-- Name: platform_settings platform_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_settings
    ADD CONSTRAINT platform_settings_pkey PRIMARY KEY (id);


--
-- Name: private_call_preferences private_call_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.private_call_preferences
    ADD CONSTRAINT private_call_preferences_pkey PRIMARY KEY (user_id);


--
-- Name: private_call_signals private_call_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.private_call_signals
    ADD CONSTRAINT private_call_signals_pkey PRIMARY KEY (id);


--
-- Name: private_calls private_calls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.private_calls
    ADD CONSTRAINT private_calls_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_auth_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_auth_id_key UNIQUE (auth_id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_key UNIQUE (user_id);


--
-- Name: profiles profiles_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_username_key UNIQUE (username);


--
-- Name: property_partner_earning_releases property_partner_earning_releases_payment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_partner_earning_releases
    ADD CONSTRAINT property_partner_earning_releases_payment_id_key UNIQUE (payment_id);


--
-- Name: property_partner_earning_releases property_partner_earning_releases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_partner_earning_releases
    ADD CONSTRAINT property_partner_earning_releases_pkey PRIMARY KEY (id);


--
-- Name: property_partners property_partners_partner_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_partners
    ADD CONSTRAINT property_partners_partner_code_key UNIQUE (partner_code);


--
-- Name: property_partners property_partners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_partners
    ADD CONSTRAINT property_partners_pkey PRIMARY KEY (id);


--
-- Name: property_types property_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_types
    ADD CONSTRAINT property_types_pkey PRIMARY KEY (id);


--
-- Name: registered_institutions registered_institutions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registered_institutions
    ADD CONSTRAINT registered_institutions_pkey PRIMARY KEY (id);


--
-- Name: rent_plan_cancellations rent_plan_cancellations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rent_plan_cancellations
    ADD CONSTRAINT rent_plan_cancellations_pkey PRIMARY KEY (id);


--
-- Name: rent_plan_contributions rent_plan_contributions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rent_plan_contributions
    ADD CONSTRAINT rent_plan_contributions_pkey PRIMARY KEY (id);


--
-- Name: rent_plans rent_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rent_plans
    ADD CONSTRAINT rent_plans_pkey PRIMARY KEY (id);


--
-- Name: reservation_refunds reservation_refunds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_refunds
    ADD CONSTRAINT reservation_refunds_pkey PRIMARY KEY (id);


--
-- Name: reservations reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservations
    ADD CONSTRAINT reservations_pkey PRIMARY KEY (id);


--
-- Name: reviews reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_pkey PRIMARY KEY (id);


--
-- Name: role_change_history role_change_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_change_history
    ADD CONSTRAINT role_change_history_pkey PRIMARY KEY (id);


--
-- Name: roommate_matches roommate_matches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roommate_matches
    ADD CONSTRAINT roommate_matches_pkey PRIMARY KEY (id);


--
-- Name: roommate_matches roommate_matches_user_a_id_user_b_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roommate_matches
    ADD CONSTRAINT roommate_matches_user_a_id_user_b_id_key UNIQUE (user_a_id, user_b_id);


--
-- Name: roommate_preferences roommate_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roommate_preferences
    ADD CONSTRAINT roommate_preferences_pkey PRIMARY KEY (id);


--
-- Name: roommate_preferences roommate_preferences_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roommate_preferences
    ADD CONSTRAINT roommate_preferences_user_id_key UNIQUE (user_id);


--
-- Name: roommate_profiles roommate_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roommate_profiles
    ADD CONSTRAINT roommate_profiles_pkey PRIMARY KEY (id);


--
-- Name: roommate_profiles roommate_profiles_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roommate_profiles
    ADD CONSTRAINT roommate_profiles_user_id_key UNIQUE (user_id);


--
-- Name: roommate_search_results roommate_search_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roommate_search_results
    ADD CONSTRAINT roommate_search_results_pkey PRIMARY KEY (id);


--
-- Name: roommate_search_results roommate_search_results_searcher_id_matched_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roommate_search_results
    ADD CONSTRAINT roommate_search_results_searcher_id_matched_user_id_key UNIQUE (searcher_id, matched_user_id);


--
-- Name: saved_listings saved_listings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_listings
    ADD CONSTRAINT saved_listings_pkey PRIMARY KEY (id);


--
-- Name: saved_listings saved_listings_user_id_listing_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_listings
    ADD CONSTRAINT saved_listings_user_id_listing_id_key UNIQUE (user_id, listing_id);


--
-- Name: secrets secrets_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.secrets
    ADD CONSTRAINT secrets_key_key UNIQUE (key);


--
-- Name: secrets secrets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.secrets
    ADD CONSTRAINT secrets_pkey PRIMARY KEY (id);


--
-- Name: service_categories service_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_categories
    ADD CONSTRAINT service_categories_pkey PRIMARY KEY (id);


--
-- Name: service_subcategories service_subcategories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_subcategories
    ADD CONSTRAINT service_subcategories_pkey PRIMARY KEY (id);


--
-- Name: staff_location_presence staff_location_presence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_location_presence
    ADD CONSTRAINT staff_location_presence_pkey PRIMARY KEY (staff_id);


--
-- Name: staff_permissions staff_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_permissions
    ADD CONSTRAINT staff_permissions_pkey PRIMARY KEY (id);


--
-- Name: staff_permissions staff_permissions_staff_id_permission_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_permissions
    ADD CONSTRAINT staff_permissions_staff_id_permission_key UNIQUE (staff_id, permission);


--
-- Name: staff_reviews staff_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_reviews
    ADD CONSTRAINT staff_reviews_pkey PRIMARY KEY (reviewer_id, staff_id, booking_id, "Rating", "Comment", "Created_at");


--
-- Name: staff_trust_profiles staff_trust_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_trust_profiles
    ADD CONSTRAINT staff_trust_profiles_pkey PRIMARY KEY (staff_id);


--
-- Name: system_settings system_settings_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_key_key UNIQUE (key);


--
-- Name: system_settings system_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (id);


--
-- Name: booking_payments uq_booking_payments_paystack_ref; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_payments
    ADD CONSTRAINT uq_booking_payments_paystack_ref UNIQUE (paystack_reference);


--
-- Name: worker_bookings uq_worker_bookings_paystack_ref; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_bookings
    ADD CONSTRAINT uq_worker_bookings_paystack_ref UNIQUE (paystack_reference);


--
-- Name: user_activity user_activity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_activity
    ADD CONSTRAINT user_activity_pkey PRIMARY KEY (id);


--
-- Name: user_counters user_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_counters
    ADD CONSTRAINT user_counters_pkey PRIMARY KEY (id);


--
-- Name: user_counters user_counters_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_counters
    ADD CONSTRAINT user_counters_role_key UNIQUE (role);


--
-- Name: user_id_counter user_id_counter_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_id_counter
    ADD CONSTRAINT user_id_counter_pkey PRIMARY KEY (id);


--
-- Name: user_ids user_ids_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_ids
    ADD CONSTRAINT user_ids_pkey PRIMARY KEY (year);


--
-- Name: user_inspection_requests user_inspection_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_inspection_requests
    ADD CONSTRAINT user_inspection_requests_pkey PRIMARY KEY (id);


--
-- Name: user_sessions user_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_pkey PRIMARY KEY (id);


--
-- Name: verified_paystack_references verified_paystack_references_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verified_paystack_references
    ADD CONSTRAINT verified_paystack_references_pkey PRIMARY KEY (paystack_reference);


--
-- Name: wallet_balances wallet_balances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_balances
    ADD CONSTRAINT wallet_balances_pkey PRIMARY KEY (user_id);


--
-- Name: wallet_transactions wallet_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_pkey PRIMARY KEY (id);


--
-- Name: wallets wallets_owner_id_owner_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_owner_id_owner_type_key UNIQUE (owner_id, owner_type);


--
-- Name: wallets wallets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_pkey PRIMARY KEY (id);


--
-- Name: withdrawal_requests withdrawal_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.withdrawal_requests
    ADD CONSTRAINT withdrawal_requests_pkey PRIMARY KEY (id);


--
-- Name: withdrawals withdrawals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.withdrawals
    ADD CONSTRAINT withdrawals_pkey PRIMARY KEY (id);


--
-- Name: worker_bookings worker_bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_bookings
    ADD CONSTRAINT worker_bookings_pkey PRIMARY KEY (id);


--
-- Name: worker_identity_checks worker_identity_checks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_identity_checks
    ADD CONSTRAINT worker_identity_checks_pkey PRIMARY KEY (worker_id);


--
-- Name: worker_service_coverage worker_service_coverage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_service_coverage
    ADD CONSTRAINT worker_service_coverage_pkey PRIMARY KEY (worker_id);


--
-- Name: worker_services worker_services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_services
    ADD CONSTRAINT worker_services_pkey PRIMARY KEY (id);


--
-- Name: worker_showcase_posts worker_showcase_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_showcase_posts
    ADD CONSTRAINT worker_showcase_posts_pkey PRIMARY KEY (id);


--
-- Name: worker_showcase_posts worker_showcase_posts_storage_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_showcase_posts
    ADD CONSTRAINT worker_showcase_posts_storage_path_key UNIQUE (storage_path);


--
-- Name: worker_test_attempts worker_test_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_test_attempts
    ADD CONSTRAINT worker_test_attempts_pkey PRIMARY KEY (id);


--
-- Name: worker_test_questions worker_test_questions_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_test_questions
    ADD CONSTRAINT worker_test_questions_code_key UNIQUE (code);


--
-- Name: worker_test_questions worker_test_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_test_questions
    ADD CONSTRAINT worker_test_questions_pkey PRIMARY KEY (id);


--
-- Name: worker_verification_reviews worker_verification_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_verification_reviews
    ADD CONSTRAINT worker_verification_reviews_pkey PRIMARY KEY (id);


--
-- Name: worker_verifications worker_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_verifications
    ADD CONSTRAINT worker_verifications_pkey PRIMARY KEY (id);


--
-- Name: workers workers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workers
    ADD CONSTRAINT workers_pkey PRIMARY KEY (id);


--
-- Name: bank_accounts_one_default_per_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bank_accounts_one_default_per_user ON public.bank_accounts USING btree (user_id) WHERE (is_default = true);


--
-- Name: bank_accounts_unique_user_destination; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bank_accounts_unique_user_destination ON public.bank_accounts USING btree (user_id, bank_code, account_number);


--
-- Name: hotel_bookings_booking_code_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX hotel_bookings_booking_code_unique ON public.hotel_bookings USING btree (booking_code) WHERE (booking_code IS NOT NULL);


--
-- Name: hotel_bookings_payment_reference_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX hotel_bookings_payment_reference_unique ON public.hotel_bookings USING btree (payment_reference) WHERE (payment_reference IS NOT NULL);


--
-- Name: hotels_one_per_inspection_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX hotels_one_per_inspection_idx ON public.hotels USING btree (inspection_request_id) WHERE (inspection_request_id IS NOT NULL);


--
-- Name: idx_a_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_a_created_at ON public.announcements USING btree (created_at DESC);


--
-- Name: idx_a_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_a_created_by ON public.announcements USING btree (sender_id);


--
-- Name: idx_ar_announcement_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ar_announcement_id ON public.announcement_recipients USING btree (announcement_id);


--
-- Name: idx_ar_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ar_user_id ON public.announcement_recipients USING btree (user_id);


--
-- Name: idx_audit_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_created ON public.financial_audit_logs USING btree (created_at);


--
-- Name: idx_audit_event_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_event_type ON public.financial_audit_logs USING btree (event_type);


--
-- Name: idx_audit_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_user ON public.financial_audit_logs USING btree (user_id);


--
-- Name: idx_bc_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bc_user ON public.booking_conversations USING btree (user_id);


--
-- Name: idx_bc_worker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bc_worker ON public.booking_conversations USING btree (worker_id);


--
-- Name: idx_blue_badge_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_blue_badge_status ON public.blue_badge_subscriptions USING btree (status);


--
-- Name: idx_blue_badge_worker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_blue_badge_worker ON public.blue_badge_subscriptions USING btree (worker_id);


--
-- Name: idx_bm_conv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bm_conv ON public.booking_messages USING btree (conversation_id);


--
-- Name: idx_booking_payments_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_booking_payments_reference ON public.booking_payments USING btree (paystack_reference);


--
-- Name: idx_booking_payments_worker_booking_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_booking_payments_worker_booking_id ON public.booking_payments USING btree (worker_booking_id);


--
-- Name: idx_chat_photo_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_photo_user ON public.chat_photo_usage USING btree (user_id);


--
-- Name: idx_chat_rooms_room_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_rooms_room_id ON public.chat_rooms USING btree (room_id);


--
-- Name: idx_chat_usage_user_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_usage_user_date ON public.chat_usage USING btree (user_id, date);


--
-- Name: idx_conversations_listing; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_listing ON public.conversations USING btree (listing_id);


--
-- Name: idx_conversations_participant_a; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_participant_a ON public.conversations USING btree (participant_a);


--
-- Name: idx_conversations_participant_b; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_participant_b ON public.conversations USING btree (participant_b);


--
-- Name: idx_conversations_participants; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_participants ON public.conversations USING btree (participant_a, participant_b);


--
-- Name: idx_conversations_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_type ON public.conversations USING btree (conversation_type);


--
-- Name: idx_hotel_bookings_check_in; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hotel_bookings_check_in ON public.hotel_bookings USING btree (check_in);


--
-- Name: idx_hotel_bookings_hotel_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hotel_bookings_hotel_id ON public.hotel_bookings USING btree (hotel_id);


--
-- Name: idx_hotel_bookings_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hotel_bookings_user_id ON public.hotel_bookings USING btree (user_id);


--
-- Name: idx_hotel_reviews_hotel_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hotel_reviews_hotel_id ON public.hotel_reviews USING btree (hotel_id);


--
-- Name: idx_hotel_rooms_hotel_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hotel_rooms_hotel_id ON public.hotel_rooms USING btree (hotel_id);


--
-- Name: idx_hotels_city; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hotels_city ON public.hotels USING btree (city);


--
-- Name: idx_hotels_featured; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hotels_featured ON public.hotels USING btree (featured);


--
-- Name: idx_hotels_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hotels_state ON public.hotels USING btree (state);


--
-- Name: idx_hotels_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hotels_status ON public.hotels USING btree (status);


--
-- Name: idx_image_hashes_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_image_hashes_hash ON public.listing_image_hashes USING btree (image_hash);


--
-- Name: idx_image_hashes_listing; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_image_hashes_listing ON public.listing_image_hashes USING btree (listing_id);


--
-- Name: idx_inspection_requests_assigned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inspection_requests_assigned ON public.inspection_requests USING btree (assigned_to);


--
-- Name: idx_inspection_requests_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inspection_requests_owner ON public.inspection_requests USING btree (owner_id);


--
-- Name: idx_inspection_requests_owner_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inspection_requests_owner_batch ON public.inspection_requests USING btree (owner_id, submission_batch_id, submission_batch_position) WHERE (submission_batch_id IS NOT NULL);


--
-- Name: idx_inspection_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inspection_requests_status ON public.inspection_requests USING btree (status);


--
-- Name: idx_ir_field_officer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ir_field_officer ON public.inspection_requests USING btree (field_officer_id);


--
-- Name: idx_ir_partner_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ir_partner_id ON public.inspection_requests USING btree (partner_id);


--
-- Name: idx_listings_chat_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_chat_agent ON public.listings USING btree (chat_agent_id);


--
-- Name: idx_listings_owner_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_owner_active ON public.listings USING btree (owner_id, created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_listings_partner_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_partner_active ON public.listings USING btree (partner_id, created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_listings_partner_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_partner_id ON public.listings USING btree (partner_id);


--
-- Name: idx_listings_public_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_public_status ON public.listings USING btree (status, created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_listings_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_status ON public.listings USING btree (status);


--
-- Name: idx_listings_submitted_by_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listings_submitted_by_role ON public.listings USING btree (submitted_by_role);


--
-- Name: idx_messages_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_conversation ON public.messages USING btree (conversation_id);


--
-- Name: idx_messages_conversation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_conversation_id ON public.messages USING btree (conversation_id);


--
-- Name: idx_msg_req_receiver; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_msg_req_receiver ON public.message_requests USING btree (receiver_id);


--
-- Name: idx_msg_req_sender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_msg_req_sender ON public.message_requests USING btree (sender_id);


--
-- Name: idx_msg_req_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_msg_req_status ON public.message_requests USING btree (status);


--
-- Name: idx_one_pending_worker_verification; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_one_pending_worker_verification ON public.booking_payments USING btree (user_id, purpose) WHERE ((status = 'pending'::text) AND (purpose = 'worker_verification'::text));


--
-- Name: idx_prefs_search_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prefs_search_status ON public.roommate_preferences USING btree (search_status) WHERE (search_status = 'active'::text);


--
-- Name: idx_profiles_available_worker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_available_worker ON public.profiles USING btree (available, worker_status, worker_verified);


--
-- Name: idx_profiles_banned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_banned ON public.profiles USING btree (banned) WHERE (banned = true);


--
-- Name: idx_profiles_roommate_candidate_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_roommate_candidate_state ON public.profiles USING btree (lower(state), user_id) WHERE ((role = 'user'::text) AND (profile_complete IS TRUE) AND (deleted IS NOT TRUE) AND (suspended IS NOT TRUE) AND (banned IS NOT TRUE) AND (privacy_search_visible IS NOT FALSE) AND (privacy_profile_visible IS NOT FALSE));


--
-- Name: idx_profiles_suspended; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_suspended ON public.profiles USING btree (suspended) WHERE (suspended = true);


--
-- Name: idx_profiles_worker_price; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_worker_price ON public.profiles USING btree (worker_price);


--
-- Name: idx_profiles_worker_public_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_worker_public_sort ON public.profiles USING btree (rating DESC, review_count DESC) WHERE (role = 'worker'::text);


--
-- Name: idx_property_partners_profile_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_property_partners_profile_id ON public.property_partners USING btree (profile_id);


--
-- Name: idx_psc_partner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_psc_partner ON public.partner_support_conversations USING btree (partner_id);


--
-- Name: idx_psc_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_psc_status ON public.partner_support_conversations USING btree (status);


--
-- Name: idx_psm_conv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_psm_conv ON public.partner_support_messages USING btree (conversation_id);


--
-- Name: idx_reservations_listing; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reservations_listing ON public.reservations USING btree (listing_id);


--
-- Name: idx_reservations_staff_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reservations_staff_id ON public.reservations USING btree (staff_id);


--
-- Name: idx_reservations_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reservations_status ON public.reservations USING btree (status);


--
-- Name: idx_reservations_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reservations_user ON public.reservations USING btree (user_id);


--
-- Name: idx_reservations_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reservations_user_id ON public.reservations USING btree (user_id);


--
-- Name: idx_roommate_matches_user_a; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roommate_matches_user_a ON public.roommate_matches USING btree (user_a_id);


--
-- Name: idx_roommate_matches_user_b; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roommate_matches_user_b ON public.roommate_matches USING btree (user_b_id);


--
-- Name: idx_roommate_prefs_active_budget; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roommate_prefs_active_budget ON public.roommate_preferences USING btree (budget_min, budget_max, user_id) WHERE ((active IS TRUE) AND (search_status = 'active'::text));


--
-- Name: idx_roommate_prefs_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roommate_prefs_user_id ON public.roommate_preferences USING btree (user_id);


--
-- Name: idx_roommate_results_rank; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roommate_results_rank ON public.roommate_search_results USING btree (searcher_id, status, match_score DESC, created_at DESC);


--
-- Name: idx_saved_listings_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_saved_listings_user_id ON public.saved_listings USING btree (user_id);


--
-- Name: idx_search_results_matched; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_search_results_matched ON public.roommate_search_results USING btree (matched_user_id);


--
-- Name: idx_search_results_searcher; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_search_results_searcher ON public.roommate_search_results USING btree (searcher_id);


--
-- Name: idx_search_results_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_search_results_status ON public.roommate_search_results USING btree (searcher_id, status);


--
-- Name: idx_service_categories_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_categories_active ON public.service_categories USING btree (is_active);


--
-- Name: idx_service_subcategories_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_subcategories_active ON public.service_subcategories USING btree (is_active);


--
-- Name: idx_service_subcategories_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_subcategories_category ON public.service_subcategories USING btree (category_id);


--
-- Name: idx_staff_permissions_perm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_permissions_perm ON public.staff_permissions USING btree (permission, is_active);


--
-- Name: idx_staff_permissions_staff; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_permissions_staff ON public.staff_permissions USING btree (staff_id, is_active);


--
-- Name: idx_uir_field_officer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_uir_field_officer ON public.user_inspection_requests USING btree (field_officer_id);


--
-- Name: idx_uir_listing_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_uir_listing_id ON public.user_inspection_requests USING btree (listing_id);


--
-- Name: idx_uir_reservation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_uir_reservation ON public.user_inspection_requests USING btree (reservation_id);


--
-- Name: idx_uir_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_uir_status ON public.user_inspection_requests USING btree (status);


--
-- Name: idx_uir_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_uir_user_id ON public.user_inspection_requests USING btree (user_id);


--
-- Name: idx_user_sessions_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_sessions_active ON public.user_sessions USING btree (user_id, is_active);


--
-- Name: idx_user_sessions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_sessions_user ON public.user_sessions USING btree (user_id);


--
-- Name: idx_wallets_frozen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wallets_frozen ON public.wallets USING btree (is_frozen);


--
-- Name: idx_wallets_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wallets_owner ON public.wallets USING btree (owner_id);


--
-- Name: idx_wb_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wb_status ON public.worker_bookings USING btree (status);


--
-- Name: idx_wb_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wb_user ON public.worker_bookings USING btree (user_id);


--
-- Name: idx_wb_worker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wb_worker ON public.worker_bookings USING btree (worker_id);


--
-- Name: idx_wds; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wds ON public.withdrawal_requests USING btree (status);


--
-- Name: idx_wdu; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wdu ON public.withdrawal_requests USING btree (user_id);


--
-- Name: idx_withdrawals_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_withdrawals_status ON public.withdrawals USING btree (status);


--
-- Name: idx_withdrawals_wallet; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_withdrawals_wallet ON public.withdrawals USING btree (wallet_id);


--
-- Name: idx_worker_services_worker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_worker_services_worker ON public.worker_services USING btree (worker_id);


--
-- Name: idx_worker_showcase_story_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_worker_showcase_story_expiry ON public.worker_showcase_posts USING btree (expires_at) WHERE ((kind = 'story'::text) AND (deleted_at IS NULL));


--
-- Name: idx_worker_showcase_worker_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_worker_showcase_worker_created ON public.worker_showcase_posts USING btree (worker_id, created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_worker_test_attempts_passed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_worker_test_attempts_passed ON public.worker_test_attempts USING btree (worker_id, passed) WHERE (passed = true);


--
-- Name: idx_worker_test_attempts_worker_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_worker_test_attempts_worker_started ON public.worker_test_attempts USING btree (worker_id, started_at DESC);


--
-- Name: idx_worker_verification_reviews_worker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_worker_verification_reviews_worker ON public.worker_verification_reviews USING btree (worker_id);


--
-- Name: idx_worker_verifications_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_worker_verifications_status ON public.worker_verifications USING btree (status);


--
-- Name: idx_worker_verifications_worker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_worker_verifications_worker ON public.worker_verifications USING btree (worker_id);


--
-- Name: idx_wtu; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wtu ON public.wallet_transactions USING btree (user_id);


--
-- Name: inspection_requests_branch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inspection_requests_branch_idx ON public.inspection_requests USING btree (lower(property_state), lower(property_city), status);


--
-- Name: listings_inspection_request_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX listings_inspection_request_unique ON public.listings USING btree (inspection_request_id) WHERE (inspection_request_id IS NOT NULL);


--
-- Name: listings_one_per_inspection_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX listings_one_per_inspection_idx ON public.listings USING btree (inspection_request_id) WHERE ((inspection_request_id IS NOT NULL) AND (deleted_at IS NULL));


--
-- Name: partner_support_one_requester_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX partner_support_one_requester_idx ON public.partner_support_conversations USING btree (partner_id) WHERE (partner_id IS NOT NULL);


--
-- Name: private_call_signals_call_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX private_call_signals_call_created_idx ON public.private_call_signals USING btree (call_id, created_at);


--
-- Name: private_calls_callee_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX private_calls_callee_status_idx ON public.private_calls USING btree (callee_id, status, created_at DESC);


--
-- Name: private_calls_caller_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX private_calls_caller_status_idx ON public.private_calls USING btree (caller_id, status, created_at DESC);


--
-- Name: profiles_field_officer_branch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX profiles_field_officer_branch_idx ON public.profiles USING btree (lower(assigned_state), lower(assigned_lga)) WHERE ((role = 'staff'::text) AND (deleted IS NOT TRUE) AND (suspended IS NOT TRUE) AND (banned IS NOT TRUE));


--
-- Name: property_partners_profile_id_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX property_partners_profile_id_uidx ON public.property_partners USING btree (profile_id);


--
-- Name: registered_institutions_name_state_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX registered_institutions_name_state_unique ON public.registered_institutions USING btree (lower(canonical_name), lower(state));


--
-- Name: registered_institutions_state_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX registered_institutions_state_type_idx ON public.registered_institutions USING btree (state, institution_type) WHERE (is_active = true);


--
-- Name: rent_plan_contributions_paystack_reference_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX rent_plan_contributions_paystack_reference_unique ON public.rent_plan_contributions USING btree (paystack_reference) WHERE (paystack_reference IS NOT NULL);


--
-- Name: rent_plan_contributions_schedule_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX rent_plan_contributions_schedule_unique ON public.rent_plan_contributions USING btree (rent_plan_id, target_year, installment_number);


--
-- Name: rent_plans_one_per_reservation; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX rent_plans_one_per_reservation ON public.rent_plans USING btree (reservation_id) WHERE ((reservation_id IS NOT NULL) AND (status <> 'cancelled'::text));


--
-- Name: reservations_booking_code_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reservations_booking_code_unique ON public.reservations USING btree (booking_code) WHERE (booking_code IS NOT NULL);


--
-- Name: reservations_one_live_hold_per_listing; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reservations_one_live_hold_per_listing ON public.reservations USING btree (listing_id) WHERE (status = ANY (ARRAY['payment_pending'::text, 'reserved'::text, 'inspection_pending'::text, 'ready_for_move_in'::text, 'occupied'::text]));


--
-- Name: uq_commission_ledger_paystack_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_commission_ledger_paystack_reference ON public.commission_ledger USING btree (paystack_reference) WHERE (paystack_reference IS NOT NULL);


--
-- Name: uq_escrow_worker_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_escrow_worker_booking ON public.escrow_transactions USING btree (booking_id, booking_type) WHERE (booking_type = 'worker_booking'::text);


--
-- Name: uq_pending_housing_payment_per_reservation_purpose; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pending_housing_payment_per_reservation_purpose ON public.booking_payments USING btree (purpose, ((metadata ->> 'reservation_id'::text))) WHERE ((status = 'pending'::text) AND (purpose = ANY (ARRAY['apartment_reservation'::text, 'apartment_rent'::text])) AND (metadata ? 'reservation_id'::text));


--
-- Name: uq_saved_listings_user_listing; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_saved_listings_user_listing ON public.saved_listings USING btree (user_id, listing_id);


--
-- Name: worker_verifications_one_per_worker; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX worker_verifications_one_per_worker ON public.worker_verifications USING btree (worker_id);


--
-- Name: booking_messages booking_messages_edit_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER booking_messages_edit_guard BEFORE UPDATE ON public.booking_messages FOR EACH ROW EXECUTE FUNCTION public.enforce_chat_message_update();


--
-- Name: listings enforce_property_partner_listing_owner_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER enforce_property_partner_listing_owner_trigger BEFORE INSERT OR UPDATE OF owner_id, partner_id ON public.listings FOR EACH ROW EXECUTE FUNCTION public.enforce_property_partner_listing_owner();


--
-- Name: booking_payments fulfill_apartment_rent_payment_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER fulfill_apartment_rent_payment_trigger AFTER UPDATE OF status ON public.booking_payments FOR EACH ROW WHEN (((new.purpose = 'apartment_rent'::text) AND (new.status = ANY (ARRAY['paid'::text, 'completed'::text])))) EXECUTE FUNCTION public.fulfill_apartment_rent_payment();


--
-- Name: booking_payments fulfill_apartment_reservation_payment_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER fulfill_apartment_reservation_payment_trigger AFTER UPDATE OF status ON public.booking_payments FOR EACH ROW WHEN (((new.purpose = 'apartment_reservation'::text) AND (new.status = ANY (ARRAY['paid'::text, 'completed'::text])))) EXECUTE FUNCTION public.fulfill_apartment_reservation_payment();


--
-- Name: booking_payments fulfill_hotel_booking_payment_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER fulfill_hotel_booking_payment_trigger AFTER UPDATE OF status ON public.booking_payments FOR EACH ROW WHEN (((new.purpose = 'hotel_booking'::text) AND (new.status = ANY (ARRAY['paid'::text, 'completed'::text])))) EXECUTE FUNCTION public.fulfill_hotel_booking_payment();


--
-- Name: booking_payments fulfill_rent_plan_contribution_payment_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER fulfill_rent_plan_contribution_payment_trigger AFTER UPDATE OF status ON public.booking_payments FOR EACH ROW WHEN (((new.purpose = 'rent_plan_contribution'::text) AND (new.status = ANY (ARRAY['paid'::text, 'completed'::text])))) EXECUTE FUNCTION public.fulfill_rent_plan_contribution_payment();


--
-- Name: hotels guard_inspected_public_hotel_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER guard_inspected_public_hotel_trigger BEFORE INSERT OR UPDATE OF status ON public.hotels FOR EACH ROW EXECUTE FUNCTION public.guard_inspected_public_hotel();


--
-- Name: listings guard_inspected_public_listing_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER guard_inspected_public_listing_trigger BEFORE INSERT OR UPDATE OF status, availability_status ON public.listings FOR EACH ROW EXECUTE FUNCTION public.guard_inspected_public_listing();


--
-- Name: profiles lock_admin_staff_location_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER lock_admin_staff_location_trigger BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.lock_admin_staff_location();


--
-- Name: messages messages_edit_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER messages_edit_guard BEFORE UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION public.enforce_chat_message_update();


--
-- Name: platform_settings platform_legal_version_bump; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER platform_legal_version_bump AFTER INSERT OR UPDATE OF value ON public.platform_settings FOR EACH ROW EXECUTE FUNCTION public.bump_legal_version();


--
-- Name: reservations prevent_double_reservation_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_double_reservation_trigger BEFORE INSERT OR UPDATE OF listing_id, status ON public.reservations FOR EACH ROW WHEN ((new.status = ANY (ARRAY['payment_pending'::text, 'reserved'::text, 'inspection_pending'::text, 'ready_for_move_in'::text, 'occupied'::text]))) EXECUTE FUNCTION public.prevent_double_reservation();


--
-- Name: profiles protect_privileged_profile_fields_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER protect_privileged_profile_fields_trigger BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.protect_privileged_profile_fields();


--
-- Name: booking_payments register_pending_property_partner_earning_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER register_pending_property_partner_earning_trigger AFTER INSERT OR UPDATE OF status, net_amount, payee_user_id ON public.booking_payments FOR EACH ROW EXECUTE FUNCTION public.register_pending_property_partner_earning();


--
-- Name: user_inspection_requests request_inspection_pause_expiry_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER request_inspection_pause_expiry_trigger AFTER INSERT ON public.user_inspection_requests FOR EACH ROW EXECUTE FUNCTION public.request_inspection_pause_expiry();


--
-- Name: hotel_bookings set_hotel_booking_code_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_hotel_booking_code_trigger BEFORE INSERT OR UPDATE OF booking_code ON public.hotel_bookings FOR EACH ROW EXECUTE FUNCTION public.set_hotel_booking_code();


--
-- Name: reservations set_reservation_booking_code_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_reservation_booking_code_trigger BEFORE INSERT OR UPDATE OF booking_code ON public.reservations FOR EACH ROW EXECUTE FUNCTION public.set_reservation_booking_code();


--
-- Name: platform_settings settings_audit_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER settings_audit_trigger AFTER INSERT OR DELETE OR UPDATE ON public.platform_settings FOR EACH ROW EXECUTE FUNCTION public.log_settings_change();


--
-- Name: booking_payments settle_verified_property_partner_payment_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER settle_verified_property_partner_payment_trigger AFTER UPDATE OF status ON public.booking_payments FOR EACH ROW WHEN (((new.status = ANY (ARRAY['paid'::text, 'completed'::text])) AND (old.status IS DISTINCT FROM new.status))) EXECUTE FUNCTION public.settle_verified_property_partner_payment();


--
-- Name: listings sync_listing_lifecycle_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sync_listing_lifecycle_trigger BEFORE INSERT OR UPDATE OF status, availability_status ON public.listings FOR EACH ROW EXECUTE FUNCTION public.sync_listing_lifecycle();


--
-- Name: inspection_requests trg_attach_property_partner_to_inspection; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_attach_property_partner_to_inspection BEFORE INSERT OR UPDATE OF owner_id ON public.inspection_requests FOR EACH ROW EXECUTE FUNCTION public.attach_property_partner_to_inspection();


--
-- Name: worker_verifications trg_block_retired_worker_identity_fields; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_block_retired_worker_identity_fields BEFORE INSERT OR UPDATE OF gov_id_type, gov_id_number, gov_id_photo_url, selfie_photo_url, identity_provider, identity_reference, identity_checked_at, identity_failure_reason, identity_status ON public.worker_verifications FOR EACH ROW EXECUTE FUNCTION public.block_retired_worker_identity_fields();


--
-- Name: hotel_bookings trg_enforce_hotel_booking_integrity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enforce_hotel_booking_integrity BEFORE INSERT OR UPDATE ON public.hotel_bookings FOR EACH ROW EXECUTE FUNCTION public.enforce_hotel_booking_integrity();


--
-- Name: profiles trg_guard_worker_profile_state; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_guard_worker_profile_state BEFORE INSERT OR UPDATE OF role, worker_status, worker_verified, available, deleted, suspended, banned ON public.profiles FOR EACH ROW EXECUTE FUNCTION public._guard_worker_profile_state();


--
-- Name: messages trg_sync_conversation_after_message; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_conversation_after_message AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public._sync_conversation_after_message();


--
-- Name: profiles trg_sync_staff_trust_on_role_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_staff_trust_on_role_change AFTER INSERT OR UPDATE OF role, assigned_state, assigned_lga ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.sync_staff_trust_on_role_change();


--
-- Name: worker_verifications worker_verifications_retired_identity_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER worker_verifications_retired_identity_guard BEFORE INSERT OR UPDATE ON public.worker_verifications FOR EACH ROW EXECUTE FUNCTION public.guard_retired_worker_identity_fields();


--
-- Name: announcement_recipients announcement_recipients_announcement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_recipients
    ADD CONSTRAINT announcement_recipients_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES public.announcements(id) ON DELETE CASCADE;


--
-- Name: bank_accounts bank_accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_accounts
    ADD CONSTRAINT bank_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id);


--
-- Name: blue_badge_subscriptions blue_badge_subscriptions_worker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_badge_subscriptions
    ADD CONSTRAINT blue_badge_subscriptions_worker_id_fkey FOREIGN KEY (worker_id) REFERENCES public.profiles(user_id);


--
-- Name: booking_conversations booking_conversations_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_conversations
    ADD CONSTRAINT booking_conversations_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.worker_bookings(id) ON DELETE CASCADE;


--
-- Name: booking_messages booking_messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_messages
    ADD CONSTRAINT booking_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.booking_conversations(id) ON DELETE CASCADE;


--
-- Name: booking_payments booking_payments_worker_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_payments
    ADD CONSTRAINT booking_payments_worker_booking_id_fkey FOREIGN KEY (worker_booking_id) REFERENCES public.worker_bookings(id);


--
-- Name: booking_status_history booking_status_history_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_status_history
    ADD CONSTRAINT booking_status_history_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.worker_bookings(id) ON DELETE CASCADE;


--
-- Name: commission_ledger commission_ledger_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_ledger
    ADD CONSTRAINT commission_ledger_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.booking_payments(id);


--
-- Name: financial_audit_logs financial_audit_logs_target_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_audit_logs
    ADD CONSTRAINT financial_audit_logs_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES public.profiles(user_id);


--
-- Name: financial_audit_logs financial_audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_audit_logs
    ADD CONSTRAINT financial_audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id);


--
-- Name: hotel_bookings hotel_bookings_hotel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hotel_bookings
    ADD CONSTRAINT hotel_bookings_hotel_id_fkey FOREIGN KEY (hotel_id) REFERENCES public.hotels(hotel_id) ON DELETE CASCADE;


--
-- Name: hotel_bookings hotel_bookings_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hotel_bookings
    ADD CONSTRAINT hotel_bookings_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.hotel_rooms(room_id) ON DELETE CASCADE;


--
-- Name: hotel_bookings hotel_bookings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hotel_bookings
    ADD CONSTRAINT hotel_bookings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: hotel_reviews hotel_reviews_hotel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hotel_reviews
    ADD CONSTRAINT hotel_reviews_hotel_id_fkey FOREIGN KEY (hotel_id) REFERENCES public.hotels(hotel_id) ON DELETE CASCADE;


--
-- Name: hotel_reviews hotel_reviews_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hotel_reviews
    ADD CONSTRAINT hotel_reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: hotel_rooms hotel_rooms_hotel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hotel_rooms
    ADD CONSTRAINT hotel_rooms_hotel_id_fkey FOREIGN KEY (hotel_id) REFERENCES public.hotels(hotel_id) ON DELETE CASCADE;


--
-- Name: hotels hotels_inspection_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hotels
    ADD CONSTRAINT hotels_inspection_request_id_fkey FOREIGN KEY (inspection_request_id) REFERENCES public.inspection_requests(id) ON DELETE SET NULL;


--
-- Name: hotels hotels_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hotels
    ADD CONSTRAINT hotels_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: inspection_requests inspection_requests_draft_hotel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_requests
    ADD CONSTRAINT inspection_requests_draft_hotel_id_fkey FOREIGN KEY (draft_hotel_id) REFERENCES public.hotels(hotel_id) ON DELETE SET NULL;


--
-- Name: inspection_status_history inspection_status_history_inspection_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_status_history
    ADD CONSTRAINT inspection_status_history_inspection_request_id_fkey FOREIGN KEY (inspection_request_id) REFERENCES public.inspection_requests(id);


--
-- Name: listings listings_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listings
    ADD CONSTRAINT listings_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.profiles(user_id);


--
-- Name: listings listings_current_reservation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listings
    ADD CONSTRAINT listings_current_reservation_id_fkey FOREIGN KEY (current_reservation_id) REFERENCES public.reservations(id) ON DELETE SET NULL;


--
-- Name: listings listings_inspection_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listings
    ADD CONSTRAINT listings_inspection_request_id_fkey FOREIGN KEY (inspection_request_id) REFERENCES public.inspection_requests(id) ON DELETE SET NULL;


--
-- Name: messages messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: partner_support_messages partner_support_messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_support_messages
    ADD CONSTRAINT partner_support_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.partner_support_conversations(id) ON DELETE CASCADE;


--
-- Name: payment_reversals payment_reversals_original_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_reversals
    ADD CONSTRAINT payment_reversals_original_payment_id_fkey FOREIGN KEY (original_payment_id) REFERENCES public.booking_payments(id);


--
-- Name: private_call_preferences private_call_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.private_call_preferences
    ADD CONSTRAINT private_call_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: private_call_signals private_call_signals_call_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.private_call_signals
    ADD CONSTRAINT private_call_signals_call_id_fkey FOREIGN KEY (call_id) REFERENCES public.private_calls(id) ON DELETE CASCADE;


--
-- Name: private_call_signals private_call_signals_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.private_call_signals
    ADD CONSTRAINT private_call_signals_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: private_calls private_calls_callee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.private_calls
    ADD CONSTRAINT private_calls_callee_id_fkey FOREIGN KEY (callee_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: private_calls private_calls_caller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.private_calls
    ADD CONSTRAINT private_calls_caller_id_fkey FOREIGN KEY (caller_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: property_partner_earning_releases property_partner_earning_releases_held_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_partner_earning_releases
    ADD CONSTRAINT property_partner_earning_releases_held_by_fkey FOREIGN KEY (held_by) REFERENCES public.profiles(user_id);


--
-- Name: property_partner_earning_releases property_partner_earning_releases_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_partner_earning_releases
    ADD CONSTRAINT property_partner_earning_releases_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.profiles(user_id) ON DELETE RESTRICT;


--
-- Name: property_partner_earning_releases property_partner_earning_releases_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_partner_earning_releases
    ADD CONSTRAINT property_partner_earning_releases_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.booking_payments(id) ON DELETE RESTRICT;


--
-- Name: property_partner_earning_releases property_partner_earning_releases_released_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_partner_earning_releases
    ADD CONSTRAINT property_partner_earning_releases_released_by_fkey FOREIGN KEY (released_by) REFERENCES public.profiles(user_id);


--
-- Name: property_partner_earning_releases property_partner_earning_releases_reversed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_partner_earning_releases
    ADD CONSTRAINT property_partner_earning_releases_reversed_by_fkey FOREIGN KEY (reversed_by) REFERENCES public.profiles(user_id);


--
-- Name: rent_plan_cancellations rent_plan_cancellations_rent_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rent_plan_cancellations
    ADD CONSTRAINT rent_plan_cancellations_rent_plan_id_fkey FOREIGN KEY (rent_plan_id) REFERENCES public.rent_plans(id);


--
-- Name: rent_plan_contributions rent_plan_contributions_rent_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rent_plan_contributions
    ADD CONSTRAINT rent_plan_contributions_rent_plan_id_fkey FOREIGN KEY (rent_plan_id) REFERENCES public.rent_plans(id) ON DELETE CASCADE;


--
-- Name: rent_plan_contributions rent_plan_contributions_reservation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rent_plan_contributions
    ADD CONSTRAINT rent_plan_contributions_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES public.reservations(id) ON DELETE CASCADE;


--
-- Name: rent_plans rent_plans_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rent_plans
    ADD CONSTRAINT rent_plans_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id);


--
-- Name: rent_plans rent_plans_reservation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rent_plans
    ADD CONSTRAINT rent_plans_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES public.reservations(id) ON DELETE CASCADE;


--
-- Name: rent_plans rent_plans_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rent_plans
    ADD CONSTRAINT rent_plans_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id);


--
-- Name: reservation_refunds reservation_refunds_reservation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_refunds
    ADD CONSTRAINT reservation_refunds_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES public.reservations(id);


--
-- Name: roommate_search_results roommate_search_results_matched_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roommate_search_results
    ADD CONSTRAINT roommate_search_results_matched_user_id_fkey FOREIGN KEY (matched_user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: roommate_search_results roommate_search_results_searcher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roommate_search_results
    ADD CONSTRAINT roommate_search_results_searcher_id_fkey FOREIGN KEY (searcher_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: saved_listings saved_listings_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_listings
    ADD CONSTRAINT saved_listings_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;


--
-- Name: service_categories service_categories_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_categories
    ADD CONSTRAINT service_categories_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(user_id);


--
-- Name: service_subcategories service_subcategories_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_subcategories
    ADD CONSTRAINT service_subcategories_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.service_categories(id) ON DELETE CASCADE;


--
-- Name: staff_location_presence staff_location_presence_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_location_presence
    ADD CONSTRAINT staff_location_presence_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: staff_trust_profiles staff_trust_profiles_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_trust_profiles
    ADD CONSTRAINT staff_trust_profiles_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: user_inspection_requests user_inspection_requests_reservation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_inspection_requests
    ADD CONSTRAINT user_inspection_requests_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES public.reservations(id) ON DELETE CASCADE;


--
-- Name: user_sessions user_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: verified_paystack_references verified_paystack_references_booking_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verified_paystack_references
    ADD CONSTRAINT verified_paystack_references_booking_payment_id_fkey FOREIGN KEY (booking_payment_id) REFERENCES public.booking_payments(id);


--
-- Name: wallets wallets_frozen_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_frozen_by_fkey FOREIGN KEY (frozen_by) REFERENCES public.profiles(user_id);


--
-- Name: wallets wallets_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(user_id);


--
-- Name: withdrawals withdrawals_bank_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.withdrawals
    ADD CONSTRAINT withdrawals_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES public.bank_accounts(id) ON DELETE SET NULL;


--
-- Name: withdrawals withdrawals_wallet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.withdrawals
    ADD CONSTRAINT withdrawals_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES public.wallets(id);


--
-- Name: worker_identity_checks worker_identity_checks_worker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_identity_checks
    ADD CONSTRAINT worker_identity_checks_worker_id_fkey FOREIGN KEY (worker_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: worker_service_coverage worker_service_coverage_worker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_service_coverage
    ADD CONSTRAINT worker_service_coverage_worker_id_fkey FOREIGN KEY (worker_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: worker_showcase_posts worker_showcase_posts_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_showcase_posts
    ADD CONSTRAINT worker_showcase_posts_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.worker_bookings(id) ON DELETE SET NULL;


--
-- Name: worker_showcase_posts worker_showcase_posts_worker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_showcase_posts
    ADD CONSTRAINT worker_showcase_posts_worker_id_fkey FOREIGN KEY (worker_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: worker_test_attempts worker_test_attempts_worker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_test_attempts
    ADD CONSTRAINT worker_test_attempts_worker_id_fkey FOREIGN KEY (worker_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: worker_verifications worker_verifications_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_verifications
    ADD CONSTRAINT worker_verifications_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.profiles(user_id);


--
-- Name: worker_verifications worker_verifications_service_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_verifications
    ADD CONSTRAINT worker_verifications_service_category_id_fkey FOREIGN KEY (service_category_id) REFERENCES public.service_categories(id);


--
-- Name: worker_verifications worker_verifications_service_subcategory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_verifications
    ADD CONSTRAINT worker_verifications_service_subcategory_id_fkey FOREIGN KEY (service_subcategory_id) REFERENCES public.service_subcategories(id);


--
-- Name: worker_verifications worker_verifications_worker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_verifications
    ADD CONSTRAINT worker_verifications_worker_id_fkey FOREIGN KEY (worker_id) REFERENCES public.profiles(user_id);


--
-- Name: activity_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_audit_log admin_audit_insert_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_audit_insert_canonical ON public.admin_audit_log FOR INSERT TO authenticated WITH CHECK (((admin_id = public.current_profile_user_id()) AND (public.current_profile_role() = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text]))));


--
-- Name: admin_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_audit_log admin_audit_read_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_audit_read_canonical ON public.admin_audit_log FOR SELECT TO authenticated USING (((public.current_profile_role() = 'creator'::text) OR (admin_id = public.current_profile_user_id())));


--
-- Name: admin_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: announcement_recipients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.announcement_recipients ENABLE ROW LEVEL SECURITY;

--
-- Name: announcement_recipients announcement_recipients_creator_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY announcement_recipients_creator_insert ON public.announcement_recipients FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.auth_id = (auth.uid())::text) AND (p.role = 'creator'::text)))));


--
-- Name: announcement_recipients announcement_recipients_visible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY announcement_recipients_visible ON public.announcement_recipients FOR SELECT TO authenticated USING (((user_id = public.current_profile_user_id()) OR (public.current_profile_role() = 'creator'::text) OR public.is_current_announcement_sender((announcement_id)::bigint)));


--
-- Name: announcements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

--
-- Name: announcements announcements_creator_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY announcements_creator_insert ON public.announcements FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.auth_id = (auth.uid())::text) AND (p.role = 'creator'::text)))));


--
-- Name: announcements announcements_creator_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY announcements_creator_update ON public.announcements FOR UPDATE TO authenticated USING (((public.current_profile_role() = 'creator'::text) AND (sender_id = public.current_profile_user_id()))) WITH CHECK (((public.current_profile_role() = 'creator'::text) AND (sender_id = public.current_profile_user_id())));


--
-- Name: announcements announcements_sender_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY announcements_sender_delete ON public.announcements FOR DELETE TO authenticated USING (((sender_id = ( SELECT p.user_id
   FROM public.profiles p
  WHERE (p.auth_id = (auth.uid())::text)
 LIMIT 1)) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.auth_id = (auth.uid())::text) AND (p.role = 'creator'::text))))));


--
-- Name: announcements announcements_visible_to_recipient_or_sender; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY announcements_visible_to_recipient_or_sender ON public.announcements FOR SELECT TO authenticated USING (((sender_id = public.current_profile_user_id()) OR (public.current_profile_role() = 'creator'::text) OR public.is_current_announcement_recipient((id)::bigint)));


--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: bank_account_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bank_account_history ENABLE ROW LEVEL SECURITY;

--
-- Name: bank_account_history bank_account_history_read_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bank_account_history_read_canonical ON public.bank_account_history FOR SELECT TO authenticated USING (((user_id = public.current_profile_user_id()) OR (public.current_profile_role() = 'creator'::text) OR ((public.current_profile_role() = 'admin'::text) AND public.can_current_actor_read_profile(user_id))));


--
-- Name: bank_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: bank_accounts bank_accounts_owner_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bank_accounts_owner_select ON public.bank_accounts FOR SELECT TO authenticated USING ((user_id = ( SELECT p.user_id
   FROM public.profiles p
  WHERE (p.auth_id = (auth.uid())::text)
 LIMIT 1)));


--
-- Name: booking_conversations bc_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bc_all ON public.booking_conversations TO authenticated USING (((user_id = ( SELECT profiles.user_id
   FROM public.profiles
  WHERE (profiles.auth_id = (auth.uid())::text)
 LIMIT 1)) OR (worker_id = ( SELECT profiles.user_id
   FROM public.profiles
  WHERE (profiles.auth_id = (auth.uid())::text)
 LIMIT 1)))) WITH CHECK (((user_id = ( SELECT profiles.user_id
   FROM public.profiles
  WHERE (profiles.auth_id = (auth.uid())::text)
 LIMIT 1)) OR (worker_id = ( SELECT profiles.user_id
   FROM public.profiles
  WHERE (profiles.auth_id = (auth.uid())::text)
 LIMIT 1))));


--
-- Name: blocked_workers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.blocked_workers ENABLE ROW LEVEL SECURITY;

--
-- Name: blue_badge_subscriptions blue_badge_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY blue_badge_own ON public.blue_badge_subscriptions FOR SELECT TO authenticated USING ((worker_id = ( SELECT profiles.user_id
   FROM public.profiles
  WHERE (profiles.auth_id = (auth.uid())::text)
 LIMIT 1)));


--
-- Name: blue_badge_subscriptions blue_badge_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY blue_badge_staff ON public.blue_badge_subscriptions TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text]))))));


--
-- Name: blue_badge_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.blue_badge_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: booking_code_registry; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.booking_code_registry ENABLE ROW LEVEL SECURITY;

--
-- Name: booking_conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.booking_conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: booking_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.booking_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: booking_messages booking_messages_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY booking_messages_insert ON public.booking_messages FOR INSERT TO authenticated WITH CHECK (((sender_id = ( SELECT p.user_id
   FROM public.profiles p
  WHERE (p.auth_id = (auth.uid())::text)
 LIMIT 1)) AND (conversation_id IN ( SELECT bc.id
   FROM public.booking_conversations bc
  WHERE ((bc.user_id = ( SELECT p.user_id
           FROM public.profiles p
          WHERE (p.auth_id = (auth.uid())::text)
         LIMIT 1)) OR (bc.worker_id = ( SELECT p.user_id
           FROM public.profiles p
          WHERE (p.auth_id = (auth.uid())::text)
         LIMIT 1)))))));


--
-- Name: booking_messages booking_messages_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY booking_messages_select ON public.booking_messages FOR SELECT TO authenticated USING ((conversation_id IN ( SELECT bc.id
   FROM public.booking_conversations bc
  WHERE ((bc.user_id = ( SELECT p.user_id
           FROM public.profiles p
          WHERE (p.auth_id = (auth.uid())::text)
         LIMIT 1)) OR (bc.worker_id = ( SELECT p.user_id
           FROM public.profiles p
          WHERE (p.auth_id = (auth.uid())::text)
         LIMIT 1))))));


--
-- Name: booking_messages booking_messages_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY booking_messages_update ON public.booking_messages FOR UPDATE TO authenticated USING ((conversation_id IN ( SELECT bc.id
   FROM public.booking_conversations bc
  WHERE ((bc.user_id = ( SELECT p.user_id
           FROM public.profiles p
          WHERE (p.auth_id = (auth.uid())::text)
         LIMIT 1)) OR (bc.worker_id = ( SELECT p.user_id
           FROM public.profiles p
          WHERE (p.auth_id = (auth.uid())::text)
         LIMIT 1)))))) WITH CHECK ((conversation_id IN ( SELECT bc.id
   FROM public.booking_conversations bc
  WHERE ((bc.user_id = ( SELECT p.user_id
           FROM public.profiles p
          WHERE (p.auth_id = (auth.uid())::text)
         LIMIT 1)) OR (bc.worker_id = ( SELECT p.user_id
           FROM public.profiles p
          WHERE (p.auth_id = (auth.uid())::text)
         LIMIT 1))))));


--
-- Name: booking_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.booking_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: booking_status_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.booking_status_history ENABLE ROW LEVEL SECURITY;

--
-- Name: booking_status_history booking_status_history_read_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY booking_status_history_read_canonical ON public.booking_status_history FOR SELECT TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.worker_bookings b
  WHERE ((b.id = booking_status_history.booking_id) AND ((b.user_id = public.current_profile_user_id()) OR (b.worker_id = public.current_profile_user_id()))))) OR ((public.current_profile_role() = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text])) AND public.current_actor_can_access_worker_booking(booking_id))));


--
-- Name: booking_status_labels; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.booking_status_labels ENABLE ROW LEVEL SECURITY;

--
-- Name: booking_status_labels booking_status_labels_creator_write_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY booking_status_labels_creator_write_canonical ON public.booking_status_labels TO authenticated USING ((public.current_profile_role() = 'creator'::text)) WITH CHECK ((public.current_profile_role() = 'creator'::text));


--
-- Name: booking_status_labels booking_status_labels_read_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY booking_status_labels_read_canonical ON public.booking_status_labels FOR SELECT TO authenticated USING (true);


--
-- Name: chat_photo_usage; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_photo_usage ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_photo_usage chat_photo_usage_creator_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chat_photo_usage_creator_read ON public.chat_photo_usage FOR SELECT TO authenticated USING (public.is_current_creator());


--
-- Name: chat_photo_usage chat_photo_usage_owner_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chat_photo_usage_owner_insert ON public.chat_photo_usage FOR INSERT TO authenticated WITH CHECK ((user_id = public.current_profile_user_id()));


--
-- Name: chat_photo_usage chat_photo_usage_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chat_photo_usage_owner_read ON public.chat_photo_usage FOR SELECT TO authenticated USING ((user_id = public.current_profile_user_id()));


--
-- Name: chat_rooms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_rooms ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_usage; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_usage ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_usage chat_usage_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chat_usage_owner ON public.chat_usage TO authenticated USING ((user_id = (auth.uid())::text));


--
-- Name: commission_ledger; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.commission_ledger ENABLE ROW LEVEL SECURITY;

--
-- Name: commission_ledger commission_ledger_creator_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY commission_ledger_creator_select ON public.commission_ledger FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.auth_id = (auth.uid())::text) AND (p.role = 'creator'::text) AND (NOT COALESCE(p.deleted, false)) AND (NOT COALESCE(p.suspended, false)) AND (NOT COALESCE(p.banned, false))))));


--
-- Name: conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: conversations conversations_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversations_insert ON public.conversations FOR INSERT TO authenticated WITH CHECK (false);


--
-- Name: conversations conversations_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversations_select ON public.conversations FOR SELECT TO authenticated USING (public._can_access_conversation(id));


--
-- Name: conversations conversations_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversations_update ON public.conversations FOR UPDATE TO authenticated USING (public._can_access_conversation(id)) WITH CHECK (public._can_access_conversation(id));


--
-- Name: escrow_transactions escrow_read_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY escrow_read_canonical ON public.escrow_transactions FOR SELECT TO authenticated USING (((payer_user_id = public.current_profile_user_id()) OR (payee_user_id = public.current_profile_user_id()) OR (public.current_profile_role() = 'creator'::text) OR ((public.current_profile_role() = 'admin'::text) AND (public.can_current_actor_read_profile(payer_user_id) OR public.can_current_actor_read_profile(payee_user_id)))));


--
-- Name: escrow_transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.escrow_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: favorites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

--
-- Name: favorites favorites_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY favorites_owner ON public.favorites TO authenticated USING (((user_id)::text = (auth.uid())::text));


--
-- Name: financial_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.financial_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: financial_audit_log financial_audit_log_read_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY financial_audit_log_read_canonical ON public.financial_audit_log FOR SELECT TO authenticated USING (((public.current_profile_role() = 'creator'::text) OR ((public.current_profile_role() = 'admin'::text) AND (target_user_id IS NOT NULL) AND public.can_current_actor_read_profile(target_user_id))));


--
-- Name: financial_audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.financial_audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: financial_audit_logs financial_audit_logs_read_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY financial_audit_logs_read_canonical ON public.financial_audit_logs FOR SELECT TO authenticated USING (((public.current_profile_role() = 'creator'::text) OR ((public.current_profile_role() = 'admin'::text) AND (target_user_id IS NOT NULL) AND public.can_current_actor_read_profile(target_user_id))));


--
-- Name: hotel_bookings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hotel_bookings ENABLE ROW LEVEL SECURITY;

--
-- Name: hotel_bookings hotel_bookings_admin_select_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hotel_bookings_admin_select_v2 ON public.hotel_bookings FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.profiles actor
     JOIN public.hotels h ON ((h.hotel_id = hotel_bookings.hotel_id)))
  WHERE ((actor.auth_id = (auth.uid())::text) AND (actor.role = ANY (ARRAY['admin'::text, 'creator'::text])) AND (NOT COALESCE(actor.deleted, false)) AND (NOT COALESCE(actor.suspended, false)) AND (NOT COALESCE(actor.banned, false)) AND ((actor.role = 'creator'::text) OR ((lower(TRIM(BOTH FROM COALESCE(h.state, ''::text))) = lower(TRIM(BOTH FROM COALESCE(actor.assigned_state, ''::text)))) AND (lower(TRIM(BOTH FROM COALESCE(h.city, ''::text))) = lower(TRIM(BOTH FROM COALESCE(actor.assigned_lga, ''::text))))))))));


--
-- Name: hotel_bookings hotel_bookings_creator_select_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hotel_bookings_creator_select_v2 ON public.hotel_bookings FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.auth_id = (auth.uid())::text) AND (p.role = 'creator'::text) AND (NOT COALESCE(p.deleted, false)) AND (NOT COALESCE(p.suspended, false)) AND (NOT COALESCE(p.banned, false))))));


--
-- Name: hotel_bookings hotel_bookings_customer_insert_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hotel_bookings_customer_insert_v2 ON public.hotel_bookings FOR INSERT TO authenticated WITH CHECK ((user_id = ( SELECT p.user_id
   FROM public.profiles p
  WHERE ((p.auth_id = (auth.uid())::text) AND (p.role = 'user'::text) AND (NOT COALESCE(p.deleted, false)) AND (NOT COALESCE(p.suspended, false)) AND (NOT COALESCE(p.banned, false)))
 LIMIT 1)));


--
-- Name: hotel_bookings hotel_bookings_customer_select_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hotel_bookings_customer_select_v2 ON public.hotel_bookings FOR SELECT TO authenticated USING ((user_id = ( SELECT p.user_id
   FROM public.profiles p
  WHERE (p.auth_id = (auth.uid())::text)
 LIMIT 1)));


--
-- Name: hotel_bookings hotel_bookings_customer_update_v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hotel_bookings_customer_update_v2 ON public.hotel_bookings FOR UPDATE TO authenticated USING ((user_id = ( SELECT p.user_id
   FROM public.profiles p
  WHERE ((p.auth_id = (auth.uid())::text) AND (p.role = 'user'::text))
 LIMIT 1))) WITH CHECK ((user_id = ( SELECT p.user_id
   FROM public.profiles p
  WHERE ((p.auth_id = (auth.uid())::text) AND (p.role = 'user'::text))
 LIMIT 1)));


--
-- Name: hotel_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hotel_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: hotel_reviews hotel_reviews_public_read_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hotel_reviews_public_read_canonical ON public.hotel_reviews FOR SELECT TO authenticated, anon USING (true);


--
-- Name: hotel_reviews hotel_reviews_user_insert_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hotel_reviews_user_insert_canonical ON public.hotel_reviews FOR INSERT TO authenticated WITH CHECK (((user_id = public.current_profile_user_id()) AND (public.current_profile_role() = 'user'::text)));


--
-- Name: hotel_rooms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hotel_rooms ENABLE ROW LEVEL SECURITY;

--
-- Name: hotel_rooms hotel_rooms_canonical_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hotel_rooms_canonical_select ON public.hotel_rooms FOR SELECT TO authenticated, anon USING ((EXISTS ( SELECT 1
   FROM public.hotels h
  WHERE ((h.hotel_id = hotel_rooms.hotel_id) AND ((h.status = 'active'::text) OR (h.owner_id = ( SELECT p.user_id
           FROM public.profiles p
          WHERE (p.auth_id = (auth.uid())::text)
         LIMIT 1)) OR (EXISTS ( SELECT 1
           FROM public.profiles actor
          WHERE ((actor.auth_id = (auth.uid())::text) AND (actor.role = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text])) AND (COALESCE(actor.deleted, false) = false) AND (COALESCE(actor.suspended, false) = false) AND (COALESCE(actor.banned, false) = false)))))))));


--
-- Name: hotel_rooms hotel_rooms_internal_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hotel_rooms_internal_delete ON public.hotel_rooms FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles actor
  WHERE ((actor.auth_id = (auth.uid())::text) AND (actor.role = ANY (ARRAY['admin'::text, 'creator'::text])) AND (COALESCE(actor.deleted, false) = false) AND (COALESCE(actor.suspended, false) = false) AND (COALESCE(actor.banned, false) = false)))));


--
-- Name: hotel_rooms hotel_rooms_internal_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hotel_rooms_internal_insert ON public.hotel_rooms FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles actor
  WHERE ((actor.auth_id = (auth.uid())::text) AND (actor.role = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text])) AND (COALESCE(actor.deleted, false) = false) AND (COALESCE(actor.suspended, false) = false) AND (COALESCE(actor.banned, false) = false)))));


--
-- Name: hotel_rooms hotel_rooms_internal_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hotel_rooms_internal_update ON public.hotel_rooms FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles actor
  WHERE ((actor.auth_id = (auth.uid())::text) AND (actor.role = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text])) AND (COALESCE(actor.deleted, false) = false) AND (COALESCE(actor.suspended, false) = false) AND (COALESCE(actor.banned, false) = false))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles actor
  WHERE ((actor.auth_id = (auth.uid())::text) AND (actor.role = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text])) AND (COALESCE(actor.deleted, false) = false) AND (COALESCE(actor.suspended, false) = false) AND (COALESCE(actor.banned, false) = false)))));


--
-- Name: hotels; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hotels ENABLE ROW LEVEL SECURITY;

--
-- Name: hotels hotels_canonical_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hotels_canonical_select ON public.hotels FOR SELECT TO authenticated, anon USING (((status = 'active'::text) OR (owner_id = ( SELECT p.user_id
   FROM public.profiles p
  WHERE (p.auth_id = (auth.uid())::text)
 LIMIT 1)) OR (EXISTS ( SELECT 1
   FROM public.profiles actor
  WHERE ((actor.auth_id = (auth.uid())::text) AND (actor.role = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text])) AND (COALESCE(actor.deleted, false) = false) AND (COALESCE(actor.suspended, false) = false) AND (COALESCE(actor.banned, false) = false))))));


--
-- Name: hotels hotels_internal_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hotels_internal_delete ON public.hotels FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles actor
  WHERE ((actor.auth_id = (auth.uid())::text) AND (actor.role = ANY (ARRAY['admin'::text, 'creator'::text])) AND (COALESCE(actor.deleted, false) = false) AND (COALESCE(actor.suspended, false) = false) AND (COALESCE(actor.banned, false) = false)))));


--
-- Name: hotels hotels_internal_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hotels_internal_insert ON public.hotels FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles actor
  WHERE ((actor.auth_id = (auth.uid())::text) AND (actor.role = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text])) AND (COALESCE(actor.deleted, false) = false) AND (COALESCE(actor.suspended, false) = false) AND (COALESCE(actor.banned, false) = false)))));


--
-- Name: hotels hotels_internal_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hotels_internal_update ON public.hotels FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles actor
  WHERE ((actor.auth_id = (auth.uid())::text) AND (actor.role = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text])) AND (COALESCE(actor.deleted, false) = false) AND (COALESCE(actor.suspended, false) = false) AND (COALESCE(actor.banned, false) = false))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles actor
  WHERE ((actor.auth_id = (auth.uid())::text) AND (actor.role = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text])) AND (COALESCE(actor.deleted, false) = false) AND (COALESCE(actor.suspended, false) = false) AND (COALESCE(actor.banned, false) = false)))));


--
-- Name: inspection_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inspection_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: inspection_requests inspection_requests_read_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inspection_requests_read_canonical ON public.inspection_requests FOR SELECT TO authenticated USING (((owner_id = public.current_profile_user_id()) OR (public.current_profile_role() = 'creator'::text) OR ((public.current_profile_role() = ANY (ARRAY['admin'::text, 'staff'::text])) AND public.current_actor_in_scope(property_state, property_city))));


--
-- Name: inspection_status_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inspection_status_history ENABLE ROW LEVEL SECURITY;

--
-- Name: inspection_status_history inspection_status_history_read_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inspection_status_history_read_canonical ON public.inspection_status_history FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.inspection_requests ir
  WHERE ((ir.id = inspection_status_history.inspection_request_id) AND ((ir.owner_id = public.current_profile_user_id()) OR (public.current_profile_role() = 'creator'::text) OR ((public.current_profile_role() = ANY (ARRAY['admin'::text, 'staff'::text])) AND public.current_actor_in_scope(ir.property_state, ir.property_city)))))));


--
-- Name: listing_image_hashes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.listing_image_hashes ENABLE ROW LEVEL SECURITY;

--
-- Name: listing_image_hashes listing_image_hashes_internal_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY listing_image_hashes_internal_read ON public.listing_image_hashes FOR SELECT TO authenticated USING ((public.current_profile_role() = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text])));


--
-- Name: listing_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.listing_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: listing_reports listing_reports_insert_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY listing_reports_insert_canonical ON public.listing_reports FOR INSERT TO authenticated WITH CHECK ((reporter_id = public.current_profile_user_id()));


--
-- Name: listing_reports listing_reports_operational_update_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY listing_reports_operational_update_canonical ON public.listing_reports FOR UPDATE TO authenticated USING (((public.current_profile_role() = 'creator'::text) OR ((public.current_profile_role() = ANY (ARRAY['admin'::text, 'staff'::text])) AND (EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((((l.id)::text = listing_reports.listing_id) OR (l.listing_id = listing_reports.listing_id)) AND public.current_actor_in_scope(l.state, l.city))))))) WITH CHECK (((public.current_profile_role() = 'creator'::text) OR ((public.current_profile_role() = ANY (ARRAY['admin'::text, 'staff'::text])) AND (EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((((l.id)::text = listing_reports.listing_id) OR (l.listing_id = listing_reports.listing_id)) AND public.current_actor_in_scope(l.state, l.city)))))));


--
-- Name: listing_reports listing_reports_read_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY listing_reports_read_canonical ON public.listing_reports FOR SELECT TO authenticated USING (((reporter_id = public.current_profile_user_id()) OR (public.current_profile_role() = 'creator'::text) OR ((public.current_profile_role() = ANY (ARRAY['admin'::text, 'staff'::text])) AND (EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((((l.id)::text = listing_reports.listing_id) OR (l.listing_id = listing_reports.listing_id)) AND public.current_actor_in_scope(l.state, l.city)))))));


--
-- Name: listings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;

--
-- Name: listings listings_read_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY listings_read_canonical ON public.listings FOR SELECT TO authenticated USING (((deleted_at IS NULL) AND (((public.current_profile_role() = 'user'::text) AND (status = 'available'::text) AND (inspection_request_id IS NOT NULL) AND (approved_by IS NOT NULL) AND (approved_at IS NOT NULL)) OR (reserved_by = public.current_profile_user_id()) OR (owner_id = public.current_profile_user_id()) OR (public.current_profile_role() = 'creator'::text) OR ((public.current_profile_role() = ANY (ARRAY['admin'::text, 'staff'::text])) AND public.current_actor_in_scope(state, city)))));


--
-- Name: message_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.message_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: messages messages_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY messages_insert ON public.messages FOR INSERT TO authenticated WITH CHECK (((sender_id = ( SELECT profiles.user_id
   FROM public.profiles
  WHERE (profiles.auth_id = (auth.uid())::text)
 LIMIT 1)) AND public._can_access_conversation(conversation_id)));


--
-- Name: messages messages_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY messages_select ON public.messages FOR SELECT TO authenticated USING (public._can_access_conversation(conversation_id));


--
-- Name: messages messages_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY messages_update ON public.messages FOR UPDATE TO authenticated USING (public._can_access_conversation(conversation_id));


--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications notifications_operational_insert_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_operational_insert_canonical ON public.notifications FOR INSERT TO authenticated WITH CHECK (((public.current_profile_role() = 'creator'::text) OR ((public.current_profile_role() = ANY (ARRAY['admin'::text, 'staff'::text])) AND public.can_current_actor_read_profile(recipient_id))));


--
-- Name: notifications notifications_owner_read_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_owner_read_canonical ON public.notifications FOR SELECT TO authenticated USING ((recipient_id = public.current_profile_user_id()));


--
-- Name: notifications notifications_owner_update_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_owner_update_canonical ON public.notifications FOR UPDATE TO authenticated USING ((recipient_id = public.current_profile_user_id())) WITH CHECK ((recipient_id = public.current_profile_user_id()));


--
-- Name: partner_support_conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.partner_support_conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: partner_support_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.partner_support_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_reversals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_reversals ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_reversals payment_reversals_read_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payment_reversals_read_canonical ON public.payment_reversals FOR SELECT TO authenticated USING (((public.current_profile_role() = 'creator'::text) OR ((public.current_profile_role() = 'admin'::text) AND (EXISTS ( SELECT 1
   FROM public.booking_payments bp
  WHERE ((bp.id = payment_reversals.original_payment_id) AND (public.can_current_actor_read_profile(bp.user_id) OR public.can_current_actor_read_profile(bp.payer_user_id) OR public.can_current_actor_read_profile(bp.payee_user_id) OR ((bp.listing_id IS NOT NULL) AND public.current_actor_can_access_listing_ref(bp.listing_id)))))))));


--
-- Name: payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_settings platform_settings_creator_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_settings_creator_delete ON public.platform_settings FOR DELETE TO authenticated USING (public.is_current_creator());


--
-- Name: platform_settings platform_settings_creator_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_settings_creator_insert ON public.platform_settings FOR INSERT TO authenticated WITH CHECK (public.is_current_creator());


--
-- Name: platform_settings platform_settings_creator_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_settings_creator_update ON public.platform_settings FOR UPDATE TO authenticated USING (public.is_current_creator()) WITH CHECK (public.is_current_creator());


--
-- Name: platform_settings platform_settings_read_safe; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_settings_read_safe ON public.platform_settings FOR SELECT TO authenticated, anon USING ((is_active = true));


--
-- Name: private_call_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.private_call_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: private_call_preferences private_call_preferences_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY private_call_preferences_select_own ON public.private_call_preferences FOR SELECT TO authenticated USING ((user_id = public.current_profile_user_id()));


--
-- Name: private_call_signals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.private_call_signals ENABLE ROW LEVEL SECURITY;

--
-- Name: private_call_signals private_call_signals_insert_participant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY private_call_signals_insert_participant ON public.private_call_signals FOR INSERT TO authenticated WITH CHECK (((sender_id = public.current_profile_user_id()) AND (EXISTS ( SELECT 1
   FROM public.private_calls c
  WHERE ((c.id = private_call_signals.call_id) AND ((public.current_profile_user_id() = c.caller_id) OR (public.current_profile_user_id() = c.callee_id)) AND (c.status = ANY (ARRAY['ringing'::text, 'accepted'::text])))))));


--
-- Name: private_call_signals private_call_signals_select_participant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY private_call_signals_select_participant ON public.private_call_signals FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.private_calls c
  WHERE ((c.id = private_call_signals.call_id) AND ((public.current_profile_user_id() = c.caller_id) OR (public.current_profile_user_id() = c.callee_id))))));


--
-- Name: private_calls; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.private_calls ENABLE ROW LEVEL SECURITY;

--
-- Name: private_calls private_calls_select_participant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY private_calls_select_participant ON public.private_calls FOR SELECT TO authenticated USING (((public.current_profile_user_id() = caller_id) OR (public.current_profile_user_id() = callee_id)));


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_read_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_read_canonical ON public.profiles FOR SELECT TO authenticated USING (((auth_id = (auth.uid())::text) OR (public.current_profile_role() = 'creator'::text)));


--
-- Name: profiles profiles_self_update_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_self_update_canonical ON public.profiles FOR UPDATE TO authenticated USING (((auth_id = (auth.uid())::text) AND (COALESCE(deleted, false) = false) AND (COALESCE(suspended, false) = false) AND (COALESCE(banned, false) = false))) WITH CHECK (((auth_id = (auth.uid())::text) AND (COALESCE(deleted, false) = false) AND (COALESCE(suspended, false) = false) AND (COALESCE(banned, false) = false)));


--
-- Name: property_partner_earning_releases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.property_partner_earning_releases ENABLE ROW LEVEL SECURITY;

--
-- Name: property_partner_earning_releases property_partner_earning_releases_self_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY property_partner_earning_releases_self_read ON public.property_partner_earning_releases FOR SELECT TO authenticated USING ((partner_id = ( SELECT profiles.user_id
   FROM public.profiles
  WHERE (profiles.auth_id = (auth.uid())::text)
 LIMIT 1)));


--
-- Name: property_partners; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.property_partners ENABLE ROW LEVEL SECURITY;

--
-- Name: property_partners property_partners_admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY property_partners_admin_update ON public.property_partners FOR UPDATE TO authenticated USING (((public.current_profile_role() = 'admin'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles target
  WHERE ((target.user_id = property_partners.profile_id) AND public.current_actor_in_scope(target.state, COALESCE(NULLIF(target.local_government, ''::text), target.city))))))) WITH CHECK (((public.current_profile_role() = 'admin'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles target
  WHERE ((target.user_id = property_partners.profile_id) AND public.current_actor_in_scope(target.state, COALESCE(NULLIF(target.local_government, ''::text), target.city)))))));


--
-- Name: property_partners property_partners_creator_update_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY property_partners_creator_update_canonical ON public.property_partners FOR UPDATE TO authenticated USING ((public.current_profile_role() = 'creator'::text)) WITH CHECK ((public.current_profile_role() = 'creator'::text));


--
-- Name: property_partners property_partners_internal_read_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY property_partners_internal_read_canonical ON public.property_partners FOR SELECT TO authenticated USING (((public.current_profile_role() = 'creator'::text) OR ((public.current_profile_role() = ANY (ARRAY['admin'::text, 'staff'::text])) AND (EXISTS ( SELECT 1
   FROM public.profiles target
  WHERE ((target.user_id = property_partners.profile_id) AND public.current_actor_in_scope(target.state, COALESCE(target.local_government, target.city))))))));


--
-- Name: property_partners property_partners_owner_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY property_partners_owner_insert ON public.property_partners FOR INSERT TO authenticated WITH CHECK (((profile_id = public.current_profile_user_id()) AND (public.current_profile_role() = 'property_partner'::text)));


--
-- Name: property_partners property_partners_owner_read_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY property_partners_owner_read_canonical ON public.property_partners FOR SELECT TO authenticated USING ((profile_id = public.current_profile_user_id()));


--
-- Name: property_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.property_types ENABLE ROW LEVEL SECURITY;

--
-- Name: property_types property_types_creator_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY property_types_creator_write ON public.property_types TO authenticated USING (public.is_current_creator()) WITH CHECK (public.is_current_creator());


--
-- Name: property_types property_types_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY property_types_read ON public.property_types FOR SELECT TO authenticated, anon USING (true);


--
-- Name: registered_institutions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.registered_institutions ENABLE ROW LEVEL SECURITY;

--
-- Name: registered_institutions registered_institutions_read_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY registered_institutions_read_active ON public.registered_institutions FOR SELECT TO authenticated USING ((is_active = true));


--
-- Name: rent_plan_cancellations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rent_plan_cancellations ENABLE ROW LEVEL SECURITY;

--
-- Name: rent_plan_contributions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rent_plan_contributions ENABLE ROW LEVEL SECURITY;

--
-- Name: rent_plan_contributions rent_plan_contributions_read_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rent_plan_contributions_read_canonical ON public.rent_plan_contributions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.rent_plans rp
  WHERE ((rp.id = rent_plan_contributions.rent_plan_id) AND ((rp.user_id = public.current_profile_user_id()) OR ((public.current_profile_role() = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text])) AND public.current_actor_can_access_listing_ref((rp.listing_id)::text)))))));


--
-- Name: rent_plans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rent_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: rent_plans rent_plans_read_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rent_plans_read_canonical ON public.rent_plans FOR SELECT TO authenticated USING (((user_id = public.current_profile_user_id()) OR ((public.current_profile_role() = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text])) AND public.current_actor_can_access_listing_ref((listing_id)::text))));


--
-- Name: reservation_refunds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reservation_refunds ENABLE ROW LEVEL SECURITY;

--
-- Name: reservation_refunds reservation_refunds_read_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reservation_refunds_read_canonical ON public.reservation_refunds FOR SELECT TO authenticated USING (((user_id = public.current_profile_user_id()) OR ((public.current_profile_role() = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text])) AND public.current_actor_can_access_reservation(reservation_id))));


--
-- Name: reservations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;

--
-- Name: reservations reservations_read_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reservations_read_canonical ON public.reservations FOR SELECT TO authenticated USING (((user_id = public.current_profile_user_id()) OR ((public.current_profile_role() = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text])) AND public.current_actor_can_access_listing_ref(listing_id))));


--
-- Name: reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: role_change_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.role_change_history ENABLE ROW LEVEL SECURITY;

--
-- Name: role_change_history role_change_history_read_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY role_change_history_read_canonical ON public.role_change_history FOR SELECT TO authenticated USING (((public.current_profile_role() = 'creator'::text) OR ((public.current_profile_role() = 'admin'::text) AND public.can_current_actor_read_profile(user_id))));


--
-- Name: roommate_matches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.roommate_matches ENABLE ROW LEVEL SECURITY;

--
-- Name: roommate_matches roommate_matches_participant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roommate_matches_participant_read ON public.roommate_matches FOR SELECT TO authenticated USING (((user_a_id = public.current_profile_user_id()) OR (user_b_id = public.current_profile_user_id())));


--
-- Name: roommate_matches roommate_matches_participant_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roommate_matches_participant_update ON public.roommate_matches FOR UPDATE TO authenticated USING (((user_a_id = public.current_profile_user_id()) OR (user_b_id = public.current_profile_user_id()))) WITH CHECK (((user_a_id = public.current_profile_user_id()) OR (user_b_id = public.current_profile_user_id())));


--
-- Name: roommate_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.roommate_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: roommate_preferences roommate_preferences_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roommate_preferences_self ON public.roommate_preferences TO authenticated USING ((auth_id = (auth.uid())::text)) WITH CHECK ((auth_id = (auth.uid())::text));


--
-- Name: roommate_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.roommate_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: roommate_profiles roommate_profiles_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roommate_profiles_owner ON public.roommate_profiles TO authenticated USING (((user_id)::text = (auth.uid())::text));


--
-- Name: roommate_search_results roommate_results_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roommate_results_self ON public.roommate_search_results TO authenticated USING ((searcher_id = ( SELECT p.user_id
   FROM public.profiles p
  WHERE (p.auth_id = (auth.uid())::text)
 LIMIT 1))) WITH CHECK ((searcher_id = ( SELECT p.user_id
   FROM public.profiles p
  WHERE (p.auth_id = (auth.uid())::text)
 LIMIT 1)));


--
-- Name: roommate_search_results; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.roommate_search_results ENABLE ROW LEVEL SECURITY;

--
-- Name: saved_listings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.saved_listings ENABLE ROW LEVEL SECURITY;

--
-- Name: saved_listings saved_listings_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY saved_listings_delete ON public.saved_listings FOR DELETE TO authenticated USING ((user_id = ( SELECT p.user_id
   FROM public.profiles p
  WHERE ((p.auth_id = (auth.uid())::text) AND (COALESCE(p.deleted, false) = false) AND (COALESCE(p.suspended, false) = false) AND (COALESCE(p.banned, false) = false))
 LIMIT 1)));


--
-- Name: saved_listings saved_listings_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY saved_listings_insert ON public.saved_listings FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT p.user_id
   FROM public.profiles p
  WHERE ((p.auth_id = (auth.uid())::text) AND (COALESCE(p.deleted, false) = false) AND (COALESCE(p.suspended, false) = false) AND (COALESCE(p.banned, false) = false))
 LIMIT 1)) AND (EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = saved_listings.listing_id) AND (l.deleted_at IS NULL) AND (l.status = 'available'::text))))));


--
-- Name: saved_listings saved_listings_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY saved_listings_select ON public.saved_listings FOR SELECT TO authenticated USING ((user_id = ( SELECT p.user_id
   FROM public.profiles p
  WHERE ((p.auth_id = (auth.uid())::text) AND (COALESCE(p.deleted, false) = false) AND (COALESCE(p.suspended, false) = false) AND (COALESCE(p.banned, false) = false))
 LIMIT 1)));


--
-- Name: secrets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.secrets ENABLE ROW LEVEL SECURITY;

--
-- Name: secrets secrets_creator_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY secrets_creator_only ON public.secrets TO authenticated USING (public.is_current_creator()) WITH CHECK (public.is_current_creator());


--
-- Name: service_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: service_categories service_categories_creator_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_categories_creator_write ON public.service_categories TO authenticated USING (public.is_current_creator()) WITH CHECK (public.is_current_creator());


--
-- Name: service_categories service_categories_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_categories_read ON public.service_categories FOR SELECT TO authenticated, anon USING (true);


--
-- Name: service_subcategories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_subcategories ENABLE ROW LEVEL SECURITY;

--
-- Name: service_subcategories service_subcategories_creator_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_subcategories_creator_write ON public.service_subcategories TO authenticated USING (public.is_current_creator()) WITH CHECK (public.is_current_creator());


--
-- Name: service_subcategories service_subcategories_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_subcategories_read ON public.service_subcategories FOR SELECT TO authenticated, anon USING (true);


--
-- Name: staff_location_presence; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.staff_location_presence ENABLE ROW LEVEL SECURITY;

--
-- Name: staff_location_presence staff_location_self_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_location_self_read ON public.staff_location_presence FOR SELECT TO authenticated USING ((staff_id = ( SELECT profiles.user_id
   FROM public.profiles
  WHERE (profiles.auth_id = (auth.uid())::text)
 LIMIT 1)));


--
-- Name: staff_location_presence staff_location_self_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_location_self_write ON public.staff_location_presence TO authenticated USING ((staff_id = ( SELECT profiles.user_id
   FROM public.profiles
  WHERE (profiles.auth_id = (auth.uid())::text)
 LIMIT 1))) WITH CHECK ((staff_id = ( SELECT profiles.user_id
   FROM public.profiles
  WHERE (profiles.auth_id = (auth.uid())::text)
 LIMIT 1)));


--
-- Name: staff_permissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.staff_permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: staff_permissions staff_permissions_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_permissions_admin_read ON public.staff_permissions FOR SELECT TO authenticated USING (((public.current_profile_role() = 'creator'::text) OR ((public.current_profile_role() = 'admin'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles staff_profile
  WHERE ((staff_profile.user_id = staff_permissions.staff_id) AND (staff_profile.role = 'staff'::text) AND public.current_actor_in_scope(staff_profile.assigned_state, staff_profile.assigned_lga)))))));


--
-- Name: staff_permissions staff_permissions_self_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_permissions_self_read ON public.staff_permissions FOR SELECT TO authenticated USING ((staff_id = ( SELECT p.user_id
   FROM public.profiles p
  WHERE (p.auth_id = (auth.uid())::text)
 LIMIT 1)));


--
-- Name: staff_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.staff_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: staff_reviews staff_reviews_owner_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_reviews_owner_insert ON public.staff_reviews FOR INSERT TO authenticated WITH CHECK ((reviewer_id = public.current_profile_user_id()));


--
-- Name: staff_reviews staff_reviews_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_reviews_public_read ON public.staff_reviews FOR SELECT TO authenticated, anon USING (true);


--
-- Name: staff_trust_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.staff_trust_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: staff_trust_profiles staff_trust_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_trust_select ON public.staff_trust_profiles FOR SELECT TO authenticated USING (((staff_id = ( SELECT p.user_id
   FROM public.profiles p
  WHERE (p.auth_id = (auth.uid())::text)
 LIMIT 1)) OR (EXISTS ( SELECT 1
   FROM public.profiles actor
  WHERE ((actor.auth_id = (auth.uid())::text) AND (actor.role = 'creator'::text) AND (COALESCE(actor.deleted, false) = false) AND (COALESCE(actor.suspended, false) = false) AND (COALESCE(actor.banned, false) = false)))) OR (EXISTS ( SELECT 1
   FROM (public.profiles actor
     JOIN public.profiles target ON ((target.user_id = staff_trust_profiles.staff_id)))
  WHERE ((actor.auth_id = (auth.uid())::text) AND (actor.role = 'admin'::text) AND (COALESCE(actor.deleted, false) = false) AND (COALESCE(actor.suspended, false) = false) AND (COALESCE(actor.banned, false) = false) AND (NOT (actor.assigned_state IS DISTINCT FROM target.assigned_state)) AND (NOT (actor.assigned_lga IS DISTINCT FROM target.assigned_lga)))))));


--
-- Name: partner_support_conversations support_conversation_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY support_conversation_read ON public.partner_support_conversations FOR SELECT TO authenticated USING (private.can_access_support_conversation(id));


--
-- Name: partner_support_messages support_message_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY support_message_read ON public.partner_support_messages FOR SELECT TO authenticated USING (private.can_access_support_conversation(conversation_id));


--
-- Name: system_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: user_activity; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_activity ENABLE ROW LEVEL SECURITY;

--
-- Name: user_activity user_activity_insert_own_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_activity_insert_own_canonical ON public.user_activity FOR INSERT TO authenticated WITH CHECK (((user_id = public.current_profile_user_id()) AND (auth_id = (auth.uid())::text)));


--
-- Name: user_activity user_activity_read_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_activity_read_canonical ON public.user_activity FOR SELECT TO authenticated USING (public.can_current_actor_read_profile(user_id));


--
-- Name: user_counters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_counters ENABLE ROW LEVEL SECURITY;

--
-- Name: user_counters user_counters_creator; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_counters_creator ON public.user_counters TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.user_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['creator'::text]))))));


--
-- Name: blocked_workers user_create_block; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_create_block ON public.blocked_workers FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: user_id_counter; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_id_counter ENABLE ROW LEVEL SECURITY;

--
-- Name: user_id_counter user_id_counter_creator; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_id_counter_creator ON public.user_id_counter TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.user_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['creator'::text]))))));


--
-- Name: user_ids; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_ids ENABLE ROW LEVEL SECURITY;

--
-- Name: user_ids user_ids_creator; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_ids_creator ON public.user_ids TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.user_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['creator'::text]))))));


--
-- Name: user_inspection_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_inspection_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: user_inspection_requests user_inspection_requests_read_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_inspection_requests_read_canonical ON public.user_inspection_requests FOR SELECT TO authenticated USING (((user_id = public.current_profile_user_id()) OR (field_officer_id = public.current_profile_user_id()) OR ((public.current_profile_role() = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text])) AND public.current_actor_can_access_listing_ref(listing_id))));


--
-- Name: user_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: user_sessions user_sessions_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_sessions_admin_read ON public.user_sessions FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles actor
  WHERE ((actor.auth_id = (auth.uid())::text) AND (actor.role = ANY (ARRAY['admin'::text, 'creator'::text])) AND (NOT COALESCE(actor.deleted, false)) AND (NOT COALESCE(actor.suspended, false)) AND (NOT COALESCE(actor.banned, false)) AND ((actor.role = 'creator'::text) OR public.can_current_actor_read_profile(user_sessions.user_id))))));


--
-- Name: user_sessions user_sessions_owner_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_sessions_owner_insert ON public.user_sessions FOR INSERT TO authenticated WITH CHECK (((auth_id = (auth.uid())::text) AND (user_id = public.current_profile_user_id())));


--
-- Name: user_sessions user_sessions_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_sessions_owner_read ON public.user_sessions FOR SELECT TO authenticated USING (((auth_id = (auth.uid())::text) AND (user_id = public.current_profile_user_id())));


--
-- Name: user_sessions user_sessions_owner_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_sessions_owner_update ON public.user_sessions FOR UPDATE TO authenticated USING (((auth_id = (auth.uid())::text) AND (user_id = public.current_profile_user_id()))) WITH CHECK (((auth_id = (auth.uid())::text) AND (user_id = public.current_profile_user_id())));


--
-- Name: rent_plan_cancellations users_own_cancellations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_own_cancellations ON public.rent_plan_cancellations FOR SELECT USING (((auth.uid())::text = user_id));


--
-- Name: verified_paystack_references; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.verified_paystack_references ENABLE ROW LEVEL SECURITY;

--
-- Name: wallet_balances; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wallet_balances ENABLE ROW LEVEL SECURITY;

--
-- Name: wallet_transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: wallets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

--
-- Name: wallets wallets_read_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wallets_read_canonical ON public.wallets FOR SELECT TO authenticated USING (((owner_id = public.current_profile_user_id()) OR (public.current_profile_role() = 'creator'::text) OR ((public.current_profile_role() = 'admin'::text) AND public.can_current_actor_read_profile(owner_id))));


--
-- Name: withdrawal_requests wda_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wda_owner ON public.withdrawal_requests FOR SELECT USING (((user_id = ( SELECT profiles.user_id
   FROM public.profiles
  WHERE (profiles.auth_id = (auth.uid())::text)
 LIMIT 1)) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text])))))));


--
-- Name: withdrawal_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: withdrawals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;

--
-- Name: withdrawals withdrawals_read_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY withdrawals_read_canonical ON public.withdrawals FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.wallets w
  WHERE ((w.id = withdrawals.wallet_id) AND ((w.owner_id = public.current_profile_user_id()) OR (public.current_profile_role() = 'creator'::text) OR ((public.current_profile_role() = 'admin'::text) AND public.can_current_actor_read_profile(w.owner_id)))))));


--
-- Name: worker_bookings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.worker_bookings ENABLE ROW LEVEL SECURITY;

--
-- Name: worker_bookings worker_bookings_read_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY worker_bookings_read_canonical ON public.worker_bookings FOR SELECT TO authenticated USING (((user_id = public.current_profile_user_id()) OR (worker_id = public.current_profile_user_id()) OR ((public.current_profile_role() = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text])) AND public.current_actor_can_access_worker_booking(id))));


--
-- Name: worker_service_coverage worker_coverage_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY worker_coverage_owner_read ON public.worker_service_coverage FOR SELECT TO authenticated USING ((worker_id = ( SELECT p.user_id
   FROM public.profiles p
  WHERE (p.auth_id = (auth.uid())::text)
 LIMIT 1)));


--
-- Name: worker_service_coverage worker_coverage_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY worker_coverage_public_read ON public.worker_service_coverage FOR SELECT TO authenticated, anon USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = worker_service_coverage.worker_id) AND (p.worker_status = 'verified'::text) AND (p.deleted = false) AND (p.suspended = false) AND (p.banned = false)))));


--
-- Name: worker_identity_checks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.worker_identity_checks ENABLE ROW LEVEL SECURITY;

--
-- Name: worker_verification_reviews worker_reviews_worker_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY worker_reviews_worker_read ON public.worker_verification_reviews FOR SELECT TO authenticated USING ((worker_id = public.current_profile_user_id()));


--
-- Name: worker_service_coverage; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.worker_service_coverage ENABLE ROW LEVEL SECURITY;

--
-- Name: worker_services; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.worker_services ENABLE ROW LEVEL SECURITY;

--
-- Name: worker_services worker_services_owner_delete_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY worker_services_owner_delete_canonical ON public.worker_services FOR DELETE TO authenticated USING (((worker_id = public.current_profile_user_id()) AND (public.current_profile_role() = 'worker'::text)));


--
-- Name: worker_services worker_services_owner_insert_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY worker_services_owner_insert_canonical ON public.worker_services FOR INSERT TO authenticated WITH CHECK (((worker_id = public.current_profile_user_id()) AND (public.current_profile_role() = 'worker'::text)));


--
-- Name: worker_services worker_services_owner_read_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY worker_services_owner_read_canonical ON public.worker_services FOR SELECT TO authenticated USING (((worker_id = public.current_profile_user_id()) AND (public.current_profile_role() = 'worker'::text)));


--
-- Name: worker_services worker_services_owner_update_canonical; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY worker_services_owner_update_canonical ON public.worker_services FOR UPDATE TO authenticated USING (((worker_id = public.current_profile_user_id()) AND (public.current_profile_role() = 'worker'::text))) WITH CHECK (((worker_id = public.current_profile_user_id()) AND (public.current_profile_role() = 'worker'::text)));


--
-- Name: worker_services worker_services_verified_public_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY worker_services_verified_public_select ON public.worker_services FOR SELECT TO authenticated, anon USING ((EXISTS ( SELECT 1
   FROM public.profiles w
  WHERE ((w.user_id = worker_services.worker_id) AND (w.role = 'worker'::text) AND (w.worker_status = 'verified'::text) AND (COALESCE(w.worker_verified, false) = true) AND (COALESCE(w.available, false) = true) AND (COALESCE(w.deleted, false) = false) AND (COALESCE(w.suspended, false) = false) AND (COALESCE(w.banned, false) = false)))));


--
-- Name: worker_showcase_posts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.worker_showcase_posts ENABLE ROW LEVEL SECURITY;

--
-- Name: worker_showcase_posts worker_showcase_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY worker_showcase_select ON public.worker_showcase_posts FOR SELECT TO authenticated USING (((deleted_at IS NULL) AND ((worker_id = ( SELECT p.user_id
   FROM public.profiles p
  WHERE (p.auth_id = (auth.uid())::text)
 LIMIT 1)) OR (((kind = 'portfolio'::text) OR (expires_at > now())) AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = worker_showcase_posts.worker_id) AND (p.role = 'worker'::text) AND (p.worker_status = 'verified'::text) AND (COALESCE(p.worker_verified, false) = true) AND (COALESCE(p.deleted, false) = false) AND (COALESCE(p.suspended, false) = false) AND (COALESCE(p.banned, false) = false))))))));


--
-- Name: worker_test_attempts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.worker_test_attempts ENABLE ROW LEVEL SECURITY;

--
-- Name: worker_test_attempts worker_test_attempts_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY worker_test_attempts_select_own ON public.worker_test_attempts FOR SELECT TO authenticated USING ((worker_id = ( SELECT p.user_id
   FROM public.profiles p
  WHERE (p.auth_id = (auth.uid())::text)
 LIMIT 1)));


--
-- Name: worker_test_questions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.worker_test_questions ENABLE ROW LEVEL SECURITY;

--
-- Name: worker_verifications worker_verification_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY worker_verification_owner_read ON public.worker_verifications FOR SELECT TO authenticated USING ((worker_id = public.current_profile_user_id()));


--
-- Name: worker_verification_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.worker_verification_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: worker_verifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.worker_verifications ENABLE ROW LEVEL SECURITY;

--
-- Name: workers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workers ENABLE ROW LEVEL SECURITY;

--
-- Name: wallet_transactions wtx_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wtx_owner ON public.wallet_transactions FOR SELECT USING (((user_id = ( SELECT profiles.user_id
   FROM public.profiles
  WHERE (profiles.auth_id = (auth.uid())::text)
 LIMIT 1)) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text])))))));


--
-- Name: SCHEMA private; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA private TO authenticated;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION can_access_support_conversation(p_conversation_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.can_access_support_conversation(p_conversation_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.can_access_support_conversation(p_conversation_id uuid) TO authenticated;


--
-- Name: FUNCTION can_access_support_object(p_name text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.can_access_support_object(p_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.can_access_support_object(p_name text) TO authenticated;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;


--
-- Name: FUNCTION _admin_dashboard_actor(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._admin_dashboard_actor() FROM PUBLIC;
GRANT ALL ON FUNCTION public._admin_dashboard_actor() TO service_role;


--
-- Name: FUNCTION _assert_admin_lga_scope(p_target_user_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._assert_admin_lga_scope(p_target_user_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public._assert_admin_lga_scope(p_target_user_id text) TO service_role;


--
-- Name: FUNCTION _can_access_conversation(p_conversation_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._can_access_conversation(p_conversation_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public._can_access_conversation(p_conversation_id uuid) TO service_role;


--
-- Name: FUNCTION _conversation_route_allowed(p_conversation_id uuid, p_actor_user_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._conversation_route_allowed(p_conversation_id uuid, p_actor_user_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public._conversation_route_allowed(p_conversation_id uuid, p_actor_user_id text) TO service_role;


--
-- Name: FUNCTION _current_comm_actor(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._current_comm_actor() FROM PUBLIC;
GRANT ALL ON FUNCTION public._current_comm_actor() TO service_role;


--
-- Name: FUNCTION _guard_worker_profile_state(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public._guard_worker_profile_state() TO anon;
GRANT ALL ON FUNCTION public._guard_worker_profile_state() TO authenticated;
GRANT ALL ON FUNCTION public._guard_worker_profile_state() TO service_role;


--
-- Name: FUNCTION _sync_conversation_after_message(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._sync_conversation_after_message() FROM PUBLIC;
GRANT ALL ON FUNCTION public._sync_conversation_after_message() TO service_role;


--
-- Name: FUNCTION accept_current_legal(p_document text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.accept_current_legal(p_document text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.accept_current_legal(p_document text) TO authenticated;
GRANT ALL ON FUNCTION public.accept_current_legal(p_document text) TO service_role;


--
-- Name: TABLE reservations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.reservations TO anon;
GRANT ALL ON TABLE public.reservations TO authenticated;
GRANT ALL ON TABLE public.reservations TO service_role;


--
-- Name: FUNCTION activate_apartment_tenancy(p_reservation_id text, p_start_date date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.activate_apartment_tenancy(p_reservation_id text, p_start_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.activate_apartment_tenancy(p_reservation_id text, p_start_date date) TO authenticated;
GRANT ALL ON FUNCTION public.activate_apartment_tenancy(p_reservation_id text, p_start_date date) TO service_role;


--
-- Name: FUNCTION activate_short_stay(p_reservation_id text, p_actual_check_in date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.activate_short_stay(p_reservation_id text, p_actual_check_in date) TO anon;
GRANT ALL ON FUNCTION public.activate_short_stay(p_reservation_id text, p_actual_check_in date) TO authenticated;
GRANT ALL ON FUNCTION public.activate_short_stay(p_reservation_id text, p_actual_check_in date) TO service_role;


--
-- Name: FUNCTION add_conversation_action(p_conversation_id uuid, p_action_type text, p_content text, p_metadata jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.add_conversation_action(p_conversation_id uuid, p_action_type text, p_content text, p_metadata jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.add_conversation_action(p_conversation_id uuid, p_action_type text, p_content text, p_metadata jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.add_conversation_action(p_conversation_id uuid, p_action_type text, p_content text, p_metadata jsonb) TO service_role;


--
-- Name: FUNCTION admin_appoint_staff(p_target_user_id text, p_module text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_appoint_staff(p_target_user_id text, p_module text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_appoint_staff(p_target_user_id text, p_module text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_appoint_staff(p_target_user_id text, p_module text) TO service_role;


--
-- Name: FUNCTION admin_assign_field_officer(p_inspection_id uuid, p_field_officer_id text, p_scheduled_date date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_assign_field_officer(p_inspection_id uuid, p_field_officer_id text, p_scheduled_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_assign_field_officer(p_inspection_id uuid, p_field_officer_id text, p_scheduled_date date) TO authenticated;
GRANT ALL ON FUNCTION public.admin_assign_field_officer(p_inspection_id uuid, p_field_officer_id text, p_scheduled_date date) TO service_role;


--
-- Name: FUNCTION admin_ban_user(p_target_user_id text, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_ban_user(p_target_user_id text, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_ban_user(p_target_user_id text, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_ban_user(p_target_user_id text, p_reason text) TO service_role;


--
-- Name: FUNCTION admin_count_branch_announcement_recipients(p_target_roles text[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_count_branch_announcement_recipients(p_target_roles text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_count_branch_announcement_recipients(p_target_roles text[]) TO authenticated;
GRANT ALL ON FUNCTION public.admin_count_branch_announcement_recipients(p_target_roles text[]) TO service_role;


--
-- Name: FUNCTION admin_create_hotel_from_inspection(p_inspection_id uuid, p_name text, p_description text, p_images text[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_create_hotel_from_inspection(p_inspection_id uuid, p_name text, p_description text, p_images text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_create_hotel_from_inspection(p_inspection_id uuid, p_name text, p_description text, p_images text[]) TO authenticated;
GRANT ALL ON FUNCTION public.admin_create_hotel_from_inspection(p_inspection_id uuid, p_name text, p_description text, p_images text[]) TO service_role;


--
-- Name: FUNCTION admin_get_all_users(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_get_all_users() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_get_all_users() TO authenticated;
GRANT ALL ON FUNCTION public.admin_get_all_users() TO service_role;


--
-- Name: FUNCTION admin_get_all_workers(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_get_all_workers() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_get_all_workers() TO authenticated;
GRANT ALL ON FUNCTION public.admin_get_all_workers() TO service_role;


--
-- Name: FUNCTION admin_get_field_officers(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_get_field_officers() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_get_field_officers() TO authenticated;
GRANT ALL ON FUNCTION public.admin_get_field_officers() TO service_role;


--
-- Name: FUNCTION admin_get_field_officers_for_inspection(p_inspection_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_get_field_officers_for_inspection(p_inspection_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_get_field_officers_for_inspection(p_inspection_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.admin_get_field_officers_for_inspection(p_inspection_id uuid) TO service_role;


--
-- Name: FUNCTION admin_get_my_branch_listings(p_status text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_get_my_branch_listings(p_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_get_my_branch_listings(p_status text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_get_my_branch_listings(p_status text) TO service_role;


--
-- Name: FUNCTION admin_get_my_branch_profiles(p_role text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_get_my_branch_profiles(p_role text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_get_my_branch_profiles(p_role text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_get_my_branch_profiles(p_role text) TO service_role;


--
-- Name: FUNCTION admin_get_my_branch_reports(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_get_my_branch_reports() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_get_my_branch_reports() TO authenticated;
GRANT ALL ON FUNCTION public.admin_get_my_branch_reports() TO service_role;


--
-- Name: FUNCTION admin_get_my_branch_stats(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_get_my_branch_stats() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_get_my_branch_stats() TO authenticated;
GRANT ALL ON FUNCTION public.admin_get_my_branch_stats() TO service_role;


--
-- Name: FUNCTION admin_get_my_branch_worker_booking_summaries(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_get_my_branch_worker_booking_summaries() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_get_my_branch_worker_booking_summaries() TO authenticated;
GRANT ALL ON FUNCTION public.admin_get_my_branch_worker_booking_summaries() TO service_role;


--
-- Name: FUNCTION admin_get_my_branch_worker_bookings(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_get_my_branch_worker_bookings() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_get_my_branch_worker_bookings() TO authenticated;
GRANT ALL ON FUNCTION public.admin_get_my_branch_worker_bookings() TO service_role;


--
-- Name: FUNCTION admin_get_partner_inspections(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_get_partner_inspections() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_get_partner_inspections() TO authenticated;
GRANT ALL ON FUNCTION public.admin_get_partner_inspections() TO service_role;


--
-- Name: FUNCTION admin_get_user_count(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_get_user_count() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_get_user_count() TO authenticated;
GRANT ALL ON FUNCTION public.admin_get_user_count() TO service_role;


--
-- Name: TABLE user_inspection_requests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_inspection_requests TO anon;
GRANT ALL ON TABLE public.user_inspection_requests TO authenticated;
GRANT ALL ON TABLE public.user_inspection_requests TO service_role;


--
-- Name: FUNCTION admin_get_user_inspections(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_get_user_inspections() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_get_user_inspections() TO authenticated;
GRANT ALL ON FUNCTION public.admin_get_user_inspections() TO service_role;


--
-- Name: TABLE inspection_requests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.inspection_requests TO anon;
GRANT ALL ON TABLE public.inspection_requests TO authenticated;
GRANT ALL ON TABLE public.inspection_requests TO service_role;


--
-- Name: FUNCTION admin_get_user_inspections(p_user_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_get_user_inspections(p_user_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_get_user_inspections(p_user_id text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_get_user_inspections(p_user_id text) TO service_role;


--
-- Name: FUNCTION admin_get_worker_review_identity_status(p_worker_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_get_worker_review_identity_status(p_worker_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_get_worker_review_identity_status(p_worker_id text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_get_worker_review_identity_status(p_worker_id text) TO service_role;


--
-- Name: FUNCTION admin_get_worker_review_trust_status(p_worker_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_get_worker_review_trust_status(p_worker_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_get_worker_review_trust_status(p_worker_id text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_get_worker_review_trust_status(p_worker_id text) TO service_role;


--
-- Name: FUNCTION admin_promote_to_staff(p_target_user_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_promote_to_staff(p_target_user_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_promote_to_staff(p_target_user_id text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_promote_to_staff(p_target_user_id text) TO service_role;


--
-- Name: FUNCTION admin_publish_inspected_hotel(p_hotel_id integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_publish_inspected_hotel(p_hotel_id integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_publish_inspected_hotel(p_hotel_id integer) TO authenticated;
GRANT ALL ON FUNCTION public.admin_publish_inspected_hotel(p_hotel_id integer) TO service_role;


--
-- Name: FUNCTION admin_publish_inspected_listing(p_listing_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_publish_inspected_listing(p_listing_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_publish_inspected_listing(p_listing_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.admin_publish_inspected_listing(p_listing_id uuid) TO service_role;


--
-- Name: FUNCTION admin_reactivate_user(p_target_user_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_reactivate_user(p_target_user_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_reactivate_user(p_target_user_id text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_reactivate_user(p_target_user_id text) TO service_role;


--
-- Name: FUNCTION admin_resolve_my_branch_report(p_report_id text, p_action text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_resolve_my_branch_report(p_report_id text, p_action text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_resolve_my_branch_report(p_report_id text, p_action text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_resolve_my_branch_report(p_report_id text, p_action text) TO service_role;


--
-- Name: FUNCTION admin_review_my_branch_listing(p_listing_id uuid, p_decision text, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_review_my_branch_listing(p_listing_id uuid, p_decision text, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_review_my_branch_listing(p_listing_id uuid, p_decision text, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_review_my_branch_listing(p_listing_id uuid, p_decision text, p_reason text) TO service_role;


--
-- Name: FUNCTION admin_review_my_branch_worker(p_worker_id text, p_decision text, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_review_my_branch_worker(p_worker_id text, p_decision text, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_review_my_branch_worker(p_worker_id text, p_decision text, p_reason text) TO service_role;


--
-- Name: FUNCTION admin_send_branch_announcement(p_title text, p_content text, p_target_roles text[], p_recipient_ids text[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_send_branch_announcement(p_title text, p_content text, p_target_roles text[], p_recipient_ids text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_send_branch_announcement(p_title text, p_content text, p_target_roles text[], p_recipient_ids text[]) TO authenticated;
GRANT ALL ON FUNCTION public.admin_send_branch_announcement(p_title text, p_content text, p_target_roles text[], p_recipient_ids text[]) TO service_role;


--
-- Name: FUNCTION admin_suspend_user(p_target_user_id text, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_suspend_user(p_target_user_id text, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_suspend_user(p_target_user_id text, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_suspend_user(p_target_user_id text, p_reason text) TO service_role;


--
-- Name: FUNCTION admin_toggle_exempt(target_user_id text, exempt boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_toggle_exempt(target_user_id text, exempt boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_toggle_exempt(target_user_id text, exempt boolean) TO authenticated;
GRANT ALL ON FUNCTION public.admin_toggle_exempt(target_user_id text, exempt boolean) TO service_role;


--
-- Name: FUNCTION admin_update_role(p_target_user_id text, p_new_role text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_update_role(p_target_user_id text, p_new_role text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_update_role(p_target_user_id text, p_new_role text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_update_role(p_target_user_id text, p_new_role text) TO service_role;


--
-- Name: TABLE listings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.listings TO anon;
GRANT ALL ON TABLE public.listings TO authenticated;
GRANT ALL ON TABLE public.listings TO service_role;


--
-- Name: FUNCTION approve_listing_internal(p_listing_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.approve_listing_internal(p_listing_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.approve_listing_internal(p_listing_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.approve_listing_internal(p_listing_id uuid) TO service_role;


--
-- Name: FUNCTION approve_withdrawal_v2(p_withdrawal_id uuid, p_approved_by text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.approve_withdrawal_v2(p_withdrawal_id uuid, p_approved_by text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.approve_withdrawal_v2(p_withdrawal_id uuid, p_approved_by text) TO service_role;


--
-- Name: FUNCTION assign_field_officer(p_conversation_id uuid, p_staff_id text, p_officer_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.assign_field_officer(p_conversation_id uuid, p_staff_id text, p_officer_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.assign_field_officer(p_conversation_id uuid, p_staff_id text, p_officer_id text) TO authenticated;
GRANT ALL ON FUNCTION public.assign_field_officer(p_conversation_id uuid, p_staff_id text, p_officer_id text) TO service_role;


--
-- Name: FUNCTION assign_partner_inspection(p_inspection_id uuid, p_field_officer_id text, p_scheduled_date date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.assign_partner_inspection(p_inspection_id uuid, p_field_officer_id text, p_scheduled_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.assign_partner_inspection(p_inspection_id uuid, p_field_officer_id text, p_scheduled_date date) TO authenticated;
GRANT ALL ON FUNCTION public.assign_partner_inspection(p_inspection_id uuid, p_field_officer_id text, p_scheduled_date date) TO service_role;


--
-- Name: FUNCTION attach_property_partner_to_inspection(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.attach_property_partner_to_inspection() TO anon;
GRANT ALL ON FUNCTION public.attach_property_partner_to_inspection() TO authenticated;
GRANT ALL ON FUNCTION public.attach_property_partner_to_inspection() TO service_role;


--
-- Name: FUNCTION block_retired_worker_identity_fields(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.block_retired_worker_identity_fields() TO anon;
GRANT ALL ON FUNCTION public.block_retired_worker_identity_fields() TO authenticated;
GRANT ALL ON FUNCTION public.block_retired_worker_identity_fields() TO service_role;


--
-- Name: FUNCTION bump_legal_version(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.bump_legal_version() FROM PUBLIC;
GRANT ALL ON FUNCTION public.bump_legal_version() TO service_role;


--
-- Name: FUNCTION calculate_commission(p_amount numeric, p_type text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.calculate_commission(p_amount numeric, p_type text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.calculate_commission(p_amount numeric, p_type text) TO authenticated;
GRANT ALL ON FUNCTION public.calculate_commission(p_amount numeric, p_type text) TO service_role;


--
-- Name: FUNCTION calculate_reservation_refund(p_reservation_id text, p_reason_category text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.calculate_reservation_refund(p_reservation_id text, p_reason_category text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.calculate_reservation_refund(p_reservation_id text, p_reason_category text) TO authenticated;
GRANT ALL ON FUNCTION public.calculate_reservation_refund(p_reservation_id text, p_reason_category text) TO service_role;


--
-- Name: FUNCTION can_current_actor_read_profile(p_target_user_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.can_current_actor_read_profile(p_target_user_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.can_current_actor_read_profile(p_target_user_id text) TO authenticated;
GRANT ALL ON FUNCTION public.can_current_actor_read_profile(p_target_user_id text) TO service_role;


--
-- Name: FUNCTION cancel_booking(p_booking_id uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cancel_booking(p_booking_id uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancel_booking(p_booking_id uuid, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.cancel_booking(p_booking_id uuid, p_reason text) TO service_role;


--
-- Name: FUNCTION cancel_my_apartment_reservation(p_reservation_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cancel_my_apartment_reservation(p_reservation_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancel_my_apartment_reservation(p_reservation_id text) TO authenticated;
GRANT ALL ON FUNCTION public.cancel_my_apartment_reservation(p_reservation_id text) TO service_role;


--
-- Name: FUNCTION cancel_my_hotel_booking(p_booking_id integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cancel_my_hotel_booking(p_booking_id integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancel_my_hotel_booking(p_booking_id integer) TO authenticated;
GRANT ALL ON FUNCTION public.cancel_my_hotel_booking(p_booking_id integer) TO service_role;


--
-- Name: FUNCTION cancel_my_inspection_request(p_inspection_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cancel_my_inspection_request(p_inspection_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancel_my_inspection_request(p_inspection_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.cancel_my_inspection_request(p_inspection_id uuid) TO service_role;


--
-- Name: FUNCTION cancel_rent_plan(p_plan_id uuid, p_reason text, p_reason_category text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cancel_rent_plan(p_plan_id uuid, p_reason text, p_reason_category text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancel_rent_plan(p_plan_id uuid, p_reason text, p_reason_category text) TO authenticated;
GRANT ALL ON FUNCTION public.cancel_rent_plan(p_plan_id uuid, p_reason text, p_reason_category text) TO service_role;


--
-- Name: FUNCTION complete_apartment_tenancy(p_reservation_id text, p_next_status text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.complete_apartment_tenancy(p_reservation_id text, p_next_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.complete_apartment_tenancy(p_reservation_id text, p_next_status text) TO authenticated;
GRANT ALL ON FUNCTION public.complete_apartment_tenancy(p_reservation_id text, p_next_status text) TO service_role;


--
-- Name: FUNCTION complete_inspection_result(p_inspection_id uuid, p_result text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.complete_inspection_result(p_inspection_id uuid, p_result text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.complete_inspection_result(p_inspection_id uuid, p_result text) TO authenticated;
GRANT ALL ON FUNCTION public.complete_inspection_result(p_inspection_id uuid, p_result text) TO service_role;


--
-- Name: FUNCTION complete_my_worker_identity_check(p_photo_path text, p_face_match_score numeric, p_liveness_score numeric, p_anti_spoof_score numeric, p_challenge_result jsonb, p_consent boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.complete_my_worker_identity_check(p_photo_path text, p_face_match_score numeric, p_liveness_score numeric, p_anti_spoof_score numeric, p_challenge_result jsonb, p_consent boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.complete_my_worker_identity_check(p_photo_path text, p_face_match_score numeric, p_liveness_score numeric, p_anti_spoof_score numeric, p_challenge_result jsonb, p_consent boolean) TO authenticated;
GRANT ALL ON FUNCTION public.complete_my_worker_identity_check(p_photo_path text, p_face_match_score numeric, p_liveness_score numeric, p_anti_spoof_score numeric, p_challenge_result jsonb, p_consent boolean) TO service_role;


--
-- Name: FUNCTION complete_short_stay(p_reservation_id text, p_next_status text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.complete_short_stay(p_reservation_id text, p_next_status text) TO anon;
GRANT ALL ON FUNCTION public.complete_short_stay(p_reservation_id text, p_next_status text) TO authenticated;
GRANT ALL ON FUNCTION public.complete_short_stay(p_reservation_id text, p_next_status text) TO service_role;


--
-- Name: FUNCTION confirm_booking_payment(p_reference text, p_transaction_id text, p_verified_amount numeric, p_verification_source text, p_purpose text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.confirm_booking_payment(p_reference text, p_transaction_id text, p_verified_amount numeric, p_verification_source text, p_purpose text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.confirm_booking_payment(p_reference text, p_transaction_id text, p_verified_amount numeric, p_verification_source text, p_purpose text) TO service_role;


--
-- Name: FUNCTION confirm_worker_booking_payment(p_booking_id uuid, p_paystack_reference text, p_amount_verified numeric, p_currency text, p_transaction_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.confirm_worker_booking_payment(p_booking_id uuid, p_paystack_reference text, p_amount_verified numeric, p_currency text, p_transaction_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.confirm_worker_booking_payment(p_booking_id uuid, p_paystack_reference text, p_amount_verified numeric, p_currency text, p_transaction_id text) TO service_role;


--
-- Name: FUNCTION create_apartment_rent_payment(p_reservation_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_apartment_rent_payment(p_reservation_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_apartment_rent_payment(p_reservation_id text) TO authenticated;
GRANT ALL ON FUNCTION public.create_apartment_rent_payment(p_reservation_id text) TO service_role;


--
-- Name: FUNCTION create_apartment_reservation(p_listing_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_apartment_reservation(p_listing_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_apartment_reservation(p_listing_id text) TO authenticated;
GRANT ALL ON FUNCTION public.create_apartment_reservation(p_listing_id text) TO service_role;


--
-- Name: FUNCTION create_booking_request(p_worker_id text, p_service_type text, p_description text, p_address text, p_scheduled_date text, p_customer_message text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_booking_request(p_worker_id text, p_service_type text, p_description text, p_address text, p_scheduled_date text, p_customer_message text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_booking_request(p_worker_id text, p_service_type text, p_description text, p_address text, p_scheduled_date text, p_customer_message text) TO authenticated;
GRANT ALL ON FUNCTION public.create_booking_request(p_worker_id text, p_service_type text, p_description text, p_address text, p_scheduled_date text, p_customer_message text) TO service_role;


--
-- Name: FUNCTION create_hotel_booking_payment(p_booking_id integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_hotel_booking_payment(p_booking_id integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_hotel_booking_payment(p_booking_id integer) TO authenticated;
GRANT ALL ON FUNCTION public.create_hotel_booking_payment(p_booking_id integer) TO service_role;


--
-- Name: FUNCTION create_internal_listing(p_data jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_internal_listing(p_data jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_internal_listing(p_data jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.create_internal_listing(p_data jsonb) TO service_role;


--
-- Name: TABLE hotel_bookings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.hotel_bookings TO anon;
GRANT ALL ON TABLE public.hotel_bookings TO authenticated;
GRANT ALL ON TABLE public.hotel_bookings TO service_role;


--
-- Name: FUNCTION create_my_hotel_booking(p_hotel_id integer, p_room_id integer, p_check_in date, p_check_out date, p_guest_count integer, p_guest_name text, p_guest_phone text, p_special_requests text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_my_hotel_booking(p_hotel_id integer, p_room_id integer, p_check_in date, p_check_out date, p_guest_count integer, p_guest_name text, p_guest_phone text, p_special_requests text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_my_hotel_booking(p_hotel_id integer, p_room_id integer, p_check_in date, p_check_out date, p_guest_count integer, p_guest_name text, p_guest_phone text, p_special_requests text) TO authenticated;
GRANT ALL ON FUNCTION public.create_my_hotel_booking(p_hotel_id integer, p_room_id integer, p_check_in date, p_check_out date, p_guest_count integer, p_guest_name text, p_guest_phone text, p_special_requests text) TO service_role;


--
-- Name: FUNCTION create_my_profile(p_email text, p_role text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_my_profile(p_email text, p_role text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_my_profile(p_email text, p_role text) TO authenticated;
GRANT ALL ON FUNCTION public.create_my_profile(p_email text, p_role text) TO service_role;


--
-- Name: FUNCTION create_my_property_inspection_batch(p_items jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_my_property_inspection_batch(p_items jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_my_property_inspection_batch(p_items jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.create_my_property_inspection_batch(p_items jsonb) TO service_role;


--
-- Name: FUNCTION create_my_property_inspection_request(p_property_address text, p_property_city text, p_property_state text, p_property_type text, p_bedrooms integer, p_bathrooms integer, p_expected_rent numeric, p_description text, p_owner_phone text, p_photo_urls text[], p_gps_latitude numeric, p_gps_longitude numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_my_property_inspection_request(p_property_address text, p_property_city text, p_property_state text, p_property_type text, p_bedrooms integer, p_bathrooms integer, p_expected_rent numeric, p_description text, p_owner_phone text, p_photo_urls text[], p_gps_latitude numeric, p_gps_longitude numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_my_property_inspection_request(p_property_address text, p_property_city text, p_property_state text, p_property_type text, p_bedrooms integer, p_bathrooms integer, p_expected_rent numeric, p_description text, p_owner_phone text, p_photo_urls text[], p_gps_latitude numeric, p_gps_longitude numeric) TO authenticated;
GRANT ALL ON FUNCTION public.create_my_property_inspection_request(p_property_address text, p_property_city text, p_property_state text, p_property_type text, p_bedrooms integer, p_bathrooms integer, p_expected_rent numeric, p_description text, p_owner_phone text, p_photo_urls text[], p_gps_latitude numeric, p_gps_longitude numeric) TO service_role;


--
-- Name: FUNCTION create_my_property_inspection_request_v2(p_property_address text, p_property_city text, p_property_state text, p_property_type text, p_bedrooms integer, p_bathrooms integer, p_expected_rent numeric, p_description text, p_owner_phone text, p_photo_urls text[], p_gps_latitude numeric, p_gps_longitude numeric, p_location_accuracy_m numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_my_property_inspection_request_v2(p_property_address text, p_property_city text, p_property_state text, p_property_type text, p_bedrooms integer, p_bathrooms integer, p_expected_rent numeric, p_description text, p_owner_phone text, p_photo_urls text[], p_gps_latitude numeric, p_gps_longitude numeric, p_location_accuracy_m numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_my_property_inspection_request_v2(p_property_address text, p_property_city text, p_property_state text, p_property_type text, p_bedrooms integer, p_bathrooms integer, p_expected_rent numeric, p_description text, p_owner_phone text, p_photo_urls text[], p_gps_latitude numeric, p_gps_longitude numeric, p_location_accuracy_m numeric) TO authenticated;
GRANT ALL ON FUNCTION public.create_my_property_inspection_request_v2(p_property_address text, p_property_city text, p_property_state text, p_property_type text, p_bedrooms integer, p_bathrooms integer, p_expected_rent numeric, p_description text, p_owner_phone text, p_photo_urls text[], p_gps_latitude numeric, p_gps_longitude numeric, p_location_accuracy_m numeric) TO service_role;


--
-- Name: TABLE worker_showcase_posts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.worker_showcase_posts TO authenticated;
GRANT ALL ON TABLE public.worker_showcase_posts TO service_role;


--
-- Name: FUNCTION create_my_worker_showcase_post(p_kind text, p_media_type text, p_storage_path text, p_caption text, p_booking_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_my_worker_showcase_post(p_kind text, p_media_type text, p_storage_path text, p_caption text, p_booking_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_my_worker_showcase_post(p_kind text, p_media_type text, p_storage_path text, p_caption text, p_booking_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.create_my_worker_showcase_post(p_kind text, p_media_type text, p_storage_path text, p_caption text, p_booking_id uuid) TO service_role;


--
-- Name: FUNCTION create_rent_plan(p_user_id text, p_listing_id uuid, p_target_amount numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_rent_plan(p_user_id text, p_listing_id uuid, p_target_amount numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_rent_plan(p_user_id text, p_listing_id uuid, p_target_amount numeric) TO authenticated;
GRANT ALL ON FUNCTION public.create_rent_plan(p_user_id text, p_listing_id uuid, p_target_amount numeric) TO service_role;


--
-- Name: FUNCTION create_rent_plan_contribution_payment(p_contribution_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_rent_plan_contribution_payment(p_contribution_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_rent_plan_contribution_payment(p_contribution_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.create_rent_plan_contribution_payment(p_contribution_id uuid) TO service_role;


--
-- Name: FUNCTION create_short_stay_payment(p_reservation_id text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.create_short_stay_payment(p_reservation_id text) TO anon;
GRANT ALL ON FUNCTION public.create_short_stay_payment(p_reservation_id text) TO authenticated;
GRANT ALL ON FUNCTION public.create_short_stay_payment(p_reservation_id text) TO service_role;


--
-- Name: FUNCTION create_short_stay_reservation(p_listing_id text, p_check_in date, p_check_out date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.create_short_stay_reservation(p_listing_id text, p_check_in date, p_check_out date) TO anon;
GRANT ALL ON FUNCTION public.create_short_stay_reservation(p_listing_id text, p_check_in date, p_check_out date) TO authenticated;
GRANT ALL ON FUNCTION public.create_short_stay_reservation(p_listing_id text, p_check_in date, p_check_out date) TO service_role;


--
-- Name: FUNCTION create_support_conversation(p_subject text, p_category text, p_context_type text, p_context_id text, p_context_snapshot jsonb, p_priority text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_support_conversation(p_subject text, p_category text, p_context_type text, p_context_id text, p_context_snapshot jsonb, p_priority text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_support_conversation(p_subject text, p_category text, p_context_type text, p_context_id text, p_context_snapshot jsonb, p_priority text) TO authenticated;
GRANT ALL ON FUNCTION public.create_support_conversation(p_subject text, p_category text, p_context_type text, p_context_id text, p_context_snapshot jsonb, p_priority text) TO service_role;


--
-- Name: FUNCTION create_user_inspection_request(p_reservation_id text, p_notes text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_user_inspection_request(p_reservation_id text, p_notes text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_user_inspection_request(p_reservation_id text, p_notes text) TO authenticated;
GRANT ALL ON FUNCTION public.create_user_inspection_request(p_reservation_id text, p_notes text) TO service_role;


--
-- Name: FUNCTION create_worker_booking_payment(p_booking_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_worker_booking_payment(p_booking_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_worker_booking_payment(p_booking_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.create_worker_booking_payment(p_booking_id uuid) TO service_role;


--
-- Name: FUNCTION create_worker_booking_v2(p_user_id text, p_worker_id text, p_agreed_price numeric, p_service_type text, p_address text, p_notes text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_worker_booking_v2(p_user_id text, p_worker_id text, p_agreed_price numeric, p_service_type text, p_address text, p_notes text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_worker_booking_v2(p_user_id text, p_worker_id text, p_agreed_price numeric, p_service_type text, p_address text, p_notes text) TO service_role;


--
-- Name: FUNCTION create_worker_verification_payment(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_worker_verification_payment() FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_worker_verification_payment() TO authenticated;
GRANT ALL ON FUNCTION public.create_worker_verification_payment() TO service_role;


--
-- Name: FUNCTION creator_action_password_set(p_new_password text, p_current_password text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.creator_action_password_set(p_new_password text, p_current_password text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.creator_action_password_set(p_new_password text, p_current_password text) TO authenticated;
GRANT ALL ON FUNCTION public.creator_action_password_set(p_new_password text, p_current_password text) TO service_role;


--
-- Name: FUNCTION creator_action_password_status(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.creator_action_password_status() FROM PUBLIC;
GRANT ALL ON FUNCTION public.creator_action_password_status() TO authenticated;
GRANT ALL ON FUNCTION public.creator_action_password_status() TO service_role;


--
-- Name: FUNCTION creator_action_password_verify(p_password text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.creator_action_password_verify(p_password text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.creator_action_password_verify(p_password text) TO authenticated;
GRANT ALL ON FUNCTION public.creator_action_password_verify(p_password text) TO service_role;


--
-- Name: FUNCTION creator_auth_set_v3(p_auth_id text, p_password text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.creator_auth_set_v3(p_auth_id text, p_password text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.creator_auth_set_v3(p_auth_id text, p_password text) TO authenticated;
GRANT ALL ON FUNCTION public.creator_auth_set_v3(p_auth_id text, p_password text) TO service_role;


--
-- Name: FUNCTION creator_auth_status_v3(p_auth_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.creator_auth_status_v3(p_auth_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.creator_auth_status_v3(p_auth_id text) TO authenticated;
GRANT ALL ON FUNCTION public.creator_auth_status_v3(p_auth_id text) TO service_role;


--
-- Name: FUNCTION creator_auth_verify_v3(p_auth_id text, p_password text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.creator_auth_verify_v3(p_auth_id text, p_password text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.creator_auth_verify_v3(p_auth_id text, p_password text) TO authenticated;
GRANT ALL ON FUNCTION public.creator_auth_verify_v3(p_auth_id text, p_password text) TO service_role;


--
-- Name: FUNCTION creator_get_change_history(p_search text, p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.creator_get_change_history(p_search text, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.creator_get_change_history(p_search text, p_limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.creator_get_change_history(p_search text, p_limit integer) TO service_role;


--
-- Name: FUNCTION creator_get_platform_analytics(p_days integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.creator_get_platform_analytics(p_days integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.creator_get_platform_analytics(p_days integer) TO authenticated;
GRANT ALL ON FUNCTION public.creator_get_platform_analytics(p_days integer) TO service_role;


--
-- Name: FUNCTION creator_reassign_branch(p_target_user_id text, p_new_state text, p_new_lga text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.creator_reassign_branch(p_target_user_id text, p_new_state text, p_new_lga text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.creator_reassign_branch(p_target_user_id text, p_new_state text, p_new_lga text) TO authenticated;
GRANT ALL ON FUNCTION public.creator_reassign_branch(p_target_user_id text, p_new_state text, p_new_lga text) TO service_role;


--
-- Name: FUNCTION creator_send_announcement(p_title text, p_content text, p_target_roles text[], p_recipient_ids text[], p_scope_state text, p_scope_lga text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.creator_send_announcement(p_title text, p_content text, p_target_roles text[], p_recipient_ids text[], p_scope_state text, p_scope_lga text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.creator_send_announcement(p_title text, p_content text, p_target_roles text[], p_recipient_ids text[], p_scope_state text, p_scope_lga text) TO authenticated;
GRANT ALL ON FUNCTION public.creator_send_announcement(p_title text, p_content text, p_target_roles text[], p_recipient_ids text[], p_scope_state text, p_scope_lga text) TO service_role;


--
-- Name: FUNCTION creator_set_team_role(p_target_user_id text, p_new_role text, p_state text, p_lga text, p_module text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.creator_set_team_role(p_target_user_id text, p_new_role text, p_state text, p_lga text, p_module text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.creator_set_team_role(p_target_user_id text, p_new_role text, p_state text, p_lga text, p_module text) TO authenticated;
GRANT ALL ON FUNCTION public.creator_set_team_role(p_target_user_id text, p_new_role text, p_state text, p_lga text, p_module text) TO service_role;


--
-- Name: FUNCTION credit_wallet(p_wallet_id uuid, p_amount numeric, p_description text, p_reference text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.credit_wallet(p_wallet_id uuid, p_amount numeric, p_description text, p_reference text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.credit_wallet(p_wallet_id uuid, p_amount numeric, p_description text, p_reference text) TO service_role;


--
-- Name: FUNCTION current_actor_can_access_listing_ref(p_listing_ref text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.current_actor_can_access_listing_ref(p_listing_ref text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.current_actor_can_access_listing_ref(p_listing_ref text) TO authenticated;
GRANT ALL ON FUNCTION public.current_actor_can_access_listing_ref(p_listing_ref text) TO service_role;


--
-- Name: FUNCTION current_actor_can_access_reservation(p_reservation_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.current_actor_can_access_reservation(p_reservation_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.current_actor_can_access_reservation(p_reservation_id text) TO authenticated;
GRANT ALL ON FUNCTION public.current_actor_can_access_reservation(p_reservation_id text) TO service_role;


--
-- Name: FUNCTION current_actor_can_access_worker_booking(p_booking_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.current_actor_can_access_worker_booking(p_booking_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.current_actor_can_access_worker_booking(p_booking_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.current_actor_can_access_worker_booking(p_booking_id uuid) TO service_role;


--
-- Name: FUNCTION current_actor_in_scope(p_state text, p_lga text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.current_actor_in_scope(p_state text, p_lga text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.current_actor_in_scope(p_state text, p_lga text) TO authenticated;
GRANT ALL ON FUNCTION public.current_actor_in_scope(p_state text, p_lga text) TO service_role;


--
-- Name: FUNCTION current_profile_role(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.current_profile_role() FROM PUBLIC;
GRANT ALL ON FUNCTION public.current_profile_role() TO authenticated;
GRANT ALL ON FUNCTION public.current_profile_role() TO service_role;


--
-- Name: FUNCTION current_profile_user_id(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.current_profile_user_id() FROM PUBLIC;
GRANT ALL ON FUNCTION public.current_profile_user_id() TO authenticated;
GRANT ALL ON FUNCTION public.current_profile_user_id() TO service_role;


--
-- Name: FUNCTION current_staff_can_review_worker(p_worker_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.current_staff_can_review_worker(p_worker_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.current_staff_can_review_worker(p_worker_id text) TO authenticated;
GRANT ALL ON FUNCTION public.current_staff_can_review_worker(p_worker_id text) TO service_role;


--
-- Name: FUNCTION current_staff_has_permission(p_permission text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.current_staff_has_permission(p_permission text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.current_staff_has_permission(p_permission text) TO authenticated;
GRANT ALL ON FUNCTION public.current_staff_has_permission(p_permission text) TO service_role;


--
-- Name: FUNCTION current_user_is_staff(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.current_user_is_staff() FROM PUBLIC;
GRANT ALL ON FUNCTION public.current_user_is_staff() TO authenticated;
GRANT ALL ON FUNCTION public.current_user_is_staff() TO service_role;


--
-- Name: FUNCTION customer_confirm_completion(p_booking_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.customer_confirm_completion(p_booking_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.customer_confirm_completion(p_booking_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.customer_confirm_completion(p_booking_id uuid) TO service_role;


--
-- Name: FUNCTION customer_confirm_payment(p_booking_id uuid, p_user_id text, p_paystack_ref text, p_paystack_tx_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.customer_confirm_payment(p_booking_id uuid, p_user_id text, p_paystack_ref text, p_paystack_tx_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.customer_confirm_payment(p_booking_id uuid, p_user_id text, p_paystack_ref text, p_paystack_tx_id text) TO authenticated;
GRANT ALL ON FUNCTION public.customer_confirm_payment(p_booking_id uuid, p_user_id text, p_paystack_ref text, p_paystack_tx_id text) TO service_role;


--
-- Name: FUNCTION customer_raise_dispute(p_booking_id uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.customer_raise_dispute(p_booking_id uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.customer_raise_dispute(p_booking_id uuid, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.customer_raise_dispute(p_booking_id uuid, p_reason text) TO service_role;


--
-- Name: FUNCTION delete_my_worker_showcase_post(p_post_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_my_worker_showcase_post(p_post_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_my_worker_showcase_post(p_post_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.delete_my_worker_showcase_post(p_post_id uuid) TO service_role;


--
-- Name: FUNCTION delete_service_category(p_category_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_service_category(p_category_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_service_category(p_category_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.delete_service_category(p_category_id uuid) TO service_role;


--
-- Name: FUNCTION delete_service_subcategory(p_subcategory_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_service_subcategory(p_subcategory_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_service_subcategory(p_subcategory_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.delete_service_subcategory(p_subcategory_id uuid) TO service_role;


--
-- Name: FUNCTION delete_user_account(p_user_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_user_account(p_user_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_user_account(p_user_id text) TO authenticated;
GRANT ALL ON FUNCTION public.delete_user_account(p_user_id text) TO service_role;


--
-- Name: FUNCTION disable_creator_auth(p_password text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.disable_creator_auth(p_password text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.disable_creator_auth(p_password text) TO service_role;


--
-- Name: FUNCTION edit_my_booking_message(p_message_id uuid, p_content text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.edit_my_booking_message(p_message_id uuid, p_content text) TO anon;
GRANT ALL ON FUNCTION public.edit_my_booking_message(p_message_id uuid, p_content text) TO authenticated;
GRANT ALL ON FUNCTION public.edit_my_booking_message(p_message_id uuid, p_content text) TO service_role;


--
-- Name: FUNCTION edit_my_roommate_message(p_message_id uuid, p_content text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.edit_my_roommate_message(p_message_id uuid, p_content text) TO anon;
GRANT ALL ON FUNCTION public.edit_my_roommate_message(p_message_id uuid, p_content text) TO authenticated;
GRANT ALL ON FUNCTION public.edit_my_roommate_message(p_message_id uuid, p_content text) TO service_role;


--
-- Name: FUNCTION end_private_call(p_call_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.end_private_call(p_call_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.end_private_call(p_call_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.end_private_call(p_call_id uuid) TO service_role;


--
-- Name: FUNCTION enforce_chat_message_update(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.enforce_chat_message_update() TO anon;
GRANT ALL ON FUNCTION public.enforce_chat_message_update() TO authenticated;
GRANT ALL ON FUNCTION public.enforce_chat_message_update() TO service_role;


--
-- Name: FUNCTION enforce_hotel_booking_integrity(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enforce_hotel_booking_integrity() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enforce_hotel_booking_integrity() TO service_role;


--
-- Name: FUNCTION enforce_property_partner_listing_owner(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enforce_property_partner_listing_owner() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enforce_property_partner_listing_owner() TO service_role;


--
-- Name: FUNCTION ensure_my_property_partner_wallet(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ensure_my_property_partner_wallet() FROM PUBLIC;
GRANT ALL ON FUNCTION public.ensure_my_property_partner_wallet() TO authenticated;
GRANT ALL ON FUNCTION public.ensure_my_property_partner_wallet() TO service_role;


--
-- Name: FUNCTION expire_old_searches(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.expire_old_searches() TO anon;
GRANT ALL ON FUNCTION public.expire_old_searches() TO authenticated;
GRANT ALL ON FUNCTION public.expire_old_searches() TO service_role;


--
-- Name: FUNCTION expire_overdue_reservations(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.expire_overdue_reservations() FROM PUBLIC;
GRANT ALL ON FUNCTION public.expire_overdue_reservations() TO service_role;


--
-- Name: FUNCTION expire_stale_hotel_booking_holds(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.expire_stale_hotel_booking_holds() FROM PUBLIC;
GRANT ALL ON FUNCTION public.expire_stale_hotel_booking_holds() TO service_role;


--
-- Name: FUNCTION fail_withdrawal(p_withdrawal_id uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fail_withdrawal(p_withdrawal_id uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fail_withdrawal(p_withdrawal_id uuid, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.fail_withdrawal(p_withdrawal_id uuid, p_reason text) TO service_role;


--
-- Name: FUNCTION field_officer_update_inspection_location(p_inspection_id uuid, p_latitude numeric, p_longitude numeric, p_accuracy_m numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.field_officer_update_inspection_location(p_inspection_id uuid, p_latitude numeric, p_longitude numeric, p_accuracy_m numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.field_officer_update_inspection_location(p_inspection_id uuid, p_latitude numeric, p_longitude numeric, p_accuracy_m numeric) TO authenticated;
GRANT ALL ON FUNCTION public.field_officer_update_inspection_location(p_inspection_id uuid, p_latitude numeric, p_longitude numeric, p_accuracy_m numeric) TO service_role;


--
-- Name: FUNCTION freeze_wallet(p_wallet_id uuid, p_reason text, p_frozen_by text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.freeze_wallet(p_wallet_id uuid, p_reason text, p_frozen_by text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.freeze_wallet(p_wallet_id uuid, p_reason text, p_frozen_by text) TO authenticated;
GRANT ALL ON FUNCTION public.freeze_wallet(p_wallet_id uuid, p_reason text, p_frozen_by text) TO service_role;


--
-- Name: FUNCTION fulfill_apartment_rent_payment(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fulfill_apartment_rent_payment() TO anon;
GRANT ALL ON FUNCTION public.fulfill_apartment_rent_payment() TO authenticated;
GRANT ALL ON FUNCTION public.fulfill_apartment_rent_payment() TO service_role;


--
-- Name: FUNCTION fulfill_apartment_reservation_payment(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fulfill_apartment_reservation_payment() TO anon;
GRANT ALL ON FUNCTION public.fulfill_apartment_reservation_payment() TO authenticated;
GRANT ALL ON FUNCTION public.fulfill_apartment_reservation_payment() TO service_role;


--
-- Name: FUNCTION fulfill_hotel_booking_payment(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fulfill_hotel_booking_payment() TO anon;
GRANT ALL ON FUNCTION public.fulfill_hotel_booking_payment() TO authenticated;
GRANT ALL ON FUNCTION public.fulfill_hotel_booking_payment() TO service_role;


--
-- Name: FUNCTION fulfill_rent_plan_contribution_payment(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fulfill_rent_plan_contribution_payment() TO anon;
GRANT ALL ON FUNCTION public.fulfill_rent_plan_contribution_payment() TO authenticated;
GRANT ALL ON FUNCTION public.fulfill_rent_plan_contribution_payment() TO service_role;


--
-- Name: FUNCTION generate_user_id(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.generate_user_id() TO anon;
GRANT ALL ON FUNCTION public.generate_user_id() TO authenticated;
GRANT ALL ON FUNCTION public.generate_user_id() TO service_role;


--
-- Name: FUNCTION generate_user_id_simple(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.generate_user_id_simple() TO anon;
GRANT ALL ON FUNCTION public.generate_user_id_simple() TO authenticated;
GRANT ALL ON FUNCTION public.generate_user_id_simple() TO service_role;


--
-- Name: FUNCTION get_admin_staff_limit_v2(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_admin_staff_limit_v2() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_admin_staff_limit_v2() TO authenticated;
GRANT ALL ON FUNCTION public.get_admin_staff_limit_v2() TO service_role;


--
-- Name: FUNCTION get_all_settings_v2(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_all_settings_v2() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_all_settings_v2() TO authenticated;
GRANT ALL ON FUNCTION public.get_all_settings_v2() TO service_role;


--
-- Name: FUNCTION get_booking_details(p_booking_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_booking_details(p_booking_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_booking_details(p_booking_id uuid) TO service_role;


--
-- Name: FUNCTION get_booking_messages(p_conversation_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_booking_messages(p_conversation_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_booking_messages(p_conversation_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_booking_messages(p_conversation_id uuid) TO service_role;


--
-- Name: FUNCTION get_chat_peer_presence(p_peer_user_id text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_chat_peer_presence(p_peer_user_id text) TO anon;
GRANT ALL ON FUNCTION public.get_chat_peer_presence(p_peer_user_id text) TO authenticated;
GRANT ALL ON FUNCTION public.get_chat_peer_presence(p_peer_user_id text) TO service_role;


--
-- Name: FUNCTION get_conversation_messages(p_conversation_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_conversation_messages(p_conversation_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_conversation_messages(p_conversation_id text) TO authenticated;
GRANT ALL ON FUNCTION public.get_conversation_messages(p_conversation_id text) TO service_role;


--
-- Name: FUNCTION get_inspection_field_officer_candidates(p_inspection_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_inspection_field_officer_candidates(p_inspection_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_inspection_field_officer_candidates(p_inspection_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_inspection_field_officer_candidates(p_inspection_id uuid) TO service_role;


--
-- Name: FUNCTION get_my_active_private_calls(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_active_private_calls() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_active_private_calls() TO authenticated;
GRANT ALL ON FUNCTION public.get_my_active_private_calls() TO service_role;


--
-- Name: FUNCTION get_my_admin_staff_capacity(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_admin_staff_capacity() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_admin_staff_capacity() TO authenticated;
GRANT ALL ON FUNCTION public.get_my_admin_staff_capacity() TO service_role;


--
-- Name: FUNCTION get_my_assigned_inspection_location(p_inspection_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_assigned_inspection_location(p_inspection_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_assigned_inspection_location(p_inspection_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_my_assigned_inspection_location(p_inspection_id uuid) TO service_role;


--
-- Name: FUNCTION get_my_booking_conversations(p_user_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_booking_conversations(p_user_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_booking_conversations(p_user_id text) TO authenticated;
GRANT ALL ON FUNCTION public.get_my_booking_conversations(p_user_id text) TO service_role;


--
-- Name: FUNCTION get_my_booking_conversations_v2(p_user_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_booking_conversations_v2(p_user_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_booking_conversations_v2(p_user_id text) TO authenticated;
GRANT ALL ON FUNCTION public.get_my_booking_conversations_v2(p_user_id text) TO service_role;


--
-- Name: FUNCTION get_my_housing_operations(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_housing_operations() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_housing_operations() TO authenticated;
GRANT ALL ON FUNCTION public.get_my_housing_operations() TO service_role;


--
-- Name: FUNCTION get_my_inspections(p_field_officer_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_inspections(p_field_officer_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_inspections(p_field_officer_id text) TO authenticated;
GRANT ALL ON FUNCTION public.get_my_inspections(p_field_officer_id text) TO service_role;


--
-- Name: FUNCTION get_my_legal_status(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_legal_status() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_legal_status() TO authenticated;
GRANT ALL ON FUNCTION public.get_my_legal_status() TO service_role;


--
-- Name: FUNCTION get_my_private_call_preferences(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_private_call_preferences() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_private_call_preferences() TO authenticated;
GRANT ALL ON FUNCTION public.get_my_private_call_preferences() TO service_role;


--
-- Name: FUNCTION get_my_property_partner_finance(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_property_partner_finance() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_property_partner_finance() TO authenticated;
GRANT ALL ON FUNCTION public.get_my_property_partner_finance() TO service_role;


--
-- Name: FUNCTION get_my_property_pipeline(p_stage text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_property_pipeline(p_stage text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_property_pipeline(p_stage text) TO authenticated;
GRANT ALL ON FUNCTION public.get_my_property_pipeline(p_stage text) TO service_role;


--
-- Name: FUNCTION get_my_reservation_for_listing(p_listing_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_reservation_for_listing(p_listing_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_reservation_for_listing(p_listing_id text) TO authenticated;
GRANT ALL ON FUNCTION public.get_my_reservation_for_listing(p_listing_id text) TO service_role;


--
-- Name: FUNCTION get_my_roommate_conversation_people(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_roommate_conversation_people() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_roommate_conversation_people() TO anon;
GRANT ALL ON FUNCTION public.get_my_roommate_conversation_people() TO authenticated;
GRANT ALL ON FUNCTION public.get_my_roommate_conversation_people() TO service_role;


--
-- Name: FUNCTION get_my_roommate_matches(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_roommate_matches() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_roommate_matches() TO authenticated;
GRANT ALL ON FUNCTION public.get_my_roommate_matches() TO service_role;


--
-- Name: FUNCTION get_my_roommate_matches_page(p_limit integer, p_offset integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_roommate_matches_page(p_limit integer, p_offset integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_roommate_matches_page(p_limit integer, p_offset integer) TO anon;
GRANT ALL ON FUNCTION public.get_my_roommate_matches_page(p_limit integer, p_offset integer) TO authenticated;
GRANT ALL ON FUNCTION public.get_my_roommate_matches_page(p_limit integer, p_offset integer) TO service_role;


--
-- Name: TABLE roommate_preferences; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.roommate_preferences TO anon;
GRANT ALL ON TABLE public.roommate_preferences TO authenticated;
GRANT ALL ON TABLE public.roommate_preferences TO service_role;


--
-- Name: FUNCTION get_my_roommate_preferences(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_roommate_preferences() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_roommate_preferences() TO authenticated;
GRANT ALL ON FUNCTION public.get_my_roommate_preferences() TO service_role;


--
-- Name: FUNCTION get_my_short_stay_operations(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_my_short_stay_operations() TO anon;
GRANT ALL ON FUNCTION public.get_my_short_stay_operations() TO authenticated;
GRANT ALL ON FUNCTION public.get_my_short_stay_operations() TO service_role;


--
-- Name: FUNCTION get_my_staff_finance_queue(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_staff_finance_queue() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_staff_finance_queue() TO authenticated;
GRANT ALL ON FUNCTION public.get_my_staff_finance_queue() TO service_role;


--
-- Name: FUNCTION get_my_staff_operations_listings(p_status text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_staff_operations_listings(p_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_staff_operations_listings(p_status text) TO authenticated;
GRANT ALL ON FUNCTION public.get_my_staff_operations_listings(p_status text) TO service_role;


--
-- Name: FUNCTION get_my_staff_trust_status(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_staff_trust_status() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_staff_trust_status() TO authenticated;
GRANT ALL ON FUNCTION public.get_my_staff_trust_status() TO service_role;


--
-- Name: FUNCTION get_my_staff_worker_review_detail(p_worker_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_staff_worker_review_detail(p_worker_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_staff_worker_review_detail(p_worker_id text) TO authenticated;
GRANT ALL ON FUNCTION public.get_my_staff_worker_review_detail(p_worker_id text) TO service_role;


--
-- Name: FUNCTION get_my_staff_worker_review_queue(p_status text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_staff_worker_review_queue(p_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_staff_worker_review_queue(p_status text) TO authenticated;
GRANT ALL ON FUNCTION public.get_my_staff_worker_review_queue(p_status text) TO service_role;


--
-- Name: FUNCTION get_my_staff_worker_reviews(p_status text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_staff_worker_reviews(p_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_staff_worker_reviews(p_status text) TO service_role;
GRANT ALL ON FUNCTION public.get_my_staff_worker_reviews(p_status text) TO authenticated;


--
-- Name: FUNCTION get_my_support_conversations(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_support_conversations() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_support_conversations() TO authenticated;
GRANT ALL ON FUNCTION public.get_my_support_conversations() TO service_role;


--
-- Name: FUNCTION get_my_worker_activation(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_worker_activation() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_worker_activation() TO authenticated;
GRANT ALL ON FUNCTION public.get_my_worker_activation() TO service_role;


--
-- Name: FUNCTION get_my_worker_booking_details(p_booking_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_worker_booking_details(p_booking_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_worker_booking_details(p_booking_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_my_worker_booking_details(p_booking_id uuid) TO service_role;


--
-- Name: FUNCTION get_my_worker_identity_check(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_worker_identity_check() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_worker_identity_check() TO authenticated;
GRANT ALL ON FUNCTION public.get_my_worker_identity_check() TO service_role;


--
-- Name: FUNCTION get_my_worker_identity_reference(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_worker_identity_reference() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_worker_identity_reference() TO authenticated;
GRANT ALL ON FUNCTION public.get_my_worker_identity_reference() TO service_role;


--
-- Name: TABLE property_partners; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.property_partners TO anon;
GRANT ALL ON TABLE public.property_partners TO authenticated;
GRANT ALL ON TABLE public.property_partners TO service_role;


--
-- Name: FUNCTION get_or_create_my_property_partner(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_or_create_my_property_partner() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_or_create_my_property_partner() TO authenticated;
GRANT ALL ON FUNCTION public.get_or_create_my_property_partner() TO service_role;


--
-- Name: FUNCTION get_platform_setting(p_key text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_platform_setting(p_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_platform_setting(p_key text) TO authenticated;
GRANT ALL ON FUNCTION public.get_platform_setting(p_key text) TO service_role;


--
-- Name: FUNCTION get_platform_settings(p_category text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_platform_settings(p_category text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_platform_settings(p_category text) TO authenticated;
GRANT ALL ON FUNCTION public.get_platform_settings(p_category text) TO service_role;


--
-- Name: FUNCTION get_private_call_capabilities(p_context_type text, p_context_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_private_call_capabilities(p_context_type text, p_context_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_private_call_capabilities(p_context_type text, p_context_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_private_call_capabilities(p_context_type text, p_context_id uuid) TO service_role;


--
-- Name: FUNCTION get_private_call_details(p_call_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_private_call_details(p_call_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_private_call_details(p_call_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_private_call_details(p_call_id uuid) TO service_role;


--
-- Name: FUNCTION get_property_pipeline_requests(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_property_pipeline_requests() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_property_pipeline_requests() TO authenticated;
GRANT ALL ON FUNCTION public.get_property_pipeline_requests() TO service_role;


--
-- Name: FUNCTION get_public_workers(p_state text, p_city text, p_occupation text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_public_workers(p_state text, p_city text, p_occupation text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_public_workers(p_state text, p_city text, p_occupation text) TO authenticated;
GRANT ALL ON FUNCTION public.get_public_workers(p_state text, p_city text, p_occupation text) TO service_role;


--
-- Name: FUNCTION get_roommate_messages_v2(p_conversation_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_roommate_messages_v2(p_conversation_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_roommate_messages_v2(p_conversation_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_roommate_messages_v2(p_conversation_id uuid) TO service_role;


--
-- Name: FUNCTION get_secret_v2(p_key text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_secret_v2(p_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_secret_v2(p_key text) TO authenticated;
GRANT ALL ON FUNCTION public.get_secret_v2(p_key text) TO service_role;


--
-- Name: FUNCTION get_setting_v2(p_key text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_setting_v2(p_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_setting_v2(p_key text) TO authenticated;
GRANT ALL ON FUNCTION public.get_setting_v2(p_key text) TO service_role;


--
-- Name: FUNCTION get_short_stay_unavailable_listing_ids(p_check_in date, p_check_out date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_short_stay_unavailable_listing_ids(p_check_in date, p_check_out date) TO anon;
GRANT ALL ON FUNCTION public.get_short_stay_unavailable_listing_ids(p_check_in date, p_check_out date) TO authenticated;
GRANT ALL ON FUNCTION public.get_short_stay_unavailable_listing_ids(p_check_in date, p_check_out date) TO service_role;


--
-- Name: FUNCTION get_staff_rating(p_staff_user_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_staff_rating(p_staff_user_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_staff_rating(p_staff_user_id text) TO authenticated;
GRANT ALL ON FUNCTION public.get_staff_rating(p_staff_user_id text) TO service_role;


--
-- Name: FUNCTION get_staff_worker_identity_check(p_worker_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_staff_worker_identity_check(p_worker_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_staff_worker_identity_check(p_worker_id text) TO authenticated;
GRANT ALL ON FUNCTION public.get_staff_worker_identity_check(p_worker_id text) TO service_role;


--
-- Name: FUNCTION get_support_messages(p_conversation_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_support_messages(p_conversation_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_support_messages(p_conversation_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_support_messages(p_conversation_id uuid) TO service_role;


--
-- Name: TABLE conversations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.conversations TO anon;
GRANT ALL ON TABLE public.conversations TO authenticated;
GRANT ALL ON TABLE public.conversations TO service_role;


--
-- Name: FUNCTION get_user_conversations(p_user_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_user_conversations(p_user_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_user_conversations(p_user_id text) TO authenticated;
GRANT ALL ON FUNCTION public.get_user_conversations(p_user_id text) TO service_role;


--
-- Name: FUNCTION get_worker_marketplace_trust(p_worker_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_worker_marketplace_trust(p_worker_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_worker_marketplace_trust(p_worker_id text) TO anon;
GRANT ALL ON FUNCTION public.get_worker_marketplace_trust(p_worker_id text) TO authenticated;
GRANT ALL ON FUNCTION public.get_worker_marketplace_trust(p_worker_id text) TO service_role;


--
-- Name: FUNCTION get_worker_verification_chats(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_worker_verification_chats() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_worker_verification_chats() TO authenticated;
GRANT ALL ON FUNCTION public.get_worker_verification_chats() TO service_role;


--
-- Name: FUNCTION guard_inspected_public_hotel(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.guard_inspected_public_hotel() TO anon;
GRANT ALL ON FUNCTION public.guard_inspected_public_hotel() TO authenticated;
GRANT ALL ON FUNCTION public.guard_inspected_public_hotel() TO service_role;


--
-- Name: FUNCTION guard_inspected_public_listing(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.guard_inspected_public_listing() TO anon;
GRANT ALL ON FUNCTION public.guard_inspected_public_listing() TO authenticated;
GRANT ALL ON FUNCTION public.guard_inspected_public_listing() TO service_role;


--
-- Name: FUNCTION guard_retired_worker_identity_fields(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.guard_retired_worker_identity_fields() TO anon;
GRANT ALL ON FUNCTION public.guard_retired_worker_identity_fields() TO authenticated;
GRANT ALL ON FUNCTION public.guard_retired_worker_identity_fields() TO service_role;


--
-- Name: FUNCTION hide_my_booking_conversation(p_conversation_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.hide_my_booking_conversation(p_conversation_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.hide_my_booking_conversation(p_conversation_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.hide_my_booking_conversation(p_conversation_id uuid) TO service_role;


--
-- Name: FUNCTION hide_my_roommate_conversation(p_conversation_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.hide_my_roommate_conversation(p_conversation_id uuid) TO anon;
GRANT ALL ON FUNCTION public.hide_my_roommate_conversation(p_conversation_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.hide_my_roommate_conversation(p_conversation_id uuid) TO service_role;


--
-- Name: FUNCTION hold_property_partner_earning(p_payment_id uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.hold_property_partner_earning(p_payment_id uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.hold_property_partner_earning(p_payment_id uuid, p_reason text) TO service_role;
GRANT ALL ON FUNCTION public.hold_property_partner_earning(p_payment_id uuid, p_reason text) TO authenticated;


--
-- Name: FUNCTION increment_unread(p_room_id integer, p_user_id character varying); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.increment_unread(p_room_id integer, p_user_id character varying) TO anon;
GRANT ALL ON FUNCTION public.increment_unread(p_room_id integer, p_user_id character varying) TO authenticated;
GRANT ALL ON FUNCTION public.increment_unread(p_room_id integer, p_user_id character varying) TO service_role;


--
-- Name: FUNCTION is_current_announcement_recipient(p_announcement_id bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_current_announcement_recipient(p_announcement_id bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_current_announcement_recipient(p_announcement_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.is_current_announcement_recipient(p_announcement_id bigint) TO service_role;


--
-- Name: FUNCTION is_current_announcement_sender(p_announcement_id bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_current_announcement_sender(p_announcement_id bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_current_announcement_sender(p_announcement_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.is_current_announcement_sender(p_announcement_id bigint) TO service_role;


--
-- Name: FUNCTION is_current_creator(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_current_creator() FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_current_creator() TO authenticated;
GRANT ALL ON FUNCTION public.is_current_creator() TO service_role;


--
-- Name: FUNCTION is_staff_or_creator(uid text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_staff_or_creator(uid text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_staff_or_creator(uid text) TO authenticated;
GRANT ALL ON FUNCTION public.is_staff_or_creator(uid text) TO service_role;


--
-- Name: FUNCTION is_username_available(p_username text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_username_available(p_username text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_username_available(p_username text) TO authenticated;
GRANT ALL ON FUNCTION public.is_username_available(p_username text) TO service_role;


--
-- Name: FUNCTION lga_booking_prefix(p_lga text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.lga_booking_prefix(p_lga text) TO anon;
GRANT ALL ON FUNCTION public.lga_booking_prefix(p_lga text) TO authenticated;
GRANT ALL ON FUNCTION public.lga_booking_prefix(p_lga text) TO service_role;


--
-- Name: FUNCTION lock_admin_staff_location(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.lock_admin_staff_location() FROM PUBLIC;
GRANT ALL ON FUNCTION public.lock_admin_staff_location() TO service_role;


--
-- Name: FUNCTION log_settings_change(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_settings_change() FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_settings_change() TO service_role;


--
-- Name: FUNCTION manage_staff_permission(p_staff_id text, p_permission text, p_enabled boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.manage_staff_permission(p_staff_id text, p_permission text, p_enabled boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.manage_staff_permission(p_staff_id text, p_permission text, p_enabled boolean) TO authenticated;
GRANT ALL ON FUNCTION public.manage_staff_permission(p_staff_id text, p_permission text, p_enabled boolean) TO service_role;


--
-- Name: FUNCTION mark_my_announcement_read(p_announcement_id integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mark_my_announcement_read(p_announcement_id integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_my_announcement_read(p_announcement_id integer) TO authenticated;
GRANT ALL ON FUNCTION public.mark_my_announcement_read(p_announcement_id integer) TO service_role;


--
-- Name: FUNCTION mark_my_booking_messages_read(p_conversation_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mark_my_booking_messages_read(p_conversation_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_my_booking_messages_read(p_conversation_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.mark_my_booking_messages_read(p_conversation_id uuid) TO service_role;


--
-- Name: FUNCTION mark_my_conversation_seen(p_conversation_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mark_my_conversation_seen(p_conversation_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_my_conversation_seen(p_conversation_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.mark_my_conversation_seen(p_conversation_id uuid) TO service_role;


--
-- Name: FUNCTION mark_my_reservation_support_contacted(p_reservation_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mark_my_reservation_support_contacted(p_reservation_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_my_reservation_support_contacted(p_reservation_id text) TO authenticated;
GRANT ALL ON FUNCTION public.mark_my_reservation_support_contacted(p_reservation_id text) TO service_role;


--
-- Name: FUNCTION mark_support_messages_read(p_conversation_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mark_support_messages_read(p_conversation_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_support_messages_read(p_conversation_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.mark_support_messages_read(p_conversation_id uuid) TO service_role;


--
-- Name: FUNCTION message_edit_window_minutes(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.message_edit_window_minutes() TO anon;
GRANT ALL ON FUNCTION public.message_edit_window_minutes() TO authenticated;
GRANT ALL ON FUNCTION public.message_edit_window_minutes() TO service_role;


--
-- Name: FUNCTION post_property_from_inspection(p_data jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.post_property_from_inspection(p_data jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.post_property_from_inspection(p_data jsonb) TO service_role;
GRANT ALL ON FUNCTION public.post_property_from_inspection(p_data jsonb) TO authenticated;


--
-- Name: FUNCTION prevent_double_reservation(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.prevent_double_reservation() FROM PUBLIC;
GRANT ALL ON FUNCTION public.prevent_double_reservation() TO service_role;


--
-- Name: FUNCTION process_booking_payment(p_booking_id uuid, p_paystack_reference text, p_amount numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.process_booking_payment(p_booking_id uuid, p_paystack_reference text, p_amount numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.process_booking_payment(p_booking_id uuid, p_paystack_reference text, p_amount numeric) TO service_role;


--
-- Name: FUNCTION process_reservation_refund(p_reservation_id text, p_reason_category text, p_reason_detail text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.process_reservation_refund(p_reservation_id text, p_reason_category text, p_reason_detail text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.process_reservation_refund(p_reservation_id text, p_reason_category text, p_reason_detail text) TO authenticated;
GRANT ALL ON FUNCTION public.process_reservation_refund(p_reservation_id text, p_reason_category text, p_reason_detail text) TO service_role;


--
-- Name: FUNCTION process_withdrawal(p_withdrawal_id uuid, p_paystack_transfer_code text, p_paystack_reference text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.process_withdrawal(p_withdrawal_id uuid, p_paystack_transfer_code text, p_paystack_reference text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.process_withdrawal(p_withdrawal_id uuid, p_paystack_transfer_code text, p_paystack_reference text) TO service_role;


--
-- Name: FUNCTION protect_privileged_profile_fields(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.protect_privileged_profile_fields() FROM PUBLIC;
GRANT ALL ON FUNCTION public.protect_privileged_profile_fields() TO service_role;


--
-- Name: FUNCTION record_bank_account_change(p_user_id text, p_bank_name text, p_bank_code text, p_bank_account_number text, p_bank_account_name text, p_verified_account_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_bank_account_change(p_user_id text, p_bank_name text, p_bank_code text, p_bank_account_number text, p_bank_account_name text, p_verified_account_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_bank_account_change(p_user_id text, p_bank_name text, p_bank_code text, p_bank_account_number text, p_bank_account_name text, p_verified_account_name text) TO service_role;


--
-- Name: FUNCTION record_worker_verification_payment(p_user_id text, p_reference text, p_amount numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_worker_verification_payment(p_user_id text, p_reference text, p_amount numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_worker_verification_payment(p_user_id text, p_reference text, p_amount numeric) TO service_role;


--
-- Name: FUNCTION refresh_my_roommate_search(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.refresh_my_roommate_search() FROM PUBLIC;
GRANT ALL ON FUNCTION public.refresh_my_roommate_search() TO authenticated;
GRANT ALL ON FUNCTION public.refresh_my_roommate_search() TO service_role;


--
-- Name: FUNCTION refund_escrow(p_escrow_id uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.refund_escrow(p_escrow_id uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.refund_escrow(p_escrow_id uuid, p_reason text) TO service_role;


--
-- Name: FUNCTION register_pending_property_partner_earning(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.register_pending_property_partner_earning() FROM PUBLIC;
GRANT ALL ON FUNCTION public.register_pending_property_partner_earning() TO service_role;


--
-- Name: FUNCTION reject_listing_internal(p_listing_id uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reject_listing_internal(p_listing_id uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reject_listing_internal(p_listing_id uuid, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.reject_listing_internal(p_listing_id uuid, p_reason text) TO service_role;


--
-- Name: FUNCTION reject_withdrawal_v2(p_withdrawal_id uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reject_withdrawal_v2(p_withdrawal_id uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reject_withdrawal_v2(p_withdrawal_id uuid, p_reason text) TO service_role;


--
-- Name: FUNCTION release_escrow(p_booking_id uuid, p_released_by text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.release_escrow(p_booking_id uuid, p_released_by text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.release_escrow(p_booking_id uuid, p_released_by text) TO service_role;


--
-- Name: FUNCTION release_property_partner_earning(p_payment_id uuid, p_release_event text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.release_property_partner_earning(p_payment_id uuid, p_release_event text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.release_property_partner_earning(p_payment_id uuid, p_release_event text) TO service_role;
GRANT ALL ON FUNCTION public.release_property_partner_earning(p_payment_id uuid, p_release_event text) TO authenticated;


--
-- Name: FUNCTION request_inspection_pause_expiry(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.request_inspection_pause_expiry() FROM PUBLIC;
GRANT ALL ON FUNCTION public.request_inspection_pause_expiry() TO service_role;


--
-- Name: FUNCTION request_my_property_partner_withdrawal(p_amount numeric, p_bank_account_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.request_my_property_partner_withdrawal(p_amount numeric, p_bank_account_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.request_my_property_partner_withdrawal(p_amount numeric, p_bank_account_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.request_my_property_partner_withdrawal(p_amount numeric, p_bank_account_id uuid) TO service_role;


--
-- Name: FUNCTION request_withdrawal(p_user_id text, p_amount numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.request_withdrawal(p_user_id text, p_amount numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.request_withdrawal(p_user_id text, p_amount numeric) TO service_role;


--
-- Name: FUNCTION request_withdrawal_v2(p_wallet_id uuid, p_amount numeric, p_bank_account_number text, p_bank_code text, p_bank_name text, p_account_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.request_withdrawal_v2(p_wallet_id uuid, p_amount numeric, p_bank_account_number text, p_bank_code text, p_bank_name text, p_account_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.request_withdrawal_v2(p_wallet_id uuid, p_amount numeric, p_bank_account_number text, p_bank_code text, p_bank_name text, p_account_name text) TO service_role;


--
-- Name: FUNCTION request_worker_withdrawal(p_amount numeric, p_bank_account_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.request_worker_withdrawal(p_amount numeric, p_bank_account_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.request_worker_withdrawal(p_amount numeric, p_bank_account_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.request_worker_withdrawal(p_amount numeric, p_bank_account_id uuid) TO service_role;


--
-- Name: FUNCTION reserve_lga_booking_code(p_lga text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reserve_lga_booking_code(p_lga text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reserve_lga_booking_code(p_lga text) TO service_role;


--
-- Name: FUNCTION reserve_listing_on_activation(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reserve_listing_on_activation() FROM PUBLIC;
GRANT ALL ON FUNCTION public.reserve_listing_on_activation() TO service_role;


--
-- Name: FUNCTION respond_private_call(p_call_id uuid, p_accept boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.respond_private_call(p_call_id uuid, p_accept boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.respond_private_call(p_call_id uuid, p_accept boolean) TO authenticated;
GRANT ALL ON FUNCTION public.respond_private_call(p_call_id uuid, p_accept boolean) TO service_role;


--
-- Name: FUNCTION reverse_payment(p_payment_id uuid, p_reversal_type text, p_reason text, p_reversal_reference text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reverse_payment(p_payment_id uuid, p_reversal_type text, p_reason text, p_reversal_reference text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reverse_payment(p_payment_id uuid, p_reversal_type text, p_reason text, p_reversal_reference text) TO service_role;


--
-- Name: FUNCTION reverse_pending_property_partner_earning(p_payment_id uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reverse_pending_property_partner_earning(p_payment_id uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reverse_pending_property_partner_earning(p_payment_id uuid, p_reason text) TO service_role;
GRANT ALL ON FUNCTION public.reverse_pending_property_partner_earning(p_payment_id uuid, p_reason text) TO authenticated;


--
-- Name: FUNCTION review_my_staff_listing(p_listing_id uuid, p_decision text, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.review_my_staff_listing(p_listing_id uuid, p_decision text, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.review_my_staff_listing(p_listing_id uuid, p_decision text, p_reason text) TO service_role;


--
-- Name: FUNCTION review_my_staff_worker_v2(p_worker_id text, p_status text, p_reason text, p_notes text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.review_my_staff_worker_v2(p_worker_id text, p_status text, p_reason text, p_notes text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.review_my_staff_worker_v2(p_worker_id text, p_status text, p_reason text, p_notes text) TO authenticated;
GRANT ALL ON FUNCTION public.review_my_staff_worker_v2(p_worker_id text, p_status text, p_reason text, p_notes text) TO service_role;


--
-- Name: FUNCTION save_my_roommate_preferences(p_gender text, p_gender_preference text, p_budget_min integer, p_budget_max integer, p_cleanliness text, p_noise_level text, p_sleep_time text, p_visitors text, p_stay_duration text, p_area_preference text, p_bio text, p_school_name text, p_campus text, p_level text, p_department text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_my_roommate_preferences(p_gender text, p_gender_preference text, p_budget_min integer, p_budget_max integer, p_cleanliness text, p_noise_level text, p_sleep_time text, p_visitors text, p_stay_duration text, p_area_preference text, p_bio text, p_school_name text, p_campus text, p_level text, p_department text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_my_roommate_preferences(p_gender text, p_gender_preference text, p_budget_min integer, p_budget_max integer, p_cleanliness text, p_noise_level text, p_sleep_time text, p_visitors text, p_stay_duration text, p_area_preference text, p_bio text, p_school_name text, p_campus text, p_level text, p_department text) TO authenticated;
GRANT ALL ON FUNCTION public.save_my_roommate_preferences(p_gender text, p_gender_preference text, p_budget_min integer, p_budget_max integer, p_cleanliness text, p_noise_level text, p_sleep_time text, p_visitors text, p_stay_duration text, p_area_preference text, p_bio text, p_school_name text, p_campus text, p_level text, p_department text) TO service_role;


--
-- Name: FUNCTION save_my_worker_professional_evidence(p_certificate_path text, p_video_path text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_my_worker_professional_evidence(p_certificate_path text, p_video_path text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_my_worker_professional_evidence(p_certificate_path text, p_video_path text) TO authenticated;
GRANT ALL ON FUNCTION public.save_my_worker_professional_evidence(p_certificate_path text, p_video_path text) TO service_role;


--
-- Name: FUNCTION save_verified_payout_account(p_user_id text, p_bank_code text, p_bank_name text, p_account_number text, p_account_name text, p_recipient_code text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_verified_payout_account(p_user_id text, p_bank_code text, p_bank_name text, p_account_number text, p_account_name text, p_recipient_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_verified_payout_account(p_user_id text, p_bank_code text, p_bank_name text, p_account_number text, p_account_name text, p_recipient_code text) TO service_role;


--
-- Name: FUNCTION send_booking_message(p_conversation_id uuid, p_content text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.send_booking_message(p_conversation_id uuid, p_content text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.send_booking_message(p_conversation_id uuid, p_content text) TO authenticated;
GRANT ALL ON FUNCTION public.send_booking_message(p_conversation_id uuid, p_content text) TO service_role;


--
-- Name: FUNCTION send_booking_message_v2(p_conversation_id uuid, p_content text, p_attachments text[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.send_booking_message_v2(p_conversation_id uuid, p_content text, p_attachments text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.send_booking_message_v2(p_conversation_id uuid, p_content text, p_attachments text[]) TO authenticated;
GRANT ALL ON FUNCTION public.send_booking_message_v2(p_conversation_id uuid, p_content text, p_attachments text[]) TO service_role;


--
-- Name: TABLE messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.messages TO anon;
GRANT ALL ON TABLE public.messages TO authenticated;
GRANT ALL ON TABLE public.messages TO service_role;


--
-- Name: FUNCTION send_my_roommate_message(p_conversation_id uuid, p_content text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.send_my_roommate_message(p_conversation_id uuid, p_content text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.send_my_roommate_message(p_conversation_id uuid, p_content text) TO authenticated;
GRANT ALL ON FUNCTION public.send_my_roommate_message(p_conversation_id uuid, p_content text) TO service_role;


--
-- Name: FUNCTION send_my_roommate_message_v2(p_conversation_id uuid, p_content text, p_attachments text[], p_attachment_types text[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.send_my_roommate_message_v2(p_conversation_id uuid, p_content text, p_attachments text[], p_attachment_types text[]) TO anon;
GRANT ALL ON FUNCTION public.send_my_roommate_message_v2(p_conversation_id uuid, p_content text, p_attachments text[], p_attachment_types text[]) TO authenticated;
GRANT ALL ON FUNCTION public.send_my_roommate_message_v2(p_conversation_id uuid, p_content text, p_attachments text[], p_attachment_types text[]) TO service_role;


--
-- Name: FUNCTION send_support_message(p_conversation_id uuid, p_content text, p_attachments text[], p_attachment_types text[], p_action_type text, p_action_metadata jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.send_support_message(p_conversation_id uuid, p_content text, p_attachments text[], p_attachment_types text[], p_action_type text, p_action_metadata jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.send_support_message(p_conversation_id uuid, p_content text, p_attachments text[], p_attachment_types text[], p_action_type text, p_action_metadata jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.send_support_message(p_conversation_id uuid, p_content text, p_attachments text[], p_attachment_types text[], p_action_type text, p_action_metadata jsonb) TO service_role;


--
-- Name: FUNCTION set_apartment_commission_on_reservation(p_reservation_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_apartment_commission_on_reservation(p_reservation_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_apartment_commission_on_reservation(p_reservation_id text) TO authenticated;
GRANT ALL ON FUNCTION public.set_apartment_commission_on_reservation(p_reservation_id text) TO service_role;


--
-- Name: FUNCTION set_hotel_booking_code(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_hotel_booking_code() TO anon;
GRANT ALL ON FUNCTION public.set_hotel_booking_code() TO authenticated;
GRANT ALL ON FUNCTION public.set_hotel_booking_code() TO service_role;


--
-- Name: FUNCTION set_listing_status_internal(p_listing_id text, p_status text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_listing_status_internal(p_listing_id text, p_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_listing_status_internal(p_listing_id text, p_status text) TO authenticated;
GRANT ALL ON FUNCTION public.set_listing_status_internal(p_listing_id text, p_status text) TO service_role;


--
-- Name: FUNCTION set_my_private_call_preferences(p_allow_audio boolean, p_allow_video boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_my_private_call_preferences(p_allow_audio boolean, p_allow_video boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_my_private_call_preferences(p_allow_audio boolean, p_allow_video boolean) TO authenticated;
GRANT ALL ON FUNCTION public.set_my_private_call_preferences(p_allow_audio boolean, p_allow_video boolean) TO service_role;


--
-- Name: FUNCTION set_my_roommate_school_filter(p_school_match boolean, p_school_name text, p_campus text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_my_roommate_school_filter(p_school_match boolean, p_school_name text, p_campus text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_my_roommate_school_filter(p_school_match boolean, p_school_name text, p_campus text) TO authenticated;
GRANT ALL ON FUNCTION public.set_my_roommate_school_filter(p_school_match boolean, p_school_name text, p_campus text) TO service_role;


--
-- Name: FUNCTION set_my_worker_availability(p_is_available boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_my_worker_availability(p_is_available boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_my_worker_availability(p_is_available boolean) TO authenticated;
GRANT ALL ON FUNCTION public.set_my_worker_availability(p_is_available boolean) TO service_role;


--
-- Name: FUNCTION set_property_inspection_stay_type(p_inspection_id uuid, p_sub_type text, p_security_deposit_amount numeric); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_property_inspection_stay_type(p_inspection_id uuid, p_sub_type text, p_security_deposit_amount numeric) TO anon;
GRANT ALL ON FUNCTION public.set_property_inspection_stay_type(p_inspection_id uuid, p_sub_type text, p_security_deposit_amount numeric) TO authenticated;
GRANT ALL ON FUNCTION public.set_property_inspection_stay_type(p_inspection_id uuid, p_sub_type text, p_security_deposit_amount numeric) TO service_role;


--
-- Name: FUNCTION set_reservation_booking_code(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_reservation_booking_code() TO anon;
GRANT ALL ON FUNCTION public.set_reservation_booking_code() TO authenticated;
GRANT ALL ON FUNCTION public.set_reservation_booking_code() TO service_role;


--
-- Name: FUNCTION set_reservation_expiry(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_reservation_expiry() FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_reservation_expiry() TO service_role;


--
-- Name: FUNCTION set_secret_v2(p_key text, p_value text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_secret_v2(p_key text, p_value text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_secret_v2(p_key text, p_value text) TO authenticated;
GRANT ALL ON FUNCTION public.set_secret_v2(p_key text, p_value text) TO service_role;


--
-- Name: FUNCTION set_setting_v2(p_key text, p_value text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_setting_v2(p_key text, p_value text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_setting_v2(p_key text, p_value text) TO service_role;


--
-- Name: FUNCTION set_staff_trust_status(p_staff_id text, p_status text, p_notes text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_staff_trust_status(p_staff_id text, p_status text, p_notes text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_staff_trust_status(p_staff_id text, p_status text, p_notes text) TO authenticated;
GRANT ALL ON FUNCTION public.set_staff_trust_status(p_staff_id text, p_status text, p_notes text) TO service_role;


--
-- Name: FUNCTION settle_verified_property_partner_payment(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.settle_verified_property_partner_payment() FROM PUBLIC;
GRANT ALL ON FUNCTION public.settle_verified_property_partner_payment() TO service_role;


--
-- Name: FUNCTION soft_delete_listing_internal(p_listing_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.soft_delete_listing_internal(p_listing_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.soft_delete_listing_internal(p_listing_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.soft_delete_listing_internal(p_listing_id uuid) TO service_role;


--
-- Name: FUNCTION staff_assign_customer_inspection(p_inspection_id uuid, p_field_officer_id text, p_scheduled_date timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_assign_customer_inspection(p_inspection_id uuid, p_field_officer_id text, p_scheduled_date timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_assign_customer_inspection(p_inspection_id uuid, p_field_officer_id text, p_scheduled_date timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.staff_assign_customer_inspection(p_inspection_id uuid, p_field_officer_id text, p_scheduled_date timestamp with time zone) TO service_role;


--
-- Name: FUNCTION staff_branch_analytics(p_staff_user_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_branch_analytics(p_staff_user_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_branch_analytics(p_staff_user_id text) TO authenticated;
GRANT ALL ON FUNCTION public.staff_branch_analytics(p_staff_user_id text) TO service_role;


--
-- Name: FUNCTION staff_complete_customer_inspection(p_inspection_id uuid, p_report text, p_condition text, p_photo_urls text[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_complete_customer_inspection(p_inspection_id uuid, p_report text, p_condition text, p_photo_urls text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_complete_customer_inspection(p_inspection_id uuid, p_report text, p_condition text, p_photo_urls text[]) TO authenticated;
GRANT ALL ON FUNCTION public.staff_complete_customer_inspection(p_inspection_id uuid, p_report text, p_condition text, p_photo_urls text[]) TO service_role;


--
-- Name: FUNCTION staff_start_customer_inspection(p_inspection_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_start_customer_inspection(p_inspection_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_start_customer_inspection(p_inspection_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.staff_start_customer_inspection(p_inspection_id uuid) TO service_role;


--
-- Name: FUNCTION start_my_roommate_search(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.start_my_roommate_search() FROM PUBLIC;
GRANT ALL ON FUNCTION public.start_my_roommate_search() TO authenticated;
GRANT ALL ON FUNCTION public.start_my_roommate_search() TO service_role;


--
-- Name: FUNCTION start_my_worker_test(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.start_my_worker_test() FROM PUBLIC;
GRANT ALL ON FUNCTION public.start_my_worker_test() TO authenticated;
GRANT ALL ON FUNCTION public.start_my_worker_test() TO service_role;


--
-- Name: FUNCTION start_private_call(p_context_type text, p_context_id uuid, p_call_type text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.start_private_call(p_context_type text, p_context_id uuid, p_call_type text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.start_private_call(p_context_type text, p_context_id uuid, p_call_type text) TO authenticated;
GRANT ALL ON FUNCTION public.start_private_call(p_context_type text, p_context_id uuid, p_call_type text) TO service_role;


--
-- Name: FUNCTION stop_my_roommate_search(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.stop_my_roommate_search() FROM PUBLIC;
GRANT ALL ON FUNCTION public.stop_my_roommate_search() TO authenticated;
GRANT ALL ON FUNCTION public.stop_my_roommate_search() TO service_role;


--
-- Name: FUNCTION submit_my_worker_test(p_attempt_id uuid, p_answers jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.submit_my_worker_test(p_attempt_id uuid, p_answers jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.submit_my_worker_test(p_attempt_id uuid, p_answers jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.submit_my_worker_test(p_attempt_id uuid, p_answers jsonb) TO service_role;


--
-- Name: FUNCTION submit_my_worker_verification(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.submit_my_worker_verification() FROM PUBLIC;
GRANT ALL ON FUNCTION public.submit_my_worker_verification() TO authenticated;
GRANT ALL ON FUNCTION public.submit_my_worker_verification() TO service_role;


--
-- Name: FUNCTION support_inbox(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.support_inbox() FROM PUBLIC;
GRANT ALL ON FUNCTION public.support_inbox() TO authenticated;
GRANT ALL ON FUNCTION public.support_inbox() TO service_role;


--
-- Name: FUNCTION sync_listing_lifecycle(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sync_listing_lifecycle() TO anon;
GRANT ALL ON FUNCTION public.sync_listing_lifecycle() TO authenticated;
GRANT ALL ON FUNCTION public.sync_listing_lifecycle() TO service_role;


--
-- Name: FUNCTION sync_staff_trust_on_role_change(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sync_staff_trust_on_role_change() TO anon;
GRANT ALL ON FUNCTION public.sync_staff_trust_on_role_change() TO authenticated;
GRANT ALL ON FUNCTION public.sync_staff_trust_on_role_change() TO service_role;


--
-- Name: FUNCTION touch_my_presence(p_online boolean); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.touch_my_presence(p_online boolean) TO anon;
GRANT ALL ON FUNCTION public.touch_my_presence(p_online boolean) TO authenticated;
GRANT ALL ON FUNCTION public.touch_my_presence(p_online boolean) TO service_role;


--
-- Name: FUNCTION transition_inspection_status(p_inspection_id uuid, p_new_status text, p_changed_by text, p_changed_by_role text, p_notes text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.transition_inspection_status(p_inspection_id uuid, p_new_status text, p_changed_by text, p_changed_by_role text, p_notes text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.transition_inspection_status(p_inspection_id uuid, p_new_status text, p_changed_by text, p_changed_by_role text, p_notes text) TO service_role;


--
-- Name: FUNCTION unfreeze_wallet(p_wallet_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.unfreeze_wallet(p_wallet_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.unfreeze_wallet(p_wallet_id uuid) TO service_role;


--
-- Name: FUNCTION update_inspection_status(p_inspection_id uuid, p_new_status text, p_source text, p_report text, p_condition text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_inspection_status(p_inspection_id uuid, p_new_status text, p_source text, p_report text, p_condition text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_inspection_status(p_inspection_id uuid, p_new_status text, p_source text, p_report text, p_condition text) TO authenticated;
GRANT ALL ON FUNCTION public.update_inspection_status(p_inspection_id uuid, p_new_status text, p_source text, p_report text, p_condition text) TO service_role;


--
-- Name: FUNCTION update_my_field_location(p_latitude numeric, p_longitude numeric, p_accuracy_m numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_my_field_location(p_latitude numeric, p_longitude numeric, p_accuracy_m numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_my_field_location(p_latitude numeric, p_longitude numeric, p_accuracy_m numeric) TO authenticated;
GRANT ALL ON FUNCTION public.update_my_field_location(p_latitude numeric, p_longitude numeric, p_accuracy_m numeric) TO service_role;


--
-- Name: FUNCTION update_my_field_officer_location(p_latitude numeric, p_longitude numeric, p_accuracy_m numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_my_field_officer_location(p_latitude numeric, p_longitude numeric, p_accuracy_m numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_my_field_officer_location(p_latitude numeric, p_longitude numeric, p_accuracy_m numeric) TO authenticated;
GRANT ALL ON FUNCTION public.update_my_field_officer_location(p_latitude numeric, p_longitude numeric, p_accuracy_m numeric) TO service_role;


--
-- Name: FUNCTION update_my_privacy(p_updates jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_my_privacy(p_updates jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_my_privacy(p_updates jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.update_my_privacy(p_updates jsonb) TO service_role;


--
-- Name: FUNCTION update_my_profile(p_updates jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_my_profile(p_updates jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_my_profile(p_updates jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.update_my_profile(p_updates jsonb) TO service_role;


--
-- Name: FUNCTION update_my_reservation_plan(p_reservation_id text, p_plan_years integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_my_reservation_plan(p_reservation_id text, p_plan_years integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_my_reservation_plan(p_reservation_id text, p_plan_years integer) TO authenticated;
GRANT ALL ON FUNCTION public.update_my_reservation_plan(p_reservation_id text, p_plan_years integer) TO service_role;


--
-- Name: FUNCTION update_my_roommate_match_status(p_match_id uuid, p_status text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_my_roommate_match_status(p_match_id uuid, p_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_my_roommate_match_status(p_match_id uuid, p_status text) TO authenticated;
GRANT ALL ON FUNCTION public.update_my_roommate_match_status(p_match_id uuid, p_status text) TO service_role;


--
-- Name: FUNCTION update_platform_setting(p_key text, p_value text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_platform_setting(p_key text, p_value text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_platform_setting(p_key text, p_value text) TO authenticated;
GRANT ALL ON FUNCTION public.update_platform_setting(p_key text, p_value text) TO service_role;


--
-- Name: FUNCTION update_staff_trust_checklist(p_staff_id text, p_supervisor_confirmed boolean, p_orientation_completed boolean, p_role_training_completed boolean, p_code_of_conduct_confirmed boolean, p_probation_observation_completed boolean, p_notes text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_staff_trust_checklist(p_staff_id text, p_supervisor_confirmed boolean, p_orientation_completed boolean, p_role_training_completed boolean, p_code_of_conduct_confirmed boolean, p_probation_observation_completed boolean, p_notes text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_staff_trust_checklist(p_staff_id text, p_supervisor_confirmed boolean, p_orientation_completed boolean, p_role_training_completed boolean, p_code_of_conduct_confirmed boolean, p_probation_observation_completed boolean, p_notes text) TO authenticated;
GRANT ALL ON FUNCTION public.update_staff_trust_checklist(p_staff_id text, p_supervisor_confirmed boolean, p_orientation_completed boolean, p_role_training_completed boolean, p_code_of_conduct_confirmed boolean, p_probation_observation_completed boolean, p_notes text) TO service_role;


--
-- Name: TABLE bank_accounts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.bank_accounts TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.bank_accounts TO authenticated;
GRANT ALL ON TABLE public.bank_accounts TO service_role;


--
-- Name: FUNCTION upsert_my_bank_account(p_bank_name text, p_account_number text, p_account_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.upsert_my_bank_account(p_bank_name text, p_account_number text, p_account_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.upsert_my_bank_account(p_bank_name text, p_account_number text, p_account_name text) TO service_role;


--
-- Name: FUNCTION verify_branch_booking_code(p_code text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.verify_branch_booking_code(p_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.verify_branch_booking_code(p_code text) TO authenticated;
GRANT ALL ON FUNCTION public.verify_branch_booking_code(p_code text) TO service_role;


--
-- Name: FUNCTION worker_accept_booking(p_booking_id uuid, p_negotiated_amount numeric, p_scheduled_date text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.worker_accept_booking(p_booking_id uuid, p_negotiated_amount numeric, p_scheduled_date text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.worker_accept_booking(p_booking_id uuid, p_negotiated_amount numeric, p_scheduled_date text) TO authenticated;
GRANT ALL ON FUNCTION public.worker_accept_booking(p_booking_id uuid, p_negotiated_amount numeric, p_scheduled_date text) TO service_role;


--
-- Name: FUNCTION worker_identity_is_current(p_worker_id text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.worker_identity_is_current(p_worker_id text) TO anon;
GRANT ALL ON FUNCTION public.worker_identity_is_current(p_worker_id text) TO authenticated;
GRANT ALL ON FUNCTION public.worker_identity_is_current(p_worker_id text) TO service_role;


--
-- Name: FUNCTION worker_identity_recheck_days(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.worker_identity_recheck_days() TO anon;
GRANT ALL ON FUNCTION public.worker_identity_recheck_days() TO authenticated;
GRANT ALL ON FUNCTION public.worker_identity_recheck_days() TO service_role;


--
-- Name: FUNCTION worker_mark_complete(p_booking_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.worker_mark_complete(p_booking_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.worker_mark_complete(p_booking_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.worker_mark_complete(p_booking_id uuid) TO service_role;


--
-- Name: FUNCTION worker_professional_profile_ready(p_worker_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.worker_professional_profile_ready(p_worker_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.worker_professional_profile_ready(p_worker_id text) TO service_role;


--
-- Name: FUNCTION worker_start_job(p_booking_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.worker_start_job(p_booking_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.worker_start_job(p_booking_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.worker_start_job(p_booking_id uuid) TO service_role;


--
-- Name: FUNCTION worker_test_passed(p_worker_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.worker_test_passed(p_worker_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.worker_test_passed(p_worker_id text) TO service_role;


--
-- Name: TABLE activity_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.activity_logs TO anon;
GRANT ALL ON TABLE public.activity_logs TO authenticated;
GRANT ALL ON TABLE public.activity_logs TO service_role;


--
-- Name: SEQUENCE activity_logs_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.activity_logs_id_seq TO anon;
GRANT ALL ON SEQUENCE public.activity_logs_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.activity_logs_id_seq TO service_role;


--
-- Name: TABLE admin_audit_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.admin_audit_log TO anon;
GRANT ALL ON TABLE public.admin_audit_log TO authenticated;
GRANT ALL ON TABLE public.admin_audit_log TO service_role;


--
-- Name: TABLE admin_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.admin_logs TO anon;
GRANT ALL ON TABLE public.admin_logs TO authenticated;
GRANT ALL ON TABLE public.admin_logs TO service_role;


--
-- Name: SEQUENCE admin_logs_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.admin_logs_id_seq TO anon;
GRANT ALL ON SEQUENCE public.admin_logs_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.admin_logs_id_seq TO service_role;


--
-- Name: TABLE announcement_recipients; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,MAINTAIN ON TABLE public.announcement_recipients TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.announcement_recipients TO authenticated;
GRANT ALL ON TABLE public.announcement_recipients TO service_role;


--
-- Name: SEQUENCE announcement_recipients_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.announcement_recipients_id_seq TO anon;
GRANT ALL ON SEQUENCE public.announcement_recipients_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.announcement_recipients_id_seq TO service_role;


--
-- Name: TABLE announcements; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,MAINTAIN ON TABLE public.announcements TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.announcements TO authenticated;
GRANT ALL ON TABLE public.announcements TO service_role;


--
-- Name: SEQUENCE announcements_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.announcements_id_seq TO anon;
GRANT ALL ON SEQUENCE public.announcements_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.announcements_id_seq TO service_role;


--
-- Name: TABLE audit_logs; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.audit_logs TO anon;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.audit_logs TO authenticated;
GRANT ALL ON TABLE public.audit_logs TO service_role;


--
-- Name: TABLE bank_account_history; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.bank_account_history TO anon;
GRANT ALL ON TABLE public.bank_account_history TO authenticated;
GRANT ALL ON TABLE public.bank_account_history TO service_role;


--
-- Name: TABLE blocked_workers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.blocked_workers TO anon;
GRANT ALL ON TABLE public.blocked_workers TO authenticated;
GRANT ALL ON TABLE public.blocked_workers TO service_role;


--
-- Name: SEQUENCE blocked_workers_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.blocked_workers_id_seq TO anon;
GRANT ALL ON SEQUENCE public.blocked_workers_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.blocked_workers_id_seq TO service_role;


--
-- Name: TABLE blue_badge_subscriptions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.blue_badge_subscriptions TO anon;
GRANT ALL ON TABLE public.blue_badge_subscriptions TO authenticated;
GRANT ALL ON TABLE public.blue_badge_subscriptions TO service_role;


--
-- Name: TABLE booking_code_registry; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.booking_code_registry TO service_role;


--
-- Name: TABLE booking_conversations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.booking_conversations TO anon;
GRANT ALL ON TABLE public.booking_conversations TO authenticated;
GRANT ALL ON TABLE public.booking_conversations TO service_role;


--
-- Name: TABLE booking_messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.booking_messages TO anon;
GRANT ALL ON TABLE public.booking_messages TO authenticated;
GRANT ALL ON TABLE public.booking_messages TO service_role;


--
-- Name: TABLE booking_payments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.booking_payments TO anon;
GRANT ALL ON TABLE public.booking_payments TO authenticated;
GRANT ALL ON TABLE public.booking_payments TO service_role;


--
-- Name: TABLE booking_status_history; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.booking_status_history TO anon;
GRANT ALL ON TABLE public.booking_status_history TO authenticated;
GRANT ALL ON TABLE public.booking_status_history TO service_role;


--
-- Name: TABLE booking_status_labels; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.booking_status_labels TO anon;
GRANT ALL ON TABLE public.booking_status_labels TO authenticated;
GRANT ALL ON TABLE public.booking_status_labels TO service_role;


--
-- Name: TABLE chat_photo_usage; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.chat_photo_usage TO anon;
GRANT ALL ON TABLE public.chat_photo_usage TO authenticated;
GRANT ALL ON TABLE public.chat_photo_usage TO service_role;


--
-- Name: TABLE chat_rooms; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.chat_rooms TO service_role;


--
-- Name: SEQUENCE chat_rooms_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.chat_rooms_id_seq TO anon;
GRANT ALL ON SEQUENCE public.chat_rooms_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.chat_rooms_id_seq TO service_role;


--
-- Name: TABLE chat_usage; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.chat_usage TO anon;
GRANT ALL ON TABLE public.chat_usage TO authenticated;
GRANT ALL ON TABLE public.chat_usage TO service_role;


--
-- Name: TABLE commission_ledger; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.commission_ledger TO anon;
GRANT ALL ON TABLE public.commission_ledger TO authenticated;
GRANT ALL ON TABLE public.commission_ledger TO service_role;


--
-- Name: TABLE escrow_transactions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.escrow_transactions TO anon;
GRANT ALL ON TABLE public.escrow_transactions TO authenticated;
GRANT ALL ON TABLE public.escrow_transactions TO service_role;


--
-- Name: TABLE favorites; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.favorites TO anon;
GRANT ALL ON TABLE public.favorites TO authenticated;
GRANT ALL ON TABLE public.favorites TO service_role;


--
-- Name: SEQUENCE favorites_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.favorites_id_seq TO anon;
GRANT ALL ON SEQUENCE public.favorites_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.favorites_id_seq TO service_role;


--
-- Name: TABLE financial_audit_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.financial_audit_log TO anon;
GRANT ALL ON TABLE public.financial_audit_log TO authenticated;
GRANT ALL ON TABLE public.financial_audit_log TO service_role;


--
-- Name: TABLE financial_audit_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.financial_audit_logs TO anon;
GRANT ALL ON TABLE public.financial_audit_logs TO authenticated;
GRANT ALL ON TABLE public.financial_audit_logs TO service_role;


--
-- Name: SEQUENCE hotel_bookings_booking_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.hotel_bookings_booking_id_seq TO anon;
GRANT ALL ON SEQUENCE public.hotel_bookings_booking_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.hotel_bookings_booking_id_seq TO service_role;


--
-- Name: TABLE hotel_reviews; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.hotel_reviews TO anon;
GRANT ALL ON TABLE public.hotel_reviews TO authenticated;
GRANT ALL ON TABLE public.hotel_reviews TO service_role;


--
-- Name: SEQUENCE hotel_reviews_review_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.hotel_reviews_review_id_seq TO anon;
GRANT ALL ON SEQUENCE public.hotel_reviews_review_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.hotel_reviews_review_id_seq TO service_role;


--
-- Name: TABLE hotel_rooms; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.hotel_rooms TO anon;
GRANT ALL ON TABLE public.hotel_rooms TO authenticated;
GRANT ALL ON TABLE public.hotel_rooms TO service_role;


--
-- Name: SEQUENCE hotel_rooms_room_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.hotel_rooms_room_id_seq TO anon;
GRANT ALL ON SEQUENCE public.hotel_rooms_room_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.hotel_rooms_room_id_seq TO service_role;


--
-- Name: TABLE hotels; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.hotels TO anon;
GRANT ALL ON TABLE public.hotels TO authenticated;
GRANT ALL ON TABLE public.hotels TO service_role;


--
-- Name: SEQUENCE hotels_hotel_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.hotels_hotel_id_seq TO anon;
GRANT ALL ON SEQUENCE public.hotels_hotel_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.hotels_hotel_id_seq TO service_role;


--
-- Name: TABLE inspection_status_history; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.inspection_status_history TO anon;
GRANT ALL ON TABLE public.inspection_status_history TO authenticated;
GRANT ALL ON TABLE public.inspection_status_history TO service_role;


--
-- Name: TABLE listing_image_hashes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.listing_image_hashes TO anon;
GRANT ALL ON TABLE public.listing_image_hashes TO authenticated;
GRANT ALL ON TABLE public.listing_image_hashes TO service_role;


--
-- Name: SEQUENCE listing_image_hashes_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.listing_image_hashes_id_seq TO anon;
GRANT ALL ON SEQUENCE public.listing_image_hashes_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.listing_image_hashes_id_seq TO service_role;


--
-- Name: TABLE listing_reports; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.listing_reports TO anon;
GRANT ALL ON TABLE public.listing_reports TO authenticated;
GRANT ALL ON TABLE public.listing_reports TO service_role;


--
-- Name: TABLE message_requests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.message_requests TO service_role;


--
-- Name: SEQUENCE message_requests_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.message_requests_id_seq TO anon;
GRANT ALL ON SEQUENCE public.message_requests_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.message_requests_id_seq TO service_role;


--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notifications TO anon;
GRANT ALL ON TABLE public.notifications TO authenticated;
GRANT ALL ON TABLE public.notifications TO service_role;


--
-- Name: TABLE partner_support_conversations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,MAINTAIN ON TABLE public.partner_support_conversations TO anon;
GRANT SELECT,MAINTAIN ON TABLE public.partner_support_conversations TO authenticated;
GRANT ALL ON TABLE public.partner_support_conversations TO service_role;


--
-- Name: TABLE partner_support_messages; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,MAINTAIN ON TABLE public.partner_support_messages TO anon;
GRANT SELECT,MAINTAIN ON TABLE public.partner_support_messages TO authenticated;
GRANT ALL ON TABLE public.partner_support_messages TO service_role;


--
-- Name: TABLE payment_reversals; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.payment_reversals TO anon;
GRANT ALL ON TABLE public.payment_reversals TO authenticated;
GRANT ALL ON TABLE public.payment_reversals TO service_role;


--
-- Name: TABLE payments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.payments TO service_role;


--
-- Name: SEQUENCE payments_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.payments_id_seq TO anon;
GRANT ALL ON SEQUENCE public.payments_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.payments_id_seq TO service_role;


--
-- Name: TABLE platform_settings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,MAINTAIN ON TABLE public.platform_settings TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.platform_settings TO authenticated;
GRANT ALL ON TABLE public.platform_settings TO service_role;


--
-- Name: SEQUENCE platform_settings_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.platform_settings_id_seq TO anon;
GRANT ALL ON SEQUENCE public.platform_settings_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.platform_settings_id_seq TO service_role;


--
-- Name: TABLE private_call_preferences; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.private_call_preferences TO anon;
GRANT ALL ON TABLE public.private_call_preferences TO authenticated;
GRANT ALL ON TABLE public.private_call_preferences TO service_role;


--
-- Name: TABLE private_call_signals; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.private_call_signals TO anon;
GRANT ALL ON TABLE public.private_call_signals TO authenticated;
GRANT ALL ON TABLE public.private_call_signals TO service_role;


--
-- Name: TABLE private_calls; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.private_calls TO anon;
GRANT ALL ON TABLE public.private_calls TO authenticated;
GRANT ALL ON TABLE public.private_calls TO service_role;


--
-- Name: TABLE property_partner_earning_releases; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.property_partner_earning_releases TO anon;
GRANT ALL ON TABLE public.property_partner_earning_releases TO authenticated;
GRANT ALL ON TABLE public.property_partner_earning_releases TO service_role;


--
-- Name: TABLE property_types; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.property_types TO anon;
GRANT ALL ON TABLE public.property_types TO authenticated;
GRANT ALL ON TABLE public.property_types TO service_role;


--
-- Name: SEQUENCE property_types_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.property_types_id_seq TO anon;
GRANT ALL ON SEQUENCE public.property_types_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.property_types_id_seq TO service_role;


--
-- Name: TABLE registered_institutions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.registered_institutions TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.registered_institutions TO authenticated;
GRANT ALL ON TABLE public.registered_institutions TO service_role;


--
-- Name: TABLE rent_plan_cancellations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.rent_plan_cancellations TO anon;
GRANT ALL ON TABLE public.rent_plan_cancellations TO authenticated;
GRANT ALL ON TABLE public.rent_plan_cancellations TO service_role;


--
-- Name: TABLE rent_plan_contributions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.rent_plan_contributions TO anon;
GRANT ALL ON TABLE public.rent_plan_contributions TO authenticated;
GRANT ALL ON TABLE public.rent_plan_contributions TO service_role;


--
-- Name: TABLE rent_plans; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.rent_plans TO anon;
GRANT ALL ON TABLE public.rent_plans TO authenticated;
GRANT ALL ON TABLE public.rent_plans TO service_role;


--
-- Name: TABLE reservation_refunds; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.reservation_refunds TO anon;
GRANT ALL ON TABLE public.reservation_refunds TO authenticated;
GRANT ALL ON TABLE public.reservation_refunds TO service_role;


--
-- Name: TABLE reviews; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.reviews TO service_role;


--
-- Name: SEQUENCE reviews_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.reviews_id_seq TO anon;
GRANT ALL ON SEQUENCE public.reviews_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.reviews_id_seq TO service_role;


--
-- Name: TABLE role_change_history; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.role_change_history TO anon;
GRANT ALL ON TABLE public.role_change_history TO authenticated;
GRANT ALL ON TABLE public.role_change_history TO service_role;


--
-- Name: TABLE roommate_matches; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.roommate_matches TO anon;
GRANT ALL ON TABLE public.roommate_matches TO authenticated;
GRANT ALL ON TABLE public.roommate_matches TO service_role;


--
-- Name: TABLE roommate_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.roommate_profiles TO anon;
GRANT ALL ON TABLE public.roommate_profiles TO authenticated;
GRANT ALL ON TABLE public.roommate_profiles TO service_role;


--
-- Name: SEQUENCE roommate_profiles_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.roommate_profiles_id_seq TO anon;
GRANT ALL ON SEQUENCE public.roommate_profiles_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.roommate_profiles_id_seq TO service_role;


--
-- Name: TABLE roommate_search_results; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.roommate_search_results TO anon;
GRANT ALL ON TABLE public.roommate_search_results TO authenticated;
GRANT ALL ON TABLE public.roommate_search_results TO service_role;


--
-- Name: TABLE saved_listings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.saved_listings TO anon;
GRANT ALL ON TABLE public.saved_listings TO authenticated;
GRANT ALL ON TABLE public.saved_listings TO service_role;


--
-- Name: TABLE secrets; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.secrets TO anon;
GRANT ALL ON TABLE public.secrets TO authenticated;
GRANT ALL ON TABLE public.secrets TO service_role;


--
-- Name: TABLE service_categories; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.service_categories TO anon;
GRANT ALL ON TABLE public.service_categories TO authenticated;
GRANT ALL ON TABLE public.service_categories TO service_role;


--
-- Name: TABLE service_subcategories; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.service_subcategories TO anon;
GRANT ALL ON TABLE public.service_subcategories TO authenticated;
GRANT ALL ON TABLE public.service_subcategories TO service_role;


--
-- Name: TABLE staff_location_presence; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.staff_location_presence TO authenticated;
GRANT ALL ON TABLE public.staff_location_presence TO service_role;


--
-- Name: TABLE staff_permissions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.staff_permissions TO anon;
GRANT ALL ON TABLE public.staff_permissions TO authenticated;
GRANT ALL ON TABLE public.staff_permissions TO service_role;


--
-- Name: TABLE staff_reviews; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.staff_reviews TO anon;
GRANT ALL ON TABLE public.staff_reviews TO authenticated;
GRANT ALL ON TABLE public.staff_reviews TO service_role;


--
-- Name: TABLE staff_trust_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.staff_trust_profiles TO authenticated;
GRANT ALL ON TABLE public.staff_trust_profiles TO service_role;


--
-- Name: TABLE system_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.system_settings TO service_role;


--
-- Name: TABLE user_activity; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_activity TO anon;
GRANT ALL ON TABLE public.user_activity TO authenticated;
GRANT ALL ON TABLE public.user_activity TO service_role;


--
-- Name: TABLE user_counters; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_counters TO anon;
GRANT ALL ON TABLE public.user_counters TO authenticated;
GRANT ALL ON TABLE public.user_counters TO service_role;


--
-- Name: SEQUENCE user_counters_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.user_counters_id_seq TO anon;
GRANT ALL ON SEQUENCE public.user_counters_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.user_counters_id_seq TO service_role;


--
-- Name: TABLE user_id_counter; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_id_counter TO anon;
GRANT ALL ON TABLE public.user_id_counter TO authenticated;
GRANT ALL ON TABLE public.user_id_counter TO service_role;


--
-- Name: SEQUENCE user_id_counter_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.user_id_counter_id_seq TO anon;
GRANT ALL ON SEQUENCE public.user_id_counter_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.user_id_counter_id_seq TO service_role;


--
-- Name: TABLE user_ids; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_ids TO anon;
GRANT ALL ON TABLE public.user_ids TO authenticated;
GRANT ALL ON TABLE public.user_ids TO service_role;


--
-- Name: TABLE user_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_sessions TO anon;
GRANT ALL ON TABLE public.user_sessions TO authenticated;
GRANT ALL ON TABLE public.user_sessions TO service_role;


--
-- Name: TABLE verified_paystack_references; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.verified_paystack_references TO anon;
GRANT ALL ON TABLE public.verified_paystack_references TO authenticated;
GRANT ALL ON TABLE public.verified_paystack_references TO service_role;


--
-- Name: TABLE wallet_balances; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.wallet_balances TO service_role;


--
-- Name: TABLE wallet_transactions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.wallet_transactions TO anon;
GRANT ALL ON TABLE public.wallet_transactions TO authenticated;
GRANT ALL ON TABLE public.wallet_transactions TO service_role;


--
-- Name: TABLE wallets; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.wallets TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.wallets TO authenticated;
GRANT ALL ON TABLE public.wallets TO service_role;


--
-- Name: SEQUENCE wehouse_user_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.wehouse_user_id_seq TO anon;
GRANT ALL ON SEQUENCE public.wehouse_user_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.wehouse_user_id_seq TO service_role;


--
-- Name: TABLE withdrawal_requests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.withdrawal_requests TO anon;
GRANT ALL ON TABLE public.withdrawal_requests TO authenticated;
GRANT ALL ON TABLE public.withdrawal_requests TO service_role;


--
-- Name: TABLE withdrawals; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.withdrawals TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.withdrawals TO authenticated;
GRANT ALL ON TABLE public.withdrawals TO service_role;


--
-- Name: TABLE worker_bookings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.worker_bookings TO anon;
GRANT ALL ON TABLE public.worker_bookings TO authenticated;
GRANT ALL ON TABLE public.worker_bookings TO service_role;


--
-- Name: TABLE worker_identity_checks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.worker_identity_checks TO service_role;


--
-- Name: TABLE worker_service_coverage; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.worker_service_coverage TO anon;
GRANT ALL ON TABLE public.worker_service_coverage TO authenticated;
GRANT ALL ON TABLE public.worker_service_coverage TO service_role;


--
-- Name: TABLE worker_services; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.worker_services TO anon;
GRANT ALL ON TABLE public.worker_services TO authenticated;
GRANT ALL ON TABLE public.worker_services TO service_role;


--
-- Name: TABLE worker_test_attempts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.worker_test_attempts TO authenticated;
GRANT ALL ON TABLE public.worker_test_attempts TO service_role;


--
-- Name: TABLE worker_test_questions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.worker_test_questions TO service_role;


--
-- Name: TABLE worker_verification_reviews; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.worker_verification_reviews TO anon;
GRANT ALL ON TABLE public.worker_verification_reviews TO authenticated;
GRANT ALL ON TABLE public.worker_verification_reviews TO service_role;


--
-- Name: TABLE worker_verifications; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.worker_verifications TO anon;
GRANT ALL ON TABLE public.worker_verifications TO authenticated;
GRANT ALL ON TABLE public.worker_verifications TO service_role;


--
-- Name: TABLE workers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.workers TO anon;
GRANT ALL ON TABLE public.workers TO authenticated;
GRANT ALL ON TABLE public.workers TO service_role;


--
-- Name: SEQUENCE workers_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.workers_id_seq TO anon;
GRANT ALL ON SEQUENCE public.workers_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.workers_id_seq TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- PostgreSQL database dump complete
--


