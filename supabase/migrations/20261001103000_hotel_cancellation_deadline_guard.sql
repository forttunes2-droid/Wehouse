begin;
CREATE OR REPLACE FUNCTION public.cancel_my_hotel_booking(p_booking_id integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare actor text:=public.current_profile_user_id(); b public.hotel_bookings;
 p public.payment_protection_transactions; refund_key text:='hotel-cancellation:'||p_booking_id;
begin
 if actor is null or not public.current_actor_has_personal_workspace() then raise exception 'Active Personal account required'; end if;
 perform 1 from public.booking_payments where hotel_booking_id=p_booking_id and user_id=actor and purpose='hotel_booking' order by id for update;
 select * into b from public.hotel_bookings where booking_id=p_booking_id and user_id=actor for update;
 if b.booking_id is null then raise exception 'Hotel booking unavailable'; end if;
 if b.status in ('cancelled','refunded') then return true; end if;
 if b.status='pending' and b.payment_status<>'paid' then
  update public.hotel_bookings set status='cancelled',canonical_state='cancelled',payment_status='expired',updated_at=now() where booking_id=p_booking_id;
  update public.booking_payments set status='cancelled',updated_at=now()
   where hotel_booking_id=p_booking_id and user_id=actor and purpose='hotel_booking' and status='pending';
  return true;
 end if;
 if b.status<>'confirmed' or b.payment_status<>'paid' or b.checked_in_at is not null
  or b.cancellation_snapshot is null or not coalesce((b.cancellation_snapshot->>'refundable')::boolean,false)
  or b.cancellation_snapshot->>'deadline' is null
  or b.cancellation_snapshot->>'refund_amount_ngn' is null
  or now()>(b.cancellation_snapshot->>'deadline')::timestamptz then
  raise exception 'This booking requires WeHouse cancellation review'; end if;
 select * into p from public.payment_protection_transactions where id=b.payment_protection_id for update;
 if p.id is null or p.payer_user_id is distinct from actor or nullif(b.payment_reference,'') is null or p.paystack_reference is distinct from b.payment_reference
  or p.protection_state not in ('protected','release_eligible') or p.released_amount<>0 or p.refunded_amount<>0
  or p.amount_total is distinct from (b.cancellation_snapshot->>'refund_amount_ngn')::numeric
  or exists(select 1 from public.financial_action_outbox where payment_protection_id=p.id and status<>'completed')
  then raise exception 'Payment requires Finance reconciliation before cancellation'; end if;
 insert into public.payment_protection_transitions(payment_protection_id,from_state,to_state,event_type,event_key,actor_user_id,actor_type,metadata)
 values(p.id,p.protection_state,'risk_held','hotel_cancellation_requested',refund_key,actor,'customer',b.cancellation_snapshot);
 update public.payment_protection_transactions set protection_state='risk_held',status='risk_held',risk_held_at=now(),updated_at=now() where id=p.id;
 insert into public.financial_action_outbox(action_type,subject_type,subject_id,payment_protection_id,amount,idempotency_key,metadata)
 values('refund_hotel_cancellation','hotel',b.booking_id::text,p.id,p.amount_total,refund_key,b.cancellation_snapshot);
 -- Inventory excludes cancelled bookings. Money remains paid until the verified provider refund.
 update public.hotel_bookings set status='cancelled',canonical_state='cancelled',updated_at=now() where booking_id=b.booking_id;
 return true;
end $function$;
CREATE OR REPLACE FUNCTION public.quote_hotel_room_rate(p_hotel_id integer, p_room_id integer, p_rate_plan_id integer, p_check_in date, p_check_out date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare h public.hotels; rp public.hotel_rate_plans; q jsonb; deadline timestamptz;
begin
 if p_check_in is null or p_check_out is null or p_check_in<=current_date or p_check_out<=p_check_in then raise exception 'Choose valid future check-in and check-out dates'; end if;
 select * into h from public.hotels where hotel_id=p_hotel_id and status='active' and approved_at is not null and published_at is not null;
 select * into rp from public.hotel_rate_plans where rate_plan_id=p_rate_plan_id and hotel_id=p_hotel_id and room_id=p_room_id and active;
 if h.hotel_id is null or rp.rate_plan_id is null then raise exception 'Hotel room package is not available'; end if;
 q:=private.hotel_booking_quote_v2(p_room_id,p_rate_plan_id,p_check_in,p_check_out,null,true);
 deadline:=((p_check_in+coalesce(h.check_in_time,time '14:00')) at time zone coalesce(nullif(h.timezone,''),'Africa/Lagos'))-make_interval(hours=>coalesce(rp.cancellation_hours,0));
 return q||jsonb_build_object('cancellation_deadline',case when rp.refundable then deadline else null end,
 'cancellation_timezone',coalesce(nullif(h.timezone,''),'Africa/Lagos'),'refund_amount_ngn',case when rp.refundable then (q->>'total_price')::numeric else 0 end);
end $function$;
CREATE OR REPLACE FUNCTION public.snapshot_hotel_cancellation_terms()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare h public.hotels; deadline timestamptz; refundable boolean;
begin
 if tg_op='UPDATE' then
  if new.cancellation_snapshot is distinct from old.cancellation_snapshot then raise exception 'Booked cancellation terms are immutable'; end if;
  return new;
 end if;
 select * into h from public.hotels where hotel_id=new.hotel_id;
 refundable:=coalesce((new.rate_plan_snapshot->>'refundable')::boolean,false);
 deadline:=((new.check_in+coalesce(h.check_in_time,time '14:00')) at time zone coalesce(nullif(h.timezone,''),'Africa/Lagos'))
   -make_interval(hours=>coalesce((new.rate_plan_snapshot->>'cancellation_hours')::integer,0));
 new.cancellation_snapshot:=jsonb_build_object('version',1,'timezone',coalesce(nullif(h.timezone,''),'Africa/Lagos'),
  'check_in_time',coalesce(h.check_in_time,time '14:00'),'refundable',refundable,'deadline',case when refundable then deadline else null end,
  'refund_amount_ngn',case when refundable then new.total_price else 0 end,'fee_ngn',0,
  'terms','Full booking amount returned to the original payment method if cancelled by the stored deadline before check-in. Later cancellations and exceptions require WeHouse review.');
 return new;
end $function$;
commit;
