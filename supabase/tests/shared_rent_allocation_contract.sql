begin;
do $$
declare term integer;choice text;rate numeric;people text[];allocation jsonb;agreement jsonb;payers jsonb;person jsonb;
 payment jsonb;source_payment jsonb;i integer;j integer;y integer;total numeric;fee numeric;net numeric;
 parent_payments jsonb;year_cash numeric;year_fee numeric;individual_cash numeric;
begin
 foreach term in array array[3,6,12,24,36,48,60] loop
  foreach choice in array array['full','monthly'] loop
   if choice='monthly' and term<=12 then continue;end if;
   foreach rate in array array[0::numeric,0.01::numeric,12.37::numeric,50::numeric] loop
    allocation:=private.allocate_long_let_payment_splits(1200000.07,1200000.07,1200000.07,term,choice,rate);
    agreement:=jsonb_build_object('schema_version',1,'reservation_id','rollback-shared-rent','listing_id','rollback-home',
     'offer_revision',1,'currency','NGN','quote_digest',md5(allocation::text),'commission_rate',rate,
     'rent_schedule',allocation->'rent_schedule','partner_schedule',allocation->'partner_schedule');
    for j in 2..3 loop
     people:=(array['payer-a','payer-b','payer-c'])[1:j];
     payers:=private.shared_long_let_payer_agreements(agreement,people);
     if jsonb_array_length(payers)<>j then raise exception 'Incorrect number of payer agreements';end if;
     parent_payments:=agreement#>'{rent_schedule,payments}';
     for i in 0..jsonb_array_length(parent_payments)-1 loop
      source_payment:=parent_payments->i;
      select sum((payer#>>array['rent_schedule','payments',i::text,'amount'])::numeric),
       sum((payer#>>array['rent_schedule','payments',i::text,'wehouse_amount'])::numeric),
       sum((payer#>>array['rent_schedule','payments',i::text,'partner_net_amount'])::numeric)
       into total,fee,net from jsonb_array_elements(payers) payer;
      if total<>(source_payment->>'amount')::numeric or fee<>(source_payment->>'wehouse_amount')::numeric
       or net<>(source_payment->>'partner_net_amount')::numeric or fee+net<>total then
       raise exception 'Shared payment changed the accepted cash, fee or Partner amount';end if;
      for person in select value from jsonb_array_elements(payers) loop
       payment:=person#>array['rent_schedule','payments',i::text];
       if (payment->>'amount')::numeric<=0 or (payment->>'wehouse_amount')::numeric<0
        or (payment->>'partner_net_amount')::numeric<0
        or (payment->>'amount')::numeric<>(payment->>'wehouse_amount')::numeric+(payment->>'partner_net_amount')::numeric then
        raise exception 'A payer received an unbalanced allocation';end if;
      end loop;
     end loop;
     if choice='monthly' then
      for y in 2..term/12 loop
       year_cash:=0;year_fee:=0;
       for person in select value from jsonb_array_elements(payers) loop
        select sum((entry->>'amount')::numeric),sum((entry->>'wehouse_amount')::numeric)
         into individual_cash,fee from jsonb_array_elements(person#>'{rent_schedule,payments}') entry
         where (entry->>'target_year')::integer=y;
        if individual_cash<>(person#>>'{rent_schedule,annual_rent}')::numeric then
         raise exception 'The payer annual obligation no longer matches eight scheduled payments';end if;
        year_cash:=year_cash+individual_cash;year_fee:=year_fee+fee;
       end loop;
       if year_cash<>1200000.07 or year_fee<>round(1200000.07*rate/100,2) then
        raise exception 'Shared annual commission was charged more than once or rent value was lost';end if;
      end loop;
     end if;
    end loop;
   end loop;
  end loop;
 end loop;
 allocation:=private.allocate_long_let_payment_splits(1200000.07,1200000.07,1140000.07,24,'monthly',10);
 agreement:=jsonb_build_object('schema_version',1,'currency','NGN','quote_digest',md5(allocation::text),
  'rent_schedule',allocation->'rent_schedule','partner_schedule',allocation->'partner_schedule');
 payers:=private.shared_long_let_payer_agreements(agreement,array['payer-a','payer-b','payer-c']);
 select sum((p#>>'{partner_schedule,payments,0,net_amount}')::numeric) into net from jsonb_array_elements(payers) p;
 if net<>(allocation#>>'{partner_schedule,payments,0,net_amount}')::numeric then
  raise exception 'WeHouse-funded promotion changed the Partner net';end if;
 if has_function_privilege('anon','private.shared_long_let_payer_agreements(jsonb,text[])','execute')
  or has_function_privilege('authenticated','private.shared_long_let_payer_agreements(jsonb,text[])','execute') then
  raise exception 'A browser can call the internal rent allocator';end if;
end $$;
rollback;
select 'Shared rental schedules preserve every payment, annual share, fee, Partner net and funded promotion' result;
