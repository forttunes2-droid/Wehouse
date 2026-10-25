begin;
alter table public.bank_accounts drop constraint bank_rent_subaccount_receipt;
alter table public.bank_accounts add constraint bank_rent_subaccount_receipt check(
 (rent_subaccount_code is null and rent_subaccount_provider_id is null and rent_subaccount_environment is null and rent_subaccount_verified_at is null)
 or (rent_subaccount_code is not null and rent_subaccount_provider_id is not null and rent_subaccount_environment is not null
  and rent_subaccount_verified_at is not null and rent_subaccount_code ~ '^ACCT_[A-Za-z0-9]+$'
  and rent_subaccount_provider_id ~ '^[0-9]+$' and rent_subaccount_environment in('test','live')));
alter table public.rent_plan_contributions
 add column agreement_sequence integer check(agreement_sequence>=2),
 drop constraint rent_plan_contributions_installment_number_check,
 drop constraint rent_plan_contributions_target_year_check,
 add constraint rent_plan_contributions_installment_number_check check(installment_number is null or installment_number between 1 and 12),
 add constraint rent_plan_contributions_target_year_check check(target_year is null or target_year between 1 and 20);

create function private.sync_agreed_long_let_schedule(p_reservation_id text,p_start_date date default null) returns uuid
language plpgsql security definer set search_path='' as $fn$
declare r public.reservations;plan public.rent_plans;payment jsonb;existing public.rent_plan_contributions;
 schedule jsonb;future_balance numeric;first_due numeric;total numeric;idx integer;target integer;part integer;due date;
begin
 select * into r from public.reservations where id=p_reservation_id for update;
 if r.id is null or r.rent_terms_snapshot is null then raise exception 'Accepted rental agreement required';end if;
 schedule:=r.rent_terms_snapshot->'rent_schedule';
 future_balance:=(schedule->>'future_balance')::numeric;
 if future_balance=0 then return null;end if;
 if r.rent_payment_status not in('paid','upfront_paid') or r.rent_paid_at is null then raise exception 'Required handover payment must be verified first';end if;
 first_due:=(schedule->>'due_before_handover')::numeric;total:=(schedule->>'contract_total')::numeric;
 select * into plan from public.rent_plans where reservation_id=r.id and status<>'cancelled' for update;
 if plan.id is null then
  insert into public.rent_plans(user_id,listing_id,reservation_id,target_amount,start_after_months,
   cancellation_fee_percent,accepted_terms,status,total_contract_rent,upfront_percent,upfront_amount,
   installment_count,installment_amount,installment_balance,paid_installments)
  values(r.user_id,r.listing_id::uuid,r.id,future_balance,(schedule->'payments'->1->>'month_offset')::integer,
   0,(r.rent_terms_snapshot||jsonb_build_object('automatic_fees_configured',false))::text,'active',total,
   round(first_due/total*100,2),first_due,jsonb_array_length(schedule->'payments')-1,
   (schedule->'payments'->1->>'amount')::numeric,future_balance,0) returning * into plan;
 elsif plan.accepted_terms::jsonb->>'quote_digest' is distinct from r.rent_terms_snapshot->>'quote_digest' then
  raise exception 'Existing rent schedule belongs to a different agreement';
 end if;
 if p_start_date is not null and plan.tenancy_start_date is not null and plan.tenancy_start_date<>p_start_date then
  raise exception 'The recorded tenancy date cannot be silently moved';end if;
 for idx in 1..jsonb_array_length(schedule->'payments')-1 loop
  payment:=schedule->'payments'->idx;
  target:=(payment->>'target_year')::integer;
  part:=case when r.lease_term_months<=12 then idx else ((idx-1)%8)+1 end;
  due:=case when p_start_date is null then null else (p_start_date+make_interval(months=>(payment->>'month_offset')::integer))::date end;
  insert into public.rent_plan_contributions(rent_plan_id,reservation_id,amount,status,target_year,installment_number,due_date,agreement_sequence)
   values(plan.id,r.id,(payment->>'amount')::numeric,'scheduled',target,part,due,idx+1)
   on conflict(rent_plan_id,target_year,installment_number) do nothing;
  select * into existing from public.rent_plan_contributions
   where rent_plan_id=plan.id and target_year=target and installment_number=part for update;
  if existing.amount is distinct from (payment->>'amount')::numeric or existing.agreement_sequence is distinct from idx+1
   or (existing.due_date is not null and due is not null and existing.due_date<>due) then
   raise exception 'Scheduled rent no longer matches the accepted agreement';end if;
  if due is not null and existing.due_date is null then
   update public.rent_plan_contributions set due_date=due,updated_at=now() where id=existing.id;
  end if;
 end loop;
 update public.rent_plans set tenancy_start_date=coalesce(tenancy_start_date,p_start_date),
  next_rent_due_date=(select min(c.due_date) from public.rent_plan_contributions c where c.rent_plan_id=plan.id and c.status in('scheduled','pending','payment_pending')),
  updated_at=now() where id=plan.id;
 return plan.id;
end $fn$;
revoke all on function private.sync_agreed_long_let_schedule(text,date) from public,anon,authenticated;

