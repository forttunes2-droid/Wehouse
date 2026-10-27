-- The canonical ledger and wallet receipt are the release authority. The
-- retired escrow table must not be recreated as a second money record.
do $repair$
declare definition text;needle text;signature text;
begin
 definition:=pg_get_functiondef('public.sync_worker_release_completion()'::regprocedure);
 needle:=$find$    -- Legacy record is a compatibility projection and changes only after the
    -- canonical ledger release and wallet projection both succeeded.
    update public.escrow_transactions set status='released',released_at=now(),
      released_by='finance_processor',updated_at=now()
    where booking_id=v_protection.subject_id::uuid
      and booking_type='worker_booking'
      and status not in('released','refunded','disputed');$find$;
 if strpos(definition,needle)=0 then raise exception 'Inspect Service release completion before retiring the escrow write';end if;
 execute replace(definition,needle,'');
 definition:=pg_get_functiondef('public.customer_raise_dispute(uuid,text)'::regprocedure);
 needle:=$find$  update public.escrow_transactions set status='disputed',updated_at=now()
  where booking_id=p_booking_id and booking_type='worker_booking'
    and status not in('released','refunded');$find$;
 if strpos(definition,needle)=0 then raise exception 'Inspect Service dispute before retiring the escrow write';end if;
 execute replace(definition,needle,'');
 -- Preserve the existing trusted-session/ownership checks, canonical protection
 -- transition, job history and operational conversation. Only dead writes leave.
 foreach signature in array array['public.sync_worker_release_completion()','public.customer_raise_dispute(uuid,text)'] loop
  if strpos(pg_get_functiondef(signature::regprocedure),'public.escrow_transactions')>0 then
   raise exception 'Retired escrow write remains in %',signature;end if;
 end loop;
end $repair$;

-- Recognize commission only on the gross amount actually released. Refunding
-- part of a booking cannot turn the remaining release into the original fee.
do $commission$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.complete_internal_release_action(uuid)'::regprocedure);
 needle:=$find$  v_commission:=least(
    v_protection.amount_commission-v_protection.commission_recognized_amount,
    round(v_action.amount*v_protection.commission_rate/100,2)
  );
  if v_action.amount=
      v_protection.amount_total-v_protection.released_amount-v_protection.refunded_amount then
    v_commission:=least(v_action.amount,
      v_protection.amount_commission-v_protection.commission_recognized_amount);
  end if;$find$;
 if strpos(definition,needle)=0 then raise exception 'Inspect shared release commission before changing refund allocation';end if;
 execute replace(definition,needle,$new$  v_commission:=least(
    v_protection.amount_commission-v_protection.commission_recognized_amount,
    greatest(0,round((v_protection.released_amount+v_action.amount)*v_protection.commission_rate/100,2)
      -v_protection.commission_recognized_amount)
  );$new$);
end $commission$;
