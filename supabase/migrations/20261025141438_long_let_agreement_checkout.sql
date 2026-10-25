begin;
alter table public.bank_accounts
 add column rent_subaccount_code text,
 add column rent_subaccount_provider_id text,
 add column rent_subaccount_environment text,
 add column rent_subaccount_verified_at timestamptz,
 add constraint bank_rent_subaccount_receipt check(
  (rent_subaccount_code is null and rent_subaccount_provider_id is null and rent_subaccount_environment is null and rent_subaccount_verified_at is null)
  or (rent_subaccount_code ~ '^ACCT_[A-Za-z0-9]+$' and rent_subaccount_provider_id ~ '^[0-9]+$'
   and rent_subaccount_environment in('test','live') and rent_subaccount_verified_at is not null));
alter table public.reservations
 add column lease_term_months integer check(lease_term_months in(3,6,12,24,36,48,60)),
 add column rent_payment_choice text check(rent_payment_choice in('full','monthly')),
 add column rent_terms_snapshot jsonb,
 add constraint reservation_rent_agreement_pair check(
  (rent_terms_snapshot is null and lease_term_months is null and rent_payment_choice is null)
  or (rent_terms_snapshot is not null and lease_term_months is not null and rent_payment_choice is not null
   and jsonb_typeof(rent_terms_snapshot)='object' and octet_length(rent_terms_snapshot::text)<=65536));

create function private.guard_rent_settlement_account() returns trigger
language plpgsql set search_path='' as $fn$
begin
 if tg_op='UPDATE' and (new.user_id,new.bank_code,new.account_number) is distinct from (old.user_id,old.bank_code,old.account_number) then
  new.rent_subaccount_code:=null;new.rent_subaccount_provider_id:=null;
  new.rent_subaccount_environment:=null;new.rent_subaccount_verified_at:=null;
 end if;
 if current_user not in('postgres','service_role') then
  if tg_op='INSERT' and new.rent_subaccount_code is not null then
   raise exception 'Verified settlement setup is server-controlled' using errcode='42501';
  elsif tg_op='UPDATE' and (new.rent_subaccount_code,new.rent_subaccount_provider_id,new.rent_subaccount_environment,new.rent_subaccount_verified_at)
   is distinct from (old.rent_subaccount_code,old.rent_subaccount_provider_id,old.rent_subaccount_environment,old.rent_subaccount_verified_at) then
   raise exception 'Verified settlement setup is server-controlled' using errcode='42501';
  end if;
 end if;
 return new;
end $fn$;
revoke all on function private.guard_rent_settlement_account() from public,anon,authenticated;
create trigger guard_rent_settlement_account before insert or update on public.bank_accounts
 for each row execute function private.guard_rent_settlement_account();

create function private.long_let_settlement_account(p_listing_id uuid) returns uuid
language sql stable security definer set search_path='' as $fn$
 select b.id from public.bank_accounts b join public.listings l on l.id=p_listing_id
 where b.user_id=coalesce(l.partner_id,l.owner_id) and b.is_default and b.is_active and b.verified_at is not null
  and b.rent_subaccount_verified_at is not null and b.rent_subaccount_code ~ '^ACCT_[A-Za-z0-9]+$'
  and b.rent_subaccount_environment in('test','live') limit 1;
$fn$;
revoke all on function private.long_let_settlement_account(uuid) from public,anon,authenticated;

create function private.long_let_booking_quote(p_reservation_id text,p_term_months integer,p_payment_choice text) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
declare r public.reservations;l public.listings;customer_schedule jsonb;partner_schedule jsonb;body jsonb;
 annual numeric;discounted numeric;partner_rent numeric;discount numeric;wh_discount numeric;policy record;bank_id uuid;
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
 customer_schedule:=private.long_let_rent_schedule(annual,discounted,p_term_months,p_payment_choice);
 partner_schedule:=private.long_let_rent_schedule(annual,partner_rent,p_term_months,p_payment_choice);
 select * into policy from private.resolve_apartment_commission_policy('long_stay',
  coalesce(r.management_mode_snapshot,l.management_mode,'wehouse'),r.commission_policy_version_id);
 if policy.policy_version_id is null or policy.percent not between 0 and 50 then raise exception 'A configured Long Let commission is required';end if;
 body:=jsonb_build_object('schema_version',1,'reservation_id',r.id,'listing_id',l.id,
  'offer_revision',l.rent_terms_revision,'currency','NGN','rent_schedule',customer_schedule,
  'partner_schedule',partner_schedule,'commission_policy_version_id',policy.policy_version_id,
  'commission_rate',policy.percent,'discount_percent',discount,'wehouse_discount_percent',wh_discount,
  'settlement_account_id',bank_id);
 return body||jsonb_build_object('quote_digest',md5(body::text));
end $fn$;
revoke all on function private.long_let_booking_quote(text,integer,text) from public,anon,authenticated;

create function private.require_long_let_customer(p_reservation_id text) returns text
language plpgsql stable security definer set search_path='' as $fn$
declare actor text;
begin
 select user_id into actor from public.profiles where auth_id=auth.uid()::text
  and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false);
 if actor is null or not public._property_document_session_active()
  or not exists(select 1 from public.reservations where id=p_reservation_id and user_id=actor) then
  raise exception 'An active trusted booking session is required' using errcode='42501';end if;
 return actor;
