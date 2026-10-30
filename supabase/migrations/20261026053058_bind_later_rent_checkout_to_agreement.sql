-- Applied Test-only experiment, superseded by 20261026055031.
-- Retained as migration audit history. The active product requires Payment
-- Protection and authorized release for later-year rent; this is not its policy.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- This upgrades the paused constructor; it does NOT activate collection.
-- The existing rollout policy stays required until settlement/recovery is proven.
create or replace function public.create_rent_plan_contribution_payment(p_contribution_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare c public.rent_plan_contributions;plan public.rent_plans;r public.reservations;
 l public.listings;b public.bank_accounts;p public.booking_payments;rollout public.creator_policy_versions;
 actor text;q jsonb;part jsonb;net numeric;fee numeric;gross numeric;ref text;route jsonb;
begin
 select * into c from public.rent_plan_contributions where id=p_contribution_id for update;
 if c.id is null then raise exception 'Scheduled rent payment not found';end if;
 actor:=private.require_long_let_customer(c.reservation_id);
 select * into plan from public.rent_plans where id=c.rent_plan_id and user_id=actor for update;
 select * into r from public.reservations where id=c.reservation_id and user_id=actor for share;
 if plan.id is null or plan.reservation_id is distinct from r.id or r.id is null then
  raise exception 'The payment does not belong to this tenancy';end if;
 q:=r.rent_terms_snapshot;
 if q is null or r.rent_payment_choice is distinct from 'monthly' or coalesce(r.lease_term_months,0)<=12
  or q->'rent_schedule'->>'payment_choice' is distinct from 'monthly'
  or q->>'accepted_by' is distinct from actor or q->>'quote_digest' is null
  or q->>'quote_digest' is distinct from plan.accepted_terms::jsonb->>'quote_digest'
  or c.agreement_sequence is null or c.target_year is null or c.target_year<2 then
  raise exception 'An accepted multi-year agreement with full Year 1 payment is required';end if;
 part:=q->'rent_schedule'->'payments'->(c.agreement_sequence-1);
 gross:=(part->>'amount')::numeric;net:=(part->>'partner_net_amount')::numeric;fee:=(part->>'wehouse_amount')::numeric;
 if part is null or (part->>'sequence')::integer is distinct from c.agreement_sequence
  or (part->>'target_year')::integer is distinct from c.target_year
  or c.installment_number is distinct from ((c.agreement_sequence-2)%8)+1
  or gross is null or gross<=0 or gross<>round(gross,2) or gross is distinct from c.amount
  or net is null or net<=0 or fee is null or fee<0 or gross is distinct from net+fee
  or c.due_date is null or plan.tenancy_start_date is null
  or c.due_date is distinct from (plan.tenancy_start_date+make_interval(months=>(part->>'month_offset')::integer))::date then
  raise exception 'The scheduled rent no longer matches the accepted agreement';end if;
 if c.status in('paid','completed') then
  return jsonb_build_object('success',true,'already_paid',true,'contribution_id',c.id,'amount',gross,'currency','NGN');end if;
 if r.status is distinct from 'occupied' or plan.status is distinct from 'active'
  or c.status is null or c.status not in('scheduled','pending','payment_pending') then raise exception 'Active tenancy and an unpaid rent obligation are required';end if;
 if exists(select 1 from public.rent_plan_contributions earlier where earlier.rent_plan_id=plan.id
  and earlier.agreement_sequence<c.agreement_sequence and earlier.status not in('paid','completed')) then
  raise exception 'Resolve the earlier rent payment before starting another';end if;
 if not exists(select 1 from public.booking_payments initial where initial.paystack_reference=r.rent_payment_reference
  and initial.purpose='apartment_rent' and initial.status in('paid','completed')
  and coalesce(initial.amount_total,initial.amount)=(q->'rent_schedule'->>'due_before_handover')::numeric)
  or (q->'rent_schedule'->>'due_before_handover')::numeric is distinct from (q->'rent_schedule'->>'first_year_rent')::numeric then
  raise exception 'Year 1 must have been paid in full before monthly collection';end if;
 select * into l from public.listings where id=plan.listing_id for share;
 select * into b from public.bank_accounts where id=(q->>'settlement_account_id')::uuid for share;
 if l.id is null or b.id is null or coalesce(l.currency,'NGN')<>'NGN' or q->>'currency' is distinct from 'NGN'
  or b.user_id is distinct from coalesce(l.partner_id,l.owner_id) or b.is_default is not true or b.is_active is not true
  or b.verified_at is null or b.rent_subaccount_verified_at is null
  or b.rent_subaccount_code !~ '^ACCT_[A-Za-z0-9]+$' or b.rent_subaccount_provider_id !~ '^[0-9]+$'
  or b.rent_subaccount_environment not in('test','live') then
  raise exception 'The accepted Partner settlement account needs verification';end if;
 route:=jsonb_build_object('version',1,'bank_account_id',b.id,'subaccount_code',b.rent_subaccount_code,
  'subaccount_provider_id',b.rent_subaccount_provider_id,'environment',b.rent_subaccount_environment,
  'amount_minor',gross*100,'partner_amount_minor',net*100,'platform_amount_minor',fee*100);
 -- Unknown or legacy references cannot be replaced with a second charge.
 if c.paystack_reference is not null then
  select * into p from public.booking_payments where paystack_reference=c.paystack_reference for update;
  if p.id is null or p.purpose<>'rent_plan_contribution' or p.user_id is distinct from actor
   or p.status<>'pending' or p.metadata->>'contribution_id' is distinct from c.id::text
   or p.metadata->>'rent_agreement_digest' is distinct from q->>'quote_digest'
   or p.metadata->'rent_settlement_route' is distinct from route then
   raise exception 'The existing rent payment requires reconciliation before retry';end if;
  return jsonb_build_object('success',true,'reference',p.paystack_reference,'amount',gross,'currency','NGN','existing',true);
 end if;
 select * into rollout from public.creator_policy_versions where policy_key='future_long_let_installments'
  and scope_type='global' and scope_key='*' and status='active' and effective_from<=now()
  and (effective_until is null or effective_until>now()) order by effective_from desc limit 1;
 if rollout.policy_version_id is null or rollout.value->>'enabled' is distinct from 'true'
  or rollout.value->>'settlement_adapter' is distinct from 'verified_subaccount_v1' then
  raise exception 'Monthly collection is awaiting verified Partner settlement rollout';end if;
 ref:='WHNEXT-'||upper(replace(gen_random_uuid()::text,'-',''));
 insert into public.booking_payments(payment_reference,user_id,payer_user_id,payee_user_id,type,booking_type,listing_id,
  amount,amount_total,amount_commission,net_amount,commission_rate,commission_policy_version_id,commission_frozen_at,
  currency,status,purpose,payment_method,paystack_reference,metadata)
 values(ref,actor,actor,b.user_id,'apartment','apartment',l.id::text,gross,gross,fee,net,
  (q->>'commission_rate')::numeric,(q->>'commission_policy_version_id')::uuid,now(),'NGN','pending',
  'rent_plan_contribution','paystack',ref,jsonb_build_object('reservation_id',r.id,'listing_id',l.id,
   'rent_plan_id',plan.id,'contribution_id',c.id,'target_year',c.target_year,'installment_number',c.installment_number,
   'agreement_sequence',c.agreement_sequence,'due_date',c.due_date,'payment_component','rent_plan_contribution',
   'rent_agreement_digest',q->>'quote_digest','rent_settlement_route',route,'eligible_partner_amount',net));
 update public.rent_plan_contributions set status='payment_pending',payment_reference=ref,paystack_reference=ref,updated_at=now() where id=c.id;
 return jsonb_build_object('success',true,'reference',ref,'amount',gross,'currency','NGN','existing',false);
end $fn$;
revoke all on function public.create_rent_plan_contribution_payment(uuid) from public,anon,service_role;
grant execute on function public.create_rent_plan_contribution_payment(uuid) to authenticated;

create function private.keep_rent_settlement_route() returns trigger
language plpgsql security definer set search_path='' as $fn$
declare k text;
begin
 if old.purpose<>'rent_plan_contribution' or old.metadata->'rent_settlement_route' is null then return new;end if;
 foreach k in array array['rent_settlement_route','rent_agreement_digest','reservation_id','contribution_id','rent_plan_id','target_year','agreement_sequence','due_date'] loop
  if new.metadata->k is distinct from old.metadata->k then raise exception 'The accepted rent payment route cannot be changed';end if;
 end loop;
 return new;
end $fn$;
revoke all on function private.keep_rent_settlement_route() from public,anon,authenticated;
create trigger keep_rent_settlement_route before update of metadata on public.booking_payments
 for each row execute function private.keep_rent_settlement_route();

create function public.record_verified_rent_route(p_reference text,p_transaction_id text,p_amount_minor bigint,
 p_currency text,p_environment text,p_subaccount_code text,p_subaccount_id text)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare p public.booking_payments;route jsonb;ok boolean;receipt jsonb;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Provider receipt authority required' using errcode='42501';end if;
 select * into p from public.booking_payments where paystack_reference=p_reference for update;
 if p.id is null or p.purpose<>'rent_plan_contribution' then raise exception 'Rent payment reference not found';end if;
 route:=p.metadata->'rent_settlement_route';
 ok:=coalesce(route->>'version'='1' and p_transaction_id ~ '^[0-9]+$' and p_currency='NGN'
  and p_environment=route->>'environment' and p_amount_minor=(coalesce(p.amount_total,p.amount)*100)::bigint
  and (p_subaccount_code=route->>'subaccount_code' or p_subaccount_id=route->>'subaccount_provider_id')
  and (p_subaccount_code is null or p_subaccount_code=route->>'subaccount_code')
  and (p_subaccount_id is null or p_subaccount_id=route->>'subaccount_provider_id'),false);
 receipt:=jsonb_build_object('status',case when ok then 'verified' else 'mismatch' end,
  'transaction_id',p_transaction_id,'amount_minor',p_amount_minor,'currency',p_currency,
  'environment',p_environment,'subaccount_code',p_subaccount_code,'subaccount_provider_id',p_subaccount_id);
 if p.metadata->'rent_route_receipt'->>'status'='verified' and p.metadata->'rent_route_receipt' is distinct from receipt then
  -- A later incomplete webhook must not overwrite stronger authenticated proof.
  if not ok then return jsonb_build_object('success',true,'existing',true);end if;
  if p.metadata->'rent_route_receipt'->>'transaction_id' is distinct from p_transaction_id then
   raise exception 'A different provider transaction already owns this rent receipt';end if;
 end if;
 update public.booking_payments set metadata=coalesce(metadata,'{}')||jsonb_build_object('rent_route_receipt',receipt),updated_at=now() where id=p.id;
 return jsonb_build_object('success',ok,'requires_review',not ok);
end $fn$;
revoke all on function public.record_verified_rent_route(text,text,bigint,text,text,text,text) from public,anon,authenticated;
grant execute on function public.record_verified_rent_route(text,text,bigint,text,text,text,text) to service_role;

-- Keep invalid verified charges in the existing durable Finance event queue.
do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.process_verified_paystack_charge(text,text,text,text,timestamptz,bigint,text,text)'::regprocedure);
 needle:=E'  begin\n  if v_payment.purpose=''worker_booking'' then';
 if position(needle in definition)=0 then raise exception 'Inspect canonical provider gateway before upgrading rent';end if;
 execute replace(definition,needle,$replacement$
  begin
  if v_payment.purpose='rent_plan_contribution' then
   if v_payment.commission_frozen_at is null or v_payment.metadata->'rent_settlement_route'->>'version' is distinct from '1'
    or v_payment.metadata->'rent_route_receipt'->>'status' is distinct from 'verified'
    or v_payment.metadata->'rent_route_receipt'->>'transaction_id' is distinct from p_transaction_id
    or (v_payment.metadata->'rent_route_receipt'->>'amount_minor')::bigint is distinct from p_amount_minor
    or v_payment.payee_user_id is distinct from (select coalesce(l.partner_id,l.owner_id) from public.listings l where l.id::text=v_payment.listing_id) then
    raise exception 'Rent receipt requires accepted settlement-route reconciliation';end if;
  end if;
  if v_payment.purpose='worker_booking' then$replacement$);
end $patch$;

-- The old handler credited withdrawable wallet money from a charge and recalculated
-- commission from today's policy. New direct-routed rent remains pending settlement.
create or replace function public.settle_verified_unprotected_installment() returns trigger
language plpgsql security definer set search_path='' as $fn$
declare p public.booking_payments;ledger_id uuid;entries jsonb;
begin
 if new.processing_status<>'processed' or old.processing_status='processed' then return new;end if;
 select * into p from public.booking_payments where paystack_reference=new.provider_reference for update;
 if p.id is null or p.purpose<>'rent_plan_contribution' then return new;end if;
 if p.metadata->'rent_route_receipt'->>'status' is distinct from 'verified'
  or p.commission_frozen_at is null or p.net_amount is null or p.amount_commission is null
  or p.net_amount+p.amount_commission is distinct from coalesce(p.amount_total,p.amount) then
  raise exception 'Rent charge cannot be allocated without its frozen verified route';end if;
 entries:=jsonb_build_array(
   jsonb_build_object('account_key','liability:partner_payable:'||p.payee_user_id,'account_class','liability','owner_type','property_partner','owner_id',p.payee_user_id,'amount',coalesce(p.amount_total,p.amount)),
   jsonb_build_object('account_key','liability:provider_partner_settlement:'||p.id::text,'account_class','liability','owner_type','property_partner','owner_id',p.payee_user_id,'amount',-p.net_amount));
 if p.amount_commission>0 then entries:=entries||jsonb_build_array(jsonb_build_object('account_key','revenue:wehouse_commission:long_let_installment','account_class','revenue','owner_type','wehouse','owner_id','platform','amount',-p.amount_commission));end if;
 ledger_id:=public.post_ledger_transaction('rent-route:'||p.id,'rent_provider_allocation','NGN','booking_payment',p.id::text,
  new.provider_event_id,jsonb_build_object('partner_user_id',p.payee_user_id,'settlement_status','pending'),entries);
 update public.booking_payments set metadata=metadata||jsonb_build_object('rent_provider_settlement',jsonb_build_object(
  'status','pending','allocation_ledger_id',ledger_id,'partner_amount',p.net_amount)),updated_at=now() where id=p.id;
 -- No wallet credit, no paid-out total, and no settled claim from charge alone.
 return new;
end $fn$;
commit;
