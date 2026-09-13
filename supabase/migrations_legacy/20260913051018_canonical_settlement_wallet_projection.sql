-- The immutable ledger is the financial source of truth. Legacy wallets and
-- commission tables remain read projections for existing screens only.

drop trigger if exists settle_verified_property_partner_payment_trigger
  on public.booking_payments;
drop trigger if exists register_pending_property_partner_earning_trigger
  on public.booking_payments;

revoke all on function public.settle_verified_property_partner_payment()
  from public,anon,authenticated;
revoke all on function public.register_pending_property_partner_earning()
  from public,anon,authenticated;
grant execute on function public.settle_verified_property_partner_payment()
  to service_role;
grant execute on function public.register_pending_property_partner_earning()
  to service_role;

create table if not exists public.canonical_wallet_release_receipts(
  financial_action_id uuid primary key
    references public.financial_action_outbox(financial_action_id) on delete restrict,
  payment_protection_id uuid not null
    references public.payment_protection_transactions(id) on delete restrict,
  ledger_transaction_id uuid not null
    references public.ledger_transactions(ledger_transaction_id) on delete restrict,
  payee_user_id text not null references public.profiles(user_id) on delete restrict,
  wallet_id uuid not null references public.wallets(id) on delete restrict,
  wallet_transaction_id uuid not null
    references public.wallet_transactions(id) on delete restrict,
  payee_amount numeric(12,2) not null check(payee_amount>=0),
  commission_amount numeric(12,2) not null check(commission_amount>=0),
  created_at timestamptz not null default now()
);