end $fn$;
revoke all on function private.require_long_let_customer(text) from public,anon,authenticated;

create function public.get_my_long_let_terms_offer(p_reservation_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.require_long_let_customer(p_reservation_id);r public.reservations;l public.listings;
begin
 select * into r from public.reservations where id=p_reservation_id;
 select * into l from public.listings where id::text=r.listing_id and deleted_at is null;
 if l.id is null or l.sub_type<>'long_stay' or r.stay_type='short_let' or r.shared_payment_group_id is not null then raise exception 'Individual Long Let reservation required';end if;
 return jsonb_build_object('reservation_id',r.id,'listing_id',l.id,'offer_revision',l.rent_terms_revision,
  'accepted_terms_months',l.accepted_lease_terms_months,'monthly_accepted',coalesce(l.future_installments_allowed,false),
  'monthly_ready',private.long_let_settlement_account(l.id) is not null,
  'agreement',r.rent_terms_snapshot,'editable',r.status in('payment_pending','reserved','inspection_pending','ready_for_move_in')
   and coalesce(r.rent_payment_status,'not_started')='not_started'
   and not exists(select 1 from public.booking_payments p where p.metadata->>'reservation_id'=r.id and p.purpose='apartment_rent' and p.status='pending'));
end $fn$;
revoke all on function public.get_my_long_let_terms_offer(text) from public,anon;
grant execute on function public.get_my_long_let_terms_offer(text) to authenticated;

create function public.preview_my_long_let_agreement(p_reservation_id text,p_term_months integer,p_payment_choice text) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
begin
 perform private.require_long_let_customer(p_reservation_id);
 return private.long_let_booking_quote(p_reservation_id,p_term_months,p_payment_choice);
end $fn$;
revoke all on function public.preview_my_long_let_agreement(text,integer,text) from public,anon;
grant execute on function public.preview_my_long_let_agreement(text,integer,text) to authenticated;

create function public.accept_my_long_let_agreement(p_reservation_id text,p_term_months integer,p_payment_choice text,p_quote_digest text) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.require_long_let_customer(p_reservation_id);r public.reservations;quote jsonb;annual numeric;first_partner numeric;
begin
 select * into r from public.reservations where id=p_reservation_id for update;
 if r.rent_terms_snapshot->>'quote_digest'=p_quote_digest then return r.rent_terms_snapshot;end if;
 if r.status not in('payment_pending','reserved','inspection_pending','ready_for_move_in')
  or coalesce(r.rent_payment_status,'not_started')<>'not_started'
  or exists(select 1 from public.booking_payments p where p.metadata->>'reservation_id'=r.id and p.purpose='apartment_rent' and p.status='pending') then
  raise exception 'The rent agreement cannot change after checkout starts';end if;
 perform 1 from public.listings where id::text=r.listing_id for share;
 quote:=private.long_let_booking_quote(r.id,p_term_months,p_payment_choice);
 if p_quote_digest is null or quote->>'quote_digest'<>p_quote_digest then raise exception 'Rental terms or price changed. Review the agreement again';end if;
 annual:=(quote->'rent_schedule'->>'annual_rent')::numeric;
 first_partner:=(quote->'partner_schedule'->'payments'->0->>'amount')::numeric;
 quote:=quote||jsonb_build_object('accepted_at',now(),'accepted_by',actor);
 update public.reservations set lease_term_months=p_term_months,rent_payment_choice=p_payment_choice,rent_terms_snapshot=quote,
  rental_plan_years=ceil(p_term_months/12.0)::integer,rental_plan_selected_at=now(),annual_rent_snapshot=annual,
  contract_rent_total=(quote->'rent_schedule'->>'contract_total')::numeric,
  upfront_rent_required=(quote->'rent_schedule'->>'due_before_handover')::numeric,
  installment_balance=(quote->'rent_schedule'->>'future_balance')::numeric,
  installment_count=jsonb_array_length(quote->'rent_schedule'->'payments')-1,
  year_one_partner_rent_snapshot=first_partner,year_one_discount_percent_snapshot=(quote->>'discount_percent')::numeric,
  year_one_wehouse_discount_percent_snapshot=(quote->>'wehouse_discount_percent')::numeric,updated_at=now()
 where id=r.id;
 insert into public.audit_logs(action,target_type,target_id,admin_id,details)
 values('LONG_LET_AGREEMENT_ACCEPTED','reservation',r.id,actor,
  jsonb_build_object('previous_digest',r.rent_terms_snapshot->>'quote_digest','agreement',quote)::text);
 return quote;
end $fn$;
revoke all on function public.accept_my_long_let_agreement(text,integer,text,text) from public,anon;
grant execute on function public.accept_my_long_let_agreement(text,integer,text,text) to authenticated;

create function private.guard_long_let_agreement_write() returns trigger
language plpgsql set search_path='' as $fn$
begin
 if tg_op='UPDATE' and old.rent_terms_snapshot is not null and coalesce(old.rent_payment_status,'not_started')<>'not_started'
  and (new.rent_terms_snapshot,new.lease_term_months,new.rent_payment_choice) is distinct from (old.rent_terms_snapshot,old.lease_term_months,old.rent_payment_choice) then
  raise exception 'A started rent checkout keeps its accepted agreement';end if;
 if current_user not in('postgres','service_role') then
  if tg_op='INSERT' and new.rent_terms_snapshot is not null then raise exception 'Use the reviewed rental agreement' using errcode='42501';
  elsif tg_op='UPDATE' and (new.rent_terms_snapshot,new.lease_term_months,new.rent_payment_choice) is distinct from (old.rent_terms_snapshot,old.lease_term_months,old.rent_payment_choice) then
   raise exception 'Use the reviewed rental agreement' using errcode='42501';end if;
 end if;
 return new;
end $fn$;
revoke all on function private.guard_long_let_agreement_write() from public,anon,authenticated;
create trigger guard_long_let_agreement_write before insert or update on public.reservations for each row execute function private.guard_long_let_agreement_write();

do $patch$
declare definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef('public.create_apartment_rent_payment(text)'::regprocedure);
 needle:=$needle$  v_years:=COALESCE(v_res.rental_plan_years,1);
  IF v_years<1 OR v_years>5 THEN RAISE EXCEPTION 'Reservation tenure must be between 1 and 5 years'; END IF;
  v_annual:=round(COALESCE(v_res.annual_rent_snapshot,v_listing.price),2);
  IF v_annual<=0 THEN RAISE EXCEPTION 'Required Year 1 rent is invalid'; END IF;
  select q.payable,q.partner_rent,q.discount_percent,q.wehouse_percent into v_upfront,v_partner,v_disc,v_wh from public.long_let_year_one_quote(v_listing.id,v_annual) q; v_total:=round(v_upfront+v_annual*greatest(v_years-1,0),2); v_balance:=round(v_annual*GREATEST(v_years-1,0),2); v_count:=8*GREATEST(v_years-1,0);

$needle$;
 replacement:=$replacement$  IF coalesce(v_listing.currency,'NGN')<>'NGN' THEN RAISE EXCEPTION 'This property currency is not supported for checkout'; END IF;
  IF v_res.rent_terms_snapshot IS NOT NULL THEN
    v_years:=ceil(v_res.lease_term_months/12.0)::integer;
    v_annual:=(v_res.rent_terms_snapshot->'rent_schedule'->>'annual_rent')::numeric;
    v_upfront:=(v_res.rent_terms_snapshot->'rent_schedule'->>'due_before_handover')::numeric;
    v_total:=(v_res.rent_terms_snapshot->'rent_schedule'->>'contract_total')::numeric;
    v_balance:=(v_res.rent_terms_snapshot->'rent_schedule'->>'future_balance')::numeric;
    v_count:=jsonb_array_length(v_res.rent_terms_snapshot->'rent_schedule'->'payments')-1;
    v_partner:=(v_res.rent_terms_snapshot->'partner_schedule'->'payments'->0->>'amount')::numeric;
    v_disc:=(v_res.rent_terms_snapshot->>'discount_percent')::numeric;
    v_wh:=(v_res.rent_terms_snapshot->>'wehouse_discount_percent')::numeric;
  ELSE
    IF coalesce(v_res.rental_plan_years,1)<>1 OR NOT(12=ANY(v_listing.accepted_lease_terms_months)) THEN
      RAISE EXCEPTION 'Review the offered rental agreement before starting rent payment';
    END IF;
  v_years:=COALESCE(v_res.rental_plan_years,1);
  IF v_years<1 OR v_years>5 THEN RAISE EXCEPTION 'Reservation tenure must be between 1 and 5 years'; END IF;
  v_annual:=round(COALESCE(v_res.annual_rent_snapshot,v_listing.price),2);
  IF v_annual<=0 THEN RAISE EXCEPTION 'Required Year 1 rent is invalid'; END IF;
  select q.payable,q.partner_rent,q.discount_percent,q.wehouse_percent into v_upfront,v_partner,v_disc,v_wh from public.long_let_year_one_quote(v_listing.id,v_annual) q; v_total:=round(v_upfront+v_annual*greatest(v_years-1,0),2); v_balance:=round(v_annual*GREATEST(v_years-1,0),2); v_count:=8*GREATEST(v_years-1,0);

  END IF;

$replacement$;
 if position(needle in definition)=0 then raise exception 'Inspect rent checkout price boundary before upgrading';end if;
 definition:=replace(definition,needle,replacement);
 needle:=$needle$'eligible_partner_amount',v_partner)$needle$;
 if position(needle in definition)=0 then raise exception 'Inspect rent checkout receipt metadata before upgrading';end if;
 definition:=replace(definition,needle,$replacement$'eligible_partner_amount',v_partner,'rent_agreement_digest',v_res.rent_terms_snapshot->>'quote_digest','lease_term_months',coalesce(v_res.lease_term_months,12),'rent_payment_choice',coalesce(v_res.rent_payment_choice,'full'))$replacement$);
 execute definition;
end $patch$;
commit;

