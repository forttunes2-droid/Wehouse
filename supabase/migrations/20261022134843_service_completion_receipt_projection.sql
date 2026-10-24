begin;
-- Completion acknowledgement and money release are separate facts.
create or replace function public.worker_booking_money_state(p_payment_status text,p_protection_status text)
returns text language sql immutable set search_path='pg_catalog','public' as $function$
select case
 when lower(coalesce(p_protection_status,'')) in ('refunded','reversed') then 'refunded'
 when lower(coalesce(p_protection_status,'')) in ('released','paid_out') then 'released'
 when lower(coalesce(p_protection_status,'')) in ('release_eligible','release_pending','releasing') then 'release_pending'
 when lower(coalesce(p_protection_status,'')) in ('review','under_review','risk_held','frozen','disputed') then 'review'
 when lower(coalesce(p_protection_status,'')) in ('protected','payment_protected','secured','held','holding') then 'protected'
 when lower(coalesce(p_payment_status,'')) in ('refunded','reversed') then 'refunded'
 when lower(coalesce(p_payment_status,'')) in ('review_required','paid','completed') then 'review'
 when lower(coalesce(p_payment_status,'')) in ('pending','payment_pending','processing') then 'payment_pending'
 else 'unpaid' end
$function$;
CREATE OR REPLACE FUNCTION public.get_my_worker_booking_details(p_booking_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
  v_booking public.worker_bookings;
  v_customer public.profiles;
  v_worker public.profiles;
  v_payment_status text;
  v_protection_status text;
  v_payment_released_at timestamptz;
  v_job_support_until timestamptz;
  v_job_support_open boolean;
begin
  if not public._property_document_session_active() then raise exception 'Active trusted session required'; end if;
  select profile.* into v_actor
  from public.profiles profile
  where profile.auth_id=(select auth.uid())::text
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
  limit 1;
  if v_actor.user_id is null then raise exception 'Authentication required'; end if;

  select * into v_booking from public.worker_bookings where id=p_booking_id;
  if v_booking.id is null then return null; end if;
  if v_actor.user_id is distinct from v_booking.user_id
     and v_actor.user_id is distinct from v_booking.worker_id then
    raise exception 'Booking participant access required';
  end if;

  select * into v_customer from public.profiles where user_id=v_booking.user_id limit 1;
  select * into v_worker from public.profiles where user_id=v_booking.worker_id limit 1;

  select payment.status into v_payment_status
  from public.booking_payments payment
  where payment.worker_booking_id=v_booking.id
    and payment.purpose='worker_booking'
  order by case payment.status
    when 'review_required' then 0
    when 'refunded' then 1
    when 'reversed' then 1
    when 'paid' then 2
    when 'completed' then 2
    when 'pending' then 3
    when 'processing' then 3
    else 4
  end,
  payment.updated_at desc nulls last,
  payment.created_at desc nulls last,
  payment.id desc
  limit 1;

  select protection.protection_state,protection.released_at
  into v_protection_status,v_payment_released_at
  from public.payment_protection_transactions protection
  where protection.id=v_booking.payment_protection_id
    and protection.payer_user_id=v_booking.user_id and protection.payee_user_id=v_booking.worker_id
    and (protection.subject_id=v_booking.id::text or protection.booking_id=v_booking.id)
  order by protection.updated_at desc,protection.created_at desc,protection.id desc
  limit 1;

  v_job_support_until:=case
    when lower(coalesce(v_protection_status,''))='released'
      and v_payment_released_at is not null
    then v_payment_released_at+interval '72 hours'
    else null
  end;
  v_job_support_open:=case
    when lower(coalesce(v_payment_status,''))='review_required'
      or lower(coalesce(v_protection_status,'')) in ('review','under_review','disputed','risk_held','frozen')
      then true
    when lower(coalesce(v_protection_status,''))='released'
      then v_job_support_until is not null and now()<v_job_support_until
    when lower(coalesce(v_booking.status,'')) in ('cancelled','refunded')
      then false
    else true
  end;

  return jsonb_build_object(
    'id',v_booking.id,'booking_code',v_booking.booking_code,'status',v_booking.status,
    'canonical_job_state',v_booking.canonical_job_state,'user_approved',v_booking.user_approved,
    'service_type',v_booking.service_type,'description',v_booking.description,
    'customer_message',v_booking.customer_message,'request_attachments',v_booking.request_attachments,
    'address',v_booking.address,'service_latitude',v_booking.service_latitude,
    'service_longitude',v_booking.service_longitude,
    'service_location_accuracy_m',v_booking.service_location_accuracy_m,
    'service_location_source',v_booking.service_location_source,
    'scheduled_date',v_booking.scheduled_date,'negotiated_amount',v_booking.negotiated_amount,
    'agreed_amount',v_booking.agreed_amount,'wehouse_fee',v_booking.wehouse_fee,
    'worker_receives',v_booking.worker_receives,
    'payment_status',coalesce(v_payment_status,'not_started'),
    'protection_status',v_protection_status,
    'money_state',public.worker_booking_money_state(v_payment_status,v_protection_status),
    'payment_review_required',coalesce(v_payment_status='review_required',false)
      or (v_booking.status in ('confirmed','in_progress','completed_pending_approval') and v_protection_status is null),
    'payment_protected',lower(coalesce(v_protection_status,'')) in
      ('protected','payment_protected','secured','held','holding'),
    'payment_released_at',v_payment_released_at,
    'job_support_until',v_job_support_until,
    'job_support_open',v_job_support_open,
    'help_until',v_job_support_until,
    'help_open',v_job_support_open,
    'blocked_by_me',exists(
      select 1 from public.worker_user_blocks block_row
      where block_row.blocker_user_id=v_actor.user_id
        and block_row.blocked_user_id=case
          when v_actor.user_id=v_booking.user_id then v_booking.worker_id else v_booking.user_id end
    ),
    'blocked_me',exists(
      select 1 from public.worker_user_blocks block_row
      where block_row.blocker_user_id=case
          when v_actor.user_id=v_booking.user_id then v_booking.worker_id else v_booking.user_id end
        and block_row.blocked_user_id=v_actor.user_id
    ),
    'created_at',v_booking.created_at,'updated_at',v_booking.updated_at,
    'user_id',v_booking.user_id,'worker_id',v_booking.worker_id,
    'user_name',coalesce(v_customer.full_name,v_customer.username,'Customer'),
    'customer_username',v_customer.username,'user_avatar',v_customer.avatar_url,
    'worker_name',coalesce(v_worker.full_name,v_worker.username,'Worker'),
    'worker_avatar',v_worker.avatar_url
  );
end
$function$;
commit;