create table if not exists public.canonical_unprotected_settlement_receipts(
  booking_payment_id uuid primary key
    references public.booking_payments(id) on delete restrict,
  provider_event_id uuid not null unique
    references public.verified_provider_events(provider_event_id) on delete restrict,
  ledger_transaction_id uuid not null unique
    references public.ledger_transactions(ledger_transaction_id) on delete restrict,
  payee_user_id text not null references public.profiles(user_id) on delete restrict,
  wallet_id uuid not null references public.wallets(id) on delete restrict,
  wallet_transaction_id uuid not null
    references public.wallet_transactions(id) on delete restrict,
  gross_amount numeric(12,2) not null check(gross_amount>0),
  commission_amount numeric(12,2) not null check(commission_amount>=0),
  payee_amount numeric(12,2) not null check(payee_amount>0),
  policy_version_id uuid not null
    references public.creator_policy_versions(policy_version_id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table public.canonical_wallet_release_receipts enable row level security;
alter table public.canonical_unprotected_settlement_receipts enable row level security;
revoke all on table public.canonical_wallet_release_receipts
  from public,anon,authenticated;
revoke all on table public.canonical_unprotected_settlement_receipts
  from public,anon,authenticated;
grant all on table public.canonical_wallet_release_receipts to service_role;
grant all on table public.canonical_unprotected_settlement_receipts to service_role;

create or replace function public.project_completed_release_to_wallet()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_protection public.payment_protection_transactions;
  v_ledger public.ledger_transactions;
  v_wallet public.wallets;
  v_wallet_type text;
  v_payee_amount numeric(12,2);
  v_commission numeric(12,2);
  v_balance numeric(12,2);
  v_wallet_tx uuid;
  v_payment public.booking_payments;
begin
  if new.status<>'completed' or old.status='completed'
    or new.action_type not like 'release_%' then return new; end if;
  if (select auth.role())<>'service_role' then
    raise exception 'Canonical wallet projection requires service role';
  end if;
  if exists(select 1 from public.canonical_wallet_release_receipts
    where financial_action_id=new.financial_action_id) then return new; end if;
  select * into v_protection from public.payment_protection_transactions
  where id=new.payment_protection_id for share;
  if v_protection.id is null then raise exception 'Release protection is missing'; end if;
  select * into v_ledger from public.ledger_transactions
  where idempotency_key='financial-action:'||new.idempotency_key;
  if v_ledger.ledger_transaction_id is null then
    raise exception 'Canonical release ledger transaction is missing';
  end if;
  v_payee_amount:=round(coalesce((v_ledger.metadata->>'payee_amount')::numeric,0),2);
  v_commission:=round(coalesce((v_ledger.metadata->>'commission')::numeric,0),2);
  if v_payee_amount<0 or v_commission<0 or v_payee_amount+v_commission<>new.amount then
    raise exception 'Canonical release split is invalid';
  end if;
  v_wallet_type:=case when v_protection.subject_type='worker_booking'
    then 'worker' else 'property_partner' end;
  insert into public.wallets(
    owner_id,owner_type,available_balance,pending_balance,frozen_balance,total_withdrawn
  ) values(v_protection.payee_user_id,v_wallet_type,0,0,0,0)
  on conflict(owner_id,owner_type) do nothing;
  select * into v_wallet from public.wallets
  where owner_id=v_protection.payee_user_id and owner_type=v_wallet_type for update;
  update public.wallets set available_balance=coalesce(available_balance,0)+v_payee_amount,
    updated_at=now() where id=v_wallet.id returning available_balance into v_balance;
  insert into public.wallet_transactions(
    user_id,transaction_type,amount,balance_after,reference_id,reference_type,
    description,metadata,created_at
  ) values(
    v_protection.payee_user_id,'canonical_protected_release',v_payee_amount,v_balance,
    new.financial_action_id::text,'financial_action',
    'Available earnings from a completed Payment Protection release',
    jsonb_build_object('wallet_bucket','available','payment_protection_id',v_protection.id,
      'ledger_transaction_id',v_ledger.ledger_transaction_id,
      'commission_amount',v_commission),now()
  ) returning id into v_wallet_tx;
  insert into public.canonical_wallet_release_receipts(
    financial_action_id,payment_protection_id,ledger_transaction_id,payee_user_id,
    wallet_id,wallet_transaction_id,payee_amount,commission_amount
  ) values(new.financial_action_id,v_protection.id,v_ledger.ledger_transaction_id,
    v_protection.payee_user_id,v_wallet.id,v_wallet_tx,v_payee_amount,v_commission);

  select * into v_payment from public.booking_payments
  where paystack_reference=v_protection.paystack_reference order by created_at desc limit 1;
  if v_payment.id is not null then
    update public.booking_payments set payee_user_id=v_protection.payee_user_id,
      commission_rate=v_protection.commission_rate,
      amount_commission=coalesce(amount_commission,0)+v_commission,
      net_amount=coalesce(net_amount,0)+v_payee_amount,updated_at=now()
    where id=v_payment.id;
    if v_commission>0 then
      insert into public.commission_ledger(
        payment_id,booking_type,source_user_id,commission_amount,commission_rate,
        gross_amount,description,paystack_reference,status,created_at,updated_at
      ) values(
        v_payment.id,
        case
          when v_protection.subject_type='worker_booking' then 'worker'
          when v_protection.subject_type='hotel_stay' then 'hotel'
          else 'apartment' end,
        v_protection.payee_user_id,v_commission,v_protection.commission_rate,
        new.amount,'Commission recognized by canonical Payment Protection release',
        v_protection.paystack_reference,'collected',now(),now()
      ) on conflict(paystack_reference) where paystack_reference is not null
      do update set
        commission_amount=public.commission_ledger.commission_amount+excluded.commission_amount,
        gross_amount=public.commission_ledger.gross_amount+excluded.gross_amount,
        updated_at=now();
    end if;
    if v_wallet_type='property_partner' and v_payee_amount>0 then
      insert into public.property_partner_earning_releases(
        payment_id,partner_id,earning_type,status,net_amount,release_event,
        released_by,released_at,created_at,updated_at
      ) values(
        v_payment.id,v_protection.payee_user_id,
        case
          when v_protection.subject_type='hotel_stay' then 'hotel_payment'
          when v_protection.subject_type='short_let_stay' then 'short_stay_rent'
          when v_protection.subject_type='long_let_year_one' then 'long_stay_rent'
          else 'long_stay_rent' end,
        'available',v_payee_amount,'canonical_payment_protection_release',
        'finance_processor',now(),now(),now()
      ) on conflict(payment_id) do update set
        status='available',
        net_amount=public.property_partner_earning_releases.net_amount+excluded.net_amount,
        release_event=excluded.release_event,released_by=excluded.released_by,
        released_at=excluded.released_at,updated_at=now();
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists project_completed_release_to_wallet
  on public.financial_action_outbox;
create trigger project_completed_release_to_wallet
after update of status on public.financial_action_outbox
for each row execute function public.project_completed_release_to_wallet();

-- Future-year Long Let contributions deliberately bypass a long Payment
-- Protection hold at launch. After the verified provider charge is posted, this
-- trigger recognizes 5% commission and makes the Partner net withdrawable.
create or replace function public.settle_verified_unprotected_installment()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_payment public.booking_payments;
  v_listing public.listings;
  v_policy public.creator_policy_versions;
  v_payee text;
  v_gross numeric(12,2);
  v_rate numeric(5,2);
  v_commission numeric(12,2);
  v_net numeric(12,2);
  v_ledger uuid;
  v_wallet public.wallets;
  v_balance numeric(12,2);
  v_wallet_tx uuid;
begin
  if new.processing_status<>'processed' or old.processing_status='processed' then return new; end if;
  if (select auth.role())<>'service_role' then
    raise exception 'Unprotected installment settlement requires service role';
  end if;
  select * into v_payment from public.booking_payments
  where paystack_reference=new.provider_reference for update;
  if v_payment.id is null or v_payment.purpose<>'rent_plan_contribution' then return new; end if;
  if exists(select 1 from public.canonical_unprotected_settlement_receipts
    where booking_payment_id=v_payment.id) then return new; end if;
  select * into v_listing from public.listings
  where id::text=v_payment.listing_id for share;
  if v_listing.id is null or not coalesce(v_listing.future_installments_allowed,false) then
    raise exception 'Verified installment no longer has Partner authorization';
  end if;
  v_payee:=coalesce(v_listing.partner_id,v_listing.owner_id);
  if v_payee is null then raise exception 'Installment Property Partner is missing'; end if;
  select * into v_policy from public.creator_policy_versions
  where policy_key='commission_long_let' and scope_type='global' and scope_key='*'
    and status='active' and effective_from<=now()
    and (effective_until is null or effective_until>now())
  order by effective_from desc limit 1;
  v_rate:=(v_policy.value->>'percent')::numeric;
  if v_policy.policy_version_id is null or v_rate<0 or v_rate>50 then
    raise exception 'Active Creator Long Let commission is required';
  end if;
  v_gross:=round(coalesce(v_payment.verified_amount,v_payment.amount_total,v_payment.amount,0),2);
  if v_gross<=0 then raise exception 'Verified installment amount is invalid'; end if;
  v_commission:=round(v_gross*v_rate/100,2); v_net:=v_gross-v_commission;
  v_ledger:=public.post_ledger_transaction(
    'unprotected-installment:'||v_payment.id,'unprotected_partner_settlement','NGN',
    'booking_payment',v_payment.id::text,new.provider_event_id,
    jsonb_build_object('purpose','rent_plan_contribution','partner_opt_in',true,
      'payment_protection_hold',false,'payee_user_id',v_payee,
      'policy_version_id',v_policy.policy_version_id,'commission',v_commission,
      'payee_amount',v_net),
    jsonb_build_array(
      jsonb_build_object('account_key','liability:partner_payable:'||v_payee,
        'account_class','liability','owner_type','property_partner','owner_id',v_payee,
        'amount',v_gross,'memo','Verified installment payable cleared'),
      jsonb_build_object('account_key','liability:payee_available:'||v_payee,
        'account_class','liability','owner_type','profile','owner_id',v_payee,
        'amount',-v_net,'memo','Installment available for withdrawal'),
      jsonb_build_object('account_key','revenue:wehouse_commission:long_let_installment',
        'account_class','revenue','owner_type','wehouse','owner_id','platform',
        'amount',-v_commission,'memo','Long Let commission recognized')
    )
  );
  update public.booking_payments set payee_user_id=v_payee,commission_rate=v_rate,
    amount_commission=v_commission,net_amount=v_net,updated_at=now()
  where id=v_payment.id;
  insert into public.wallets(
    owner_id,owner_type,available_balance,pending_balance,frozen_balance,total_withdrawn
  ) values(v_payee,'property_partner',0,0,0,0)
  on conflict(owner_id,owner_type) do nothing;
  select * into v_wallet from public.wallets
  where owner_id=v_payee and owner_type='property_partner' for update;
  update public.wallets set available_balance=coalesce(available_balance,0)+v_net,
    updated_at=now() where id=v_wallet.id returning available_balance into v_balance;
  insert into public.wallet_transactions(
    user_id,transaction_type,amount,balance_after,reference_id,reference_type,
    description,metadata,created_at
  ) values(v_payee,'canonical_installment_settlement',v_net,v_balance,v_payment.id::text,
    'booking_payment','Verified future-year Long Let installment',
    jsonb_build_object('wallet_bucket','available','ledger_transaction_id',v_ledger,
      'commission_rate',v_rate,'commission_amount',v_commission),now())
  returning id into v_wallet_tx;
  insert into public.commission_ledger(
    payment_id,booking_type,source_user_id,commission_amount,commission_rate,
    gross_amount,description,paystack_reference,status,created_at,updated_at
  ) values(v_payment.id,'apartment',v_payee,v_commission,v_rate,v_gross,
    'Long Let installment commission from canonical ledger settlement',
    v_payment.paystack_reference,'collected',now(),now())
  on conflict(paystack_reference) where paystack_reference is not null do nothing;
  insert into public.property_partner_earning_releases(
    payment_id,partner_id,earning_type,status,net_amount,release_event,
    released_by,released_at,created_at,updated_at
  ) values(v_payment.id,v_payee,'rent_plan_contribution','available',v_net,
    'verified_normal_settlement','paystack',now(),now(),now())
  on conflict(payment_id) do update set status='available',net_amount=excluded.net_amount,
    release_event=excluded.release_event,released_by=excluded.released_by,
    released_at=excluded.released_at,updated_at=now();
  insert into public.canonical_unprotected_settlement_receipts(
    booking_payment_id,provider_event_id,ledger_transaction_id,payee_user_id,
    wallet_id,wallet_transaction_id,gross_amount,commission_amount,payee_amount,
    policy_version_id
  ) values(v_payment.id,new.provider_event_id,v_ledger,v_payee,v_wallet.id,v_wallet_tx,
    v_gross,v_commission,v_net,v_policy.policy_version_id);
  insert into public.financial_audit_logs(
    event_type,user_id,target_user_id,amount,reference_id,reference_type,
    description,metadata
  ) values('canonical_installment_settled',v_payment.user_id,v_payee,v_net,
    v_payment.id::text,'booking_payment',
    'Verified Partner-approved Long Let installment settled without a long hold',
    jsonb_build_object('gross',v_gross,'commission',v_commission,
      'policy_version_id',v_policy.policy_version_id,'ledger_transaction_id',v_ledger));
  return new;
end
$$;

drop trigger if exists settle_verified_unprotected_installment
  on public.verified_provider_events;
create trigger settle_verified_unprotected_installment
after update of processing_status on public.verified_provider_events
for each row execute function public.settle_verified_unprotected_installment();

revoke all on function public.project_completed_release_to_wallet()
  from public,anon,authenticated;
revoke all on function public.settle_verified_unprotected_installment()
  from public,anon,authenticated;
grant execute on function public.project_completed_release_to_wallet() to service_role;
grant execute on function public.settle_verified_unprotected_installment() to service_role;

insert into public.function_execution_registry(
  function_signature,function_name,security_mode,public_allowed,anon_allowed,
  authenticated_allowed,service_role_allowed,review_state,rationale,captured_at
)
select p.oid::regprocedure::text,p.proname,
  case when p.prosecdef then 'definer' else 'invoker' end,
  has_function_privilege('public',p.oid,'execute'),
  has_function_privilege('anon',p.oid,'execute'),
  has_function_privilege('authenticated',p.oid,'execute'),
  has_function_privilege('service_role',p.oid,'execute'),
  'approved_service_only','Canonical ledger-to-compatibility projection trigger',now()
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in(
  'project_completed_release_to_wallet','settle_verified_unprotected_installment',
  'settle_verified_property_partner_payment','register_pending_property_partner_earning'
)
on conflict(function_signature) do update set
  function_name=excluded.function_name,security_mode=excluded.security_mode,
  public_allowed=excluded.public_allowed,anon_allowed=excluded.anon_allowed,
  authenticated_allowed=excluded.authenticated_allowed,
  service_role_allowed=excluded.service_role_allowed,
  review_state=excluded.review_state,rationale=excluded.rationale,captured_at=now();

comment on table public.canonical_wallet_release_receipts is
  'Idempotent projection receipts. Wallets are not an independent money source.';
comment on table public.canonical_unprotected_settlement_receipts is
  'Normal-settlement receipts for Partner-approved future Long Let installments.';
