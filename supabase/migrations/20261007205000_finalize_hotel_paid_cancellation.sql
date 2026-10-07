begin;

-- Finalize the paid Hotel cancellation authority after the later legacy
-- Personal-workspace migration that previously overwrote this function.
create or replace function public.cancel_my_hotel_booking(p_booking_id integer)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  actor text:=public.current_profile_user_id();
  booking public.hotel_bookings;
  protection public.payment_protection_transactions;
  refund_key text:='hotel-cancellation:'||p_booking_id;
begin
  if actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;

  perform 1
  from public.booking_payments
  where hotel_booking_id=p_booking_id
    and user_id=actor
    and purpose='hotel_booking'
  order by id
  for update;

  select * into booking
  from public.hotel_bookings
  where booking_id=p_booking_id
    and user_id=actor
  for update;

  if booking.booking_id is null then
    raise exception 'Hotel booking unavailable';
  end if;

  if booking.status in ('cancelled','refunded') then
    return true;
  end if;

  -- Unpaid checkout holds can be cancelled immediately.
  if booking.status='pending' and booking.payment_status<>'paid' then
    update public.hotel_bookings
    set status='cancelled',
        canonical_state='cancelled',
        payment_status='expired',
        updated_at=now()
    where booking_id=p_booking_id;

    update public.booking_payments
    set status='cancelled',updated_at=now()
    where hotel_booking_id=p_booking_id
      and user_id=actor
      and purpose='hotel_booking'
      and status='pending';

    return true;
  end if;

  -- Paid bookings are cancellable only while the immutable booked terms say
  -- they are refundable and the stored deadline has not passed.
  if booking.status<>'confirmed'
     or booking.payment_status<>'paid'
     or booking.checked_in_at is not null
     or booking.cancellation_snapshot is null
     or not coalesce((booking.cancellation_snapshot->>'refundable')::boolean,false)
     or now()>(booking.cancellation_snapshot->>'deadline')::timestamptz then
    raise exception 'This booking requires WeHouse cancellation review';
  end if;

  select * into protection
  from public.payment_protection_transactions
  where id=booking.payment_protection_id
  for update;

  if protection.id is null
     or protection.payer_user_id<>actor
     or protection.paystack_reference is distinct from booking.payment_reference
     or protection.protection_state not in ('protected','release_eligible')
     or protection.released_amount<>0
     or protection.refunded_amount<>0
     or protection.amount_total<>(booking.cancellation_snapshot->>'refund_amount_ngn')::numeric
     or exists(
       select 1
       from public.financial_action_outbox
       where payment_protection_id=protection.id
         and status<>'completed'
     ) then
    raise exception 'Payment requires Finance reconciliation before cancellation';
  end if;

  insert into public.payment_protection_transitions(
    payment_protection_id,from_state,to_state,event_type,event_key,
    actor_user_id,actor_type,metadata
  ) values(
    protection.id,protection.protection_state,'risk_held',
    'hotel_cancellation_requested',refund_key,actor,'customer',
    booking.cancellation_snapshot
  );

  update public.payment_protection_transactions
  set protection_state='risk_held',
      status='risk_held',
      risk_held_at=now(),
      updated_at=now()
  where id=protection.id;

  insert into public.financial_action_outbox(
    action_type,subject_type,subject_id,payment_protection_id,
    amount,idempotency_key,metadata
  ) values(
    'refund_hotel_cancellation','hotel',booking.booking_id::text,
    protection.id,protection.amount_total,refund_key,
    booking.cancellation_snapshot
  );

  -- Inventory is released immediately; payment remains marked paid until the
  -- verified Paystack refund event projects the final refunded state.
  update public.hotel_bookings
  set status='cancelled',
      canonical_state='cancelled',
      updated_at=now()
  where booking_id=booking.booking_id;

  return true;
end
$$;

revoke all on function public.cancel_my_hotel_booking(integer) from public,anon;
grant execute on function public.cancel_my_hotel_booking(integer) to authenticated,service_role;

commit;
