begin;
create function private.allocate_long_let_payment_splits(
 p_annual numeric,p_partner_first_year numeric,p_customer_first_year numeric,p_term_months integer,p_choice text,p_rate numeric
) returns jsonb language plpgsql immutable set search_path='' as $fn$
declare customer_schedule jsonb;partner_schedule jsonb;customer_payments jsonb:='[]'::jsonb;partner_payments jsonb:='[]'::jsonb;
 original_customer jsonb;original_partner jsonb;year_no integer;n integer;i integer;position integer;
 gross numeric;cash numeric;commission numeric;partner_total numeric;platform_total numeric;promotion_total numeric;
 partner_base numeric;platform_base numeric;promotion_base numeric;net numeric;platform numeric;promotion numeric;new_cash numeric;new_gross numeric;
begin
 if p_rate is null or p_rate::text in('NaN','Infinity','-Infinity') or p_rate not between 0 and 50 then raise exception 'Invalid agreed commission rate';end if;
 customer_schedule:=private.long_let_rent_schedule(p_annual,p_customer_first_year,p_term_months,p_choice);
 partner_schedule:=private.long_let_rent_schedule(p_annual,p_partner_first_year,p_term_months,p_choice);
 for year_no in select distinct (p->>'target_year')::integer from jsonb_array_elements(customer_schedule->'payments') p order by 1 loop
  select count(*),sum((p->>'amount')::numeric) into n,cash from jsonb_array_elements(customer_schedule->'payments') p where (p->>'target_year')::integer=year_no;
  select sum((p->>'amount')::numeric) into gross from jsonb_array_elements(partner_schedule->'payments') p where (p->>'target_year')::integer=year_no;
  commission:=round(gross*p_rate/100,2);partner_total:=gross-commission;
  platform_total:=cash-partner_total;promotion_total:=gross-cash;
  if platform_total<0 or promotion_total<0 then raise exception 'The offered discount exceeds the agreed commission funding';end if;
  partner_base:=trunc(partner_total/n,2);platform_base:=trunc(platform_total/n,2);promotion_base:=trunc(promotion_total/n,2);position:=0;
  for i in 0..jsonb_array_length(customer_schedule->'payments')-1 loop
   original_customer:=customer_schedule->'payments'->i;
   if (original_customer->>'target_year')::integer<>year_no then continue;end if;
   original_partner:=partner_schedule->'payments'->i;position:=position+1;
   net:=case when position=n then partner_total-partner_base*(n-1) else partner_base end;
   platform:=case when position=n then platform_total-platform_base*(n-1) else platform_base end;
   promotion:=case when position=n then promotion_total-promotion_base*(n-1) else promotion_base end;
   new_cash:=net+platform;new_gross:=net+platform+promotion;
   if new_cash<=0 or net<0 then raise exception 'Monthly rent is below supported currency precision';end if;
   customer_payments:=customer_payments||jsonb_build_array(original_customer||jsonb_build_object('amount',new_cash,'partner_net_amount',net,'wehouse_amount',platform));
   partner_payments:=partner_payments||jsonb_build_array(original_partner||jsonb_build_object('amount',new_gross,'net_amount',net,'commission_amount',platform+promotion,'wehouse_amount',platform,'promotion_amount',promotion));
  end loop;
 end loop;
 customer_schedule:=customer_schedule||jsonb_build_object('payments',customer_payments,'due_before_handover',(customer_payments->0->>'amount')::numeric,
  'future_balance',(customer_schedule->>'contract_total')::numeric-(customer_payments->0->>'amount')::numeric);
 partner_schedule:=partner_schedule||jsonb_build_object('payments',partner_payments,'due_before_handover',(partner_payments->0->>'amount')::numeric,
  'future_balance',(partner_schedule->>'contract_total')::numeric-(partner_payments->0->>'amount')::numeric);
 return jsonb_build_object('rent_schedule',customer_schedule,'partner_schedule',partner_schedule);
end $fn$;
revoke all on function private.allocate_long_let_payment_splits(numeric,numeric,numeric,integer,text,numeric) from public,anon,authenticated;

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

create function private.apply_agreed_long_let_protected_split() returns trigger
language plpgsql security definer set search_path='' as $fn$
declare r public.reservations;cash numeric;net numeric;
begin
 if new.subject_type is distinct from 'long_let_year_one' then return new;end if;
 select * into r from public.reservations where id=new.subject_id;
 if r.rent_terms_snapshot is null then return new;end if;
 cash:=(r.rent_terms_snapshot->'rent_schedule'->'payments'->0->>'amount')::numeric;
 net:=(r.rent_terms_snapshot->'partner_schedule'->'payments'->0->>'net_amount')::numeric;
 if net is null or net<0 or net>cash or new.amount_total is distinct from cash
  or new.paystack_reference is distinct from r.rent_payment_reference then raise exception 'Protected rent does not match its accepted payment allocation';end if;
 new.commission_rate:=(r.rent_terms_snapshot->>'commission_rate')::numeric;
 new.amount_payee:=net;new.amount_commission:=cash-net;
 return new;
end $fn$;
revoke all on function private.apply_agreed_long_let_protected_split() from public,anon,authenticated;
create trigger zz_agreed_long_let_protected_split before insert or update of amount_total,amount_commission,amount_payee,commission_rate,paystack_reference,subject_id
 on public.payment_protection_transactions for each row execute function private.apply_agreed_long_let_protected_split();
commit;

