begin;
-- One commercial offer on each existing Long Let listing. Reuse the existing
-- monthly opt-in column; do not introduce a competing payment-plan flag.
alter table public.listings
 add column accepted_lease_terms_months integer[] not null default array[12],
 add column rent_terms_revision integer not null default 1 check(rent_terms_revision>0),
 add constraint listing_accepted_lease_terms check(
  cardinality(accepted_lease_terms_months) between 1 and 7
  and accepted_lease_terms_months <@ array[3,6,12,24,36,48,60]
  and array_position(accepted_lease_terms_months,null) is null);

create function private.long_let_rent_schedule(
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
 first_year:=round(p_discounted_first_year*least(p_term_months,12)/12,2);
 total:=first_year+round(p_annual*greatest(p_term_months-12,0)/12,2);
 if total>9999999999.99 then raise exception 'Contract amount exceeds the supported payment range';end if;
 first_due:=case when p_payment_choice='monthly' and p_term_months<=12
  then trunc(total/p_term_months,2)
  when p_payment_choice='monthly' then first_year else total end;
 if first_due<=0 then raise exception 'Monthly amount is below supported currency precision';end if;
 payments:=jsonb_build_array(jsonb_build_object('sequence',1,'target_year',1,
  'month_offset',0,'due_before_handover',true,'due_on',p_start_date,'amount',first_due));
 if p_payment_choice='monthly' and p_term_months<=12 then
  base:=first_due;
  for i in 2..p_term_months loop
   amount:=case when i=p_term_months then total-base*(p_term_months-1) else base end;
   payments:=payments||jsonb_build_array(jsonb_build_object('sequence',i,'target_year',1,
    'month_offset',i-1,'due_before_handover',false,
    'due_on',case when p_start_date is null then null else (p_start_date+make_interval(months=>i-1))::date end,'amount',amount));
  end loop;
 elsif p_payment_choice='monthly' and p_term_months>12 then
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
revoke all on function private.long_let_rent_schedule(numeric,numeric,integer,text,date) from public,anon,authenticated;

create function public.get_my_long_let_rent_terms(p_listing_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
declare l public.listings;
begin
 if not public._property_document_session_active() or not public.current_actor_can_change_property_commercials(p_listing_id) then
  raise exception 'Full property commercial access is required' using errcode='42501';end if;
 select * into l from public.listings where id=p_listing_id and deleted_at is null and sub_type='long_stay';
 if l.id is null then raise exception 'Long Let property unavailable';end if;
 return jsonb_build_object('listing_id',l.id,'revision',l.rent_terms_revision,
  'accepted_terms_months',l.accepted_lease_terms_months,
  'monthly_accepted',coalesce(l.future_installments_allowed,false));
end $fn$;
revoke all on function public.get_my_long_let_rent_terms(uuid) from public,anon;
grant execute on function public.get_my_long_let_rent_terms(uuid) to authenticated;

create function public.set_my_long_let_rent_terms(p_listing_id uuid,p_expected_revision integer,p_terms_months integer[],p_monthly_accepted boolean) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare l public.listings;normalized integer[];
begin
 if not public._property_document_session_active() or not public.current_actor_can_change_property_commercials(p_listing_id) then
  raise exception 'Full property commercial access is required' using errcode='42501';end if;
 if p_terms_months is null or cardinality(p_terms_months) not between 1 and 7
  or not(p_terms_months <@ array[3,6,12,24,36,48,60])
  or array_position(p_terms_months,null) is not null or p_monthly_accepted is null or p_expected_revision is null then
  raise exception 'Choose supported rental terms and whether monthly rent is accepted';end if;
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
end $fn$;
revoke all on function public.set_my_long_let_rent_terms(uuid,integer,integer[],boolean) from public,anon;
grant execute on function public.set_my_long_let_rent_terms(uuid,integer,integer[],boolean) to authenticated;
commit;

