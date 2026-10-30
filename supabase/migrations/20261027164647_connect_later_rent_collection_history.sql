-- Later-year monthly rent: explicit consent, direct provider settlement and canonical history.
revoke insert,update,delete,truncate on public.rent_plans,public.rent_plan_contributions from public,anon,authenticated;
alter table public.rent_plans add column settlement_consent jsonb;

create function private.later_rent_payee_ready(p_user_id text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where user_id=p_user_id and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false))
  and public.user_has_active_workspace(p_user_id,'property_partner') and public.account_identity_is_current(p_user_id)
  and not exists(select 1 from public.wallets where owner_id=p_user_id and owner_type='property_partner' and coalesce(is_frozen,false));
$$;
revoke all on function private.later_rent_payee_ready(text) from public,anon,authenticated,service_role;

create or replace function private.long_let_settlement_account(p_listing_id uuid) returns uuid
language sql stable security definer set search_path='' as $$
 select b.id from public.bank_accounts b join public.listings l on l.id=p_listing_id
 where b.user_id=coalesce(l.partner_id,l.owner_id) and b.is_default and b.is_active and b.verified_at is not null
  and b.rent_subaccount_verified_at is not null and b.rent_subaccount_code ~ '^ACCT_[A-Za-z0-9]+$'
  and b.rent_subaccount_environment in('test','live') and private.later_rent_payee_ready(b.user_id)
 order by b.id limit 1;
$$;
revoke all on function private.long_let_settlement_account(uuid) from public,anon,authenticated,service_role;

create function private.later_rent_collection_enabled() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.creator_policy_versions where policy_key='future_long_let_installments' and scope_type='global' and scope_key='*' and status='active'
  and effective_from<=now() and (effective_until is null or effective_until>now()) and value->>'enabled'='true'
  and value->>'payment_protection_hold'='false' and value->>'settlement_adapter'='verified_subaccount_v1');
$$;
revoke all on function private.later_rent_collection_enabled() from public,anon,authenticated,service_role;

do $offer$
declare definition text;needle text;
begin
 definition:=replace(pg_get_functiondef('public.get_my_long_let_terms_offer(text)'::regprocedure),chr(13),'');
 needle:=$old$'monthly_ready',private.long_let_settlement_account(l.id) is not null$old$;
 if strpos(definition,needle)=0 then raise exception 'Inspect monthly offer readiness before connecting collection availability';end if;
 execute replace(definition,needle,needle||' and private.later_rent_collection_enabled()');
 definition:=replace(pg_get_functiondef('private.long_let_booking_quote(text,integer,text)'::regprocedure),chr(13),'');
 needle:=$old$if p_payment_choice='monthly' then$old$;
 if strpos(definition,needle)=0 then raise exception 'Inspect monthly quote readiness before connecting collection availability';end if;
 definition:=replace(definition,needle,needle||E'\n  if not private.later_rent_collection_enabled() then raise exception ''Monthly rent checkout is currently unavailable'';end if;');
 needle:=$old$'settlement_account_id',bank_id$old$;
 if strpos(definition,needle)=0 then raise exception 'Inspect the accepted rent payee before freezing its identity';end if;
 execute replace(definition,needle,$new$'partner_user_id',coalesce(l.partner_id,l.owner_id),'settlement_account_id',bank_id$new$);
end $offer$;

create function private.assert_later_rent_consent(p_plan_id uuid,p_digest text) returns void
language plpgsql stable security definer set search_path='' as $$
declare plan public.rent_plans;
begin
 select * into plan from public.rent_plans where id=p_plan_id;
 if plan.id is null or p_digest is null or plan.accepted_terms::jsonb->>'quote_digest' is distinct from p_digest
  or plan.settlement_consent->>'agreement_digest' is distinct from p_digest
  or plan.settlement_consent->>'accepted_by' is distinct from plan.user_id
  or plan.settlement_consent->>'payment_protection_hold' is distinct from 'false'
  or plan.settlement_consent->>'gross_rent_credit' is distinct from 'true'
  or plan.settlement_consent->>'accepted_at' is null then
  raise exception 'Review and accept later-year direct settlement before paying';end if;
end $$;
revoke all on function private.assert_later_rent_consent(uuid,text) from public,anon,authenticated,service_role;

