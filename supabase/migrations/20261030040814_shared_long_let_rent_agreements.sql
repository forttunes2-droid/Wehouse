begin;

-- Allocate recorded money, never floating-point estimates. Column budgets keep
-- each person's complete-year share exact while every monthly total still adds
-- up to the accepted tenancy schedule. This is part of the existing rent engine.
create function private.apportion_shared_rent_minor(p_total bigint,p_budgets bigint[])
returns bigint[] language plpgsql immutable set search_path='' as $$
declare result bigint[];remainders numeric[];denominator numeric;leftover bigint;
 i integer;chosen integer;best numeric;n integer:=cardinality(p_budgets);
begin
 if p_total is null or p_total<0 or n is null or n not between 2 and 3
  or array_position(p_budgets,null) is not null
  or exists(select 1 from unnest(p_budgets) value where value<0) then
  raise exception 'Invalid shared rent allocation';end if;
 select sum(value)::numeric into denominator from unnest(p_budgets) value;
 if p_total>denominator then raise exception 'Shared rent exceeds its remaining budget';end if;
 result:=array_fill(0::bigint,array[n]);remainders:=array_fill(0::numeric,array[n]);
 if denominator=0 then return result;end if;
 leftover:=p_total;
 for i in 1..n loop
  result[i]:=floor(p_total::numeric*p_budgets[i]/denominator)::bigint;
  remainders[i]:=mod(p_total::numeric*p_budgets[i],denominator);
  leftover:=leftover-result[i];
 end loop;
 while leftover>0 loop
  chosen:=null;best:=-1;
  for i in 1..n loop
   if result[i]<p_budgets[i] and remainders[i]>best then chosen:=i;best:=remainders[i];end if;
  end loop;
  if chosen is null then raise exception 'Shared rent could not be fully allocated';end if;
  result[chosen]:=result[chosen]+1;remainders[chosen]:=-1;leftover:=leftover-1;
 end loop;
 return result;
end $$;
revoke all on function private.apportion_shared_rent_minor(bigint,bigint[]) from public,anon,authenticated;

create function private.shared_long_let_payer_agreements(p_agreement jsonb,p_people text[])
returns jsonb language plpgsql immutable set search_path='' as $$
declare n integer:=cardinality(p_people);payments jsonb:=p_agreement#>'{rent_schedule,payments}';
 customer jsonb[];partner jsonb[];result jsonb:='[]';row jsonb;partner_row jsonb;body jsonb;
 year_no integer;i integer;j integer;seq integer;cash bigint;fee bigint;promotion bigint;
 year_cash bigint;year_fee bigint;cash_budgets bigint[];fee_budgets bigint[];net_budgets bigint[];
 nets bigint[];fees bigint[];promotions bigint[];promotion_budgets bigint[];
 annual_budgets bigint[];first_budgets bigint[];customer_total numeric;partner_total numeric;first_cash numeric;first_partner numeric;
