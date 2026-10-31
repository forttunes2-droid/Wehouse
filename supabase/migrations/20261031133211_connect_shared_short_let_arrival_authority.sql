-- Shared stays keep one real protected component per payer. Arrival must use
-- the same canonical all-payer authority as the reservation trigger, rather than
-- requiring a fabricated single parent payment. Dates, role scope, occupancy
-- conflicts, and the single-payer path retain their existing checks.
do $patch$
declare definition text;needle text:=$needle$  select * into v_protection from public.payment_protection_transactions
  where id=v_res.stay_payment_protection_id for update;
  if v_protection.id is null or v_protection.protection_state<>'protected' then
    raise exception 'Current Short Stay Payment Protection is required before check-in';
  end if;$needle$;
begin
 definition:=replace(pg_get_functiondef('private.activate_short_stay(text,date)'::regprocedure),E'\r\n',E'\n');
 if strpos(definition,needle)=0 then raise exception 'Inspect Short Let check-in protection boundary';end if;
 execute replace(definition,needle,$arrival$  if v_res.shared_payment_group_id is not null then
    perform 1 from public.payment_protection_transactions p
      join public.shared_payment_protection_components c on c.payment_protection_id=p.id
      where c.shared_payment_group_id=v_res.shared_payment_group_id order by p.id for update of p;
    if not coalesce((public.accommodation_access_authorization(
      v_res.id,v_res.listing_id,v_res.user_id,v_res.stay_type,v_res.status,
      v_res.manual_payment_status,v_res.paid_at,v_res.rent_payment_status,v_res.rent_paid_at,v_res.rent_payment_reference,
      v_res.stay_payment_protection_id,v_res.year_one_rent_protection_id,v_res.shared_payment_group_id,
      v_res.stay_rent_total,'handover')->>'authorized')::boolean,false) then
      raise exception 'Current shared Short Let Payment Protection is required before check-in';
    end if;
  else
  select * into v_protection from public.payment_protection_transactions
  where id=v_res.stay_payment_protection_id for update;
  if v_protection.id is null or v_protection.protection_state<>'protected' then
    raise exception 'Current Short Stay Payment Protection is required before check-in';
  end if;
  end if;$arrival$);
end $patch$;
