-- Follow-up refinements for Phase 7 / Creator hardening.
-- Keeps raw audit IDs out of the browser and ensures a Worker is booked for a
-- specific service they actually offer rather than a broad category label.

BEGIN;

CREATE OR REPLACE FUNCTION public.creator_get_change_history(
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 150
)
RETURNS TABLE(
  event_id text,
  actor_name text,
  actor_role text,
  action_label text,
  area_label text,
  subject_label text,
  occurred_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
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

CREATE OR REPLACE FUNCTION public.create_booking_request(
  p_worker_id text,
  p_service_type text,
  p_description text,
  p_address text,
  p_scheduled_date text,
  p_customer_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_customer public.profiles;
  v_worker public.profiles;
  v_booking_id uuid;
  v_conv_id uuid;
  v_code text;
  v_date date;
  v_service text:=trim(coalesce(p_service_type,''));
  v_service_ok boolean:=false;
  v_has_specific_services boolean:=false;
BEGIN
  SELECT * INTO v_customer FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_customer IS NULL OR v_customer.role<>'user' THEN RAISE EXCEPTION 'Regular user account required'; END IF;
  IF coalesce(v_customer.deleted,false) OR coalesce(v_customer.suspended,false) OR coalesce(v_customer.banned,false) THEN RAISE EXCEPTION 'Customer account is not active'; END IF;

  IF v_service='' THEN RAISE EXCEPTION 'Choose a service'; END IF;
  IF nullif(trim(coalesce(p_description,'')),'') IS NULL THEN RAISE EXCEPTION 'Describe the work you need'; END IF;
  IF nullif(trim(coalesce(p_address,'')),'') IS NULL THEN RAISE EXCEPTION 'Job location is required'; END IF;
  IF nullif(trim(coalesce(p_scheduled_date,'')),'') IS NOT NULL THEN
    v_date:=p_scheduled_date::date;
    IF v_date<current_date THEN RAISE EXCEPTION 'Schedule date cannot be in the past'; END IF;
  END IF;

  SELECT * INTO v_worker FROM public.profiles WHERE user_id=p_worker_id AND role='worker' LIMIT 1;
  IF v_worker IS NULL THEN RAISE EXCEPTION 'Worker not found'; END IF;
  IF v_worker.worker_status<>'verified' OR v_worker.worker_verified IS DISTINCT FROM true THEN RAISE EXCEPTION 'Worker is not verified'; END IF;
  IF v_worker.available IS DISTINCT FROM true THEN RAISE EXCEPTION 'Worker is not accepting new bookings'; END IF;
  IF coalesce(v_worker.deleted,false) OR coalesce(v_worker.suspended,false) OR coalesce(v_worker.banned,false) THEN RAISE EXCEPTION 'Worker account is not active'; END IF;
  IF v_customer.user_id=p_worker_id THEN RAISE EXCEPTION 'Cannot book yourself'; END IF;

  v_has_specific_services :=
    EXISTS(SELECT 1 FROM public.worker_services ws WHERE ws.worker_id=v_worker.user_id)
    OR (jsonb_typeof(v_worker.worker_skills)='array' AND jsonb_array_length(v_worker.worker_skills)>0);

  v_service_ok :=
    EXISTS(SELECT 1 FROM public.worker_services ws WHERE ws.worker_id=v_worker.user_id AND lower(trim(ws.service_name))=lower(v_service))
    OR EXISTS(
      SELECT 1
      FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(v_worker.worker_skills)='array' THEN v_worker.worker_skills ELSE '[]'::jsonb END) skill(value)
      WHERE lower(trim(skill.value))=lower(v_service)
    )
    OR (
      NOT v_has_specific_services
      AND lower(trim(coalesce(v_worker.worker_occupation,'')))=lower(v_service)
    );

  IF NOT v_service_ok THEN RAISE EXCEPTION 'This Worker does not offer the selected service'; END IF;

  v_code:='WH-'||upper(substring(md5(gen_random_uuid()::text) from 1 for 8));
  INSERT INTO public.worker_bookings(
    booking_code,user_id,worker_id,service_type,description,address,scheduled_date,
    agreed_amount,wehouse_fee,worker_commission,worker_receives,status,customer_message,created_at,updated_at
  ) VALUES(
    v_code,v_customer.user_id,v_worker.user_id,v_service,trim(p_description),trim(p_address),v_date,
    0,0,0,0,'booking_requested',nullif(trim(coalesce(p_customer_message,'')),''),now(),now()
  ) RETURNING id INTO v_booking_id;

  INSERT INTO public.booking_conversations(booking_id,user_id,worker_id,status,created_at,updated_at)
  VALUES(v_booking_id,v_customer.user_id,v_worker.user_id,'active',now(),now())
  RETURNING id INTO v_conv_id;
  UPDATE public.worker_bookings SET booking_conversation_id=v_conv_id WHERE id=v_booking_id;

  IF nullif(trim(coalesce(p_customer_message,'')),'') IS NOT NULL THEN
    INSERT INTO public.booking_messages(conversation_id,sender_id,content,created_at)
    VALUES(v_conv_id,v_customer.user_id,trim(p_customer_message),now());
  END IF;

  RETURN jsonb_build_object('booking_id',v_booking_id,'conversation_id',v_conv_id,'booking_code',v_code);
END;
$$;

COMMIT;
