begin;
create function pg_temp.expect(value boolean,description text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %',description;end if;end $$;
do $$
declare q jsonb;term integer;choice text;total numeric;payments jsonb;
begin
 foreach term in array array[3,6,12,24,36,48,60] loop
  foreach choice in array array['full','monthly'] loop
   q:=private.long_let_rent_schedule(1200000.07,1080000.05,term,choice,'2028-01-31');
   select sum((p->>'amount')::numeric) into total from jsonb_array_elements(q->'payments') p;
   perform pg_temp.expect(total=(q->>'contract_total')::numeric,'every minor unit is allocated for '||term||' months '||choice);
   perform pg_temp.expect((q->>'future_balance')::numeric=total-(q->>'due_before_handover')::numeric,'balance equals agreed unpaid rent');
   perform pg_temp.expect((select bool_and((p->>'amount')::numeric>0) from jsonb_array_elements(q->'payments') p),'no zero or negative scheduled charge');
   if choice='full' then
    perform pg_temp.expect(jsonb_array_length(q->'payments')=1 and (q->>'future_balance')::numeric=0,'full contract paid before handover');
   elsif term<=12 then
    perform pg_temp.expect(jsonb_array_length(q->'payments')=term,'one payment per accepted month');
    perform pg_temp.expect(q->'payments'->1->>'due_on'='2028-02-29','month-end due date respects leap year');
   else
    perform pg_temp.expect(jsonb_array_length(q->'payments')=1+8*(term/12-1),'Year 1 plus eight payments per later year');
    perform pg_temp.expect(q->'payments'->1->>'due_on'='2028-05-31','first later-year amount is due four months after handover');
    perform pg_temp.expect(q->'payments'->8->>'due_on'='2028-12-31','eight payments finish in the prior contract year');
   end if;
  end loop;
 end loop;
 q:=private.long_let_rent_schedule(1200000,1080000,3,'full');
 perform pg_temp.expect((q->>'contract_total')::numeric=270000,'accepted three-month term uses prorated first-year price');
 perform pg_temp.expect(q->>'schedule_anchor'='verified_handover_pending' and q->>'tenancy_start_date' is null,'no invented move-in date');
 perform pg_temp.expect(not has_function_privilege('anon','private.long_let_rent_schedule(numeric,numeric,integer,text,date)','EXECUTE'),'private calculator is not an anonymous RPC');
 perform pg_temp.expect(not has_function_privilege('anon','public.set_my_long_let_rent_terms(uuid,integer,integer[],boolean)','EXECUTE'),'anonymous account cannot edit Partner terms');
end $$;
select 'Accepted Long Let term, monthly/full schedule, exact totals and calendar checks passed' as result;
rollback;
