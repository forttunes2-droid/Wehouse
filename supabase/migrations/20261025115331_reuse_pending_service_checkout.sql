begin;
do $patch$
declare definition text;needle text:='  IF existing IS NOT NULL THEN';
begin
 definition:=pg_get_functiondef('public.create_worker_booking_payment(uuid)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Inspect Service pending-payment reuse before upgrading';end if;
 execute replace(definition,needle,'  IF existing.id IS NOT NULL THEN');
end $patch$;
commit;
