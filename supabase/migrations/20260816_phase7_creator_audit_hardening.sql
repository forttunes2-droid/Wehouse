-- Phase 7 + Creator hardening
-- 1) Creator-facing change history becomes a sanitized server projection.
-- 2) Sensitive settings values are redacted before entering audit history.
-- 3) Worker booking lifecycle is role-safe and status-consistent.
-- 4) Creator/Admin booking oversight receives only the fields the UI needs.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. SETTINGS AUDIT: redact sensitive values before logging them.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_settings_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
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

  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
  LIMIT 1;

  BEGIN
    INSERT INTO public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
    VALUES(
      TG_OP,
      'platform_settings',
      v_key,
      jsonb_build_object('old_value',v_old,'new_value',v_new)::text,
      v_actor.user_id,
      v_actor.email
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'settings_audit_failed: action=%, key=%, error=%',TG_OP,v_key,SQLERRM;
  END;

  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;

-- Scrub historic secret-setting payloads as a one-time repair.
UPDATE public.audit_logs
SET details=jsonb_build_object('redacted',true,'setting',target_id)::text
WHERE target_type='platform_settings'
  AND lower(coalesce(target_id,'')) ~ '(secret|password|private[_-]?key|access[_-]?token|refresh[_-]?token|service[_-]?role|webhook[_-]?secret|api[_-]?secret)';

-- The browser must not query the raw audit table directly anymore.
DROP POLICY IF EXISTS audit_logs_admin_read ON public.audit_logs;
REVOKE SELECT ON public.audit_logs FROM authenticated;

-- Safe Creator-only projection. No raw details, IDs, emails, old/new payloads,
-- secret values or implementation metadata leave the database.
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
      a.id::text AS event_id,
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
    LEFT JOIN public.platform_settings ps
      ON a.target_type='platform_settings' AND ps.key=a.target_id
    LEFT JOIN public.profiles target_profile
      ON a.target_type='profiles' AND target_profile.user_id=a.target_id
  )
  SELECT p.event_id,p.actor_name,p.actor_role,p.action_label,p.area_label,p.subject_label,p.occurred_at
  FROM projected p
  WHERE nullif(trim(coalesce(p_search,'')),'') IS NULL
     OR lower(concat_ws(' ',p.actor_name,p.actor_role,p.action_label,p.area_label,p.subject_label)) LIKE '%'||lower(trim(p_search))||'%'
  ORDER BY p.occurred_at DESC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.creator_get_change_history(text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.creator_get_change_history(text,integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- B. CREATOR / ADMIN: safe shared Worker-booking oversight projection.
-- Scope is still decided by _admin_dashboard_actor(): Creator global, Admin branch.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_my_branch_worker_booking_summaries()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
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
    'needs_attention',wb.status IN ('booking_requested','waiting_payment','completed_pending_approval','disputed'),
    'has_dispute',wb.status='disputed'
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

REVOKE ALL ON FUNCTION public.admin_get_my_branch_worker_booking_summaries() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_my_branch_worker_booking_summaries() TO authenticated;

-- ---------------------------------------------------------------------------
-- C. PHASE 7: canonical Worker-booking lifecycle hardening.
-- ---------------------------------------------------------------------------
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

  SELECT * INTO v_worker
  FROM public.profiles
  WHERE user_id=p_worker_id AND role='worker'
  LIMIT 1;

  IF v_worker IS NULL THEN RAISE EXCEPTION 'Worker not found'; END IF;
  IF v_worker.worker_status<>'verified' OR v_worker.worker_verified IS DISTINCT FROM true THEN RAISE EXCEPTION 'Worker is not verified'; END IF;
  IF v_worker.available IS DISTINCT FROM true THEN RAISE EXCEPTION 'Worker is not accepting new bookings'; END IF;
  IF coalesce(v_worker.deleted,false) OR coalesce(v_worker.suspended,false) OR coalesce(v_worker.banned,false) THEN RAISE EXCEPTION 'Worker account is not active'; END IF;
  IF v_customer.user_id=p_worker_id THEN RAISE EXCEPTION 'Cannot book yourself'; END IF;

  v_service_ok := lower(trim(coalesce(v_worker.worker_occupation,'')))=lower(v_service)
    OR EXISTS(
      SELECT 1 FROM public.worker_services ws
      WHERE ws.worker_id=v_worker.user_id AND lower(trim(ws.service_name))=lower(v_service)
    )
    OR EXISTS(
      SELECT 1
      FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(v_worker.worker_skills)='array' THEN v_worker.worker_skills ELSE '[]'::jsonb END
      ) skill(value)
      WHERE lower(trim(skill.value))=lower(v_service)
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

CREATE OR REPLACE FUNCTION public.send_booking_message_v2(
  p_conversation_id uuid,
  p_content text DEFAULT '',
  p_attachments text[] DEFAULT '{}'::text[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_actor public.profiles;
  v_conv public.booking_conversations;
  v_booking public.worker_bookings;
  v_msg_id uuid;
  v_path text;
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND coalesce(deleted,false)=false
    AND coalesce(suspended,false)=false
    AND coalesce(banned,false)=false
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_conv FROM public.booking_conversations WHERE id=p_conversation_id;
  IF v_conv IS NULL THEN RAISE EXCEPTION 'Conversation not found'; END IF;
  IF v_actor.user_id NOT IN (v_conv.user_id,v_conv.worker_id) THEN RAISE EXCEPTION 'Not authorized to send messages in this conversation'; END IF;

  SELECT * INTO v_booking FROM public.worker_bookings WHERE id=v_conv.booking_id FOR UPDATE;
  IF v_booking IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF v_booking.status IN ('approved_released','cancelled','refunded') THEN RAISE EXCEPTION 'This job conversation is closed'; END IF;

  IF nullif(btrim(coalesce(p_content,'')),'') IS NULL AND coalesce(cardinality(p_attachments),0)=0 THEN
    RAISE EXCEPTION 'Message or attachment is required';
  END IF;
  IF coalesce(cardinality(p_attachments),0)>6 THEN RAISE EXCEPTION 'A maximum of 6 attachments can be sent at once'; END IF;

  FOREACH v_path IN ARRAY coalesce(p_attachments,'{}'::text[]) LOOP
    IF position(p_conversation_id::text||'/' IN coalesce(v_path,''))<>1 THEN
      RAISE EXCEPTION 'Invalid attachment path';
    END IF;
  END LOOP;

  INSERT INTO public.booking_messages(conversation_id,sender_id,content,attachments,created_at)
  VALUES(p_conversation_id,v_actor.user_id,coalesce(btrim(p_content),''),coalesce(p_attachments,'{}'::text[]),now())
  RETURNING id INTO v_msg_id;

  -- The first Worker reply means the request is actively being negotiated.
  IF v_actor.user_id=v_conv.worker_id AND v_booking.status='booking_requested' THEN
    UPDATE public.worker_bookings SET status='negotiating',updated_at=now() WHERE id=v_booking.id;
  END IF;

  UPDATE public.booking_conversations SET updated_at=now() WHERE id=p_conversation_id;
  RETURN v_msg_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.worker_accept_booking(
  p_booking_id uuid,
  p_negotiated_amount numeric,
  p_scheduled_date text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  w public.profiles;
  b public.worker_bookings;
  v_date date;
BEGIN
  SELECT * INTO w FROM public.profiles WHERE auth_id=auth.uid()::text FOR UPDATE;
  IF w IS NULL OR w.role<>'worker' THEN RAISE EXCEPTION 'Worker account required'; END IF;
  IF w.worker_status<>'verified' OR w.worker_verified IS DISTINCT FROM true THEN RAISE EXCEPTION 'Verified Worker account required'; END IF;
  IF coalesce(w.deleted,false) OR coalesce(w.suspended,false) OR coalesce(w.banned,false) THEN RAISE EXCEPTION 'Worker account is not active'; END IF;
  IF p_negotiated_amount IS NULL OR p_negotiated_amount<=0 THEN RAISE EXCEPTION 'Agreed amount must be positive'; END IF;

  IF nullif(trim(coalesce(p_scheduled_date,'')),'') IS NOT NULL THEN
    v_date:=p_scheduled_date::date;
    IF v_date<current_date THEN RAISE EXCEPTION 'Schedule date cannot be in the past'; END IF;
  END IF;

  SELECT * INTO b FROM public.worker_bookings WHERE id=p_booking_id FOR UPDATE;
  IF b IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF b.worker_id<>w.user_id THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF b.status NOT IN ('booking_requested','negotiating') THEN RAISE EXCEPTION 'Booking cannot be accepted in current status: %',b.status; END IF;

  UPDATE public.worker_bookings
  SET status='waiting_payment',
      negotiated_amount=round(p_negotiated_amount,2),
      agreed_amount=round(p_negotiated_amount,2),
      scheduled_date=coalesce(v_date,scheduled_date),
      updated_at=now()
  WHERE id=p_booking_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.worker_mark_complete(p_booking_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE w public.profiles; b public.worker_bookings;
BEGIN
  SELECT * INTO w FROM public.profiles WHERE auth_id=auth.uid()::text;
  IF w IS NULL OR w.role<>'worker' OR coalesce(w.deleted,false) OR coalesce(w.suspended,false) OR coalesce(w.banned,false) THEN
    RAISE EXCEPTION 'Active Worker account required';
  END IF;
  SELECT * INTO b FROM public.worker_bookings WHERE id=p_booking_id FOR UPDATE;
  IF b IS NULL OR b.worker_id<>w.user_id OR b.status<>'in_progress' THEN RAISE EXCEPTION 'Booking not found or not in progress'; END IF;
  UPDATE public.worker_bookings
  SET status='completed_pending_approval',worker_approved=true,marked_complete_at=now(),updated_at=now()
  WHERE id=p_booking_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_booking(p_booking_id uuid,p_reason text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE v_actor public.profiles; v_booking public.worker_bookings;
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

  UPDATE public.worker_bookings
  SET status='cancelled',cancellation_reason=trim(p_reason),cancelled_by=v_actor.user_id,updated_at=now()
  WHERE id=p_booking_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.customer_raise_dispute(p_booking_id uuid,p_reason text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE v_customer public.profiles; v_booking public.worker_bookings;
BEGIN
  SELECT * INTO v_customer
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND role='user'
    AND coalesce(deleted,false)=false
    AND coalesce(suspended,false)=false
    AND coalesce(banned,false)=false
  LIMIT 1;
  IF v_customer IS NULL THEN RAISE EXCEPTION 'Active customer account required'; END IF;
  IF length(trim(coalesce(p_reason,'')))<5 THEN RAISE EXCEPTION 'Please explain the dispute'; END IF;

  SELECT * INTO v_booking FROM public.worker_bookings WHERE id=p_booking_id FOR UPDATE;
  IF v_booking IS NULL OR v_booking.user_id<>v_customer.user_id OR v_booking.status NOT IN ('completed_pending_approval','in_progress','confirmed') THEN
    RAISE EXCEPTION 'Booking not eligible for dispute';
  END IF;

  UPDATE public.worker_bookings SET status='disputed',dispute_reason=trim(p_reason),updated_at=now() WHERE id=p_booking_id;
  UPDATE public.escrow_transactions
  SET status='disputed',updated_at=now()
  WHERE booking_id=p_booking_id AND booking_type='worker_booking' AND status NOT IN ('released','refunded');
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.customer_confirm_completion(p_booking_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_customer public.profiles;
  v_booking public.worker_bookings;
  v_wallet public.wallets;
  v_escrow public.escrow_transactions;
  v_new_balance numeric;
  v_release_ref text;
BEGIN
  SELECT * INTO v_customer
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND role='user'
    AND coalesce(deleted,false)=false
    AND coalesce(suspended,false)=false
    AND coalesce(banned,false)=false
  LIMIT 1;
  IF v_customer IS NULL THEN RAISE EXCEPTION 'Active customer account required'; END IF;

  SELECT * INTO v_booking FROM public.worker_bookings WHERE id=p_booking_id FOR UPDATE;
  IF v_booking IS NULL OR v_booking.user_id<>v_customer.user_id THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF v_booking.status<>'completed_pending_approval' THEN RAISE EXCEPTION 'Booking is not pending approval'; END IF;

  SELECT * INTO v_escrow
  FROM public.escrow_transactions
  WHERE booking_id=p_booking_id AND booking_type='worker_booking'
  FOR UPDATE;
  IF v_escrow IS NULL THEN RAISE EXCEPTION 'Escrow not found'; END IF;
  IF v_escrow.status IN ('released','refunded','disputed') THEN RAISE EXCEPTION 'Escrow already finalized: %',v_escrow.status; END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE owner_id=v_booking.worker_id AND owner_type='worker' FOR UPDATE;
  IF v_wallet IS NULL THEN
    INSERT INTO public.wallets(owner_id,owner_type) VALUES(v_booking.worker_id,'worker') RETURNING * INTO v_wallet;
  END IF;

  v_release_ref:='REL-'||p_booking_id::text||'-'||v_booking.worker_id;
  IF EXISTS(SELECT 1 FROM public.wallet_transactions WHERE reference_id=v_release_ref AND reference_type='escrow_release') THEN
    RAISE EXCEPTION 'Payment already released for this booking';
  END IF;

  v_new_balance:=coalesce(v_wallet.available_balance,0)+coalesce(v_booking.worker_receives,0);

  UPDATE public.worker_bookings
  SET status='approved_released',user_approved=true,completed_at=now(),updated_at=now()
  WHERE id=p_booking_id;

  UPDATE public.escrow_transactions
  SET status='released',released_at=now(),released_by=v_customer.user_id,updated_at=now()
  WHERE booking_id=p_booking_id AND booking_type='worker_booking';

  UPDATE public.wallets SET available_balance=v_new_balance,updated_at=now() WHERE id=v_wallet.id;

  INSERT INTO public.wallet_transactions(user_id,transaction_type,amount,balance_after,reference_id,reference_type,description,metadata,created_at)
  VALUES(
    v_booking.worker_id,'escrow_release',coalesce(v_booking.worker_receives,0),v_new_balance,
    v_release_ref,'escrow_release','Job completion payment for booking '||v_booking.booking_code,
    jsonb_build_object('booking_id',p_booking_id,'escrow_id',v_escrow.id,'customer_id',v_customer.user_id),now()
  );
  RETURN true;
END;
$$;

COMMIT;
