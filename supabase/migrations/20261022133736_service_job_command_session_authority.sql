begin;
-- Interactive Service Worker/customer commands share live trusted-device authority.
CREATE OR REPLACE FUNCTION public.cancel_booking(p_booking_id uuid, p_reason text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor public.profiles;
  v_booking public.worker_bookings;
BEGIN
  if not public._property_document_session_active() then raise exception 'Active trusted session required'; end if;
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND coalesce(deleted,false)=false
    AND coalesce(suspended,false)=false
    AND coalesce(banned,false)=false
  LIMIT 1;

  IF v_actor IS NULL OR NOT (public.current_actor_has_personal_workspace() OR public.current_actor_has_workspace('worker')) THEN RAISE EXCEPTION 'Active booking participant required'; END IF;
  IF nullif(trim(coalesce(p_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'Cancellation reason is required'; END IF;

  SELECT * INTO v_booking FROM public.worker_bookings WHERE id=p_booking_id FOR UPDATE;
  IF v_booking IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF v_actor.user_id NOT IN (v_booking.user_id,v_booking.worker_id) THEN RAISE EXCEPTION 'Not authorized to cancel this booking'; END IF;
  IF v_actor.user_id=v_booking.user_id AND NOT public.current_actor_has_personal_workspace() THEN RAISE EXCEPTION 'Active Personal account required'; END IF;
  IF v_actor.user_id=v_booking.worker_id AND NOT public.current_actor_has_workspace('worker') THEN RAISE EXCEPTION 'Active Service Worker workspace required'; END IF;
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
$function$;
CREATE OR REPLACE FUNCTION public.customer_confirm_completion(p_booking_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles; v_booking public.worker_bookings;
  v_protection public.payment_protection_transactions; v_from text;
begin
  if not public._property_document_session_active() then raise exception 'Active trusted session required'; end if;
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text and not coalesce(deleted,false)
    and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor.user_id is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  select * into v_booking from public.worker_bookings where id=p_booking_id for update;
  if v_booking.id is null or v_booking.user_id<>v_actor.user_id then
    raise exception 'Job not found';
  end if;
  if v_booking.status='approved_released' then return true; end if;
  if v_booking.canonical_job_state='completed' and v_booking.user_approved is true
    and exists(select 1 from public.financial_action_outbox a
      where a.idempotency_key='release_worker_payment:'||p_booking_id
        and a.payment_protection_id=v_booking.payment_protection_id
        and a.subject_id=p_booking_id::text and a.action_type='release_worker_payment')
  then return true; end if;
  if v_booking.status<>'completed_pending_approval'
    or coalesce(v_booking.canonical_job_state,'')<>'completion_marked' then
    raise exception 'Worker has not marked this job complete';
  end if;
  if v_booking.risk_flag or v_booking.payment_conflict or v_booking.chargeback_open
    or exists(select 1 from public.worker_user_blocks b
      where (b.blocker_user_id=v_booking.user_id and b.blocked_user_id=v_booking.worker_id)
         or (b.blocker_user_id=v_booking.worker_id and b.blocked_user_id=v_booking.user_id))
    or exists(select 1 from public.operational_cases c
      where c.subject_type='worker_job' and c.subject_id=v_booking.id::text
        and c.status not in('resolved','closed')) then
    raise exception 'This job needs controlled WeHouse review before release';
  end if;
  select * into v_protection from public.payment_protection_transactions
  where id=v_booking.payment_protection_id for update;
  if v_protection.id is null or v_protection.protection_state not in('protected','release_eligible') then
    raise exception 'Worker Payment Protection is not releasable';
  end if;
  if v_protection.protection_state='protected' then
    insert into public.payment_protection_transitions(
      payment_protection_id,from_state,to_state,event_type,event_key,
      actor_user_id,actor_type,metadata
    ) values(v_protection.id,'protected','release_eligible',
      'customer_confirmed_completion','worker-customer-release-eligible:'||p_booking_id,
      v_actor.user_id,'customer',jsonb_build_object('worker_booking_id',p_booking_id))
    on conflict(event_key) do nothing;
    update public.payment_protection_transactions set protection_state='release_eligible',
      status='release_eligible',release_eligible_at=now(),updated_at=now()
    where id=v_protection.id and protection_state='protected';
  end if;
  v_from:=v_booking.canonical_job_state;
  update public.worker_bookings set canonical_job_state='completed',user_approved=true,
    completed_at=coalesce(completed_at,now()),
    help_until=coalesce(help_until,now()+interval '3 days'),
    review_edit_until=coalesce(review_edit_until,now()+interval '48 hours'),
    updated_at=now() where id=p_booking_id;
  insert into public.worker_job_transitions(
    worker_booking_id,from_state,to_state,event_type,event_key,actor_user_id,
    actor_type,policy_version_id,metadata
  ) values(p_booking_id,v_from,'completed','customer_confirmed_completion',
    'worker-customer-completed:'||p_booking_id,v_actor.user_id,'customer',
    v_booking.policy_version_id,jsonb_build_object('release_queued',true))
  on conflict(event_key) do nothing;
  insert into public.financial_action_outbox(
    action_type,subject_type,subject_id,payment_protection_id,amount,
    idempotency_key,metadata
  ) select 'release_worker_payment','worker_job',p_booking_id::text,v_protection.id,
    v_protection.amount_total-v_protection.released_amount-v_protection.refunded_amount,
    'release_worker_payment:'||p_booking_id,
    jsonb_build_object('trigger','customer_confirmed_completion','customer_id',v_actor.user_id)
  where v_protection.amount_total-v_protection.released_amount-v_protection.refunded_amount>0
  on conflict(idempotency_key) do nothing;
  return true;
end
$function$;
CREATE OR REPLACE FUNCTION public.customer_raise_dispute(p_booking_id uuid, p_reason text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles; v_booking public.worker_bookings;
  v_protection public.payment_protection_transactions; v_from text; v_case jsonb;
begin
  if not public._property_document_session_active() then raise exception 'Active trusted session required'; end if;
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text and not coalesce(deleted,false)
    and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor.user_id is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  if length(btrim(coalesce(p_reason,'')))<5 then raise exception 'Explain what needs review'; end if;
  select * into v_booking from public.worker_bookings where id=p_booking_id for update;
  if v_booking.id is null or v_booking.user_id<>v_actor.user_id
    or v_booking.status not in('confirmed','in_progress','completed_pending_approval') then
    raise exception 'Job is not eligible for review';
  end if;
  select * into v_protection from public.payment_protection_transactions
  where id=v_booking.payment_protection_id for update;
  if v_protection.id is null or v_protection.protection_state not in('protected','release_eligible','disputed') then
    raise exception 'Worker Payment Protection is unavailable';
  end if;
  if v_protection.protection_state<>'disputed' then
    insert into public.payment_protection_transitions(
      payment_protection_id,from_state,to_state,event_type,event_key,
      actor_user_id,actor_type,reason,metadata
    ) values(v_protection.id,v_protection.protection_state,'disputed',
      'customer_requested_job_review','worker-disputed:'||p_booking_id,
      v_actor.user_id,'customer',btrim(p_reason),jsonb_build_object('worker_booking_id',p_booking_id))
    on conflict(event_key) do nothing;
    update public.payment_protection_transactions set protection_state='disputed',
      status='disputed',updated_at=now() where id=v_protection.id;
  end if;
  v_from:=coalesce(v_booking.canonical_job_state,
    case v_booking.status when 'confirmed' then 'confirmed' when 'in_progress' then 'in_progress'
      else 'completion_marked' end);
  update public.worker_bookings set status='disputed',canonical_job_state='disputed',
    dispute_reason=btrim(p_reason),updated_at=now() where id=p_booking_id;
  insert into public.worker_job_transitions(
    worker_booking_id,from_state,to_state,event_type,event_key,actor_user_id,
    actor_type,policy_version_id,metadata
  ) values(p_booking_id,v_from,'disputed','customer_requested_job_review',
    'worker-job-disputed:'||p_booking_id,v_actor.user_id,'customer',
    v_booking.policy_version_id,jsonb_build_object('reason',btrim(p_reason)))
  on conflict(event_key) do nothing;
  update public.escrow_transactions set status='disputed',updated_at=now()
  where booking_id=p_booking_id and booking_type='worker_booking'
    and status not in('released','refunded');
  v_case:=public.open_contextual_case_conversation(
    'worker_job_issue','worker_job',p_booking_id::text,btrim(p_reason),
    jsonb_build_object('booking_code',v_booking.booking_code,
      'service_type',v_booking.service_type,'worker_id',v_booking.worker_id,
      'payment_protection_id',v_protection.id)
  );
  return true;
end
$function$;
CREATE OR REPLACE FUNCTION public.worker_accept_booking(p_booking_id uuid, p_negotiated_amount numeric, p_scheduled_date text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare w public.profiles;b public.worker_bookings;v_date date;
begin
  if not public._property_document_session_active() then raise exception 'Active trusted session required'; end if;
  select * into w from public.profiles where auth_id=auth.uid()::text for update;
  if w is null or not public.user_has_active_workspace(w.user_id,'worker') then raise exception 'Worker account required'; end if;
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
$function$;
CREATE OR REPLACE FUNCTION public.worker_mark_complete(p_booking_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor public.profiles; v_booking public.worker_bookings; v_from text;
begin
  if not public._property_document_session_active() then raise exception 'Active trusted session required'; end if;
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text and not coalesce(deleted,false)
    and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor.user_id is null or not public.current_actor_has_workspace('worker') then
    raise exception 'Active Worker workspace required';
  end if;
  select * into v_booking from public.worker_bookings where id=p_booking_id for update;
  if v_booking.id is null or v_booking.worker_id<>v_actor.user_id then
    raise exception 'Job not found';
  end if;
  if v_booking.status='completed_pending_approval'
    and v_booking.canonical_job_state='completion_marked' then return true; end if;
  if v_booking.status<>'in_progress' then raise exception 'Job is not in progress'; end if;
  v_from:=coalesce(v_booking.canonical_job_state,'in_progress');
  if v_from<>'in_progress' then raise exception 'Canonical job is not in progress'; end if;
  update public.worker_bookings set
    status='completed_pending_approval',canonical_job_state='completion_marked',
    worker_approved=true,marked_complete_at=coalesce(marked_complete_at,now()),
    release_eligible_at=now()+interval '24 hours',
    help_until=coalesce(help_until,now()+interval '3 days'),updated_at=now()
  where id=p_booking_id;
  insert into public.worker_job_transitions(
    worker_booking_id,from_state,to_state,event_type,event_key,actor_user_id,
    actor_type,policy_version_id,metadata
  ) values(p_booking_id,v_from,'completion_marked','worker_marked_complete',
    'worker-completion-marked:'||p_booking_id,v_actor.user_id,'worker',
    v_booking.policy_version_id,jsonb_build_object(
      'release_eligible_after_hours',24,'reminder_available_after_hours',12,
      'help_window_days',3)) on conflict(event_key) do nothing;
  return true;
end
$function$;
CREATE OR REPLACE FUNCTION public.worker_start_job(p_booking_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor public.profiles; v_booking public.worker_bookings; v_from text;
begin
  if not public._property_document_session_active() then raise exception 'Active trusted session required'; end if;
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text and not coalesce(deleted,false)
    and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor.user_id is null or not public.current_actor_has_workspace('worker')
    or v_actor.worker_status<>'verified' or v_actor.worker_verified is distinct from true then
    raise exception 'Active verified Worker workspace required';
  end if;
  if not public.worker_identity_is_current(v_actor.user_id) then
    raise exception 'Repeat your WeHouse identity check before starting new work';
  end if;
  select * into v_booking from public.worker_bookings where id=p_booking_id for update;
  if v_booking.id is null or v_booking.worker_id<>v_actor.user_id
    or v_booking.status<>'confirmed' then raise exception 'Job is not ready to start'; end if;
  if v_booking.payment_protection_id is null or not exists(
    select 1 from public.payment_protection_transactions p
    where p.id=v_booking.payment_protection_id and p.protection_state='protected'
  ) then raise exception 'Payment Protection must be confirmed before work starts'; end if;
  v_from:=coalesce(v_booking.canonical_job_state,'confirmed');
  if v_from<>'confirmed' then raise exception 'Canonical job is not ready to start'; end if;
  update public.worker_bookings set status='in_progress',canonical_job_state='in_progress',
    started_at=coalesce(started_at,now()),updated_at=now() where id=p_booking_id;
  insert into public.worker_job_transitions(
    worker_booking_id,from_state,to_state,event_type,event_key,actor_user_id,
    actor_type,policy_version_id,metadata
  ) values(p_booking_id,v_from,'in_progress','worker_started',
    'worker-started:'||p_booking_id,v_actor.user_id,'worker',v_booking.policy_version_id,
    '{}'::jsonb) on conflict(event_key) do nothing;
  return true;
end
$function$;
CREATE OR REPLACE FUNCTION public.cancel_my_worker_booking(p_booking_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor text:=public.current_profile_user_id();
  v_booking public.worker_bookings;
  v_protection public.payment_protection_transactions;
  v_state text; v_pct numeric; v_amount numeric; v_remaining numeric;
begin
  if not public._property_document_session_active() then raise exception 'Active trusted session required'; end if;
  if v_actor is null then raise exception 'Sign in required'; end if;
  select * into v_booking from public.worker_bookings where id=p_booking_id for update;
  if v_booking.id is null or v_booking.user_id<>v_actor then raise exception 'Booking not found'; end if;
  v_state:=coalesce(v_booking.canonical_job_state,v_booking.status);
  if v_state='cancelled' then return jsonb_build_object('cancelled',true,'already',true); end if;
  if v_state in('completed','completion_marked','disputed','refunded')
     or v_booking.started_at is not null or v_state='in_progress' then
    raise exception 'Work has started. Ask for a refund review instead.';
  end if;

  if v_booking.payment_protection_id is not null then
    select * into v_protection from public.payment_protection_transactions
    where id=v_booking.payment_protection_id for update;
    if v_protection.id is not null and v_protection.payer_user_id=v_actor
       and v_protection.protection_state in('protected','release_eligible') then
      v_remaining:=v_protection.amount_total-v_protection.released_amount-v_protection.refunded_amount;
      v_pct:=private.worker_refund_rule('before_start_refund_percent');
      v_amount:=round(v_remaining*v_pct/100,2);
      insert into public.payment_protection_transitions(payment_protection_id,from_state,to_state,event_type,event_key,actor_user_id,actor_type,metadata)
      values(v_protection.id,v_protection.protection_state,'risk_held','worker_cancelled_before_start','worker-cancel:'||p_booking_id,v_actor,'customer',jsonb_build_object('refund_percent',v_pct))
      on conflict(event_key) do nothing;
      update public.payment_protection_transactions set protection_state='risk_held',status='risk_held',risk_held_at=now(),updated_at=now() where id=v_protection.id;
      if v_amount>0 then
        insert into public.financial_action_outbox(action_type,subject_type,subject_id,payment_protection_id,amount,idempotency_key,metadata)
        values('refund_worker_cancellation','worker_job',p_booking_id::text,v_protection.id,v_amount,'refund_worker_cancellation:'||p_booking_id,
          jsonb_build_object('refund_percent',v_pct,'basis','amount_paid'))
        on conflict(idempotency_key) do nothing;
      end if;
      if v_remaining-v_amount>0 then
        insert into public.financial_action_outbox(action_type,subject_type,subject_id,payment_protection_id,amount,idempotency_key,metadata)
        values('release_worker_payment','worker_job',p_booking_id::text,v_protection.id,v_remaining-v_amount,'worker-cancel-release:'||p_booking_id,
          jsonb_build_object('trigger','cancel_before_start_retained_share'))
        on conflict(idempotency_key) do nothing;
      end if;
    end if;
  end if;

  insert into public.worker_job_transitions(worker_booking_id,from_state,to_state,event_type,event_key,actor_user_id,actor_type,policy_version_id,metadata)
  values(p_booking_id,v_state,'cancelled','customer_cancelled_before_start','worker-cancel-state:'||p_booking_id,v_actor,'customer',v_booking.policy_version_id,jsonb_build_object('reason',left(coalesce(p_reason,''),500)))
  on conflict(event_key) do nothing;
  update public.worker_bookings set status='cancelled',canonical_job_state='cancelled',cancelled_by='customer',
    cancellation_reason=left(nullif(btrim(coalesce(p_reason,'')),''),500),updated_at=now() where id=p_booking_id;
  return jsonb_build_object('cancelled',true,'refund_amount',coalesce(v_amount,0),'refund_percent',coalesce(v_pct,0));
end $function$;
CREATE OR REPLACE FUNCTION public.create_booking_request(p_worker_id text, p_service_type text, p_description text, p_address text, p_scheduled_date text, p_customer_message text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_customer public.profiles;
  v_worker public.profiles;
  v_booking_id uuid;
  v_conversation_id uuid;
  v_code text;
  v_date date;
  v_service text:=trim(coalesce(p_service_type,''));
  v_service_ok boolean:=false;
  v_has_specific_services boolean:=false;
begin
  if not public._property_document_session_active() then raise exception 'Active trusted session required'; end if;
  select * into v_customer from public.profiles
  where auth_id=(select auth.uid())::text limit 1;
  if v_customer is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  if coalesce(v_customer.deleted,false)
     or coalesce(v_customer.suspended,false)
     or coalesce(v_customer.banned,false) then
    raise exception 'Customer account is not active';
  end if;
  if v_service='' then raise exception 'Choose a service'; end if;
  if nullif(trim(coalesce(p_description,'')),'') is null then
    raise exception 'Describe the work you need';
  end if;
  if nullif(trim(coalesce(p_address,'')),'') is null then
    raise exception 'Job location is required';
  end if;
  if nullif(trim(coalesce(p_scheduled_date,'')),'') is not null then
    v_date:=p_scheduled_date::date;
    if v_date<current_date then raise exception 'Schedule date cannot be in the past'; end if;
  end if;
  select * into v_worker from public.profiles
  where user_id=p_worker_id limit 1;
  if v_worker is null
     or not public.user_has_active_workspace(p_worker_id,'worker') then
    raise exception 'Worker not found';
  end if;
  if v_worker.worker_status<>'verified'
     or v_worker.worker_verified is distinct from true then
    raise exception 'Worker is not verified';
  end if;
  if not public.worker_identity_is_current(v_worker.user_id) then
    raise exception 'This Worker is temporarily unavailable while identity is re-checked';
  end if;
  if v_worker.available is distinct from true then
    raise exception 'Worker is not accepting new bookings';
  end if;
  if coalesce(v_worker.deleted,false)
     or coalesce(v_worker.suspended,false)
     or coalesce(v_worker.banned,false) then
    raise exception 'Worker account is not active';
  end if;
  if v_customer.user_id=p_worker_id then raise exception 'Cannot book yourself'; end if;
  v_has_specific_services:=exists(
    select 1 from public.worker_services service
    where service.worker_id=v_worker.user_id
  ) or (
    jsonb_typeof(v_worker.worker_skills)='array'
    and jsonb_array_length(v_worker.worker_skills)>0
  );
  v_service_ok:=exists(
    select 1 from public.worker_services service
    where service.worker_id=v_worker.user_id
      and lower(trim(service.service_name))=lower(v_service)
  ) or exists(
    select 1
    from jsonb_array_elements_text(
      case when jsonb_typeof(v_worker.worker_skills)='array'
        then v_worker.worker_skills else '[]'::jsonb end
    ) skill(value)
    where lower(trim(skill.value))=lower(v_service)
  ) or (
    not v_has_specific_services
    and lower(trim(coalesce(v_worker.worker_occupation,'')))=lower(v_service)
  );
  if not v_service_ok then
    raise exception 'This Worker does not offer the selected service';
  end if;
  v_code:='WH-'||upper(substring(md5(gen_random_uuid()::text) from 1 for 8));
  insert into public.worker_bookings(
    booking_code,user_id,worker_id,service_type,description,address,
    scheduled_date,agreed_amount,wehouse_fee,worker_commission,
    worker_receives,status,customer_message,created_at,updated_at
  ) values(
    v_code,v_customer.user_id,v_worker.user_id,v_service,
    trim(p_description),trim(p_address),v_date,0,0,0,0,
    'booking_requested',nullif(trim(coalesce(p_customer_message,'')),''),
    now(),now()
  ) returning id into v_booking_id;
  insert into public.booking_conversations(
    booking_id,user_id,worker_id,status,created_at,updated_at
  ) values(
    v_booking_id,v_customer.user_id,v_worker.user_id,'active',now(),now()
  ) returning id into v_conversation_id;
  update public.worker_bookings
  set booking_conversation_id=v_conversation_id
  where id=v_booking_id;
  if nullif(trim(coalesce(p_customer_message,'')),'') is not null then
    insert into public.booking_messages(
      conversation_id,sender_id,content,created_at
    ) values(
      v_conversation_id,v_customer.user_id,trim(p_customer_message),now()
    );
  end if;
  return jsonb_build_object(
    'booking_id',v_booking_id,'conversation_id',v_conversation_id,
    'booking_code',v_code
  );
end
$function$;
CREATE OR REPLACE FUNCTION public.request_worker_refund_review(p_booking_id uuid, p_kind text, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor text:=public.current_profile_user_id();
  v_booking public.worker_bookings; v_protection public.payment_protection_transactions; v_id uuid;
begin
  if not public._property_document_session_active() then raise exception 'Active trusted session required'; end if;
  if v_actor is null then raise exception 'Sign in required'; end if;
  if char_length(btrim(coalesce(p_reason,'')))<10 then raise exception 'Please describe what happened (at least 10 characters)'; end if;
  select * into v_booking from public.worker_bookings where id=p_booking_id for update;
  if v_booking.id is null or v_booking.user_id<>v_actor then raise exception 'Booking not found'; end if;
  select review_id into v_id from public.worker_refund_reviews where worker_booking_id=p_booking_id and status='open';
  if v_id is not null then return v_id; end if;
  select * into v_protection from public.payment_protection_transactions where id=v_booking.payment_protection_id for update;
  if v_protection.id is null or v_protection.protection_state not in('protected','release_eligible') then
    raise exception 'There is no protected payment to review';
  end if;
  insert into public.worker_refund_reviews(worker_booking_id,requested_by,kind,reason)
  values(p_booking_id,v_actor,p_kind,btrim(p_reason)) returning review_id into v_id;
  insert into public.payment_protection_transitions(payment_protection_id,from_state,to_state,event_type,event_key,actor_user_id,actor_type,metadata)
  values(v_protection.id,v_protection.protection_state,'disputed','worker_refund_review_requested','worker-refund-review:'||v_id,v_actor,'customer',jsonb_build_object('kind',p_kind))
  on conflict(event_key) do nothing;
  update public.payment_protection_transactions set protection_state='disputed',status='disputed',updated_at=now() where id=v_protection.id;
  insert into public.worker_job_transitions(worker_booking_id,from_state,to_state,event_type,event_key,actor_user_id,actor_type,policy_version_id,metadata)
  values(p_booking_id,coalesce(v_booking.canonical_job_state,v_booking.status),'disputed','refund_review_requested','worker-refund-review-state:'||v_id,v_actor,'customer',v_booking.policy_version_id,jsonb_build_object('kind',p_kind))
  on conflict(event_key) do nothing;
  update public.worker_bookings set canonical_job_state='disputed',updated_at=now() where id=p_booking_id;
  return v_id;
end $function$;
commit;
