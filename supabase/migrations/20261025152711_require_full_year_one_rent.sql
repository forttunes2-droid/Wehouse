begin;
-- Owner correction: the first year is always paid in full. Monthly collection
-- can cover only later years of a landlord-approved multi-year agreement.
create or replace function private.long_let_rent_schedule(
 p_annual numeric,p_discounted_first_year numeric,p_term_months integer,
 p_payment_choice text,p_start_date date default null
) returns jsonb language plpgsql immutable set search_path='' as $fn$
declare first_year numeric;total numeric;first_due numeric;payments jsonb:='[]'::jsonb;
 base numeric;amount numeric;seq integer:=1;offset_months integer;i integer;y integer;n integer;
begin
 if p_annual is null or p_discounted_first_year is null
  or p_annual::text in ('NaN','Infinity','-Infinity')
  or p_discounted_first_year::text in ('NaN','Infinity','-Infinity')
  or p_annual<=0 or p_discounted_first_year<=0 or p_discounted_first_year>p_annual
  or p_annual<>round(p_annual,2) or p_discounted_first_year<>round(p_discounted_first_year,2)
  or p_term_months is null or p_term_months not in(3,6,12,24,36,48,60)
  or p_payment_choice is null or p_payment_choice not in('full','monthly')
  or (p_start_date is not null and not isfinite(p_start_date)) then
  raise exception 'Choose a valid Long Let term and payment agreement';
 end if;
 if p_payment_choice='monthly' and p_term_months<=12 then
  raise exception 'Terms of one year or less are paid in full. Monthly payments apply only to later years of a multi-year agreement';
 end if;
 first_year:=round(p_discounted_first_year*least(p_term_months,12)/12,2);
 total:=first_year+round(p_annual*greatest(p_term_months-12,0)/12,2);
 if total>9999999999.99 then raise exception 'Contract amount exceeds the supported payment range';end if;
 first_due:=case when p_payment_choice='monthly' then first_year else total end;
 if first_due<=0 then raise exception 'Required rent is below supported currency precision';end if;
 payments:=jsonb_build_array(jsonb_build_object('sequence',1,'target_year',1,
  'month_offset',0,'due_before_handover',true,'due_on',p_start_date,'amount',first_due));
 if p_payment_choice='monthly' then
  n:=p_term_months/12;base:=trunc(p_annual/8,2);
  for y in 2..n loop
   for i in 1..8 loop
    seq:=seq+1;offset_months:=12*(y-2)+3+i;
    amount:=case when i=8 then p_annual-base*7 else base end;
    payments:=payments||jsonb_build_array(jsonb_build_object('sequence',seq,'target_year',y,
     'month_offset',offset_months,'due_before_handover',false,
     'due_on',case when p_start_date is null then null else (p_start_date+make_interval(months=>offset_months))::date end,'amount',amount));
   end loop;
  end loop;
 end if;
 return jsonb_build_object('term_months',p_term_months,'payment_choice',p_payment_choice,
  'annual_rent',p_annual,'first_year_rent',first_year,'contract_total',total,
  'due_before_handover',first_due,'future_balance',total-first_due,
  'schedule_anchor',case when p_start_date is null then 'verified_handover_pending' else 'verified_handover' end,
  'tenancy_start_date',p_start_date,'tenancy_end_date',case when p_start_date is null then null else (p_start_date+make_interval(months=>p_term_months))::date end,
  'payments',payments);