create function public.accept_my_later_rent_settlement(p_reservation_id text,p_agreement_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=private.require_long_let_customer(p_reservation_id);plan public.rent_plans;previous text;receipt jsonb;
begin
 select * into plan from public.rent_plans where reservation_id=p_reservation_id and user_id=actor and status in('active','completed') for update;
 if plan.id is null or p_agreement_digest is null or plan.accepted_terms::jsonb->>'quote_digest' is distinct from p_agreement_digest
  or plan.accepted_terms::jsonb#>>'{rent_schedule,payment_choice}' is distinct from 'monthly' then
  raise exception 'Current accepted monthly rental agreement required';end if;
 if plan.settlement_consent is not null then
  perform private.assert_later_rent_consent(plan.id,p_agreement_digest);return plan.settlement_consent;end if;
 receipt:=jsonb_build_object('version',1,'agreement_digest',p_agreement_digest,'accepted_by',actor,'accepted_at',now(),
  'payment_protection_hold',false,'gross_rent_credit',true,'fee_source','accepted_payment_schedule',
  'disclosure','Later-year rent settles to the Partner after the disclosed WeHouse fee, without a new protection hold. Gross verified rent funds the agreed target year. It is not refundable wallet savings; early exit follows the tenancy agreement and applicable law.');
 previous:=current_setting('wehouse.rent_consent',true);perform set_config('wehouse.rent_consent','confirmed',true);
 update public.rent_plans set settlement_consent=receipt,updated_at=now() where id=plan.id;
 perform set_config('wehouse.rent_consent',coalesce(previous,''),true);
 insert into public.audit_logs(action,target_type,target_id,admin_id,details) values('LATER_RENT_SETTLEMENT_ACCEPTED','rent_plan',plan.id::text,actor,receipt::text);
 return receipt;
end $$;
revoke all on function public.accept_my_later_rent_settlement(text,text) from public,anon,service_role;
grant execute on function public.accept_my_later_rent_settlement(text,text) to authenticated;

create function private.guard_later_rent_consent() returns trigger language plpgsql set search_path='' as $$
begin
 if (tg_op='INSERT' and new.settlement_consent is not null) or (tg_op='UPDATE' and new.settlement_consent is distinct from old.settlement_consent) then
  if current_setting('wehouse.rent_consent',true) is distinct from 'confirmed' or (tg_op='UPDATE' and old.settlement_consent is not null) then
   raise exception 'Later-year settlement consent is immutable and requires explicit tenant acceptance';end if;
 end if;return new;
end $$;
revoke all on function private.guard_later_rent_consent() from public,anon,authenticated,service_role;
create trigger rent_settlement_consent before insert or update of settlement_consent on public.rent_plans for each row execute function private.guard_later_rent_consent();
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
  or c.due_date is null or plan.tenancy_start_date is null or plan.tenancy_start_date is distinct from r.tenancy_start_date
  or c.due_date is distinct from (plan.tenancy_start_date+make_interval(months=>(part->>'month_offset')::integer))::date then
  raise exception 'The scheduled rent no longer matches the accepted agreement';end if;
 perform private.assert_later_rent_consent(plan.id,q->>'quote_digest');
 if c.status in('paid','completed') then
  return jsonb_build_object('success',true,'already_paid',true,'contribution_id',c.id,'amount',gross,'currency','NGN');end if;
 if r.status is distinct from 'occupied' or plan.status is distinct from 'active'
  or c.status is null or c.status not in('scheduled','pending','payment_pending') then raise exception 'Active tenancy and an unpaid rent obligation are required';end if;
 if c.due_date>(now() at time zone 'Africa/Lagos')::date then raise exception 'This scheduled rent is not due yet';end if;
 if exists(select 1 from public.rent_plan_contributions earlier where earlier.rent_plan_id=plan.id
  and earlier.agreement_sequence<c.agreement_sequence and earlier.status not in('paid','completed')) then
  raise exception 'Resolve the earlier rent payment before starting another';end if;
 if not exists(select 1 from public.booking_payments initial where initial.paystack_reference=r.rent_payment_reference
  and initial.purpose='apartment_rent' and initial.status in('paid','completed')
  and coalesce(initial.amount_total,initial.amount)=(q->'rent_schedule'->>'due_before_handover')::numeric)
  or (q->'rent_schedule'->>'due_before_handover')::numeric is distinct from (q->'rent_schedule'->>'first_year_rent')::numeric then
  raise exception 'Year 1 must have been paid in full before monthly collection';end if;
 select * into l from public.listings where id=plan.listing_id for share;
 if not private.later_rent_payee_ready(coalesce(l.partner_id,l.owner_id)) then raise exception 'Partner identity or payout eligibility needs review';end if;
 -- Freeze the legal payee, while allowing that same Partner to change their verified default bank.
 -- Historical quotes without a payee use the originally accepted account owner, never a guessed replacement.
 if coalesce(q->>'partner_user_id',(select user_id from public.bank_accounts where id=(q->>'settlement_account_id')::uuid))
  is distinct from coalesce(l.partner_id,l.owner_id) then raise exception 'The accepted rent payee requires review before collection';end if;
 select * into b from public.bank_accounts where id=private.long_let_settlement_account(l.id) for share;
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
  select * into p from public.booking_payments where paystack_reference=c.paystack_reference;
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
  or rollout.value->>'settlement_adapter' is distinct from 'verified_subaccount_v1'
  or rollout.value->>'payment_protection_hold' is distinct from 'false' then
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

-- Keep the canonical gateway's event/ledger/recovery transaction. The direct
-- route is admitted only after an authenticated provider proof was recorded.
do $gateway$
declare definition text;needle text;
begin
 definition:=replace(pg_get_functiondef('public.process_verified_paystack_charge(text,text,text,text,timestamptz,bigint,text,text)'::regprocedure),chr(13),'');
 needle:=$old$  if v_payment.purpose='rent_plan_contribution' then
    raise exception 'Later-year rent collection is paused until its Payment Protection and authorized release journey is verified';
  end if;$old$;
 if strpos(definition,needle)=0 then raise exception 'Inspect current verified-charge gateway before connecting later rent';end if;
 execute replace(definition,needle,$new$  if v_payment.purpose='rent_plan_contribution' then
   perform private.validate_later_rent_receipt(v_payment.id,p_transaction_id,p_amount_minor);
  end if;$new$);
end $gateway$;

create function private.validate_later_rent_receipt(p_payment_id uuid,p_transaction_id text,p_amount_minor bigint) returns void
language plpgsql stable security definer set search_path='' as $$
declare p public.booking_payments;c public.rent_plan_contributions;plan public.rent_plans;r public.reservations;part jsonb;
begin
 select * into p from public.booking_payments where id=p_payment_id;
 select * into c from public.rent_plan_contributions where id=(p.metadata->>'contribution_id')::uuid;
 select * into plan from public.rent_plans where id=c.rent_plan_id;
 select * into r from public.reservations where id=c.reservation_id;
 perform private.assert_later_rent_consent(plan.id,p.metadata->>'rent_agreement_digest');
 part:=r.rent_terms_snapshot#>array['rent_schedule','payments',(c.agreement_sequence-1)::text];
 if p.purpose is distinct from 'rent_plan_contribution' or p.commission_frozen_at is null
  or p.commission_policy_version_id is null or c.paystack_reference is distinct from p.paystack_reference
  or p.user_id is distinct from plan.user_id or plan.reservation_id is distinct from r.id
  or r.rent_terms_snapshot->>'quote_digest' is distinct from p.metadata->>'rent_agreement_digest'
  or c.target_year<2 or c.amount is distinct from (part->>'amount')::numeric
  or p.amount_total is distinct from c.amount or p.amount_total*100 is distinct from p_amount_minor::numeric
  or p.amount_commission is distinct from (part->>'wehouse_amount')::numeric
  or p.net_amount is distinct from (part->>'partner_net_amount')::numeric
  or p.net_amount+p.amount_commission is distinct from p.amount_total
  or p.metadata->'rent_route_receipt'->>'status' is distinct from 'verified'
  or p.metadata->'rent_route_receipt'->>'transaction_id' is distinct from p_transaction_id
  or (p.metadata->'rent_route_receipt'->>'amount_minor')::bigint is distinct from p_amount_minor
  or p.payee_user_id is distinct from (select coalesce(l.partner_id,l.owner_id) from public.listings l where l.id::text=p.listing_id) then
  raise exception 'Later-year rent requires accepted agreement and verified direct-settlement route reconciliation';end if;
end $$;
revoke all on function private.validate_later_rent_receipt(uuid,text,bigint) from public,anon,authenticated,service_role;

create function public.get_my_later_rent_history(p_reservation_id text,p_after_sequence integer default 0,p_limit integer default 16) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();r public.reservations;l public.listings;plan public.rent_plans;items jsonb;years jsonb;page_size integer:=least(greatest(coalesce(p_limit,16),1),32);is_customer boolean;collection_available boolean;
begin
 if actor is null or not public._property_document_session_active() or not exists(select 1 from public.profiles where user_id=actor and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)) then raise exception 'Trusted active account required' using errcode='42501';end if;
 select * into r from public.reservations where id=p_reservation_id;
 select * into l from public.listings where id::text=r.listing_id;
 is_customer:=r.user_id=actor;
 if r.id is null or not(coalesce(is_customer,false) or (actor=coalesce(l.partner_id,l.owner_id) and public.current_actor_has_workspace('property_partner',null))) then raise exception 'Rental history unavailable' using errcode='42501';end if;
 select * into plan from public.rent_plans where reservation_id=r.id and user_id=r.user_id order by created_at desc limit 1;
 if plan.id is null or plan.accepted_terms::jsonb->>'quote_digest' is distinct from r.rent_terms_snapshot->>'quote_digest' then raise exception 'Accepted rent plan is not available';end if;
 collection_available:=private.later_rent_collection_enabled() and private.long_let_settlement_account(l.id) is not null;
 with rows as (
  select c.id as contribution_id,c.agreement_sequence,c.target_year,c.due_date,c.amount,c.paystack_reference,p.amount_commission,p.net_amount,p.paid_at,
   case when c.status in('paid','completed') and p.status in('paid','completed') and p.verified_at is not null
    and p.verified_amount=c.amount and exists(select 1 from public.verified_provider_events e where e.provider_reference=p.paystack_reference and e.processing_status='processed') then 'paid'
    when c.status in('paid','completed') or p.status in('failed','cancelled','refunded','partially_refunded','review_required') then 'review_required' else c.status end as payment_status,
   (collection_available and is_customer and r.status='occupied' and plan.status='active' and c.status in('scheduled','pending','payment_pending') and (p.id is null or p.status='pending')
    and c.due_date<=(now() at time zone 'Africa/Lagos')::date and c.agreement_sequence=(select min(earlier.agreement_sequence) from public.rent_plan_contributions earlier where earlier.rent_plan_id=plan.id and earlier.status in('scheduled','pending','payment_pending'))) as can_pay,
   coalesce(p.metadata#>>'{rent_provider_settlement,status}','not_started') as settlement_status
  from public.rent_plan_contributions c left join public.booking_payments p on p.paystack_reference=c.paystack_reference and p.purpose='rent_plan_contribution'
   and p.metadata->>'contribution_id'=c.id::text where c.rent_plan_id=plan.id and c.agreement_sequence>greatest(coalesce(p_after_sequence,0),0)
  order by c.agreement_sequence limit page_size+1
 ) select coalesce(jsonb_agg(to_jsonb(rows) order by agreement_sequence),'[]') into items from rows;
 with sums as (
  select c.target_year,(r.rent_terms_snapshot#>>'{rent_schedule,annual_rent}')::numeric annual,
   coalesce(sum(c.amount) filter(where c.status in('paid','completed') and p.status in('paid','completed') and p.verified_at is not null and p.verified_amount=c.amount
    and exists(select 1 from public.verified_provider_events e where e.provider_reference=p.paystack_reference and e.processing_status='processed')),0) paid
  from public.rent_plan_contributions c left join public.booking_payments p on p.paystack_reference=c.paystack_reference and p.purpose='rent_plan_contribution'
   and p.metadata->>'contribution_id'=c.id::text where c.rent_plan_id=plan.id group by c.target_year
 ), credit as(select *,least(12,greatest(0,floor(paid*12/nullif(annual,0))))::integer months from sums)
 select coalesce(jsonb_agg(jsonb_build_object('target_year',target_year,'annual_rent',annual,'gross_rent_paid',paid,'completed_months',months,
  'partial_month_credit',paid-ceil(annual*100*months/12)/100,
  'next_month_balance',case when months=12 then 0 else greatest(0,ceil(annual*100*(months+1)/12)/100-paid) end,
  'remaining_year_rent',greatest(0,annual-paid)) order by target_year),'[]') into years from credit;
 return jsonb_build_object('reservation_id',r.id,'plan_id',plan.id,'viewer',case when is_customer then 'customer' else 'partner' end,
  'currency',r.rent_terms_snapshot->>'currency','agreement_digest',r.rent_terms_snapshot->>'quote_digest','plan_status',plan.status,'collection_available',collection_available,
  'settlement_consent',plan.settlement_consent,'years',years,'items',(select coalesce(jsonb_agg(v),'[]') from jsonb_array_elements(items) with ordinality e(v,n) where n<=page_size),
  'has_more',jsonb_array_length(items)>page_size,'next_sequence',case when jsonb_array_length(items)>page_size then (items->(page_size-1)->>'agreement_sequence')::integer else null end);
end $$;
revoke all on function public.get_my_later_rent_history(text,integer,integer) from public,anon,service_role;
grant execute on function public.get_my_later_rent_history(text,integer,integer) to authenticated;

create function public.validate_later_rent_checkout(p_payment_id uuid,p_customer_user_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.booking_payments;c public.rent_plan_contributions;plan public.rent_plans;r public.reservations;b public.bank_accounts;route jsonb;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Payment provider authority required' using errcode='42501';end if;
 select * into p from public.booking_payments where id=p_payment_id and purpose='rent_plan_contribution' and user_id=p_customer_user_id and status='pending';
 select * into c from public.rent_plan_contributions where id=(p.metadata->>'contribution_id')::uuid;
 select * into plan from public.rent_plans where id=c.rent_plan_id;
 select * into r from public.reservations where id=c.reservation_id;
 perform private.assert_later_rent_consent(plan.id,p.metadata->>'rent_agreement_digest');
 route:=p.metadata->'rent_settlement_route';
 select * into b from public.bank_accounts where id=(route->>'bank_account_id')::uuid;
 if p.id is null or c.paystack_reference is distinct from p.paystack_reference or c.status is distinct from 'payment_pending'
  or c.amount is distinct from p.amount_total or plan.user_id is distinct from p_customer_user_id
  or plan.status is distinct from 'active' or r.status is distinct from 'occupied'
  or r.rent_terms_snapshot->>'quote_digest' is distinct from p.metadata->>'rent_agreement_digest'
  or b.id is null or b.user_id is distinct from p.payee_user_id or b.is_active is not true or b.is_default is not true
  or b.verified_at is null or b.rent_subaccount_verified_at is null or not private.later_rent_payee_ready(b.user_id)
  or b.rent_subaccount_code is distinct from route->>'subaccount_code'
  or b.rent_subaccount_environment is distinct from route->>'environment'
  or b.rent_subaccount_provider_id is distinct from route->>'subaccount_provider_id' then raise exception 'The accepted rent payment or settlement route changed';end if;
 if not exists(select 1 from public.creator_policy_versions where policy_key='future_long_let_installments' and status='active'
  and scope_type='global' and scope_key='*' and effective_from<=now() and (effective_until is null or effective_until>now()) and value->>'enabled'='true'
  and value->>'payment_protection_hold'='false' and value->>'settlement_adapter'='verified_subaccount_v1') then raise exception 'Later-year rent collection is not active';end if;
 return jsonb_build_object('valid',true,'payment_id',p.id);
end $$;
revoke all on function public.validate_later_rent_checkout(uuid,text) from public,anon,authenticated;
grant execute on function public.validate_later_rent_checkout(uuid,text) to service_role;

create function public.get_my_rent_settlement_bank(p_bank_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();b public.bank_accounts;
begin
 if actor is null or not public._property_document_session_active() or not public.current_actor_has_workspace('property_partner',null)
  or not exists(select 1 from public.profiles where user_id=actor and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)) then raise exception 'Trusted active Property Partner required' using errcode='42501';end if;
 select * into b from public.bank_accounts where id=p_bank_id and user_id=actor and is_active and is_default and verified_at is not null;
 if not private.later_rent_payee_ready(actor) then raise exception 'Complete your identity check and resolve payout restrictions before preparing rent settlement';end if;
 if b.id is null then raise exception 'Choose your verified default bank account';end if;
 return jsonb_build_object('id',b.id,'account_number',b.account_number,'bank_code',b.bank_code,'bank_name',b.bank_name,'account_name',b.account_name,
  'subaccount_code',b.rent_subaccount_code,'verified_at',b.rent_subaccount_verified_at);
end $$;
revoke all on function public.get_my_rent_settlement_bank(uuid) from public,anon,service_role;
grant execute on function public.get_my_rent_settlement_bank(uuid) to authenticated;

create function public.get_my_rent_settlement_setup(p_listing_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();b public.bank_accounts;
begin
 if actor is null or not public._property_document_session_active() or not public.current_actor_has_workspace('property_partner',null)
  or not exists(select 1 from public.listings where id=p_listing_id and coalesce(partner_id,owner_id)=actor and deleted_at is null)
  or not exists(select 1 from public.profiles where user_id=actor and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)) then raise exception 'Verified property owner access required' using errcode='42501';end if;
 select * into b from public.bank_accounts where user_id=actor and is_active and is_default and verified_at is not null order by created_at desc limit 1;
 return jsonb_build_object('listing_id',p_listing_id,'bank_account_id',b.id,'bank_name',b.bank_name,'last4',right(b.account_number,4),'ready',b.rent_subaccount_verified_at is not null and private.later_rent_payee_ready(actor));
end $$;
revoke all on function public.get_my_rent_settlement_setup(uuid) from public,anon,service_role;
grant execute on function public.get_my_rent_settlement_setup(uuid) to authenticated;

create function public.get_my_property_later_rent_accounts(p_listing_id uuid,p_after_id uuid default null,p_limit integer default 16) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();rows jsonb;page_size integer:=least(greatest(coalesce(p_limit,16),1),32);
begin
 if actor is null or not public._property_document_session_active() or not public.current_actor_has_workspace('property_partner',null)
  or not exists(select 1 from public.listings where id=p_listing_id and coalesce(partner_id,owner_id)=actor and deleted_at is null)
  or not exists(select 1 from public.profiles where user_id=actor and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)) then raise exception 'Verified property owner access required' using errcode='42501';end if;
 select coalesce(jsonb_agg(to_jsonb(item) order by item.plan_id),'[]') into rows from (
  select plan.id plan_id,plan.reservation_id,coalesce(p.full_name,'Tenant') tenant_name,plan.status
  from public.rent_plans plan join public.profiles p on p.user_id=plan.user_id
  where plan.listing_id=p_listing_id and (p_after_id is null or plan.id>p_after_id) order by plan.id limit page_size+1) item;
 return jsonb_build_object('listing_id',p_listing_id,'items',(select coalesce(jsonb_agg(v),'[]') from jsonb_array_elements(rows) with ordinality e(v,n) where n<=page_size),
  'has_more',jsonb_array_length(rows)>page_size,'next_id',case when jsonb_array_length(rows)>page_size then rows->(page_size-1)->>'plan_id' else null end);
end $$;
revoke all on function public.get_my_property_later_rent_accounts(uuid,uuid,integer) from public,anon,service_role;
grant execute on function public.get_my_property_later_rent_accounts(uuid,uuid,integer) to authenticated;

create index rent_contribution_history_page on public.rent_plan_contributions(rent_plan_id,agreement_sequence) where agreement_sequence is not null;

create function public.bind_verified_rent_settlement_bank(p_bank_id uuid,p_account_number text,p_bank_code text,p_subaccount_code text,p_subaccount_id text,p_environment text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.bank_accounts;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Provider authority required' using errcode='42501';end if;
 select * into b from public.bank_accounts where id=p_bank_id for update;
 if b.id is null or b.is_active is not true or b.is_default is not true or b.verified_at is null
  or b.account_number is distinct from p_account_number or b.bank_code is distinct from p_bank_code
  or p_subaccount_code !~ '^ACCT_[A-Za-z0-9]+$' or p_subaccount_id !~ '^[0-9]+$' or p_environment not in('test','live')
  or p_subaccount_code is null or p_subaccount_id is null or p_environment is null then raise exception 'Provider setup no longer matches the verified bank';end if;
 if b.rent_subaccount_code is not null and b.rent_subaccount_code is distinct from p_subaccount_code then raise exception 'Existing settlement setup requires reconciliation';end if;
 update public.bank_accounts set rent_subaccount_code=p_subaccount_code,rent_subaccount_provider_id=p_subaccount_id,
  rent_subaccount_environment=p_environment,rent_subaccount_verified_at=now(),updated_at=now() where id=b.id;
 return jsonb_build_object('success',true,'bank_account_id',b.id,'ready',true);
end $$;
revoke all on function public.bind_verified_rent_settlement_bank(uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.bind_verified_rent_settlement_bank(uuid,text,text,text,text,text) to service_role;

alter table public.bank_accounts add column rent_setup_reference uuid,add column rent_setup_started_at timestamptz;
do $setup_guard$
declare definition text;needle text;
begin
 definition:=replace(pg_get_functiondef('private.guard_rent_settlement_account()'::regprocedure),chr(13),'');
 needle:=$old$new.rent_subaccount_environment:=null;new.rent_subaccount_verified_at:=null;$old$;
 if strpos(definition,needle)=0 then raise exception 'Inspect settlement invalidation before clearing recovery identity';end if;
 definition:=replace(definition,needle,needle||'new.rent_setup_reference:=null;new.rent_setup_started_at:=null;');
 needle:=$old$if current_user not in('postgres','service_role') then$old$;
 if strpos(definition,needle)=0 then raise exception 'Inspect the verified bank mutation guard before protecting setup recovery';end if;
 execute replace(definition,needle,needle||E'\n  if (tg_op=''INSERT'' and new.rent_setup_reference is not null) or (tg_op=''UPDATE'' and (new.rent_setup_reference,new.rent_setup_started_at) is distinct from (old.rent_setup_reference,old.rent_setup_started_at)) then raise exception ''Settlement setup recovery is server-controlled'' using errcode=''42501'';end if;');
end $setup_guard$;
create function public.claim_rent_settlement_setup(p_bank_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.bank_accounts;claimed boolean:=false;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Provider authority required' using errcode='42501';end if;
 select * into b from public.bank_accounts where id=p_bank_id and is_active and is_default and verified_at is not null for update;
 if b.id is null then raise exception 'Verified bank unavailable';end if;
 if b.rent_setup_reference is null and b.rent_subaccount_code is null then
  update public.bank_accounts set rent_setup_reference=gen_random_uuid(),rent_setup_started_at=now() where id=b.id returning * into b;claimed:=true;
 end if;
 return jsonb_build_object('claimed',claimed,'reference',b.rent_setup_reference,'existing_code',b.rent_subaccount_code);
end $$;
revoke all on function public.claim_rent_settlement_setup(uuid) from public,anon,authenticated;
grant execute on function public.claim_rent_settlement_setup(uuid) to service_role;

create function public.claim_due_rent_settlement_checks(p_limit integer default 2) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.booking_payments;result jsonb:='[]';
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Provider authority required' using errcode='42501';end if;
 for p in select * from public.booking_payments where purpose='rent_plan_contribution' and status in('paid','completed')
  and metadata#>>'{rent_provider_settlement,status}' in('pending','checking')
  and coalesce((metadata#>>'{rent_provider_settlement,next_check_at}')::timestamptz,'-infinity')<=now()
  order by paid_at,id limit least(greatest(coalesce(p_limit,2),1),5) for update skip locked loop
  update public.booking_payments set metadata=jsonb_set(metadata,'{rent_provider_settlement}',
   metadata->'rent_provider_settlement'||jsonb_build_object('status','checking','next_check_at',now()+interval '2 minutes')),updated_at=now() where id=p.id;
  result:=result||jsonb_build_array(jsonb_build_object('payment_id',p.id,'reference',p.paystack_reference,'transaction_id',p.paystack_transaction_id,
   'currency',p.currency,'paid_at',p.paid_at,'created_at',p.created_at,'net_amount',p.net_amount,'route',p.metadata->'rent_settlement_route',
   'page',coalesce((p.metadata#>>'{rent_provider_settlement,page}')::integer,1),'transaction_page',coalesce((p.metadata#>>'{rent_provider_settlement,transaction_page}')::integer,1)));
 end loop;return result;
end $$;
revoke all on function public.claim_due_rent_settlement_checks(integer) from public,anon,authenticated;
grant execute on function public.claim_due_rent_settlement_checks(integer) to service_role;

create function public.finish_rent_settlement_check(p_payment_id uuid,p_next_page integer,p_error text default null,p_transaction_page integer default 1) returns void
language plpgsql security definer set search_path='' as $$
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Provider authority required' using errcode='42501';end if;
 update public.booking_payments set metadata=jsonb_set(metadata,'{rent_provider_settlement}',metadata->'rent_provider_settlement'||
  jsonb_build_object('status','pending','page',least(greatest(coalesce(p_next_page,1),1),10000),'transaction_page',least(greatest(coalesce(p_transaction_page,1),1),10000),'next_check_at',now()+interval '1 hour','last_error',left(p_error,250))),updated_at=now()
 where id=p_payment_id and purpose='rent_plan_contribution' and metadata#>>'{rent_provider_settlement,status}'='checking';
end $$;
revoke all on function public.finish_rent_settlement_check(uuid,integer,text,integer) from public,anon,authenticated;
grant execute on function public.finish_rent_settlement_check(uuid,integer,text,integer) to service_role;

create function public.record_verified_rent_settlement(p_payment_id uuid,p_settlement_id text,p_transaction_id text,p_subaccount_id text,p_net_minor bigint,p_currency text,p_environment text,p_payload_sha256 text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.booking_payments;proof jsonb;ledger_id uuid;c public.rent_plan_contributions;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Provider authority required' using errcode='42501';end if;
 select * into p from public.booking_payments where id=p_payment_id for update;
 if p.id is null or p.purpose is distinct from 'rent_plan_contribution' or p.status not in('paid','completed')
  or p.verified_at is null or p.paystack_transaction_id is distinct from p_transaction_id or p_settlement_id !~ '^[0-9]+$' or p_settlement_id is null
  or p.metadata#>>'{rent_settlement_route,subaccount_provider_id}' is distinct from p_subaccount_id
  or p.metadata#>>'{rent_settlement_route,environment}' is distinct from p_environment or p.currency is distinct from p_currency
  or p.net_amount*100 is distinct from p_net_minor::numeric or p_payload_sha256 !~ '^[a-f0-9]{64}$' or p_payload_sha256 is null
  or not exists(select 1 from public.verified_provider_events where provider_reference=p.paystack_reference and processing_status='processed')
  or not exists(select 1 from public.ledger_transactions where idempotency_key='rent-route:'||p.id)
  or coalesce(p.metadata#>>'{rent_provider_settlement,status}','') not in('pending','checking','settled') then
  raise exception 'Settlement proof does not match the verified rent payment';end if;
 if p.metadata#>>'{rent_provider_settlement,status}'='settled' then
  if p.metadata#>>'{rent_provider_settlement,settlement_id}' is distinct from p_settlement_id then raise exception 'A different settlement already owns this receipt';end if;
  return jsonb_build_object('success',true,'existing',true,'payment_id',p.id);end if;
 ledger_id:=public.post_ledger_transaction('rent-settlement:'||p.id,'rent_provider_settlement',p.currency,'booking_payment',p.id::text,null,
  jsonb_build_object('settlement_id',p_settlement_id,'provider','paystack','proof_sha256',p_payload_sha256),jsonb_build_array(
   jsonb_build_object('account_key','liability:provider_partner_settlement:'||p.id::text,'account_class','liability','owner_type','property_partner','owner_id',p.payee_user_id,'amount',p.net_amount),
   jsonb_build_object('account_key','asset:paystack_clearing:NGN','account_class','asset','amount',-p.net_amount)));
 proof:=p.metadata->'rent_provider_settlement'||jsonb_build_object('status','settled','settlement_id',p_settlement_id,'verified_at',now(),'proof_sha256',p_payload_sha256,'settlement_ledger_id',ledger_id);
 update public.booking_payments set metadata=jsonb_set(metadata,'{rent_provider_settlement}',proof),updated_at=now() where id=p.id;
 select * into c from public.rent_plan_contributions where id=(p.metadata->>'contribution_id')::uuid;
 update public.rent_plans set total_paid_out=coalesce(total_paid_out,0)+p.net_amount,updated_at=now() where id=c.rent_plan_id;
 return jsonb_build_object('success',true,'payment_id',p.id,'existing',false);
end $$;
revoke all on function public.record_verified_rent_settlement(uuid,text,text,text,bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.record_verified_rent_settlement(uuid,text,text,text,bigint,text,text,text) to service_role;

create index rent_owner_accounts_page on public.rent_plans(listing_id,id);
create index rent_pending_settlement_checks on public.booking_payments(paid_at,id)
 where purpose='rent_plan_contribution' and status in('paid','completed') and metadata#>>'{rent_provider_settlement,status}' in('pending','checking');

create function public.creator_get_later_rent_collection() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();p public.creator_policy_versions;
begin
 if actor is null or not public._property_document_session_active() or not public.current_actor_has_workspace('creator',null)
  or not exists(select 1 from public.profiles where user_id=actor and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)) then raise exception 'Trusted active Creator required' using errcode='42501';end if;
 select * into p from public.creator_policy_versions where policy_key='future_long_let_installments' and scope_type='global' and scope_key='*' and status='active'
  and effective_from<=now() and (effective_until is null or effective_until>now()) order by effective_from desc,version desc limit 1;
 if p.policy_version_id is null then return jsonb_build_object('configured',false);end if;
 return jsonb_build_object('configured',true,'policy_version_id',p.policy_version_id,'version',p.version,'enabled',p.value->'enabled','adapter',p.value->>'settlement_adapter');
end $$;
revoke all on function public.creator_get_later_rent_collection() from public,anon,service_role;
grant execute on function public.creator_get_later_rent_collection() to authenticated;

create function public.creator_set_later_rent_collection(p_elevation_id uuid,p_expected_policy_version_id uuid,p_enabled boolean,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare current_policy public.creator_policy_versions;actor text:=public.current_profile_user_id();
begin
 perform public.creator_get_later_rent_collection();
 if not public.creator_has_elevation(p_elevation_id,'policy_publish') then raise exception 'Fresh Creator confirmation required' using errcode='42501';end if;
 if p_enabled is null or length(btrim(coalesce(p_reason,''))) not between 5 and 2000 then raise exception 'Choose collection availability and record a reason';end if;
 lock table public.creator_policy_versions in share row exclusive mode;
 select * into current_policy from public.creator_policy_versions where policy_key='future_long_let_installments' and scope_type='global' and scope_key='*' and status='active'
  and effective_from<=now() and (effective_until is null or effective_until>now()) order by effective_from desc,version desc limit 1;
 if current_policy.policy_version_id is distinct from p_expected_policy_version_id or current_policy.policy_version_id is null then raise exception 'Rent collection policy changed. Refresh before publishing';end if;
 perform public.creator_publish_policy(p_elevation_id,'future_long_let_installments','global','*',current_policy.value||jsonb_build_object(
  'enabled',p_enabled,'partner_opt_in',true,'settlement_adapter','verified_subaccount_v1','payment_protection_hold',false,'authorized_release_required',false,
  'tenant_settlement_consent_required',true,'verified_rent_credit_required',true),current_policy.value_schema,now(),true,
  'Only accepted later-year monthly rent uses direct Partner settlement. Year 1 remains fully upfront and protected. Tenant consent, verified Partner setup and canonical receipts are required.','pending',btrim(p_reason));
 return public.creator_get_later_rent_collection();
end $$;
revoke all on function public.creator_set_later_rent_collection(uuid,uuid,boolean,text) from public,anon,service_role;
grant execute on function public.creator_set_later_rent_collection(uuid,uuid,boolean,text) to authenticated;

do $receipts$
declare definition text;needle text;
begin
 definition:=replace(pg_get_functiondef('public.get_my_payment_receipts(text,text,text)'::regprocedure),chr(13),'');
 needle:='if v_user is null then';
 if strpos(definition,needle)=0 then raise exception 'Inspect receipt account guard before requiring a trusted device';end if;
 definition:=replace(definition,needle,'if v_user is null or not public._property_document_session_active() then');
 needle:=$old$'description',case when bp.purpose='experience_booking'$old$;
 if strpos(definition,needle)=0 then raise exception 'Inspect receipt descriptions before connecting later rent';end if;
 definition:=replace(definition,needle,$new$'rent_target_year',case when bp.purpose='rent_plan_contribution' then (bp.metadata->>'target_year')::integer else null end,
        'rent_settlement_status',case when bp.purpose='rent_plan_contribution' then bp.metadata#>>'{rent_provider_settlement,status}' else null end,
        'rent_payment_protection_hold',case when bp.purpose='rent_plan_contribution' and bp.metadata#>>'{rent_settlement_route,version}'='1' and bp.metadata#>>'{rent_route_receipt,status}'='verified' then false else null end,
        'description',case when bp.purpose='rent_plan_contribution' then 'Later-year rent' when bp.purpose='experience_booking'$new$);
 execute definition;
end $receipts$;
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
 p_currency text,p_environment text,p_subaccount_code text,p_subaccount_id text,p_partner_minor bigint)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare p public.booking_payments;route jsonb;ok boolean;receipt jsonb;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Provider receipt authority required' using errcode='42501';end if;
 select * into p from public.booking_payments where paystack_reference=p_reference for update;
 if p.id is null or p.purpose<>'rent_plan_contribution' then raise exception 'Rent payment reference not found';end if;
 route:=p.metadata->'rent_settlement_route';
 ok:=coalesce(route->>'version'='1' and p_transaction_id ~ '^[0-9]+$' and p_currency='NGN'
  and p_environment=route->>'environment' and p_amount_minor=(coalesce(p.amount_total,p.amount)*100)::bigint
  and p_partner_minor::numeric=(route->>'partner_amount_minor')::numeric and p_partner_minor=(p.net_amount*100)::bigint
  and (p_subaccount_code=route->>'subaccount_code' or p_subaccount_id=route->>'subaccount_provider_id')
  and (p_subaccount_code is null or p_subaccount_code=route->>'subaccount_code')
  and (p_subaccount_id is null or p_subaccount_id=route->>'subaccount_provider_id'),false);
 receipt:=jsonb_build_object('status',case when ok then 'verified' else 'mismatch' end,
  'transaction_id',p_transaction_id,'amount_minor',p_amount_minor,'currency',p_currency,
  'environment',p_environment,'subaccount_code',p_subaccount_code,'subaccount_provider_id',p_subaccount_id,'partner_amount_minor',p_partner_minor);
 if p.metadata->'rent_route_receipt'->>'status'='verified' and p.metadata->'rent_route_receipt' is distinct from receipt then
  -- A later incomplete webhook must not overwrite stronger authenticated proof.
  if not ok then return jsonb_build_object('success',true,'existing',true);end if;
  if p.metadata->'rent_route_receipt'->>'transaction_id' is distinct from p_transaction_id then
   raise exception 'A different provider transaction already owns this rent receipt';end if;
 end if;
 update public.booking_payments set metadata=coalesce(metadata,'{}')||jsonb_build_object('rent_route_receipt',receipt),updated_at=now() where id=p.id;
 return jsonb_build_object('success',ok,'requires_review',not ok);
end $fn$;
revoke all on function public.record_verified_rent_route(text,text,bigint,text,text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.record_verified_rent_route(text,text,bigint,text,text,text,text,bigint) to service_role;


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
