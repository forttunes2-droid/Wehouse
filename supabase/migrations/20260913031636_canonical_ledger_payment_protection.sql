-- Canonical immutable double-entry ledger and Payment Protection state machine.
-- Existing wallet/payment tables remain compatibility read models until callers
-- have migrated. New financial authority begins here.

create table if not exists public.verified_provider_events(
  provider_event_id uuid primary key default gen_random_uuid(),
  provider text not null check(provider in ('paystack')),
  provider_event_key text not null,
  event_type text not null,
  provider_reference text,
  payload_sha256 text not null,
  signature_verified_at timestamptz not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_status text not null default 'received'
    check(processing_status in ('received','processed','ignored','failed')),
  processing_error text,
  unique(provider,provider_event_key)
);

create unique index if not exists verified_provider_reference_event_unique
  on public.verified_provider_events(provider,provider_reference,event_type)
  where provider_reference is not null;

create table if not exists public.ledger_accounts(
  ledger_account_id uuid primary key default gen_random_uuid(),
  account_key text not null unique,
  account_class text not null check(account_class in (
    'asset','liability','revenue','expense','equity'
  )),
  owner_type text,
  owner_id text,
  currency text not null default 'NGN',
  status text not null default 'active' check(status in ('active','closed')),
  created_at timestamptz not null default now(),
  check(currency=upper(currency) and char_length(currency)=3)
);

create table if not exists public.ledger_transactions(
  ledger_transaction_id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  transaction_type text not null,
  currency text not null default 'NGN',
  reference_type text not null,
  reference_id text not null,
  provider_event_id uuid references public.verified_provider_events(provider_event_id),
  payload_checksum text not null,
  metadata jsonb not null default '{}'::jsonb,
  posted_at timestamptz not null default now(),
  created_by text,
  check(currency=upper(currency) and char_length(currency)=3)
);

create table if not exists public.ledger_entries(
  ledger_entry_id uuid primary key default gen_random_uuid(),
  ledger_transaction_id uuid not null
    references public.ledger_transactions(ledger_transaction_id) on delete restrict,
  ledger_account_id uuid not null
    references public.ledger_accounts(ledger_account_id) on delete restrict,
  amount numeric(18,2) not null check(amount<>0),
  memo text,
  created_at timestamptz not null default now()
);

create index if not exists ledger_entries_transaction_idx
  on public.ledger_entries(ledger_transaction_id);
create index if not exists ledger_entries_account_time_idx
  on public.ledger_entries(ledger_account_id,created_at,ledger_entry_id);

alter table public.verified_provider_events enable row level security;
alter table public.ledger_accounts enable row level security;
alter table public.ledger_transactions enable row level security;
alter table public.ledger_entries enable row level security;
revoke all on table public.verified_provider_events from public,anon,authenticated;
revoke all on table public.ledger_accounts from public,anon,authenticated;
revoke all on table public.ledger_transactions from public,anon,authenticated;
revoke all on table public.ledger_entries from public,anon,authenticated;
grant all on table public.verified_provider_events to service_role;
grant all on table public.ledger_accounts to service_role;
grant all on table public.ledger_transactions to service_role;
grant all on table public.ledger_entries to service_role;

create or replace function public.prevent_ledger_mutation()
returns trigger
language plpgsql
set search_path to 'pg_catalog','public'
as $$
begin
  raise exception 'Posted ledger records are immutable';
end
$$;

drop trigger if exists ledger_transactions_immutable
  on public.ledger_transactions;
create trigger ledger_transactions_immutable
before update or delete on public.ledger_transactions
for each row execute function public.prevent_ledger_mutation();

drop trigger if exists ledger_entries_immutable on public.ledger_entries;
create trigger ledger_entries_immutable
before update or delete on public.ledger_entries
for each row execute function public.prevent_ledger_mutation();