do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.fulfill_apartment_rent_payment()'::regprocedure);
 needle:=$needle$  if coalesce(v_res.installment_balance,0)>0 then$needle$;
 if position(needle in definition)=0 then raise exception 'Inspect rent payment fulfillment before upgrading';end if;
 execute replace(definition,needle,$replacement$  if v_res.rent_terms_snapshot is not null then
    perform private.sync_agreed_long_let_schedule(v_res.id,null);
    return new;
  end if;
  if coalesce(v_res.installment_balance,0)>0 then$replacement$);

 definition:=pg_get_functiondef('private.activate_apartment_tenancy(text,date)'::regprocedure);
 needle:=$needle$  v_end:=(p_start_date+make_interval(years=>v_years))::date;$needle$;
 if position(needle in definition)=0 then raise exception 'Inspect tenancy term boundary before upgrading';end if;
 definition:=replace(definition,needle,'  v_end:=(p_start_date+make_interval(months=>coalesce(v_res.lease_term_months,12*v_years)))::date;');
 needle:=$needle$  IF v_years>1 THEN
    SELECT id INTO v_plan_id
    FROM public.rent_plans
    WHERE reservation_id=v_res.id AND status='active'
    LIMIT 1;
    IF v_plan_id IS NULL THEN RAISE EXCEPTION 'Future-rent plan is missing'; END IF;

    v_annual:=round(COALESCE(v_res.annual_rent_snapshot,v_listing.price),2);
    v_base:=trunc(v_annual/8.0,2);

    FOR v_target_year IN 2..v_years LOOP
      FOR v_i IN 1..8 LOOP
        v_due:=(p_start_date+make_interval(years=>v_target_year-2,months=>4+v_i-1))::date;
        v_amount:=CASE WHEN v_i=8 THEN round(v_annual-(v_base*7),2) ELSE v_base END;
        INSERT INTO public.rent_plan_contributions(
          rent_plan_id,reservation_id,amount,status,target_year,installment_number,due_date,created_at,updated_at
        ) VALUES (
          v_plan_id,v_res.id,v_amount,'scheduled',v_target_year,v_i,v_due,now(),now()
        )
        ON CONFLICT (rent_plan_id,target_year,installment_number)
        DO UPDATE SET
          reservation_id=EXCLUDED.reservation_id,
          amount=CASE WHEN public.rent_plan_contributions.status IN ('paid','completed') THEN public.rent_plan_contributions.amount ELSE EXCLUDED.amount END,
          due_date=CASE WHEN public.rent_plan_contributions.status IN ('paid','completed') THEN public.rent_plan_contributions.due_date ELSE EXCLUDED.due_date END,
          updated_at=now();
      END LOOP;
    END LOOP;

    UPDATE public.rent_plans
    SET next_rent_due_date=(
          SELECT min(c.due_date) FROM public.rent_plan_contributions c
          WHERE c.rent_plan_id=v_plan_id AND c.status IN ('scheduled','payment_pending','pending')
        ),
        installment_count=8*(v_years-1),
        installment_balance=round(v_annual*(v_years-1),2),
        target_amount=round(v_annual*(v_years-1),2),
        updated_at=now()
    WHERE id=v_plan_id;
  END IF;

$needle$;
 if position(needle in definition)=0 then raise exception 'Inspect tenancy schedule activation before upgrading';end if;
 definition:=replace(definition,needle,$replacement$  IF v_res.rent_terms_snapshot IS NOT NULL THEN
    PERFORM private.sync_agreed_long_let_schedule(v_res.id,p_start_date);
  ELSE
  IF v_years>1 THEN
    SELECT id INTO v_plan_id
    FROM public.rent_plans
    WHERE reservation_id=v_res.id AND status='active'
    LIMIT 1;
    IF v_plan_id IS NULL THEN RAISE EXCEPTION 'Future-rent plan is missing'; END IF;

    v_annual:=round(COALESCE(v_res.annual_rent_snapshot,v_listing.price),2);
    v_base:=trunc(v_annual/8.0,2);

    FOR v_target_year IN 2..v_years LOOP
      FOR v_i IN 1..8 LOOP
        v_due:=(p_start_date+make_interval(years=>v_target_year-2,months=>4+v_i-1))::date;
        v_amount:=CASE WHEN v_i=8 THEN round(v_annual-(v_base*7),2) ELSE v_base END;
        INSERT INTO public.rent_plan_contributions(
          rent_plan_id,reservation_id,amount,status,target_year,installment_number,due_date,created_at,updated_at
        ) VALUES (
          v_plan_id,v_res.id,v_amount,'scheduled',v_target_year,v_i,v_due,now(),now()
        )
        ON CONFLICT (rent_plan_id,target_year,installment_number)
        DO UPDATE SET
          reservation_id=EXCLUDED.reservation_id,
          amount=CASE WHEN public.rent_plan_contributions.status IN ('paid','completed') THEN public.rent_plan_contributions.amount ELSE EXCLUDED.amount END,
          due_date=CASE WHEN public.rent_plan_contributions.status IN ('paid','completed') THEN public.rent_plan_contributions.due_date ELSE EXCLUDED.due_date END,
          updated_at=now();
      END LOOP;
    END LOOP;

    UPDATE public.rent_plans
    SET next_rent_due_date=(
          SELECT min(c.due_date) FROM public.rent_plan_contributions c
          WHERE c.rent_plan_id=v_plan_id AND c.status IN ('scheduled','payment_pending','pending')
        ),
        installment_count=8*(v_years-1),
        installment_balance=round(v_annual*(v_years-1),2),
        target_amount=round(v_annual*(v_years-1),2),
        updated_at=now()
    WHERE id=v_plan_id;
  END IF;

  END IF;

$replacement$);
 definition:=replace(definition,'Year 1 rent must be verified before move-in','The agreed payment must be verified before handover');
 execute definition;

 definition:=pg_get_functiondef('public.update_my_reservation_plan(text,integer)'::regprocedure);
 needle:=$needle$  if v_res.id is null then raise exception 'Active reservation not found'; end if;$needle$;
 if position(needle in definition)=0 then raise exception 'Inspect legacy yearly plan command before upgrading';end if;
 execute replace(definition,needle,needle||$replacement$
  if v_res.rent_terms_snapshot is not null then raise exception 'Use the reviewed rental agreement to change these terms';end if;
$replacement$);
end $patch$;
commit;

