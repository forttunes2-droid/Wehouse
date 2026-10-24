begin;
-- Reservation-fee confirmation never unlocks private arrival/access instructions.
CREATE OR REPLACE FUNCTION public.get_my_stay_arrival_instructions(p_kind text, p_booking_id text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor text:=public.current_profile_user_id(); v_asset text;
begin
  if v_actor is null or not public._property_document_session_active() then return null; end if;
  if p_kind='home' then
    select l.id::text into v_asset from public.reservations r
      join public.listings l on r.listing_id in (l.id::text,l.listing_id)
      where r.id=p_booking_id and r.user_id=v_actor
      and r.status in ('ready_for_move_in','occupied','completed')
      and r.rent_payment_status in ('paid','upfront_paid') and r.rent_paid_at is not null
      and exists(select 1 from public.payment_protection_transactions p
        where p.id=case when r.stay_type='short_let' then r.stay_payment_protection_id else r.year_one_rent_protection_id end
          and p.subject_id=r.id and p.payer_user_id=v_actor
          and p.subject_type=case when r.stay_type='short_let' then 'short_let_stay' else 'long_let_year_one' end
          and p.protection_state not in ('refunded','disputed','risk_held'));
  elsif p_kind='hotel' then
    select b.hotel_id::text into v_asset from public.hotel_bookings b
      where b.booking_id::text=p_booking_id and b.user_id=v_actor and b.payment_status='paid'
        and b.status not in ('cancelled','expired','refunded','payment_conflict');
  else return null;
  end if;
  if v_asset is null then return null; end if;
  return (select i.instructions from public.property_arrival_instructions i
    where i.asset_kind=p_kind and i.asset_id=v_asset);
end $function$;
CREATE OR REPLACE FUNCTION public.cancel_my_paid_short_let(p_reservation_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor text:=public.current_profile_user_id();
  r public.reservations; p public.payment_protection_transactions;
  v_hours numeric; v_remaining numeric; v_snapshot jsonb;
begin
  if v_actor is null then raise exception 'Sign in required'; end if;
  if not public._property_document_session_active() then raise exception 'Active trusted session required'; end if;
  select * into r from public.reservations where id=p_reservation_id and user_id=v_actor for update;
  if r.id is null or coalesce(r.stay_type,'')<>'short_let' then raise exception 'Reservation not found'; end if;
  if r.status='cancelled' then
    return jsonb_build_object('refund_amount',coalesce((select amount from public.financial_action_outbox where idempotency_key='short-let-cancellation:'||r.id),(select refunded_amount from public.payment_protection_transactions where id=r.stay_payment_protection_id),0),'already',true);
  end if;
  if r.status in('completed','expired') or r.stay_payment_protection_id is null then
    raise exception 'This stay cannot be cancelled here';
  end if;
  v_snapshot:=coalesce(r.short_stay_cancellation_policy_snapshot,'{}'::jsonb);
  if coalesce((v_snapshot->>'non_refundable')::boolean,false) then
    raise exception 'This is a non-refundable rate. If the host failed you, ask WeHouse for a review.';
  end if;
  v_hours:=coalesce((v_snapshot->>'standard_full_refund_hours_before_check_in')::numeric,24);
  if r.stay_check_in is null
     or (r.stay_check_in::timestamp at time zone 'Africa/Lagos')-now()<make_interval(hours=>v_hours::integer) then
    raise exception 'This is inside the free-cancellation window. Ask WeHouse for a review.';
  end if;
  if r.caution_payment_protection_id is not null then
    raise exception 'This stay has a security deposit. Ask WeHouse to cancel it so the deposit is returned too.';
  end if;
  select * into p from public.payment_protection_transactions where id=r.stay_payment_protection_id for update;
  if p.id is null or p.protection_state not in('protected','release_eligible') then
    raise exception 'There is no protected payment to refund';
  end if;
  if exists(select 1 from public.financial_action_outbox where payment_protection_id=p.id and status<>'completed') then
    raise exception 'Payment requires Finance reconciliation before cancellation';
  end if;
  v_remaining:=p.amount_total-p.released_amount-p.refunded_amount;
  if v_remaining>0 then
    insert into public.financial_action_outbox(action_type,subject_type,subject_id,payment_protection_id,amount,idempotency_key,metadata)
    values('refund_short_let_cancellation','short_let',r.id,p.id,v_remaining,'short-let-cancellation:'||r.id,
      jsonb_build_object('basis','amount_paid','hours_before_check_in',v_hours))
    on conflict(idempotency_key) do nothing;
  end if;
  insert into public.payment_protection_transitions(payment_protection_id,from_state,to_state,event_type,event_key,actor_user_id,actor_type,reason,metadata)
  values(p.id,p.protection_state,'risk_held','short_let_guest_cancelled','short-let-cancelled:'||r.id,v_actor,'customer','Guest cancelled before the free-cancellation deadline',jsonb_build_object('refund_amount',v_remaining))
  on conflict(event_key) do nothing;
  update public.payment_protection_transactions set protection_state='risk_held',status='risk_held',risk_held_at=now(),updated_at=now() where id=p.id;
  update public.reservations set status='cancelled',processed_at=now(),updated_at=now() where id=r.id;
  update public.listings set reserved_by=null,reservation_expiry=null,occupied_by=null,occupied_at=null,tenancy_ends_at=null,current_reservation_id=null,updated_at=now()
  where id::text=r.listing_id and current_reservation_id=r.id;
  return jsonb_build_object('refund_amount',v_remaining,'already',false);
end $function$;
CREATE OR REPLACE FUNCTION public.create_user_inspection_request(p_reservation_id text, p_notes text DEFAULT NULL::text)
 RETURNS user_inspection_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
  v_res public.reservations;
  v_listing public.listings;
  v_request public.user_inspection_requests;
  v_conversation_id uuid;
begin
  if not public._property_document_session_active() then raise exception 'Active trusted session required'; end if;
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;

  select * into v_res
  from public.reservations
  where id=p_reservation_id and user_id=v_actor.user_id
  for update;
  if v_res.id is null then raise exception 'Reservation not found'; end if;
  if v_res.status not in ('reserved','reservation_paid','inspection_pending') or v_res.rent_paid_at is not null then
    raise exception 'Inspection must be requested before rent payment and handover';
  end if;
  if v_res.stay_type='short_let' then
    raise exception 'Customer inspection applies to Long Let reservations';
  end if;
  if coalesce(v_res.reservation_fee_status,'') not in ('paid','completed')
     and v_res.paid_at is null then
    raise exception 'Complete the reservation payment before requesting inspection';
  end if;

  select * into v_listing
  from public.listings
  where id::text=v_res.listing_id or listing_id=v_res.listing_id
  limit 1;
  if v_listing.id is null then raise exception 'Property not found'; end if;

  select * into v_request
  from public.user_inspection_requests
  where reservation_id=v_res.id
    and status not in ('completed','cancelled','failed','customer_declined')
  order by created_at desc
  limit 1;

  if v_request.id is null then
    insert into public.user_inspection_requests(
      reservation_id,listing_id,user_id,field_officer_id,status,notes,
      created_at,updated_at
    ) values(
      v_res.id,v_res.listing_id,v_actor.user_id,null,'pending',
      nullif(btrim(coalesce(p_notes,'')),''),now(),now()
    ) returning * into v_request;
  end if;

  -- Reuse/upgrade the canonical Property Operations conversation. The request
  -- deliberately remains unassigned until Property Operations chooses a Field officer.
  v_conversation_id:=public.open_my_reservation_conversation(
    'apartment_reservation',v_res.id
  );

  update public.partner_support_conversations
  set channel_kind='property_operations',
      context_snapshot=coalesce(context_snapshot,'{}'::jsonb)||jsonb_build_object(
        'inspection_request_id',v_request.id,
        'inspection_status',v_request.status
      ),
      updated_at=now()
  where id=v_conversation_id;

  insert into public.partner_support_messages(
    conversation_id,sender_id,sender_role,content,attachments,attachment_types,
    action_type,action_metadata,is_read,visibility,created_at
  ) select
    v_conversation_id,v_actor.user_id,'system',
    'Inspection requested. Property Operations will assign Field Operations for this property in this conversation.',
    array[]::text[],array[]::text[],'inspection_requested',
    jsonb_build_object(
      'inspection_request_id',v_request.id,
      'reservation_id',v_res.id,
      'listing_id',v_res.listing_id,
      'customer_front_door','property_operations'
    ),false,'customer',now()
  where not exists(
    select 1 from public.partner_support_messages m
    where m.conversation_id=v_conversation_id
      and m.action_type='inspection_requested'
      and m.action_metadata->>'inspection_request_id'=v_request.id::text
  );

  update public.reservations
  set status=case when status in('reserved','reservation_paid') then 'inspection_pending' else status end,
      updated_at=now()
  where id=v_res.id;

  return v_request;
end
$function$;
commit;