create or replace function public.assert_ledger_transaction_balanced()
returns trigger
language plpgsql
set search_path to 'pg_catalog','public'
as $$
declare v_transaction_id uuid; v_total numeric; v_count integer;
begin
  v_transaction_id:=case
    when tg_op='DELETE' then old.ledger_transaction_id
    else new.ledger_transaction_id
  end;
  select coalesce(sum(amount),0),count(*)
  into v_total,v_count
  from public.ledger_entries
  where ledger_transaction_id=v_transaction_id;
  if v_count<2 or v_total<>0 then
    raise exception 'Ledger transaction % is not balanced: % entries total %',
      v_transaction_id,v_count,v_total;
  end if;
  return null;
end
$$;

drop trigger if exists ledger_entries_balance_guard on public.ledger_entries;
create constraint trigger ledger_entries_balance_guard
after insert or update or delete on public.ledger_entries
deferrable initially deferred
for each row execute function public.assert_ledger_transaction_balanced();

create or replace function public.post_ledger_transaction(
  p_idempotency_key text,
  p_transaction_type text,
  p_currency text,
  p_reference_type text,
  p_reference_id text,
  p_provider_event_id uuid,
  p_metadata jsonb,
  p_entries jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_transaction_id uuid;
  v_existing public.ledger_transactions;
  v_payload_checksum text;
  v_total numeric;
  v_count integer;
  v_entry jsonb;
  v_account public.ledger_accounts;
  v_actor text;
begin
  if (select auth.role())<>'service_role' then
    raise exception 'service role required';
  end if;
  if coalesce(nullif(btrim(p_idempotency_key),''),'')='' then
    raise exception 'idempotency_key is required';
  end if;
  if jsonb_typeof(p_entries)<>'array' then
    raise exception 'entries must be a JSON array';
  end if;
  select count(*),coalesce(sum((x->>'amount')::numeric),0)
  into v_count,v_total from jsonb_array_elements(p_entries) x;
  if v_count<2 or v_total<>0 then
    raise exception 'Ledger debits and credits must be balanced';
  end if;
  if exists(
    select 1 from jsonb_array_elements(p_entries) x
    where coalesce((x->>'amount')::numeric,0)=0
      or nullif(btrim(x->>'account_key'),'') is null
      or (x->>'account_class') not in ('asset','liability','revenue','expense','equity')
  ) then raise exception 'Invalid ledger entry'; end if;

  v_payload_checksum:=md5(
    p_transaction_type||':'||upper(p_currency)||':'||p_reference_type||':'
    ||p_reference_id||':'||coalesce(p_metadata,'{}'::jsonb)::text||':'||p_entries::text
  );
  select * into v_existing from public.ledger_transactions
  where idempotency_key=p_idempotency_key;
  if v_existing.ledger_transaction_id is not null then
    if v_existing.payload_checksum<>v_payload_checksum then
      raise exception 'Idempotency key was reused with a different transaction';
    end if;
    return v_existing.ledger_transaction_id;
  end if;

  insert into public.ledger_transactions(
    idempotency_key,transaction_type,currency,reference_type,reference_id,
    provider_event_id,payload_checksum,metadata,created_by
  ) values(
    p_idempotency_key,p_transaction_type,upper(p_currency),p_reference_type,
    p_reference_id,p_provider_event_id,v_payload_checksum,
    coalesce(p_metadata,'{}'::jsonb),v_actor
  ) returning ledger_transaction_id into v_transaction_id;

  for v_entry in select * from jsonb_array_elements(p_entries)
  loop
    insert into public.ledger_accounts(
      account_key,account_class,owner_type,owner_id,currency
    ) values(
      v_entry->>'account_key',v_entry->>'account_class',
      nullif(v_entry->>'owner_type',''),nullif(v_entry->>'owner_id',''),
      upper(p_currency)
    ) on conflict(account_key) do update
      set account_key=excluded.account_key
    returning * into v_account;
    if v_account.currency<>upper(p_currency)
      or v_account.account_class<>(v_entry->>'account_class') then
      raise exception 'Ledger account definition conflict';
    end if;
    insert into public.ledger_entries(
      ledger_transaction_id,ledger_account_id,amount,memo
    ) values(
      v_transaction_id,v_account.ledger_account_id,
      (v_entry->>'amount')::numeric,nullif(v_entry->>'memo','')
    );
  end loop;
  return v_transaction_id;
end
$$;

revoke all on function public.post_ledger_transaction(
  text,text,text,text,text,uuid,jsonb,jsonb
) from public,anon,authenticated;
grant execute on function public.post_ledger_transaction(
  text,text,text,text,text,uuid,jsonb,jsonb
) to service_role;

-- The compatibility transaction row now exposes a strict money-only state. A
-- product status such as Worker job completion remains on its own lifecycle.
alter table public.payment_protection_transactions
  alter column booking_id drop not null,
  add column if not exists protection_state text,
  add column if not exists subject_type text,
  add column if not exists subject_id text,
  add column if not exists protected_ledger_transaction_id uuid
    references public.ledger_transactions(ledger_transaction_id),
  add column if not exists release_ledger_transaction_id uuid
    references public.ledger_transactions(ledger_transaction_id),
  add column if not exists refund_ledger_transaction_id uuid
    references public.ledger_transactions(ledger_transaction_id),
  add column if not exists release_eligible_at timestamptz,
  add column if not exists risk_held_at timestamptz,
  add column if not exists dispute_case_id uuid;

update public.payment_protection_transactions
set subject_type=coalesce(subject_type,booking_type),
    subject_id=coalesce(subject_id,booking_id::text)
where subject_type is null or subject_id is null;

alter table public.payment_protection_transactions
  drop constraint if exists payment_protection_subject_required;
alter table public.payment_protection_transactions
  add constraint payment_protection_subject_required check(
    nullif(btrim(subject_type),'') is not null
    and nullif(btrim(subject_id),'') is not null
  ) not valid;
alter table public.payment_protection_transactions
  validate constraint payment_protection_subject_required;
create unique index if not exists payment_protection_subject_unique
  on public.payment_protection_transactions(subject_type,subject_id);

update public.payment_protection_transactions
set protection_state=case
  when status in ('released') then 'released'
  when status in ('refunded') then 'refunded'
  when status in ('disputed') then 'disputed'
  else 'protected'
end
where protection_state is null;

alter table public.payment_protection_transactions
  alter column protection_state set not null,
  alter column protection_state set default 'awaiting_funds';
alter table public.payment_protection_transactions
  drop constraint if exists payment_protection_state_check;
alter table public.payment_protection_transactions
  add constraint payment_protection_state_check check(protection_state in (
    'awaiting_funds','protected','release_eligible','release_pending',
    'released','disputed','risk_held','reversal_pending','refunded',
    'partially_released','reversed'
  ));

create table if not exists public.payment_protection_transitions(
  transition_id uuid primary key default gen_random_uuid(),
  payment_protection_id uuid not null
    references public.payment_protection_transactions(id) on delete restrict,
  from_state text not null,
  to_state text not null,
  event_type text not null,
  event_key text not null unique,
  actor_user_id text,
  actor_type text not null,
  reason text,
  ledger_transaction_id uuid
    references public.ledger_transactions(ledger_transaction_id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.payment_protection_transitions enable row level security;
revoke all on table public.payment_protection_transitions from public,anon,authenticated;
grant all on table public.payment_protection_transitions to service_role;

create or replace function public.transition_payment_protection(
  p_payment_protection_id uuid,
  p_to_state text,
  p_event_type text,
  p_event_key text,
  p_actor_user_id text,
  p_actor_type text,
  p_reason text default null,
  p_ledger_transaction_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.payment_protection_transactions
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_row public.payment_protection_transactions;
  v_allowed boolean:=false;
begin
  if (select auth.role())<>'service_role' then
    raise exception 'service role required';
  end if;
  select * into v_row from public.payment_protection_transactions
  where id=p_payment_protection_id for update;
  if v_row.id is null then raise exception 'Payment Protection record not found'; end if;
  if exists(
    select 1 from public.payment_protection_transitions
    where event_key=p_event_key
  ) then return v_row; end if;

  v_allowed:=case v_row.protection_state
    when 'awaiting_funds' then p_to_state in ('protected','refunded')
    when 'protected' then p_to_state in (
      'release_eligible','disputed','risk_held','reversal_pending','refunded'
    )
    when 'release_eligible' then p_to_state in (
      'release_pending','disputed','risk_held','reversal_pending'
    )
    when 'release_pending' then p_to_state in (
      'released','partially_released','risk_held'
    )
    when 'disputed' then p_to_state in (
      'protected','released','partially_released','refunded','risk_held'
    )
    when 'risk_held' then p_to_state in (
      'protected','disputed','refunded','reversal_pending'
    )
    when 'reversal_pending' then p_to_state in ('reversed','protected')
    else false
  end;
  if not v_allowed then
    raise exception 'Illegal Payment Protection transition: % -> %',
      v_row.protection_state,p_to_state;
  end if;

  insert into public.payment_protection_transitions(
    payment_protection_id,from_state,to_state,event_type,event_key,
    actor_user_id,actor_type,reason,ledger_transaction_id,metadata
  ) values(
    v_row.id,v_row.protection_state,p_to_state,p_event_type,p_event_key,
    p_actor_user_id,p_actor_type,p_reason,p_ledger_transaction_id,
    coalesce(p_metadata,'{}'::jsonb)
  );
  update public.payment_protection_transactions
  set protection_state=p_to_state,
      status=p_to_state,
      release_eligible_at=case
        when p_to_state='release_eligible' then now() else release_eligible_at end,
      risk_held_at=case when p_to_state='risk_held' then now() else risk_held_at end,
      released_at=case when p_to_state='released' then now() else released_at end,
      updated_at=now()
  where id=v_row.id
  returning * into v_row;
  return v_row;
end
$$;

revoke all on function public.transition_payment_protection(
  uuid,text,text,text,text,text,text,uuid,jsonb
) from public,anon,authenticated;
grant execute on function public.transition_payment_protection(
  uuid,text,text,text,text,text,text,uuid,jsonb
) to service_role;

-- Finance views use ledger entries and never a client-maintained wallet balance.
create or replace function public.get_my_ledger_statement(
  p_limit integer default 100,
  p_before timestamptz default null
)
returns table(
  ledger_transaction_id uuid,
  transaction_type text,
  reference_type text,
  reference_id text,
  amount numeric,
  currency text,
  posted_at timestamptz,
  metadata jsonb
)
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  with actor as(select public.current_profile_user_id() user_id)
  select t.ledger_transaction_id,t.transaction_type,t.reference_type,
    t.reference_id,e.amount,t.currency,t.posted_at,t.metadata
  from public.ledger_entries e
  join public.ledger_accounts a on a.ledger_account_id=e.ledger_account_id
  join public.ledger_transactions t
    on t.ledger_transaction_id=e.ledger_transaction_id
  cross join actor
  where a.owner_id=actor.user_id
    and (p_before is null or t.posted_at<p_before)
  order by t.posted_at desc,t.ledger_transaction_id
  limit least(greatest(coalesce(p_limit,100),1),250)
$$;

revoke all on function public.get_my_ledger_statement(integer,timestamptz)
from public,anon;
grant execute on function public.get_my_ledger_statement(integer,timestamptz)
to authenticated,service_role;

comment on table public.ledger_entries
is 'Signed double-entry postings. For every ledger_transaction_id, sum(amount)=0.';
comment on table public.payment_protection_transitions
is 'Immutable money-state history; never a booking or job status.';
