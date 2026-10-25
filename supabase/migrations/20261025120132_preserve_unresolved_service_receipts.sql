begin;
do $patch$
declare definition text;needle text:=$needle$  if v_payment.purpose='worker_booking' then
    v_rate:=v_payment.commission_rate;v_policy_id:=v_payment.commission_policy_version_id;
    if v_payment.commission_frozen_at is null or v_policy_id is null or v_rate is null or v_rate not between 0 and 50
      or v_payment.amount_commission is distinct from round(v_amount*v_rate/100,2)
      or v_payment.net_amount is distinct from v_amount-v_payment.amount_commission then
      raise exception 'Service checkout commission snapshot is missing or invalid';
    end if;
  end if;
  begin
$needle$;
begin
 definition:=pg_get_functiondef('public.process_verified_paystack_charge(text,text,text,text,timestamptz,bigint,text,text)'::regprocedure);
 -- Snapshot failure must reach the existing durable Finance recovery handler.
 if position(needle in definition)=0 then raise exception 'Inspect verified Service recovery boundary before upgrading';end if;
 execute replace(definition,needle,$replacement$  begin
  if v_payment.purpose='worker_booking' then
    v_rate:=v_payment.commission_rate;v_policy_id:=v_payment.commission_policy_version_id;
    if v_payment.commission_frozen_at is null or v_policy_id is null or v_rate is null or v_rate not between 0 and 50
      or v_payment.amount_commission is distinct from round(v_amount*v_rate/100,2)
      or v_payment.net_amount is distinct from v_amount-v_payment.amount_commission then
      raise exception 'Service checkout commission snapshot is missing or invalid';
    end if;
  end if;
$replacement$);
end $patch$;
commit;