end $fn$;
CREATE OR REPLACE FUNCTION private.long_let_booking_quote(p_reservation_id text, p_term_months integer, p_payment_choice text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.reservations;l public.listings;customer_schedule jsonb;partner_schedule jsonb;body jsonb;
 annual numeric;discounted numeric;partner_rent numeric;discount numeric;wh_discount numeric;policy record;bank_id uuid;allocation jsonb;
begin
 select * into r from public.reservations where id=p_reservation_id;
 select * into l from public.listings where id::text=r.listing_id and deleted_at is null;
 if r.id is null or l.id is null or l.sub_type<>'long_stay' or r.stay_type='short_let'
  or r.shared_payment_group_id is not null then raise exception 'Individual Long Let reservation required';end if;
 if p_term_months is null or not(p_term_months=any(l.accepted_lease_terms_months)) then raise exception 'Choose a length of stay accepted by this Property Partner';end if;
 if coalesce(l.currency,'NGN')<>'NGN' then raise exception 'This property currency is not supported for checkout';end if;
 if p_payment_choice='monthly' and p_term_months<=12 then
  raise exception 'One-year rent is paid in full. Monthly payments are only for later years of an accepted multi-year term';
 end if;
 if p_payment_choice='monthly' then
  if not coalesce(l.future_installments_allowed,false) then raise exception 'This Property Partner requires full payment';end if;
  bank_id:=private.long_let_settlement_account(l.id);
  if bank_id is null then raise exception 'The Property Partner must complete verified monthly settlement setup first';end if;
 end if;
 annual:=round(coalesce(r.annual_rent_snapshot,l.price),2);
 select q.payable,q.partner_rent,q.discount_percent,q.wehouse_percent into discounted,partner_rent,discount,wh_discount
  from public.long_let_year_one_quote(l.id,annual) q;
 select * into policy from private.resolve_apartment_commission_policy('long_stay',
  coalesce(r.management_mode_snapshot,l.management_mode,'wehouse'),r.commission_policy_version_id);
 if policy.policy_version_id is null or policy.percent not between 0 and 50 then raise exception 'A configured Long Let commission is required';end if;
 allocation:=private.allocate_long_let_payment_splits(annual,partner_rent,discounted,p_term_months,p_payment_choice,policy.percent);
 customer_schedule:=allocation->'rent_schedule';partner_schedule:=allocation->'partner_schedule';

 body:=jsonb_build_object('schema_version',1,'reservation_id',r.id,'listing_id',l.id,
  'offer_revision',l.rent_terms_revision,'currency','NGN','rent_schedule',customer_schedule,
  'partner_schedule',partner_schedule,'commission_policy_version_id',policy.policy_version_id,
  'commission_rate',policy.percent,'discount_percent',discount,'wehouse_discount_percent',wh_discount,
  'settlement_account_id',bank_id);
 return body||jsonb_build_object('quote_digest',md5(body::text));
end $function$;

CREATE OR REPLACE FUNCTION private.sync_agreed_long_let_schedule(p_reservation_id text, p_start_date date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  part:=((idx-1)%8)+1;
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
end $function$;

CREATE OR REPLACE FUNCTION public.set_my_long_let_rent_terms(p_listing_id uuid, p_expected_revision integer, p_terms_months integer[], p_monthly_accepted boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare l public.listings;normalized integer[];
begin
 if not public._property_document_session_active() or not private.can_change_long_let_rent_offer(p_listing_id) then
  raise exception 'Full property commercial access is required' using errcode='42501';end if;
 if p_terms_months is null or cardinality(p_terms_months) not between 1 and 7
  or not(p_terms_months <@ array[3,6,12,24,36,48,60])
  or array_position(p_terms_months,null) is not null or p_monthly_accepted is null or p_expected_revision is null then
  raise exception 'Choose supported rental terms and whether monthly rent is accepted';end if;
 if p_monthly_accepted and not exists(select 1 from unnest(p_terms_months) term where term>12) then
  raise exception 'Offer a multi-year term before accepting monthly payments for later years';
 end if;
 select array_agg(distinct v order by v) into normalized from unnest(p_terms_months) v;
 if cardinality(normalized)<>cardinality(p_terms_months) then raise exception 'Choose each rental term once';end if;
 select * into l from public.listings where id=p_listing_id and sub_type='long_stay' and deleted_at is null for update;
 if l.id is null then raise exception 'Long Let property unavailable';end if;
 if l.rent_terms_revision in(p_expected_revision,p_expected_revision+1)
  and l.accepted_lease_terms_months=normalized and coalesce(l.future_installments_allowed,false)=p_monthly_accepted then
  return public.get_my_long_let_rent_terms(l.id);end if;
 if l.rent_terms_revision<>p_expected_revision then raise exception 'Rental terms changed. Refresh before saving';end if;
 update public.listings set accepted_lease_terms_months=normalized,
  future_installments_allowed=p_monthly_accepted,rent_terms_revision=rent_terms_revision+1,updated_at=now() where id=l.id;
 insert into public.audit_logs(action,target_type,target_id,admin_id,details) values('LONG_LET_RENT_TERMS_UPDATED','listing',l.id::text,
  public.current_profile_user_id(),jsonb_build_object('previous_terms',l.accepted_lease_terms_months,
  'previous_monthly_accepted',coalesce(l.future_installments_allowed,false),'terms',normalized,'monthly_accepted',p_monthly_accepted)::text);
 return public.get_my_long_let_rent_terms(l.id);
end $function$;

alter table public.reservations add constraint reservation_monthly_future_years_only check(rent_payment_choice is distinct from 'monthly' or lease_term_months>12);
alter table public.rent_plan_contributions drop constraint rent_plan_contributions_installment_number_check,
 drop constraint rent_plan_contributions_target_year_check,
 add constraint rent_plan_contributions_installment_number_check check(installment_number is null or installment_number between 1 and 8),
 add constraint rent_plan_contributions_target_year_check check(target_year is null or target_year between 2 and 20);
commit;
