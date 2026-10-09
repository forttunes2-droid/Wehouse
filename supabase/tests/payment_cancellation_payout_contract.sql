\set ON_ERROR_STOP on

begin;

-- This contract inspects the functions produced by the full migration replay.
-- It fails if later migrations weaken the money boundaries without updating the
-- release contract deliberately.

do $$
declare
  apartment_cancel text;
  hotel_cancel text;
  hotel_cancel_compact text;
  worker_cancel text;
  record_transfer text;
  settle_transfer text;
begin
  select pg_get_functiondef('public.cancel_my_apartment_reservation(text)'::regprocedure)
    into apartment_cancel;
  select pg_get_functiondef('public.cancel_my_hotel_booking(integer)'::regprocedure)
    into hotel_cancel;
  hotel_cancel_compact := regexp_replace(lower(hotel_cancel), '\s+', '', 'g');
  select pg_get_functiondef('public.cancel_booking(uuid,text)'::regprocedure)
    into worker_cancel;
  select pg_get_functiondef('public.record_withdrawal_transfer_response(uuid,text,text,jsonb)'::regprocedure)
    into record_transfer;
  select pg_get_functiondef('public.settle_withdrawal_transfer_event(text,text,text,text,text,jsonb)'::regprocedure)
    into settle_transfer;

  if apartment_cancel not ilike '%paid reservations must be handled by support%' then
    raise exception 'Apartment self-cancellation no longer fails closed after payment';
  end if;
  if apartment_cancel not ilike '%manual_payment_status in (''paid'',''completed'')%'
     or apartment_cancel not ilike '%paid_at is not null%' then
    raise exception 'Apartment paid-state cancellation guard is incomplete';
  end if;

  -- pg_get_functiondef normalizes SQL formatting differently across PostgreSQL
  -- versions. Compare a whitespace-free copy so the contract tests the guards,
  -- not pretty-print spacing in the function source.
  if hotel_cancel_compact not like '%status=''pending''%'
     or hotel_cancel_compact not like '%payment_status<>''paid''%' then
    raise exception 'Hotel unpaid pending cancellation guard is missing';
  end if;
  if hotel_cancel_compact not like '%activepersonalaccountrequired%'
     or hotel_cancel_compact not like '%user_id=actorforupdate%'
     or hotel_cancel_compact not like '%cancellation_snapshotisnull%'
     or hotel_cancel_compact not like '%deadline''isnull%'
     or hotel_cancel_compact not like '%now()>(booking.cancellation_snapshot->>''deadline'')::timestamptz%'
     or hotel_cancel_compact not like '%paymentrequiresfinancereconciliationbeforecancellation%'
     or hotel_cancel_compact not like '%refund_hotel_cancellation%'
     or hotel_cancel_compact like '%setpayment_status=''refunded''%' then
    raise exception 'Hotel cancellation bypasses saved terms, payment review or provider refund confirmation';
  end if;

  if worker_cancel not ilike '%booking_requested%'
     or worker_cancel not ilike '%negotiating%'
     or worker_cancel not ilike '%waiting_payment%' then
    raise exception 'Worker booking cancellation phase guard changed';
  end if;
  if worker_cancel not ilike '%verified payment awaiting WeHouse review and cannot be cancelled yet%' then
    raise exception 'Worker booking can bypass payment-review cancellation protection';
  end if;

  -- Recording an initiation response may update provider metadata, but must not
  -- finalize the withdrawal itself.
  if record_transfer ilike '%status=''paid'',processed_at%'
     or record_transfer ilike '%set status=''paid''%' then
    raise exception 'Initial Paystack transfer response can mark a withdrawal paid';
  end if;
  if record_transfer not ilike '%status in (''processing'',''paid'',''failed'',''reversed'')%' then
    raise exception 'Transfer response reconciliation guard changed unexpectedly';
  end if;

  if settle_transfer not ilike '%v_status not in (''success'',''failed'',''reversed'')%' then
    raise exception 'Payout settlement accepts an unsupported provider status';
  end if;
  if settle_transfer not ilike '%status=''paid'',processed_at=now(),finalized_at=now()%' then
    raise exception 'Provider-confirmed payout settlement no longer owns the paid transition';
  end if;
  if settle_transfer not ilike '%Paystack confirmed the withdrawal transfer%' then
    raise exception 'Paid withdrawal audit no longer records provider confirmation';
  end if;
  if settle_transfer not ilike '%return_reserved_withdrawal%'
     or settle_transfer not ilike '%failed%'
     or settle_transfer not ilike '%reversed%' then
    raise exception 'Failed or reversed payouts no longer return reserved funds';
  end if;
end;
$$;

rollback;
