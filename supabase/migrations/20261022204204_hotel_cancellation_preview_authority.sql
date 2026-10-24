-- One saved-agreement eligibility rule for preview and the locked cancellation command.
create function private.hotel_cancellation_eligibility(p_booking_id integer,p_actor text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare booking public.hotel_bookings; protection public.payment_protection_transactions; terms jsonb; amount numeric; deadline timestamptz; refund_status text;
 review jsonb:=jsonb_build_object('kind','review_required','can_cancel',false,'message','This booking requires WeHouse cancellation review');
begin
 select * into booking from public.hotel_bookings where booking_id=p_booking_id and user_id=p_actor;
 if booking.booking_id is null then raise exception 'Hotel booking unavailable';end if;
 if booking.status in('cancelled','refunded') then
  select status into refund_status from public.financial_action_outbox where action_type='refund_hotel_cancellation' and subject_type='hotel' and subject_id=booking.booking_id::text and payment_protection_id=booking.payment_protection_id order by created_at desc limit 1;
  return jsonb_build_object('kind','already_cancelled','can_cancel',false,'message','This booking is cancelled','refund_status',case when booking.payment_status='refunded' then 'completed' else refund_status end);
 end if;
 if booking.status='pending' and booking.payment_status<>'paid' then
  return jsonb_build_object('kind','unpaid','can_cancel',true,'message','Cancel this unpaid booking','currency','NGN','refund_amount_ngn',0,'fee_ngn',0);
 end if;
 terms:=booking.cancellation_snapshot;
 if booking.status<>'confirmed' or booking.payment_status<>'paid' or booking.checked_in_at is not null or terms is null then return review;end if;
 begin
  if not coalesce((terms->>'refundable')::boolean,false) or terms->>'deadline' is null or terms->>'refund_amount_ngn' is null
   or coalesce(terms->>'currency','NGN')<>'NGN' then return review;end if;
  deadline:=(terms->>'deadline')::timestamptz;amount:=(terms->>'refund_amount_ngn')::numeric;
  if now()>deadline or amount<=0 or amount::text in('NaN','Infinity','-Infinity') or nullif(terms->>'timezone','') is null then return review;end if;
  perform timezone(terms->>'timezone',deadline);
 exception when others then return review;end;
 select * into protection from public.payment_protection_transactions where id=booking.payment_protection_id;
 if protection.id is null or protection.payer_user_id is distinct from p_actor
  or nullif(booking.payment_reference,'') is null or protection.paystack_reference is distinct from booking.payment_reference
  or protection.protection_state not in('protected','release_eligible') or protection.released_amount<>0 or protection.refunded_amount<>0
  or protection.amount_total is distinct from amount
  or exists(select 1 from public.financial_action_outbox where payment_protection_id=protection.id and status<>'completed') then
  return jsonb_build_object('kind','review_required','can_cancel',false,'message','Payment requires Finance reconciliation before cancellation');
 end if;
 return jsonb_build_object('kind','full_refund','can_cancel',true,'currency','NGN','refund_amount_ngn',amount,'fee_ngn',0,
  'deadline',deadline,'timezone',terms->>'timezone','message','Cancel the stay and request a refund to the original payment method');
end; $$;
revoke all on function private.hotel_cancellation_eligibility(integer,text) from public,anon,authenticated,service_role;

create function public.get_my_hotel_cancellation_preview(p_booking_id integer)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor text:=public.current_profile_user_id();
begin
 if not public._property_document_session_active() or actor is null or not public.current_actor_has_personal_workspace() then
  raise exception 'Active trusted Personal session required';end if;
 return private.hotel_cancellation_eligibility(p_booking_id,actor)||jsonb_build_object('booking_id',p_booking_id);
end; $$;
revoke all on function public.get_my_hotel_cancellation_preview(integer) from public,anon,service_role;
grant execute on function public.get_my_hotel_cancellation_preview(integer) to authenticated;

CREATE OR REPLACE FUNCTION public.cancel_my_hotel_booking(p_booking_id integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  actor text:=public.current_profile_user_id();
  booking public.hotel_bookings;
  eligibility jsonb;
  protection public.payment_protection_transactions;
  refund_key text:='hotel-cancellation:'||p_booking_id;
begin
  if not public._property_document_session_active() then raise exception 'Active trusted session required'; end if;
  if actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;

  perform 1 from public.booking_payments
  where hotel_booking_id=p_booking_id and user_id=actor and purpose='hotel_booking'
  order by id for update;

  select * into booking from public.hotel_bookings
  where booking_id=p_booking_id and user_id=actor for update;

  if booking.booking_id is null then raise exception 'Hotel booking unavailable'; end if;
  if booking.status in ('cancelled','refunded') then return true; end if;

  if booking.status='pending' and booking.payment_status<>'paid' then
    update public.hotel_bookings
    set status='cancelled',canonical_state='cancelled',payment_status='expired',updated_at=now()
    where booking_id=p_booking_id;
    update public.booking_payments
    set status='cancelled',updated_at=now()
    where hotel_booking_id=p_booking_id and user_id=actor and purpose='hotel_booking' and status='pending';
    return true;
  end if;

  select * into protection from public.payment_protection_transactions
  where id=booking.payment_protection_id for update;
  eligibility:=private.hotel_cancellation_eligibility(p_booking_id,actor);
  if eligibility->>'kind' is distinct from 'full_refund' then
    raise exception '%',coalesce(eligibility->>'message','This booking requires WeHouse cancellation review');
  end if;

  insert into public.payment_protection_transitions(
    payment_protection_id,from_state,to_state,event_type,event_key,
    actor_user_id,actor_type,metadata)
  values(protection.id,protection.protection_state,'risk_held',
         'hotel_cancellation_requested',refund_key,actor,'customer',
         booking.cancellation_snapshot);

  update public.payment_protection_transactions
  set protection_state='risk_held',status='risk_held',risk_held_at=now(),updated_at=now()
  where id=protection.id;

  insert into public.financial_action_outbox(
    action_type,subject_type,subject_id,payment_protection_id,amount,idempotency_key,metadata)
  values('refund_hotel_cancellation','hotel',booking.booking_id::text,
         protection.id,protection.amount_total,refund_key,booking.cancellation_snapshot);

  update public.hotel_bookings
  set status='cancelled',canonical_state='cancelled',updated_at=now()
  where booking_id=booking.booking_id;

  return true;
end
$function$;