begin
 if n is null or n not between 2 and 3 or array_position(p_people,null) is not null
  or (select count(distinct person) from unnest(p_people) person)<>n
  or exists(select 1 from unnest(p_people) person where btrim(person)='')
  or p_agreement->>'schema_version' is distinct from '1' or p_agreement->>'currency' is distinct from 'NGN'
  or p_agreement->>'quote_digest' is null or p_agreement->>'quote_digest' !~ '^[a-f0-9]{32}$'
  or jsonb_typeof(payments) is distinct from 'array' or jsonb_array_length(payments) not between 1 and 33 then
  raise exception 'Accepted shared rental terms and two or three payers are required';end if;
 customer:=array_fill('[]'::jsonb,array[n]);partner:=array_fill('[]'::jsonb,array[n]);
 for year_no in select distinct (entry->>'target_year')::integer from jsonb_array_elements(payments) entry order by 1 loop
  select sum((entry->>'amount')::numeric*100)::bigint,sum((entry->>'wehouse_amount')::numeric*100)::bigint
   into year_cash,year_fee from jsonb_array_elements(payments) entry where (entry->>'target_year')::integer=year_no;
  if year_cash is null or year_cash<=0 or year_fee is null or year_fee<0 or year_fee>year_cash then
   raise exception 'Shared rental cash and fee allocation is invalid';end if;
  cash_budgets:=array_fill(0::bigint,array[n]);
  for j in 1..n loop cash_budgets[j]:=year_cash/n+case when j<=mod(year_cash,n) then 1 else 0 end;end loop;
  fee_budgets:=private.apportion_shared_rent_minor(year_fee,cash_budgets);
  net_budgets:=array_fill(0::bigint,array[n]);
  for j in 1..n loop net_budgets[j]:=cash_budgets[j]-fee_budgets[j];end loop;
  for i in 0..jsonb_array_length(payments)-1 loop
   row:=payments->i;
   if (row->>'target_year')::integer<>year_no then continue;end if;
   partner_row:=p_agreement#>array['partner_schedule','payments',i::text];
   cash:=((row->>'amount')::numeric*100)::bigint;fee:=((row->>'wehouse_amount')::numeric*100)::bigint;
   promotion:=(coalesce((partner_row->>'promotion_amount')::numeric,0)*100)::bigint;
   if cash<=0 or fee<0 or fee>cash or promotion<0
    or (row->>'partner_net_amount')::numeric*100 is distinct from (cash-fee)::numeric
    or partner_row->>'sequence' is distinct from row->>'sequence' then
    raise exception 'A shared rental payment does not reconcile';end if;
   nets:=private.apportion_shared_rent_minor(cash-fee,net_budgets);
   fees:=private.apportion_shared_rent_minor(fee,fee_budgets);
   promotion_budgets:=array_fill(promotion,array[n]);
   promotions:=private.apportion_shared_rent_minor(promotion,promotion_budgets);
   for j in 1..n loop
    if nets[j]+fees[j]<=0 then raise exception 'This rent amount is too small to share between the selected payers';end if;
    net_budgets[j]:=net_budgets[j]-nets[j];fee_budgets[j]:=fee_budgets[j]-fees[j];
    customer[j]:=customer[j]||jsonb_build_array(row||jsonb_build_object('amount',(nets[j]+fees[j])/100.0,
     'partner_net_amount',nets[j]/100.0,'wehouse_amount',fees[j]/100.0));
    partner[j]:=partner[j]||jsonb_build_array(partner_row||jsonb_build_object('amount',(nets[j]+fees[j]+promotions[j])/100.0,
     'net_amount',nets[j]/100.0,'commission_amount',(fees[j]+promotions[j])/100.0,
     'wehouse_amount',fees[j]/100.0,'promotion_amount',promotions[j]/100.0));
   end loop;
  end loop;
  if exists(select 1 from unnest(net_budgets||fee_budgets) value where value<>0) then raise exception 'Shared year allocation is incomplete';end if;
 end loop;
 annual_budgets:=private.apportion_shared_rent_minor(((p_agreement#>>'{rent_schedule,annual_rent}')::numeric*100)::bigint,
  array_fill(((p_agreement#>>'{rent_schedule,annual_rent}')::numeric*100)::bigint,array[n]));
 first_budgets:=private.apportion_shared_rent_minor(((p_agreement#>>'{rent_schedule,first_year_rent}')::numeric*100)::bigint,
  array_fill(((p_agreement#>>'{rent_schedule,first_year_rent}')::numeric*100)::bigint,array[n]));
 for j in 1..n loop
  select sum((entry->>'amount')::numeric) into customer_total from jsonb_array_elements(customer[j]) entry;
  select sum((entry->>'amount')::numeric) into partner_total from jsonb_array_elements(partner[j]) entry;
  first_cash:=(customer[j]->0->>'amount')::numeric;first_partner:=(partner[j]->0->>'amount')::numeric;
  body:=(p_agreement-'accepted_at'-'accepted_by'-'quote_digest')||jsonb_build_object(
   'parent_agreement_digest',p_agreement->>'quote_digest','payer_user_id',p_people[j],
   'rent_schedule',(p_agreement->'rent_schedule')||jsonb_build_object('annual_rent',annual_budgets[j]/100.0,
    'first_year_rent',case when p_agreement#>>'{rent_schedule,payment_choice}'='monthly' then first_cash else first_budgets[j]/100.0 end,
    'contract_total',customer_total,'due_before_handover',first_cash,'future_balance',customer_total-first_cash,'payments',customer[j]),
   'partner_schedule',(p_agreement->'partner_schedule')||jsonb_build_object('contract_total',partner_total,
    'due_before_handover',first_partner,'future_balance',partner_total-first_partner,'payments',partner[j]));
  result:=result||jsonb_build_array(body||jsonb_build_object('quote_digest',md5(body::text)));
 end loop;
 return result;
end $$;
revoke all on function private.shared_long_let_payer_agreements(jsonb,text[]) from public,anon,authenticated;

commit;
