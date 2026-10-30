begin;
create function pg_temp.expect(value boolean,description text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %',description;end if;end $$;
do $$
declare q jsonb;term integer;choice text;total numeric;payments jsonb;
begin
 foreach term in array array[3,6,12,24,36,48,60] loop
  foreach choice in array array['full','monthly'] loop
   if choice='monthly' and term<=12 then
    begin
     perform private.long_let_rent_schedule(1200000.07,1080000.05,term,choice,'2028-01-31');
     raise exception 'FAIL: monthly payment was allowed for a term of one year or less';
    exception when raise_exception then
     if sqlerrm not like 'Terms of one year or less are paid in full.%' then raise;end if;
    end;
    continue;
   end if;
   q:=private.long_let_rent_schedule(1200000.07,1080000.05,term,choice,'2028-01-31');
   select sum((p->>'amount')::numeric) into total from jsonb_array_elements(q->'payments') p;
   perform pg_temp.expect(total=(q->>'contract_total')::numeric,'every minor unit is allocated for '||term||' months '||choice);
   perform pg_temp.expect((q->>'future_balance')::numeric=total-(q->>'due_before_handover')::numeric,'balance equals agreed unpaid rent');
   perform pg_temp.expect((select bool_and((p->>'amount')::numeric>0) from jsonb_array_elements(q->'payments') p),'no zero or negative scheduled charge');
   if choice='full' then
    perform pg_temp.expect(jsonb_array_length(q->'payments')=1 and (q->>'future_balance')::numeric=0,'full contract paid before handover');
   else
    perform pg_temp.expect((q->>'due_before_handover')::numeric=1080000.05,'Year 1 is paid in full before handover');
    perform pg_temp.expect(jsonb_array_length(q->'payments')=1+8*(term/12-1),'Year 1 plus eight payments per later year');
    perform pg_temp.expect(q->'payments'->1->>'due_on'='2028-05-31','first later-year amount is due four months after handover');
    perform pg_temp.expect(q->'payments'->8->>'due_on'='2028-12-31','eight payments finish in the prior contract year');
   end if;
  end loop;
 end loop;
 q:=private.long_let_rent_schedule(1200000,1080000,3,'full');
 perform pg_temp.expect((q->>'contract_total')::numeric=270000,'accepted three-month term uses prorated first-year price');
 perform pg_temp.expect(q->>'schedule_anchor'='verified_handover_pending' and q->>'tenancy_start_date' is null,'no invented move-in date');
 q:=private.long_let_rent_schedule(1200000,1200000,24,'monthly','2027-10-31');
 perform pg_temp.expect(q->'payments'->1->>'due_on'='2028-02-29','four-month start respects leap-year month end');
 perform pg_temp.expect(not has_function_privilege('anon','private.long_let_rent_schedule(numeric,numeric,integer,text,date)','EXECUTE'),'private calculator is not an anonymous RPC');
 perform pg_temp.expect(not has_function_privilege('anon','public.set_my_long_let_rent_terms(uuid,integer,integer[],boolean)','EXECUTE'),'anonymous account cannot edit Partner terms');
end $$;
do $$
declare q jsonb;term integer;year_no integer;year_gross numeric;year_fee numeric;year_net numeric;rate numeric;
begin
 foreach term in array array[24,36,48,60] loop
  foreach rate in array array[0::numeric,10::numeric,12.37::numeric,50::numeric] loop
   q:=private.allocate_long_let_payment_splits(1200000,1200000,1200000,term,'monthly',rate);
   for year_no in 2..term/12 loop
    select sum((p->>'amount')::numeric),sum((p->>'wehouse_amount')::numeric),sum((p->>'net_amount')::numeric)
    into year_gross,year_fee,year_net from jsonb_array_elements(q->'partner_schedule'->'payments') p
    where (p->>'target_year')::integer=year_no;
    perform pg_temp.expect(year_gross=1200000,'eight payments fund exactly one later year');
    perform pg_temp.expect(year_fee=round(1200000*rate/100,2),'annual commission is allocated once, not charged eight times');
    perform pg_temp.expect(year_net=year_gross-year_fee,'Partner net plus commission equals collected rent');
   end loop;
  end loop;
 end loop;
 q:=private.allocate_long_let_payment_splits(1200000,1200000,1200000,24,'monthly',10);
 perform pg_temp.expect((select bool_and((p->>'amount')::numeric=150000 and (p->>'wehouse_amount')::numeric=15000 and (p->>'net_amount')::numeric=135000) from jsonb_array_elements(q->'partner_schedule'->'payments') p where (p->>'target_year')::integer=2),'10 percent example is 15000 per 150000 payment, not an annual fee per month');
end $$;
select 'Accepted Long Let term, monthly/full schedule, exact totals and calendar checks passed' as result;
do $$
declare q jsonb;p jsonb;partner jsonb;i integer;tenant_total numeric;partner_total numeric;platform_total numeric;
begin
 -- A tiny configured rate with a funded promotion exposes independent-rounding
 -- errors: no payment may require a negative platform share or overpay cash.
 q:=private.allocate_long_let_payment_splits(100.08,100.08,100.07,24,'monthly',0.01);
 tenant_total:=0;partner_total:=0;platform_total:=0;
 for i in 0..8 loop
  p:=q->'rent_schedule'->'payments'->i;partner:=q->'partner_schedule'->'payments'->i;
  if (p->>'amount')::numeric<>(partner->>'net_amount')::numeric+(partner->>'wehouse_amount')::numeric
   or (partner->>'net_amount')::numeric<0 or (partner->>'wehouse_amount')::numeric<0
   or (partner->>'promotion_amount')::numeric<0 then raise exception 'FAIL: unbalanced monthly allocation';end if;
  tenant_total:=tenant_total+(p->>'amount')::numeric;
  partner_total:=partner_total+(partner->>'net_amount')::numeric;
  platform_total:=platform_total+(partner->>'wehouse_amount')::numeric;
 end loop;
 if tenant_total<>200.15 or partner_total<>200.14 or platform_total<>0.01 then raise exception 'FAIL: funded monthly pennies were lost';end if;
 q:=private.allocate_long_let_payment_splits(1200000.07,1200000.07,1140000.07,24,'monthly',10);
 if (select sum((item->>'amount')::numeric) from jsonb_array_elements(q->'rent_schedule'->'payments') item)<>(q->'rent_schedule'->>'contract_total')::numeric then raise exception 'FAIL: multi-year allocation changed contract total';end if;
end $$;
rollback;
